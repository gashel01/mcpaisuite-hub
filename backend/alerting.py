"""Alerting engine — configurable rules with webhook, Slack, and in-app notifications."""
from __future__ import annotations
import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Callable

# Storage path for rules and history
DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "alerts")
os.makedirs(DATA_DIR, exist_ok=True)
RULES_FILE = os.path.join(DATA_DIR, "rules.json")
HISTORY_FILE = os.path.join(DATA_DIR, "history.jsonl")


@dataclass
class AlertRule:
    id: str
    name: str
    metric: str           # "failure_rate" | "daily_cost" | "p95_latency" | "circuit_open" | "budget_used_pct" | "injection_detected" | "throughput" | "error_rate"
    operator: str         # ">" | "<" | ">=" | "<=" | "==" | "!="
    threshold: float
    window: str           # "1h" | "6h" | "24h"
    channels: list[str]   # ["webhook", "slack", "in_app"]
    action: str = "notify" # "notify" | "pause" — pause halts agent execution
    webhook_url: str = ""
    slack_webhook: str = ""
    cooldown_minutes: int = 60
    namespace: str = ""   # empty = all namespaces
    enabled: bool = True
    created_at: str = ""
    last_fired_at: str = ""


@dataclass
class AlertFired:
    id: str
    rule_id: str
    rule_name: str
    metric: str
    value: float
    threshold: float
    operator: str
    fired_at: str
    acknowledged: bool = False
    acknowledged_at: str = ""


class AlertEngine:
    def __init__(self):
        self.rules: list[AlertRule] = []
        self.history: list[AlertFired] = []
        self._cooldowns: dict[str, float] = {}  # rule_id -> last fire timestamp
        self._running = False
        self._task: asyncio.Task | None = None
        self.paused_namespaces: set[str] = set()  # namespaces paused by alert action
        self._load()

    def _load(self):
        """Load rules from disk."""
        try:
            if os.path.exists(RULES_FILE):
                with open(RULES_FILE) as f:
                    data = json.load(f)
                self.rules = [AlertRule(**r) for r in data]
        except (json.JSONDecodeError, OSError):
            self.rules = []

        # Load last 200 history entries
        try:
            if os.path.exists(HISTORY_FILE):
                with open(HISTORY_FILE) as f:
                    lines = f.readlines()[-200:]
                self.history = [AlertFired(**json.loads(l)) for l in lines if l.strip()]
        except (json.JSONDecodeError, OSError):
            self.history = []

    def _save_rules(self):
        try:
            with open(RULES_FILE, "w") as f:
                json.dump([asdict(r) for r in self.rules], f, indent=2)
        except OSError:
            pass

    def _save_alert(self, alert: AlertFired):
        self.history.append(alert)
        # Keep in-memory history bounded
        if len(self.history) > 500:
            self.history = self.history[-200:]
        try:
            with open(HISTORY_FILE, "a") as f:
                f.write(json.dumps(asdict(alert)) + "\n")
        except OSError:
            pass

    # CRUD
    def add_rule(self, rule: AlertRule) -> AlertRule:
        if not rule.created_at:
            rule.created_at = datetime.now(timezone.utc).isoformat()
        self.rules.append(rule)
        self._save_rules()
        return rule

    def update_rule(self, rule_id: str, updates: dict) -> AlertRule | None:
        for rule in self.rules:
            if rule.id == rule_id:
                for key, value in updates.items():
                    if hasattr(rule, key) and value is not None:
                        setattr(rule, key, value)
                self._save_rules()
                return rule
        return None

    def delete_rule(self, rule_id: str) -> bool:
        before = len(self.rules)
        self.rules = [r for r in self.rules if r.id != rule_id]
        if len(self.rules) < before:
            self._save_rules()
            return True
        return False

    def get_rules(self) -> list[AlertRule]:
        return self.rules

    def get_history(self, limit: int = 50) -> list[AlertFired]:
        return self.history[-limit:][::-1]

    def acknowledge(self, alert_id: str) -> bool:
        for alert in self.history:
            if alert.id == alert_id:
                alert.acknowledged = True
                alert.acknowledged_at = datetime.now(timezone.utc).isoformat()
                return True
        return False

    def unacknowledged_count(self) -> int:
        return sum(1 for a in self.history if not a.acknowledged)

    # Evaluation
    async def evaluate_all(self):
        """Check all enabled rules against current metrics."""
        for rule in self.rules:
            if not rule.enabled:
                continue
            if self._in_cooldown(rule):
                continue
            try:
                value = await self._evaluate_metric(rule)
                if self._check_condition(value, rule.operator, rule.threshold):
                    await self._fire(rule, value)
            except Exception:
                pass

    async def _evaluate_metric(self, rule: AlertRule) -> float:
        """Compute the current value of a metric for a rule."""
        from routes.metrics import _get_tasks_in_window, _parse_window

        now = time.time()
        window_secs = _parse_window(rule.window)
        start_ts = now - window_secs
        tasks = _get_tasks_in_window(rule.namespace or "default", start_ts, now)

        if rule.metric in ("failure_rate", "error_rate"):
            completed = sum(1 for t in tasks if t.get("status") == "completed")
            failed = sum(1 for t in tasks if t.get("status") == "failed")
            total = completed + failed
            return (failed / total * 100) if total > 0 else 0.0

        elif rule.metric == "daily_cost":
            return sum(t.get("total_cost", 0.0) for t in tasks)

        elif rule.metric == "p95_latency":
            durations = sorted([t.get("duration_ms", 0) for t in tasks if t.get("duration_ms")])
            if not durations:
                return 0.0
            idx = int(0.95 * (len(durations) - 1))
            return durations[idx]

        elif rule.metric == "throughput":
            return float(len(tasks))

        elif rule.metric == "budget_used_pct":
            # Would need budget config — return 0 for now
            return 0.0

        elif rule.metric == "injection_detected":
            from stores import audit_collector
            count = sum(1 for e in audit_collector._events
                        if e.get("ts", 0) > start_ts and "injection" in e.get("type", "").lower())
            return float(count)

        elif rule.metric == "circuit_open":
            from stores import audit_collector
            open_events = sum(1 for e in audit_collector._events
                              if e.get("ts", 0) > start_ts
                              and "circuit" in e.get("type", "").lower()
                              and "open" in e.get("type", "").lower())
            return float(open_events)

        return 0.0

    def _check_condition(self, value: float, operator: str, threshold: float) -> bool:
        ops = {
            ">": lambda a, b: a > b,
            "<": lambda a, b: a < b,
            ">=": lambda a, b: a >= b,
            "<=": lambda a, b: a <= b,
            "==": lambda a, b: a == b,
            "!=": lambda a, b: a != b,
        }
        return ops.get(operator, lambda a, b: False)(value, threshold)

    def _in_cooldown(self, rule: AlertRule) -> bool:
        last = self._cooldowns.get(rule.id, 0)
        return (time.time() - last) < (rule.cooldown_minutes * 60)

    async def _fire(self, rule: AlertRule, value: float):
        """Fire the alert via all configured channels."""
        alert = AlertFired(
            id=str(uuid.uuid4())[:8],
            rule_id=rule.id,
            rule_name=rule.name,
            metric=rule.metric,
            value=round(value, 4),
            threshold=rule.threshold,
            operator=rule.operator,
            fired_at=datetime.now(timezone.utc).isoformat(),
        )
        self._cooldowns[rule.id] = time.time()
        rule.last_fired_at = alert.fired_at
        self._save_alert(alert)
        self._save_rules()

        # Action: pause agent execution for this namespace
        if rule.action == "pause":
            ns = rule.namespace or "default"
            self.paused_namespaces.add(ns)
            try:
                from stores import audit_collector
                audit_collector.emit("alerting", "execution_paused", {
                    "namespace": ns, "rule": rule.name, "metric": rule.metric,
                    "value": value, "threshold": rule.threshold,
                }, detail=f"Execution paused: {rule.name}")
            except Exception:
                pass

        # In-app: emit to audit collector
        if "in_app" in rule.channels:
            try:
                from stores import audit_collector
                audit_collector.emit("alerting", "alert_fired", {
                    "alert_id": alert.id, "rule": rule.name,
                    "metric": rule.metric, "value": value, "threshold": rule.threshold,
                }, detail=f"Alert: {rule.name} ({rule.metric} {rule.operator} {rule.threshold})")
            except Exception:
                pass

        # Webhook
        if "webhook" in rule.channels and rule.webhook_url:
            try:
                import httpx
                async with httpx.AsyncClient() as client:
                    await client.post(rule.webhook_url, json=asdict(alert), timeout=10)
            except Exception:
                pass

        # Slack
        if "slack" in rule.channels and rule.slack_webhook:
            try:
                import httpx
                payload = {"text": f"\U0001f6a8 *Alert: {rule.name}*\n{rule.metric} = {value:.2f} ({rule.operator} {rule.threshold})"}
                async with httpx.AsyncClient() as client:
                    await client.post(rule.slack_webhook, json=payload, timeout=10)
            except Exception:
                pass

    # Background loop
    async def start(self):
        """Start the background evaluation loop (every 60s)."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def _loop(self):
        while self._running:
            try:
                await self.evaluate_all()
            except Exception:
                pass
            await asyncio.sleep(60)

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()


# Singleton
alert_engine = AlertEngine()
