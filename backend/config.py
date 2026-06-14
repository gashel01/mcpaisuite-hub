"""Persistent configuration — LLM, egress, host, settings."""
from __future__ import annotations
import json
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("KERNELMCP_DATA_DIR", "/app/data"))
LLM_CONFIG_PATH = DATA_DIR / "llm_config.json"
EGRESS_CONFIG_PATH = DATA_DIR / "egress_config.json"
SETTINGS_PATH = DATA_DIR / "settings.json"
DEFAULT_NAMESPACE = os.getenv("KERNELMCP_NAMESPACE", "demo")

PROVIDER_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-4-5-20251001",
    "ollama": "mistral",
    "groq": "llama-3.1-8b-instant",
    "cerebras": "llama-3.3-70b",
    "gemini": "gemini-2.0-flash",
    "openai_compatible": "mistral",
}

DEFAULT_SETTINGS = {
    "max_turns": 10, "max_tokens": 50000, "execution_mode": "hybrid",
    # Engine context window per LLM call (≠ total budget; never exceeds it) + externalized
    # kernel state (postgres:// → cross-instance task resume, empty = local SQLite).
    "context_window_tokens": 40000, "kernel_checkpoint_url": "",
    # Minimum similarity score for auto-injected bootstrap context (RAG/memory/corrections).
    # Below this, off-topic nearest-neighbour hits are dropped instead of wasting tokens.
    "bootstrap_min_score": 0.35,
    # Multi-agent graph (TaskForce) loop bounds — conservative defaults; raise for deeper
    # iterative flows at the cost of more steps/tokens.
    "graph_max_self_refines": 1, "graph_max_feedback_runs": 1, "graph_max_total_steps": 30,
    # Agent-JIT — reuse shadow-validated solution patterns across repeated task families
    # (off by default; first sighting reasons normally, then later runs reuse cheaply).
    "jit_enabled": False,
    "workspace_root": "/app/data/workspace", "tenant_isolation": True,
    "max_file_size_mb": 50, "checkpoint_enabled": True,
    "host_exec_enabled": True, "auto_approve": False,
    "sandbox_timeout": 30, "max_output_chars": 5000,
    "memory_importance_threshold": 0.5, "memory_max_results": 10, "memory_default_tags": "",
    "scheduler_tick_interval": 15, "scheduler_max_concurrent": 5, "scheduler_enabled": True,
    "rag_chunk_size": 512, "rag_chunk_overlap": 50, "rag_top_k": 5,
    "rag_embedding_model": "BAAI/bge-base-en-v1.5",
    # Infrastructure backends
    "memory_backend": "sqlite", "memory_semantic_backend": "chroma", "memory_redis_url": "", "memory_decay_mode": "exponential",
    "memory_hotcache_backend": "", "memory_graph_backend": "",
    "memory_enable_rerank": False, "memory_rerank_model": "",
    "memory_enable_query_expansion": False, "memory_query_expansion_threshold": 0.5,
    "memory_qdrant_url": "http://host.docker.internal:6333", "memory_qdrant_collection": "memorymcp_facts",
    "memory_neo4j_uri": "", "memory_neo4j_user": "neo4j", "memory_neo4j_password": "",
    "rag_vectorstore": "qdrant", "rag_vectorstore_url": "", "rag_vectorstore_api_key": "",
    "rag_graph_backend": "networkx",
    "rag_neo4j_uri": "", "rag_neo4j_user": "neo4j", "rag_neo4j_password": "",
    "workspace_checkpoint_store": "sqlite", "workspace_audit_store": "sqlite",
    "sandbox_audit_store": "sqlite", "sandbox_vault": "memory",
    "scheduler_store": "sqlite",
}


def load_json(path: Path, defaults: dict) -> dict:
    if path.exists():
        try:
            data = json.loads(path.read_text())
            defaults.update({k: v for k, v in data.items() if k in defaults})
        except Exception:
            pass
    return defaults


def save_json(path: Path, data: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2))
    except Exception as exc:
        print(f"[CONFIG] Save failed ({path.name}): {exc}", flush=True)


def is_docker() -> bool:
    return Path("/.dockerenv").exists()


def resolve_url(url: str) -> str:
    if is_docker() and url:
        return url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
    return url


# Loaded at import time
llm_config: dict = load_json(LLM_CONFIG_PATH, {"provider": "ollama", "model": "qwen3.5:9b", "api_key": "", "base_url": ""})
settings: dict = load_json(SETTINGS_PATH, dict(DEFAULT_SETTINGS))


def litellm_kwargs(cfg: dict | None = None) -> dict:
    cfg = cfg if cfg is not None else llm_config
    provider = cfg.get("provider", "openai")
    model = cfg.get("model") or PROVIDER_DEFAULT_MODELS.get(provider, "gpt-4o-mini")
    api_key = cfg.get("api_key", "")
    base_url = resolve_url(cfg.get("base_url", ""))
    kwargs: dict = {}
    if provider == "ollama":
        ollama_base = base_url or ("http://host.docker.internal:11434" if is_docker() else "http://localhost:11434")
        if not ollama_base.endswith("/v1"):
            ollama_base = ollama_base.rstrip("/") + "/v1"
        kwargs["model"] = f"openai/{model}"
        kwargs["api_base"] = ollama_base
        kwargs["api_key"] = "ollama"
    elif provider == "groq":
        kwargs["model"] = f"groq/{model}" if not model.startswith("groq/") else model
        kwargs["api_key"] = api_key
    elif provider == "cerebras":
        kwargs["model"] = f"cerebras/{model}" if not model.startswith("cerebras/") else model
        kwargs["api_key"] = api_key
    elif provider == "gemini":
        # Use litellm's native Gemini routing — no custom api_base
        if model.startswith("gemini/"):
            kwargs["model"] = model
        else:
            kwargs["model"] = f"gemini/{model}"
        kwargs["api_key"] = api_key
        # litellm uses GEMINI_API_KEY env var for AI Studio routing
        if api_key:
            import os
            os.environ["GEMINI_API_KEY"] = api_key
    elif provider == "openai_compatible":
        kwargs["model"] = model if "/" in model else f"openai/{model}"
        if base_url: kwargs["api_base"] = base_url
        if api_key: kwargs["api_key"] = api_key
    else:
        kwargs["model"] = model
        if api_key: kwargs["api_key"] = api_key
    return kwargs


def ns(x_tenant_id: str | None = None) -> str:
    return (x_tenant_id or "").strip() or DEFAULT_NAMESPACE
