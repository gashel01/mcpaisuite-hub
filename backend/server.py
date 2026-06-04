"""KernelMCP Demo API — slim orchestrator with modular routes."""
from __future__ import annotations
import os
import asyncio
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kernelmcp.factory import KernelFactory
from kernelmcp.core.models import TaskStatus, Task, _now
from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType

from config import llm_config, litellm_kwargs, resolve_url, load_json, is_docker, \
    DEFAULT_NAMESPACE, DATA_DIR, EGRESS_CONFIG_PATH, settings
from stores import conversations, audit_collector
from routes import chat as chat_routes, rag as rag_routes, api as api_routes, stream as stream_routes, metrics as metrics_routes, alerts as alerts_routes, traces as traces_routes, constitution as constitution_routes, regression as regression_routes, eval as eval_routes, marketplace as marketplace_routes, hub as hub_routes

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="KernelMCP Demo API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

kernel = None

# Wire routers
app.include_router(chat_routes.router)
app.include_router(rag_routes.router)
app.include_router(api_routes.router)
app.include_router(hub_routes.router)
app.include_router(stream_routes.router)
app.include_router(metrics_routes.router)
app.include_router(alerts_routes.router)
app.include_router(traces_routes.router)
app.include_router(constitution_routes.router)
app.include_router(regression_routes.router)
app.include_router(eval_routes.router)
app.include_router(marketplace_routes.router)

# ── Missing endpoints needed by dashboard ────────────────────────────────────

@app.get("/workspace/tenants")
async def workspace_tenants():
    return {"tenants": [DEFAULT_NAMESPACE, "default"]}

# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global kernel
    _DATA_DIR = DATA_DIR  # explicit capture — avoids Python 3.13 closure/cell scoping bug with async functions

    provider = llm_config["provider"]
    print(f"[STARTUP] LLM config: provider={provider}, model={llm_config['model']}", flush=True)

    if provider and provider != "echo":
        kwargs = litellm_kwargs()
        llm_model = kwargs.get("model", "claude-sonnet-4-6")
        api_key = kwargs.get("api_key")
        base_url = kwargs.get("api_base")
    else:
        llm_model = llm_config["model"] or "claude-sonnet-4-6"
        api_key = llm_config["api_key"] or os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY")
        base_url = resolve_url(llm_config["base_url"]) or None

    # Planner LLM — always uses CURRENT llm config (not startup snapshot)
    async def _planner_llm_complete(messages):
        import litellm
        litellm.drop_params = True
        kw = litellm_kwargs()  # reads current llm_config (updated when user changes provider)
        resp = await litellm.acompletion(model=kw.get("model"), messages=messages, api_key=kw.get("api_key"), api_base=kw.get("api_base"))
        if resp.usage:
            from stores import background_token_counter
            background_token_counter["total"] += resp.usage.prompt_tokens + resp.usage.completion_tokens
        return resp.choices[0].message.content or ""

    # Connect suite libraries — with production features enabled
    pipelines = {}

    # 1. memorymcp — uses settings + Chroma for persistent fact storage
    def _memory_factory():
        from memorymcp import MemoryFactory
        return MemoryFactory.create(
            extractor="llm",
            completion_fn=_planner_llm_complete,
            decay_mode=settings.get("memory_decay_mode", "exponential"),
            decay_half_life_days=7.0,
            similarity_threshold=0.85,
            contradiction_threshold=0.92,
            episodic_store=settings.get("memory_backend", "sqlite"),
            semantic_store=settings.get("memory_semantic_backend", "chroma"),
            chroma_path=str(_DATA_DIR / "chroma_memory"),
            sqlite_path=str(_DATA_DIR / "memorymcp.db"),
            redis_url=settings.get("memory_redis_url", "") or None,
            neo4j_uri=settings.get("memory_neo4j_uri", "") or None,
            neo4j_user=settings.get("memory_neo4j_user", "neo4j"),
            neo4j_password=settings.get("memory_neo4j_password", ""),
        )

    # 2. ragmcp — from env (qdrant + fastembed), configured via docker-compose
    def _rag_factory():
        from ragmcp import RAGFactory
        return RAGFactory.from_env()

    # 3. planningmcp — uses settings
    def _planning_factory():
        from planningmcp import PlanningFactory
        return PlanningFactory.create(
            decomposer="hybrid",
            completion_fn=_planner_llm_complete,
            plan_store="sqlite",
            sqlite_path=str(_DATA_DIR / "planningmcp.db"),
            replan_strategy="llm",
            memory_pipeline=pipelines.get("memory"),
            rag_pipeline=pipelines.get("rag"),
        )
    # planningmcp doesn't have infrastructure settings yet

    # 4. workspacemcp — uses settings for backend config
    def _workspace_factory():
        from workspacemcp import WorkspaceFactory
        ws_root = settings.get("workspace_root", "/app/data/workspace")
        os.makedirs(ws_root, exist_ok=True)
        return WorkspaceFactory.create(
            root_path=ws_root,
            file_store="local",
            checkpoint_store=settings.get("workspace_checkpoint_store", "sqlite"),
            audit_logger=settings.get("workspace_audit_store", "sqlite"),
            sqlite_path=str(_DATA_DIR / "workspacemcp.db"),
            read_only=False,
            allowed_write_patterns=["*"],
            content_filter=True,
            auto_checkpoint=settings.get("checkpoint_enabled", True),
            tenant_isolation=settings.get("tenant_isolation", True),
            approval_required_patterns=["*.key", "*.pem", ".env*", "secrets/*", "production.*"],
        )

    # 5. sandboxmcp — uses settings for backend config
    def _sandbox_factory():
        from sandboxmcp import SandboxFactory
        # Workspace path for Docker mount (read-only)
        # Docker-in-Docker: the sandbox Docker container is created by the HOST Docker daemon.
        # So we must pass the HOST path, not the container path.
        # WORKSPACE_HOST_PATH should be set to the absolute host path that maps to /app/data/workspace
        ws_host = os.getenv("WORKSPACE_HOST_PATH", "")
        if not ws_host:
            # Auto-detect: if /app/data is a docker volume mount, find the host path
            # Fallback: use the container path (works for process backend, not docker)
            ws_host = os.getenv("WORKSPACE_ROOT", "/app/data/workspace")
        ws_root = ws_host
        return SandboxFactory.create(
            default_backend=os.getenv("SANDBOXMCP_BACKEND", "process"),
            enable_network=True,
            enable_host_access=settings.get("host_exec_enabled", True),
            host_auto_approve=settings.get("auto_approve", False),
            vault=settings.get("sandbox_vault", "memory"),
            audit=settings.get("sandbox_audit_store", "sqlite"),
            sqlite_path=str(_DATA_DIR / "sandboxmcp.db"),
            timeout_seconds=60,
            workspace_path=ws_root,
            hardened=False,  # Disable read-only rootfs + seccomp — needed for subprocess/TestClient
        )

    # 6. schedulermcp — uses settings
    def _scheduler_factory():
        from schedulermcp import SchedulerFactory
        return SchedulerFactory.create(store="sqlite", sqlite_path=str(_DATA_DIR / "scheduler.db"))

    # Order matters: memory + rag first (planning depends on them)
    for name, factory_fn in [
        ("memory", _memory_factory),
        ("rag", _rag_factory),
        ("planning", _planning_factory),
        ("workspace", _workspace_factory),
        ("sandbox", _sandbox_factory),
        ("scheduler", _scheduler_factory),
    ]:
        try:
            pipelines[name] = factory_fn()
            print(f"[STARTUP] {name}mcp connected", flush=True)
        except Exception as exc:
            pipelines[name] = None
            print(f"[STARTUP] {name}mcp unavailable: {exc}", flush=True)

    # Correction ledger — second memorymcp instance for LLM error learning
    correction_ledger = None
    try:
        from memorymcp import MemoryFactory
        correction_ledger = MemoryFactory.create(
            semantic_store="chroma",
            chroma_path=str(_DATA_DIR / "chroma_corrections"),
            episodic_store="sqlite",
            sqlite_path=str(_DATA_DIR / "corrections.db"),
        )
        print("[STARTUP] correction ledger connected", flush=True)
    except Exception as exc:
        print(f"[STARTUP] correction ledger unavailable: {exc}", flush=True)

    resolved_model = llm_model if (provider and provider != "echo") else os.getenv("KERNELMCP_MODEL", llm_model)
    print(f"[STARTUP] pipelines ready: {[k for k,v in pipelines.items() if v is not None]}", flush=True)
    try:
      kernel = KernelFactory.create(
        llm_model=resolved_model, local_model=resolved_model, fast_model=resolved_model,
        api_key=api_key, base_url=base_url, enable_routing=True,
        max_turns=int(os.getenv("KERNELMCP_MAX_TURNS", str(settings.get("max_turns", 20)))),
        max_tokens_per_task=settings.get("max_tokens", 50000),
        namespace=DEFAULT_NAMESPACE,
        memory_pipeline=pipelines.get("memory"), planning_pipeline=pipelines.get("planning"),
        workspace_pipeline=pipelines.get("workspace"), sandbox_pipeline=pipelines.get("sandbox"),
        scheduler_pipeline=pipelines.get("scheduler"), rag_pipeline=pipelines.get("rag"),
        correction_ledger=correction_ledger,
      )
      print("[STARTUP] kernel created OK", flush=True)
    except Exception as _kernel_exc:
      import traceback
      print(f"[STARTUP] kernel FAILED: {_kernel_exc}", flush=True)
      traceback.print_exc()
      return
    # Set execution mode from settings
    kernel._engine._mode = settings.get("execution_mode", "react")

    # Fallback chain: primary model → retry same model (transient errors)
    from kernelmcp.core.resilience import LLMFallbackChain
    kernel._engine._fallback = LLMFallbackChain(models=[resolved_model, resolved_model])

    # Wire RAG LLM function for advanced tools (Self-RAG, ReAct)
    kernel.orchestrator.set_rag_llm_fn(_planner_llm_complete)

    # Load persisted tasks from disk
    from task_store import load_all_tasks as _load_tasks
    # Migrate JSON files → SQLite (one-time, safe to re-run)
    from task_store import migrate_json_files
    migrate_json_files()

    persisted = _load_tasks()
    if persisted:
        kernel._tasks.update(persisted)
        print(f"[STARTUP] loaded {len(persisted)} persisted tasks", flush=True)

    # Pre-warm embedding models (download + load once at startup, not per-query)
    async def _warmup_embeddings():
        # 1. Warm up RAG (FastEmbed + Qdrant)
        try:
            rag = pipelines.get("rag")
            if rag and hasattr(rag, 'search'):
                print("[STARTUP] warming up RAG embedding model...", flush=True)
                await rag.search("warmup", top_k=1)
                print("[STARTUP] RAG embedding model ready", flush=True)
        except Exception as exc:
            print(f"[STARTUP] RAG warmup failed (non-critical): {exc}", flush=True)

        # 2. Warm up Memory (ChromaDB embedding)
        try:
            mem = pipelines.get("memory")
            if mem:
                print("[STARTUP] warming up memory/ChromaDB embedding model...", flush=True)
                # Force ChromaDB to download and cache its model
                if hasattr(mem, 'query_memory'):
                    await mem.query_memory("warmup", namespace="default", top_k=1)
                elif hasattr(mem, 'search'):
                    await mem.search("warmup", top_k=1)
                print("[STARTUP] memory embedding model ready", flush=True)
        except Exception as exc:
            print(f"[STARTUP] memory warmup failed (non-critical): {exc}", flush=True)
    asyncio.create_task(_warmup_embeddings())

    # Push egress config to orchestrator at startup
    try:
        from config import EGRESS_CONFIG_PATH
        import json as _json
        egress_cfg = _json.loads(EGRESS_CONFIG_PATH.read_text()) if EGRESS_CONFIG_PATH.exists() else {}
        # Load tenant domains
        tenant_domains = []
        egress_tenant_file = _DATA_DIR / f"egress_{DEFAULT_NAMESPACE}.json"
        if egress_tenant_file.exists():
            tenant_domains = _json.loads(egress_tenant_file.read_text()).get("allowed_domains", [])
        kernel._engine._orchestrator._egress_config = {
            "enabled": egress_cfg.get("enabled", False),
            "allowed_domains": tenant_domains,
        }
        print(f"[STARTUP] egress config: enabled={egress_cfg.get('enabled', False)}, domains={len(tenant_domains)}", flush=True)
    except Exception as exc:
        print(f"[STARTUP] egress config load failed: {exc}", flush=True)

    # Share kernel with route modules
    chat_routes.kernel = kernel
    rag_routes.kernel = kernel
    api_routes.kernel = kernel
    stream_routes.kernel = kernel
    hub_routes.kernel = kernel

    # Wire scheduler
    if pipelines.get("scheduler"):
        from schedulermcp.executor.kernel_executor import KernelExecutor
        async def _on_scheduled_complete(job, result):
            conv_id = job.metadata.get("conversation_id", "default")
            msg = f"[Scheduled] {job.goal}: {result.output[:500]}" if result.success else f"[Scheduled] {job.goal}: FAILED — {result.error[:200]}"
            conversations.add_message(job.namespace, conv_id, "assistant", msg)
            audit_collector.emit("scheduler", "job_completed", {"job_id": job.id, "goal": job.goal[:100], "success": result.success})
        pipelines["scheduler"]._executor = KernelExecutor(kernel, on_complete=_on_scheduled_complete)
        # Conversation ID is now passed via task.metadata, not a global variable
        if settings.get("scheduler_enabled", True):
            pipelines["scheduler"].start()
            print("[STARTUP] scheduler started", flush=True)
        else:
            print("[STARTUP] scheduler left stopped (disabled in settings)", flush=True)

    # Apply saved egress
    egress_cfg = load_json(EGRESS_CONFIG_PATH, {"enabled": True, "allowed_domains": []})
    if kernel._engine._orchestrator.sandbox:
        net = kernel._engine._orchestrator.sandbox._network
        if net:
            net._enabled = egress_cfg.get("enabled", False)
            net._global_allowed = set(egress_cfg.get("allowed_domains", []))

    # Apply saved host access — load into the orchestrator's per-namespace registry
    if kernel._engine._orchestrator.sandbox:
        from sandboxmcp.security.host_guard import HostGuard
        # Load default config
        host_cfg = load_json(_DATA_DIR / "host_config.json", {"approved": []})
        default_guard = HostGuard(approved=host_cfg.get("approved", []), auto_approve=False)
        default_guard._pending_has_listener = True  # Demo UI has approve/deny endpoints
        kernel._engine._orchestrator.sandbox._host_guard = default_guard
        kernel._engine._orchestrator._host_guards[DEFAULT_NAMESPACE] = default_guard
        # Load per-namespace configs (e.g. host_config_demo.json)
        import glob as _glob
        from pathlib import Path as _Path
        for cfg_path in _glob.glob(str(_DATA_DIR / "host_config_*.json")):
            _ns = _Path(cfg_path).stem.replace("host_config_", "")
            _ns_cfg = load_json(_Path(cfg_path), {"approved": []})
            _approved = _ns_cfg.get("approved", [])
            _ns_guard = HostGuard(approved=_approved, auto_approve=False)
            _ns_guard._pending_has_listener = True
            kernel._engine._orchestrator._host_guards[_ns] = _ns_guard
            print(f"[STARTUP] host guard '{_ns}': {_approved}", flush=True)

    # Re-apply saved runtime settings that KernelFactory doesn't restore (so they survive restarts)
    try:
        if kernel._engine._orchestrator.sandbox:
            sb = kernel._engine._orchestrator.sandbox
            if hasattr(sb, "_timeout"):
                sb._timeout = settings.get("sandbox_timeout", 30)
            if getattr(sb, "_host_guard", None):
                sb._host_guard.auto_approve = bool(settings.get("auto_approve", False))
    except Exception as exc:
        print(f"[STARTUP] settings re-apply failed: {exc}", flush=True)

    # Re-register persisted LangChain tools + reconnect MCP servers (survive restarts)
    for spec in api_routes._load_list(api_routes._LC_TOOLS_PATH):
        try:
            await api_routes.register_langchain_tool({"module": spec.get("module"), "class": spec.get("class"), "pip": spec.get("pip", [])})
            print(f"[STARTUP] re-registered LangChain tool {spec.get('class')}", flush=True)
        except Exception as exc:
            print(f"[STARTUP] LangChain tool {spec.get('class')} failed: {str(exc)[:120]}", flush=True)
    for spec in api_routes._load_list(api_routes._MCP_SERVERS_PATH):
        try:
            await api_routes.connect_mcp_server(spec)
            print(f"[STARTUP] reconnected MCP server {spec.get('name')}", flush=True)
        except Exception as exc:
            print(f"[STARTUP] MCP server {spec.get('name')} failed: {str(exc)[:120]}", flush=True)

    print(f"[STARTUP] Kernel ready ({kernel.orchestrator.connected_count}/6 servers, model={resolved_model})", flush=True)

    # Start alerting engine background loop
    from alerting import alert_engine
    await alert_engine.start()
    print(f"[STARTUP] Alerting engine started ({len(alert_engine.rules)} rules)", flush=True)

    # Forward sub-lib event buses to KernelEventBus
    async def _forward_sublib_events(source_name, event_bus_attr):
        try:
            pipe = pipelines.get(source_name)
            if not pipe:
                return
            bus = getattr(pipe, event_bus_attr, None)
            if not bus or not hasattr(bus, "subscribe"):
                # Try module-level event bus
                mod = __import__(f"{source_name}mcp", fromlist=["events"])
                bus = getattr(mod, f"{source_name}_event_bus", None) or getattr(mod.events, f"{source_name}_event_bus", None)
            if not bus or not hasattr(bus, "subscribe"):
                return
            q = bus.subscribe()
            while True:
                event = await q.get()
                ns = getattr(event, "namespace", "default")
                evt_type = getattr(event, "type", "unknown")
                evt_name = evt_type.value if hasattr(evt_type, "value") else str(evt_type)
                audit_collector.emit(source_name, evt_name, getattr(event, "data", {}))
        except Exception:
            pass  # Graceful — don't crash if a lib doesn't have events

    for lib_name, bus_attr in [
        ("memory", "_event_bus"), ("workspace", "_event_bus"),
        ("sandbox", "_event_bus"), ("planning", "_event_bus"),
    ]:
        asyncio.create_task(_forward_sublib_events(lib_name, bus_attr))

    # Audit event consumer
    _q = kernel_event_bus.subscribe()
    async def _consumer():
        while True:
            try:
                event = await _q.get()
                audit_collector.emit("kernel", event.type.value if hasattr(event.type, "value") else str(event.type), event.data if hasattr(event, "data") else {}, event.message if hasattr(event, "message") else "")
            except Exception: await asyncio.sleep(0.1)
    asyncio.create_task(_consumer())

    # Audit wrappers
    _orig_exec = kernel.orchestrator.execute_tool
    async def _audited_exec(tool_name, arguments, namespace="default"):
        # Demo-layer fleet tools: let the chat/agents monitor and control the deployment
        # fleet (read registry, metrics, executions; pause/resume/run/rotate/delete with
        # built-in confirmation gates) instead of guessing from workspace/memory. Handled
        # here because deployments are a demo concept, not part of the kernelmcp orchestrator.
        if tool_name in api_routes.FLEET_TOOL_NAMES:
            audit_collector.emit("orchestrator", "tool_dispatch", {"tool": tool_name, "namespace": namespace, "args": arguments or {}})
            # During an interactive chat the engine exposes _ask_user_fn (a real UI
            # elicitation that pauses the task until the human answers). Pass it so
            # destructive fleet ops gate on a genuine human approval, not the LLM's
            # own confirm flag. None in non-interactive contexts (API/scheduled runs).
            ask_fn = getattr(getattr(kernel, "_engine", None), "_ask_user_fn", None)
            res = await api_routes.run_fleet_tool(tool_name, arguments or {}, ask_fn=ask_fn)
            audit_collector.emit("orchestrator", "tool_result", {"tool": tool_name, "success": res.get("success", True), "duration_ms": 0, "output": str(res.get("output", ""))[:150], "error": "" if res.get("success", True) else str(res.get("output", ""))[:150]})
            return res
        # Summarize args (avoid logging huge code blobs)
        args_summary = {}
        for k, v in (arguments or {}).items():
            if isinstance(v, str) and len(v) > 100:
                args_summary[k] = v[:80] + f"... ({len(v)} chars)"
            else:
                args_summary[k] = v
        audit_collector.emit("orchestrator", "tool_dispatch", {"tool": tool_name, "namespace": namespace, "args": args_summary})
        t0 = time.time()
        result = await _orig_exec(tool_name, arguments, namespace)
        duration = round((time.time() - t0) * 1000)
        success = result.get("success", True)
        output_preview = ""
        if isinstance(result.get("output"), str):
            output_preview = result["output"][:150]
        elif isinstance(result.get("output"), (dict, list)):
            import json as _json
            output_preview = _json.dumps(result["output"], default=str)[:150]
        audit_collector.emit("orchestrator", "tool_result", {
            "tool": tool_name, "success": success, "duration_ms": duration,
            "output": output_preview,
            "error": result.get("error", "")[:200] if not success else "",
        })
        return result
    kernel.orchestrator.execute_tool = _audited_exec

    # Surface the demo's fleet tools to the agent: (1) add them to the tool registry so
    # they're discoverable, (2) route fleet questions/commands to them so the agent picks
    # them up instead of hallucinating from workspace/memory. Both are runtime
    # wraps/mutations — the kernelmcp lib source is untouched.
    _orig_registry = kernel.orchestrator.get_tool_registry
    def _registry_with_deployments():
        tools = _orig_registry()
        have = {t.get("name") for t in tools}
        for sch in api_routes.FLEET_TOOL_SCHEMAS:
            if sch["name"] not in have:
                tools.append(sch)
        return tools
    kernel.orchestrator.get_tool_registry = _registry_with_deployments
    try:
        from kernelmcp.core import tool_selection as _tsel
        _tsel.INTENT_TOOLS["deployments"] = set(api_routes.FLEET_TOOL_NAMES)
        _tsel.INTENT_KEYWORDS.insert(0, ("deployments", [
            "deployed", "deployment", "fleet", "in production",
            "what's deployed", "whats deployed", "anything deployed", "agents deployed",
            "take offline", "bring online", "rotate token", "delete deployment",
            "trigger a run", "run the deployment", "deployment metrics",
            "success rate", "executions", "recent runs",
        ]))
    except Exception as exc:
        print(f"[STARTUP] deployment tool routing not wired: {exc}", flush=True)

    def _wrap_llm(gw, label="engine"):
        _orig = gw.complete
        # Must accept + forward on_delta so token streaming reaches the real gateway.
        # (The engine inspects this wrapper's signature and only streams if on_delta is here.)
        async def _audited(system, messages, tools=None, on_delta=None):
            msg_count = len(messages) if messages else 0
            audit_collector.emit("llm", "call_start", {
                "caller": label, "model": gw._model,
                "tools_count": len(tools) if tools else 0,
                "messages": msg_count,
                "system_len": len(system) if system else 0,
            })
            t0 = time.time()
            resp = await _orig(system, messages, tools, on_delta=on_delta)
            tool_calls = [tc.tool_name for tc in resp.tool_calls] if resp.tool_calls else []
            audit_collector.emit("llm", "response", {
                "caller": label, "model": resp.model,
                "duration_ms": round((time.time() - t0) * 1000),
                "tokens_in": resp.tokens_input, "tokens_out": resp.tokens_output,
                "tool_calls": tool_calls,
                "has_content": bool(resp.content),
                "stop_reason": resp.stop_reason,
            })
            return resp
        gw.complete = _audited

    _wrap_llm(kernel._engine._llm, "engine")
    if kernel._agent_registry and kernel._agent_registry._llm is not kernel._engine._llm:
        _wrap_llm(kernel._agent_registry._llm, "subagent")
