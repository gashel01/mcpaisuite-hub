"""Agent spawn and execution endpoints."""
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
from routes.settings import resolve_connection

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


# Active graph executors (for human gate resume)
_active_executors: dict[str, "GraphExecutor"] = {}

# ── Agents ───────────────────────────────────────────────────────────────────

@router.get("/agents")
async def list_agents():
    return {"agents": _require().list_agents()}


@router.post("/agents/spawn")
async def spawn_agent(body: SpawnAgentRequest, x_tenant_id: str = Header(default="")):
    k = _require()
    try:
        result = await k.spawn_agent(agent_type=body.agent_type, task=body.task, namespace=ns(x_tenant_id), max_turns=body.max_turns, input_data=body.input_data, constitution=body.constitution, tools=body.tools or None)
        return result.model_dump(mode="json")
    except ValueError as exc: raise HTTPException(400, str(exc))
    except Exception as exc: raise HTTPException(500, str(exc))


@router.post("/agents/taskforce")
async def create_taskforce(body: dict, x_tenant_id: str = Header(default="")):
    """Run a multi-agent TaskForce. Returns task_id immediately, streams via /api/stream/{task_id}."""
    k = _require()
    try:
        from kernelmcp.agents.taskforce import TaskForce
        from kernelmcp.agents import AgentConfig
        from kernelmcp.core.models import Task, TaskStatus, _now
        import asyncio

        goal = body.get("goal", "")
        pattern = body.get("pattern", "sequential")
        constitution = body.get("constitution", "")
        agent_specs = body.get("agents", [])
        blocking = body.get("blocking", False)  # Allow sync mode for backward compat
        dry_run = body.get("dry_run", False)  # Simulate: no tool executes, record intended calls
        # Optional linkage to a saved workflow/version — lets Observability offer
        # "Open in agent view" against the exact saved version (or fall back to the
        # captured graph when the run isn't linked / the version was deleted).
        workflow_id = body.get("workflow_id") or body.get("workflowId")
        version_id = body.get("version_id") or body.get("versionId")

        def _agent_llm(d: dict):
            """Resolve a per-agent/per-node connectionId into litellm-ready
            (model, api_key, base_url). Returns (None, None, None) when no
            connection is set — the agent then uses the shared global gateway."""
            cid = d.get("connectionId") or d.get("connection_id")
            if not cid:
                return None, None, None
            kw = resolve_connection(cid)
            if not kw:
                return None, None, None
            return kw.get("model"), kw.get("api_key"), kw.get("api_base")

        agents = []
        for spec in agent_specs:
            m, ak, bu = _agent_llm(spec)
            agents.append(AgentConfig(
                type=spec.get("type", "code"),
                role=spec.get("role", ""),
                tools=spec.get("tools", []),
                max_turns=spec.get("max_turns", 5),
                constitution=spec.get("constitution") or spec.get("instructions") or "",
                model=m, api_key=ak, base_url=bu,
            ))

        base_namespace = ns(x_tenant_id)
        graph = body.get("graph")  # Optional graph topology for pattern="graph"
        # Pre-resolve per-node connections into the graph node data so the GraphExecutor's
        # fallback AgentConfig (for nodes not matched by role) also gets the right model.
        if graph and graph.get("nodes"):
            for n in graph["nodes"]:
                if n.get("type") == "agent":
                    nd = n.get("data") or {}
                    m, ak, bu = _agent_llm(nd)
                    if m:
                        nd["_model"], nd["_api_key"], nd["_base_url"] = m, ak, bu
                        n["data"] = nd
        workspace_cfg = body.get("workspace")  # Optional workspace isolation

        # Create a Task object so SSE streaming and pause/resume work
        task = Task(goal=f"[TaskForce:{pattern}] {goal[:100]}", namespace=base_namespace)

        # Each run gets its own namespace to prevent cross-contamination
        # Events, memory writes, and workspace files are isolated per run
        namespace = f"{base_namespace}__run_{task.id[:8]}"
        task.namespace = namespace
        task.status = TaskStatus.running
        # Persist the topology + saved-workflow linkage so Observability can render the
        # real node/edge graph (read-only) and offer "Open in agent view". Strip the
        # pre-resolved private connection fields (_model/_api_key/_base_url) — they hold
        # credentials and must never reach the client or disk.
        if pattern == "graph" and graph:
            import copy as _copy
            safe_graph = _copy.deepcopy(graph)
            for _n in (safe_graph.get("nodes") or []):
                _d = _n.get("data") or {}
                for _k in ("_model", "_api_key", "_base_url"):
                    _d.pop(_k, None)
            task.metadata["graph"] = safe_graph
            task.metadata["pattern"] = pattern
        if workflow_id:
            task.metadata["workflow_id"] = workflow_id
        if version_id:
            task.metadata["version_id"] = version_id
        k._tasks[task.id] = task

        if pattern == "graph" and graph:
            from kernelmcp.agents.graph_executor import GraphExecutor
            executor = GraphExecutor(
                graph=graph, agents=agents, goal=goal,
                registry=k._agent_registry, namespace=namespace, task=task,
                # Loop bounds from Settings → Engine (None-safe; falls back to lib defaults).
                max_self_refines=settings.get("graph_max_self_refines"),
                max_feedback_runs=settings.get("graph_max_feedback_runs"),
                max_total_steps=settings.get("graph_max_total_steps"),
            )
            _active_executors[task.id] = executor
        else:
            tf = TaskForce(
                agents=agents, goal=goal, pattern=pattern,
                constitution=constitution, registry=k._agent_registry,
            )
            executor = None

        # Note: no need to clear buffer — each run gets a unique namespace (__run_XXXXX)
        # Buffered events are replayed on subscribe, which is the desired behavior

        async def _run_taskforce():
            try:
                from contextlib import nullcontext
                from kernelmcp.core.dryrun import dry_run_scope
                with (dry_run_scope() if dry_run else nullcontext(None)) as dry_calls:
                    if executor:
                        result = await executor.run()
                    else:
                        result = await tf.run(k._agent_registry, namespace=namespace)
                    if dry_run:
                        task.metadata["dry_run"] = True
                        task.metadata["dry_run_calls"] = dry_calls
                # Store result in task metadata BEFORE changing status
                # (status change triggers SSE terminal event, frontend fetches result after)
                agent_outputs = []
                for ar in (result.agent_results or []):
                    agent_outputs.append(ar.output if hasattr(ar, "output") else str(ar))
                task.metadata["result"] = {
                    "success": result.success,
                    "final_output": result.final_output,
                    "agent_outputs": agent_outputs,
                    "total_tokens": result.total_tokens,
                    "total_cost": result.total_cost,
                    "total_turns": getattr(result, "total_turns", 0) or sum(ar.turns_used for ar in (result.agent_results or [])),
                    "duration_ms": result.duration_ms,
                    "goal": result.goal,
                    "pattern": result.pattern,
                    "task_id": task.id,
                }
                task.total_tokens = result.total_tokens
                task.total_cost = result.total_cost
                task.status = TaskStatus.completed if result.success else TaskStatus.failed
                task.completed_at = _now()
                _persist_task(task)
                # Update regression baselines
                try:
                    from regression import regression_detector
                    regression_detector.update(goal, result.total_cost, getattr(result, "total_turns", 0) or sum(ar.turns_used for ar in (result.agent_results or [])), round(result.duration_ms or 0), result.success)
                except Exception:
                    pass
                # Emit terminal event AFTER metadata is written (so frontend can fetch result immediately)
                from kernelmcp.events import kernel_event_bus as _bus, KernelEvent as _KE, KernelEventType as _KET
                _evt = _KET.taskforce_completed if result.success else _KET.taskforce_failed
                await _bus.emit(_KE(type=_evt, namespace=namespace, data={
                    "source": "taskforce", "success": result.success, "goal": goal[:80],
                    "turns": getattr(result, "total_turns", 0) or sum(ar.turns_used for ar in (result.agent_results or [])),
                    "tokens": result.total_tokens,
                    "cost": result.total_cost,
                    "duration_ms": round(result.duration_ms or 0),
                }))
                _active_executors.pop(task.id, None)
            except Exception as exc:
                import traceback; traceback.print_exc()
                task.metadata["result"] = {"success": False, "final_output": str(exc), "error": str(exc)}
                task.status = TaskStatus.failed
                task.completed_at = _now()
                _persist_task(task)
                from kernelmcp.events import kernel_event_bus as _bus, KernelEvent as _KE, KernelEventType as _KET
                await _bus.emit(_KE(type=_KET.taskforce_failed, namespace=namespace, data={"source": "taskforce", "success": False, "error": str(exc)[:200]}))

        if blocking:
            blocking_timeout = body.get("timeout", 280)  # seconds
            try:
                await asyncio.wait_for(_run_taskforce(), timeout=blocking_timeout)
            except asyncio.TimeoutError:
                task.status = TaskStatus.failed
                task.metadata["result"] = {"success": False, "final_output": "Execution timed out", "error": "timeout"}
            return task.metadata.get("result", {})

        # Async mode: launch in background, return task_id for SSE streaming
        asyncio.create_task(_run_taskforce())
        return {"task_id": task.id, "status": "running", "goal": goal, "pattern": pattern}

    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        import traceback; traceback.print_exc()
        raise HTTPException(500, str(exc))
