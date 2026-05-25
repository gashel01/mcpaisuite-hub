"""Regression detection API routes — Sprint 4."""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from dataclasses import asdict

from regression import regression_detector

router = APIRouter()


class ResetRequest(BaseModel):
    confirm: str


@router.get("/regression/baselines")
def list_baselines():
    """List all learned baselines."""
    baselines = regression_detector.get_baselines()
    return [asdict(b) for b in baselines]


@router.get("/regression/check")
def check_regression(task_id: str = Query(..., description="Task ID to check")):
    """Check a specific task for regression against its baseline."""
    # Look up the task from the task store
    try:
        from task_store import task_store
        task = task_store.get(task_id)
    except (ImportError, AttributeError):
        task = None

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    # Extract metrics from the task
    goal = getattr(task, "goal", "") or getattr(task, "query", "") or ""
    if not goal:
        raise HTTPException(status_code=400, detail="Task has no goal/query to match against")

    cost = getattr(task, "total_cost", 0) or 0
    turns = getattr(task, "turns", 0) or getattr(task, "turn_count", 0) or 0
    latency_ms = getattr(task, "latency_ms", 0) or getattr(task, "duration_ms", 0) or 0

    regressions = regression_detector.check(goal, cost, turns, latency_ms)
    baseline = regression_detector.get_baseline(goal)

    return {
        "task_id": task_id,
        "goal": goal,
        "regressions": regressions,
        "baseline": asdict(baseline) if baseline else None,
    }


@router.post("/regression/reset")
def reset_baselines(req: ResetRequest):
    """Clear all baselines. Requires confirmation body."""
    if req.confirm != "RESET":
        raise HTTPException(
            status_code=400,
            detail='Must send {"confirm": "RESET"} to clear baselines',
        )

    regression_detector.reset()
    return {"status": "reset", "message": "All baselines cleared"}


@router.get("/regression/active")
def active_regressions(namespace: str = ""):
    """List currently active regressions (from recent tasks)."""
    # Check recent tasks for regressions
    active = []
    try:
        from task_store import load_all_tasks
        tasks = load_all_tasks()
        for tid, task in list(tasks.items())[-50:]:  # Check last 50 tasks
            ns = getattr(task, "namespace", "")
            if namespace and ns != namespace and not ns.startswith(namespace):
                continue
            goal = getattr(task, "goal", "") or ""
            if not goal:
                continue
            cost = getattr(task, "total_cost", 0) or 0
            turns = getattr(task, "total_turns", 0) or 0
            latency = getattr(task, "duration_ms", 0) or 0
            regs = regression_detector.check(goal, cost, turns, latency)
            for r in regs:
                r["trace_id"] = tid
                active.append(r)
    except (ImportError, AttributeError):
        pass
    return active


@router.get("/regression/stats")
def regression_stats():
    """Get summary statistics about the regression detection system."""
    return regression_detector.stats()
