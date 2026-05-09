"""Health, settings, workspace, agents, audit, egress, host, webhook endpoints."""
from __future__ import annotations
import os
import json
import asyncio
import time

from fastapi import APIRouter, HTTPException, Query, Header, UploadFile, File
from fastapi.responses import StreamingResponse
from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType

from config import ns, llm_config, settings, litellm_kwargs, save_json, load_json, \
    LLM_CONFIG_PATH, SETTINGS_PATH, EGRESS_CONFIG_PATH, DATA_DIR, DEFAULT_SETTINGS, is_docker
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
    return {"rules": k._engine._constitution.rules}


@router.post("/constitution")
async def update_constitution(body: ConstitutionBody):
    k = _require()
    k._engine._constitution.update_rules(body.rules)
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
    return {"enabled": net._enabled if net else False, "allowed_domains": list(tenant_domains)}


@router.post("/egress/toggle")
async def toggle_egress(enabled: bool = Query(...)):
    net = _get_egress()
    if net: net._enabled = enabled
    save_json(EGRESS_CONFIG_PATH, {"enabled": enabled})
    return {"enabled": enabled}


@router.post("/egress/allow")
async def allow_domain(domain: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    tenant_domains.add(domain)
    _tenant_egress[tenant_ns] = tenant_domains
    # Also add to global so sandbox allows it
    net = _get_egress()
    if net: net._global_allowed = getattr(net, "_global_allowed", set()) | {domain}
    _save_tenant_egress(tenant_ns)
    return {"domain": domain}


@router.delete("/egress/allow")
async def remove_domain(domain: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    tenant_domains.discard(domain)
    _tenant_egress[tenant_ns] = tenant_domains
    _save_tenant_egress(tenant_ns)
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
    if not g: return {"approved": [], "pending": []}
    # Extract pending requests from the HostGuard's _pending dict (key = "namespace:pattern")
    pending = []
    for key in list(getattr(g, "_pending", {}).keys()):
        parts = key.split(":", 1)
        pattern = parts[1] if len(parts) > 1 else parts[0]
        pending.append({"pattern": pattern, "key": key})
    return {"approved": list(getattr(g, "_approved", getattr(g, "approved", []))), "pending": pending}


@router.post("/host/approve")
async def approve_host(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    g = _get_host_guard(tenant_ns)
    if not g: raise HTTPException(503, "No host guard")
    if pattern == "*": raise HTTPException(400, "Wildcard not allowed")
    # Resolve the pending future so the blocked request_access() call continues
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


# ── Schedules ────────────────────────────────────────────────────────────────

@router.get("/schedules")
async def list_schedules(x_tenant_id: str = Header(default="")):
    k = _require()
    sched = k._engine._orchestrator.scheduler
    if not sched: return {"jobs": []}
    try:
        tenant_ns = ns(x_tenant_id)
        all_jobs = await sched.list_jobs(namespace=tenant_ns)
        # Only return pending/active jobs — completed ones show in task history
        jobs = [j for j in all_jobs if getattr(j, "status", "") not in ("completed", "cancelled", "failed")]
        def _serialize(j):
            st = getattr(j, "schedule_type", "once")
            status = getattr(j, "status", "scheduled")
            nr = getattr(j, "next_run", None)
            return {
                "id": j.id,
                "goal": j.goal,
                "schedule_type": st.value if hasattr(st, "value") else str(st),
                "status": status.value if hasattr(status, "value") else str(status),
                "next_run": nr.isoformat() if nr else None,
                "run_count": getattr(j, "run_count", 0),
                "namespace": getattr(j, "namespace", ""),
            }
        return {"jobs": [_serialize(j) for j in jobs]}
    except Exception as exc:
        print(f"[SCHEDULES] list error: {exc}", flush=True)
        return {"jobs": []}


# ── Workspace ────────────────────────────────────────────────────────────────

def _get_ws(x_tenant_id: str = ""):
    k = _require()
    ws = k._engine._orchestrator.workspace
    if not ws: raise HTTPException(503, "Workspace not available")
    return ws, ns(x_tenant_id)


@router.get("/workspace/files")
async def list_files(path: str = Query(""), recursive: bool = Query(False), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entries = await ws.list_files(path, recursive=recursive, namespace=n)
    return {"files": [{"path": e.path, "size": e.size, "is_dir": e.is_dir, "modified": e.modified.isoformat() if e.modified else None} for e in entries]}


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
    return {"checkpoints": [{"id": c.id, "label": c.label, "file_path": c.file_path, "created_at": c.created_at.isoformat()} for c in cps]}


@router.post("/workspace/checkpoints/{checkpoint_id}/restore")
async def restore_checkpoint(checkpoint_id: str, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entry = await ws.restore_checkpoint(checkpoint_id, namespace=n)
    return {"restored": checkpoint_id, "path": entry.path}


@router.get("/workspace/tenants")
async def list_tenants():
    k = _require()
    ws = k._engine._orchestrator.workspace
    if not ws: return {"tenants": []}
    return {"tenants": ws.list_tenants() if hasattr(ws, "list_tenants") else ["default"]}


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


@router.get("/agents/classify")
async def classify_task(goal: str = Query(...)):
    return {"goal": goal, "agent_type": _require().classify_task(goal)}


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
