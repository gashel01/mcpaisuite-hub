"""LLM config, saved connections, environment variables, test-connection and unified settings."""
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
import time as _time

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


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
    if "bootstrap_min_score" in updates and k and k._engine._orchestrator:
        k._engine._orchestrator._context_min_score = float(updates["bootstrap_min_score"])
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
