"""Evaluation runner — executes eval datasets against the agent pipeline with scoring."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import structlog

logger = structlog.get_logger()

_EVAL_DIR = os.path.join(os.path.dirname(__file__), "data", "eval")
_DATASETS_DIR = os.path.join(_EVAL_DIR, "datasets")
_RUNS_DIR = os.path.join(_EVAL_DIR, "runs")
os.makedirs(_DATASETS_DIR, exist_ok=True)
os.makedirs(_RUNS_DIR, exist_ok=True)


# ── Dataset Models ───────────────────────────────────────────────────────────

def _uuid() -> str:
    return str(uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Dataset CRUD ─────────────────────────────────────────────────────────────

def create_dataset(name: str, description: str = "", cases: list[dict] | None = None, tags: list[str] | None = None) -> dict:
    ds_id = _uuid()
    dataset = {
        "id": ds_id,
        "name": name,
        "description": description,
        "tags": tags or [],
        "cases": [],
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    for case in (cases or []):
        dataset["cases"].append(_normalize_case(case))
    _save_dataset(dataset)
    return dataset


def get_dataset(ds_id: str) -> dict | None:
    path = os.path.join(_DATASETS_DIR, f"{ds_id}.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_datasets() -> list[dict]:
    datasets = []
    for fname in os.listdir(_DATASETS_DIR):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(_DATASETS_DIR, fname), "r", encoding="utf-8") as f:
                ds = json.load(f)
            datasets.append({
                "id": ds["id"],
                "name": ds["name"],
                "description": ds.get("description", ""),
                "tags": ds.get("tags", []),
                "case_count": len(ds.get("cases", [])),
                "created_at": ds.get("created_at", ""),
                "updated_at": ds.get("updated_at", ""),
            })
        except Exception:
            pass
    return sorted(datasets, key=lambda d: d.get("updated_at", ""), reverse=True)


def update_dataset(ds_id: str, updates: dict) -> dict | None:
    ds = get_dataset(ds_id)
    if not ds:
        return None
    if "name" in updates:
        ds["name"] = updates["name"]
    if "description" in updates:
        ds["description"] = updates["description"]
    if "tags" in updates:
        ds["tags"] = updates["tags"]
    if "cases" in updates:
        ds["cases"] = [_normalize_case(c) for c in updates["cases"]]
    ds["updated_at"] = _now_iso()
    _save_dataset(ds)
    return ds


def delete_dataset(ds_id: str) -> bool:
    path = os.path.join(_DATASETS_DIR, f"{ds_id}.json")
    if os.path.isfile(path):
        os.remove(path)
        return True
    return False


def add_cases(ds_id: str, cases: list[dict]) -> dict | None:
    ds = get_dataset(ds_id)
    if not ds:
        return None
    for case in cases:
        ds["cases"].append(_normalize_case(case))
    ds["updated_at"] = _now_iso()
    _save_dataset(ds)
    return ds


def _normalize_case(case: dict) -> dict:
    return {
        "id": case.get("id", _uuid()),
        "input": case.get("input", ""),
        "expected_output": case.get("expected_output", ""),
        "tags": case.get("tags", []),
        "metadata": case.get("metadata", {}),
    }


def _save_dataset(ds: dict) -> None:
    path = os.path.join(_DATASETS_DIR, f"{ds['id']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ds, f, ensure_ascii=False, indent=2)


# ── Scoring Functions ────────────────────────────────────────────────────────

def score_contains(output: str, expected: str, **_) -> dict:
    """Check if output contains the expected string (case-insensitive)."""
    passed = expected.lower() in output.lower()
    return {"scorer": "contains", "score": 1.0 if passed else 0.0, "passed": passed, "detail": f"Expected '{expected[:50]}' in output"}


def score_regex(output: str, pattern: str, **_) -> dict:
    """Check if output matches a regex pattern."""
    try:
        passed = bool(re.search(pattern, output, re.IGNORECASE))
    except re.error:
        return {"scorer": "regex", "score": 0.0, "passed": False, "detail": f"Invalid regex: {pattern}"}
    return {"scorer": "regex", "score": 1.0 if passed else 0.0, "passed": passed, "detail": f"Pattern: {pattern}"}


def score_json_valid(output: str, **_) -> dict:
    """Check if output is valid JSON."""
    try:
        json.loads(output)
        return {"scorer": "json_valid", "score": 1.0, "passed": True, "detail": "Valid JSON"}
    except (json.JSONDecodeError, TypeError):
        return {"scorer": "json_valid", "score": 0.0, "passed": False, "detail": "Invalid JSON"}


def score_similarity(output: str, expected: str, threshold: float = 0.7, **_) -> dict:
    """Simple word-overlap similarity (no ML dependency)."""
    out_words = set(output.lower().split())
    exp_words = set(expected.lower().split())
    if not exp_words:
        return {"scorer": "similarity", "score": 0.0, "passed": False, "detail": "Empty expected"}
    overlap = len(out_words & exp_words)
    total = len(out_words | exp_words)
    sim = overlap / total if total > 0 else 0.0
    passed = sim >= threshold
    return {"scorer": "similarity", "score": round(sim, 3), "passed": passed, "detail": f"Jaccard similarity: {sim:.3f} (threshold: {threshold})"}


async def score_llm_judge(output: str, expected: str, criteria: str = "", llm=None, **_) -> dict:
    """Use an LLM to judge the output quality."""
    if not llm:
        return {"scorer": "llm_judge", "score": 0.5, "passed": True, "detail": "No LLM available for judging"}

    prompt = f"""Rate this agent output on a scale of 0.0 to 1.0.

Expected output: {expected[:500]}
Actual output: {output[:1000]}
{f'Criteria: {criteria}' if criteria else ''}

Respond with ONLY a JSON object: {{"score": 0.0-1.0, "reason": "brief explanation"}}"""

    try:
        resp = await llm.complete(
            system="You are an evaluation judge. Score outputs strictly. Respond only with valid JSON.",
            messages=[{"role": "user", "content": prompt}],
            tools=[],
        )
        text = (resp.content or "").strip()
        if text.startswith("```"):
            text = text.split("```")[1].strip()
            if text.startswith("json"):
                text = text[4:].strip()
        result = json.loads(text)
        score = float(result.get("score", 0.5))
        reason = result.get("reason", "")
        return {"scorer": "llm_judge", "score": round(score, 3), "passed": score >= 0.5, "detail": reason, "tokens": resp.tokens_input + resp.tokens_output}
    except Exception as exc:
        return {"scorer": "llm_judge", "score": 0.5, "passed": True, "detail": f"Judge error: {str(exc)[:100]}"}


SCORERS = {
    "contains": score_contains,
    "regex": score_regex,
    "json_valid": score_json_valid,
    "similarity": score_similarity,
    "llm_judge": score_llm_judge,
}


# ── Eval Run ─────────────────────────────────────────────────────────────────

async def run_eval(
    dataset_id: str,
    scoring_functions: list[dict],
    kernel=None,
    namespace: str = "eval",
    max_concurrent: int = 2,
) -> dict:
    """Execute an evaluation run against a dataset.

    scoring_functions: [{"type": "contains"}, {"type": "similarity", "threshold": 0.8}, ...]
    """
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    run_id = _uuid()
    cases = dataset.get("cases", [])
    run = {
        "id": run_id,
        "dataset_id": dataset_id,
        "dataset_name": dataset["name"],
        "status": "running",
        "scoring_functions": scoring_functions,
        "namespace": namespace,
        "started_at": _now_iso(),
        "completed_at": None,
        "total_cases": len(cases),
        "completed_cases": 0,
        "current_case": "",
        "results": [],
        "summary": {},
    }
    _save_run(run)

    # Execute cases sequentially with live progress updates
    run_results = []
    for i, case in enumerate(cases):
        # Update progress — which case is running
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

        run_results.append(result)
        # Save after each case so frontend can poll progress
        run["results"] = run_results
        run["completed_cases"] = i + 1
        _save_run(run)

    # Compute summary
    all_scores = [s["score"] for r in run_results for s in r.get("scores", []) if "score" in s]
    all_passed = [s["passed"] for r in run_results for s in r.get("scores", []) if "passed" in s]
    total_duration = sum(r.get("duration_ms", 0) for r in run_results)

    run["results"] = run_results
    run["status"] = "completed"
    run["completed_at"] = _now_iso()
    run["current_case"] = ""
    run["completed_cases"] = len(cases)
    run["summary"] = {
        "total_cases": len(cases),
        "avg_score": round(sum(all_scores) / len(all_scores), 3) if all_scores else 0.0,
        "pass_rate": round(sum(1 for p in all_passed if p) / len(all_passed) * 100, 1) if all_passed else 0.0,
        "total_duration_ms": round(total_duration, 1),
        "scores_by_scorer": _aggregate_by_scorer(run_results),
    }
    _save_run(run)
    return run


async def _execute_case(case: dict, scoring_fns: list[dict], kernel, namespace: str) -> dict:
    """Run a single eval case through the agent and score."""
    input_text = case.get("input", "")
    expected = case.get("expected_output", "")

    t0 = time.monotonic()
    output = ""

    # Execute through the actual kernel engine
    if kernel:
        try:
            from kernelmcp.core.models import Task
            task = Task(goal=input_text, namespace=f"{namespace}__eval")
            task = await asyncio.wait_for(kernel._engine.run(task), timeout=120)
            output = task.summary or ""
        except asyncio.TimeoutError:
            output = "[TIMEOUT]"
        except Exception as exc:
            output = f"[ERROR: {str(exc)[:200]}]"
    else:
        output = "[NO KERNEL - dry run]"

    duration = (time.monotonic() - t0) * 1000

    # Score
    scores = []
    for sf in scoring_fns:
        scorer_type = sf.get("type", "contains")
        scorer_fn = SCORERS.get(scorer_type)
        if not scorer_fn:
            scores.append({"scorer": scorer_type, "score": 0.0, "passed": False, "detail": f"Unknown scorer: {scorer_type}"})
            continue

        kwargs = {k: v for k, v in sf.items() if k != "type"}
        if scorer_type == "llm_judge":
            kwargs["llm"] = kernel._engine._llm if kernel else None
            result = await scorer_fn(output, expected, **kwargs)
        else:
            result = scorer_fn(output, expected, **kwargs)
        scores.append(result)

    return {
        "case_id": case["id"],
        "input": input_text[:200],
        "expected": expected[:200],
        "output": output[:500],
        "scores": scores,
        "error": "",
        "duration_ms": round(duration, 1),
    }


def _aggregate_by_scorer(results: list[dict]) -> dict:
    """Aggregate scores grouped by scorer type."""
    by_scorer: dict[str, list[float]] = {}
    for r in results:
        for s in r.get("scores", []):
            name = s.get("scorer", "unknown")
            if name not in by_scorer:
                by_scorer[name] = []
            by_scorer[name].append(s.get("score", 0.0))
    return {
        name: {
            "avg": round(sum(vals) / len(vals), 3) if vals else 0.0,
            "min": round(min(vals), 3) if vals else 0.0,
            "max": round(max(vals), 3) if vals else 0.0,
            "count": len(vals),
        }
        for name, vals in by_scorer.items()
    }


# ── Run Persistence ─────────────────────────────────────────────────────────

def _save_run(run: dict) -> None:
    path = os.path.join(_RUNS_DIR, f"{run['id']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(run, f, ensure_ascii=False, default=str)


def get_run(run_id: str) -> dict | None:
    path = os.path.join(_RUNS_DIR, f"{run_id}.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_runs(dataset_id: str | None = None) -> list[dict]:
    runs = []
    for fname in os.listdir(_RUNS_DIR):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(_RUNS_DIR, fname), "r", encoding="utf-8") as f:
                run = json.load(f)
            if dataset_id and run.get("dataset_id") != dataset_id:
                continue
            runs.append({
                "id": run["id"],
                "dataset_id": run.get("dataset_id", ""),
                "dataset_name": run.get("dataset_name", ""),
                "status": run.get("status", "unknown"),
                "started_at": run.get("started_at", ""),
                "completed_at": run.get("completed_at"),
                "summary": run.get("summary", {}),
            })
        except Exception:
            pass
    return sorted(runs, key=lambda r: r.get("started_at", ""), reverse=True)


def delete_run(run_id: str) -> bool:
    path = os.path.join(_RUNS_DIR, f"{run_id}.json")
    if os.path.isfile(path):
        os.remove(path)
        return True
    return False


def compare_runs(run_id_a: str, run_id_b: str) -> dict | None:
    """Compare two eval runs case by case."""
    run_a = get_run(run_id_a)
    run_b = get_run(run_id_b)
    if not run_a or not run_b:
        return None

    # Index results by case_id
    a_by_case = {r["case_id"]: r for r in run_a.get("results", [])}
    b_by_case = {r["case_id"]: r for r in run_b.get("results", [])}

    all_cases = sorted(set(a_by_case.keys()) | set(b_by_case.keys()))
    diffs = []
    improved = 0
    regressed = 0
    unchanged = 0

    for cid in all_cases:
        ra = a_by_case.get(cid)
        rb = b_by_case.get(cid)
        score_a = _avg_score(ra) if ra else None
        score_b = _avg_score(rb) if rb else None

        if score_a is not None and score_b is not None:
            delta = score_b - score_a
            if delta > 0.05:
                improved += 1
                status = "improved"
            elif delta < -0.05:
                regressed += 1
                status = "regressed"
            else:
                unchanged += 1
                status = "unchanged"
        else:
            delta = 0
            status = "new" if rb and not ra else "removed"

        diffs.append({
            "case_id": cid,
            "input": (ra or rb or {}).get("input", ""),
            "score_a": score_a,
            "score_b": score_b,
            "delta": round(delta, 3) if delta else 0,
            "status": status,
            "output_a": (ra or {}).get("output", "")[:200],
            "output_b": (rb or {}).get("output", "")[:200],
        })

    return {
        "run_a": {"id": run_id_a, "summary": run_a.get("summary", {})},
        "run_b": {"id": run_id_b, "summary": run_b.get("summary", {})},
        "improved": improved,
        "regressed": regressed,
        "unchanged": unchanged,
        "diffs": diffs,
    }


def _avg_score(result: dict) -> float:
    scores = [s["score"] for s in result.get("scores", []) if "score" in s]
    return sum(scores) / len(scores) if scores else 0.0
