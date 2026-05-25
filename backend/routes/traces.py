"""Trace search, annotations, and export endpoints."""

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

# ---------------------------------------------------------------------------
# Annotations SQLite store
# ---------------------------------------------------------------------------

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "annotations.db")
DB_PATH = os.path.abspath(DB_PATH)

_db_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with _db_lock:
        conn = _get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS annotations (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                turn_index INTEGER,
                rating INTEGER DEFAULT 0,
                feedback TEXT DEFAULT '',
                note TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                labels TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ann_task ON annotations(task_id);
            CREATE INDEX IF NOT EXISTS idx_ann_rating ON annotations(rating);

            CREATE TABLE IF NOT EXISTS review_queue (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                reason TEXT DEFAULT '',
                priority INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                queued_at TEXT NOT NULL,
                reviewed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_rq_status ON review_queue(status);
        """)
        # Migration: add labels column if missing
        try:
            conn.execute("SELECT labels FROM annotations LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE annotations ADD COLUMN labels TEXT DEFAULT '[]'")
        conn.close()


_init_db()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_tools_used(task) -> list[str]:
    """Extract unique tool names from task turns."""
    tools = set()
    if not hasattr(task, "turns") or not task.turns:
        return []
    for turn in task.turns:
        if hasattr(turn, "tool_call") and turn.tool_call:
            tools.add(turn.tool_call.tool_name)
    return sorted(tools)


def _extract_model(task) -> str:
    """Extract model name from metadata or turns."""
    if hasattr(task, "metadata") and task.metadata:
        if isinstance(task.metadata, dict):
            model = task.metadata.get("model", "")
            if model:
                return model
    return ""


def _get_annotation_for_task(task_id: str) -> Optional[dict]:
    """Get the main annotation (turn_index IS NULL) for a task."""
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT * FROM annotations WHERE task_id = ? AND turn_index IS NULL ORDER BY updated_at DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        conn.close()
    if row:
        return _row_to_dict(row)
    return None


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["tags"] = json.loads(d.get("tags", "[]"))
    d["labels"] = json.loads(d.get("labels", "[]") or "[]")
    return d


def _task_has_annotation(task_id: str) -> bool:
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT 1 FROM annotations WHERE task_id = ? LIMIT 1", (task_id,)
        ).fetchone()
        conn.close()
    return row is not None


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class TraceSearchQuery(BaseModel):
    namespace: str = ""
    status: list[str] = []
    date_from: str = ""
    date_to: str = ""
    goal_contains: str = ""
    tools_used: list[str] = []
    model: str = ""
    cost_min: float = 0
    cost_max: float = 999999
    latency_min_ms: float = 0
    latency_max_ms: float = 999999
    turns_min: int = 0
    turns_max: int = 999
    has_annotation: Optional[bool] = None
    min_rating: int = 0
    tags: list[str] = []
    sort: str = "date_desc"
    cursor: str = ""
    limit: int = 50


class TraceExportQuery(TraceSearchQuery):
    format: str = "json"


class AnnotationCreate(BaseModel):
    rating: int = 0
    feedback: str = ""
    note: str = ""
    tags: list[str] = []
    labels: list[str] = []   # correct, incorrect, partially_correct, hallucinated, harmful, off_topic
    turn_index: Optional[int] = None


# ---------------------------------------------------------------------------
# Search logic
# ---------------------------------------------------------------------------

def _apply_filters(tasks: dict, query: TraceSearchQuery, tenant_id: str) -> list:
    """Apply all filters and return matching tasks as a list."""
    results = []

    for task_id, task in tasks.items():
        # Namespace filter (include sub-namespaces)
        ns = getattr(task, "namespace", "") or ""
        if query.namespace:
            if not ns.startswith(query.namespace):
                continue

        # Tenant filter via namespace prefix
        if tenant_id and tenant_id != "default":
            if not ns.startswith(tenant_id):
                continue

        # Status filter
        if query.status:
            task_status = task.status.value if hasattr(task.status, "value") else str(task.status)
            if task_status not in query.status:
                continue

        # Date range
        if query.date_from:
            created = getattr(task, "created_at", "") or ""
            if created and created < query.date_from:
                continue

        if query.date_to:
            created = getattr(task, "created_at", "") or ""
            if created and created > query.date_to:
                continue

        # Goal substring
        if query.goal_contains:
            goal = getattr(task, "goal", "") or ""
            if query.goal_contains.lower() not in goal.lower():
                continue

        # Tools used (ANY match)
        if query.tools_used:
            task_tools = _extract_tools_used(task)
            if not any(t in task_tools for t in query.tools_used):
                continue

        # Model filter
        if query.model:
            task_model = _extract_model(task)
            if query.model.lower() not in task_model.lower():
                continue

        # Cost range
        cost = getattr(task, "total_cost", 0) or 0
        if cost < query.cost_min or cost > query.cost_max:
            continue

        # Latency range
        duration = getattr(task, "duration_ms", 0) or 0
        if duration < query.latency_min_ms or duration > query.latency_max_ms:
            continue

        # Turns range
        turns = getattr(task, "total_turns", 0) or 0
        if turns < query.turns_min or turns > query.turns_max:
            continue

        # Annotation filters
        if query.has_annotation is not None:
            has_ann = _task_has_annotation(task_id)
            if query.has_annotation and not has_ann:
                continue
            if not query.has_annotation and has_ann:
                continue

        if query.min_rating > 0:
            ann = _get_annotation_for_task(task_id)
            if not ann or ann.get("rating", 0) < query.min_rating:
                continue

        if query.tags:
            ann = _get_annotation_for_task(task_id)
            if not ann:
                continue
            ann_tags = ann.get("tags", [])
            if not all(t in ann_tags for t in query.tags):
                continue

        results.append((task_id, task))

    return results


def _sort_results(results: list, sort: str) -> list:
    """Sort results by requested field."""
    sort_map = {
        "date_desc": lambda x: getattr(x[1], "created_at", "") or "",
        "date_asc": lambda x: getattr(x[1], "created_at", "") or "",
        "cost_desc": lambda x: getattr(x[1], "total_cost", 0) or 0,
        "cost_asc": lambda x: getattr(x[1], "total_cost", 0) or 0,
        "latency_desc": lambda x: getattr(x[1], "duration_ms", 0) or 0,
        "turns_desc": lambda x: getattr(x[1], "total_turns", 0) or 0,
    }

    key_fn = sort_map.get(sort, sort_map["date_desc"])
    reverse = not sort.endswith("_asc")
    return sorted(results, key=key_fn, reverse=reverse)


def _paginate(results: list, cursor: str, limit: int):
    """Apply cursor-based pagination."""
    if cursor:
        found = False
        paginated = []
        for task_id, task in results:
            if found:
                paginated.append((task_id, task))
            if task_id == cursor:
                found = True
        results = paginated

    page = results[:limit]
    next_cursor = page[-1][0] if len(results) > limit else None
    return page, next_cursor


def _task_to_trace_summary(task_id: str, task) -> dict:
    """Convert a task to a trace summary dict."""
    ann = _get_annotation_for_task(task_id)
    return {
        "task_id": task_id,
        "goal": getattr(task, "goal", ""),
        "status": task.status.value if hasattr(task.status, "value") else str(task.status),
        "created_at": getattr(task, "created_at", ""),
        "completed_at": getattr(task, "completed_at", ""),
        "duration_ms": getattr(task, "duration_ms", 0) or 0,
        "total_tokens": getattr(task, "total_tokens", 0) or 0,
        "total_cost": getattr(task, "total_cost", 0) or 0,
        "total_turns": getattr(task, "total_turns", 0) or 0,
        "tools_used": _extract_tools_used(task),
        "model": _extract_model(task),
        "annotation": {"rating": ann["rating"], "feedback": ann["feedback"], "tags": ann["tags"]} if ann else None,
    }


def _task_to_full_export(task_id: str, task) -> dict:
    """Convert a task to full export dict."""
    turns_data = []
    if hasattr(task, "turns") and task.turns:
        for i, turn in enumerate(task.turns):
            turn_dict = {
                "index": i,
                "role": turn.role.value if hasattr(turn.role, "value") else str(turn.role),
                "content": getattr(turn, "content", ""),
                "tokens": getattr(turn, "tokens", 0),
                "cost": getattr(turn, "cost", 0),
            }
            if hasattr(turn, "tool_call") and turn.tool_call:
                turn_dict["tool_call"] = {
                    "tool_name": turn.tool_call.tool_name,
                    "arguments": turn.tool_call.arguments,
                }
            if hasattr(turn, "tool_result") and turn.tool_result:
                turn_dict["tool_result"] = {
                    "success": turn.tool_result.success,
                    "output": getattr(turn.tool_result, "output", ""),
                    "error": getattr(turn.tool_result, "error", ""),
                }
            turns_data.append(turn_dict)

    # Get all annotations for this task
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM annotations WHERE task_id = ? ORDER BY turn_index ASC", (task_id,)
        ).fetchall()
        conn.close()
    annotations = [_row_to_dict(r) for r in rows]

    # Serialize spans if present
    spans_data = []
    if hasattr(task, "spans") and task.spans:
        def _serialize_span(s) -> dict:
            return {
                "id": s.id,
                "parent_id": s.parent_id,
                "name": s.name,
                "type": s.type.value if hasattr(s.type, "value") else str(s.type),
                "start_time": s.start_time,
                "end_time": s.end_time,
                "duration_ms": s.duration_ms,
                "status": s.status.value if hasattr(s.status, "value") else str(s.status),
                "input": s.input,
                "output": s.output,
                "metadata": s.metadata,
                "error": s.error,
                "children": [_serialize_span(c) for c in (s.children or [])],
            }
        spans_data = [_serialize_span(s) for s in task.spans]

    # Filter transient keys from metadata
    meta = {}
    for k, v in (getattr(task, "metadata", {}) or {}).items():
        if k.startswith("_"):
            continue
        try:
            json.dumps(v, default=str)
            meta[k] = v
        except (TypeError, ValueError):
            pass

    return {
        "task_id": task_id,
        "goal": getattr(task, "goal", ""),
        "status": task.status.value if hasattr(task.status, "value") else str(task.status),
        "namespace": getattr(task, "namespace", ""),
        "metadata": meta,
        "created_at": getattr(task, "created_at", ""),
        "completed_at": getattr(task, "completed_at", ""),
        "duration_ms": getattr(task, "duration_ms", 0) or 0,
        "total_tokens": getattr(task, "total_tokens", 0) or 0,
        "total_cost": getattr(task, "total_cost", 0) or 0,
        "total_turns": getattr(task, "total_turns", 0) or 0,
        "tools_used": _extract_tools_used(task),
        "model": _extract_model(task),
        "turns": turns_data,
        "spans": spans_data,
        "annotations": annotations,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/traces/search")
async def search_traces(
    query: TraceSearchQuery,
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Advanced trace search with filtering, sorting, and pagination."""
    from task_store import load_all_tasks

    tasks = load_all_tasks()
    results = _apply_filters(tasks, query, x_tenant_id)
    total_count = len(results)
    results = _sort_results(results, query.sort)
    page, next_cursor = _paginate(results, query.cursor, query.limit)

    traces = [_task_to_trace_summary(tid, t) for tid, t in page]

    return {
        "traces": traces,
        "next_cursor": next_cursor,
        "total_count": total_count,
    }


@router.post("/traces/{task_id}/annotate")
async def annotate_trace(
    task_id: str,
    body: AnnotationCreate,
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Add or update an annotation for a trace or specific turn."""
    now = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_conn()
        # Check if annotation exists for this task_id + turn_index
        if body.turn_index is not None:
            existing = conn.execute(
                "SELECT id FROM annotations WHERE task_id = ? AND turn_index = ?",
                (task_id, body.turn_index),
            ).fetchone()
        else:
            existing = conn.execute(
                "SELECT id FROM annotations WHERE task_id = ? AND turn_index IS NULL",
                (task_id,),
            ).fetchone()

        tags_json = json.dumps(body.tags)
        labels_json = json.dumps(body.labels)

        if existing:
            ann_id = existing["id"]
            conn.execute(
                """UPDATE annotations SET rating=?, feedback=?, note=?, tags=?, labels=?, updated_at=?
                   WHERE id=?""",
                (body.rating, body.feedback, body.note, tags_json, labels_json, now, ann_id),
            )
        else:
            ann_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO annotations (id, task_id, turn_index, rating, feedback, note, tags, labels, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ann_id, task_id, body.turn_index, body.rating, body.feedback, body.note, tags_json, labels_json, now, now),
            )

        conn.commit()
        conn.close()

    # Emit audit event
    try:
        from stores import audit_collector
        audit_collector.record({
            "event": "trace_annotated",
            "task_id": task_id,
            "annotation_id": ann_id,
            "rating": body.rating,
            "tenant": x_tenant_id,
        })
    except Exception:
        pass

    return {"id": ann_id, "task_id": task_id, "status": "saved"}


@router.get("/traces/{task_id}/annotations")
async def get_annotations(
    task_id: str,
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Get all annotations for a task."""
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM annotations WHERE task_id = ? ORDER BY turn_index ASC",
            (task_id,),
        ).fetchall()
        conn.close()

    return {"annotations": [_row_to_dict(r) for r in rows]}


@router.delete("/traces/{task_id}/annotations/{annotation_id}")
async def delete_annotation(
    task_id: str,
    annotation_id: str,
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Delete a specific annotation."""
    with _db_lock:
        conn = _get_conn()
        result = conn.execute(
            "DELETE FROM annotations WHERE id = ? AND task_id = ?",
            (annotation_id, task_id),
        )
        conn.commit()
        deleted = result.rowcount
        conn.close()

    if deleted == 0:
        raise HTTPException(status_code=404, detail="Annotation not found")

    return {"status": "deleted", "id": annotation_id}


@router.get("/traces/{task_id}/export")
async def export_single_trace(
    task_id: str,
    format: str = Query(default="json"),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Export a single trace with all turns and annotations."""
    if format == "csv":
        raise HTTPException(status_code=400, detail="CSV format not applicable for single trace export")

    from task_store import load_all_tasks

    tasks = load_all_tasks()
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = _task_to_full_export(task_id, task)
    return data


@router.post("/traces/export")
async def export_traces(
    query: TraceExportQuery,
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Export search results as JSON or CSV."""
    from task_store import load_all_tasks

    tasks = load_all_tasks()
    results = _apply_filters(tasks, query, x_tenant_id)
    results = _sort_results(results, query.sort)

    if query.format == "csv":
        output = StringIO()
        # Header
        output.write("task_id,goal,status,cost,tokens,duration_ms,turns,tools_used,rating,feedback,tags\n")
        for task_id, task in results:
            ann = _get_annotation_for_task(task_id)
            goal = (getattr(task, "goal", "") or "").replace('"', '""')
            tools = ";".join(_extract_tools_used(task))
            rating = ann["rating"] if ann else ""
            feedback = ann.get("feedback", "") if ann else ""
            tags = ";".join(ann.get("tags", [])) if ann else ""
            status = task.status.value if hasattr(task.status, "value") else str(task.status)
            output.write(
                f'"{task_id}","{goal}","{status}",'
                f'{getattr(task, "total_cost", 0) or 0},'
                f'{getattr(task, "total_tokens", 0) or 0},'
                f'{getattr(task, "duration_ms", 0) or 0},'
                f'{getattr(task, "total_turns", 0) or 0},'
                f'"{tools}",{rating},"{feedback}","{tags}"\n'
            )
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=traces_export.csv"},
        )

    # JSON format - full export
    data = [_task_to_full_export(tid, t) for tid, t in results]
    content = json.dumps(data, indent=2, default=str)
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=traces_export.json"},
    )


@router.get("/traces/tags")
async def list_tags(
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """List all unique tags from annotations."""
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute("SELECT tags FROM annotations WHERE tags != '[]'").fetchall()
        conn.close()

    all_tags = set()
    for row in rows:
        try:
            tags = json.loads(row["tags"])
            all_tags.update(tags)
        except (json.JSONDecodeError, TypeError):
            pass

    return {"tags": sorted(all_tags)}


@router.get("/traces/stats")
async def annotation_stats(
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Quick stats about annotations."""
    with _db_lock:
        conn = _get_conn()
        total = conn.execute(
            "SELECT COUNT(DISTINCT task_id) as cnt FROM annotations"
        ).fetchone()["cnt"]

        avg_row = conn.execute(
            "SELECT AVG(rating) as avg_rating FROM annotations WHERE rating > 0"
        ).fetchone()
        avg_rating = round(avg_row["avg_rating"], 2) if avg_row["avg_rating"] else 0

        dist_rows = conn.execute(
            "SELECT rating, COUNT(*) as cnt FROM annotations WHERE rating > 0 GROUP BY rating"
        ).fetchall()

        all_tags = conn.execute(
            "SELECT tags FROM annotations WHERE tags != '[]'"
        ).fetchall()
        conn.close()

    rating_distribution = {str(i): 0 for i in range(1, 6)}
    for row in dist_rows:
        rating_distribution[str(row["rating"])] = row["cnt"]

    # Count tags
    tag_counts: dict[str, int] = {}
    for row in all_tags:
        try:
            tags = json.loads(row["tags"])
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        except (json.JSONDecodeError, TypeError):
            pass

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:20]

    return {
        "total_annotated": total,
        "avg_rating": avg_rating,
        "rating_distribution": rating_distribution,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
    }


# ---------------------------------------------------------------------------
# Simple GET export (date range, format, optional task_ids)
# ---------------------------------------------------------------------------

@router.get("/export/traces")
async def export_traces_get(
    format: str = Query("json"),
    date_from: str = Query(""),
    date_to: str = Query(""),
    task_ids: str = Query(""),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Simple GET export — supports date range and task_ids filter."""
    from task_store import load_all_tasks

    tasks = load_all_tasks()
    results = []

    for tid, task in tasks.items():
        ns = getattr(task, "namespace", "")
        if x_tenant_id and ns != x_tenant_id and not ns.startswith(x_tenant_id):
            continue

        # Task ID filter
        if task_ids:
            ids = [i.strip() for i in task_ids.split(",")]
            if tid not in ids:
                continue

        # Date filter
        if date_from:
            try:
                from_dt = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                created = getattr(task, "created_at", None)
                if created and created < from_dt:
                    continue
            except (ValueError, TypeError):
                pass

        if date_to:
            try:
                to_dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                created = getattr(task, "created_at", None)
                if created and created > to_dt:
                    continue
            except (ValueError, TypeError):
                pass

        results.append((tid, task))

    results.sort(key=lambda x: getattr(x[1], "created_at", datetime.min), reverse=True)

    if format == "csv":
        output = StringIO()
        output.write("task_id,goal,status,cost,tokens,duration_ms,turns,model,created_at\n")
        for tid, task in results:
            goal = (getattr(task, "goal", "") or "").replace('"', '""')
            status = task.status.value if hasattr(task.status, "value") else str(task.status)
            model = _extract_model(task)
            created = str(getattr(task, "created_at", ""))
            output.write(
                f'"{tid}","{goal}","{status}",'
                f'{getattr(task, "total_cost", 0) or 0},'
                f'{getattr(task, "total_tokens", 0) or 0},'
                f'{getattr(task, "duration_ms", 0) or 0},'
                f'{getattr(task, "total_turns", 0) or 0},'
                f'"{model}","{created}"\n'
            )
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=traces_export.csv"},
        )

    # JSON with spans
    data = [_task_to_full_export(tid, t) for tid, t in results]
    content = json.dumps(data, indent=2, default=str)
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=traces_export.json"},
    )


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
