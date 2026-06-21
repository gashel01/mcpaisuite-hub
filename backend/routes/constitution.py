"""Constitution versioning and playground — Sprint 4."""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import json, os, time, uuid, sqlite3, threading, difflib
from datetime import datetime, timezone

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "constitution")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "versions.db")

_db_lock = threading.Lock()


def _get_kernel():
    """Get kernel instance from server module."""
    try:
        import server
        return server.kernel
    except (ImportError, AttributeError):
        return None


def _get_db():
    """Get a SQLite connection (creates table if needed)."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS versions (
            id TEXT PRIMARY KEY,
            rules TEXT NOT NULL,
            meta_rules TEXT DEFAULT '[]',
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            metrics_snapshot TEXT DEFAULT '{}'
        )
    """)
    conn.commit()
    return conn


def _get_metrics_snapshot() -> dict:
    """Capture current metrics for snapshot."""
    try:
        from stores import metrics_store
        summary = metrics_store.summary() if hasattr(metrics_store, "summary") else {}
        return {
            "success_rate": summary.get("success_rate", 0),
            "avg_cost": summary.get("avg_cost", 0),
        }
    except Exception:
        return {}


def _version_count() -> int:
    """Count total versions."""
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute("SELECT COUNT(*) as cnt FROM versions").fetchone()
            return row["cnt"] if row else 0
        finally:
            conn.close()


def _save_version(rules: str, meta_rules: list, note: str = "", metrics: dict | None = None) -> str:
    """Save a version and return its ID."""
    version_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    snapshot = json.dumps(metrics or _get_metrics_snapshot())
    meta_json = json.dumps(meta_rules)

    with _db_lock:
        conn = _get_db()
        try:
            conn.execute(
                "INSERT INTO versions (id, rules, meta_rules, note, created_at, metrics_snapshot) VALUES (?, ?, ?, ?, ?, ?)",
                (version_id, rules, meta_json, note, now, snapshot),
            )
            conn.commit()
        finally:
            conn.close()
    return version_id


# --- Models ---

class UpdateConstitutionRequest(BaseModel):
    rules: str
    note: str = ""


class PreviewRequest(BaseModel):
    rules: str
    test_goal: str = ""
    memory_context: str = ""
    rag_context: str = ""


class ABTestRequest(BaseModel):
    """Run the same goal under two constitutions and compare. Each side is either a
    saved version id, the live constitution ("current"), or raw rules text."""
    goal: str
    version_a: str = ""        # saved version id, or "current"
    version_b: str = ""
    rules_a: Optional[str] = None  # raw rules; overrides version_a when set
    rules_b: Optional[str] = None
    reps: int = 1
    namespace: str = "default"
    judge: bool = False        # LLM-as-judge quality scoring (evalmcp)
    expected_output: str = ""  # reference answer the judge grades against (required for judge)
    label_a: str = ""          # display label; falls back to version id / "custom" / "current"
    label_b: str = ""


def _load_version_rules(version_id: str) -> str | None:
    """Rules text for a saved version id, or None if not found."""
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute("SELECT rules FROM versions WHERE id = ?", (version_id,)).fetchone()
            return row["rules"] if row else None
        finally:
            conn.close()


def _resolve_ab_side(raw: Optional[str], version_id: str, kernel) -> tuple[str, str]:
    """Resolve one A/B side to (rules_text, label). Raw text wins; then a saved
    version id; then the live constitution ("current"/empty)."""
    if raw is not None:
        return raw, "custom"
    if version_id and version_id != "current":
        rules = _load_version_rules(version_id)
        if rules is None:
            raise HTTPException(status_code=404, detail=f"Version {version_id} not found")
        return rules, version_id
    # current live constitution
    return (kernel._engine._constitution.rules or ""), "current"


# --- Endpoints ---

@router.get("/constitution")
def get_constitution():
    """Get current constitution state."""
    kernel = _get_kernel()
    if not kernel:
        raise HTTPException(status_code=503, detail="Kernel not available")

    try:
        constitution = kernel._engine._constitution
        rules = constitution.rules or ""
        meta_rules = list(getattr(constitution, "_meta_rules", []))
        rendered = constitution.render(memory_context="", rag_context="")
        count = _version_count()

        return {
            "rules": rules,
            "meta_rules": meta_rules,
            "rendered_preview": rendered,
            "version_count": count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read constitution: {e}")


@router.post("/constitution")
def update_constitution(req: UpdateConstitutionRequest):
    """Update constitution rules (auto-versions current state first)."""
    kernel = _get_kernel()
    if not kernel:
        raise HTTPException(status_code=503, detail="Kernel not available")

    try:
        constitution = kernel._engine._constitution

        # Save current state as a version before updating
        current_rules = constitution.rules or ""
        current_meta = list(getattr(constitution, "_meta_rules", []))
        _save_version(current_rules, current_meta, note=req.note or "Auto-saved before update")

        # Apply new rules
        constitution.update_rules(req.rules)

        # Return new state
        return {
            "rules": constitution.rules,
            "meta_rules": list(getattr(constitution, "_meta_rules", [])),
            "rendered_preview": constitution.render(memory_context="", rag_context=""),
            "version_count": _version_count(),
            "status": "updated",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update constitution: {e}")


@router.get("/constitution/versions")
def list_versions():
    """List all saved versions."""
    with _db_lock:
        conn = _get_db()
        try:
            rows = conn.execute(
                "SELECT id, rules, meta_rules, note, created_at, metrics_snapshot FROM versions ORDER BY created_at DESC"
            ).fetchall()

            versions = []
            for row in rows:
                versions.append({
                    "id": row["id"],
                    "rules_preview": (row["rules"] or "")[:100],
                    "note": row["note"],
                    "created_at": row["created_at"],
                    "metrics_snapshot": json.loads(row["metrics_snapshot"] or "{}"),
                })
            return versions
        finally:
            conn.close()


@router.get("/constitution/versions/{version_id}")
def get_version(version_id: str):
    """Get a specific version with full rules."""
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute(
                "SELECT * FROM versions WHERE id = ?", (version_id,)
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Version {version_id} not found")
            return {
                "id": row["id"],
                "rules": row["rules"],
                "meta_rules": json.loads(row["meta_rules"] or "[]"),
                "note": row["note"],
                "created_at": row["created_at"],
                "metrics_snapshot": json.loads(row["metrics_snapshot"] or "{}"),
            }
        finally:
            conn.close()


@router.post("/constitution/rollback/{version_id}")
def rollback_version(version_id: str):
    """Rollback to a specific version."""
    kernel = _get_kernel()
    if not kernel:
        raise HTTPException(status_code=503, detail="Kernel not available")

    # Load the target version
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute(
                "SELECT * FROM versions WHERE id = ?", (version_id,)
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Version {version_id} not found")
            target_rules = row["rules"]
            target_meta = json.loads(row["meta_rules"] or "[]")
        finally:
            conn.close()

    try:
        constitution = kernel._engine._constitution

        # Save current state before rollback
        current_rules = constitution.rules or ""
        current_meta = list(getattr(constitution, "_meta_rules", []))
        _save_version(current_rules, current_meta, note=f"Auto-saved before rollback to {version_id}")

        # Apply rollback
        constitution.update_rules(target_rules)
        constitution.clear_meta_rules()
        for rule in target_meta:
            constitution.add_meta_rule(rule)

        # Record the rollback as a new version too
        _save_version(target_rules, target_meta, note=f"Rollback to version {version_id}")

        return {
            "status": "rolled_back",
            "version_id": version_id,
            "rules": target_rules,
            "meta_rules": target_meta,
            "version_count": _version_count(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")


@router.post("/constitution/preview")
def preview_constitution(req: PreviewRequest):
    """Preview rendered system prompt without applying changes."""
    kernel = _get_kernel()
    if not kernel:
        raise HTTPException(status_code=503, detail="Kernel not available")

    try:
        constitution = kernel._engine._constitution

        # Temporarily render with the provided rules
        # We don't modify the actual constitution, just compute what it would look like
        original_rules = constitution.rules
        constitution.update_rules(req.rules)
        rendered = constitution.render(
            memory_context=req.memory_context,
            rag_context=req.rag_context,
        )
        # Restore original
        constitution.update_rules(original_rules)

        # Token estimate (rough: 1 token ~ 4 chars for English)
        char_count = len(rendered)
        token_estimate = char_count // 4

        return {
            "system_prompt": rendered,
            "token_estimate": token_estimate,
            "character_count": char_count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {e}")


@router.get("/constitution/diff")
def diff_versions(a: str = Query(..., description="Version A ID"), b: str = Query(..., description="Version B ID")):
    """Diff two versions line by line."""
    with _db_lock:
        conn = _get_db()
        try:
            row_a = conn.execute("SELECT * FROM versions WHERE id = ?", (a,)).fetchone()
            row_b = conn.execute("SELECT * FROM versions WHERE id = ?", (b,)).fetchone()
        finally:
            conn.close()

    if not row_a:
        raise HTTPException(status_code=404, detail=f"Version {a} not found")
    if not row_b:
        raise HTTPException(status_code=404, detail=f"Version {b} not found")

    lines_a = (row_a["rules"] or "").splitlines(keepends=True)
    lines_b = (row_b["rules"] or "").splitlines(keepends=True)

    diff_lines = []
    for line in difflib.unified_diff(lines_a, lines_b, fromfile=f"version-{a}", tofile=f"version-{b}", lineterm=""):
        stripped = line.rstrip("\n")
        if line.startswith("+") and not line.startswith("+++"):
            diff_lines.append({"type": "add", "line": stripped[1:]})
        elif line.startswith("-") and not line.startswith("---"):
            diff_lines.append({"type": "remove", "line": stripped[1:]})
        elif line.startswith(" "):
            diff_lines.append({"type": "same", "line": stripped[1:]})

    return {
        "version_a": {"id": a, "rules": row_a["rules"], "created_at": row_a["created_at"]},
        "version_b": {"id": b, "rules": row_b["rules"], "created_at": row_b["created_at"]},
        "diff": diff_lines,
    }


@router.post("/constitution/ab")
async def ab_test_constitutions(req: ABTestRequest):
    """A/B test two constitutions on a goal — reports metric deltas + a winner.

    Each side is a saved version id, "current" (live constitution), or raw rules.
    The live constitution is restored after every run (the kernel swaps it per-task),
    so this does NOT permanently change the active constitution. When ``judge`` is on
    and ``expected_output`` is given, an evalmcp LLM judge scores answer quality and
    the winner is decided on quality first (then success rate, then cost)."""
    kernel = _get_kernel()
    if not kernel:
        raise HTTPException(status_code=503, detail="Kernel not available")
    if not req.goal.strip():
        raise HTTPException(status_code=400, detail="goal is required")

    rules_a, auto_a = _resolve_ab_side(req.rules_a, req.version_a, kernel)
    rules_b, auto_b = _resolve_ab_side(req.rules_b, req.version_b, kernel)
    label_a = req.label_a.strip() or auto_a
    label_b = req.label_b.strip() or auto_b
    if label_a == label_b:  # keep the winner unambiguous
        label_a, label_b = f"{label_a} (A)", f"{label_b} (B)"

    async def _run_fn(goal: str, constitution: str):
        return await kernel.run(goal, namespace=req.namespace, constitution=constitution)

    # Optional quality scoring via an evalmcp LLM judge, grounded on expected_output.
    score_fn = None
    judged = False
    if req.judge and req.expected_output.strip():
        llm = getattr(getattr(kernel, "_engine", None), "_llm", None)
        if llm is not None:
            try:
                from evalmcp.core.judges import LLMJudge
                from evalmcp.core.models import EvalCase

                async def _judge_llm_fn(prompt: str) -> str:
                    resp = await llm.complete(
                        system="You are an evaluation judge. Respond only with valid JSON.",
                        messages=[{"role": "user", "content": prompt}],
                        tools=[],
                    )
                    return resp.content or ""

                _judge = LLMJudge(_judge_llm_fn)
                _case = EvalCase(input=req.goal, expected_output=req.expected_output, tool="")

                async def score_fn(goal: str, task) -> float:  # noqa: F811
                    answer = getattr(task, "summary", "") or ""
                    res = await _judge.judge(_case, answer)
                    return res.score

                judged = True
            except Exception:
                score_fn = None  # evalmcp missing → degrade to metric-only comparison

    from kernelmcp.ab_test import run_ab
    try:
        result = await run_ab(
            _run_fn, req.goal, rules_a, rules_b,
            reps=max(1, req.reps), label_a=label_a, label_b=label_b,
            score_fn=score_fn,
        )
    except Exception as exc:  # noqa: BLE001 - surface kernel/provider errors
        raise HTTPException(status_code=502, detail=f"A/B run failed: {exc}")

    result["judged"] = judged
    if req.judge and not judged:
        result["judge_note"] = "Judge skipped: expected_output required and an LLM must be configured."
    return result
