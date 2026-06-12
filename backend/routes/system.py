"""Health, config, stats, servers, mode, schedules, audit and webhook endpoints."""
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


_SCHEDULES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "schedules")
os.makedirs(_SCHEDULES_DIR, exist_ok=True)

# ── Health / Config / Stats / Servers / Mode ─────────────────────────────────

@router.get("/health")
async def health(x_tenant_id: str = Header(default="")):
    if kernel is None: return {"status": "starting"}
    h = await kernel.health()
    h["namespace"] = ns(x_tenant_id)
    return h


@router.get("/config")
async def get_config():
    if kernel is None: return {}
    return {"config": kernel.config.model_dump(), "llm": {"provider": llm_config["provider"], "model": llm_config["model"], "has_api_key": bool(llm_config["api_key"])}}


@router.get("/stats")
async def stats():
    k = _require()
    return (await k.get_stats()).model_dump()


class ToolCallRequest(BaseModel):
    tool: str
    args: dict = {}


@router.post("/api/tool")
async def call_tool(body: ToolCallRequest, x_tenant_id: str = Header(default="")):
    """Generic MCP tool dispatcher — calls any kernel tool by name."""
    k = _require()
    tool_name = body.tool
    args = body.args
    namespace = ns(x_tenant_id)

    # Built-in tools that map to kernel methods directly
    if tool_name == "get_analytics":
        stats_data = (await k.get_stats()).model_dump()
        # Enrich with top tools and models from audit
        top_tools = audit_collector.top_tools(limit=10)
        top_models = audit_collector.top_models(limit=5)
        stats_data["top_tools"] = top_tools
        stats_data["top_models"] = top_models
        # Derive task counts/totals from the persistent, namespace-scoped task store so this
        # Overview matches /metrics/summary and the avg-duration figure below. The in-memory
        # _stats counters reset on restart and only track chat-route runs, which left these at 0
        # even though tasks clearly ran (non-zero duration + recorded tool calls).
        all_tasks = [t for t in k._tasks.values() if t.namespace == namespace or t.namespace.startswith(f"{namespace}__")]

        def _status(t):
            s = getattr(t, "status", None)
            return getattr(s, "value", s)

        stats_data["tasks_completed"] = sum(1 for t in all_tasks if _status(t) == "completed")
        stats_data["tasks_failed"] = sum(1 for t in all_tasks if _status(t) == "failed")
        stats_data["total_tokens"] = sum(int(getattr(t, "total_tokens", 0) or 0) for t in all_tasks)
        stats_data["total_cost"] = round(sum(float(getattr(t, "total_cost", 0.0) or 0.0) for t in all_tasks), 6)
        total_tasks = stats_data["tasks_completed"] + stats_data["tasks_failed"]
        stats_data["avg_tokens_per_task"] = stats_data["total_tokens"] / max(total_tasks, 1)
        durations = [t.duration_ms for t in all_tasks if hasattr(t, "duration_ms") and t.duration_ms and t.duration_ms > 0]
        stats_data["avg_duration_ms"] = round(sum(durations) / max(len(durations), 1)) if durations else 0
        return {"result": stats_data}

    if tool_name == "list_tasks":
        # Local tenant tasks incl. sub-namespaces (e.g. demo__run_xxx for deployment/
        # TaskForce runs). Remote ingested traces live under hub__* — keep them OUT here
        # (they have their own scope in Observability); this is the LOCAL list.
        all_tasks = list(k._tasks.values())
        tasks_list = [
            t for t in all_tasks
            if not t.namespace.startswith("hub__")
            and (t.namespace == namespace or t.namespace.startswith(f"{namespace}__") or t.namespace.startswith(f"{namespace}"))
        ]
        tasks_list.sort(key=lambda t: t.created_at.timestamp() if t.created_at else 0, reverse=True)
        def _task_label(t):
            # Prefer original_message for chat tasks (goal includes conversation context)
            om = t.metadata.get("original_message", "") if isinstance(t.metadata, dict) else ""
            if om:
                return om[:200]
            g = t.goal or ""
            # Strip conversation context prefix
            if "[Current message]" in g:
                return g.split("[Current message]")[-1].strip()[:200]
            return g[:200]
        def _source(md):
            if not isinstance(md, dict):
                return "taskforce"
            if md.get("deployment_id"):
                return "deployment"
            return "chat" if md.get("conversation_id") else "taskforce"
        # Pagination: newest-first, page back to the very first task.
        try:
            limit = max(1, min(500, int(args.get("limit", 100))))
        except Exception:
            limit = 100
        try:
            offset = max(0, int(args.get("offset", 0)))
        except Exception:
            offset = 0
        total = len(tasks_list)
        page = tasks_list[offset:offset + limit]
        return {"result": {"total": total, "offset": offset, "limit": limit, "tasks": [
            {"task_id": t.id, "query": _task_label(t), "status": t.status.value,
             "created_at": t.created_at.timestamp() if t.created_at else 0,
             "duration_ms": round(t.duration_ms) if hasattr(t, "duration_ms") else None,
             "source": _source(t.metadata),
             "deployment_name": (t.metadata.get("deployment_name") if isinstance(t.metadata, dict) else None),
             "tokens": t.total_tokens, "cost": round(t.total_cost, 6)}
            for t in page
        ]}}

    if tool_name == "get_trace":
        task_id = args.get("task_id", "")
        task = k._tasks.get(task_id)  # Direct lookup, no namespace filter
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        from models import flatten_turns
        return {"result": {"turns": flatten_turns(task)}}

    if tool_name == "compare_runs":
        task_a_id = args.get("task_a", "")
        task_b_id = args.get("task_b", "")
        a = await k.get_task(task_a_id, namespace=namespace)
        b = await k.get_task(task_b_id, namespace=namespace)
        if not a or not b:
            raise HTTPException(status_code=404, detail="Task not found")
        diff = {
            "status": {"a": a.status.value, "b": b.status.value},
            "turns": {"a": a.total_turns, "b": b.total_turns},
            "tokens": {"a": a.total_tokens, "b": b.total_tokens},
            "cost": {"a": round(a.total_cost, 6), "b": round(b.total_cost, 6)},
        }
        return {"result": {"task_a": task_a_id, "task_b": task_b_id, "diff": diff}}

    if tool_name == "improve":
        dry_run = args.get("dry_run", True)
        # Simple meta-analysis based on recent tasks
        tasks_list = await k.list_tasks(namespace)
        total = len(tasks_list)
        failed = sum(1 for t in tasks_list if t.status.value == "failed")
        result = {
            "total_runs": total,
            "failed_runs": failed,
            "slow_runs": 0,
            "expensive_runs": 0,
            "suggestions": [],
        }
        if failed > 0 and total > 0:
            fail_rate = failed / total
            if fail_rate > 0.3:
                result["suggestions"].append({
                    "type": "constitution",
                    "content": "Add error handling guidelines to the constitution",
                    "rationale": f"{failed}/{total} tasks failed ({fail_rate:.0%}). The agent may need clearer instructions on retry strategies.",
                    "confidence": min(0.5 + fail_rate, 0.95),
                })
        if total > 5:
            result["suggestions"].append({
                "type": "tool_config",
                "content": "Consider enabling LTP mode for structured tasks",
                "rationale": "With enough task history, LTP compilation can reduce token usage by 40-60% on structured tasks.",
                "confidence": 0.7,
            })
        if not dry_run:
            return {"result": {"applied": len(result["suggestions"]), "details": [s["content"] for s in result["suggestions"]]}}
        return {"result": result}

    # Fallback: try to execute via orchestrator
    try:
        tool_result = await k.orchestrator.execute_tool(tool_name, args, namespace)
        return {"result": tool_result}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Tool '{tool_name}' failed: {exc}")


@router.get("/servers")
async def list_servers():
    k = _require()
    orch = k._engine._orchestrator
    # Build tool-to-server mapping from the orchestrator
    tool_registry = orch.get_tool_registry()
    server_tools: dict[str, list[str]] = {}
    for tool in tool_registry:
        server, _ = orch._route_tool(tool["name"])
        server_tools.setdefault(server, []).append(tool["name"])
    servers = {}
    for name in ["memory", "planning", "workspace", "sandbox", "scheduler", "rag"]:
        pipe = getattr(orch, name, None)
        tools = server_tools.get(name, [])
        servers[f"{name}mcp"] = {"connected": pipe is not None, "tools": len(tools), "tool_names": tools}
    return {"servers": servers}


@router.get("/mode")
async def get_mode():
    return {"mode": _require()._engine._mode}


@router.post("/mode")
async def set_mode(mode: str = Query(...)):
    k = _require()
    if mode not in ("react", "ltp", "hybrid"): raise HTTPException(400, "Mode must be react, ltp, or hybrid")
    k._engine._mode = mode
    return {"mode": mode}



# ── Schedules ────────────────────────────────────────────────────────────────

@router.get("/schedules")
async def list_schedules(x_tenant_id: str = Header(default=""), status: str = ""):
    k = _require()
    sched = k._engine._orchestrator.scheduler
    if not sched: return {"jobs": []}
    try:
        tenant_ns = ns(x_tenant_id)
        all_jobs = await sched.list_jobs(namespace=tenant_ns)
        # Legacy jobs created before namespacing (empty namespace) belong to the default tenant
        # (demo) — surface them there, never to other tenants. (The old code fell back to ALL
        # jobs when a tenant had none, which leaked every tenant's schedules.)
        if tenant_ns == ns(None):
            seen = {getattr(j, "id", None) for j in all_jobs}
            all_jobs = all_jobs + [j for j in await sched.list_jobs(namespace="")
                                   if not getattr(j, "namespace", "") and getattr(j, "id", None) not in seen]
        if status:
            all_jobs = [j for j in all_jobs if (getattr(j, "status", "").value if hasattr(getattr(j, "status", ""), "value") else str(getattr(j, "status", ""))) == status]

        def _serialize_result(r):
            if not r: return None
            return {
                "run_id": getattr(r, "run_id", ""),
                "success": getattr(r, "success", True),
                "output": (getattr(r, "output", "") or "")[:500],
                "error": (getattr(r, "error", "") or "")[:500],
                "started_at": getattr(r, "started_at", "").isoformat() if hasattr(getattr(r, "started_at", None), "isoformat") else None,
                "completed_at": getattr(r, "completed_at", "").isoformat() if hasattr(getattr(r, "completed_at", None), "isoformat") else None,
                "duration_ms": getattr(r, "duration_ms", 0),
                "tokens_used": getattr(r, "tokens_used", 0),
                "cost": getattr(r, "cost", 0),
            }

        def _serialize(j):
            st = getattr(j, "job_type", getattr(j, "schedule_type", "once"))
            status_val = getattr(j, "status", "scheduled")
            nr = getattr(j, "next_run", None)
            lr = getattr(j, "last_run", None)
            ca = getattr(j, "created_at", None)
            return {
                "id": j.id,
                "goal": j.goal,
                "schedule_type": st.value if hasattr(st, "value") else str(st),
                "status": status_val.value if hasattr(status_val, "value") else str(status_val),
                "next_run": nr.isoformat() if hasattr(nr, "isoformat") else None,
                "last_run": lr.isoformat() if hasattr(lr, "isoformat") else None,
                "created_at": ca.isoformat() if hasattr(ca, "isoformat") else None,
                "run_count": getattr(j, "run_count", 0),
                "namespace": getattr(j, "namespace", ""),
                "enabled": getattr(j, "enabled", True),
                "cron": getattr(j, "cron", None) or None,
                "interval_seconds": getattr(j, "interval_seconds", None) or None,
                "delay_seconds": getattr(j, "delay_seconds", None) or None,
                "watch_command": getattr(j, "watch_command", None) or None,
                "watch_condition": getattr(j, "watch_condition", None) or None,
                "watch_interval": getattr(j, "watch_interval", None) or None,
                "watch_last_value": getattr(j, "watch_last_value", None) or None,
                "consecutive_failures": getattr(j, "consecutive_failures", 0),
                "max_failures": getattr(j, "max_failures", 3),
                "retry_count": getattr(j, "retry_count", 0),
                "max_retries": getattr(j, "max_retries", 3),
                "next_retry_at": getattr(j, "next_retry_at", "").isoformat() if hasattr(getattr(j, "next_retry_at", None), "isoformat") else None,
                "max_runs": getattr(j, "max_runs", 0),
                "tags": getattr(j, "tags", []),
                "metadata": getattr(j, "metadata", {}),
                "webhook_url": getattr(j, "webhook_url", None) or None,
                "last_result": _serialize_result(getattr(j, "last_result", None)),
                "history": [_serialize_result(r) for r in (getattr(j, "history", None) or [])[-20:]],
            }
        return {"jobs": [_serialize(j) for j in all_jobs]}
    except Exception as exc:
        print(f"[SCHEDULES] list error: {exc}", flush=True)
        return {"jobs": []}


@router.get("/schedules/stats")
async def schedule_stats(x_tenant_id: str = Header(default="")):
    k = _require()
    sched = k._engine._orchestrator.scheduler
    if not sched: return {"total_jobs": 0, "active_jobs": 0, "paused_jobs": 0, "completed_jobs": 0, "total_runs": 0, "total_failures": 0}
    try:
        s = await sched.stats()
        return {
            "total_jobs": getattr(s, "total_jobs", 0),
            "active_jobs": getattr(s, "active_jobs", 0),
            "paused_jobs": getattr(s, "paused_jobs", 0),
            "completed_jobs": getattr(s, "completed_jobs", 0),
            "total_runs": getattr(s, "total_runs", 0),
            "total_failures": getattr(s, "total_failures", 0),
        }
    except Exception as exc:
        print(f"[SCHEDULES] stats error: {exc}", flush=True)
        return {"total_jobs": 0, "active_jobs": 0, "paused_jobs": 0, "completed_jobs": 0, "total_runs": 0, "total_failures": 0}


@router.post("/schedules/{job_id}/action")
async def schedule_action(job_id: str, body: dict, x_tenant_id: str = Header(default="")):
    k = _require()
    sched = k._engine._orchestrator.scheduler
    if not sched: raise HTTPException(503, "Scheduler not available")
    action = body.get("action", "")
    namespace = ns(x_tenant_id)
    try:
        if action == "pause":
            await sched.pause(job_id)
            return {"success": True, "action": "paused"}
        elif action == "resume":
            await sched.resume(job_id)
            return {"success": True, "action": "resumed"}
        elif action == "cancel":
            await sched.cancel(job_id)
            return {"success": True, "action": "cancelled"}
        elif action == "retry":
            result = await sched.execute_job(job_id)
            return {"success": True, "action": "retried", "result": str(result)[:200] if result else None}
        else:
            raise HTTPException(400, f"Unknown action: {action}")
    except Exception as exc:
        raise HTTPException(500, str(exc))



# ── Audit ────────────────────────────────────────────────────────────────────

@router.get("/audit/events")
async def get_audit_events(limit: int = Query(500, ge=1, le=2000), source: str = Query(None)):
    return {"events": audit_collector.get_recent(limit, source)}


@router.delete("/audit/events")
async def clear_audit():
    audit_collector.clear()
    return {"cleared": True}


@router.get("/audit/stream")
async def audit_stream():
    queue = audit_collector.subscribe()
    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'connected', 'ts': time.time()})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'ping', 'ts': time.time()})}\n\n"
        except asyncio.CancelledError: pass
        finally: audit_collector.unsubscribe(queue)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


# ── Webhook ──────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def trigger_webhook(body: WebhookBody, x_tenant_id: str = Header(default="")):
    await kernel_event_bus.emit(KernelEvent(type=KernelEventType.webhook_received, namespace=ns(x_tenant_id), message=body.event, data=body.data))
    return {"status": "emitted"}
