"""SSE endpoint for streaming task execution events in real-time."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse

from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType
from config import ns

router = APIRouter()
kernel = None  # set by server.py


_TERMINAL = {
    KernelEventType.task_completed,
    KernelEventType.task_failed,
    KernelEventType.task_cancelled,
    KernelEventType.taskforce_completed,
    KernelEventType.taskforce_failed,
}


@router.get("/api/stream/{task_id}")
async def stream_task(task_id: str, x_tenant_id: str = Header(default=""), tenant: str = ""):
    """SSE endpoint -- streams task execution events in real-time.

    Connect with EventSource:
        const es = new EventSource('/api/stream/<task_id>?tenant=demo');
        es.onmessage = (e) => console.log(JSON.parse(e.data));
    """
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")

    base_namespace = ns(x_tenant_id or tenant)

    # Find the task first to get its actual namespace (may be run-isolated)
    task = None
    for _ in range(10):
        # Try run-isolated namespace pattern first, then base
        task = kernel._tasks.get(task_id)
        if task is not None:
            break
        await asyncio.sleep(0.2)

    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # Subscribe to the task's actual namespace (run-isolated)
    namespace = task.namespace or base_namespace
    queue = kernel_event_bus.subscribe(namespace=namespace)

    # If task already completed before SSE connects, send a synthetic completion event
    already_done = task.status.value in ("completed", "failed", "cancelled")

    async def event_generator():
        try:
            # If task already finished, replay buffered events then send completion
            if already_done and queue.empty():
                result_data = task.metadata.get("result", {})
                _is_success = task.status.value == "completed"
                payload = json.dumps({
                    "type": "task_complete" if _is_success else "task_failed",
                    "message": f"taskforce.{'completed' if _is_success else 'failed'}",
                    "task_id": task_id,
                    "status": task.status.value,
                    "data": {
                        "tokens": result_data.get("total_tokens", task.total_tokens or 0),
                        "cost": result_data.get("total_cost", task.total_cost or 0),
                        "turns": result_data.get("total_turns", 0),
                        "duration_ms": result_data.get("duration_ms", 0),
                        "success": _is_success,
                    },
                })
                yield f"data: {payload}\n\n"
                return

            while True:
                try:
                    event: KernelEvent = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Send keepalive to prevent connection timeout
                    yield ": keepalive\n\n"
                    # Check if task is done
                    t = await kernel.get_task(task_id)
                    if t and t.status.value in ("completed", "failed", "cancelled"):
                        _ok = t.status.value == "completed"
                        payload = json.dumps({
                            "type": "task_complete" if _ok else "task_failed",
                            "task_id": task_id,
                            "status": t.status.value,
                            "data": {
                                "tokens": t.total_tokens or 0,
                                "cost": t.total_cost or 0,
                                "turns": getattr(t, "total_turns", 0) or 0,
                                "success": _ok,
                            },
                        })
                        yield f"data: {payload}\n\n"
                        return
                    continue

                payload = json.dumps({
                    "type": event.type.value,
                    "message": event.message,
                    "data": event.data,
                    "timestamp": event.timestamp.isoformat(),
                }, default=str)
                yield f"data: {payload}\n\n"

                if event.type in _TERMINAL:
                    # Small yield to ensure client processes the message before close
                    yield ": end\n\n"
                    return
        finally:
            kernel_event_bus.unsubscribe(queue, namespace=namespace)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
