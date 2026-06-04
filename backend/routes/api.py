"""Health, settings, workspace, agents, audit, egress, host, webhook endpoints."""
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

_SCHEDULES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "schedules")
os.makedirs(_SCHEDULES_DIR, exist_ok=True)

# In-memory egress state (mutable container to survive module-level issues)
_egress_state = {"enabled": False}

from pydantic import BaseModel
from models import LLMConfigIn, ConstitutionBody, WebhookBody, SpawnAgentRequest, SettingsIn
from stores import audit_collector

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


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
        total_tasks = stats_data["tasks_completed"] + stats_data["tasks_failed"]
        stats_data["avg_tokens_per_task"] = (
            stats_data["total_tokens"] / max(total_tasks, 1)
        )
        # Compute avg duration from actual tasks
        all_tasks = [t for t in k._tasks.values() if t.namespace == namespace or t.namespace.startswith(f"{namespace}__")]
        durations = [t.duration_ms for t in all_tasks if hasattr(t, "duration_ms") and t.duration_ms and t.duration_ms > 0]
        stats_data["avg_duration_ms"] = round(sum(durations) / max(len(durations), 1)) if durations else 0
        return {"result": stats_data}

    if tool_name == "list_tasks":
        # Include tasks from sub-namespaces (e.g. demo__run_xxx)
        all_tasks = list(k._tasks.values())
        tasks_list = [t for t in all_tasks if t.namespace == namespace or t.namespace.startswith(f"{namespace}__") or t.namespace.startswith(f"{namespace}")]
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
        return {"result": {"tasks": [
            {"task_id": t.id, "query": _task_label(t), "status": t.status.value,
             "created_at": t.created_at.timestamp() if t.created_at else 0,
             "duration_ms": round(t.duration_ms) if hasattr(t, "duration_ms") else None,
             "source": "chat" if t.metadata.get("conversation_id") else "taskforce",
             "tokens": t.total_tokens, "cost": round(t.total_cost, 6)}
            for t in tasks_list[:100]
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


# ── LLM Config ───────────────────────────────────────────────────────────────

@router.get("/llm/config")
async def get_llm_config():
    return {"provider": llm_config["provider"], "model": llm_config["model"], "base_url": llm_config["base_url"], "has_api_key": bool(llm_config["api_key"])}


@router.post("/llm/config")
async def set_llm_config(cfg: LLMConfigIn):
    if cfg.provider not in ("echo", "openai", "anthropic", "ollama", "groq", "cerebras", "gemini", "openai_compatible"):
        raise HTTPException(400, f"Unknown provider: {cfg.provider}")
    if cfg.provider == "echo":
        cfg.model = cfg.api_key = cfg.base_url = ""
    # Groq and cloud providers don't use base_url
    if cfg.provider in ("groq", "cerebras", "gemini", "openai", "anthropic"):
        cfg.base_url = ""
    # Keep existing API key if not provided (user left field empty)
    api_key = cfg.api_key or llm_config.get("api_key", "")
    llm_config.update(provider=cfg.provider, model=cfg.model, api_key=api_key, base_url=cfg.base_url)
    save_json(LLM_CONFIG_PATH, llm_config)
    if kernel is not None:
        kwargs = litellm_kwargs()
        model = kwargs.get("model", cfg.model or "claude-sonnet-4-6")
        kernel._engine._llm._model = model
        kernel._engine._llm._api_key = kwargs.get("api_key")
        kernel._engine._llm._base_url = kwargs.get("api_base")
        kernel._engine._supervisor._cloud = model
        kernel._engine._supervisor._fast = model
        kernel._engine._supervisor._local = model
        kernel._engine._fallback = None
        if kernel._agent_registry:
            kernel._agent_registry._llm._model = model
            kernel._agent_registry._llm._api_key = kwargs.get("api_key")
            kernel._agent_registry._llm._base_url = kwargs.get("api_base")
        print(f"[LLM] Updated: model={model}", flush=True)
    return {"provider": cfg.provider, "model": cfg.model, "base_url": cfg.base_url, "has_api_key": bool(cfg.api_key)}


# ── LLM Connections: saved {provider, key, model} combos, selectable per chat/agent ──
import secrets as _secrets2

_CONN_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "llm_connections")
_PROVIDERS = ("openai", "anthropic", "ollama", "groq", "cerebras", "gemini", "openai_compatible")


def _conn_path(cid: str) -> str:
    return os.path.join(_CONN_DIR, f"{cid}.json")


def _load_conn(cid: str):
    p = _conn_path(cid)
    return json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else None


def _save_conn(c: dict) -> None:
    os.makedirs(_CONN_DIR, exist_ok=True)
    with open(_conn_path(c["id"]), "w", encoding="utf-8") as f:
        json.dump(c, f)


def _all_conns() -> list:
    out = []
    if os.path.isdir(_CONN_DIR):
        for f in os.listdir(_CONN_DIR):
            if f.endswith(".json"):
                try:
                    out.append(json.load(open(os.path.join(_CONN_DIR, f), encoding="utf-8")))
                except Exception:
                    pass
    out.sort(key=lambda c: c.get("created_at", 0))
    return out


def _public_conn(c: dict) -> dict:
    return {"id": c["id"], "name": c.get("name"), "provider": c.get("provider"),
            "model": c.get("model"), "base_url": c.get("base_url", ""),
            "has_api_key": bool(c.get("api_key")), "is_default": bool(c.get("is_default")),
            "created_at": c.get("created_at")}


def resolve_connection(cid: str) -> dict | None:
    """Resolve a saved connection into litellm kwargs (model/api_key/api_base)."""
    c = _load_conn(cid)
    if not c:
        return None
    return litellm_kwargs({"provider": c.get("provider"), "model": c.get("model"),
                           "api_key": c.get("api_key", ""), "base_url": c.get("base_url", "")})


def _apply_llm_to_kernel(kwargs: dict) -> None:
    if kernel is None:
        return
    model = kwargs.get("model")
    kernel._engine._llm._model = model
    kernel._engine._llm._api_key = kwargs.get("api_key")
    kernel._engine._llm._base_url = kwargs.get("api_base")
    kernel._engine._supervisor._cloud = model
    kernel._engine._supervisor._fast = model
    kernel._engine._supervisor._local = model
    kernel._engine._fallback = None
    if kernel._agent_registry:
        kernel._agent_registry._llm._model = model
        kernel._agent_registry._llm._api_key = kwargs.get("api_key")
        kernel._agent_registry._llm._base_url = kwargs.get("api_base")


def _activate_connection_globally(c: dict) -> None:
    """Make a connection the live config: persist into llm_config (so it survives
    restart + the Settings tab reflects it) AND hot-reload the running kernel."""
    llm_config.update(provider=c.get("provider"), model=c.get("model", ""),
                      api_key=c.get("api_key", ""), base_url=c.get("base_url", ""))
    save_json(LLM_CONFIG_PATH, llm_config)
    _apply_llm_to_kernel(litellm_kwargs())


@router.get("/llm/connections")
async def list_llm_connections():
    return {"connections": [_public_conn(c) for c in _all_conns()]}


@router.post("/llm/connections")
async def create_llm_connection(body: dict):
    provider = body.get("provider")
    if provider not in _PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    cid = "conn_" + _secrets2.token_hex(4)
    existing = _all_conns()
    conn = {
        "id": cid, "name": (body.get("name") or "").strip() or f"{provider}:{body.get('model', '')}",
        "provider": provider, "model": body.get("model", ""),
        "api_key": body.get("api_key", ""), "base_url": body.get("base_url", ""),
        "is_default": bool(body.get("make_default")) or len(existing) == 0,
        "created_at": _time.time(),
    }
    if conn["is_default"]:
        for c in existing:
            if c.get("is_default"):
                c["is_default"] = False
                _save_conn(c)
    _save_conn(conn)
    if conn["is_default"]:
        _activate_connection_globally(conn)
    return _public_conn(conn)


@router.put("/llm/connections/{cid}")
async def update_llm_connection(cid: str, body: dict):
    c = _load_conn(cid)
    if not c:
        raise HTTPException(404, "connection not found")
    if "name" in body:
        c["name"] = body["name"]
    if "provider" in body and body["provider"] in _PROVIDERS:
        c["provider"] = body["provider"]
    if "model" in body:
        c["model"] = body["model"]
    if "base_url" in body:
        c["base_url"] = body["base_url"]
    if body.get("api_key"):  # only overwrite key if a new one is provided
        c["api_key"] = body["api_key"]
    _save_conn(c)
    if c.get("is_default"):
        _activate_connection_globally(c)
    return _public_conn(c)


@router.post("/llm/connections/{cid}/default")
async def set_default_connection(cid: str):
    c = _load_conn(cid)
    if not c:
        raise HTTPException(404, "connection not found")
    for other in _all_conns():
        if other.get("is_default") and other["id"] != cid:
            other["is_default"] = False
            _save_conn(other)
    c["is_default"] = True
    _save_conn(c)
    _activate_connection_globally(c)
    return _public_conn(c)


@router.delete("/llm/connections/{cid}")
async def delete_llm_connection(cid: str):
    c = _load_conn(cid)
    if not c:
        raise HTTPException(404, "connection not found")
    os.remove(_conn_path(cid))
    # If we removed the default, promote the oldest remaining one
    if c.get("is_default"):
        rest = _all_conns()
        if rest:
            rest[0]["is_default"] = True
            _save_conn(rest[0])
            _activate_connection_globally(rest[0])
    return {"deleted": cid}


# ── Environment Variables: secrets/config exposed to tools/MCP as process env ──
_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "env_vars.json")

# Persistence for runtime-registered integrations so they survive restarts.
_DATA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_MCP_SERVERS_PATH = os.path.join(_DATA, "mcp_servers.json")
_LC_TOOLS_PATH = os.path.join(_DATA, "langchain_tools.json")


def _load_list(path: str) -> list:
    try:
        return json.load(open(path, encoding="utf-8")) if os.path.isfile(path) else []
    except Exception:
        return []


def _save_list(path: str, data: list) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def _load_env_store() -> dict:
    try:
        return json.load(open(_ENV_PATH, encoding="utf-8")) if os.path.isfile(_ENV_PATH) else {}
    except Exception:
        return {}


def _save_env_store(d: dict) -> None:
    os.makedirs(os.path.dirname(_ENV_PATH), exist_ok=True)
    with open(_ENV_PATH, "w", encoding="utf-8") as f:
        json.dump(d, f)


def _inject_env() -> None:
    """Load saved vars into the process environment (called at import + on change)."""
    for k, v in _load_env_store().items():
        try:
            os.environ[k] = str(v.get("value", ""))
        except Exception:
            pass


_inject_env()


@router.get("/env")
async def list_env():
    store = _load_env_store()
    out = []
    for k, v in sorted(store.items()):
        secret = bool(v.get("secret", True))
        out.append({"key": k, "secret": secret,
                    "preview": "" if secret else str(v.get("value", "")),
                    "updated_at": v.get("updated_at")})
    return {"vars": out}


@router.get("/env/{key}")
async def get_env(key: str):
    v = _load_env_store().get(key)
    if v is None:
        raise HTTPException(404, "variable not found")
    return {"key": key, "value": v.get("value", ""), "secret": bool(v.get("secret", True))}


@router.post("/env")
async def set_env(body: dict):
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key is required")
    store = _load_env_store()
    store[key] = {"value": body.get("value", ""), "secret": bool(body.get("secret", True)),
                  "updated_at": int(_time.time() * 1000)}
    _save_env_store(store)
    os.environ[key] = str(body.get("value", ""))
    return {"key": key, "secret": store[key]["secret"]}


@router.delete("/env/{key}")
async def delete_env(key: str):
    store = _load_env_store()
    if key not in store:
        raise HTTPException(404, "variable not found")
    del store[key]
    _save_env_store(store)
    os.environ.pop(key, None)
    return {"deleted": key}


# ── Test Connection ──────────────────────────────────────────────────────────

class TestConnectionRequest(BaseModel):
    service: str  # llm, redis, neo4j, qdrant, pgvector, milvus
    url: str = ""
    api_key: str = ""
    user: str = ""
    password: str = ""
    model: str = ""
    provider: str = ""


@router.post("/test-connection")
async def test_connection(body: TestConnectionRequest):
    """Test connectivity to a backend service before saving settings."""
    service = body.service
    try:
        if service == "llm":
            import litellm
            litellm.drop_params = True
            # Use litellm_kwargs() which handles provider-specific routing (Groq, Ollama, etc.)
            kw = litellm_kwargs()
            # Override with test-specific values if provided
            if body.api_key:
                kw["api_key"] = body.api_key
            if body.model:
                kw["model"] = body.model
            kw["messages"] = [{"role": "user", "content": "hi"}]
            kw["max_tokens"] = 5
            resp = await litellm.acompletion(**kw)
            return {"ok": True, "detail": f"Connected. Model: {resp.model}"}

        elif service == "redis":
            try:
                import redis.asyncio as aioredis
            except ImportError:
                return {"ok": False, "detail": "redis package not installed. Run: pip install redis"}
            r = aioredis.from_url(body.url or "redis://localhost:6379", decode_responses=True, socket_timeout=5)
            pong = await r.ping()
            info = await r.info("server")
            await r.aclose()
            return {"ok": pong, "detail": f"Redis {info.get('redis_version', '?')}"}

        elif service == "neo4j":
            try:
                from neo4j import AsyncGraphDatabase
            except ImportError:
                return {"ok": False, "detail": "neo4j package not installed. Run: pip install neo4j"}
            driver = AsyncGraphDatabase.driver(body.url or "bolt://localhost:7687", auth=(body.user or "neo4j", body.password))
            async with driver.session() as session:
                result = await session.run("RETURN 1 AS n")
                await result.consume()
            await driver.close()
            return {"ok": True, "detail": "Neo4j connected"}

        elif service == "qdrant":
            import httpx
            url = (body.url or "http://localhost:6333").rstrip("/")
            headers = {"api-key": body.api_key} if body.api_key else {}
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{url}/collections", headers=headers)
                data = resp.json()
            collections = len(data.get("result", {}).get("collections", []))
            return {"ok": resp.status_code == 200, "detail": f"Qdrant OK. {collections} collections."}

        elif service == "pgvector":
            try:
                import asyncpg
            except ImportError:
                return {"ok": False, "detail": "asyncpg package not installed. Run: pip install asyncpg"}
            conn = await asyncpg.connect(body.url, timeout=5)
            version = await conn.fetchval("SELECT version()")
            has_vector = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')")
            await conn.close()
            return {"ok": True, "detail": f"{'pgvector enabled' if has_vector else 'pgvector NOT installed'}. {version.split(',')[0]}"}

        elif service == "milvus":
            import httpx
            url = (body.url or "http://localhost:19530").rstrip("/")
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{url}/v2/vectordb/collections/list")
            return {"ok": resp.status_code == 200, "detail": "Milvus connected"}

        elif service == "memory":
            if not kernel or not kernel._engine._orchestrator.memory:
                return {"ok": False, "detail": "Memory pipeline not connected"}
            m = kernel._engine._orchestrator.memory
            stats = await m.stats("default")
            return {"ok": True, "detail": f"Memory OK. {stats.fact_count} facts, episodic: {type(m.episodic).__name__}"}

        elif service == "workspace":
            if not kernel or not kernel._engine._orchestrator.workspace:
                return {"ok": False, "detail": "Workspace pipeline not connected"}
            w = kernel._engine._orchestrator.workspace
            files = await w.list_files("", namespace="default")
            return {"ok": True, "detail": f"Workspace OK. {len(files)} files in default namespace."}

        elif service == "sandbox":
            if not kernel or not kernel._engine._orchestrator.sandbox:
                return {"ok": False, "detail": "Sandbox pipeline not connected"}
            from sandboxmcp import ExecutionRequest, Language
            s = kernel._engine._orchestrator.sandbox
            result = await s.execute(
                ExecutionRequest(code="print('ok')", language=Language.python, namespace="healthcheck")
            )
            backend = getattr(s, "_backend", None) or getattr(s, "backend", None)
            backend_name = type(backend).__name__ if backend else "process"
            return {"ok": result.exit_code == 0, "detail": f"Sandbox {'OK' if result.exit_code == 0 else 'FAILED'}. Backend: {backend_name}"}

        elif service == "scheduler":
            if not kernel or not kernel._engine._orchestrator.scheduler:
                return {"ok": False, "detail": "Scheduler pipeline not connected"}
            s = kernel._engine._orchestrator.scheduler
            stats = await s.stats()
            return {"ok": True, "detail": f"Scheduler OK. {stats.total_jobs} jobs, running: {s._running}"}

        elif service == "rag":
            if not kernel or not kernel._engine._orchestrator.rag:
                return {"ok": False, "detail": "RAG pipeline not connected"}
            r = kernel._engine._orchestrator.rag
            return {"ok": True, "detail": f"RAG OK. Embedder: {type(r.embedder).__name__}, Store: {type(r.vectorstore).__name__}"}

        elif service == "planning":
            if not kernel or not kernel._engine._orchestrator.planning:
                return {"ok": False, "detail": "Planning pipeline not connected"}
            p = kernel._engine._orchestrator.planning
            store = getattr(p, "_store", None) or getattr(p, "_plan_store", None) or getattr(p, "store", None)
            store_name = type(store).__name__ if store else "unknown"
            templates = p.available_templates() if hasattr(p, "available_templates") else []
            return {"ok": True, "detail": f"Planning OK. Store: {store_name}, templates: {len(templates)}"}

        elif service == "searxng":
            import httpx
            url = os.environ.get("SEARXNG_URL", "http://searxng:8080")
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{url}/healthz")
            return {"ok": resp.status_code == 200, "detail": f"SearXNG {'OK' if resp.status_code == 200 else 'DOWN'} at {url}"}

        else:
            return {"ok": False, "detail": f"Unknown service: {service}"}

    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:300]}


# ── Unified Settings ─────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings():
    return {"provider": llm_config["provider"], "model": llm_config["model"], "base_url": llm_config["base_url"], "api_key": "", "has_api_key": bool(llm_config.get("api_key")), **settings}


@router.post("/settings")
async def save_settings(body: SettingsIn):
    k = kernel
    updates = body.model_dump(exclude_none=True)
    # LLM
    llm_fields = {"provider", "model", "api_key", "base_url"}
    llm_changes = {key: v for key, v in updates.items() if key in llm_fields}
    if llm_changes:
        cfg = LLMConfigIn(provider=llm_changes.get("provider", llm_config["provider"]), model=llm_changes.get("model", llm_config["model"]), api_key=llm_changes.get("api_key", llm_config["api_key"]), base_url=llm_changes.get("base_url", llm_config["base_url"]))
        await set_llm_config(cfg)
    # Engine
    if "execution_mode" in updates and k:
        m = updates["execution_mode"]
        if m in ("react", "ltp", "hybrid"): k._engine._mode = m
    if "max_turns" in updates and k: k._engine._max_turns = updates["max_turns"]
    if "max_tokens" in updates and k: k.config.max_tokens_per_task = updates["max_tokens"]
    # Sandbox
    if k and k._engine._orchestrator.sandbox:
        sb = k._engine._orchestrator.sandbox
        if "sandbox_timeout" in updates and hasattr(sb, '_timeout'): sb._timeout = updates["sandbox_timeout"]
        if "auto_approve" in updates and hasattr(sb, '_host_guard') and sb._host_guard: sb._host_guard.auto_approve = updates["auto_approve"]
    # Scheduler
    if k and k._engine._orchestrator.scheduler:
        sched = k._engine._orchestrator.scheduler
        if "scheduler_enabled" in updates:
            if updates["scheduler_enabled"] and not sched._running: sched.start()
            elif not updates["scheduler_enabled"] and sched._running: sched.stop()
    # RAG embedder hot-reload
    if "rag_embedding_model" in updates and k and k._engine._orchestrator.rag:
        new_model = updates["rag_embedding_model"]
        rag = k._engine._orchestrator.rag
        current = getattr(rag.embedder, '_model_name', getattr(rag.embedder, 'model', ''))
        if new_model and new_model != current:
            try:
                from ragmcp.embedders.fastembed_embedder import FastEmbedEmbedder
                print(f"[RAG] Switching: {current} -> {new_model}", flush=True)
                new_emb = FastEmbedEmbedder(model=new_model)
                rag.embedder = new_emb
                try:
                    import httpx
                    vs_url = os.getenv("RAGMCP_VECTORSTORE_URL", "http://localhost:6333")
                    if is_docker(): vs_url = vs_url.replace("localhost", "host.docker.internal")
                    httpx.delete(f"{vs_url}/collections/ragmcp", timeout=5)
                except Exception: pass
                if hasattr(rag, '_vectorstore') and hasattr(rag._vectorstore, '_collection_name'):
                    from ragmcp.vectorstores.qdrant_store import QdrantStore
                    vs_url = os.getenv("RAGMCP_VECTORSTORE_URL", "http://localhost:6333")
                    if is_docker(): vs_url = vs_url.replace("localhost", "host.docker.internal")
                    dim = len(list(new_emb.embed(["test"]))[0])
                    rag._vectorstore = QdrantStore(url=vs_url, collection="ragmcp", dimension=dim)
                print(f"[RAG] Switched to {new_model}", flush=True)
            except Exception as exc:
                print(f"[RAG] Switch failed: {exc}", flush=True)
    # Save
    for key in DEFAULT_SETTINGS:
        if key in updates: settings[key] = updates[key]
    save_json(SETTINGS_PATH, settings)
    return {"saved": True, **settings}


# ── Constitution ─────────────────────────────────────────────────────────────

@router.get("/constitution")
async def get_constitution():
    k = _require()
    c = k._engine._constitution
    return {
        "rules": c.user_rules if hasattr(c, 'user_rules') else c.rules,
        "meta_rules": c.meta_rules if hasattr(c, 'meta_rules') else [],
        "effective": c.render() if hasattr(c, 'render') else c.rules,
    }


@router.post("/constitution")
async def update_constitution(body: ConstitutionBody):
    k = _require()
    k._engine._constitution.update_rules(body.rules)
    # Propagate dynamic layers only (meta + user) to agent runtime
    k._engine._llm._custom_agent_rules = k._engine._constitution.render_dynamic_rules()
    return {"rules": body.rules, "updated": True}


# ── Egress ───────────────────────────────────────────────────────────────────

def _get_egress():
    if kernel and kernel._engine._orchestrator.sandbox:
        return kernel._engine._orchestrator.sandbox._network
    return None


# Per-tenant egress config (domains allowed per namespace)
_tenant_egress: dict[str, set[str]] = {}


def _get_tenant_egress(tenant_ns: str) -> set[str]:
    if tenant_ns not in _tenant_egress:
        cfg = load_json(DATA_DIR / f"egress_{tenant_ns}.json", {"allowed_domains": []})
        _tenant_egress[tenant_ns] = set(cfg.get("allowed_domains", []))
    return _tenant_egress[tenant_ns]


def _save_tenant_egress(tenant_ns: str) -> None:
    save_json(DATA_DIR / f"egress_{tenant_ns}.json", {"allowed_domains": list(_tenant_egress.get(tenant_ns, set()))})


@router.get("/egress")
async def get_egress(x_tenant_id: str = Header(default="")):
    net = _get_egress()
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    return {"enabled": _egress_state["enabled"], "allowed_domains": list(tenant_domains)}


@router.post("/egress/toggle")
async def toggle_egress(enabled: bool = Query(None)):
    if enabled is None:
        enabled = not _egress_state["enabled"]
    _egress_state["enabled"] = enabled
    net = _get_egress()
    if net: net._enabled = enabled
    save_json(EGRESS_CONFIG_PATH, {"enabled": enabled})
    # Push config to orchestrator for egress guard
    if kernel:
        orch = kernel._engine._orchestrator
        if not hasattr(orch, '_egress_config'):
            orch._egress_config = {}
        orch._egress_config["enabled"] = enabled
    return {"enabled": _egress_state["enabled"]}


@router.post("/egress/allow")
async def allow_domain(domain: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    tenant_domains.add(domain)
    _tenant_egress[tenant_ns] = tenant_domains
    net = _get_egress()
    if net: net._global_allowed = getattr(net, "_global_allowed", set()) | {domain}
    _save_tenant_egress(tenant_ns)
    # Push to orchestrator
    if kernel:
        orch = kernel._engine._orchestrator
        if not hasattr(orch, '_egress_config'):
            orch._egress_config = {}
        orch._egress_config["allowed_domains"] = list(tenant_domains)
    return {"domain": domain}


@router.delete("/egress/allow")
async def remove_domain(domain: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    tenant_domains.discard(domain)
    _tenant_egress[tenant_ns] = tenant_domains
    _save_tenant_egress(tenant_ns)
    if kernel:
        orch = kernel._engine._orchestrator
        if not hasattr(orch, '_egress_config'):
            orch._egress_config = {}
        orch._egress_config["allowed_domains"] = list(tenant_domains)
    return {"removed": domain}


# ── Host Access ──────────────────────────────────────────────────────────────

def _get_host_guard(tenant_ns: str = "default"):
    if kernel and kernel._engine._orchestrator.sandbox:
        return kernel._engine._orchestrator._get_host_guard(kernel._engine._orchestrator.sandbox, tenant_ns)
    return None


@router.get("/host")
async def get_host_access(x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    g = _get_host_guard(tenant_ns)
    approved = list(getattr(g, "_approved", getattr(g, "approved", []))) if g else []
    # Aggregate pending from ALL namespace guards (agent runs use sub-namespaces)
    pending = []
    if kernel:
        orch = kernel._engine._orchestrator
        for guard_ns, guard in getattr(orch, '_host_guards', {}).items():
            if guard_ns.startswith(tenant_ns):
                for key in list(getattr(guard, "_pending", {}).keys()):
                    parts = key.split(":", 1)
                    pattern = parts[1] if len(parts) > 1 else parts[0]
                    pending.append({"pattern": pattern, "key": key, "namespace": guard_ns})
    return {"approved": approved, "pending": pending}


@router.post("/host/approve")
async def approve_host(pattern: str = Query(...), guard_ns: str = Query(None), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    if pattern == "*": raise HTTPException(400, "Wildcard not allowed")
    # Try to find the guard with the pending request (might be in a sub-namespace)
    approved = False
    if kernel and guard_ns:
        orch = kernel._engine._orchestrator
        g = getattr(orch, '_host_guards', {}).get(guard_ns)
        if g and hasattr(g, "approve_access"):
            g.approve_access(guard_ns, pattern)
            approved = True
    if not approved:
        # Fallback: try all guards that match the tenant
        if kernel:
            orch = kernel._engine._orchestrator
            for gns, guard in getattr(orch, '_host_guards', {}).items():
                if gns.startswith(tenant_ns) and hasattr(guard, "_pending"):
                    for key in list(guard._pending.keys()):
                        if pattern in key:
                            guard.approve_access(gns, pattern)
                            approved = True
                            break
                if approved: break
    if not approved:
        g = _get_host_guard(tenant_ns)
        if not g: raise HTTPException(503, "No host guard")
        if hasattr(g, "approve_access"):
            g.approve_access(tenant_ns, pattern)
        else:
            g._approved.append(pattern)
    save_json(DATA_DIR / f"host_config_{tenant_ns}.json", {"approved": list(getattr(g, "_approved", getattr(g, "approved", [])))})
    return {"approved": pattern}


@router.delete("/host/approve")
async def revoke_host(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    g = _get_host_guard(ns(x_tenant_id))
    if g:
        approved = getattr(g, "_approved", getattr(g, "approved", []))
        for i, p in enumerate(approved):
            if p == pattern:
                approved.pop(i)
                break
    return {"revoked": pattern}


@router.post("/host/deny")
async def deny_host(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    g = _get_host_guard(tenant_ns)
    if g and hasattr(g, "deny_access"):
        g.deny_access(tenant_ns, pattern)
    return {"denied": pattern}


@router.post("/host/block-safe")
async def block_safe_pattern(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    """Remove a pattern from safe (auto-allowed) list and add to blocked."""
    g = _get_host_guard(ns(x_tenant_id))
    if not g:
        raise HTTPException(503, "No host guard")
    # Remove from safe/always_allowed
    always = getattr(g, '_always_allowed', [])
    if isinstance(always, list):
        try: always.remove(pattern)
        except ValueError: pass
    elif isinstance(always, set):
        always.discard(pattern)
    # Add to blocked
    blocked = getattr(g, '_blocked', getattr(g, '_denied', []))
    if isinstance(blocked, list) and pattern not in blocked:
        blocked.append(pattern)
    elif isinstance(blocked, set):
        blocked.add(pattern)
    audit_collector.emit("host", "safe_pattern_blocked", {"pattern": pattern})
    return {"blocked": pattern}


@router.post("/host/unblock")
async def unblock_pattern(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    """Remove a pattern from blocked list."""
    g = _get_host_guard(ns(x_tenant_id))
    if not g:
        raise HTTPException(503, "No host guard")
    blocked = getattr(g, '_blocked', getattr(g, '_denied', []))
    if isinstance(blocked, list):
        try: blocked.remove(pattern)
        except ValueError: pass
    elif isinstance(blocked, set):
        blocked.discard(pattern)
    audit_collector.emit("host", "pattern_unblocked", {"pattern": pattern})
    return {"unblocked": pattern}


# ── Vault (Secrets Management) ──────────────────────────────────────────────

@router.get("/vault/secrets")
async def list_vault_secrets(x_tenant_id: str = Header(default="")):
    k = _require()
    orch = k._engine._orchestrator
    v = getattr(orch.sandbox, '_vault', None) if hasattr(orch, 'sandbox') and orch.sandbox else None
    if not v:
        return {"keys": []}
    keys = await v.list_keys(ns(x_tenant_id) or "default")
    return {"keys": keys}

@router.post("/vault/secrets")
async def add_vault_secret(body: dict, x_tenant_id: str = Header(default="")):
    k = _require()
    orch = k._engine._orchestrator
    v = getattr(orch.sandbox, '_vault', None) if hasattr(orch, 'sandbox') and orch.sandbox else None
    if not v:
        raise HTTPException(503, "Vault not available")
    key = body.get("key", "").strip()
    value = body.get("value", "")
    if not key:
        raise HTTPException(400, "Key required")
    await v.set_secret(ns(x_tenant_id) or "default", key, value)
    audit_collector.emit("vault", "secret_added", {"key": key})
    return {"key": key, "added": True}

@router.delete("/vault/secrets")
async def delete_vault_secret(key: str = Query(...), x_tenant_id: str = Header(default="")):
    k = _require()
    orch = k._engine._orchestrator
    v = getattr(orch.sandbox, '_vault', None) if hasattr(orch, 'sandbox') and orch.sandbox else None
    if not v:
        raise HTTPException(503, "Vault not available")
    await v.delete_secret(ns(x_tenant_id) or "default", key)
    audit_collector.emit("vault", "secret_deleted", {"key": key})
    return {"key": key, "deleted": True}


# ── Security Settings ───────────────────────────────────────────────────────

@router.post("/security/settings")
async def update_security_settings(body: dict):
    """Update security settings (code safety, host access, sandbox limits)."""
    k = _require()
    orch = k._engine._orchestrator
    result = {}

    # Code safety: reject_dangerous
    if "reject_dangerous" in body:
        val = bool(body["reject_dangerous"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v:
                v.reject_dangerous = val
                result["reject_dangerous"] = val

    # Code safety: auto_fix
    if "auto_fix" in body:
        val = bool(body["auto_fix"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v:
                v.auto_fix_enabled = val
                result["auto_fix"] = val

    # Host: auto_approve
    if "auto_approve" in body:
        val = bool(body["auto_approve"])
        hg = getattr(orch, '_host_guard', None) or getattr(orch, 'host_guard', None)
        if hg:
            hg._auto_approve = val
            result["auto_approve"] = val

    # Sandbox: timeout, max_ram
    if "sandbox_timeout" in body:
        val = int(body["sandbox_timeout"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            orch.sandbox._timeout = val
            result["sandbox_timeout"] = val

    if "sandbox_max_ram" in body:
        val = int(body["sandbox_max_ram"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            orch.sandbox._max_ram_mb = val
            result["sandbox_max_ram"] = val

    # Code safety: toggle individual patterns
    if "disable_pattern" in body:
        name = str(body["disable_pattern"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v and hasattr(v, 'disable_pattern'):
                v.disable_pattern(name)
                result["disabled_pattern"] = name

    if "enable_pattern" in body:
        name = str(body["enable_pattern"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v and hasattr(v, 'enable_pattern'):
                v.enable_pattern(name)
                result["enabled_pattern"] = name

    # DLP: toggle individual patterns
    if "disable_dlp_pattern" in body:
        name = str(body["disable_dlp_pattern"])
        if not hasattr(k, '_disabled_dlp_patterns'):
            k._disabled_dlp_patterns = set()
        k._disabled_dlp_patterns.add(name)
        result["disabled_dlp_pattern"] = name

    if "enable_dlp_pattern" in body:
        name = str(body["enable_dlp_pattern"])
        if hasattr(k, '_disabled_dlp_patterns'):
            k._disabled_dlp_patterns.discard(name)
        result["enabled_dlp_pattern"] = name

    # Sandbox: network mode
    if "sandbox_network" in body:
        val = bool(body["sandbox_network"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            backend = getattr(orch.sandbox, '_backend', None)
            if backend and hasattr(backend, '_network_mode'):
                backend._network_mode = "bridge" if val else "none"
                result["sandbox_network"] = val
            ng = getattr(orch.sandbox, '_network', None)
            if ng and hasattr(ng, '_enabled'):
                # Sync network guard with sandbox network mode
                pass

    audit_collector.emit("security", "settings_changed", result)
    return {"updated": result}


# ── Security Posture & Audit ────────────────────────────────────────────────

@router.get("/security/posture")
async def security_posture(x_tenant_id: str = Header(default="")):
    k = _require()
    namespace = ns(x_tenant_id)
    orch = k._engine._orchestrator

    # Egress
    _eg_ns = ns(x_tenant_id)
    _eg_domains = list(_get_tenant_egress(_eg_ns))
    egress_data = {"enabled": _egress_state["enabled"], "allowed_domains": _eg_domains, "pending_count": 0}

    # Host
    host_data = {"approved_count": 0, "pending_count": 0, "blocked_count": 0, "auto_approve": False,
                 "approved_patterns": [], "blocked_patterns": [], "safe_patterns": []}
    hg = getattr(orch, '_host_guards', {}).get(namespace) or getattr(orch, '_host_guards', {}).get("default")
    if not hg and hasattr(orch, 'sandbox'):
        hg = getattr(orch.sandbox, '_host_guard', None)
    if hg:
        host_data["approved_patterns"] = list(getattr(hg, '_approved', []))
        host_data["approved_count"] = len(host_data["approved_patterns"])
        host_data["blocked_patterns"] = list(getattr(hg, '_blocked', []))
        host_data["blocked_count"] = len(host_data["blocked_patterns"])
        host_data["safe_patterns"] = list(getattr(hg, '_always_allowed', []))
        host_data["auto_approve"] = getattr(hg, '_auto_approve', False)
        pending = getattr(hg, '_pending', {})
        host_data["pending_count"] = len(pending)

    # Validator
    validator_data = {"reject_dangerous": True, "auto_fix": True, "disabled_patterns": []}
    if hasattr(orch, 'sandbox') and orch.sandbox:
        v = getattr(orch.sandbox, '_validator', None)
        if v:
            validator_data["reject_dangerous"] = getattr(v, 'reject_dangerous', True)
            validator_data["auto_fix"] = getattr(v, 'auto_fix_enabled', True)
            validator_data["disabled_patterns"] = list(getattr(v, '_disabled_patterns', set()))

    # Sandbox limits
    sandbox_data = {"timeout": 60, "max_ram_mb": 512, "network_enabled": True}
    if hasattr(orch, 'sandbox') and orch.sandbox:
        sandbox_data["timeout"] = getattr(orch.sandbox, '_timeout', 60)
        sandbox_data["max_ram_mb"] = getattr(orch.sandbox, '_max_ram_mb', 512)
        backend = getattr(orch.sandbox, '_backend', None)
        if backend:
            sandbox_data["network_enabled"] = getattr(backend, '_network_mode', 'none') != 'none'

    # Constitution
    const_data = {"rules_count": 0, "has_custom_rules": False, "rules": "", "effective": "", "active_templates": []}
    if hasattr(k._engine, '_constitution') and k._engine._constitution:
        c = k._engine._constitution
        rules = getattr(c, '_user_rules', '') or getattr(c, '_rules', '') or ''
        const_data["rules"] = rules
        const_data["rules_count"] = len([l for l in rules.split('\n') if l.strip()]) if rules else 0
        const_data["has_custom_rules"] = bool(rules.strip())
        const_data["effective"] = getattr(c, 'render', lambda: rules)() if hasattr(c, 'render') else rules
        # Detect active templates by header markers
        _TPL_IDS = {"Safety First": "safety", "Privacy & Data": "privacy", "Code Quality": "quality", "Web Safety": "web", "French Output": "language", "Concise Mode": "concise", "Always Plan": "planning", "Workspace Hygiene": "workspace"}
        const_data["active_templates"] = [tid for label, tid in _TPL_IDS.items() if f"## {label}" in rules]

    # Vault
    vault_data = {"secret_count": 0}
    if hasattr(orch, 'sandbox') and orch.sandbox:
        v = getattr(orch.sandbox, '_vault', None)
        if v:
            # Try to count secrets across known namespaces
            try:
                keys = getattr(v, 'list_keys', lambda ns: [])(namespace)
                if asyncio.iscoroutine(keys): keys = await keys
                vault_data["secret_count"] = len(keys) if keys else 0
            except: pass

    return {
        "egress": egress_data,
        "host": host_data,
        "validator": validator_data,
        "sandbox": sandbox_data,
        "constitution": const_data,
        "vault": vault_data,
        "dlp": {"patterns_count": 14, "enabled": True, "disabled_patterns": list(getattr(k, '_disabled_dlp_patterns', set()))},
    }


@router.get("/security/audit")
async def security_audit(x_tenant_id: str = Header(default=""), limit: int = 200):
    security_types = {"host_denied", "host_approved", "egress_blocked", "egress_approved",
                      "code_rejected", "code_validated", "secret_detected", "dlp_scan",
                      "approval_granted", "approval_denied", "sandbox_blocked"}
    security_sources = {"sandbox", "validator", "host", "egress", "workspace", "dlp"}

    all_events = audit_collector.get_recent(limit=500)
    # Filter events that are security-relevant (by source or type)
    filtered = [e for e in all_events if e.get("source", "") in security_sources or e.get("type", "") in security_types][:limit]

    # Compute stats
    blocked = sum(1 for e in filtered if any(w in e.get("type", "") for w in ("denied", "rejected", "blocked")))
    approved = sum(1 for e in filtered if any(w in e.get("type", "") for w in ("approved", "granted")))
    secrets = sum(1 for e in filtered if "secret" in e.get("type", "") or "dlp" in e.get("type", ""))

    return {
        "events": filtered,
        "stats": {"total": len(filtered), "blocked": blocked, "approved": approved, "secrets_detected": secrets}
    }


# ── Schedules ────────────────────────────────────────────────────────────────

@router.get("/schedules")
async def list_schedules(x_tenant_id: str = Header(default=""), status: str = ""):
    k = _require()
    sched = k._engine._orchestrator.scheduler
    if not sched: return {"jobs": []}
    try:
        tenant_ns = ns(x_tenant_id)
        all_jobs = await sched.list_jobs(namespace=tenant_ns)
        # Fallback: if no jobs found for this namespace, try without namespace filter
        if not all_jobs:
            all_jobs = await sched.list_jobs(namespace="")
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


# ── Workspace ────────────────────────────────────────────────────────────────

def _get_ws(x_tenant_id: str = ""):
    k = _require()
    ws = k._engine._orchestrator.workspace
    if not ws: raise HTTPException(503, "Workspace not available")
    return ws, ns(x_tenant_id)


@router.get("/workspace/files")
async def list_files(path: str = Query(""), recursive: bool = Query(False), include_agent: bool = Query(False), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entries = await ws.list_files(path, recursive=recursive, namespace=n)
    files = [{"path": e.path, "size": e.size, "is_dir": e.is_dir, "modified": e.modified.isoformat() if e.modified else None, "namespace": n} for e in entries]
    # Optionally include files from persistent workspace namespaces
    if include_agent and hasattr(ws, 'list_tenants'):
        try:
            all_ns = ws.list_tenants() if callable(ws.list_tenants) else []
            for sub_ns in all_ns:
                if sub_ns.startswith(f"{n}__ws_") and sub_ns != n:
                    sub_entries = await ws.list_files(path, recursive=recursive, namespace=sub_ns)
                    ws_label = sub_ns.replace(f"{n}__ws_", "")
                    for e in sub_entries:
                        files.append({"path": e.path, "size": e.size, "is_dir": e.is_dir, "modified": e.modified.isoformat() if e.modified else None, "namespace": sub_ns, "workspace": ws_label})
        except Exception:
            pass
    return {"files": files}


@router.get("/workspace/file")
async def read_file(path: str = Query(...), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    try:
        entry = await ws.read_file(path, namespace=n)
        return {"path": entry.path, "content": entry.content, "size": entry.size}
    except FileNotFoundError: raise HTTPException(404, "File not found")


@router.post("/workspace/file")
async def write_file(body: dict, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entry = await ws.write_file(body["path"], body["content"], namespace=n)
    return {"path": entry.path, "size": entry.size}


@router.delete("/workspace/file")
async def delete_file(path: str = Query(...), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    await ws.delete_file(path, namespace=n)
    return {"deleted": path}


@router.get("/workspace/download-folder")
async def download_folder(path: str = Query(...), x_tenant_id: str = Header(default="")):
    """Download a workspace folder as a ZIP file."""
    from fastapi.responses import StreamingResponse
    import zipfile, io, os as _os
    ws, n = _get_ws(x_tenant_id)
    entries = await ws.list_files(path, recursive=True, namespace=n)
    if not entries:
        raise HTTPException(404, "Folder not found or empty")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for e in entries:
            if e.is_dir:
                continue
            try:
                file_data = await ws.read_file(e.path, namespace=n)
                # Use path relative to the requested folder
                arcname = e.path[len(path):].lstrip("/") if e.path.startswith(path) else e.path
                zf.writestr(arcname, file_data.content or "")
            except Exception:
                continue
    buf.seek(0)
    folder_name = path.rstrip("/").split("/")[-1] or "workspace"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder_name}.zip"'},
    )


@router.post("/workspace/move")
async def move_file(body: dict, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entry = await ws.move_file(body["src"], body["dest"], namespace=n)
    return {"src": body["src"], "dest": entry.path}


@router.post("/workspace/folder")
async def create_folder(body: dict, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    name = body.get("name", "").strip()
    if not name: raise HTTPException(400, "Folder name required")
    await ws.write_file(f"{name}/.gitkeep", "", namespace=n)
    return {"created": name}


@router.post("/workspace/upload")
async def upload_file(file: UploadFile = File(...), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    content = await file.read()
    entry = await ws.write_file(file.filename, content.decode("utf-8", errors="replace"), namespace=n)
    return {"path": entry.path, "size": entry.size}


@router.get("/workspace/stats")
async def workspace_stats(x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    try:
        s = await ws.get_workspace_stats(namespace=n)
        return {"available": True, "total_files": s.total_files, "total_size": s.total_size_bytes, "languages": s.languages}
    except Exception:
        files = await ws.list_files("", recursive=True, namespace=n)
        return {"available": True, "total_files": len(files), "total_size": sum(f.size for f in files)}


@router.get("/workspace/checkpoints")
async def list_checkpoints(x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    cps = await ws.list_checkpoints(namespace=n)
    return {"checkpoints": [{"id": c.id, "label": c.label, "workspace_id": c.workspace_id, "status": c.status.value if hasattr(c.status, "value") else str(c.status), "created_at": c.created_at.isoformat()} for c in cps]}


@router.post("/workspace/checkpoints/{checkpoint_id}/restore")
async def restore_checkpoint(checkpoint_id: str, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    cp = await ws.restore_checkpoint(checkpoint_id, namespace=n)
    return {"restored": checkpoint_id, "label": cp.label, "files": len(cp.file_contents)}


@router.get("/workspace/tenants")
async def list_tenants():
    k = _require()
    ws = k._engine._orchestrator.workspace
    if not ws: return {"tenants": []}
    return {"tenants": ws.list_tenants() if hasattr(ws, "list_tenants") else ["default"]}


# ── Tool Management ─────────────────────────────────────────────────────────

@router.get("/tools")
async def list_tools():
    """List all available tools (built-in + external MCP + LangChain)."""
    k = _require()
    orch = k._engine._orchestrator
    tools = orch.get_tool_registry()

    # Categorize tools
    built_in = []
    mcp_external = []
    langchain = []

    for t in tools:
        name = t.get("name", "")
        if "__" in name and name.split("__")[0] not in ("query", "store", "get", "set", "list", "create", "delete", "search"):
            prefix = name.split("__")[0]
            if prefix.startswith("lc"):
                langchain.append(t)
            else:
                mcp_external.append(t)
        else:
            built_in.append(t)

    # Get connected MCP servers
    mcp_servers = {}
    if hasattr(orch, '_mcp_client') and orch._mcp_client:
        for name, conn in orch._mcp_client._connections.items():
            mcp_servers[name] = {"connected": True, "tools": len([t for t in mcp_external if t["name"].startswith(name + "__")])}

    return {
        "built_in": {"count": len(built_in), "tools": [{"name": t["name"], "description": t.get("description", "")[:100]} for t in built_in]},
        "mcp_servers": mcp_servers,
        "mcp_external": {"count": len(mcp_external), "tools": [{"name": t["name"], "description": t.get("description", "")[:100]} for t in mcp_external]},
        "langchain": {"count": len(langchain), "tools": [{"name": t["name"], "description": t.get("description", "")[:100]} for t in langchain]},
        "total": len(tools),
    }


@router.post("/tools/mcp/connect")
async def connect_mcp_server(body: dict):
    """Connect to an external MCP server."""
    k = _require()
    orch = k._engine._orchestrator
    name = body.get("name", "")
    transport = body.get("transport", "stdio")  # "stdio" or "sse"
    command = body.get("command", "")
    url = body.get("url", "")
    env = body.get("env", {})

    if not name:
        raise HTTPException(400, "name is required")

    try:
        if transport == "stdio" and command:
            await orch.connect_mcp_server(name, transport="stdio", command=command, env=env)
        elif transport == "sse" and url:
            await orch.connect_mcp_server(name, transport="sse", url=url)
        else:
            raise HTTPException(400, "For stdio: provide command. For sse: provide url.")

        # Persist so it's reconnected on restart (upsert by name)
        servers = [s for s in _load_list(_MCP_SERVERS_PATH) if s.get("name") != name]
        servers.append({"name": name, "transport": transport, "command": command, "url": url, "env": env})
        _save_list(_MCP_SERVERS_PATH, servers)
        # Get tools from the new server
        tools = [t for t in orch.get_tool_registry() if t["name"].startswith(name + "__")]
        return {"connected": True, "name": name, "tools_count": len(tools), "tools": [t["name"] for t in tools]}
    except Exception as exc:
        raise HTTPException(500, f"Failed to connect: {exc}")


@router.delete("/tools/mcp/{server_name}")
async def disconnect_mcp_server(server_name: str):
    """Disconnect from an external MCP server."""
    k = _require()
    orch = k._engine._orchestrator
    try:
        await orch.disconnect_mcp_server(server_name)
        _save_list(_MCP_SERVERS_PATH, [s for s in _load_list(_MCP_SERVERS_PATH) if s.get("name") != server_name])
        return {"disconnected": True, "name": server_name}
    except Exception as exc:
        raise HTTPException(500, f"Failed to disconnect: {exc}")


@router.post("/tools/langchain/register")
async def register_langchain_tool(body: dict):
    """Register a LangChain community tool by module path and class name."""
    k = _require()
    orch = k._engine._orchestrator
    module_path = body.get("module", "")  # e.g. "langchain_community.tools.wikipedia.tool"
    class_name = body.get("class", "")    # e.g. "WikipediaQueryRun"

    if not module_path or not class_name:
        raise HTTPException(400, "module and class are required")

    try:
        import importlib, subprocess, sys, re

        def _pip_install(packages: list[str]):
            for pkg in packages:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])
            importlib.invalidate_caches()

        def _try_load():
            mod = importlib.import_module(module_path)
            tool_cls = getattr(mod, class_name)
            return tool_cls()

        # Attempt 1: try directly
        try:
            importlib.invalidate_caches()
            tool_instance = _try_load()
        except ImportError as exc:
            # Extract missing package name from error message
            err_msg = str(exc)
            # Try to find "pip install <pkg>" in error message
            pip_match = re.search(r'pip install[- ]+(?:U )?(\S+)', err_msg)
            missing_pkg = pip_match.group(1).strip('`"\'.') if pip_match else None

            # Build install list: caller-specified deps + auto-detected + top-level package
            pkg_name = module_path.split(".")[0].replace("_", "-")
            to_install = list(dict.fromkeys(body.get("pip", [pkg_name]) + ([missing_pkg] if missing_pkg else [])))
            _pip_install(to_install)

            # Attempt 2: retry after install
            try:
                tool_instance = _try_load()
            except ImportError as exc2:
                # One more round — extract again in case there's a second missing dep
                err2 = str(exc2)
                pip_match2 = re.search(r'pip install[- ]+(?:U )?(\S+)', err2)
                if pip_match2:
                    _pip_install([pip_match2.group(1).strip('`"\'.') ])
                    tool_instance = _try_load()
                else:
                    raise

        orch.register_langchain_tool(tool_instance)
        reg_name = f"lc__{tool_instance.name}"
        # Persist so it's re-registered on restart (upsert by module+class)
        tools = [t for t in _load_list(_LC_TOOLS_PATH) if not (t.get("module") == module_path and t.get("class") == class_name)]
        tools.append({"module": module_path, "class": class_name, "pip": body.get("pip", []), "name": reg_name})
        _save_list(_LC_TOOLS_PATH, tools)
        return {"registered": True, "name": reg_name, "description": tool_instance.description[:200]}
    except ImportError as exc:
        raise HTTPException(400, f"Module not found: {module_path}. Install it with pip. Error: {exc}")
    except Exception as exc:
        raise HTTPException(500, f"Failed to register: {exc}")


@router.delete("/tools/langchain/{tool_name}")
async def unregister_langchain_tool(tool_name: str):
    """Unregister a LangChain tool."""
    k = _require()
    orch = k._engine._orchestrator
    try:
        orch.unregister_langchain_tool(tool_name)
        _save_list(_LC_TOOLS_PATH, [t for t in _load_list(_LC_TOOLS_PATH) if t.get("name") != tool_name])
        return {"unregistered": True, "name": tool_name}
    except Exception as exc:
        raise HTTPException(500, f"Failed to unregister: {exc}")


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
        k._tasks[task.id] = task

        if pattern == "graph" and graph:
            from kernelmcp.agents.graph_executor import GraphExecutor
            executor = GraphExecutor(
                graph=graph, agents=agents, goal=goal,
                registry=k._agent_registry, namespace=namespace, task=task,
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
                if executor:
                    result = await executor.run()
                else:
                    result = await tf.run(k._agent_registry, namespace=namespace)
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
async def list_deployments():
    _ensure_ticker()
    os.makedirs(_DEPLOY_DIR, exist_ok=True)
    out = []
    for f in os.listdir(_DEPLOY_DIR):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(_DEPLOY_DIR, f), encoding="utf-8"))
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
    """Owner-only per-deployment metrics, aggregated from its run history:
    success rate, token/cost totals + averages, latency percentiles, a daily
    call timeline, and a source (api vs test) breakdown."""
    import datetime as _dt
    dep = _load_deploy(did)
    if not dep:
        raise HTTPException(404, "deployment not found")
    if x_tenant_id != dep.get("tenant", ""):
        raise HTTPException(403, "not the owner of this deployment")

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
    if x_tenant_id != dep.get("tenant", ""):
        raise HTTPException(403, "not the owner of this deployment")
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
    """Fleet snapshot for mission control: deployments, triggers, and today's activity."""
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
