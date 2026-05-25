"""FastAPI router for alert management."""
from __future__ import annotations
from dataclasses import asdict
from typing import Optional
import uuid

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from alerting import alert_engine, AlertRule

router = APIRouter()


# --- Pydantic models ---

class CreateAlertRule(BaseModel):
    name: str
    metric: str  # failure_rate, error_rate, daily_cost, p95_latency, throughput, circuit_open, injection_detected, budget_used_pct
    operator: str = ">"
    threshold: float
    window: str = "1h"
    channels: list[str] = ["in_app"]
    action: str = "notify"  # notify, pause
    webhook_url: str = ""
    slack_webhook: str = ""
    cooldown_minutes: int = 60
    namespace: str = ""
    enabled: bool = True


class UpdateAlertRule(BaseModel):
    name: Optional[str] = None
    metric: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    window: Optional[str] = None
    channels: Optional[list[str]] = None
    action: Optional[str] = None
    webhook_url: Optional[str] = None
    slack_webhook: Optional[str] = None
    cooldown_minutes: Optional[int] = None
    namespace: Optional[str] = None
    enabled: Optional[bool] = None


# --- Endpoints ---

@router.get("/alerts/rules")
async def list_rules():
    """List all alert rules."""
    return [asdict(r) for r in alert_engine.get_rules()]


@router.post("/alerts/rules")
async def create_rule(body: CreateAlertRule):
    """Create a new alert rule."""
    rule = AlertRule(
        id=str(uuid.uuid4())[:8],
        name=body.name,
        metric=body.metric,
        operator=body.operator,
        threshold=body.threshold,
        window=body.window,
        channels=body.channels,
        action=body.action,
        webhook_url=body.webhook_url,
        slack_webhook=body.slack_webhook,
        cooldown_minutes=body.cooldown_minutes,
        namespace=body.namespace,
        enabled=body.enabled,
    )
    created = alert_engine.add_rule(rule)
    return asdict(created)


@router.put("/alerts/rules/{rule_id}")
async def update_rule(rule_id: str, body: UpdateAlertRule):
    """Update an existing alert rule."""
    updates = body.model_dump(exclude_none=True)
    updated = alert_engine.update_rule(rule_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return asdict(updated)


@router.delete("/alerts/rules/{rule_id}")
async def delete_rule(rule_id: str):
    """Delete an alert rule."""
    deleted = alert_engine.delete_rule(rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@router.get("/alerts/history")
async def get_history(limit: int = 50):
    """List fired alerts, most recent first."""
    return [asdict(a) for a in alert_engine.get_history(limit)]


@router.post("/alerts/{alert_id}/ack")
async def acknowledge_alert(alert_id: str):
    """Acknowledge a fired alert."""
    acked = alert_engine.acknowledge(alert_id)
    if not acked:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}


@router.post("/alerts/rules/{rule_id}/test")
async def test_rule(rule_id: str):
    """Dry-run: evaluate a rule now and return current value + would_fire."""
    rule = next((r for r in alert_engine.rules if r.id == rule_id), None)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    value = await alert_engine._evaluate_metric(rule)
    would_fire = alert_engine._check_condition(value, rule.operator, rule.threshold)
    return {"rule_id": rule_id, "metric": rule.metric, "current_value": round(value, 4), "threshold": rule.threshold, "operator": rule.operator, "would_fire": would_fire}


@router.get("/alerts/unread-count")
async def unread_count():
    """Return count of unacknowledged alerts."""
    return {"count": alert_engine.unacknowledged_count()}


@router.get("/alerts/paused")
async def paused_namespaces():
    """List namespaces paused by alert actions."""
    return {"paused": list(alert_engine.paused_namespaces)}


@router.post("/alerts/resume/{namespace}")
async def resume_namespace(namespace: str):
    """Resume a paused namespace."""
    alert_engine.paused_namespaces.discard(namespace)
    return {"ok": True, "paused": list(alert_engine.paused_namespaces)}


@router.get("/alerts/metrics")
async def available_metrics():
    """List available metrics for alert rules."""
    return {
        "metrics": [
            {"id": "error_rate", "label": "Error Rate", "unit": "%", "description": "Percentage of failed tasks"},
            {"id": "daily_cost", "label": "Cost", "unit": "$", "description": "Total cost in the time window"},
            {"id": "p95_latency", "label": "P95 Latency", "unit": "ms", "description": "95th percentile task duration"},
            {"id": "throughput", "label": "Throughput", "unit": "tasks", "description": "Number of tasks in the window"},
            {"id": "circuit_open", "label": "Circuit Breaker", "unit": "events", "description": "Number of circuit breaker opens"},
            {"id": "injection_detected", "label": "Injection Detected", "unit": "events", "description": "Prompt injection attempts"},
            {"id": "budget_used_pct", "label": "Budget Used", "unit": "%", "description": "Percentage of budget consumed"},
        ]
    }
