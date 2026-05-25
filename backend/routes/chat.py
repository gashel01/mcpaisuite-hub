"""Chat, conversations, and task endpoints."""
from __future__ import annotations
import os
import json
import asyncio
from fastapi import APIRouter, HTTPException, Query, Header
from fastapi.responses import StreamingResponse
from kernelmcp.core.models import TaskStatus, Task, _now

from config import ns, DEFAULT_NAMESPACE
from models import TaskRequest, ChatMessageIn, flatten_turns, extract_answer
from stores import conversations, task_runner, audit_collector

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


async def execute_task(task: Task, k) -> None:
    """Run a task and update stats."""
    audit_collector.emit("engine", "task_started", {
        "task_id": task.id,
        "goal": task.metadata.get("original_message", task.goal)[:200],
        "namespace": task.namespace,
    })
    try:
        await k._engine.run(task)
    except Exception as exc:
        task.status = TaskStatus.failed
        task.completed_at = _now()
        print(f"[ENGINE ERROR] task={task.id} error={exc}", flush=True)
        import traceback; traceback.print_exc()
        audit_collector.emit("engine", "task_error", {"task_id": task.id, "error": str(exc)[:300]})

    # Log completion with full details
    tools_used = [t.tool_call.tool_name for t in task.turns if t.tool_call]
    audit_collector.emit("engine", "task_completed" if task.status == TaskStatus.completed else "task_failed", {
        "task_id": task.id,
        "status": task.status.value,
        "turns": task.total_turns,
        "tokens": task.total_tokens,
        "cost": round(task.total_cost, 6),
        "tools_used": tools_used,
        "duration_ms": round(task.duration_ms),
        "answer": task.summary[:150] if task.summary else "",
    })

    # Persist task to disk
    from task_store import save_task as _persist_task
    _persist_task(task)

    if task.status == TaskStatus.completed:
        k._stats.tasks_completed += 1
    else:
        k._stats.tasks_failed += 1
    k._stats.total_tokens += task.total_tokens
    k._stats.total_cost += task.total_cost


# ── Tasks ────────────────────────────────────────────────────────────────────

@router.post("/tasks")
async def create_task(body: TaskRequest, x_tenant_id: str = Header(default="")):
    k = _require()
    task_ns = body.namespace or ns(x_tenant_id)
    task = Task(goal=body.goal, namespace=task_ns)
    k._tasks[task.id] = task
    await task_runner.submit(task.id, lambda: execute_task(task, k))
    return {"id": task.id, "goal": task.goal, "status": task.status.value, "namespace": task_ns}


@router.get("/tasks")
async def list_tasks(x_tenant_id: str = Header(default="")):
    k = _require()
    tasks = await k.list_tasks(ns(x_tenant_id))
    return {"tasks": [{"id": t.id, "goal": t.goal[:100], "status": t.status.value, "total_turns": t.total_turns} for t in tasks], "total": len(tasks)}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, x_tenant_id: str = Header(default="")):
    k = _require()
    task = k._tasks.get(task_id)  # Direct lookup (tasks may have sub-namespaces)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task.id, "goal": task.goal, "status": task.status.value, "turns": flatten_turns(task), "total_tokens": task.total_tokens, "total_cost": task.total_cost, "total_turns": task.total_turns, "namespace": task.namespace, "metadata": task.metadata.get("result", {})}


@router.delete("/tasks/{task_id}")
async def cancel_task(task_id: str, x_tenant_id: str = Header(default="")):
    k = _require()
    task = await k.cancel_task(task_id, namespace=ns(x_tenant_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task_runner.cancel(task_id)
    return {"id": task_id, "status": "cancelled"}


@router.post("/tasks/{task_id}/pause")
async def pause_task(task_id: str, x_tenant_id: str = Header(default="")):
    """Pause a running task after its current turn completes."""
    k = _require()
    task = await k.pause_task(task_id, namespace=ns(x_tenant_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "status": task.status.value}


@router.post("/tasks/{task_id}/resume")
async def resume_task(task_id: str, body: dict = {}, x_tenant_id: str = Header(default="")):
    """Resume a paused task. Optionally pass modified_output to inject before continuing."""
    k = _require()
    modified_output = body.get("modified_output")
    task = await k.resume_task(task_id, modified_output=modified_output, namespace=ns(x_tenant_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "status": task.status.value, "modified": modified_output is not None}


@router.post("/tasks/{task_id}/human-gate/{node_id}/approve")
async def approve_human_gate(task_id: str, node_id: str, body: dict = {}, x_tenant_id: str = Header(default="")):
    """Respond to a human gate: approve, deny, or feedback."""
    from routes.api import _active_executors
    executor = _active_executors.get(task_id)
    if not executor:
        raise HTTPException(status_code=404, detail="No active executor for this task")
    action = body.get("action", "approve")  # "approve", "deny", "feedback"
    modified = body.get("modified_output")
    executor.resume_human_gate(node_id, action=action, modified_output=modified)
    k = _require()
    task = k._tasks.get(task_id)
    if task:
        from kernelmcp.core.models import TaskStatus
        task.status = TaskStatus.running
    return {"action": action, "node_id": node_id, "modified": modified is not None}


@router.get("/tasks/{task_id}/turns")
async def get_turns(task_id: str, x_tenant_id: str = Header(default="")):
    k = _require()
    task = await k.get_task(task_id, namespace=ns(x_tenant_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task_id": task_id, "turns": flatten_turns(task), "total": len(task.turns)}


# ── Chat ─────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(body: ChatMessageIn, x_tenant_id: str = Header(default="")):
    k = _require()
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    chat_ns = ns(x_tenant_id)
    conv_id = body.conversation_id or "default"
    conversations.add_message(chat_ns, conv_id, "user", body.message)

    # Set execution mode — force react for simple messages
    mode = body.execution_mode
    if mode in ("react", "ltp", "hybrid"):
        k._engine._mode = mode

    # Enable/disable network for this task
    if hasattr(k._engine, '_orchestrator') and k._engine._orchestrator.sandbox:
        net = k._engine._orchestrator.sandbox._network
        if net:
            enable = body.__dict__.get("enable_network", net._enabled)
            if isinstance(enable, bool):
                net._enabled = enable

    # Inject conversation history so the LLM has context
    history = conversations.get_messages(chat_ns, conv_id)
    goal = body.message
    if history and len(history) > 1:
        # Last 6 messages max to avoid blowing context
        recent = history[-6:-1] if len(history) > 6 else history[:-1]
        history_lines = [f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content'][:300]}" for m in recent]
        goal = f"[Conversation context]\n" + "\n".join(history_lines) + f"\n\n[Current message]\n{body.message}"

    task = Task(goal=goal, namespace=chat_ns)
    task.metadata["conversation_id"] = conv_id
    task.metadata["original_message"] = body.message
    # Pass budget caps from settings
    from config import settings
    task.metadata["max_cost"] = float(settings.get("max_cost", 1.0))
    task.metadata["max_tokens"] = int(settings.get("max_tokens", 50000))
    k._tasks[task.id] = task
    await task_runner.submit(task.id, lambda: _chat_execute(task, k, chat_ns, conv_id))
    return {"task_id": task.id, "conversation_id": conv_id}


async def _chat_execute(task, k, chat_ns, conv_id):
    # Wire elicitation — engine can ask user questions (demo has UI to answer)
    k._engine._ask_user_fn = lambda q: k.ask_user(task.id, q)
    k._elicitation_futures_enabled = True  # Demo UI can respond
    k._tasks[task.id] = task  # Register task so ask_user can find it

    # Snapshot background tokens before execution
    from stores import background_token_counter
    bg_before = background_token_counter["total"]
    await execute_task(task, k)
    # Add background LLM tokens (memory extraction, planning, etc.)
    bg_used = background_token_counter["total"] - bg_before
    task.total_tokens += bg_used
    answer = extract_answer(task)
    if answer:
        conversations.add_answer(
            chat_ns, conv_id, task.id, answer,
            turns=flatten_turns(task),
            tokens=task.total_tokens,
            cost=task.total_cost,
            bootstrap_sources=task.metadata.get("bootstrap_sources", []),
        )
        audit_collector.emit("chat", "answer_stored", {
            "conv_id": conv_id, "task_id": task.id, "namespace": chat_ns,
            "answer_len": len(answer),
        })


@router.post("/chat/elicit/{task_id}")
async def respond_to_elicitation(task_id: str, body: dict, x_tenant_id: str = Header(default="")):
    """User responds to an ask_user question."""
    k = _require()
    response = body.get("response", "")
    ok = k.respond_to_elicitation(task_id, response)
    return {"ok": ok, "task_id": task_id}


@router.get("/chat/{conversation_id}/task/{task_id}")
async def poll_chat_task(conversation_id: str, task_id: str, x_tenant_id: str = Header(default="")):
    k = _require()
    task = await k.get_task(task_id, namespace=ns(x_tenant_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    result = {"id": task.id, "status": task.status.value, "turns": flatten_turns(task), "total_tokens": task.total_tokens, "total_cost": task.total_cost, "total_turns": task.total_turns, "bootstrap_sources": task.metadata.get("bootstrap_sources", [])}
    if task.status in (TaskStatus.completed, TaskStatus.failed, TaskStatus.cancelled):
        result["answer"] = extract_answer(task)
    if task.status == TaskStatus.waiting_for_user:
        result["elicitation"] = task.metadata.get("elicitation_question", "")
    return result


@router.get("/chat/{conversation_id}/stream/{task_id}")
async def stream_task(conversation_id: str, task_id: str, x_tenant_id: str = Header(default="")):
    """SSE stream of task progress — pushes each new turn as it happens."""
    k = _require()

    async def event_gen():
        last_turn_count = 0
        while True:
            task = await k.get_task(task_id)
            if not task:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Task not found'})}\n\n"
                break

            turns = flatten_turns(task)
            new_turns = turns[last_turn_count:]

            # Push new turns
            for t in new_turns:
                yield f"data: {json.dumps({'type': 'turn', 'turn': t}, default=str)}\n\n"
            last_turn_count = len(turns)

            # Elicitation — kernel is asking the user a question
            if task.status == TaskStatus.waiting_for_user:
                question = task.metadata.get("elicitation_question", "")
                yield f"data: {json.dumps({'type': 'elicitation', 'task_id': task_id, 'question': question})}\n\n"

            # Check if done
            if task.status in (TaskStatus.completed, TaskStatus.failed, TaskStatus.cancelled):
                answer = extract_answer(task)
                yield f"data: {json.dumps({'type': 'done', 'status': task.status.value, 'answer': answer, 'total_tokens': task.total_tokens, 'total_cost': task.total_cost, 'total_turns': task.total_turns, 'turns': turns, 'bootstrap_sources': task.metadata.get('bootstrap_sources', [])}, default=str)}\n\n"
                break

            # Push progress
            if not new_turns:
                yield f"data: {json.dumps({'type': 'progress', 'status': task.status.value, 'turns_count': len(turns)})}\n\n"

            await asyncio.sleep(0.5)

    return StreamingResponse(event_gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@router.get("/chat/{conversation_id}")
async def get_conversation(conversation_id: str, x_tenant_id: str = Header(default="")):
    k = _require()
    chat_ns = ns(x_tenant_id)
    msgs = conversations.get_messages(chat_ns, conversation_id)

    # Check if there's a running task for this conversation
    running_task_id = None
    for tid, task in k._tasks.items():
        if (task.metadata.get("conversation_id") == conversation_id
                and task.namespace == chat_ns
                and task.status.value == "running"):
            running_task_id = tid
            break

    return {"messages": msgs, "running_task_id": running_task_id}


@router.delete("/chat/{conversation_id}")
async def clear_conversation(conversation_id: str, x_tenant_id: str = Header(default="")):
    conversations.delete(ns(x_tenant_id), conversation_id)
    return {"cleared": conversation_id}


@router.get("/conversations")
async def list_conversations(x_tenant_id: str = Header(default="")):
    return {"conversations": conversations.list_for_namespace(ns(x_tenant_id))}
