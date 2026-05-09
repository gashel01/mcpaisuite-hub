"""Bounded stores — conversations (SQLite), task runner, audit collector."""
from __future__ import annotations
import asyncio
import json
import sqlite3
import threading
import time

MAX_CONVERSATIONS_PER_NS = 50
MAX_MESSAGES_PER_CONV = 100
MAX_RUNNING_TASKS = 10

DB_PATH = "/app/data/conversations.db"


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
        conv["messages"].append({"role": role, "content": content})
        if len(conv["messages"]) > self._max_msgs:
            conv["messages"] = conv["messages"][-self._max_msgs:]
        self._save(ns, conv_id, conv)

    def add_answer(self, ns: str, conv_id: str, task_id: str, content: str, turns: list | None = None, tokens: int = 0, cost: float = 0) -> bool:
        conv = self.get_or_create(ns, conv_id)
        if task_id in conv["answered_task_ids"]:
            return False
        conv["answered_task_ids"].add(task_id)
        msg: dict = {"role": "assistant", "content": content}
        if turns: msg["turns"] = turns
        if tokens: msg["tokens"] = tokens
        if cost: msg["cost"] = cost
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

    def _cleanup(self) -> None:
        done = [tid for tid, f in self._futures.items() if f.done()]
        for tid in done:
            self._futures.pop(tid, None)


class AuditCollector:
    """Structured audit events with SSE streaming."""

    def __init__(self, max_events: int = 2000) -> None:
        self._events: list[dict] = []
        self._max = max_events
        self._subscribers: list[asyncio.Queue] = []
        self._counter = 0

    def emit(self, source: str, event_type: str, data: dict | None = None, detail: str = "") -> None:
        self._counter += 1
        evt = {"id": self._counter, "ts": time.time(), "source": source, "type": event_type, "detail": detail, "data": data or {}}
        self._events.append(evt)
        if len(self._events) > self._max:
            self._events = self._events[-self._max:]
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
        events = self._events
        if source: events = [e for e in events if e["source"] == source]
        return events[-limit:]

    def clear(self) -> None:
        self._events.clear()
        self._counter = 0


# Singletons
conversations = ConversationStore()
task_runner = TaskRunner()
audit_collector = AuditCollector()
background_token_counter = {"total": 0}  # Shared counter for background LLM calls (memory extraction, planning, etc.)
