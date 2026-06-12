"""Trace retention policy and human review queue endpoints."""

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Header, Query, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

# Shared annotations-SQLite infra lives in routes.traces (one-directional import).
from routes.traces import _db_lock, _get_conn

# ---------------------------------------------------------------------------
# Retention policy
# ---------------------------------------------------------------------------

_RETENTION_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "retention.json")


def _load_retention() -> dict:
    if os.path.isfile(_RETENTION_PATH):
        with open(_RETENTION_PATH, "r") as f:
            return json.load(f)
    return {"retain_days": 30, "retain_min_count": 100, "auto_cleanup": False}


def _save_retention(cfg: dict) -> None:
    with open(_RETENTION_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


@router.get("/retention")
async def get_retention():
    """Get current retention policy."""
    cfg = _load_retention()

    # Count current tasks
    try:
        from task_store import load_all_tasks
        task_count = len(load_all_tasks())
    except (ImportError, AttributeError):
        task_count = 0

    # Calculate what would be deleted
    deletable = 0
    if cfg.get("auto_cleanup"):
        cutoff = datetime.now(timezone.utc).timestamp() - cfg.get("retain_days", 30) * 86400
        try:
            from task_store import load_all_tasks
            for task in load_all_tasks().values():
                try:
                    ts = task.completed_at.timestamp() if task.completed_at else task.created_at.timestamp()
                    if ts < cutoff:
                        deletable += 1
                except (AttributeError, TypeError):
                    pass
        except (ImportError, AttributeError):
            pass
        # Respect min count
        deletable = max(0, deletable - max(0, cfg.get("retain_min_count", 100) - (task_count - deletable)))

    return {**cfg, "task_count": task_count, "deletable": deletable}


class RetentionConfig(BaseModel):
    retain_days: int = 30
    retain_min_count: int = 100
    auto_cleanup: bool = False


@router.put("/retention")
async def update_retention(body: RetentionConfig):
    """Update retention policy."""
    cfg = {"retain_days": body.retain_days, "retain_min_count": body.retain_min_count, "auto_cleanup": body.auto_cleanup}
    _save_retention(cfg)
    return cfg


@router.post("/retention/cleanup")
async def run_cleanup(x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    """Manually run retention cleanup."""
    cfg = _load_retention()
    cutoff = datetime.now(timezone.utc).timestamp() - cfg.get("retain_days", 30) * 86400
    min_count = cfg.get("retain_min_count", 100)

    try:
        from task_store import load_all_tasks, _TASKS_DIR
        tasks = load_all_tasks()
    except (ImportError, AttributeError):
        return {"deleted": 0, "remaining": 0}

    # Sort by date, oldest first
    dated = []
    for tid, task in tasks.items():
        try:
            ts = task.completed_at.timestamp() if task.completed_at else task.created_at.timestamp()
            dated.append((tid, ts))
        except (AttributeError, TypeError):
            pass
    dated.sort(key=lambda x: x[1])

    deleted = 0
    remaining = len(dated)
    for tid, ts in dated:
        if remaining <= min_count:
            break
        if ts < cutoff:
            path = os.path.join(_TASKS_DIR, f"{tid}.json")
            if os.path.isfile(path):
                os.remove(path)
                deleted += 1
                remaining -= 1

    return {"deleted": deleted, "remaining": remaining}


# ---------------------------------------------------------------------------
# Review Queue (Phase 7)
# ---------------------------------------------------------------------------

VALID_LABELS = {"correct", "incorrect", "partially_correct", "hallucinated", "harmful", "off_topic"}


@router.get("/review/queue")
async def get_review_queue(
    status: str = "pending",
    limit: int = 50,
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Get items in the review queue."""
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM review_queue WHERE status = ? ORDER BY priority DESC, queued_at ASC LIMIT ?",
            (status, limit),
        ).fetchall()
        conn.close()
    return {"items": [dict(r) for r in rows], "count": len(rows)}


@router.post("/review/queue")
async def add_to_queue(body: dict):
    """Manually add a task to the review queue."""
    task_id = body.get("task_id", "")
    reason = body.get("reason", "manual")
    priority = body.get("priority", 0)
    if not task_id:
        raise HTTPException(400, "task_id required")

    now = datetime.now(timezone.utc).isoformat()
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO review_queue (id, task_id, reason, priority, status, queued_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                (str(uuid.uuid4()), task_id, reason, priority, now),
            )
            conn.commit()
        except Exception:
            pass
        conn.close()
    return {"ok": True}


@router.post("/review/queue/{item_id}/review")
async def mark_reviewed(item_id: str):
    """Mark a queue item as reviewed."""
    now = datetime.now(timezone.utc).isoformat()
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE review_queue SET status = 'reviewed', reviewed_at = ? WHERE id = ? OR task_id = ?",
            (now, item_id, item_id),
        )
        conn.commit()
        conn.close()
    return {"ok": True}


@router.delete("/review/queue/{item_id}")
async def remove_from_queue(item_id: str):
    """Remove an item from the review queue."""
    with _db_lock:
        conn = _get_conn()
        conn.execute("DELETE FROM review_queue WHERE id = ? OR task_id = ?", (item_id, item_id))
        conn.commit()
        conn.close()
    return {"ok": True}


@router.post("/review/auto-queue")
async def auto_queue_tasks(
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Auto-queue failed and expensive tasks for review."""
    from task_store import load_all_tasks

    tasks = load_all_tasks()
    queued = 0
    now = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_conn()
        for tid, task in tasks.items():
            ns = getattr(task, "namespace", "")
            if x_tenant_id and ns != x_tenant_id and not ns.startswith(x_tenant_id):
                continue

            reason = ""
            priority = 0

            # Auto-queue failed tasks
            status = task.status.value if hasattr(task.status, "value") else str(task.status)
            if status == "failed":
                reason = "failed"
                priority = 2

            # Auto-queue expensive tasks (> $0.05)
            elif getattr(task, "total_cost", 0) > 0.05:
                reason = f"expensive (${task.total_cost:.4f})"
                priority = 1

            # Auto-queue high-turn tasks (> 8 turns)
            elif getattr(task, "total_turns", 0) > 8:
                reason = f"high_turns ({task.total_turns})"
                priority = 0

            if reason:
                # Skip if already in queue
                existing = conn.execute("SELECT 1 FROM review_queue WHERE task_id = ?", (tid,)).fetchone()
                if not existing:
                    conn.execute(
                        "INSERT INTO review_queue (id, task_id, reason, priority, status, queued_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                        (str(uuid.uuid4()), tid, reason, priority, now),
                    )
                    queued += 1

        conn.commit()
        conn.close()

    return {"queued": queued}


@router.get("/review/stats")
async def review_stats():
    """Review queue stats."""
    with _db_lock:
        conn = _get_conn()
        pending = conn.execute("SELECT COUNT(*) as c FROM review_queue WHERE status = 'pending'").fetchone()["c"]
        reviewed = conn.execute("SELECT COUNT(*) as c FROM review_queue WHERE status = 'reviewed'").fetchone()["c"]

        # Label distribution from annotations
        label_rows = conn.execute("SELECT labels FROM annotations WHERE labels != '[]'").fetchall()
        conn.close()

    label_counts: dict[str, int] = {}
    for row in label_rows:
        try:
            for label in json.loads(row["labels"] or "[]"):
                label_counts[label] = label_counts.get(label, 0) + 1
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "pending": pending,
        "reviewed": reviewed,
        "label_distribution": label_counts,
    }


@router.get("/review/labels")
async def list_labels():
    """List available annotation labels."""
    return {
        "labels": [
            {"id": "correct", "label": "Correct", "color": "emerald"},
            {"id": "incorrect", "label": "Incorrect", "color": "red"},
            {"id": "partially_correct", "label": "Partially Correct", "color": "amber"},
            {"id": "hallucinated", "label": "Hallucinated", "color": "violet"},
            {"id": "harmful", "label": "Harmful", "color": "rose"},
            {"id": "off_topic", "label": "Off-topic", "color": "slate"},
        ]
    }
