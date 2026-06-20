"""Time-series metrics endpoints for the observability dashboard."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Header, Query
from typing import Optional
import time as _time

router = APIRouter()

# Simple in-memory cache for task data (avoid re-loading 157+ tasks every request)
_task_cache: dict = {"data": None, "ts": 0}
_CACHE_TTL = 5  # seconds

# Window parsing
WINDOW_SECONDS = {
    "1h": 3600,
    "6h": 6 * 3600,
    "24h": 24 * 3600,
    "7d": 7 * 24 * 3600,
    "30d": 30 * 24 * 3600,
}

# Auto bucket sizes (seconds)
AUTO_BUCKETS = {
    "1h": 300,       # 5m
    "6h": 1800,      # 30m
    "24h": 3600,     # 1h
    "7d": 24 * 3600, # 1d
    "30d": 24 * 3600,# 1d
}

BUCKET_SECONDS = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "6h": 6 * 3600,
    "1d": 24 * 3600,
}

CHART_CONFIG = {
    "metrics": [
        {"id": "latency", "label": "Latency", "unit": "ms", "color": "#8b5cf6"},
        {"id": "cost", "label": "Cost", "unit": "$", "color": "#10b981"},
        {"id": "tokens", "label": "Tokens", "unit": "", "color": "#06b6d4"},
        {"id": "success_rate", "label": "Success Rate", "unit": "%", "color": "#f59e0b"},
        {"id": "turns", "label": "Turns", "unit": "", "color": "#ec4899"},
        {"id": "throughput", "label": "Throughput", "unit": "tasks", "color": "#3b82f6"},
    ]
}


def _parse_window(window: str) -> int:
    """Return window duration in seconds."""
    return WINDOW_SECONDS.get(window, 24 * 3600)


def _get_bucket_seconds(window: str, bucket: str) -> int:
    """Resolve bucket size in seconds."""
    if bucket == "auto":
        return AUTO_BUCKETS.get(window, 3600)
    return BUCKET_SECONDS.get(bucket, 3600)


def _get_tasks_in_window(namespace: str, start_ts: float, end_ts: float) -> list[dict]:
    """Retrieve tasks within the given time window."""
    try:
        from task_store import load_all_tasks
        # Cache task objects to avoid re-loading from SQLite on every request
        now = _time.time()
        if _task_cache["data"] is None or (now - _task_cache["ts"]) > _CACHE_TTL:
            _task_cache["data"] = load_all_tasks()
            _task_cache["ts"] = now
        all_task_objs = _task_cache["data"]
        # Convert Task objects to dicts, filter by namespace
        all_tasks = []
        for task in all_task_objs.values():
            if namespace and task.namespace != namespace and not task.namespace.startswith(namespace):
                continue
            try:
                dur = task.duration_ms
            except TypeError:
                # offset-naive vs offset-aware datetime comparison
                dur = 0
            all_tasks.append({
                "task_id": task.id,
                "status": task.status.value,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                "duration_ms": dur,
                "total_tokens": task.total_tokens,
                "total_cost": task.total_cost,
                "total_turns": task.total_turns,
                "namespace": task.namespace,
            })
    except (ImportError, AttributeError):
        # Fallback: derive from audit_collector events
        all_tasks = _tasks_from_audit(namespace)

    results = []
    for t in all_tasks:
        created = t.get("completed_at") or t.get("created_at")
        if not created:
            continue
        try:
            if isinstance(created, str):
                ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
            else:
                ts = float(created)
        except (ValueError, TypeError):
            continue
        if start_ts <= ts <= end_ts:
            t["_ts"] = ts
            results.append(t)
    return results


def _tasks_from_audit(namespace: str) -> list[dict]:
    """Derive task records from audit_collector events."""
    try:
        from stores import audit_collector
    except ImportError:
        return []

    tasks = []
    for ev in audit_collector._events:
        ev_type = ev.get("type", "")
        if "task_complete" not in ev_type and "task_fail" not in ev_type:
            continue
        data = ev.get("data", {})
        status = "completed" if "task_complete" in ev_type else "failed"
        tasks.append({
            "task_id": ev.get("id", ""),
            "status": status,
            "created_at": None,
            "completed_at": datetime.fromtimestamp(ev.get("ts", 0), tz=timezone.utc).isoformat(),
            "duration_ms": data.get("duration_ms", 0),
            "total_tokens": data.get("total_tokens", 0),
            "total_cost": data.get("total_cost", 0.0),
            "total_turns": data.get("total_turns", 0),
            "model": data.get("model", ""),
            "tools_used": data.get("tools_used", []),
            "namespace": namespace,
        })
    return tasks


def _bucket_tasks(tasks: list[dict], start_ts: float, end_ts: float, bucket_secs: int) -> dict[int, list[dict]]:
    """Group tasks into time buckets. Key is bucket start timestamp."""
    buckets: dict[int, list[dict]] = {}
    # Initialize all buckets
    current = int(start_ts // bucket_secs) * bucket_secs
    while current < end_ts:
        buckets[current] = []
        current += bucket_secs
    # Assign tasks
    for t in tasks:
        ts = t["_ts"]
        b_start = int(ts // bucket_secs) * bucket_secs
        if b_start in buckets:
            buckets[b_start].append(t)
    return dict(sorted(buckets.items()))


def _compute_metric(tasks: list[dict], metric: str) -> float:
    """Compute a single metric value for a bucket of tasks."""
    if not tasks:
        return 0.0

    if metric == "latency":
        durations = [t.get("duration_ms", 0) for t in tasks]
        return sum(durations) / len(durations) if durations else 0.0
    elif metric == "cost":
        return sum(t.get("total_cost", 0.0) for t in tasks)
    elif metric == "tokens":
        return sum(t.get("total_tokens", 0) for t in tasks)
    elif metric == "success_rate":
        completed = sum(1 for t in tasks if t.get("status") == "completed")
        total = sum(1 for t in tasks if t.get("status") in ("completed", "failed"))
        return (completed / total * 100) if total > 0 else 0.0
    elif metric == "turns":
        turns = [t.get("total_turns", 0) for t in tasks]
        return sum(turns) / len(turns) if turns else 0.0
    elif metric == "throughput":
        return float(len(tasks))
    return 0.0


def _percentile(values: list[float], p: float) -> float:
    """Compute the p-th percentile of a list of values."""
    if not values:
        return 0.0
    sorted_v = sorted(values)
    idx = (p / 100) * (len(sorted_v) - 1)
    lower = int(idx)
    upper = lower + 1
    if upper >= len(sorted_v):
        return sorted_v[-1]
    frac = idx - lower
    return sorted_v[lower] * (1 - frac) + sorted_v[upper] * frac


def _core_window_metrics(tasks: list[dict]) -> dict:
    """Core per-window aggregation — single source of truth shared by /metrics/summary
    (dashboard JSON) and the Prometheus /metrics endpoint, so the math isn't duplicated."""
    total = len(tasks)
    completed = sum(1 for t in tasks if t.get("status") == "completed")
    failed = sum(1 for t in tasks if t.get("status") == "failed")
    durations = [t.get("duration_ms", 0) for t in tasks if t.get("duration_ms")]
    return {
        "total_tasks": total,
        "completed": completed,
        "failed": failed,
        "success_rate": (completed / (completed + failed) * 100) if (completed + failed) > 0 else 0.0,
        "total_cost": sum(t.get("total_cost", 0.0) for t in tasks),
        "total_tokens": sum(t.get("total_tokens", 0) for t in tasks),
        "avg_latency": sum(durations) / len(durations) if durations else 0.0,
        "p50_latency": _percentile(durations, 50),
        "p95_latency": _percentile(durations, 95),
    }


@router.get("/metrics")
async def prometheus_metrics(
    window: str = Query("24h"),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Prometheus exposition of the Hub's task-store analytics (reuses the same per-window
    aggregation as the dashboard). Empty body unless kernelmcp[metrics] is installed."""
    from fastapi import Response
    from kernelmcp.observability.metrics import render_snapshot
    now = datetime.now(timezone.utc).timestamp()
    tasks = _get_tasks_in_window(x_tenant_id, now - _parse_window(window), now)
    body, ct = render_snapshot(_core_window_metrics(tasks))
    return Response(content=body, media_type=ct)


@router.get("/metrics/timeseries")
async def timeseries(
    metric: str = Query(..., description="One of: latency, cost, tokens, success_rate, turns, throughput"),
    window: str = Query("24h"),
    bucket: str = Query("auto"),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    now = datetime.now(timezone.utc).timestamp()
    window_secs = _parse_window(window)
    start_ts = now - window_secs
    bucket_secs = _get_bucket_seconds(window, bucket)

    tasks = _get_tasks_in_window(x_tenant_id, start_ts, now)
    buckets = _bucket_tasks(tasks, start_ts, now, bucket_secs)

    # Resolve bucket label
    if bucket == "auto":
        # Reverse lookup
        bucket_label = "auto"
        for k, v in BUCKET_SECONDS.items():
            if v == bucket_secs:
                bucket_label = k
                break
    else:
        bucket_label = bucket

    data = []
    for ts, bucket_tasks in buckets.items():
        value = _compute_metric(bucket_tasks, metric)
        data.append({
            "timestamp": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
            "value": round(value, 4),
            "count": len(bucket_tasks),
        })

    return {
        "metric": metric,
        "window": window,
        "bucket": bucket_label,
        "data": data,
    }


@router.get("/metrics/summary")
async def summary(
    window: str = Query("24h"),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    now = datetime.now(timezone.utc).timestamp()
    window_secs = _parse_window(window)
    start_ts = now - window_secs
    prev_start_ts = start_ts - window_secs

    # Current period
    tasks = _get_tasks_in_window(x_tenant_id, start_ts, now)
    # Previous period (for trends)
    prev_tasks = _get_tasks_in_window(x_tenant_id, prev_start_ts, start_ts)

    core = _core_window_metrics(tasks)
    total_tasks = core["total_tasks"]
    completed = core["completed"]
    failed = core["failed"]
    success_rate = core["success_rate"]
    total_cost = core["total_cost"]
    total_tokens = core["total_tokens"]
    avg_latency = core["avg_latency"]
    p50_latency = core["p50_latency"]
    p95_latency = core["p95_latency"]

    turns_list = [t.get("total_turns", 0) for t in tasks if t.get("total_turns")]
    avg_turns = sum(turns_list) / len(turns_list) if turns_list else 0.0
    avg_cost_per_task = total_cost / total_tasks if total_tasks > 0 else 0.0

    # Trends (percentage change vs previous period)
    prev_total = len(prev_tasks)
    prev_completed = sum(1 for t in prev_tasks if t.get("status") == "completed")
    prev_failed = sum(1 for t in prev_tasks if t.get("status") == "failed")
    prev_cost = sum(t.get("total_cost", 0.0) for t in prev_tasks)
    prev_tokens = sum(t.get("total_tokens", 0) for t in prev_tasks)
    prev_durations = [t.get("duration_ms", 0) for t in prev_tasks if t.get("duration_ms")]
    prev_avg_latency = sum(prev_durations) / len(prev_durations) if prev_durations else 0.0
    prev_success_rate = (prev_completed / (prev_completed + prev_failed) * 100) if (prev_completed + prev_failed) > 0 else 0.0

    def _pct_change(current: float, previous: float) -> float:
        if previous == 0:
            return 0.0
        return round(((current - previous) / previous) * 100, 1)

    trends = {
        "tasks": _pct_change(total_tasks, prev_total),
        "cost": _pct_change(total_cost, prev_cost),
        "tokens": _pct_change(total_tokens, prev_tokens),
        "latency": _pct_change(avg_latency, prev_avg_latency),
        "success_rate": _pct_change(success_rate, prev_success_rate),
    }

    # Per-bucket sparklines over the current window (same bucketing as the charts).
    spark_bucket_secs = AUTO_BUCKETS.get(window, 3600)
    spark_buckets = _bucket_tasks(tasks, start_ts, now, spark_bucket_secs)
    tasks_sparkline = [len(b) for b in spark_buckets.values()]
    cost_sparkline = [round(_compute_metric(b, "cost"), 4) for b in spark_buckets.values()]
    tokens_sparkline = [round(_compute_metric(b, "tokens")) for b in spark_buckets.values()]
    latency_sparkline = [round(_compute_metric(b, "latency")) for b in spark_buckets.values()]

    # Top tools and models from audit_collector
    top_tools: list[dict] = []
    top_models: list[dict] = []
    try:
        from stores import audit_collector
        top_tools = audit_collector.top_tools(5)
        top_models = audit_collector.top_models(5)
    except (ImportError, AttributeError):
        pass

    return {
        "window": window,
        "total_tasks": total_tasks,
        "completed": completed,
        "failed": failed,
        "success_rate": round(success_rate, 1),
        "total_cost": round(total_cost, 4),
        "total_tokens": total_tokens,
        "avg_latency_ms": round(avg_latency, 0),
        "p50_latency_ms": round(p50_latency, 0),
        "p95_latency_ms": round(p95_latency, 0),
        "avg_turns": round(avg_turns, 1),
        "avg_cost_per_task": round(avg_cost_per_task, 4),
        "trends": trends,
        "tasks_sparkline": tasks_sparkline,
        "cost_sparkline": cost_sparkline,
        "tokens_sparkline": tokens_sparkline,
        "latency_sparkline": latency_sparkline,
        "top_tools": top_tools,
        "top_models": top_models,
    }


@router.get("/metrics/chart-config")
async def chart_config():
    return CHART_CONFIG


# ── Phase 2: Latency Analytics (span-level) ─────────────────────────────────


def _collect_span_durations(tasks: list, group_by: str) -> dict[str, list[float]]:
    """Walk spans from Task objects, collect durations grouped by type or name."""
    groups: dict[str, list[float]] = {}
    for task in tasks:
        spans = getattr(task, "spans", []) or []
        _walk_spans(spans, groups, group_by)
    return groups


def _walk_spans(spans, groups: dict[str, list[float]], group_by: str):
    for span in spans:
        duration = getattr(span, "duration_ms", None)
        if duration is None:
            # Try computing from start/end
            st = getattr(span, "start_time", 0)
            et = getattr(span, "end_time", None)
            if et and st:
                duration = (et - st) * 1000
        if duration is not None and duration > 0:
            key = _span_group_key(span, group_by)
            if key not in groups:
                groups[key] = []
            groups[key].append(duration)
        children = getattr(span, "children", []) or []
        _walk_spans(children, groups, group_by)


def _span_group_key(span, group_by: str) -> str:
    if group_by == "name":
        return getattr(span, "name", "unknown")
    # Default: group by type
    t = getattr(span, "type", None)
    if hasattr(t, "value"):
        return t.value
    return str(t) if t else "unknown"


def _get_task_objects_in_window(namespace: str, start_ts: float, end_ts: float):
    """Get actual Task model objects (not dicts) for span analysis."""
    try:
        from task_store import load_all_tasks
        tasks = []
        for task in load_all_tasks().values():
            if namespace and task.namespace != namespace and not task.namespace.startswith(namespace):
                continue
            try:
                ts = task.completed_at.timestamp() if task.completed_at else task.created_at.timestamp()
            except (AttributeError, TypeError):
                continue
            if start_ts <= ts <= end_ts:
                tasks.append(task)
        return tasks
    except (ImportError, AttributeError):
        return []


@router.get("/analytics/latency")
async def analytics_latency(
    window: str = Query("24h"),
    group_by: str = Query("type", description="Group by: type, name"),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Latency percentiles (p50, p95, p99) per span type or name."""
    now = datetime.now(timezone.utc).timestamp()
    window_secs = _parse_window(window)
    start_ts = now - window_secs

    tasks = _get_task_objects_in_window(x_tenant_id, start_ts, now)

    # Also check in-memory kernel tasks for running/recent tasks
    try:
        from server import _kernel_instance
        if _kernel_instance:
            for task in _kernel_instance._tasks.values():
                ns = task.namespace
                if x_tenant_id and ns != x_tenant_id and not ns.startswith(x_tenant_id):
                    continue
                try:
                    ts = task.completed_at.timestamp() if task.completed_at else task.created_at.timestamp()
                except (AttributeError, TypeError):
                    continue
                if start_ts <= ts <= now:
                    # Avoid duplicates
                    if not any(t.id == task.id for t in tasks):
                        tasks.append(task)
    except (ImportError, AttributeError):
        pass

    groups = _collect_span_durations(tasks, group_by)

    result = {}
    for key, durations in sorted(groups.items()):
        result[key] = {
            "p50": round(_percentile(durations, 50), 1),
            "p95": round(_percentile(durations, 95), 1),
            "p99": round(_percentile(durations, 99), 1),
            "min": round(min(durations), 1),
            "max": round(max(durations), 1),
            "avg": round(sum(durations) / len(durations), 1),
            "count": len(durations),
        }

    # Also include end-to-end task latency
    task_durations = []
    for t in tasks:
        try:
            d = t.duration_ms
            if d and d > 0:
                task_durations.append(d)
        except (TypeError, AttributeError):
            pass
    if task_durations:
        result["total"] = {
            "p50": round(_percentile(task_durations, 50), 1),
            "p95": round(_percentile(task_durations, 95), 1),
            "p99": round(_percentile(task_durations, 99), 1),
            "min": round(min(task_durations), 1),
            "max": round(max(task_durations), 1),
            "avg": round(sum(task_durations) / len(task_durations), 1),
            "count": len(task_durations),
        }

    # Distribution histogram (for charts)
    all_durations = [d for ds in groups.values() for d in ds]
    histogram = _build_histogram(all_durations) if all_durations else []

    return {
        "window": window,
        "group_by": group_by,
        "groups": result,
        "histogram": histogram,
        "task_count": len(tasks),
    }


def _build_histogram(values: list[float], num_bins: int = 12) -> list[dict]:
    """Build a histogram with evenly-spaced bins."""
    if not values:
        return []
    mn, mx = min(values), max(values)
    if mn == mx:
        return [{"min": mn, "max": mx, "count": len(values)}]
    bin_width = (mx - mn) / num_bins
    bins = []
    for i in range(num_bins):
        lo = mn + i * bin_width
        hi = lo + bin_width
        count = sum(1 for v in values if lo <= v < hi) if i < num_bins - 1 else sum(1 for v in values if lo <= v <= hi)
        bins.append({
            "min": round(lo, 1),
            "max": round(hi, 1),
            "count": count,
            "label": f"{lo:.0f}-{hi:.0f}ms",
        })
    return bins


# ── Phase 3: Cost Breakdown ─────────────────────────────────────────────────


def _collect_span_costs(tasks) -> dict[str, dict]:
    """Walk spans, aggregate cost by model, tool, and agent."""
    by_model: dict[str, float] = {}
    by_tool: dict[str, float] = {}
    by_agent: dict[str, float] = {}

    for task in tasks:
        spans = getattr(task, "spans", []) or []
        _walk_costs(spans, by_model, by_tool, by_agent)

    return {"by_model": by_model, "by_tool": by_tool, "by_agent": by_agent}


def _walk_costs(spans, by_model, by_tool, by_agent):
    for span in spans:
        output = getattr(span, "output", {}) or {}
        meta = getattr(span, "metadata", {}) or {}
        cost = output.get("cost", 0) or 0
        span_type = getattr(span, "type", None)
        type_val = span_type.value if hasattr(span_type, "value") else str(span_type)

        if type_val == "llm" and cost > 0:
            model = meta.get("model", "unknown")
            by_model[model] = by_model.get(model, 0) + cost

        if type_val == "tool":
            tool = meta.get("tool", getattr(span, "name", "").replace("tool.", ""))
            # Tool cost = parent LLM cost attributed proportionally (approximate)
            # For now, count tool invocations not cost
            by_tool[tool] = by_tool.get(tool, 0) + 1

        if type_val == "agent" and cost > 0:
            agent = meta.get("agent", "unknown")
            cost_val = output.get("cost", 0) or 0
            by_agent[agent] = by_agent.get(agent, 0) + cost_val

        children = getattr(span, "children", []) or []
        _walk_costs(children, by_model, by_tool, by_agent)


@router.get("/analytics/cost")
async def analytics_cost(
    window: str = Query("24h"),
    x_tenant_id: str = Header(default="default", alias="X-Tenant-Id"),
):
    """Cost breakdown by model, tool, and agent."""
    now = datetime.now(timezone.utc).timestamp()
    window_secs = _parse_window(window)
    start_ts = now - window_secs

    tasks = _get_task_objects_in_window(x_tenant_id, start_ts, now)

    # Also check in-memory tasks
    try:
        from server import _kernel_instance
        if _kernel_instance:
            for task in _kernel_instance._tasks.values():
                ns = task.namespace
                if x_tenant_id and ns != x_tenant_id and not ns.startswith(x_tenant_id):
                    continue
                try:
                    ts = task.completed_at.timestamp() if task.completed_at else task.created_at.timestamp()
                except (AttributeError, TypeError):
                    continue
                if start_ts <= ts <= now:
                    if not any(t.id == task.id for t in tasks):
                        tasks.append(task)
    except (ImportError, AttributeError):
        pass

    # Span-level cost breakdown
    span_costs = _collect_span_costs(tasks)

    # Task-level cost totals
    total_cost = sum(getattr(t, "total_cost", 0) or 0 for t in tasks)
    total_tokens = sum(getattr(t, "total_tokens", 0) or 0 for t in tasks)

    # Cost over time (bucketed)
    bucket_secs = _get_bucket_seconds(window, "auto")
    cost_over_time = []
    if tasks:
        task_list = []
        for t in tasks:
            try:
                ts = t.completed_at.timestamp() if t.completed_at else t.created_at.timestamp()
                task_list.append({"_ts": ts, "total_cost": getattr(t, "total_cost", 0) or 0})
            except (AttributeError, TypeError):
                pass
        if task_list:
            buckets = _bucket_tasks(task_list, start_ts, now, bucket_secs)
            for bts, btasks in buckets.items():
                cost_over_time.append({
                    "timestamp": datetime.fromtimestamp(bts, tz=timezone.utc).isoformat(),
                    "cost": round(sum(t.get("total_cost", 0) for t in btasks), 6),
                    "count": len(btasks),
                })

    return {
        "window": window,
        "total_cost": round(total_cost, 4),
        "total_tokens": total_tokens,
        "task_count": len(tasks),
        "by_model": {k: round(v, 6) for k, v in sorted(span_costs["by_model"].items(), key=lambda x: -x[1])},
        "by_tool": dict(sorted(span_costs["by_tool"].items(), key=lambda x: -x[1])[:15]),
        "by_agent": {k: round(v, 6) for k, v in sorted(span_costs["by_agent"].items(), key=lambda x: -x[1])},
        "cost_over_time": cost_over_time,
    }
