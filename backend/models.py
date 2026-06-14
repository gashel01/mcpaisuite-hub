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
    graph_max_self_refines: Optional[int] = None
    graph_max_feedback_runs: Optional[int] = None
    graph_max_total_steps: Optional[int] = None
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
    # Engine + kernel state
    context_window_tokens: Optional[int] = None
    kernel_checkpoint_url: Optional[str] = None
    bootstrap_min_score: Optional[float] = None
    # Infrastructure backends
    memory_backend: Optional[str] = None
    memory_semantic_backend: Optional[str] = None
    memory_redis_url: Optional[str] = None
    memory_decay_mode: Optional[str] = None
    memory_hotcache_backend: Optional[str] = None
    memory_graph_backend: Optional[str] = None
    memory_qdrant_url: Optional[str] = None
    memory_qdrant_collection: Optional[str] = None
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

    # For direct engine tasks, use task.turns
    for t in task.turns:
        entry = {"role": t.role.value if hasattr(t.role, "value") else str(t.role), "content": t.content or ""}
        if t.tool_call:
            entry["tool_name"] = t.tool_call.tool_name
            entry["tool_args"] = t.tool_call.arguments
        if t.tool_result:
            entry["tool_result"] = t.tool_result.output or t.tool_result.error
            entry["tool_success"] = t.tool_result.success
            if t.tool_result.duration_ms: entry["duration_ms"] = round(t.tool_result.duration_ms, 1)
        if t.model: entry["model"] = t.model
        if t.tokens_used: entry["tokens"] = t.tokens_used
        if t.cost: entry["cost"] = round(t.cost, 6)
        if t.timestamp: entry["timestamp"] = t.timestamp.isoformat()
        flat.append(entry)

    # For TaskForce tasks (no direct turns), build trace from metadata result
    if not flat and task.metadata.get("result"):
        result = task.metadata["result"]
        pattern = result.get("pattern", "unknown")
        goal = result.get("goal", task.goal or "")

        # Add task start
        flat.append({"role": "system", "content": f"[{pattern}] {goal}"})

        # Add per-agent outputs
        agent_outputs = result.get("agent_outputs", [])
        for i, output in enumerate(agent_outputs):
            flat.append({
                "role": "assistant",
                "content": output or "(no output)",
                "tool_name": f"agent_{i}",
                "tokens": 0,
            })

        # Add final output
        final = result.get("final_output", "")
        if final:
            flat.append({
                "role": "assistant",
                "content": final,
                "tokens": result.get("total_tokens", 0),
            })

        # Add summary
        flat.append({
            "role": "system",
            "content": f"Completed: {result.get('total_tokens', 0)} tokens, ${result.get('total_cost', 0):.4f} cost, {result.get('duration_ms', 0):.0f}ms",
        })

    return flat


def extract_answer(task) -> str:
    for turn in reversed(task.turns):
        if hasattr(turn.role, "value") and turn.role.value == "assistant" and turn.content and len(turn.content) > 5:
            return turn.content
    return ""
