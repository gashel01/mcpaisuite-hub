"""Workflows: hierarchical workflow / versions / runs."""
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

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


_DEPLOY_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "deployments")

# ── Workflows (hierarchical: workflow → versions → runs) ────────────────────

import os, json as _json, shutil, time as _time

_WORKFLOWS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "workflows")
os.makedirs(_WORKFLOWS_DIR, exist_ok=True)


def _wf_path(wf_id: str) -> str:
    return os.path.join(_WORKFLOWS_DIR, wf_id)


def _load_wf(wf_id: str) -> dict | None:
    meta = os.path.join(_wf_path(wf_id), "meta.json")
    if not os.path.exists(meta):
        return None
    with open(meta) as f:
        wf = _json.load(f)
    # Load versions
    vdir = os.path.join(_wf_path(wf_id), "versions")
    versions = []
    if os.path.isdir(vdir):
        for vf in sorted(os.listdir(vdir)):
            if vf.endswith(".json"):
                with open(os.path.join(vdir, vf)) as f:
                    versions.append(_json.load(f))
    wf["versions"] = versions
    # Load runs
    rdir = os.path.join(_wf_path(wf_id), "runs")
    runs = []
    if os.path.isdir(rdir):
        for rf in sorted(os.listdir(rdir)):
            if rf.endswith(".json"):
                with open(os.path.join(rdir, rf)) as f:
                    runs.append(_json.load(f))
    wf["runs"] = runs
    # Backfill activeVersionId for legacy workflows → newest version
    if not wf.get("activeVersionId") and versions:
        wf["activeVersionId"] = versions[-1]["id"]
    return wf


@router.get("/workflows")
async def list_workflows():
    workflows = []
    if os.path.isdir(_WORKFLOWS_DIR):
        for name in sorted(os.listdir(_WORKFLOWS_DIR), reverse=True):
            wf = _load_wf(name)
            if wf:
                workflows.append(wf)
    return {"workflows": workflows}


@router.post("/workflows")
async def create_workflow(body: dict):
    now = int(_time.time() * 1000)
    wf_id = f"wf-{now}"
    wf_dir = _wf_path(wf_id)
    os.makedirs(os.path.join(wf_dir, "versions"), exist_ok=True)
    os.makedirs(os.path.join(wf_dir, "runs"), exist_ok=True)

    # Create v1
    v_data = body.get("version", {})
    v_id = f"v-{now}"
    meta = {"id": wf_id, "name": body.get("name", "Untitled"), "createdAt": now, "updatedAt": now,
            "activeVersionId": v_id}
    with open(os.path.join(wf_dir, "meta.json"), "w") as f:
        _json.dump(meta, f)

    version = {"id": v_id, "workflowId": wf_id, "version": 1, "config": v_data.get("config", {}),
               "graph": v_data.get("graph"), "note": v_data.get("note", ""), "createdAt": now}
    if v_data.get("parentVersionId"):
        version["parentVersionId"] = v_data["parentVersionId"]
    with open(os.path.join(wf_dir, "versions", f"{v_id}.json"), "w") as f:
        _json.dump(version, f)

    return {"workflow": {**meta, "versions": [version], "runs": []}}


@router.get("/workflows/{wf_id}")
async def get_workflow(wf_id: str):
    wf = _load_wf(wf_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


@router.put("/workflows/{wf_id}")
async def update_workflow(wf_id: str, body: dict):
    meta_path = os.path.join(_wf_path(wf_id), "meta.json")
    if not os.path.exists(meta_path):
        raise HTTPException(404, "Workflow not found")
    with open(meta_path) as f:
        meta = _json.load(f)
    if "name" in body:
        meta["name"] = body["name"]
    meta["updatedAt"] = int(_time.time() * 1000)
    with open(meta_path, "w") as f:
        _json.dump(meta, f)
    return {"updated": True}


@router.delete("/workflows/{wf_id}")
async def delete_workflow(wf_id: str):
    wf_dir = _wf_path(wf_id)
    if not os.path.isdir(wf_dir):
        return {"deleted": True, "id": wf_id}
    rdir = os.path.join(wf_dir, "runs")
    has_runs = os.path.isdir(rdir) and any(f.endswith(".json") for f in os.listdir(rdir))
    if has_runs:
        # Keep the run history — each run carries a self-contained graph snapshot, so its
        # executions stay viewable/openable. Drop meta + versions so the workflow no longer
        # appears as an editable workflow (it vanishes from /workflows; runs persist).
        meta = os.path.join(wf_dir, "meta.json")
        if os.path.isfile(meta):
            os.remove(meta)
        shutil.rmtree(os.path.join(wf_dir, "versions"), ignore_errors=True)
    else:
        shutil.rmtree(wf_dir)
    return {"deleted": True, "id": wf_id, "runs_kept": has_runs}


@router.post("/workflows/{wf_id}/versions")
async def create_version(wf_id: str, body: dict):
    wf_dir = _wf_path(wf_id)
    if not os.path.isdir(wf_dir):
        raise HTTPException(404, "Workflow not found")
    # Count existing versions
    vdir = os.path.join(wf_dir, "versions")
    existing = [f for f in os.listdir(vdir) if f.endswith(".json")] if os.path.isdir(vdir) else []
    ver_num = len(existing) + 1
    now = int(_time.time() * 1000)
    v_id = f"v-{now}"
    version = {"id": v_id, "workflowId": wf_id, "version": ver_num, "config": body.get("config", {}),
               "graph": body.get("graph"), "note": body.get("note", ""),
               "parentVersionId": body.get("parentVersionId"), "createdAt": now}
    with open(os.path.join(vdir, f"{v_id}.json"), "w") as f:
        _json.dump(version, f)
    # Update workflow timestamp; optionally promote this version to active
    meta_path = os.path.join(wf_dir, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = _json.load(f)
        meta["updatedAt"] = now
        if body.get("activate"):
            meta["activeVersionId"] = v_id
        with open(meta_path, "w") as f:
            _json.dump(meta, f)
    return {"version": version, "activeVersionId": (meta.get("activeVersionId") if os.path.exists(meta_path) else None)}


@router.post("/workflows/{wf_id}/activate/{v_id}")
async def activate_version(wf_id: str, v_id: str):
    """Promote a version to the 'active' one (the version that Run/Deploy target by default).
    Rollback is just activating an older version — versions are immutable, nothing is copied."""
    wf_dir = _wf_path(wf_id)
    meta_path = os.path.join(wf_dir, "meta.json")
    if not os.path.exists(meta_path):
        raise HTTPException(404, "Workflow not found")
    if not os.path.exists(os.path.join(wf_dir, "versions", f"{v_id}.json")):
        raise HTTPException(404, "Version not found")
    with open(meta_path) as f:
        meta = _json.load(f)
    meta["activeVersionId"] = v_id
    meta["updatedAt"] = int(_time.time() * 1000)
    with open(meta_path, "w") as f:
        _json.dump(meta, f)
    return {"activeVersionId": v_id}


@router.post("/workflows/{wf_id}/versions/{v_id}/runs")
async def create_run(wf_id: str, v_id: str, body: dict):
    wf_dir = _wf_path(wf_id)
    if not os.path.isdir(wf_dir):
        raise HTTPException(404, "Workflow not found")
    rdir = os.path.join(wf_dir, "runs")
    os.makedirs(rdir, exist_ok=True)
    now = int(_time.time() * 1000)
    run_id = body.get("id") or f"run-{now}"
    run = {"id": run_id, "versionId": v_id, "workflowId": wf_id,
           "status": body.get("status", "running"), "answer": body.get("answer"),
           "metrics": body.get("metrics"), "feedback": body.get("feedback"),
           "liveEvents": body.get("liveEvents", [])[:30],
           # Self-contained snapshot: keep the graph + name at run time so the run stays
           # openable in the builder even if the workflow is later deleted or unsaved.
           "graph": body.get("graph"), "workflowName": body.get("workflowName"),
           "createdAt": now}
    with open(os.path.join(rdir, f"{run_id}.json"), "w") as f:
        _json.dump(run, f)
    return {"run": run}


@router.post("/runs/{run_id}/feedback")
async def submit_run_feedback(run_id: str, body: dict, x_tenant_id: str = Header(default="")):
    """Submit feedback for a run. If bad, stores a correction in the ledger."""
    rating = body.get("rating")  # "good" or "bad"
    comment = body.get("comment", "")
    goal = body.get("goal", "")
    output = body.get("output", "")

    # 1. Save feedback to the run file
    if os.path.isdir(_WORKFLOWS_DIR):
        for wf_name in os.listdir(_WORKFLOWS_DIR):
            rdir = os.path.join(_WORKFLOWS_DIR, wf_name, "runs")
            rpath = os.path.join(rdir, f"{run_id}.json")
            if os.path.exists(rpath):
                with open(rpath) as f:
                    run = _json.load(f)
                run["feedback"] = {"rating": rating, "comment": comment}
                with open(rpath, "w") as f:
                    _json.dump(run, f)
                break

    # 2. If bad, store a correction in the correction ledger
    if rating == "bad" and kernel:
        try:
            ledger = getattr(kernel, '_engine', None) and getattr(kernel._engine, '_correction_ledger', None)
            if ledger:
                correction = f"Bad output for goal: '{goal[:200]}'. "
                if comment:
                    correction += f"User feedback: {comment}. "
                correction += f"Output was: {output[:300]}"
                await ledger.store_fact(
                    content=correction,
                    namespace="corrections",
                    importance=0.8,
                    labels=["user_feedback", "bad_output"],
                )
                audit_collector.emit("feedback", "correction_stored", {"run_id": run_id, "rating": rating})
        except Exception:
            pass  # Non-critical

    # 3. If good, store positive reinforcement
    if rating == "good" and kernel:
        try:
            orch = kernel._engine._orchestrator
            if hasattr(orch, 'memory') and orch.memory:
                await orch.memory.store_fact(
                    content=f"Successful approach for: '{goal[:200]}'. Output was well received.",
                    namespace=ns(x_tenant_id) or "default",
                    importance=0.6,
                    labels=["positive_feedback", "good_output"],
                )
        except Exception:
            pass

    audit_collector.emit("feedback", "run_feedback", {"run_id": run_id, "rating": rating, "has_comment": bool(comment)})
    return {"ok": True, "rating": rating}


@router.put("/runs/{run_id}")
async def update_run(run_id: str, body: dict):
    # Search all workflows for this run
    if os.path.isdir(_WORKFLOWS_DIR):
        for wf_name in os.listdir(_WORKFLOWS_DIR):
            rdir = os.path.join(_WORKFLOWS_DIR, wf_name, "runs")
            rpath = os.path.join(rdir, f"{run_id}.json")
            if os.path.exists(rpath):
                with open(rpath) as f:
                    run = _json.load(f)
                run.update({k: v for k, v in body.items() if k != "id"})
                with open(rpath, "w") as f:
                    _json.dump(run, f)
                return {"updated": True}
    raise HTTPException(404, "Run not found")


def _iter_run_files():
    """Yield (path, source) for every run JSON across builder workflows + deployments."""
    if os.path.isdir(_WORKFLOWS_DIR):
        for wf_name in os.listdir(_WORKFLOWS_DIR):
            rdir = os.path.join(_WORKFLOWS_DIR, wf_name, "runs")
            if os.path.isdir(rdir):
                for rf in os.listdir(rdir):
                    if rf.endswith(".json"):
                        yield os.path.join(rdir, rf), "builder"
    if os.path.isdir(_DEPLOY_DIR):
        for dep_name in os.listdir(_DEPLOY_DIR):
            rdir = os.path.join(_DEPLOY_DIR, dep_name, "runs")
            if os.path.isdir(rdir):
                for rf in os.listdir(rdir):
                    if rf.endswith(".json"):
                        yield os.path.join(rdir, rf), "api"


def _wf_name_map() -> dict:
    out = {}
    if os.path.isdir(_WORKFLOWS_DIR):
        for wf_name in os.listdir(_WORKFLOWS_DIR):
            mp = os.path.join(_WORKFLOWS_DIR, wf_name, "meta.json")
            if os.path.exists(mp):
                try:
                    out[wf_name] = _json.load(open(mp)).get("name", wf_name)
                except Exception:
                    pass
    return out


@router.get("/runs")
async def list_runs(status: str = "", source: str = "", since: int = 0, q: str = "", limit: int = 200):
    """Flat, filterable executions feed across builder runs + deployment API calls.
    Lightweight summaries (no liveEvents); use GET /runs/{id} for the full record."""
    names = _wf_name_map()
    out = []
    for path, dir_src in _iter_run_files():
        try:
            r = _json.load(open(path))
        except Exception:
            continue
        is_deploy = dir_src == "api"  # came from a deployment's runs dir
        # Prefer the run's own source field ("api" vs "test") over the dir classification
        src = r.get("source") or ("api" if is_deploy else "builder")
        if source and src != source:
            continue
        if status and r.get("status") != status:
            continue
        if since and (r.get("createdAt", 0) < since):
            continue
        # For orphaned (deleted-workflow) runs the name map has no entry — fall back to the
        # name snapshotted in the run record so the feed still reads nicely.
        label = r.get("deploymentName") if is_deploy else (names.get(r.get("workflowId")) or r.get("workflowName") or r.get("workflowId"))
        ans = r.get("answer") or ""
        if q and q.lower() not in (str(label or "") + " " + str(ans)).lower():
            continue
        out.append({
            "id": r.get("id"), "source": src, "status": r.get("status"),
            "label": label, "workflowId": r.get("workflowId"), "versionId": r.get("versionId"),
            "deploymentId": r.get("deploymentId"),
            "metrics": r.get("metrics"), "feedback": r.get("feedback"),
            "answerPreview": (ans[:160] + "…") if len(ans) > 160 else ans,
            "createdAt": r.get("createdAt"), "completedAt": r.get("completedAt"),
        })
    out.sort(key=lambda x: x.get("createdAt") or 0, reverse=True)
    total = len(out)
    return {"runs": out[: max(1, limit)], "total": total}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Full run record (incl. answer + liveEvents) from either builder or deployment history."""
    for path, src in _iter_run_files():
        if os.path.basename(path) == f"{run_id}.json":
            try:
                r = _json.load(open(path))
                r["source"] = src
                # Does the live, editable workflow version still exist? If not, the builder
                # opens the run's own graph snapshot read-only instead.
                if src == "builder" and r.get("workflowId") and r.get("versionId"):
                    r["workflowExists"] = os.path.isfile(os.path.join(_wf_path(r["workflowId"]), "versions", f"{r['versionId']}.json"))
                return r
            except Exception:
                break
    raise HTTPException(404, "Run not found")
