"""Regression detection — compares task performance against learned baselines."""
import json, os, re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "regression")
os.makedirs(DATA_DIR, exist_ok=True)
BASELINES_FILE = os.path.join(DATA_DIR, "baselines.json")


@dataclass
class Baseline:
    pattern: str
    avg_cost: float = 0.0
    avg_turns: float = 0.0
    avg_latency_ms: float = 0.0
    success_rate: float = 100.0
    sample_count: int = 0
    last_updated: str = ""


class RegressionDetector:
    """Tracks per-pattern baselines and detects regressions using EMA."""

    STOP_WORDS = frozenset({
        "a", "an", "the", "is", "are", "was", "were", "be", "been",
        "to", "of", "in", "for", "on", "with", "and", "or", "but",
        "not", "this", "that", "it", "my", "me", "i",
    })

    def __init__(self):
        self.baselines: dict[str, Baseline] = {}
        self._alpha = 0.15  # EMA smoothing factor
        self._min_samples = 3  # Minimum runs before detecting regressions
        self._threshold_multiplier = 2.5  # Alert if >2.5x worse than baseline
        self._load()

    def _goal_pattern(self, goal: str) -> str:
        """Extract pattern from goal: first 5 meaningful words, lowercased."""
        words = re.findall(r'\w+', goal.lower())
        meaningful = [w for w in words if w not in self.STOP_WORDS and len(w) > 1][:5]
        return " ".join(meaningful) if meaningful else "unknown"

    def update(self, goal: str, cost: float, turns: int, latency_ms: float, success: bool):
        """Update baseline with new data point using exponential moving average."""
        pattern = self._goal_pattern(goal)
        if pattern not in self.baselines:
            self.baselines[pattern] = Baseline(pattern=pattern)

        b = self.baselines[pattern]
        b.sample_count += 1

        if b.sample_count == 1:
            b.avg_cost = cost
            b.avg_turns = float(turns)
            b.avg_latency_ms = latency_ms
            b.success_rate = 100.0 if success else 0.0
        else:
            a = self._alpha
            b.avg_cost = a * cost + (1 - a) * b.avg_cost
            b.avg_turns = a * turns + (1 - a) * b.avg_turns
            b.avg_latency_ms = a * latency_ms + (1 - a) * b.avg_latency_ms
            b.success_rate = a * (100.0 if success else 0.0) + (1 - a) * b.success_rate

        b.last_updated = datetime.now(timezone.utc).isoformat()
        self._save()

    def check(self, goal: str, cost: float, turns: int, latency_ms: float) -> list[dict]:
        """Check if a task regressed vs baseline. Returns list of regressions found."""
        pattern = self._goal_pattern(goal)
        b = self.baselines.get(pattern)
        if not b or b.sample_count < self._min_samples:
            return []

        regressions = []
        m = self._threshold_multiplier

        if cost > 0 and b.avg_cost > 0 and cost > b.avg_cost * m:
            regressions.append({
                "metric": "cost",
                "expected": round(b.avg_cost, 4),
                "actual": round(cost, 4),
                "ratio": round(cost / b.avg_cost, 1),
            })
        if turns > 0 and b.avg_turns > 0 and turns > b.avg_turns * m:
            regressions.append({
                "metric": "turns",
                "expected": round(b.avg_turns, 1),
                "actual": turns,
                "ratio": round(turns / b.avg_turns, 1),
            })
        if latency_ms > 0 and b.avg_latency_ms > 0 and latency_ms > b.avg_latency_ms * m:
            regressions.append({
                "metric": "latency",
                "expected": round(b.avg_latency_ms, 0),
                "actual": round(latency_ms, 0),
                "ratio": round(latency_ms / b.avg_latency_ms, 1),
            })

        return regressions

    def get_baselines(self) -> list[Baseline]:
        """Get all baselines sorted by sample count (most data first)."""
        return sorted(self.baselines.values(), key=lambda b: b.sample_count, reverse=True)

    def get_baseline(self, goal: str) -> Baseline | None:
        """Get baseline for a specific goal pattern."""
        pattern = self._goal_pattern(goal)
        return self.baselines.get(pattern)

    def reset(self):
        """Clear all baselines."""
        self.baselines = {}
        self._save()

    def stats(self) -> dict:
        """Return summary statistics about the regression system."""
        if not self.baselines:
            return {
                "total_baselines": 0,
                "total_samples": 0,
                "avg_samples_per_baseline": 0,
                "oldest_baseline": None,
                "newest_baseline": None,
            }

        total_samples = sum(b.sample_count for b in self.baselines.values())
        dates = [b.last_updated for b in self.baselines.values() if b.last_updated]

        return {
            "total_baselines": len(self.baselines),
            "total_samples": total_samples,
            "avg_samples_per_baseline": round(total_samples / len(self.baselines), 1),
            "oldest_baseline": min(dates) if dates else None,
            "newest_baseline": max(dates) if dates else None,
        }

    def _load(self):
        """Load baselines from disk."""
        if not os.path.exists(BASELINES_FILE):
            return
        try:
            with open(BASELINES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for pattern, values in data.items():
                self.baselines[pattern] = Baseline(**values)
        except (json.JSONDecodeError, TypeError, KeyError) as e:
            # Corrupted file — start fresh but don't delete it
            print(f"[regression] Warning: could not load baselines: {e}")

    def _save(self):
        """Persist baselines to disk."""
        try:
            data = {pattern: asdict(b) for pattern, b in self.baselines.items()}
            with open(BASELINES_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except OSError as e:
            print(f"[regression] Warning: could not save baselines: {e}")


# Singleton instance
regression_detector = RegressionDetector()
