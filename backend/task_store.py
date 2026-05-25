"""Persistent task storage — SQLite-backed for production reliability."""
from __future__ import annotations
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from kernelmcp.core.models import Task, TaskStatus, Turn, TurnRole, ToolCall, ToolResult, Span, SpanType, SpanStatus

_DB_PATH = os.path.join(os.path.dirname(__file__), "data", "tasks.db")
os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
_db_lock = threading.Lock()

# ── Schema ───────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _init_db():
    with _db_lock:
        conn = _get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                goal TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'completed',
                namespace TEXT NOT NULL DEFAULT 'default',
                total_tokens INTEGER DEFAULT 0,
                total_cost REAL DEFAULT 0.0,
                total_turns INTEGER DEFAULT 0,
                created_at TEXT,
                completed_at TEXT,
                metadata TEXT DEFAULT '{}',
                turns TEXT DEFAULT '[]',
                spans TEXT DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_ns ON tasks(namespace);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
        """)
        conn.close()

_init_db()


# ── Public API (same interface as before) ────────────────────────────────────

def save_task(task: Task) -> None:
    """Persist a task to SQLite."""
    try:
        metadata = _serialize_metadata(task.metadata)
        turns = [_serialize_turn(t) for t in task.turns]
        spans = [_serialize_span(s) for s in (task.spans or [])]

        with _db_lock:
            conn = _get_conn()
            conn.execute("""
                INSERT OR REPLACE INTO tasks
                (id, goal, status, namespace, total_tokens, total_cost, total_turns, created_at, completed_at, metadata, turns, spans)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                task.id,
                task.goal,
                task.status.value,
                task.namespace,
                task.total_tokens,
                task.total_cost,
                task.total_turns,
                task.created_at.isoformat() if task.created_at else None,
                task.completed_at.isoformat() if task.completed_at else None,
                json.dumps(metadata, default=str),
                json.dumps(turns, default=str),
                json.dumps(spans, default=str),
            ))
            conn.commit()
            conn.close()
    except Exception as exc:
        print(f"[TASK_STORE] save_task failed for {task.id}: {exc}", flush=True)


def load_all_tasks() -> dict[str, Task]:
    """Load all persisted tasks. Returns {task_id: Task}."""
    tasks: dict[str, Task] = {}
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 1000").fetchall()
        conn.close()
    for row in rows:
        try:
            task = _row_to_task(row)
            if task:
                tasks[task.id] = task
        except Exception:
            pass
    return tasks


def get_task(task_id: str) -> Task | None:
    """Load a single task by ID."""
    with _db_lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        conn.close()
    return _row_to_task(row) if row else None


def delete_task(task_id: str) -> bool:
    """Delete a task by ID."""
    with _db_lock:
        conn = _get_conn()
        cursor = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        deleted = cursor.rowcount > 0
        conn.close()
    return deleted


def count_tasks(namespace: str = "") -> int:
    """Count tasks, optionally filtered by namespace."""
    with _db_lock:
        conn = _get_conn()
        if namespace:
            row = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE namespace = ? OR namespace LIKE ?", (namespace, f"{namespace}__%")).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) as c FROM tasks").fetchone()
        conn.close()
    return row["c"] if row else 0


def query_tasks(namespace: str = "", status: str = "", limit: int = 100, offset: int = 0) -> list[Task]:
    """Query tasks with filters."""
    conditions = []
    params: list = []
    if namespace:
        conditions.append("(namespace = ? OR namespace LIKE ?)")
        params.extend([namespace, f"{namespace}__%"])
    if status:
        conditions.append("status = ?")
        params.append(status)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])

    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(f"SELECT * FROM tasks {where} ORDER BY created_at DESC LIMIT ? OFFSET ?", params).fetchall()
        conn.close()

    return [t for row in rows if (t := _row_to_task(row))]


def cleanup_old(retain_days: int = 30, retain_min: int = 100) -> int:
    """Delete tasks older than retain_days, keeping at least retain_min."""
    cutoff = datetime.now(timezone.utc).isoformat()[:10]  # date only
    with _db_lock:
        conn = _get_conn()
        total = conn.execute("SELECT COUNT(*) as c FROM tasks").fetchone()["c"]
        if total <= retain_min:
            conn.close()
            return 0
        # Find IDs to delete (oldest first, keep retain_min)
        deletable = total - retain_min
        rows = conn.execute(
            "SELECT id FROM tasks WHERE date(created_at) < date(?, '-' || ? || ' days') ORDER BY created_at ASC LIMIT ?",
            (cutoff, retain_days, deletable)
        ).fetchall()
        ids = [r["id"] for r in rows]
        if ids:
            placeholders = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", ids)
            conn.commit()
        conn.close()
    return len(ids)


# ── Migration: import existing JSON files ────────────────────────────────────

def migrate_json_files():
    """One-time migration: import JSON task files into SQLite."""
    json_dir = os.path.join(os.path.dirname(__file__), "data", "tasks")
    if not os.path.isdir(json_dir):
        return 0
    imported = 0
    for fname in os.listdir(json_dir):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(json_dir, fname), "r", encoding="utf-8") as f:
                data = json.load(f)
            # Check if already in DB
            with _db_lock:
                conn = _get_conn()
                exists = conn.execute("SELECT 1 FROM tasks WHERE id = ?", (data["id"],)).fetchone()
                if not exists:
                    conn.execute("""
                        INSERT INTO tasks (id, goal, status, namespace, total_tokens, total_cost, total_turns, created_at, completed_at, metadata, turns, spans)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        data["id"],
                        data.get("goal", ""),
                        data.get("status", "completed"),
                        data.get("namespace", "default"),
                        data.get("total_tokens", 0),
                        data.get("total_cost", 0.0),
                        data.get("total_turns", 0),
                        data.get("created_at"),
                        data.get("completed_at"),
                        json.dumps(data.get("metadata", {}), default=str),
                        json.dumps(data.get("turns", []), default=str),
                        json.dumps(data.get("spans", []), default=str),
                    ))
                    conn.commit()
                    imported += 1
                conn.close()
        except Exception:
            pass
    if imported:
        print(f"[TASK_STORE] Migrated {imported} JSON files to SQLite", flush=True)
    return imported


# ── Serialization helpers ────────────────────────────────────────────────────

def _serialize_metadata(meta: dict) -> dict:
    safe = {}
    for k, v in meta.items():
        if k in ("human_gate", "_span_collector"):
            continue
        try:
            json.dumps(v, default=str)
            safe[k] = v
        except (TypeError, ValueError):
            safe[k] = str(v)
    return safe


def _serialize_turn(turn: Turn) -> dict:
    d: dict = {"role": turn.role.value, "content": turn.content or ""}
    if turn.tool_call:
        tc = turn.tool_call
        d["tool_call"] = {"tool_name": tc.tool_name, "arguments": tc.arguments, "id": tc.id}
    if turn.tool_result:
        tr = turn.tool_result
        d["tool_result"] = {"tool_call_id": tr.tool_call_id, "success": tr.success, "output": (tr.output or "")[:500], "error": tr.error or ""}
    if turn.tokens_used:
        d["tokens"] = turn.tokens_used
    if turn.cost:
        d["cost"] = turn.cost
    return d


def _serialize_span(span: Span) -> dict:
    return {
        "id": span.id, "parent_id": span.parent_id, "trace_id": span.trace_id,
        "name": span.name,
        "type": span.type.value if hasattr(span.type, "value") else str(span.type),
        "start_time": span.start_time, "end_time": span.end_time,
        "status": span.status.value if hasattr(span.status, "value") else str(span.status),
        "input": span.input, "output": span.output, "metadata": span.metadata,
        "error": span.error,
        "children": [_serialize_span(c) for c in span.children],
    }


# ── Deserialization ──────────────────────────────────────────────────────────

def _row_to_task(row) -> Task | None:
    try:
        task = Task(goal=row["goal"] or "", namespace=row["namespace"] or "default")
        task.id = row["id"]
        task.status = TaskStatus(row["status"] or "completed")
        task.total_tokens = row["total_tokens"] or 0
        task.total_cost = row["total_cost"] or 0.0
        task.total_turns = row["total_turns"] or 0
        if row["created_at"]:
            try: task.created_at = datetime.fromisoformat(row["created_at"])
            except (ValueError, TypeError): pass
        if row["completed_at"]:
            try: task.completed_at = datetime.fromisoformat(row["completed_at"])
            except (ValueError, TypeError): pass
        task.metadata = json.loads(row["metadata"] or "{}")
        for td in json.loads(row["turns"] or "[]"):
            turn = Turn(role=TurnRole(td.get("role", "system")), content=td.get("content", ""))
            if td.get("tool_call"):
                tc_data = td["tool_call"]
                turn.tool_call = ToolCall(tool_name=tc_data.get("tool_name", ""), arguments=tc_data.get("arguments", {}))
                turn.tool_call.id = tc_data.get("id", turn.tool_call.id)
            if td.get("tool_result"):
                tr_data = td["tool_result"]
                turn.tool_result = ToolResult(tool_call_id=tr_data.get("tool_call_id", ""), success=tr_data.get("success", True), output=tr_data.get("output", ""), error=tr_data.get("error", ""))
            turn.tokens_used = td.get("tokens", 0)
            turn.cost = td.get("cost", 0.0)
            task.turns.append(turn)
        for sd in json.loads(row["spans"] or "[]"):
            try: task.spans.append(_deserialize_span(sd))
            except Exception: pass
        return task
    except Exception:
        return None


def _deserialize_span(data: dict) -> Span:
    return Span(
        id=data.get("id", ""), parent_id=data.get("parent_id"),
        trace_id=data.get("trace_id", ""), name=data.get("name", ""),
        type=SpanType(data.get("type", "chain")),
        start_time=data.get("start_time", 0), end_time=data.get("end_time"),
        status=SpanStatus(data.get("status", "ok")),
        input=data.get("input", {}), output=data.get("output", {}),
        metadata=data.get("metadata", {}), error=data.get("error", ""),
        children=[_deserialize_span(c) for c in data.get("children", [])],
    )
