"""Pydantic models + shared helpers."""
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional


class LLMConfigIn(BaseModel):
    provider: str
    model: str = ""
    api_key: str = ""
    base_url: str = ""


class TaskRequest(BaseModel):
    goal: str
    namespace: str = ""


class ChatMessageIn(BaseModel):
    message: str
    conversation_id: str = "default"
    timezone: str = ""
    execution_mode: str = "react"


class ConstitutionBody(BaseModel):
    rules: str


class WebhookBody(BaseModel):
    event: str
    data: dict = {}


class SpawnAgentRequest(BaseModel):
    agent_type: str
    task: str
    namespace: str = "default"
    max_turns: int = 5
    constitution: str = ""
    tools: list[str] = []
    input_data: dict = {}


class SettingsIn(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    max_turns: Optional[int] = None
    max_tokens: Optional[int] = None
    execution_mode: Optional[str] = None
    tenant_isolation: Optional[bool] = None
    max_file_size_mb: Optional[int] = None
    checkpoint_enabled: Optional[bool] = None
    host_exec_enabled: Optional[bool] = None
    auto_approve: Optional[bool] = None
    sandbox_timeout: Optional[int] = None
    max_output_chars: Optional[int] = None
    memory_importance_threshold: Optional[float] = None
    memory_max_results: Optional[int] = None
    memory_default_tags: Optional[str] = None
    scheduler_tick_interval: Optional[int] = None
    scheduler_max_concurrent: Optional[int] = None
    scheduler_enabled: Optional[bool] = None
    rag_chunk_size: Optional[int] = None
    rag_chunk_overlap: Optional[int] = None
    rag_top_k: Optional[int] = None
    rag_embedding_model: Optional[str] = None
    # Infrastructure backends
    memory_backend: Optional[str] = None
    memory_semantic_backend: Optional[str] = None
    memory_redis_url: Optional[str] = None
    memory_decay_mode: Optional[str] = None
    memory_neo4j_uri: Optional[str] = None
    memory_neo4j_user: Optional[str] = None
    memory_neo4j_password: Optional[str] = None
    rag_vectorstore: Optional[str] = None
    rag_vectorstore_url: Optional[str] = None
    rag_vectorstore_api_key: Optional[str] = None
    rag_graph_backend: Optional[str] = None
    rag_neo4j_uri: Optional[str] = None
    rag_neo4j_user: Optional[str] = None
    rag_neo4j_password: Optional[str] = None
    workspace_checkpoint_store: Optional[str] = None
    workspace_audit_store: Optional[str] = None
    sandbox_audit_store: Optional[str] = None
    sandbox_vault: Optional[str] = None
    scheduler_store: Optional[str] = None


def flatten_turns(task) -> list[dict]:
    flat = []
    for t in task.turns:
        entry = {"role": t.role.value if hasattr(t.role, "value") else str(t.role), "content": t.content or ""}
        if t.tool_call:
            entry["tool_name"] = t.tool_call.tool_name
            entry["tool_args"] = t.tool_call.arguments
        if t.tool_result:
            entry["tool_result"] = t.tool_result.output or t.tool_result.error
            entry["tool_success"] = t.tool_result.success
        if t.model: entry["model"] = t.model
        if t.tokens_used: entry["tokens"] = t.tokens_used
        flat.append(entry)
    return flat


def extract_answer(task) -> str:
    for turn in reversed(task.turns):
        if hasattr(turn.role, "value") and turn.role.value == "assistant" and turn.content and len(turn.content) > 5:
            return turn.content
    return ""
