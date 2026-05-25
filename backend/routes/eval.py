"""Evaluation framework API — datasets, runs, scoring, comparison."""
from __future__ import annotations

import asyncio
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/eval", tags=["eval"])

# Cancellation set — run IDs that should stop
_cancelled_runs: set[str] = set()


# ── Request models ───────────────────────────────────────────────────────────

class DatasetCreate(BaseModel):
    name: str
    description: str = ""
    cases: list[dict] = []
    tags: list[str] = []


class DatasetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    cases: Optional[list[dict]] = None
    tags: Optional[list[str]] = None


class RunRequest(BaseModel):
    dataset_id: str
    scoring_functions: list[dict] = [{"type": "contains"}]
    namespace: str = "eval"
    max_concurrent: int = 2


class CompareRequest(BaseModel):
    run_id_a: str
    run_id_b: str


# ── Dataset endpoints ────────────────────────────────────────────────────────

@router.get("/datasets")
async def list_datasets():
    from eval_runner import list_datasets
    return {"datasets": list_datasets()}


@router.post("/datasets")
async def create_dataset(body: DatasetCreate):
    from eval_runner import create_dataset
    ds = create_dataset(body.name, body.description, body.cases, body.tags)
    return ds


@router.get("/datasets/{ds_id}")
async def get_dataset(ds_id: str):
    from eval_runner import get_dataset
    ds = get_dataset(ds_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    return ds


@router.put("/datasets/{ds_id}")
async def update_dataset(ds_id: str, body: DatasetUpdate):
    from eval_runner import update_dataset
    updates = {k: v for k, v in body.dict().items() if v is not None}
    ds = update_dataset(ds_id, updates)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    return ds


@router.delete("/datasets/{ds_id}")
async def delete_dataset(ds_id: str):
    from eval_runner import delete_dataset
    if not delete_dataset(ds_id):
        raise HTTPException(404, "Dataset not found")
    return {"ok": True}


@router.post("/datasets/{ds_id}/cases")
async def add_cases(ds_id: str, body: dict):
    from eval_runner import add_cases
    cases = body.get("cases", [])
    if not cases:
        raise HTTPException(400, "No cases provided")
    ds = add_cases(ds_id, cases)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    return ds


# ── Import/Export ────────────────────────────────────────────────────────────

@router.post("/datasets/import")
async def import_dataset(body: dict):
    """Import a dataset from JSON (full dataset object or array of cases)."""
    from eval_runner import create_dataset
    if isinstance(body.get("cases"), list):
        ds = create_dataset(
            name=body.get("name", "Imported Dataset"),
            description=body.get("description", ""),
            cases=body["cases"],
            tags=body.get("tags", []),
        )
        return ds
    raise HTTPException(400, "Expected 'cases' array in body")


# ── Run endpoints ────────────────────────────────────────────────────────────

@router.get("/runs")
async def list_runs(dataset_id: str = ""):
    from eval_runner import list_runs
    return {"runs": list_runs(dataset_id or None)}


@router.post("/runs")
async def start_run(body: RunRequest, x_tenant_id: str = Header(default="eval")):
    """Start an eval run. Runs async — poll GET /eval/runs/{id} for results."""
    from eval_runner import run_eval, get_dataset

    # Get kernel
    kernel = None
    try:
        import server
        kernel = server.kernel
    except (ImportError, AttributeError):
        pass

    if not kernel:
        raise HTTPException(503, "Kernel not available — cannot run eval")

    ds = get_dataset(body.dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")

    # run_eval creates & saves its own run record with progress tracking
    # We need to start it in background and return the run_id
    # Strategy: call run_eval which returns the completed run — but we need the ID upfront
    # So we pre-create the run in run_eval's format and pass it
    from eval_runner import _uuid, _now_iso, _save_run

    run_id = _uuid()
    ns = body.namespace or x_tenant_id
    cases = ds.get("cases", [])

    # Pre-create run record so frontend can start polling immediately
    run = {
        "id": run_id,
        "dataset_id": body.dataset_id,
        "dataset_name": ds["name"],
        "status": "running",
        "scoring_functions": body.scoring_functions,
        "namespace": ns,
        "started_at": _now_iso(),
        "completed_at": None,
        "total_cases": len(cases),
        "completed_cases": 0,
        "current_case": "",
        "results": [],
        "summary": {},
    }
    _save_run(run)

    # Background execution — uses the same run_id
    async def _bg():
        try:
            await _run_eval_with_id(
                run_id=run_id,
                dataset=ds,
                scoring_functions=body.scoring_functions,
                kernel=kernel,
                namespace=ns,
            )
        except Exception as exc:
            # Mark as failed
            run["status"] = "failed"
            run["completed_at"] = _now_iso()
            run["current_case"] = f"Error: {str(exc)[:100]}"
            _save_run(run)

    asyncio.create_task(_bg())
    return {"run_id": run_id, "status": "running"}


async def _run_eval_with_id(run_id: str, dataset: dict, scoring_functions: list[dict], kernel, namespace: str):
    """Execute eval with a pre-assigned run_id so frontend can poll progress."""
    from eval_runner import _execute_case, _aggregate_by_scorer, _save_run, _now_iso, get_run
    import asyncio

    cases = dataset.get("cases", [])
    run = get_run(run_id) or {}

    results = []
    for i, case in enumerate(cases):
        # Check cancellation
        if run_id in _cancelled_runs:
            _cancelled_runs.discard(run_id)
            run["status"] = "cancelled"
            run["completed_at"] = _now_iso()
            run["current_case"] = ""
            run["results"] = results
            _save_run(run)
            return

        # Update progress
        run["current_case"] = case.get("input", "")[:80]
        run["completed_cases"] = i
        _save_run(run)

        try:
            result = await _execute_case(case, scoring_functions, kernel, namespace)
        except Exception as exc:
            result = {
                "case_id": case.get("id", "unknown"),
                "input": case.get("input", "")[:200],
                "expected": case.get("expected_output", "")[:200],
                "output": "",
                "scores": [],
                "error": str(exc)[:200],
                "duration_ms": 0,
            }

        results.append(result)
        run["results"] = results
        run["completed_cases"] = i + 1
        _save_run(run)

    # Final summary
    all_scores = [s["score"] for r in results for s in r.get("scores", []) if "score" in s]
    all_passed = [s["passed"] for r in results for s in r.get("scores", []) if "passed" in s]
    total_duration = sum(r.get("duration_ms", 0) for r in results)

    run["status"] = "completed"
    run["completed_at"] = _now_iso()
    run["current_case"] = ""
    run["completed_cases"] = len(cases)
    run["summary"] = {
        "total_cases": len(cases),
        "avg_score": round(sum(all_scores) / len(all_scores), 3) if all_scores else 0.0,
        "pass_rate": round(sum(1 for p in all_passed if p) / len(all_passed) * 100, 1) if all_passed else 0.0,
        "total_duration_ms": round(total_duration, 1),
        "scores_by_scorer": _aggregate_by_scorer(results),
    }
    _save_run(run)


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    from eval_runner import get_run
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str):
    """Cancel a running eval."""
    _cancelled_runs.add(run_id)
    return {"ok": True, "run_id": run_id}


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str):
    from eval_runner import delete_run
    _cancelled_runs.discard(run_id)
    if not delete_run(run_id):
        raise HTTPException(404, "Run not found")
    return {"ok": True}


# ── Comparison ───────────────────────────────────────────────────────────────

@router.post("/compare")
async def compare_runs(body: CompareRequest):
    from eval_runner import compare_runs
    result = compare_runs(body.run_id_a, body.run_id_b)
    if not result:
        raise HTTPException(404, "One or both runs not found")
    return result


# ── Available scorers ────────────────────────────────────────────────────────

@router.get("/scorers")
async def list_scorers():
    return {
        "scorers": [
            {"type": "contains", "description": "Check if output contains expected string (case-insensitive)", "params": []},
            {"type": "regex", "description": "Match output against a regex pattern", "params": [{"name": "pattern", "type": "string"}]},
            {"type": "json_valid", "description": "Check if output is valid JSON", "params": []},
            {"type": "similarity", "description": "Word-overlap (Jaccard) similarity score", "params": [{"name": "threshold", "type": "number", "default": 0.7}]},
            {"type": "llm_judge", "description": "LLM-as-judge evaluation (uses tokens)", "params": [{"name": "criteria", "type": "string"}]},
        ]
    }
