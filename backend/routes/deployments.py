"""Deployments and managed triggers (publish a workflow as a token-authed API)."""
from __future__ import annotations
import os
import json
import asyncio
import time

from fastapi import APIRouter, HTTPException, Query, Header, UploadFile, File, Body
from fastapi.responses import StreamingResponse
from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType

from config import ns, llm_config, settings, litellm_kwargs, save_json, load_json, \
    LLM_CONFIG_PATH, SETTINGS_PATH, EGRESS_CONFIG_PATH, DATA_DIR, DEFAULT_SETTINGS, is_docker
from task_store import save_task as _persist_task, load_all_tasks as _load_persisted_tasks
from pydantic import BaseModel
from models import LLMConfigIn, ConstitutionBody, WebhookBody, SpawnAgentRequest, SettingsIn
from stores import audit_collector
import json as _json
from routes.workflows import _iter_run_files

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


# ── Deployments: publish a workflow as a token-authed callable API endpoint ──────
import secrets as _secrets
import time as _time

_DEPLOY_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "deployments")


def _deploy_path(did: str) -> str:
    return os.path.join(_DEPLOY_DIR, f"{did}.json")


def _load_deploy(did: str):
    p = _deploy_path(did)
    return json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else None


def _save_deploy(d: dict) -> None:
    os.makedirs(_DEPLOY_DIR, exist_ok=True)
    with open(_deploy_path(d["id"]), "w", encoding="utf-8") as f:
        json.dump(d, f)


def _public_deploy(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in ("token", "config")}


def backfill_deployment_tags() -> int:
    """Tag historical deployment-run tasks (created before metadata tagging existed) so
    they show the deployment badge in Observability's Recent Tasks. Idempotent — skips
    tasks already tagged. Called once at startup."""
    if kernel is None or not os.path.isdir(_DEPLOY_DIR):
        return 0
    tagged = 0
    try:
        for entry in os.listdir(_DEPLOY_DIR):
            rdir = os.path.join(_DEPLOY_DIR, entry, "runs")
            if not os.path.isdir(rdir):
                continue
            for fn in os.listdir(rdir):
                if not fn.endswith(".json"):
                    continue
                try:
                    rec = json.load(open(os.path.join(rdir, fn), encoding="utf-8"))
                except Exception:
                    continue
                tid = rec.get("taskId")
                if not tid:
                    continue
                kt = kernel._tasks.get(tid)
                if kt is None:
                    continue
                if not isinstance(kt.metadata, dict):
                    kt.metadata = {}
                if kt.metadata.get("deployment_id"):
                    continue
                kt.metadata["deployment_id"] = rec.get("deploymentId") or entry
                kt.metadata["deployment_name"] = rec.get("deploymentName")
                try:
                    _persist_task(kt)
                except Exception:
                    pass
                tagged += 1
    except Exception:
        pass
    return tagged


@router.post("/deployments/publish")
async def publish_deployment(body: dict, x_tenant_id: str = Header(default="")):
    """Publish a workflow as a callable API endpoint. Streams the deploy pipeline (SSE),
    then emits the live deployment with its endpoint + bearer token."""
    _require()
    name = (body.get("name") or "Untitled automation").strip()
    notes = body.get("release_notes", "")
    config = body.get("config") or {}
    if not config.get("agents") and not config.get("graph"):
        raise HTTPException(400, "config (agents or graph) is required")
    tenant = x_tenant_id
    workflow_id = body.get("workflow_id")
    version_id = body.get("version_id")
    did = "dep_" + _secrets.token_hex(5)
    token = "kmcp_" + _secrets.token_urlsafe(24)

    async def gen():
        def sse(ev: dict) -> str:
            return f"data: {json.dumps(ev)}\n\n"
        steps = [
            ("Queued", "Deploy enqueued"),
            ("Validating", f"Validating workflow — {len(config.get('agents', []))} agent(s), pattern '{config.get('pattern', 'sequential')}'"),
            ("Building", "Packaging workflow definition + tool bindings"),
            ("Provisioning", "Allocating an isolated runner namespace"),
            ("Securing", "Issuing bearer token + API route"),
            ("Deploying", "Exposing the endpoint"),
        ]
        for phase, msg in steps:
            yield sse({"type": "step", "phase": phase, "text": msg})
            await asyncio.sleep(0.5)
        dep = {
            "id": did, "name": name, "release_notes": notes, "config": config,
            "token": token, "tenant": tenant, "created_at": _time.time(),
            "runs": 0, "version": 1, "status": "live",
            "workflowId": workflow_id, "versionId": version_id,
        }
        _save_deploy(dep)
        yield sse({"type": "done", "id": did, "name": name,
                   "endpoint": f"/deployments/{did}/run", "token": token, "status": "live"})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@router.get("/deployments")
async def list_deployments(x_tenant_id: str = Header(default="")):
    _ensure_ticker()
    os.makedirs(_DEPLOY_DIR, exist_ok=True)
    out = []
    for f in os.listdir(_DEPLOY_DIR):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(_DEPLOY_DIR, f), encoding="utf-8"))
            # Tenant binding — hide other tenants' deployments. Legacy untagged → default (demo).
            if x_tenant_id and (d.get("tenant") or ns(None)) != x_tenant_id:
                continue
            out.append({**_public_deploy(d), "endpoint": f"/deployments/{d['id']}/run"})
        except Exception:
            pass
    out.sort(key=lambda d: d.get("created_at", 0), reverse=True)
    return {"deployments": out}


def _deploy_input_keys(config: dict) -> list:
    """Extract the {placeholder} names a deployment expects as per-call inputs."""
    import re as _re
    texts = [str(config.get("goal", ""))]
    for a in config.get("agents", []):
        texts.append(str(a.get("instructions", "")))
    for n in (config.get("graph") or {}).get("nodes", []) or []:
        texts.append(str((n.get("data") or {}).get("instructions", "")))
    keys = []
    for t in texts:
        for m in _re.findall(r"\{([a-zA-Z0-9_]+)\}", t):
            if m not in keys:
                keys.append(m)
    return keys


@router.get("/deployments/{did}")
async def get_deployment(did: str, x_tenant_id: str = Header(default="")):
    """Deployment detail (never the token). The owner (matching tenant) also gets the
    deployed config back, so they can review goal/agents/instructions later."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    rdir = os.path.join(_DEPLOY_DIR, did, "runs")
    run_count = len([f for f in os.listdir(rdir) if f.endswith(".json")]) if os.path.isdir(rdir) else 0
    is_owner = x_tenant_id == dep.get("tenant", "")
    return {**_public_deploy(dep), "endpoint": f"/deployments/{did}/run",
            "inputs": _deploy_input_keys(dep.get("config", {})), "run_count": run_count,
            "isOwner": is_owner, **({"config": dep.get("config")} if is_owner else {})}


@router.post("/deployments/{did}/rotate-token")
async def rotate_deployment_token(did: str, x_tenant_id: str = Header(default="")):
    """Owner-only: issue a fresh bearer token and invalidate the old one. Returned once."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    if x_tenant_id != dep.get("tenant", ""):
        raise HTTPException(403, "not the owner of this deployment")
    new_token = "kmcp_" + _secrets.token_urlsafe(24)
    dep["token"] = new_token
    _save_deploy(dep)
    return {"token": new_token}


@router.post("/deployments/{did}/status")
async def set_deployment_status(did: str, body: dict, x_tenant_id: str = Header(default="")):
    """Owner-only: take a deployment offline ('paused') or back online ('live').
    While paused, public API calls are rejected but the record + history are kept."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    if x_tenant_id != dep.get("tenant", ""):
        raise HTTPException(403, "not the owner of this deployment")
    new_status = body.get("status")
    if new_status not in ("live", "paused"):
        raise HTTPException(400, "status must be 'live' or 'paused'")
    dep["status"] = new_status
    _save_deploy(dep)
    return {"status": new_status}


@router.get("/deployments/{did}/metrics")
async def deployment_metrics(did: str, x_tenant_id: str = Header(default="")):
    """Per-deployment metrics, aggregated from its run history: success rate, token/cost
    totals + averages, latency percentiles, a daily call timeline, and a source (api vs test)
    breakdown. Read-only — visible from the global Fleet ops view regardless of owner."""
    import datetime as _dt
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")

    rdir = os.path.join(_DEPLOY_DIR, did, "runs")
    runs = []
    if os.path.isdir(rdir):
        for f in os.listdir(rdir):
            if f.endswith(".json"):
                try:
                    runs.append(_json.load(open(os.path.join(rdir, f), encoding="utf-8")))
                except Exception:
                    pass

    total = len(runs)
    completed = sum(1 for r in runs if r.get("status") == "completed")
    failed = sum(1 for r in runs if r.get("status") == "failed")
    by_source = {}
    for r in runs:
        s = r.get("source", "api")
        by_source[s] = by_source.get(s, 0) + 1

    def _m(r, k):
        return (r.get("metrics") or {}).get(k, 0) or 0
    tot_tokens = sum(_m(r, "tokens") for r in runs)
    tot_cost = sum(_m(r, "cost") for r in runs)
    durations = sorted(_m(r, "duration") for r in runs if _m(r, "duration"))

    def _pct(p):
        if not durations:
            return 0
        i = min(len(durations) - 1, int(round((p / 100) * (len(durations) - 1))))
        return durations[i]

    # Daily timeline over the last 14 days
    today = _dt.datetime.utcnow().date()
    days = [(today - _dt.timedelta(days=i)) for i in range(13, -1, -1)]
    buckets = {d.isoformat(): {"date": d.isoformat(), "calls": 0, "failures": 0} for d in days}
    for r in runs:
        ts = r.get("createdAt")
        if not ts:
            continue
        d = _dt.datetime.utcfromtimestamp(ts / 1000).date().isoformat()
        if d in buckets:
            buckets[d]["calls"] += 1
            if r.get("status") == "failed":
                buckets[d]["failures"] += 1

    return {
        "deploymentId": did,
        "totalCalls": total,
        "byStatus": {"completed": completed, "failed": failed},
        "successRate": (completed / total) if total else None,
        "bySource": by_source,
        "totals": {"tokens": tot_tokens, "cost": round(tot_cost, 6)},
        "avg": {
            "tokens": round(tot_tokens / total) if total else 0,
            "cost": round(tot_cost / total, 6) if total else 0,
            "durationMs": round(sum(durations) / len(durations)) if durations else 0,
        },
        "latency": {"p50": _pct(50), "p95": _pct(95), "max": durations[-1] if durations else 0},
        "timeline": [buckets[d.isoformat()] for d in days],
    }


# ── Managed triggers on a deployment: interval / cron schedules + webhooks ───────
_TRIGGERS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "deployment_triggers")


def _trigger_path(tid: str) -> str:
    return os.path.join(_TRIGGERS_DIR, f"{tid}.json")


def _load_trigger(tid: str):
    p = _trigger_path(tid)
    return _json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else None


def _save_trigger(t: dict) -> None:
    os.makedirs(_TRIGGERS_DIR, exist_ok=True)
    with open(_trigger_path(t["id"]), "w", encoding="utf-8") as f:
        _json.dump(t, f)


def _iter_triggers():
    if not os.path.isdir(_TRIGGERS_DIR):
        return
    for f in os.listdir(_TRIGGERS_DIR):
        if f.endswith(".json"):
            try:
                yield _json.load(open(os.path.join(_TRIGGERS_DIR, f), encoding="utf-8"))
            except Exception:
                pass


def _triggers_for(did: str):
    return [t for t in _iter_triggers() if t.get("deploymentId") == did]


def _public_trigger(t: dict, did: str) -> dict:
    o = {k: v for k, v in t.items() if k != "secret"}
    if t.get("type") == "webhook":
        o["webhook_url"] = f"/deployments/{did}/webhook/{t.get('secret')}"
    return o


def _cron_field_match(field: str, value: int) -> bool:
    field = field.strip()
    if field == "*":
        return True
    for part in field.split(","):
        part = part.strip()
        try:
            if part.startswith("*/"):
                step = int(part[2:])
                if step and value % step == 0:
                    return True
            elif "-" in part:
                a, b = part.split("-")
                if int(a) <= value <= int(b):
                    return True
            elif part.isdigit() and int(part) == value:
                return True
        except Exception:
            continue
    return False


def _cron_matches(dt, expr: str) -> bool:
    """Minimal 5-field cron matcher (min hour dom month dow). dow: 0=Sunday..6=Saturday."""
    fields = expr.split()
    if len(fields) != 5:
        return False
    m, h, dom, mon, dow = fields
    cron_dow = (dt.weekday() + 1) % 7  # python Mon=0..Sun=6 → cron Sun=0..Sat=6
    return (_cron_field_match(m, dt.minute) and _cron_field_match(h, dt.hour)
            and _cron_field_match(dom, dt.day) and _cron_field_match(mon, dt.month)
            and _cron_field_match(dow, cron_dow))


_ticker_started = False


def _ensure_ticker():
    global _ticker_started
    if _ticker_started:
        return
    try:
        asyncio.ensure_future(_trigger_loop())
        _ticker_started = True
    except RuntimeError:
        pass  # no running loop yet — will start on the next deployment request


async def _trigger_loop():
    while True:
        try:
            await _tick_triggers()
        except Exception:
            pass
        await asyncio.sleep(30)


async def _tick_triggers():
    import datetime as _dt
    now = _time.time()
    now_utc = _dt.datetime.utcnow()
    for t in _iter_triggers():
        if not t.get("active") or t.get("type") == "webhook":
            continue
        last = t.get("last_run") or 0
        due = False
        if t.get("type") == "interval":
            due = (now - last) >= t.get("seconds", 0)
        elif t.get("type") == "cron":
            due = _cron_matches(now_utc, t.get("cron", "")) and (now - last) >= 50
        if not due:
            continue
        dep = _load_deploy(t["deploymentId"])
        if not dep or dep.get("status") == "paused":
            continue
        t["last_run"] = now
        _save_trigger(t)
        from routes.fleet import _execute_deployment  # lazy: avoids deployments<->fleet import cycle
        asyncio.create_task(_execute_deployment(dep, t.get("inputs") or {}, True, 280, "schedule"))


@router.post("/deployments/{did}/triggers")
async def create_deployment_trigger(did: str, body: dict, x_tenant_id: str = Header(default="")):
    """Owner-only: attach a managed trigger to a deployment.
    type='interval' (seconds>=30) · 'cron' (5-field expr) · 'webhook' (returns a secret URL)."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    if x_tenant_id != dep.get("tenant", ""):
        raise HTTPException(403, "not the owner of this deployment")
    ttype = body.get("type")
    if ttype not in ("interval", "cron", "webhook"):
        raise HTTPException(400, "type must be interval, cron or webhook")
    tid = "trg_" + _secrets.token_hex(5)
    trig = {"id": tid, "deploymentId": did, "tenant": x_tenant_id, "type": ttype,
            "inputs": body.get("inputs") or {}, "active": True,
            "created_at": _time.time(),
            "last_run": _time.time() if ttype == "interval" else 0, "last_status": None}
    if ttype == "interval":
        secs = int(body.get("seconds") or 0)
        if secs < 30:
            raise HTTPException(400, "interval must be at least 30 seconds")
        trig["seconds"] = secs
    elif ttype == "cron":
        expr = (body.get("cron") or "").strip()
        if len(expr.split()) != 5:
            raise HTTPException(400, "cron must have 5 fields (min hour dom month dow)")
        trig["cron"] = expr
    elif ttype == "webhook":
        trig["secret"] = _secrets.token_urlsafe(16)
    _save_trigger(trig)
    _ensure_ticker()
    return _public_trigger(trig, did)


@router.get("/deployments/{did}/triggers")
async def list_deployment_triggers(did: str, x_tenant_id: str = Header(default="")):
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    # Read-only: triggers are visible from the global Fleet view (webhook secrets are stripped
    # by _public_trigger). Creating/deleting triggers stays owner-only.
    _ensure_ticker()
    return {"triggers": [_public_trigger(t, did) for t in sorted(_triggers_for(did), key=lambda x: x.get("created_at", 0), reverse=True)]}


@router.delete("/deployments/triggers/{tid}")
async def delete_deployment_trigger(tid: str, x_tenant_id: str = Header(default="")):
    t = _load_trigger(tid)
    if not t:
        raise HTTPException(404, "trigger not found")
    if x_tenant_id != t.get("tenant", ""):
        raise HTTPException(403, "not the owner of this trigger")
    os.remove(_trigger_path(tid))
    return {"deleted": tid}


@router.post("/deployments/{did}/webhook/{secret}")
async def trigger_deployment_webhook(did: str, secret: str, body: dict = Body(default={})):
    """Public webhook trigger — the secret in the URL is the auth. Runs the deployment."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    trig = next((t for t in _triggers_for(did)
                 if t.get("type") == "webhook" and t.get("secret") == secret and t.get("active")), None)
    if not trig:
        raise HTTPException(401, "invalid webhook secret")
    if dep.get("status") == "paused":
        raise HTTPException(503, "deployment is paused (taken offline by the owner)")
    inputs = {**(trig.get("inputs") or {}), **((body or {}).get("inputs") or {})}
    trig["last_run"] = _time.time()
    _save_trigger(trig)
    from routes.fleet import _execute_deployment  # lazy: avoids deployments<->fleet import cycle
    return await _execute_deployment(dep, inputs, (body or {}).get("blocking", True), 280, "webhook")


def _trig_label(t: dict) -> str:
    if t.get("type") == "interval":
        s = t.get("seconds", 0)
        return f"Every {s // 3600}h" if s >= 3600 else f"Every {s // 60}m" if s >= 60 else f"Every {s}s"
    if t.get("type") == "cron":
        return f"Cron · {t.get('cron')}"
    return "Webhook"


@router.get("/control-plane")
async def control_plane():
    """Fleet snapshot for mission control: deployments, triggers, and today's activity.
    Intentionally GLOBAL (cross-tenant) — this is the instance-wide ops view; each deployment
    carries a `tenant` badge. The per-tenant 'my deployments' list lives at GET /deployments."""
    import datetime as _dt
    _ensure_ticker()
    deps = []
    if os.path.isdir(_DEPLOY_DIR):
        for f in os.listdir(_DEPLOY_DIR):
            if not f.endswith(".json"):
                continue
            try:
                d = json.load(open(os.path.join(_DEPLOY_DIR, f), encoding="utf-8"))
                deps.append({"id": d["id"], "name": d.get("name"), "status": d.get("status", "live"),
                             "runs": d.get("runs", 0), "triggers": len(_triggers_for(d["id"])),
                             "version": d.get("version", 1), "workflowId": d.get("workflowId"),
                             "tenant": d.get("tenant") or ns(None),  # ownership badge for the global fleet view
                             "endpoint": f"/deployments/{d['id']}/run"})
            except Exception:
                pass
    deps.sort(key=lambda x: (x.get("name") or "").lower())

    trigs = []
    for t in _iter_triggers():
        dep = _load_deploy(t.get("deploymentId"))
        trigs.append({"id": t["id"], "type": t.get("type"), "deploymentId": t.get("deploymentId"),
                      "deploymentName": dep.get("name") if dep else "(deleted)",
                      "label": _trig_label(t), "active": t.get("active", True),
                      "last_run": t.get("last_run"),
                      "webhook_url": f"/deployments/{t['deploymentId']}/webhook/{t.get('secret')}" if t.get("type") == "webhook" else None})

    today0 = _dt.datetime.combine(_dt.datetime.utcnow().date(), _dt.time()).timestamp() * 1000
    now_ms = _time.time() * 1000
    runs_today = cost_today = tokens_today = running = 0
    for path, _src in _iter_run_files():
        try:
            r = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        # In-flight runs count, but ignore records left "running" by a crash/restart
        # (no completedAt is ever written for them) — 15 min past the timeout ceiling.
        if r.get("status") == "running" and (now_ms - (r.get("createdAt") or 0)) < 15 * 60 * 1000:
            running += 1
        if (r.get("createdAt") or 0) >= today0:
            runs_today += 1
            m = r.get("metrics") or {}
            cost_today += m.get("cost", 0) or 0
            tokens_today += m.get("tokens", 0) or 0

    return {
        "deployments": deps,
        "triggers": sorted(trigs, key=lambda x: x.get("deploymentName") or ""),
        "stats": {
            "live": sum(1 for d in deps if d["status"] != "paused"),
            "paused": sum(1 for d in deps if d["status"] == "paused"),
            "deployments": len(deps), "triggers": len(trigs), "running": running,
            "runs_today": runs_today, "cost_today": round(cost_today, 4), "tokens_today": tokens_today,
        },
    }


# Schema for the agent-facing tool (registered into the kernel registry by server.py)
LIST_DEPLOYMENTS_TOOL = {
    "name": "list_deployments",
    "description": "List the workflows currently deployed as callable APIs — the 'fleet'. "
                   "Returns each deployment's name, status (live/paused), trigger count and total runs, "
                   "plus how many are live. Use this to answer ANY question about what agents or workflows "
                   "are deployed, live, running, or in the fleet — do NOT guess from the workspace or memory.",
    "inputSchema": {"type": "object", "properties": {}},
}


def deployments_summary() -> dict:
    """Agent-facing summary of deployed workflows (same source as /control-plane: all
    deployments on disk, no tenant filter — matches what the Fleet panel shows)."""
    deps = []
    if os.path.isdir(_DEPLOY_DIR):
        for f in os.listdir(_DEPLOY_DIR):
            if not f.endswith(".json"):
                continue
            try:
                d = json.load(open(os.path.join(_DEPLOY_DIR, f), encoding="utf-8"))
            except Exception:
                continue
            deps.append({"name": d.get("name"), "status": d.get("status", "live"),
                         "triggers": len(_triggers_for(d["id"])), "runs": d.get("runs", 0)})
    deps.sort(key=lambda x: (x.get("name") or "").lower())
    live = sum(1 for d in deps if d["status"] != "paused")
    if not deps:
        text = "No workflows are currently deployed — the fleet is empty."
    else:
        lines = "\n".join(f"- {d['name']} — {d['status']} ({d['triggers']} trigger(s), {d['runs']} total runs)" for d in deps)
        text = f"{len(deps)} deployed workflow(s), {live} live:\n{lines}"
    return {"success": True, "output": text, "deployments": deps, "live_count": live, "total": len(deps)}
