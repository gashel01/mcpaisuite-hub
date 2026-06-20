"""Fleet agent tools, agent builder/architect endpoints and scheduled taskforce."""
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
import shutil
from routes.workflows import list_runs
from routes.agents import create_taskforce

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


import secrets as _secrets
import time as _time

_WORKFLOWS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "workflows")

# Deployment/trigger helpers live in routes.deployments (one-directional import; the
# reverse calls to _execute_deployment in deployments.py use a lazy local import).
from routes.deployments import (
    _DEPLOY_DIR, _deploy_path, _load_deploy, _save_deploy, _trigger_path,
    _triggers_for, deployments_summary, control_plane, deployment_metrics,
    LIST_DEPLOYMENTS_TOOL,
)

# ── Fleet agent tools — monitor + control the deployment fleet from chat ─────────
# Monitoring tools are free. Control tools require an explicit `confirm=true` and
# destructive ones a type-to-confirm of the exact name — the action cannot fire
# without it, so the agent must come back to the user first.
FLEET_TOOL_SCHEMAS = [
    LIST_DEPLOYMENTS_TOOL,
    {"name": "fleet_status", "description": "Aggregate health of the whole fleet: how many deployments are live vs paused, how many runs are in-flight right now, runs today, and total cost today. Use for 'how's the fleet doing?' type questions.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "deployment_metrics", "description": "Performance metrics for ONE deployment from its run history: success rate, total/average tokens & cost, latency p50/p95, and recent failure counts. Identify the deployment by its name or id.",
     "inputSchema": {"type": "object", "properties": {"deployment": {"type": "string", "description": "Deployment name or id"}}, "required": ["deployment"]}},
    {"name": "list_executions", "description": "Recent executions (runs) across the fleet — newest first. Optionally filter by deployment name/id, by status (completed/failed/running), and limit the count. Use for 'show me recent runs', 'what failed lately?'.",
     "inputSchema": {"type": "object", "properties": {"deployment": {"type": "string"}, "status": {"type": "string", "enum": ["completed", "failed", "running"]}, "limit": {"type": "integer"}}}},
    {"name": "set_deployment_status", "description": "Take a deployment offline (status='paused') or back online (status='live'). STATEFUL ACTION ON PRODUCTION: first ask the user to confirm with ask_user, then call again with confirm=true. Without confirm=true this tool does nothing.",
     "inputSchema": {"type": "object", "properties": {"deployment": {"type": "string"}, "status": {"type": "string", "enum": ["live", "paused"]}, "confirm": {"type": "boolean"}}, "required": ["deployment", "status"]}},
    {"name": "run_deployment", "description": "Trigger a one-off run of a deployment (owner test run — consumes tokens/cost). First confirm with the user via ask_user, then call with confirm=true. Without confirm=true it does nothing.",
     "inputSchema": {"type": "object", "properties": {"deployment": {"type": "string"}, "inputs": {"type": "object"}, "confirm": {"type": "boolean"}}, "required": ["deployment"]}},
    {"name": "rotate_deployment_token", "description": "Issue a new bearer token for a deployment and invalidate the old one — this BREAKS existing API clients. This tool prompts the user for confirmation in the UI itself and waits for their answer — do NOT call ask_user yourself first; just call this tool with the deployment, and it handles the human approval.",
     "inputSchema": {"type": "object", "properties": {"deployment": {"type": "string"}, "confirm": {"type": "boolean", "description": "Fallback only for non-interactive contexts; ignored when the UI confirmation is available"}}, "required": ["deployment"]}},
    {"name": "delete_deployment", "description": "Permanently delete a deployment and its run history + triggers. DESTRUCTIVE AND IRREVERSIBLE. This tool prompts the user in the UI to type the deployment's exact name to confirm, and waits — do NOT call ask_user yourself first; just call this tool with the deployment name and it handles the human gate.",
     "inputSchema": {"type": "object", "properties": {"deployment": {"type": "string"}, "confirm_name": {"type": "string", "description": "Fallback only for non-interactive contexts; ignored when the UI confirmation is available"}}, "required": ["deployment"]}},
]
FLEET_TOOL_NAMES = {t["name"] for t in FLEET_TOOL_SCHEMAS}


def _resolve_dep(ref: str):
    """Find a deployment by id or (case-insensitive) name."""
    if not ref:
        return None
    direct = _load_deploy(ref)
    if direct:
        return direct
    rl = ref.strip().lower()
    if os.path.isdir(_DEPLOY_DIR):
        for f in os.listdir(_DEPLOY_DIR):
            if not f.endswith(".json"):
                continue
            try:
                d = json.load(open(os.path.join(_DEPLOY_DIR, f), encoding="utf-8"))
            except Exception:
                continue
            if (d.get("name") or "").strip().lower() == rl:
                return d
    return None


def _affirmative(s: str) -> bool:
    return (s or "").strip().lower() in ("yes", "y", "oui", "ok", "okay", "go", "sure", "proceed", "confirm", "confirmed", "do it", "approve", "approved")


async def run_fleet_tool(name: str, args: dict, ask_fn=None) -> dict:
    """Single dispatch for all fleet agent tools. Returns {success, output, ...}.

    `ask_fn` (when provided by an interactive chat) is the engine's real UI
    elicitation: destructive ops call it to pause the task and require a genuine
    human 'yes' in the UI — the agent cannot self-approve. When it's None
    (API/scheduled context) destructive ops fall back to the confirm-arg gate."""
    args = args or {}

    if name == "list_deployments":
        return deployments_summary()

    if name == "fleet_status":
        cp = await control_plane()
        s = cp.get("stats", {})
        text = (f"Fleet: {s.get('live', 0)} live, {s.get('paused', 0)} paused "
                f"({s.get('deployments', 0)} total), {s.get('running', 0)} run(s) in-flight now, "
                f"{s.get('triggers', 0)} trigger(s). Today: {s.get('runs_today', 0)} runs, "
                f"${s.get('cost_today', 0):.4f} cost.")
        return {"success": True, "output": text, "stats": s}

    if name == "deployment_metrics":
        dep = _resolve_dep(args.get("deployment", ""))
        if not dep:
            return {"success": False, "output": f"No deployment found matching '{args.get('deployment')}'."}
        m = await deployment_metrics(dep["id"], dep.get("tenant", ""))
        sr = m.get("successRate")
        text = (f"Metrics for '{dep.get('name')}': {m['totalCalls']} calls, "
                f"success rate {round(sr * 100) if sr is not None else 'n/a'}% "
                f"({m['byStatus']['completed']} ok / {m['byStatus']['failed']} failed). "
                f"Tokens {m['totals']['tokens']} (avg {m['avg']['tokens']}), cost ${m['totals']['cost']:.4f}. "
                f"Latency p50 {m['latency']['p50']}ms / p95 {m['latency']['p95']}ms.")
        return {"success": True, "output": text, "metrics": m}

    if name == "list_executions":
        res = await list_runs(status=args.get("status", "") or "", limit=int(args.get("limit", 10) or 10))
        runs = res.get("runs", [])
        ref = (args.get("deployment") or "").strip().lower()
        if ref:
            runs = [r for r in runs if ref in (str(r.get("label") or "").lower())]
        if not runs:
            return {"success": True, "output": "No matching executions found.", "runs": []}
        lines = "\n".join(f"- {r.get('label')} — {r.get('status')} ({(r.get('metrics') or {}).get('tokens', 0)} tok)"
                          f"{' · ' + (r.get('answerPreview') or '')[:60] if r.get('answerPreview') else ''}" for r in runs[:10])
        return {"success": True, "output": f"{len(runs)} recent execution(s):\n{lines}", "runs": runs[:10]}

    if name == "set_deployment_status":
        dep = _resolve_dep(args.get("deployment", ""))
        if not dep:
            return {"success": False, "output": f"No deployment found matching '{args.get('deployment')}'."}
        new_status = args.get("status")
        if new_status not in ("live", "paused"):
            return {"success": False, "output": "status must be 'live' or 'paused'."}
        if not args.get("confirm"):
            return {"success": False, "output": f"CONFIRMATION REQUIRED to set '{dep.get('name')}' to {new_status}. Ask the user to confirm, then call again with confirm=true."}
        dep["status"] = new_status
        _save_deploy(dep)
        return {"success": True, "output": f"'{dep.get('name')}' is now {new_status}."}

    if name == "run_deployment":
        dep = _resolve_dep(args.get("deployment", ""))
        if not dep:
            return {"success": False, "output": f"No deployment found matching '{args.get('deployment')}'."}
        if not args.get("confirm"):
            return {"success": False, "output": f"CONFIRMATION REQUIRED to run '{dep.get('name')}' (consumes tokens/cost). Ask the user to confirm, then call again with confirm=true."}
        result = await _execute_deployment(dep, args.get("inputs") or {}, True, 280, "test")
        ok = result.get("success") is not False
        out = (result.get("final_output") or result.get("error") or "")[:300]
        return {"success": ok, "output": f"Ran '{dep.get('name')}' — {'ok' if ok else 'failed'}: {out}"}

    if name == "rotate_deployment_token":
        dep = _resolve_dep(args.get("deployment", ""))
        if not dep:
            return {"success": False, "output": f"No deployment found matching '{args.get('deployment')}'."}
        if ask_fn is not None:
            reply = await ask_fn(f"⚠️ Rotate the bearer token for deployment '{dep.get('name')}'? This immediately invalidates the current token and BREAKS any client using it. Reply 'yes' to proceed.")
            if not _affirmative(reply):
                return {"success": False, "output": f"Token rotation cancelled — the user declined ({reply!r})."}
        elif not args.get("confirm"):
            return {"success": False, "output": f"CONFIRMATION REQUIRED to rotate '{dep.get('name')}' token (this breaks existing clients). Get explicit user approval, then call with confirm=true."}
        new_token = "kmcp_" + _secrets.token_urlsafe(24)
        dep["token"] = new_token
        _save_deploy(dep)
        return {"success": True, "output": f"Rotated token for '{dep.get('name')}'. New token: {new_token} (the old one is now invalid)."}

    if name == "delete_deployment":
        dep = _resolve_dep(args.get("deployment", ""))
        if not dep:
            return {"success": False, "output": f"No deployment found matching '{args.get('deployment')}'."}
        if ask_fn is not None:
            # Real UI gate: pause the task and require the human to type the exact name.
            reply = await ask_fn(f"⚠️ PERMANENTLY delete deployment '{dep.get('name')}' and all its run history + triggers? This cannot be undone. To confirm, reply with its exact name: {dep.get('name')}")
            if (reply or "").strip() != (dep.get("name") or "").strip():
                return {"success": False, "output": f"Deletion cancelled — the confirmation did not match the deployment name ({reply!r})."}
        elif (args.get("confirm_name") or "").strip() != (dep.get("name") or "").strip():
            return {"success": False, "output": f"DELETE REFUSED. To permanently delete this deployment, get the user's approval and pass confirm_name set to its EXACT name: '{dep.get('name')}'."}
        await delete_deployment(dep["id"])
        return {"success": True, "output": f"Permanently deleted deployment '{dep.get('name')}' and its history + triggers."}

    return {"success": False, "output": f"Unknown fleet tool: {name}"}


@router.delete("/deployments/{did}")
async def delete_deployment(did: str):
    p = _deploy_path(did)
    rdir = os.path.join(_DEPLOY_DIR, did)
    found = os.path.isfile(p)
    if found:
        os.remove(p)
    # Clean the deployment's run-history dir so it stops showing in /executions
    if os.path.isdir(rdir):
        shutil.rmtree(rdir, ignore_errors=True)
    # Cascade: remove its triggers (separate store) so none are left orphaned
    for t in _triggers_for(did):
        try:
            os.remove(_trigger_path(t["id"]))
        except Exception:
            pass
    if found:
        return {"deleted": did}
    raise HTTPException(404, "deployment not found")


async def _execute_deployment(dep: dict, inputs: dict, blocking: bool, timeout: int, source: str) -> dict:
    """Shared run path for a deployment: substitute {placeholders}, execute via the
    taskforce runner, and log the call into the deployment's run history. `source` is
    "api" for public bearer-token calls or "test" for owner test-runs from the UI."""
    did = dep["id"]
    import re as _re

    def subst(t):
        return _re.sub(r"\{([a-zA-Z0-9_]+)\}", lambda m: str(inputs.get(m.group(1), m.group(0))), str(t or ""))

    cfg = json.loads(json.dumps(dep["config"]))  # deep copy
    cfg["goal"] = subst(cfg.get("goal", ""))
    cfg["agents"] = [
        {**a, **({"instructions": subst(a["instructions"])} if a.get("instructions") else {})}
        for a in cfg.get("agents", [])
    ]
    if (cfg.get("graph") or {}).get("nodes"):
        for n in cfg["graph"]["nodes"]:
            d = n.get("data") or {}
            if d.get("instructions"):
                d["instructions"] = subst(d["instructions"])
                n["data"] = d
    cfg["blocking"] = blocking
    cfg["timeout"] = timeout

    dep["runs"] = dep.get("runs", 0) + 1
    _save_deploy(dep)

    started = _time.time()
    rdir = os.path.join(_DEPLOY_DIR, did, "runs")
    created = int(started * 1000)
    rid = f"drun-{created}"

    def _log(run_status: str, res: dict | None = None, run_err=None) -> None:
        """Write/overwrite this run's record. Called once with 'running' at start
        (so in-flight calls show in the control-plane) and once with the final
        status — same rid means the file is overwritten, never double-counted."""
        try:
            os.makedirs(rdir, exist_ok=True)
            res = res or {}
            _json.dump({
                "id": rid, "deploymentId": did, "deploymentName": dep.get("name"),
                "source": source, "status": run_status, "inputs": inputs, "error": run_err,
                "taskId": res.get("task_id"),
                "answer": res.get("final_output"),
                "metrics": {"tokens": res.get("total_tokens", 0), "cost": res.get("total_cost", 0),
                            "turns": res.get("total_turns", 0),
                            "duration": res.get("duration_ms", int((_time.time() - started) * 1000))},
                "createdAt": created,
                "completedAt": None if run_status == "running" else int(_time.time() * 1000),
            }, open(os.path.join(rdir, f"{rid}.json"), "w"))
        except Exception:
            pass

    _log("running")
    result, status, err = {}, "completed", None
    try:
        result = await create_taskforce(cfg, x_tenant_id=dep.get("tenant", "")) or {}
        # Tag the underlying kernel task so it's identifiable as a deployment run in
        # Observability's Recent Tasks (rocket badge + deployment name).
        tid = result.get("task_id")
        if tid and kernel is not None:
            kt = kernel._tasks.get(tid)
            if kt is not None:
                if not isinstance(kt.metadata, dict):
                    kt.metadata = {}
                kt.metadata["deployment_id"] = did
                kt.metadata["deployment_name"] = dep.get("name")
                try:
                    _persist_task(kt)
                except Exception:
                    pass
        if result.get("success") is False:
            status = "failed"
            err = result.get("error")
    except Exception as exc:
        status = "failed"
        err = str(exc)
        result = {"success": False, "final_output": "", "error": err}
    finally:
        _log(status, result, err)
    return result


@router.post("/deployments/{did}/run")
async def run_deployment(did: str, body: dict, authorization: str = Header(default="")):
    """Public callable API for a deployed workflow.
    Auth: `Authorization: Bearer <token>`. Body: {"inputs": {...}, "blocking": true}.
    {placeholders} in the workflow are filled from `inputs`; returns the run result."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    token = authorization.replace("Bearer", "").strip()
    if not token or token != dep.get("token"):
        raise HTTPException(401, "invalid or missing bearer token")
    if dep.get("status") == "paused":
        raise HTTPException(503, "deployment is paused (taken offline by the owner)")
    return await _execute_deployment(dep, body.get("inputs") or {},
                                     body.get("blocking", True), body.get("timeout", 280), "api")


@router.post("/deployments/{did}/test")
async def test_deployment(did: str, body: dict, x_tenant_id: str = Header(default="")):
    """Owner test-run from the UI — authenticated by tenant ownership instead of the
    public bearer token, so the owner can try a deployment without re-pasting its token."""
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    if x_tenant_id != dep.get("tenant", ""):
        raise HTTPException(403, "not the owner of this deployment")
    return await _execute_deployment(dep, body.get("inputs") or {},
                                     body.get("blocking", True), body.get("timeout", 280), "test")


@router.get("/agents/taskforce/schedules")
async def list_taskforce_schedules():
    schedules = []
    for fname in sorted(os.listdir(_SCHEDULES_DIR), reverse=True):
        if fname.endswith(".json"):
            try:
                with open(os.path.join(_SCHEDULES_DIR, fname)) as f:
                    import json as _json2; schedules.append(_json2.load(f))
            except Exception:
                pass
    return {"schedules": schedules}

@router.delete("/agents/taskforce/schedules/{sched_id}")
async def delete_taskforce_schedule(sched_id: str):
    path = os.path.join(_SCHEDULES_DIR, f"{sched_id}.json")
    if os.path.exists(path):
        os.remove(path)
    return {"deleted": True, "id": sched_id}

@router.get("/agents/taskforce/{task_id}")
async def get_taskforce_result(task_id: str, x_tenant_id: str = Header(default="")):
    """Get taskforce result by task_id (after SSE signals completion)."""
    k = _require()
    task = k._tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return {
        "task_id": task_id,
        "status": task.status.value,
        "result": task.metadata.get("result"),
        "dry_run": task.metadata.get("dry_run", False),
        "dry_run_calls": task.metadata.get("dry_run_calls", []),
    }


@router.get("/tasks/{task_id}/spans")
async def get_task_spans(task_id: str, x_tenant_id: str = Header(default="")):
    """Get nested trace spans for a task — used by the waterfall visualization."""
    k = _require()
    ns = x_tenant_id or "demo"
    # Search in all tasks (including sub-namespace runs)
    task = k._tasks.get(task_id)
    if not task:
        for tid, t in k._tasks.items():
            if tid == task_id or (t.namespace.startswith(ns) and tid == task_id):
                task = t
                break
    if not task:
        raise HTTPException(404, "Task not found")

    def _serialize_span(s) -> dict:
        return {
            "id": s.id,
            "parent_id": s.parent_id,
            "trace_id": s.trace_id,
            "name": s.name,
            "type": s.type.value if hasattr(s.type, "value") else str(s.type),
            "start_time": s.start_time,
            "end_time": s.end_time,
            "duration_ms": s.duration_ms,
            "status": s.status.value if hasattr(s.status, "value") else str(s.status),
            "input": s.input,
            "output": s.output,
            "metadata": s.metadata,
            "error": s.error,
            "children": [_serialize_span(c) for c in s.children],
        }

    spans = [_serialize_span(s) for s in (task.spans or [])]
    return {
        "task_id": task_id,
        "trace_id": task.id,
        "spans": spans,
        "total_spans": len(task.spans or []),
    }


@router.get("/tasks/{task_id}/replay")
async def get_task_replay(task_id: str, x_tenant_id: str = Header(default="")):
    """Time-travel: per-step timeline + accumulated state at each turn.

    Reuses kernelmcp's ReplayEngine so the step/state logic lives in one place.
    Spans are served separately (/spans powers the waterfall), so a no-op tracer
    is injected here — the timeline is turn-based, which is what the scrubber needs.
    """
    k = _require()
    task = k._tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    from kernelmcp.observability.replay import ReplayEngine

    class _NoSpanTracer:
        def get_trace(self, _tid):
            return []

    engine = ReplayEngine(audit_logger=None, tracer=_NoSpanTracer())
    engine.register_task(task)
    timeline = engine.get_timeline(task_id)
    states = [engine.get_state_at(task_id, i) for i in range(len(task.turns))]
    return {
        "task_id": task_id,
        "goal": task.goal,
        "total_turns": len(task.turns),
        "timeline": timeline,
        "states": states,
    }


@router.get("/tasks/{task_id}/workspaces")
async def get_task_workspaces(task_id: str):
    """Workspace namespaces a run produced — powers the contextual 'View workspace' link in
    Observability so isolated/named run workspaces are reachable WITHOUT exposing them in the
    global tenant dropdown.

    A TaskForce/deployment run executes under `{base}__run_{id}` (see call_tool/run_taskforce).
    Its node workspaces are created by the graph executor as:
      - isolated:   `{run_ns}__ws_{node8}`   (unique per run+node, invisible from the main tenant)
      - persistent: `{base}__ws_{name}`      (named, shared across runs)
    'user'-mode files go straight to the base tenant and are already visible on the Workspace
    page, so they are intentionally NOT listed here.
    """
    k = _require()
    task = k._tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    run_ns = task.namespace or ""
    base = run_ns.split("__run_")[0] if "__run_" in run_ns else run_ns
    ws = getattr(getattr(getattr(k, "_engine", None), "_orchestrator", None), "workspace", None)
    tenants = ws.list_tenants() if ws and hasattr(ws, "list_tenants") else []
    seen: set[str] = set()
    out: list[dict] = []
    for t in tenants:
        if t in seen:
            continue
        kind = None
        if "__run_" in run_ns and t == run_ns:
            kind = "run"            # the run's own scratch namespace
        elif "__run_" in run_ns and t.startswith(run_ns + "__ws_"):
            kind = "isolated"       # per-node isolated workspace
        elif t != base and t.startswith(base + "__ws_"):
            kind = "persistent"     # named workspace shared across runs
        if kind:
            seen.add(t)
            out.append({"namespace": t, "kind": kind,
                        "label": t.split("__ws_")[-1] if "__ws_" in t else "run scratch"})
    out.sort(key=lambda w: {"run": 0, "isolated": 1, "persistent": 2}.get(w["kind"], 3))
    return {"task_id": task_id, "base": base, "run_namespace": run_ns, "workspaces": out}


@router.get("/agents/classify")
async def classify_task(goal: str = Query(...)):
    return {"goal": goal, "agent_type": _require().classify_task(goal)}


def _architect_context(k):
    """Gather the system context (capabilities, tools, model, past runs) the agent
    architect needs. Shared by /agents/suggest, /agents/build, /agents/architect.
    Returns (context_str, model, tool_registry, native_tools, mcp_tools, lc_tools)."""
    orch = k._engine._orchestrator
    tool_registry = orch.get_tool_registry()
    native_tools = sorted({t["name"] for t in tool_registry if not t["name"].startswith("lc__") and not t["name"].startswith("mcp__")})
    mcp_tools = sorted({t["name"] for t in tool_registry if t["name"].startswith("mcp__")})
    lc_tools = sorted({t["name"] for t in tool_registry if t["name"].startswith("lc__")})

    has_web = any(t in native_tools for t in ("web_search", "fetch_webpage"))
    has_code = any(t in native_tools for t in ("execute_code", "validate_code"))
    has_files = any(t in native_tools for t in ("write_file", "read_file"))
    has_git = any("github" in t or "git" in t for t in mcp_tools)
    has_memory = any(t in native_tools for t in ("store_fact", "query_memory"))
    has_rag = any(t in native_tools for t in ("search_documents", "ingest_document"))
    has_host = "host_exec" in native_tools

    capabilities = []
    if has_web: capabilities.append("web_search + fetch_webpage (can research online)")
    if has_code: capabilities.append("execute_code in Docker sandbox (Python, Node, shell)")
    if has_files: capabilities.append("write_file, read_file, edit_file (workspace management)")
    if has_host: capabilities.append("host_exec (run commands on host: docker, git, etc.)")
    if has_git: capabilities.append(f"GitHub MCP tools: {', '.join(mcp_tools[:5])}")
    if has_memory: capabilities.append("store_fact, query_memory (persistent memory)")
    if has_rag: capabilities.append("search_documents, ingest_document (RAG knowledge base)")
    if lc_tools: capabilities.append(f"LangChain tools: {', '.join(lc_tools[:5])}")
    if mcp_tools and not has_git: capabilities.append(f"MCP tools: {', '.join(mcp_tools[:5])}")

    model = k._engine._llm._model or "unknown"

    past_examples = ""
    try:
        from task_store import load_all_tasks
        past_tasks = load_all_tasks()
        successful = []
        for t in past_tasks.values():
            if t.status.value != "completed":
                continue
            meta = t.metadata or {}
            result = meta.get("result", {})
            if not isinstance(result, dict):
                continue
            pattern = result.get("pattern", "")
            agents_used = result.get("agents", [])
            if pattern and agents_used:
                successful.append({
                    "goal": (meta.get("original_message") or t.goal or "")[:100],
                    "pattern": pattern,
                    "agents": len(agents_used) if isinstance(agents_used, list) else 0,
                    "cost": round(t.total_cost, 4),
                    "duration_s": round(t.duration_ms / 1000, 1) if t.duration_ms else 0,
                    "tokens": t.total_tokens,
                })
        if successful:
            successful = successful[-5:]
            lines = [f'  - Goal: "{s["goal"]}" -> pattern={s["pattern"]}, {s["agents"]} agents, ${s["cost"]}, {s["duration_s"]}s' for s in successful]
            past_examples = "\n\nPAST SUCCESSFUL RUNS (learn from these):\n" + "\n".join(lines)
    except Exception:
        pass

    saved_workflows = ""
    try:
        import os as _os
        wf_dir = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)), "data", "workflows")
        if _os.path.isdir(wf_dir):
            wf_names = []
            for wf_id in _os.listdir(wf_dir)[:10]:
                meta_path = _os.path.join(wf_dir, wf_id, "meta.json")
                if _os.path.isfile(meta_path):
                    import json as _jj
                    wf_meta = _jj.load(open(meta_path))
                    wf_names.append(wf_meta.get("name", wf_id))
            if wf_names:
                saved_workflows = f"\n\nSAVED WORKFLOWS (user can reuse these instead): {', '.join(wf_names)}"
    except Exception:
        pass

    model_note = ""
    ml = model.lower()
    if any(x in ml for x in ("haiku", "mini", "flash", "8b", "small")):
        model_note = "\nNOTE: Small/fast model. Keep agent count low (2-3), max_turns low (2-3). Prefer sequential over swarm."
    elif any(x in ml for x in ("sonnet", "gpt-4o", "70b", "large")):
        model_note = "\nNOTE: Capable model. Can handle 3-5 agents with moderate turns."
    elif any(x in ml for x in ("opus", "gpt-4", "405b")):
        model_note = "\nNOTE: Top-tier model. Can handle complex swarm/debate with 4-6 agents."

    context = f"""
AVAILABLE CAPABILITIES ON THIS SYSTEM:
{chr(10).join(f'- {c}' for c in capabilities) if capabilities else '- Basic tools only'}

CURRENT MODEL: {model}{model_note}

TOTAL TOOLS: {len(tool_registry)} ({len(native_tools)} native, {len(mcp_tools)} MCP, {len(lc_tools)} LangChain)
{past_examples}{saved_workflows}
"""
    return context, model, tool_registry, native_tools, mcp_tools, lc_tools


@router.post("/agents/suggest")
async def suggest_agents(body: dict):
    """Use LLM to suggest the best agent team for a goal, taking into account available tools and settings."""
    k = _require()
    goal = body.get("goal", "")
    if not goal.strip():
        raise HTTPException(400, "goal is required")

    context, model, tool_registry, native_tools, mcp_tools, lc_tools = _architect_context(k)

    try:
        llm = k._engine._llm
        resp = await llm.complete(
            system=f"""You are an AI agent architect for the MCP AI Suite platform. Given a goal and the available system capabilities, suggest the optimal agent team.

{context}

RULES:
- ONLY suggest capabilities that are actually available (listed above)
- If the goal needs GitHub and GitHub MCP is not connected, say so in a "missing" field
- For code tasks: use type "code" (has execute_code, write_file)
- For research tasks: use type "research" (has web_search, fetch_webpage)
- For file management: use type "file" (has read_file, write_file, host_file_read)
- For custom roles: use type "custom" and specify exact tools in the "tools" array
- Each custom agent can have a "tools" array listing specific tool names
- Pattern guide:
  - "sequential": step-by-step pipeline (A→B→C). Best for: research→code→test flows.
  - "parallel": independent tasks run simultaneously. Best for: multi-topic research, comparisons.
  - "supervisor": one agent reviews others' work. Best for: quality-critical tasks.
  - "debate": agents argue then a judge decides. Best for: analysis, decision-making.
  - "swarm": all agents collaborate with feedback loops. Best for: complex creative/iterative tasks. WARNING: expensive, use only with capable models.
- Keep it minimal — fewer agents = faster + cheaper
- Estimate the total cost and duration

EXAMPLES OF GOOD CONFIGURATIONS:
- "Research X and build a Python wrapper" → sequential: researcher(2 turns) → coder(3 turns) → tester(2 turns). ~$0.10-0.20
- "Compare 3 frameworks" → parallel: 3 researchers(2 turns each). ~$0.05-0.10
- "Should we use X or Y?" → debate: advocate_X(2) + advocate_Y(2) + judge(1). ~$0.08
- "Build, test and deploy" → sequential: coder(3) → qa_engineer(2) → deployer(2). ~$0.15-0.25

Respond in this exact JSON format (no markdown, no explanation):
{{
  "pattern": "sequential|parallel|supervisor|debate|swarm",
  "agents": [
    {{"type": "code|research|file|memory|plan|rag|custom", "role": "descriptive role name", "instructions": "specific actionable instructions for this agent", "max_turns": 3, "tools": ["optional", "specific", "tools"]}}
  ],
  "estimated_cost": "$0.XX",
  "estimated_duration": "XXs",
  "reasoning": "one sentence explaining why this pattern",
  "missing": ["optional list of capabilities needed but not available"]
}}""",
            messages=[{"role": "user", "content": f"Goal: {goal}"}],
            tools=[],
        )
        import json as _j
        text = resp.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1].strip()
            if text.startswith("json"):
                text = text[4:].strip()
        suggestion = _j.loads(text)
        # Add metadata
        suggestion["_meta"] = {
            "model": model,
            "total_tools": len(tool_registry),
            "mcp_servers": len({t["name"].split("__")[1] for t in tool_registry if t["name"].startswith("mcp__") and "__" in t["name"][4:]}),
            "lc_tools": len(lc_tools),
        }
        return suggestion
    except Exception as exc:
        raise HTTPException(500, f"Suggestion failed: {exc}")


@router.post("/agents/build")
async def build_team_stream(body: dict):
    """Chat-to-build (spike): stream a narrated team build for a goal.

    Reuses /agents/suggest for the architecture, then streams narration + one event per
    agent so the client can pop nodes onto the canvas as the 'build' is described — the
    same feel as a conversational agent builder, on top of the existing suggest brain.
    Event types: step (narration line), agent (add this agent), done (pattern + estimates),
    error.
    """
    _require()
    goal = (body.get("goal") or "").strip()
    if not goal:
        raise HTTPException(400, "goal is required")

    async def gen():
        def sse(ev: dict) -> str:
            return f"data: {json.dumps(ev)}\n\n"

        try:
            yield sse({"type": "step", "text": "Reading your goal and the tools available here…"})
            await asyncio.sleep(0.4)

            suggestion = await suggest_agents({"goal": goal})
            pattern = suggestion.get("pattern", "sequential")
            agents = suggestion.get("agents", []) or []
            reasoning = (suggestion.get("reasoning") or "").strip()
            missing = suggestion.get("missing") or []

            if reasoning:
                yield sse({"type": "step", "text": reasoning})
                await asyncio.sleep(0.5)

            n = len(agents)
            yield sse({"type": "step", "text": f"Going with a {pattern} workflow — {n} agent{'s' if n != 1 else ''}."})
            await asyncio.sleep(0.4)

            for a in agents:
                role = a.get("role") or a.get("type") or "agent"
                tools = a.get("tools") or []
                tdesc = f" using {', '.join(tools[:3])}" if tools else ""
                yield sse({"type": "step", "text": f"➕ Adding {role}{tdesc}…"})
                yield sse({"type": "agent", "pattern": pattern, "agent": a})
                await asyncio.sleep(0.55)

            if missing:
                yield sse({"type": "step", "text": "⚠ You'll need to connect: " + ", ".join(missing)})
                await asyncio.sleep(0.3)

            cost = suggestion.get("estimated_cost", "")
            dur = suggestion.get("estimated_duration", "")
            tail = " · ".join([x for x in [f"~{cost}" if cost else "", dur] if x])
            yield sse({"type": "step", "text": f"✓ Team ready{(' — ' + tail) if tail else ''}. Review it and hit Run."})
            yield sse({"type": "done", "pattern": pattern, "reasoning": reasoning,
                       "estimated_cost": cost, "estimated_duration": dur, "missing": missing})
        except HTTPException as exc:
            yield sse({"type": "error", "message": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "error", "message": str(exc)[:200]})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@router.post("/agents/architect")
async def architect_stream(body: dict):
    """Conversational chat-to-build. The architect thinks out loud (token-streamed
    narration), then emits the FULL desired team after a ===TEAM=== marker. Handles both
    initial build and refinement ("add a tester", "make it parallel") — it always returns
    the complete updated team, which the client diffs onto the canvas.

    Body: {message, current?: {pattern, agents}, history?: [{role, content}]}.
    Events: narration (text delta), team (pattern+agents+estimates+missing), done, error.
    """
    k = _require()
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "message is required")
    current = body.get("current") or {}
    history = body.get("history") or []

    context, model, *_ = _architect_context(k)
    llm = k._engine._llm

    cur_agents = current.get("agents") or []
    if cur_agents:
        current_json = json.dumps({
            "pattern": current.get("pattern", "sequential"),
            "trigger": current.get("trigger") or {"type": "manual"},
            "agents": cur_agents,
            "human_gates": current.get("human_gates") or [],
            "workspace": current.get("workspace") or {"enabled": False},
        }, indent=2)
    else:
        current_json = "(none yet — you're starting fresh)"

    MARKER = "===TEAM==="
    system = f"""You are the agent architect for the MCP AI Suite — a sharp, friendly designer of multi-agent teams who works conversationally.

{context}

You are MID-CONVERSATION with the user. They may ask you to build a new team or REFINE the current one.

CURRENT TEAM (refine THIS; if empty you're starting fresh):
{current_json}

You design a WORKFLOW GRAPH on a canvas. Building blocks you control:

PATTERNS (how agents relate — AGENT ORDER MATTERS): sequential (pipeline A→B→C). parallel (independent, simultaneous, results compared). supervisor (the FIRST agent reviews/coordinates the others — put the supervisor first). debate (the LAST agent is the JUDGE who reads the others' independent findings and merges/decides — put the judge last; the others are the debaters). swarm (collaborate with feedback loops — powerful but expensive).

AGENT TYPES: code (execute_code, write_file), research (web_search, fetch_webpage), file (read/write files), memory (store/query facts), plan, rag (knowledge base), ltp (compile-once deterministic plan — cheap + reliable for fixed multi-step procedures), custom (you name the exact tools).

TRIGGER (how the workflow STARTS — this is a node you set, do NOT say you 'lack a scheduler'):
- manual: user clicks Run (default).
- cron: recurring on a cron expression — e.g. every hour = "0 * * * *", daily 9am = "0 9 * * *".
- interval: recurring every N seconds — e.g. every hour = 3600.
- scheduled: one-shot at a specific date/time.
- watch: re-run when a shell command's output meets a condition.
- webhook: run when an HTTP endpoint is hit.
→ If the user wants recurring/automated/"every X" work, SET the trigger (cron or interval). The platform's scheduler runs it — you do NOT need a separate scheduler agent for the timing.

HUMAN GATES: list agent indices (0-based) that should pause for human review/approval after they finish.
WORKSPACE: a shared file area across agents — enable it when agents must pass files between steps.

HOW TO REPLY — two parts, in this exact order:
1) Talk to the user like a real architect pairing with them: what you understood, what you're choosing and WHY (incl. the trigger if it's not manual), and honestly flag anything genuinely missing (e.g. an alerting channel that isn't connected). Warm, specific, concise — 2 to 5 short sentences. Streamed live, so write naturally. Do NOT claim you lack scheduling — you have the trigger node.
2) Then a line containing EXACTLY {MARKER}
3) Then ONLY a JSON object (no markdown, no prose after it) — the FULL desired workflow after this request:
{{"pattern":"sequential|parallel|supervisor|debate|swarm","trigger":{{"type":"manual|cron|interval|scheduled|watch|webhook","cron":"0 * * * *","interval_seconds":3600,"webhook_path":"/hook","watch_command":"","watch_condition":""}},"agents":[{{"type":"code|research|file|memory|plan|rag|ltp|custom","role":"short role name","instructions":"specific actionable instructions","max_turns":3,"tools":["optional exact tool names"]}}],"human_gates":[],"workspace":{{"enabled":false,"name":"","mode":"persistent"}},"suggestions":["2-4 word next-step the user might want, e.g. 'Add a reviewer'","'Run it hourly'","'Add error handling'"],"estimated_cost":"$0.XX","estimated_duration":"XXs","missing":["genuinely-unavailable capabilities only"]}}
(Only include the trigger sub-fields relevant to the chosen type; omit the others. "suggestions": 2-3 punchy refinements that would genuinely improve THIS workflow — phrased as commands the user could click.)

RULES:
- Only use capabilities actually available above. The TRIGGER is always available — never list it under "missing".
- When REFINING, return the COMPLETE updated workflow (keep existing agents/trigger unless the request changes them) — never just the delta.
- Keep it minimal: fewer agents = faster + cheaper.
- REUSABILITY: when a value will change run-to-run (a company, a topic, a URL, a ticker), put it as a {{placeholder}} in the instructions/goal — e.g. "Research {{company_name}}'s latest filings". The app prompts the user for these before each run, so the workflow becomes a reusable template. Use clear snake_case names.
- AMBIGUITY: if the goal is underspecified (e.g. WHAT to monitor, WHERE to send results, WHICH sources), still build a sensible best-guess workflow so the canvas isn't empty — but LEAD your reply with ONE short, specific clarifying question, and make your "suggestions" the 2-3 most likely ANSWERS to it (clickable), e.g. goal "monitor my service" → ask "Monitor what exactly, and how should it alert you?" with suggestions ["Monitor a website","Monitor an API","Alert me via Slack"].
- If the request is just a question or chit-chat, answer it in part 1 and still emit {MARKER} + the current workflow unchanged."""

    messages = []
    for h in history[-8:]:
        r = h.get("role")
        c = (h.get("content") or "")[:1500]
        if r in ("user", "assistant") and c:
            messages.append({"role": r, "content": c})
    messages.append({"role": "user", "content": message})

    queue: asyncio.Queue = asyncio.Queue()

    async def on_delta(text: str):
        await queue.put(text)

    async def run_llm():
        try:
            resp = await llm.complete(system=system, messages=messages, tools=[], on_delta=on_delta)
            await queue.put(None)
            return resp
        except Exception:
            await queue.put(None)
            raise

    runner = asyncio.create_task(run_llm())

    async def gen():
        def sse(ev: dict) -> str:
            return f"data: {json.dumps(ev)}\n\n"

        full = ""
        narrated = 0
        marker_pos = -1
        try:
            while True:
                text = await queue.get()
                if text is None:
                    break
                full += text
                if marker_pos < 0:
                    mp = full.find(MARKER)
                    if mp >= 0:
                        marker_pos = mp
                        seg = full[narrated:mp]
                        if seg:
                            yield sse({"type": "narration", "text": seg})
                        narrated = mp
                    else:
                        # Hold back the tail in case the marker is mid-formation
                        safe = max(narrated, len(full) - len(MARKER))
                        if safe > narrated:
                            yield sse({"type": "narration", "text": full[narrated:safe]})
                            narrated = safe

            # LLM finished — get the authoritative full content
            try:
                resp = await runner
                if resp and resp.content:
                    full = resp.content
            except Exception as exc:
                yield sse({"type": "error", "message": str(exc)[:200]})
                return

            if marker_pos < 0:
                marker_pos = full.find(MARKER)
            if marker_pos < 0:
                if narrated < len(full):
                    yield sse({"type": "narration", "text": full[narrated:]})
                yield sse({"type": "error", "message": "Architect didn't return a team. Try rephrasing."})
                return
            if narrated < marker_pos:
                yield sse({"type": "narration", "text": full[narrated:marker_pos]})

            jtext = full[marker_pos + len(MARKER):].strip()
            if jtext.startswith("```"):
                jtext = jtext.split("```")[1].strip()
                if jtext.startswith("json"):
                    jtext = jtext[4:].strip()
            try:
                team = json.loads(jtext)
            except Exception:
                # Last resort: grab the first {...} block
                import re as _re
                m = _re.search(r"\{.*\}", jtext, _re.DOTALL)
                team = json.loads(m.group(0)) if m else {}
            yield sse({"type": "team",
                       "pattern": team.get("pattern", "sequential"),
                       "trigger": team.get("trigger") or {"type": "manual"},
                       "agents": team.get("agents", []) or [],
                       "human_gates": team.get("human_gates") or [],
                       "workspace": team.get("workspace") or {"enabled": False},
                       "suggestions": team.get("suggestions") or [],
                       "estimated_cost": team.get("estimated_cost", ""),
                       "estimated_duration": team.get("estimated_duration", ""),
                       "missing": team.get("missing") or []})
            yield sse({"type": "done"})
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "error", "message": str(exc)[:200]})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})



# ── Scheduled Taskforce ─────────────────────────────────────────────────────

_SCHEDULES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "schedules")
os.makedirs(_SCHEDULES_DIR, exist_ok=True)


@router.post("/agents/taskforce/schedule")
async def schedule_taskforce(body: dict, x_tenant_id: str = Header(default="")):
    """Schedule a taskforce run with cron/interval/one-time trigger."""
    schedule = body.get("schedule", {})
    workflow_id = body.get("workflow_id")
    config = body.get("config")  # Inline config or loaded from workflow_id

    if not schedule or not (config or workflow_id):
        raise HTTPException(400, "schedule and config (or workflow_id) are required")

    # Load config from saved workflow if needed
    if workflow_id and not config:
        path = os.path.join(_WORKFLOWS_DIR, f"{workflow_id}.json")
        if not os.path.exists(path):
            raise HTTPException(404, f"Workflow {workflow_id} not found")
        with open(path) as f:
            wf = _json.load(f)
            config = wf.get("config", {})

    sched_id = f"sched-{int(__import__('time').time() * 1000)}"
    sched_type = schedule.get("type", "cron")

    # Use the kernel's scheduler to register the job
    k = _require()
    namespace = ns(x_tenant_id)

    if sched_type == "cron":
        cron_expr = schedule.get("expression", "0 * * * *")
        goal = config.get("goal", "Scheduled taskforce")
        # Register via scheduler MCP tool
        try:
            from kernelmcp.core.models import ToolCall
            tool_call = ToolCall(tool_name="schedule_task", arguments={
                "goal": f"[Scheduled TaskForce] {goal[:100]}",
                "job_type": "cron",
                "cron": cron_expr,
            })
            result = await k._engine._orchestrator.dispatch(tool_call, namespace=namespace)
            job_id = result.get("job_id", sched_id) if isinstance(result, dict) else sched_id
        except Exception:
            job_id = sched_id

    elif sched_type == "interval":
        interval = schedule.get("seconds", 3600)
        goal = config.get("goal", "Scheduled taskforce")
        try:
            from kernelmcp.core.models import ToolCall
            tool_call = ToolCall(tool_name="schedule_task", arguments={
                "goal": f"[Scheduled TaskForce] {goal[:100]}",
                "job_type": "interval",
                "interval_seconds": interval,
            })
            result = await k._engine._orchestrator.dispatch(tool_call, namespace=namespace)
            job_id = result.get("job_id", sched_id) if isinstance(result, dict) else sched_id
        except Exception:
            job_id = sched_id

    elif sched_type == "once":
        # One-time scheduled run
        job_id = sched_id
    else:
        raise HTTPException(400, f"Unknown schedule type: {sched_type}")

    # Save schedule metadata
    sched_data = {
        "id": sched_id,
        "job_id": job_id,
        "workflow_id": workflow_id,
        "config": config,
        "schedule": schedule,
        "namespace": namespace,
        "createdAt": int(__import__("time").time() * 1000),
        "active": True,
    }
    with open(os.path.join(_SCHEDULES_DIR, f"{sched_id}.json"), "w") as f:
        _json.dump(sched_data, f)

    return {"scheduled": True, "id": sched_id, "job_id": job_id}


## schedules routes moved above /agents/taskforce/{task_id} to avoid path conflict
