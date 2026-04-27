from __future__ import annotations
import os
import json
import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from kernelmcp.factory import KernelFactory
from kernelmcp.core.models import TaskStatus
from kernelmcp.core.constitution import Constitution
from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType

# == LLM config ================================================================

_LLM_CONFIG_PATH = Path("/app/data/llm_config.json")

_PROVIDER_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-4-5-20251001",
    "ollama": "mistral",
    "openai_compatible": "mistral",
}


def _load_llm_config() -> dict:
    defaults = {"provider": "echo", "model": "", "api_key": "", "base_url": ""}
    if _LLM_CONFIG_PATH.exists():
        try:
            data = json.loads(_LLM_CONFIG_PATH.read_text())
            defaults.update({k: str(v) for k, v in data.items() if k in defaults})
        except Exception:
            pass
    return defaults


def _save_llm_config(cfg: dict) -> None:
    try:
        _LLM_CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass


_llm_config: dict = _load_llm_config()


def _is_docker() -> bool:
    return Path("/.dockerenv").exists()


def _ollama_default_url() -> str:
    return "http://host.docker.internal:11434" if _is_docker() else "http://localhost:11434"


def _resolve_url(url: str) -> str:
    if _is_docker() and url:
        return url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
    return url


def _litellm_kwargs() -> dict:
    provider = _llm_config["provider"]
    model = _llm_config["model"] or _PROVIDER_DEFAULT_MODELS.get(provider, "gpt-4o-mini")
    api_key = _llm_config["api_key"]
    base_url = _resolve_url(_llm_config["base_url"])
    kwargs: dict = {}
    if provider == "ollama":
        ollama_base = base_url or _ollama_default_url()
        if not ollama_base.endswith("/v1"):
            ollama_base = ollama_base.rstrip("/") + "/v1"
        kwargs["model"] = f"openai/{model}"
        kwargs["api_base"] = ollama_base
        kwargs["api_key"] = "ollama"
    elif provider == "openai_compatible":
        kwargs["model"] = model if "/" in model else f"openai/{model}"
        if base_url:
            kwargs["api_base"] = base_url
        if api_key:
            kwargs["api_key"] = api_key
    else:
        kwargs["model"] = model
        if api_key:
            kwargs["api_key"] = api_key
    return kwargs


# == App =======================================================================

app = FastAPI(title="KernelMCP Demo API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_NAMESPACE = os.getenv("KERNELMCP_NAMESPACE", "demo")
kernel = None


def _ns(x_tenant_id: str | None = None) -> str:
    return (x_tenant_id or "").strip() or DEFAULT_NAMESPACE


@app.on_event("startup")
async def startup():
    global kernel

    # Resolve LLM model from saved config
    llm_model = _llm_config["model"] or "claude-sonnet-4-6"
    api_key = _llm_config["api_key"] or os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = _resolve_url(_llm_config["base_url"]) or None

    # Try to upgrade LLM via litellm config
    provider = _llm_config["provider"]
    if provider == "ollama":
        ollama_base = base_url or _ollama_default_url()
        if not ollama_base.endswith("/v1"):
            ollama_base = ollama_base.rstrip("/") + "/v1"
        llm_model = f"openai/{llm_model}"
        base_url = ollama_base
        api_key = "ollama"
    elif provider == "openai_compatible":
        llm_model = llm_model if "/" in llm_model else f"openai/{llm_model}"

    # Try to connect all 5 suite libraries
    memory_pipeline = None
    planning_pipeline = None
    workspace_pipeline = None
    sandbox_pipeline = None

    try:
        from memorymcp import MemoryFactory
        memory_pipeline = MemoryFactory.default()
        print("[STARTUP] memorymcp connected", flush=True)
    except Exception as exc:
        print(f"[STARTUP] memorymcp not available: {exc}", flush=True)

    try:
        from planningmcp import PlanningFactory
        planning_pipeline = PlanningFactory.default()
        print("[STARTUP] planningmcp connected", flush=True)
    except Exception as exc:
        print(f"[STARTUP] planningmcp not available: {exc}", flush=True)

    try:
        from workspacemcp import WorkspaceFactory
        workspace_pipeline = WorkspaceFactory.create(root_path="/app/data/workspace", file_store="local", read_only=False, allowed_write_patterns=["*"])
        os.makedirs("/app/data/workspace", exist_ok=True)
        print("[STARTUP] workspacemcp connected", flush=True)
    except Exception as exc:
        print(f"[STARTUP] workspacemcp not available: {exc}", flush=True)

    try:
        from sandboxmcp import SandboxFactory
        sandbox_pipeline = SandboxFactory.default()
        print("[STARTUP] sandboxmcp connected", flush=True)
    except Exception as exc:
        print(f"[STARTUP] sandboxmcp not available: {exc}", flush=True)

    # Use the configured model for ALL routing (no split between cloud/local/fast)
    resolved_model = os.getenv("KERNELMCP_MODEL", llm_model)

    kernel = KernelFactory.create(
        llm_model=resolved_model,
        local_model=resolved_model,      # Same model everywhere
        fast_model=resolved_model,        # No split routing in demo
        api_key=api_key,
        base_url=base_url,
        enable_routing=False,             # Use single model
        max_turns=int(os.getenv("KERNELMCP_MAX_TURNS", "10")),
        max_tokens_per_task=int(os.getenv("KERNELMCP_MAX_TOKENS", "50000")),
        max_cost_per_task=float(os.getenv("KERNELMCP_MAX_COST", "1.0")),
        namespace=DEFAULT_NAMESPACE,
        memory_pipeline=memory_pipeline,
        planning_pipeline=planning_pipeline,
        workspace_pipeline=workspace_pipeline,
        sandbox_pipeline=sandbox_pipeline,
    )
    # Disable fallback chain — use only the configured provider
    kernel._engine._fallback = None
    connected = kernel.orchestrator.connected_count
    print(f"[STARTUP] KernelMCP initialized ({connected}/5 servers, model={resolved_model}, provider={provider}, namespace={DEFAULT_NAMESPACE})", flush=True)


# -- Request / Response Models -------------------------------------------------

class LLMConfigIn(BaseModel):
    provider: str
    model: str = ""
    api_key: str = ""
    base_url: str = ""


class TaskRequest(BaseModel):
    goal: str
    namespace: str = ""


class ConstitutionBody(BaseModel):
    rules: str


class WebhookBody(BaseModel):
    event: str
    data: dict = {}


# -- Health & Config -----------------------------------------------------------

@app.get("/health")
async def health(x_tenant_id: str = Header(default="")):
    if kernel is None:
        return {"status": "starting", "namespace": _ns(x_tenant_id)}
    h = await kernel.health()
    h["namespace"] = _ns(x_tenant_id)
    return h


@app.get("/config")
async def get_config():
    if kernel is None:
        return {}
    return {
        "config": kernel.config.model_dump(),
        "llm": {
            "provider": _llm_config["provider"],
            "model": _llm_config["model"],
            "has_api_key": bool(_llm_config["api_key"]),
        },
    }


# -- LLM config ---------------------------------------------------------------

@app.get("/llm/config")
async def get_llm_config():
    return {
        "provider": _llm_config["provider"],
        "model": _llm_config["model"],
        "base_url": _llm_config["base_url"],
        "has_api_key": bool(_llm_config["api_key"]),
    }


@app.post("/llm/config")
async def set_llm_config(cfg: LLMConfigIn):
    if cfg.provider == "echo":
        cfg.model = cfg.api_key = cfg.base_url = ""
    _llm_config.update(provider=cfg.provider, model=cfg.model, api_key=cfg.api_key, base_url=cfg.base_url)
    _save_llm_config(_llm_config)

    # Update the running kernel's LLM gateway + supervisor
    if kernel is not None:
        kwargs = _litellm_kwargs()
        model = kwargs.pop("model", cfg.model or "claude-sonnet-4-6")
        kernel._engine._llm._model = model
        kernel._engine._llm._api_key = kwargs.get("api_key")
        kernel._engine._llm._base_url = kwargs.get("api_base")
        # Update supervisor so routing uses the right model
        kernel._engine._supervisor._cloud = model
        kernel._engine._supervisor._fast = model
        kernel._engine._supervisor._local = model
        # Disable fallback chain (use only configured model)
        kernel._engine._fallback = None
        print(f"[KERNEL] LLM updated: model={model} api_base={kwargs.get('api_base')}", flush=True)

    return {"provider": cfg.provider, "model": cfg.model, "base_url": cfg.base_url, "has_api_key": bool(cfg.api_key)}


# -- Tasks ---------------------------------------------------------------------

# Background task futures
_running: dict[str, asyncio.Task] = {}


@app.post("/tasks")
async def create_task(body: TaskRequest, x_tenant_id: str = Header(default="")):
    ns = body.namespace or _ns(x_tenant_id)
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")

    # Build conversation context from recent tasks
    from kernelmcp.core.models import Task
    recent_tasks = sorted(
        [t for t in kernel._tasks.values() if t.namespace == ns and t.status.value == "completed"],
        key=lambda t: t.created_at, reverse=True,
    )[:3]  # Last 3 completed tasks

    # Inject recent context so the LLM understands follow-up questions
    goal = body.goal
    if recent_tasks:
        context_lines = []
        for rt in reversed(recent_tasks):
            last_answer = ""
            for turn in reversed(rt.turns):
                if turn.role.value == "assistant" and turn.content and len(turn.content) > 10:
                    last_answer = turn.content[:200]
                    break
            if last_answer:
                context_lines.append(f"User asked: {rt.goal[:100]}\nAssistant answered: {last_answer}")
        if context_lines:
            goal = "CONVERSATION HISTORY:\n" + "\n---\n".join(context_lines) + f"\n---\nNEW USER MESSAGE: {body.goal}"

    task = Task(goal=goal, namespace=ns)
    task.metadata["original_goal"] = body.goal
    kernel._tasks[task.id] = task

    async def _run():
        try:
            await kernel._engine.run(task)
            if task.status.value == "completed":
                kernel._stats.tasks_completed += 1
            else:
                kernel._stats.tasks_failed += 1
            kernel._stats.total_tokens += task.total_tokens
            kernel._stats.total_cost += task.total_cost
        except Exception as exc:
            from kernelmcp.core.models import TaskStatus, _now
            task.status = TaskStatus.failed
            task.completed_at = _now()
            kernel._stats.tasks_failed += 1

    future = asyncio.create_task(_run())
    _running[task.id] = future

    return {"id": task.id, "goal": task.goal, "status": task.status.value, "namespace": ns}


@app.get("/tasks")
async def list_tasks(x_tenant_id: str = Header(default="")):
    ns = _ns(x_tenant_id)
    if kernel is None:
        return {"tasks": [], "total": 0}
    tasks = await kernel.list_tasks(ns)
    return {
        "tasks": [t.model_dump(mode="json") for t in tasks],
        "total": len(tasks),
    }


def _flatten_turns(task) -> list[dict]:
    """Flatten Turn objects for the frontend chat view."""
    flat = []
    for t in task.turns:
        entry = {"role": t.role.value if hasattr(t.role, "value") else str(t.role), "content": t.content or ""}
        if t.tool_call:
            entry["tool_name"] = t.tool_call.tool_name
            entry["tool_args"] = t.tool_call.arguments
        if t.tool_result:
            entry["tool_result"] = t.tool_result.output or t.tool_result.error
            entry["tool_success"] = t.tool_result.success
        if t.model:
            entry["model"] = t.model
        if t.tokens_used:
            entry["tokens"] = t.tokens_used
        flat.append(entry)
    return flat


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    task = await kernel.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {
        "id": task.id,
        "goal": task.goal,
        "status": task.status.value if hasattr(task.status, "value") else str(task.status),
        "turns": _flatten_turns(task),
        "total_tokens": task.total_tokens,
        "total_cost": task.total_cost,
        "total_turns": task.total_turns,
        "namespace": task.namespace,
    }


@app.delete("/tasks/{task_id}")
async def cancel_task(task_id: str):
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    task = await kernel.cancel_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    # Also cancel the asyncio future if still running
    future = _running.pop(task_id, None)
    if future and not future.done():
        future.cancel()
    return task.model_dump(mode="json")


@app.get("/tasks/{task_id}/turns")
async def get_turns(task_id: str):
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    task = await kernel.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {
        "task_id": task_id,
        "turns": [t.model_dump(mode="json") for t in task.turns],
        "total": len(task.turns),
    }


# -- Stats ---------------------------------------------------------------------

@app.get("/stats")
async def stats():
    if kernel is None:
        return {}
    result = await kernel.get_stats()
    return result.model_dump(mode="json")


# -- Servers -------------------------------------------------------------------

@app.get("/servers")
async def list_servers():
    if kernel is None:
        return {"servers": {}, "connected": 0, "tools": 0}
    orch = kernel.orchestrator
    servers = {
        "memory": {"connected": orch.memory is not None, "tools": len(orch._memory_tools()) if orch.memory else 0},
        "planning": {"connected": orch.planning is not None, "tools": len(orch._planning_tools()) if orch.planning else 0},
        "rag": {"connected": orch.rag is not None, "tools": len(orch._rag_tools()) if orch.rag else 0},
        "workspace": {"connected": orch.workspace is not None, "tools": len(orch._workspace_tools()) if orch.workspace else 0},
        "sandbox": {"connected": orch.sandbox is not None, "tools": len(orch._sandbox_tools()) if orch.sandbox else 0},
    }
    total_tools = sum(s["tools"] for s in servers.values())
    return {
        "servers": servers,
        "connected": orch.connected_count,
        "tools": total_tools,
        "tool_registry": orch.get_tool_registry(),
    }


# -- Constitution --------------------------------------------------------------

@app.get("/constitution")
async def get_constitution():
    if kernel is None:
        return {"rules": ""}
    return {"rules": kernel._engine._constitution.rules}


@app.post("/constitution")
async def update_constitution(body: ConstitutionBody):
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    kernel._engine._constitution.update_rules(body.rules)
    return {"rules": kernel._engine._constitution.rules}


# -- Webhook -------------------------------------------------------------------

@app.post("/webhook")
async def trigger_webhook(body: WebhookBody, x_tenant_id: str = Header(default="")):
    ns = _ns(x_tenant_id)
    try:
        event = KernelEvent(
            type=KernelEventType.webhook_received,
            namespace=ns,
            message=body.event,
            data=body.data,
        )
        await kernel_event_bus.emit(event)
        return {"status": "emitted", "event": body.event, "namespace": ns}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
