"""Hub control-plane ingest — let self-hosted kernels report their traces here.

A user who embeds kernelmcp in their own app can `connect_hub(...)` it to this Hub
to monitor their kernels from one place. Those kernels authenticate with a hub key
and POST their finished tasks; we store them (tagged by instance/project) so they
show up in Observability like local traces — without touching the Hub's own local
kernel or data.
"""
from __future__ import annotations

import os
import json
import time
import secrets

from fastapi import APIRouter, HTTPException, Header

router = APIRouter()
kernel = None  # set by server.py

_DATA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_KEYS_PATH = os.path.join(_DATA, "hub_keys.json")
_INSTANCES_PATH = os.path.join(_DATA, "hub_instances.json")
_COMMANDS_PATH = os.path.join(_DATA, "hub_commands.json")

# Connected instances live in memory (refreshed by heartbeats) and are mirrored to
# disk so the list survives a restart.
_instances: dict = {}
# Pending/finished commands queued for connected kernels (control plane).
_commands: list = []


def _load(path: str, default):
    try:
        return json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else default
    except Exception:
        return default


def _save(path: str, data) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


# Restore instances + commands on import (so a restart keeps the list)
_instances = _load(_INSTANCES_PATH, {})
_commands = _load(_COMMANDS_PATH, [])


def _keys() -> list:
    return _load(_KEYS_PATH, [])


def _valid_key(key: str):
    if not key:
        return None
    for k in _keys():
        if k.get("key") == key:
            return k
    return None


# ── Key management (dashboard owner) ─────────────────────────────────────────

@router.post("/hub/keys")
async def create_hub_key(body: dict):
    """Generate a hub key a remote kernel uses to connect (connect_hub api_key=…)."""
    label = (body.get("label") or "").strip() or "kernel"
    project = (body.get("project") or "default").strip()
    key = "kmh_" + secrets.token_urlsafe(24)
    keys = _keys()
    keys.append({"key": key, "label": label, "project": project, "created_at": int(time.time() * 1000)})
    _save(_KEYS_PATH, keys)
    return {"key": key, "label": label, "project": project}  # shown once in full


@router.get("/hub/keys")
async def list_hub_keys():
    return {"keys": [
        {"key_preview": k["key"][:8] + "…" + k["key"][-4:], "label": k.get("label"),
         "project": k.get("project"), "created_at": k.get("created_at")}
        for k in _keys()
    ]}


@router.delete("/hub/keys/{key_prefix}")
async def delete_hub_key(key_prefix: str):
    keys = [k for k in _keys() if not k["key"].startswith(key_prefix)]
    _save(_KEYS_PATH, keys)
    return {"deleted": True}


# ── Remote-kernel endpoints (authenticated by X-Hub-Key) ─────────────────────

@router.post("/hub/register")
async def hub_register(body: dict, x_hub_key: str = Header(default="")):
    """A connected kernel announces itself / sends a heartbeat."""
    if not _valid_key(x_hub_key):
        raise HTTPException(401, "invalid hub key")
    iid = body.get("instance_id")
    if not iid:
        raise HTTPException(400, "instance_id required")
    now = int(time.time() * 1000)
    inst = _instances.get(iid, {"registered_at": now, "tasks_ingested": 0})
    inst.update({
        "instance_id": iid, "name": body.get("name") or iid[:8],
        "project": body.get("project") or "default",
        "host": body.get("host"), "pid": body.get("pid"),
        "allow_control": bool(body.get("allow_control")),
        "last_seen": now,
    })
    _instances[iid] = inst
    _save(_INSTANCES_PATH, _instances)
    return {"ok": True}


@router.post("/hub/ingest")
async def hub_ingest(body: dict, x_hub_key: str = Header(default="")):
    """A connected kernel pushes a finished task (with spans). Stored as a trace,
    tagged by instance/project, so it's viewable in Observability."""
    if not _valid_key(x_hub_key):
        raise HTTPException(401, "invalid hub key")
    iid = body.get("instance_id") or "unknown"
    project = body.get("project") or "default"
    raw = body.get("task") or {}
    try:
        from kernelmcp.core.models import Task
        task = Task(**raw)
    except Exception as exc:
        raise HTTPException(400, f"invalid task payload: {str(exc)[:200]}")

    # Tag so we can attribute it to the source kernel without polluting local tasks.
    if not isinstance(task.metadata, dict):
        task.metadata = {}
    inst = _instances.get(iid, {})
    task.metadata["hub_instance"] = iid
    task.metadata["hub_instance_name"] = inst.get("name", iid[:8])
    task.metadata["hub_project"] = project
    # Keep it out of the local tenant's namespace listing.
    task.namespace = f"hub__{project}"

    if kernel is not None:
        kernel._tasks[task.id] = task  # direct lookup → viewable via /tasks/{id}/spans
    try:
        from task_store import save_task
        save_task(task)
    except Exception:
        pass

    # Update the instance's counters
    if iid in _instances:
        _instances[iid]["last_seen"] = int(time.time() * 1000)
        _instances[iid]["tasks_ingested"] = _instances[iid].get("tasks_ingested", 0) + 1
        _save(_INSTANCES_PATH, _instances)
    return {"ok": True, "task_id": task.id}


# ── Dashboard views ──────────────────────────────────────────────────────────

def _is_live(inst: dict) -> bool:
    # Considered live if seen within 3 heartbeat intervals (~ a few seconds)
    return (time.time() * 1000 - (inst.get("last_seen") or 0)) < 20000


@router.get("/hub/instances")
async def hub_instances():
    out = []
    for inst in _instances.values():
        out.append({**{k: inst.get(k) for k in ("instance_id", "name", "project", "host", "pid", "registered_at", "last_seen", "tasks_ingested", "allow_control")},
                    "live": _is_live(inst)})
    out.sort(key=lambda x: (not x["live"], -(x.get("last_seen") or 0)))
    return {"instances": out, "live": sum(1 for i in out if i["live"]), "total": len(out)}


# ── Control plane: queue commands for a connected kernel (opt-in on its side) ──

_ALLOWED_COMMANDS = {"ping", "stats", "set_config", "run", "cancel"}


@router.post("/hub/instances/{instance_id}/commands")
async def hub_enqueue_command(instance_id: str, body: dict):
    """Dashboard → queue a command for a connected kernel. The kernel polls and runs
    it (only if it opted into control via connect_hub(allow_control=True))."""
    inst = _instances.get(instance_id)
    if not inst:
        raise HTTPException(404, "instance not found")
    if not inst.get("allow_control"):
        raise HTTPException(403, "this kernel did not enable control (connect_hub allow_control=True)")
    ctype = body.get("type")
    if ctype not in _ALLOWED_COMMANDS:
        raise HTTPException(400, f"unknown command type (allowed: {sorted(_ALLOWED_COMMANDS)})")
    cmd = {"id": "cmd_" + secrets.token_hex(6), "instance_id": instance_id, "type": ctype,
           "args": body.get("args") or {}, "status": "pending", "created_at": int(time.time() * 1000),
           "result": None, "error": None}
    _commands.append(cmd)
    _save(_COMMANDS_PATH, _commands[-500:])
    return {"id": cmd["id"], "status": "pending"}


@router.get("/hub/commands")
async def hub_poll_commands(instance_id: str, x_hub_key: str = Header(default="")):
    """Kernel → poll for its pending commands (marks them dispatched)."""
    if not _valid_key(x_hub_key):
        raise HTTPException(401, "invalid hub key")
    pending = [c for c in _commands if c["instance_id"] == instance_id and c["status"] == "pending"]
    for c in pending:
        c["status"] = "dispatched"
        c["dispatched_at"] = int(time.time() * 1000)
    if pending:
        _save(_COMMANDS_PATH, _commands[-500:])
    return {"commands": [{"id": c["id"], "type": c["type"], "args": c["args"]} for c in pending]}


@router.post("/hub/commands/{cmd_id}/result")
async def hub_command_result(cmd_id: str, body: dict, x_hub_key: str = Header(default="")):
    """Kernel → report a command's result."""
    if not _valid_key(x_hub_key):
        raise HTTPException(401, "invalid hub key")
    for c in _commands:
        if c["id"] == cmd_id:
            c["status"] = body.get("status", "done")
            c["result"] = body.get("result")
            c["error"] = body.get("error")
            c["done_at"] = int(time.time() * 1000)
            _save(_COMMANDS_PATH, _commands[-500:])
            return {"ok": True}
    raise HTTPException(404, "command not found")


@router.get("/hub/instances/{instance_id}/commands")
async def hub_list_commands(instance_id: str, limit: int = 20):
    """Dashboard → recent commands for an instance + their status/result."""
    cmds = [c for c in _commands if c["instance_id"] == instance_id]
    cmds = sorted(cmds, key=lambda c: c.get("created_at", 0), reverse=True)[:max(1, limit)]
    return {"commands": cmds}


@router.get("/hub/instances/{instance_id}/runs")
async def hub_instance_runs(instance_id: str, limit: int = 50):
    """Recent ingested tasks for one connected kernel (newest first)."""
    if kernel is None:
        return {"runs": []}
    runs = []
    for t in kernel._tasks.values():
        md = t.metadata if isinstance(t.metadata, dict) else {}
        if md.get("hub_instance") != instance_id:
            continue
        runs.append({
            "id": t.id, "goal": (t.goal or "")[:120], "status": t.status.value,
            "tokens": t.total_tokens, "cost": round(t.total_cost, 6),
            "createdAt": t.created_at.timestamp() * 1000 if t.created_at else 0,
        })
    runs.sort(key=lambda x: x["createdAt"], reverse=True)
    return {"runs": runs[:max(1, limit)]}
