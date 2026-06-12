"""Bounded stores — conversations (SQLite), task runner, audit collector."""
from __future__ import annotations
import asyncio
import json
import os
import sqlite3
import threading
import time

MAX_CONVERSATIONS_PER_NS = 50
MAX_MESSAGES_PER_CONV = 100
MAX_RUNNING_TASKS = 10

import os as _os
DB_PATH = _os.path.join(_os.getenv("KERNELMCP_DATA_DIR", "/app/data"), "conversations.db")


class ConversationStore:
    """Namespace-scoped conversation store backed by SQLite.

    Messages are persisted across restarts. answered_task_ids are tracked
    to prevent duplicate assistant responses.
    """

    def __init__(self, db_path: str = DB_PATH, max_convs_per_ns: int = MAX_CONVERSATIONS_PER_NS, max_msgs: int = MAX_MESSAGES_PER_CONV) -> None:
        self._db_path = db_path
        self._max_convs_per_ns = max_convs_per_ns
        self._max_msgs = max_msgs
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    ns TEXT NOT NULL,
                    conv_id TEXT NOT NULL,
                    messages TEXT NOT NULL DEFAULT '[]',
                    answered_ids TEXT NOT NULL DEFAULT '[]',
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (ns, conv_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_conv_ns ON conversations(ns, updated_at)")
            conn.commit()
            conn.close()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db_path)

    def get_or_create(self, ns: str, conv_id: str) -> dict:
        with self._lock:
            conn = self._conn()
            row = conn.execute("SELECT messages, answered_ids FROM conversations WHERE ns=? AND conv_id=?", (ns, conv_id)).fetchone()
            if row:
                conn.close()
                return {"namespace": ns, "messages": json.loads(row[0]), "answered_task_ids": set(json.loads(row[1]))}
            # Evict oldest if at limit
            count = conn.execute("SELECT COUNT(*) FROM conversations WHERE ns=?", (ns,)).fetchone()[0]
            if count >= self._max_convs_per_ns:
                conn.execute("DELETE FROM conversations WHERE ns=? AND conv_id=(SELECT conv_id FROM conversations WHERE ns=? ORDER BY updated_at ASC LIMIT 1)", (ns, ns))
            conn.execute("INSERT INTO conversations(ns, conv_id, messages, answered_ids, updated_at) VALUES(?,?,?,?,?)",
                         (ns, conv_id, "[]", "[]", time.time()))
            conn.commit()
            conn.close()
            return {"namespace": ns, "messages": [], "answered_task_ids": set()}

    def _save(self, ns: str, conv_id: str, conv: dict) -> None:
        with self._lock:
            conn = self._conn()
            conn.execute(
                "UPDATE conversations SET messages=?, answered_ids=?, updated_at=? WHERE ns=? AND conv_id=?",
                (json.dumps(conv["messages"], default=str), json.dumps(list(conv["answered_task_ids"])), time.time(), ns, conv_id),
            )
            conn.commit()
            conn.close()

    def add_message(self, ns: str, conv_id: str, role: str, content: str) -> None:
        conv = self.get_or_create(ns, conv_id)
        conv["messages"].append({"role": role, "content": content, "timestamp": time.time() * 1000})
        if len(conv["messages"]) > self._max_msgs:
            conv["messages"] = conv["messages"][-self._max_msgs:]
        self._save(ns, conv_id, conv)

    def add_answer(self, ns: str, conv_id: str, task_id: str, content: str, turns: list | None = None, tokens: int = 0, cost: float = 0, bootstrap_sources: list | None = None) -> bool:
        conv = self.get_or_create(ns, conv_id)
        if task_id in conv["answered_task_ids"]:
            return False
        conv["answered_task_ids"].add(task_id)
        msg: dict = {"role": "assistant", "content": content, "task_id": task_id, "timestamp": time.time() * 1000}
        if turns: msg["turns"] = turns
        if tokens: msg["tokens"] = tokens
        if cost: msg["cost"] = cost
        if bootstrap_sources: msg["bootstrap_sources"] = bootstrap_sources
        conv["messages"].append(msg)
        self._save(ns, conv_id, conv)
        return True

    def get_messages(self, ns: str, conv_id: str) -> list[dict]:
        conv = self.get_or_create(ns, conv_id)
        return conv["messages"]

    def delete(self, ns: str, conv_id: str) -> bool:
        with self._lock:
            conn = self._conn()
            cursor = conn.execute("DELETE FROM conversations WHERE ns=? AND conv_id=?", (ns, conv_id))
            conn.commit()
            deleted = cursor.rowcount > 0
            conn.close()
            return deleted

    @staticmethod
    def _make_title(msgs: list[dict]) -> str:
        """Generate a title from the first user message."""
        for m in msgs:
            if m.get("role") == "user":
                text = m["content"]
                # Strip conversation context prefix
                if "[Current message]" in text:
                    text = text.split("[Current message]")[-1]
                text = text.strip()
                if len(text) > 45:
                    return text[:42] + "..."
                return text
        return "New chat"

    def list_for_namespace(self, ns: str) -> list[dict]:
        with self._lock:
            conn = self._conn()
            rows = conn.execute("SELECT conv_id, messages FROM conversations WHERE ns=? ORDER BY updated_at DESC", (ns,)).fetchall()
            conn.close()
        result = []
        for conv_id, msgs_json in rows:
            msgs = json.loads(msgs_json)
            if not msgs:
                continue  # Skip empty conversations
            result.append({
                "id": conv_id,
                "title": self._make_title(msgs),
                "messages": len(msgs),
                "last": msgs[-1]["content"][:50] if msgs else "",
            })
        return result


class TaskRunner:
    """Bounded async task runner with cleanup."""

    def __init__(self, max_concurrent: int = MAX_RUNNING_TASKS) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._futures: dict[str, asyncio.Task] = {}

    async def submit(self, task_id: str, coro) -> None:
        self._cleanup()
        async def _guarded():
            async with self._semaphore:
                await coro()
        self._futures[task_id] = asyncio.create_task(_guarded())

    def cancel(self, task_id: str) -> bool:
        future = self._futures.pop(task_id, None)
        if future and not future.done():
            future.cancel()
            return True
        return False

    def is_running(self, task_id: str) -> bool:
        """Whether the task's execution coroutine is still in flight. This is the authoritative
        'not yet finished' signal — unlike task.status, which can flip to a terminal value
        transiently mid-run (e.g. an LTP attempt failing before the hybrid ReAct fallback)."""
        future = self._futures.get(task_id)
        return future is not None and not future.done()

    def _cleanup(self) -> None:
        done = [tid for tid, f in self._futures.items() if f.done()]
        for tid in done:
            self._futures.pop(tid, None)


class AuditCollector:
    """Structured audit events — SQLite-backed with SSE streaming."""

    _AUDIT_DB = os.path.join(os.path.dirname(__file__), "data", "audit.db")

    def __init__(self, max_memory: int = 500) -> None:
        self._events: list[dict] = []  # in-memory recent cache for SSE replay
        self._max_memory = max_memory
        self._subscribers: list[asyncio.Queue] = []
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(self._AUDIT_DB), exist_ok=True)
        self._init_db()
        self._load_recent()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._AUDIT_DB, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init_db(self):
        with self._lock:
            conn = self._get_conn()
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    source TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL DEFAULT '',
                    detail TEXT DEFAULT '',
                    data TEXT DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts);
                CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_events(source);
                CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(type);
            """)
            conn.close()

    def _load_recent(self):
        """Load recent events into memory for SSE replay."""
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", (self._max_memory,)).fetchall()
            conn.close()
        self._events = [self._row_to_dict(r) for r in reversed(rows)]

    def _row_to_dict(self, row) -> dict:
        return {
            "id": row["id"], "ts": row["ts"], "source": row["source"],
            "type": row["type"], "detail": row["detail"],
            "data": json.loads(row["data"] or "{}"),
        }

    def emit(self, source: str, event_type: str, data: dict | None = None, detail: str = "") -> None:
        ts = time.time()
        data_json = json.dumps(data or {}, default=str)

        # Write to SQLite
        with self._lock:
            conn = self._get_conn()
            cursor = conn.execute(
                "INSERT INTO audit_events (ts, source, type, detail, data) VALUES (?, ?, ?, ?, ?)",
                (ts, source, event_type, detail, data_json)
            )
            evt_id = cursor.lastrowid
            conn.commit()
            conn.close()

        evt = {"id": evt_id, "ts": ts, "source": source, "type": event_type, "detail": detail, "data": data or {}}

        # Update in-memory cache
        self._events.append(evt)
        if len(self._events) > self._max_memory:
            self._events = self._events[-self._max_memory:]

        # Push to SSE subscribers
        for q in self._subscribers:
            try: q.put_nowait(evt)
            except asyncio.QueueFull: pass

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers = [s for s in self._subscribers if s is not q]

    def get_recent(self, limit: int = 100, source: str | None = None) -> list[dict]:
        """Get recent events. Uses DB for large queries, memory for small ones."""
        if limit <= self._max_memory and not source:
            return self._events[-limit:]
        with self._lock:
            conn = self._get_conn()
            if source:
                rows = conn.execute("SELECT * FROM audit_events WHERE source = ? ORDER BY id DESC LIMIT ?", (source, limit)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            conn.close()
        return [self._row_to_dict(r) for r in reversed(rows)]

    def query(self, source: str = "", event_type: str = "", since_ts: float = 0, limit: int = 200) -> list[dict]:
        """Query events with filters — uses SQLite indexes."""
        conditions = []
        params: list = []
        if source:
            conditions.append("source = ?")
            params.append(source)
        if event_type:
            conditions.append("type LIKE ?")
            params.append(f"%{event_type}%")
        if since_ts > 0:
            conditions.append("ts >= ?")
            params.append(since_ts)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.append(limit)
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(f"SELECT * FROM audit_events {where} ORDER BY id DESC LIMIT ?", params).fetchall()
            conn.close()
        return [self._row_to_dict(r) for r in reversed(rows)]

    def clear(self) -> None:
        with self._lock:
            conn = self._get_conn()
            conn.execute("DELETE FROM audit_events")
            conn.commit()
            conn.close()
        self._events.clear()

    def count(self, since_ts: float = 0) -> int:
        with self._lock:
            conn = self._get_conn()
            if since_ts > 0:
                row = conn.execute("SELECT COUNT(*) as c FROM audit_events WHERE ts >= ?", (since_ts,)).fetchone()
            else:
                row = conn.execute("SELECT COUNT(*) as c FROM audit_events").fetchone()
            conn.close()
        return row["c"] if row else 0

    def top_tools(self, limit: int = 10) -> list[dict]:
        """Most-called tools — uses in-memory cache for speed."""
        counts: dict[str, int] = {}
        for e in self._events:
            tool = e["data"].get("tool") or e["data"].get("tool_name")
            if tool and any(t in e["type"] for t in ("tool_dispatch", "tool_called", "tool.called", "tool_result", "tool_succeeded", "tool.succeeded")):
                counts[tool] = counts.get(tool, 0) + 1
        return [{"name": n, "count": c} for n, c in sorted(counts.items(), key=lambda x: -x[1])[:limit]]

    def top_models(self, limit: int = 5) -> list[dict]:
        """Most-used models — uses in-memory cache."""
        counts: dict[str, int] = {}
        for e in self._events:
            model = e["data"].get("model")
            if model and any(t in e["type"] for t in ("response", "llm.response", "call_start", "llm.called")):
                counts[model] = counts.get(model, 0) + 1
        return [{"name": n, "count": c} for n, c in sorted(counts.items(), key=lambda x: -x[1])[:limit]]


# Singletons
conversations = ConversationStore()
task_runner = TaskRunner()
audit_collector = AuditCollector()
background_token_counter = {"total": 0}  # Shared counter for background LLM calls (memory extraction, planning, etc.)
