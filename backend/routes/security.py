"""Constitution, egress, host access, vault, security settings and posture."""
from __future__ import annotations
import os
import json
import asyncio
import time

from fastapi import APIRouter, HTTPException, Query, Header, UploadFile, File, Body
from fastapi.responses import StreamingResponse
from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType

from config import ns, llm_config, settings, litellm_kwargs, save_json, load_json, \
    LLM_CONFIG_PATH, SETTINGS_PATH, EGRESS_CONFIG_PATH, DATA_DIR, DEFAULT_SETTINGS, is_docker
from task_store import save_task as _persist_task, load_all_tasks as _load_persisted_tasks
from pydantic import BaseModel
from models import LLMConfigIn, ConstitutionBody, WebhookBody, SpawnAgentRequest, SettingsIn
from stores import audit_collector

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


# In-memory egress state (mutable container to survive module-level issues)
_egress_state = {"enabled": False}

# ── Constitution ─────────────────────────────────────────────────────────────

@router.get("/constitution")
async def get_constitution():
    k = _require()
    c = k._engine._constitution
    return {
        "rules": c.user_rules if hasattr(c, 'user_rules') else c.rules,
        "meta_rules": c.meta_rules if hasattr(c, 'meta_rules') else [],
        "effective": c.render() if hasattr(c, 'render') else c.rules,
    }


@router.post("/constitution")
async def update_constitution(body: ConstitutionBody):
    k = _require()
    k._engine._constitution.update_rules(body.rules)
    # Propagate dynamic layers only (meta + user) to agent runtime
    k._engine._llm._custom_agent_rules = k._engine._constitution.render_dynamic_rules()
    return {"rules": body.rules, "updated": True}


# ── Egress ───────────────────────────────────────────────────────────────────

def _get_egress():
    if kernel and kernel._engine._orchestrator.sandbox:
        return kernel._engine._orchestrator.sandbox._network
    return None


# Per-tenant egress config (domains allowed per namespace)
_tenant_egress: dict[str, set[str]] = {}


def _get_tenant_egress(tenant_ns: str) -> set[str]:
    if tenant_ns not in _tenant_egress:
        cfg = load_json(DATA_DIR / f"egress_{tenant_ns}.json", {"allowed_domains": []})
        _tenant_egress[tenant_ns] = set(cfg.get("allowed_domains", []))
    return _tenant_egress[tenant_ns]


def _save_tenant_egress(tenant_ns: str) -> None:
    save_json(DATA_DIR / f"egress_{tenant_ns}.json", {"allowed_domains": list(_tenant_egress.get(tenant_ns, set()))})


@router.get("/egress")
async def get_egress(x_tenant_id: str = Header(default="")):
    net = _get_egress()
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    return {"enabled": _egress_state["enabled"], "allowed_domains": list(tenant_domains)}


@router.post("/egress/toggle")
async def toggle_egress(enabled: bool = Query(None)):
    if enabled is None:
        enabled = not _egress_state["enabled"]
    _egress_state["enabled"] = enabled
    net = _get_egress()
    if net: net._enabled = enabled
    save_json(EGRESS_CONFIG_PATH, {"enabled": enabled})
    # Push config to orchestrator for egress guard
    if kernel:
        orch = kernel._engine._orchestrator
        if not hasattr(orch, '_egress_config'):
            orch._egress_config = {}
        orch._egress_config["enabled"] = enabled
    return {"enabled": _egress_state["enabled"]}


@router.post("/egress/allow")
async def allow_domain(domain: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    tenant_domains.add(domain)
    _tenant_egress[tenant_ns] = tenant_domains
    net = _get_egress()
    if net: net._global_allowed = getattr(net, "_global_allowed", set()) | {domain}
    _save_tenant_egress(tenant_ns)
    # Push to orchestrator
    if kernel:
        orch = kernel._engine._orchestrator
        if not hasattr(orch, '_egress_config'):
            orch._egress_config = {}
        orch._egress_config["allowed_domains"] = list(tenant_domains)
    return {"domain": domain}


@router.delete("/egress/allow")
async def remove_domain(domain: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    tenant_domains = _get_tenant_egress(tenant_ns)
    tenant_domains.discard(domain)
    _tenant_egress[tenant_ns] = tenant_domains
    _save_tenant_egress(tenant_ns)
    if kernel:
        orch = kernel._engine._orchestrator
        if not hasattr(orch, '_egress_config'):
            orch._egress_config = {}
        orch._egress_config["allowed_domains"] = list(tenant_domains)
    return {"removed": domain}


# ── Host Access ──────────────────────────────────────────────────────────────

def _get_host_guard(tenant_ns: str = "default"):
    if kernel and kernel._engine._orchestrator.sandbox:
        return kernel._engine._orchestrator._get_host_guard(kernel._engine._orchestrator.sandbox, tenant_ns)
    return None


@router.get("/host")
async def get_host_access(x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    g = _get_host_guard(tenant_ns)
    approved = list(getattr(g, "_approved", getattr(g, "approved", []))) if g else []
    # Aggregate pending from ALL namespace guards (agent runs use sub-namespaces)
    pending = []
    if kernel:
        orch = kernel._engine._orchestrator
        for guard_ns, guard in getattr(orch, '_host_guards', {}).items():
            if guard_ns.startswith(tenant_ns):
                for key in list(getattr(guard, "_pending", {}).keys()):
                    parts = key.split(":", 1)
                    pattern = parts[1] if len(parts) > 1 else parts[0]
                    pending.append({"pattern": pattern, "key": key, "namespace": guard_ns})
    return {"approved": approved, "pending": pending}


@router.post("/host/approve")
async def approve_host(pattern: str = Query(...), guard_ns: str = Query(None), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    if pattern == "*": raise HTTPException(400, "Wildcard not allowed")
    # Try to find the guard with the pending request (might be in a sub-namespace)
    approved = False
    if kernel and guard_ns:
        orch = kernel._engine._orchestrator
        g = getattr(orch, '_host_guards', {}).get(guard_ns)
        if g and hasattr(g, "approve_access"):
            g.approve_access(guard_ns, pattern)
            approved = True
    if not approved:
        # Fallback: try all guards that match the tenant
        if kernel:
            orch = kernel._engine._orchestrator
            for gns, guard in getattr(orch, '_host_guards', {}).items():
                if gns.startswith(tenant_ns) and hasattr(guard, "_pending"):
                    for key in list(guard._pending.keys()):
                        if pattern in key:
                            guard.approve_access(gns, pattern)
                            approved = True
                            break
                if approved: break
    if not approved:
        g = _get_host_guard(tenant_ns)
        if not g: raise HTTPException(503, "No host guard")
        if hasattr(g, "approve_access"):
            g.approve_access(tenant_ns, pattern)
        else:
            g._approved.append(pattern)
    save_json(DATA_DIR / f"host_config_{tenant_ns}.json", {"approved": list(getattr(g, "_approved", getattr(g, "approved", [])))})
    return {"approved": pattern}


@router.delete("/host/approve")
async def revoke_host(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    g = _get_host_guard(ns(x_tenant_id))
    if g:
        approved = getattr(g, "_approved", getattr(g, "approved", []))
        for i, p in enumerate(approved):
            if p == pattern:
                approved.pop(i)
                break
    return {"revoked": pattern}


@router.post("/host/deny")
async def deny_host(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    tenant_ns = ns(x_tenant_id)
    g = _get_host_guard(tenant_ns)
    if g and hasattr(g, "deny_access"):
        g.deny_access(tenant_ns, pattern)
    return {"denied": pattern}


@router.post("/host/block-safe")
async def block_safe_pattern(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    """Remove a pattern from safe (auto-allowed) list and add to blocked."""
    g = _get_host_guard(ns(x_tenant_id))
    if not g:
        raise HTTPException(503, "No host guard")
    # Remove from safe/always_allowed
    always = getattr(g, '_always_allowed', [])
    if isinstance(always, list):
        try: always.remove(pattern)
        except ValueError: pass
    elif isinstance(always, set):
        always.discard(pattern)
    # Add to blocked
    blocked = getattr(g, '_blocked', getattr(g, '_denied', []))
    if isinstance(blocked, list) and pattern not in blocked:
        blocked.append(pattern)
    elif isinstance(blocked, set):
        blocked.add(pattern)
    audit_collector.emit("host", "safe_pattern_blocked", {"pattern": pattern})
    return {"blocked": pattern}


@router.post("/host/unblock")
async def unblock_pattern(pattern: str = Query(...), x_tenant_id: str = Header(default="")):
    """Remove a pattern from blocked list."""
    g = _get_host_guard(ns(x_tenant_id))
    if not g:
        raise HTTPException(503, "No host guard")
    blocked = getattr(g, '_blocked', getattr(g, '_denied', []))
    if isinstance(blocked, list):
        try: blocked.remove(pattern)
        except ValueError: pass
    elif isinstance(blocked, set):
        blocked.discard(pattern)
    audit_collector.emit("host", "pattern_unblocked", {"pattern": pattern})
    return {"unblocked": pattern}


# ── Vault (Secrets Management) ──────────────────────────────────────────────

@router.get("/vault/secrets")
async def list_vault_secrets(x_tenant_id: str = Header(default="")):
    k = _require()
    orch = k._engine._orchestrator
    v = getattr(orch.sandbox, '_vault', None) if hasattr(orch, 'sandbox') and orch.sandbox else None
    if not v:
        return {"keys": []}
    keys = await v.list_keys(ns(x_tenant_id) or "default")
    return {"keys": keys}

@router.post("/vault/secrets")
async def add_vault_secret(body: dict, x_tenant_id: str = Header(default="")):
    k = _require()
    orch = k._engine._orchestrator
    v = getattr(orch.sandbox, '_vault', None) if hasattr(orch, 'sandbox') and orch.sandbox else None
    if not v:
        raise HTTPException(503, "Vault not available")
    key = body.get("key", "").strip()
    value = body.get("value", "")
    if not key:
        raise HTTPException(400, "Key required")
    await v.set_secret(ns(x_tenant_id) or "default", key, value)
    audit_collector.emit("vault", "secret_added", {"key": key})
    return {"key": key, "added": True}

@router.delete("/vault/secrets")
async def delete_vault_secret(key: str = Query(...), x_tenant_id: str = Header(default="")):
    k = _require()
    orch = k._engine._orchestrator
    v = getattr(orch.sandbox, '_vault', None) if hasattr(orch, 'sandbox') and orch.sandbox else None
    if not v:
        raise HTTPException(503, "Vault not available")
    await v.delete_secret(ns(x_tenant_id) or "default", key)
    audit_collector.emit("vault", "secret_deleted", {"key": key})
    return {"key": key, "deleted": True}


# ── Security Settings ───────────────────────────────────────────────────────

@router.post("/security/settings")
async def update_security_settings(body: dict):
    """Update security settings (code safety, host access, sandbox limits)."""
    k = _require()
    orch = k._engine._orchestrator
    result = {}

    # Code safety: reject_dangerous
    if "reject_dangerous" in body:
        val = bool(body["reject_dangerous"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v:
                v.reject_dangerous = val
                result["reject_dangerous"] = val

    # Code safety: auto_fix
    if "auto_fix" in body:
        val = bool(body["auto_fix"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v:
                v.auto_fix_enabled = val
                result["auto_fix"] = val

    # Host: auto_approve
    if "auto_approve" in body:
        val = bool(body["auto_approve"])
        hg = getattr(orch, '_host_guard', None) or getattr(orch, 'host_guard', None)
        if hg:
            hg._auto_approve = val
            result["auto_approve"] = val

    # Sandbox: timeout, max_ram
    if "sandbox_timeout" in body:
        val = int(body["sandbox_timeout"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            orch.sandbox._timeout = val
            result["sandbox_timeout"] = val

    if "sandbox_max_ram" in body:
        val = int(body["sandbox_max_ram"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            orch.sandbox._max_ram_mb = val
            result["sandbox_max_ram"] = val

    # Code safety: toggle individual patterns
    if "disable_pattern" in body:
        name = str(body["disable_pattern"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v and hasattr(v, 'disable_pattern'):
                v.disable_pattern(name)
                result["disabled_pattern"] = name

    if "enable_pattern" in body:
        name = str(body["enable_pattern"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            v = getattr(orch.sandbox, '_validator', None)
            if v and hasattr(v, 'enable_pattern'):
                v.enable_pattern(name)
                result["enabled_pattern"] = name

    # DLP: toggle individual patterns
    if "disable_dlp_pattern" in body:
        name = str(body["disable_dlp_pattern"])
        if not hasattr(k, '_disabled_dlp_patterns'):
            k._disabled_dlp_patterns = set()
        k._disabled_dlp_patterns.add(name)
        result["disabled_dlp_pattern"] = name

    if "enable_dlp_pattern" in body:
        name = str(body["enable_dlp_pattern"])
        if hasattr(k, '_disabled_dlp_patterns'):
            k._disabled_dlp_patterns.discard(name)
        result["enabled_dlp_pattern"] = name

    # Sandbox: network mode
    if "sandbox_network" in body:
        val = bool(body["sandbox_network"])
        if hasattr(orch, 'sandbox') and orch.sandbox:
            backend = getattr(orch.sandbox, '_backend', None)
            if backend and hasattr(backend, '_network_mode'):
                backend._network_mode = "bridge" if val else "none"
                result["sandbox_network"] = val
            ng = getattr(orch.sandbox, '_network', None)
            if ng and hasattr(ng, '_enabled'):
                # Sync network guard with sandbox network mode
                pass

    audit_collector.emit("security", "settings_changed", result)
    return {"updated": result}


# ── Security Posture & Audit ────────────────────────────────────────────────

@router.get("/security/posture")
async def security_posture(x_tenant_id: str = Header(default="")):
    k = _require()
    namespace = ns(x_tenant_id)
    orch = k._engine._orchestrator

    # Egress
    _eg_ns = ns(x_tenant_id)
    _eg_domains = list(_get_tenant_egress(_eg_ns))
    egress_data = {"enabled": _egress_state["enabled"], "allowed_domains": _eg_domains, "pending_count": 0}

    # Host
    host_data = {"approved_count": 0, "pending_count": 0, "blocked_count": 0, "auto_approve": False,
                 "approved_patterns": [], "blocked_patterns": [], "safe_patterns": []}
    hg = getattr(orch, '_host_guards', {}).get(namespace) or getattr(orch, '_host_guards', {}).get("default")
    if not hg and hasattr(orch, 'sandbox'):
        hg = getattr(orch.sandbox, '_host_guard', None)
    if hg:
        host_data["approved_patterns"] = list(getattr(hg, '_approved', []))
        host_data["approved_count"] = len(host_data["approved_patterns"])
        host_data["blocked_patterns"] = list(getattr(hg, '_blocked', []))
        host_data["blocked_count"] = len(host_data["blocked_patterns"])
        host_data["safe_patterns"] = list(getattr(hg, '_always_allowed', []))
        host_data["auto_approve"] = getattr(hg, '_auto_approve', False)
        pending = getattr(hg, '_pending', {})
        host_data["pending_count"] = len(pending)

    # Validator
    validator_data = {"reject_dangerous": True, "auto_fix": True, "disabled_patterns": []}
    if hasattr(orch, 'sandbox') and orch.sandbox:
        v = getattr(orch.sandbox, '_validator', None)
        if v:
            validator_data["reject_dangerous"] = getattr(v, 'reject_dangerous', True)
            validator_data["auto_fix"] = getattr(v, 'auto_fix_enabled', True)
            validator_data["disabled_patterns"] = list(getattr(v, '_disabled_patterns', set()))

    # Sandbox limits
    sandbox_data = {"timeout": 60, "max_ram_mb": 512, "network_enabled": True}
    if hasattr(orch, 'sandbox') and orch.sandbox:
        sandbox_data["timeout"] = getattr(orch.sandbox, '_timeout', 60)
        sandbox_data["max_ram_mb"] = getattr(orch.sandbox, '_max_ram_mb', 512)
        backend = getattr(orch.sandbox, '_backend', None)
        if backend:
            sandbox_data["network_enabled"] = getattr(backend, '_network_mode', 'none') != 'none'

    # Constitution
    const_data = {"rules_count": 0, "has_custom_rules": False, "rules": "", "effective": "", "active_templates": []}
    if hasattr(k._engine, '_constitution') and k._engine._constitution:
        c = k._engine._constitution
        rules = getattr(c, '_user_rules', '') or getattr(c, '_rules', '') or ''
        const_data["rules"] = rules
        const_data["rules_count"] = len([l for l in rules.split('\n') if l.strip()]) if rules else 0
        const_data["has_custom_rules"] = bool(rules.strip())
        const_data["effective"] = getattr(c, 'render', lambda: rules)() if hasattr(c, 'render') else rules
        # Detect active templates by header markers
        _TPL_IDS = {"Safety First": "safety", "Privacy & Data": "privacy", "Code Quality": "quality", "Web Safety": "web", "French Output": "language", "Concise Mode": "concise", "Always Plan": "planning", "Workspace Hygiene": "workspace"}
        const_data["active_templates"] = [tid for label, tid in _TPL_IDS.items() if f"## {label}" in rules]

    # Vault
    vault_data = {"secret_count": 0}
    if hasattr(orch, 'sandbox') and orch.sandbox:
        v = getattr(orch.sandbox, '_vault', None)
        if v:
            # Try to count secrets across known namespaces
            try:
                keys = getattr(v, 'list_keys', lambda ns: [])(namespace)
                if asyncio.iscoroutine(keys): keys = await keys
                vault_data["secret_count"] = len(keys) if keys else 0
            except: pass

    return {
        "egress": egress_data,
        "host": host_data,
        "validator": validator_data,
        "sandbox": sandbox_data,
        "constitution": const_data,
        "vault": vault_data,
        "dlp": {"patterns_count": 14, "enabled": True, "disabled_patterns": list(getattr(k, '_disabled_dlp_patterns', set()))},
    }


@router.get("/security/audit")
async def security_audit(x_tenant_id: str = Header(default=""), limit: int = 200):
    security_types = {"host_denied", "host_approved", "egress_blocked", "egress_approved",
                      "code_rejected", "code_validated", "secret_detected", "dlp_scan",
                      "approval_granted", "approval_denied", "sandbox_blocked"}
    security_sources = {"sandbox", "validator", "host", "egress", "workspace", "dlp"}

    all_events = audit_collector.get_recent(limit=500)
    # Filter events that are security-relevant (by source or type)
    filtered = [e for e in all_events if e.get("source", "") in security_sources or e.get("type", "") in security_types][:limit]

    # Compute stats
    blocked = sum(1 for e in filtered if any(w in e.get("type", "") for w in ("denied", "rejected", "blocked")))
    approved = sum(1 for e in filtered if any(w in e.get("type", "") for w in ("approved", "granted")))
    secrets = sum(1 for e in filtered if "secret" in e.get("type", "") or "dlp" in e.get("type", ""))

    return {
        "events": filtered,
        "stats": {"total": len(filtered), "blocked": blocked, "approved": approved, "secrets_detected": secrets}
    }
