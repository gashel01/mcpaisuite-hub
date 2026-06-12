"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { useTenant } from "@/context/tenant";
import { usePolling } from "@/hooks/usePolling";
import type { SecurityPosture as SecurityPostureData, SecurityAuditEvent } from "@/components/security/types";

interface AuditStats { total: number; blocked: number; approved: number; secrets_detected: number; }

/**
 * All Security data + actions: posture/audit/vault/host state, the 60s + 3s host polls,
 * the live-audit SSE stream, and the optimistic mutation handlers. Extracted from the
 * Security page so the (still large) page is presentation-only.
 */
export function useSecurity() {
  const { tenant } = useTenant();

  const [posture, setPosture] = useState<SecurityPostureData | null>(null);
  const [events, setEvents] = useState<SecurityAuditEvent[]>([]);
  const [stats, setStats] = useState<AuditStats>({ total: 0, blocked: 0, approved: 0, secrets_detected: 0 });
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<SecurityAuditEvent[]>([]);
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [hostPending, setHostPending] = useState<{ pattern: string; namespace?: string }[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        apiFetch<any>("/security/posture", { tenant }).catch(() => null),
        apiFetch<any>("/security/audit", { tenant }).catch(() => null),
      ]);
      if (p) setPosture(p);
      if (a) { setEvents(a.events ?? []); setStats(a.stats ?? { total: 0, blocked: 0, approved: 0, secrets_detected: 0 }); }
      // Vault + Host pending
      apiFetch<any>("/vault/secrets", { tenant }).then(d => { if (d) setVaultKeys(d.keys || []); }).catch(() => {});
      apiFetch<any>("/host", { tenant }).then(d => { if (d) setHostPending(d.pending || []); }).catch(() => {});
    } catch {} finally { setLoading(false); }
  }, [tenant]);

  // Manual refresh button: spin while fetching, then keep spinning 600ms more so a fast
  // (localhost) response still gives visible feedback instead of an imperceptible flash.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await fetchData();
    setTimeout(() => setRefreshing(false), 600);
  }, [fetchData, refreshing]);

  // Initial load + 60s refresh (pauses while the tab is hidden).
  usePolling(fetchData, 60_000, [tenant]);
  // Fast poll for host pending (agents block for max 30s waiting for approval). Tenant-reactive
  // (previously a setInterval with stale tenant headers from `[]` deps).
  usePolling(() => {
    apiFetch<any>("/host", { tenant }).then(d => { if (d) setHostPending(d.pending || []); }).catch(() => {});
  }, 3000, [tenant]);

  // SSE live events — only connect when page is visible, close on hide
  useEffect(() => {
    let es: EventSource | null = null;
    const connect = () => {
      if (es) return;
      es = new EventSource(apiUrl("/audit/stream"));
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const raw = JSON.parse(e.data);
          if (raw.type === "ping" || raw.type === "connected") return;
          const sec = ["sandbox", "validator", "host", "egress", "workspace", "dlp", "alerting"];
          if (!sec.some(s => (raw.source || "").includes(s) || (raw.type || "").includes("block") || (raw.type || "").includes("secret") || (raw.type || "").includes("inject"))) return;
          setLiveEvents(prev => [...prev.slice(-50), { id: raw.id || Date.now(), ts: raw.ts || Date.now() / 1000, source: raw.source || "", type: raw.type || "", detail: raw.detail || "", data: raw.data || {} }]);
        } catch {}
      };
    };
    const disconnect = () => { if (es) { es.close(); es = null; esRef.current = null; } };
    const onVisibility = () => { document.hidden ? disconnect() : connect(); };
    if (!document.hidden) connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  // Actions — optimistic updates + backend calls
  const toggleEgress = async () => {
    const next = !(posture?.egress?.enabled);
    setPosture(p => p ? { ...p, egress: { ...p.egress, enabled: next } } : p);
    await apiFetch("/egress/toggle", { method: "POST", tenant });
    fetchData();
  };
  const addDomain = async (domain: string) => {
    setPosture(p => p ? { ...p, egress: { ...p.egress, allowed_domains: [...(p.egress?.allowed_domains || []), domain] } } : p);
    await apiFetch(`/egress/allow?domain=${encodeURIComponent(domain)}`, { method: "POST", tenant });
    fetchData();
  };
  const removeDomain = async (domain: string) => {
    setPosture(p => p ? { ...p, egress: { ...p.egress, allowed_domains: (p.egress?.allowed_domains || []).filter((d: string) => d !== domain) } } : p);
    await apiFetch(`/egress/allow?domain=${encodeURIComponent(domain)}`, { method: "DELETE", tenant });
    fetchData();
  };
  const approvePattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, approved_patterns: [...(p.host?.approved_patterns || []), pattern], pending_count: Math.max(0, (p.host?.pending_count || 0) - 1) } } : p);
    await apiFetch(`/host/approve?pattern=${encodeURIComponent(pattern)}`, { method: "POST", tenant });
    fetchData();
  };
  const approvePending = async (pattern: string, guardNs?: string) => {
    await apiFetch(`/host/approve?pattern=${encodeURIComponent(pattern)}${guardNs ? `&guard_ns=${encodeURIComponent(guardNs)}` : ""}`, { method: "POST", tenant });
    setHostPending(prev => prev.filter(p => p.pattern !== pattern));
    fetchData();
  };
  const denyPending = async (pattern: string, guardNs?: string) => {
    await apiFetch(`/host/deny?pattern=${encodeURIComponent(pattern)}`, { method: "POST", tenant });
    setHostPending(prev => prev.filter(p => p.pattern !== pattern));
  };
  const blockSafePattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, safe_patterns: (p.host?.safe_patterns || []).filter((x: string) => x !== pattern), blocked_patterns: [...(p.host?.blocked_patterns || []), pattern] } } : p);
    await apiFetch(`/host/block-safe?pattern=${encodeURIComponent(pattern)}`, { method: "POST", tenant });
    fetchData();
  };
  const unblockPattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, blocked_patterns: (p.host?.blocked_patterns || []).filter((x: string) => x !== pattern) } } : p);
    await apiFetch(`/host/unblock?pattern=${encodeURIComponent(pattern)}`, { method: "POST", tenant });
    fetchData();
  };
  const denyPattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, approved_patterns: (p.host?.approved_patterns || []).filter((x: string) => x !== pattern), blocked_patterns: [...(p.host?.blocked_patterns || []), pattern] } } : p);
    await apiFetch(`/host/deny?pattern=${encodeURIComponent(pattern)}`, { method: "POST", tenant });
    fetchData();
  };
  const addSecret = async (key: string, value: string) => {
    setVaultKeys(prev => [...prev, key]);
    await apiFetch("/vault/secrets", { method: "POST", tenant, body: { key, value } });
    fetchData();
  };
  const deleteSecret = async (key: string) => {
    setVaultKeys(prev => prev.filter(k => k !== key));
    await apiFetch(`/vault/secrets?key=${encodeURIComponent(key)}`, { method: "DELETE", tenant });
    fetchData();
  };
  const toggleDLPPattern = async (name: string, disable: boolean) => {
    setPosture(p => p ? { ...p, dlp: { ...p.dlp, disabled_patterns: disable ? [...(p.dlp?.disabled_patterns || []), name] : (p.dlp?.disabled_patterns || []).filter((x: string) => x !== name) } } : p);
    await apiFetch("/security/settings", {
      method: "POST", tenant,
      body: disable ? { disable_dlp_pattern: name } : { enable_dlp_pattern: name },
    });
    fetchData();
  };
  const toggleCodePattern = async (name: string, disable: boolean) => {
    setPosture(p => p ? { ...p, validator: { ...p.validator, disabled_patterns: disable ? [...(p.validator?.disabled_patterns || []), name] : (p.validator?.disabled_patterns || []).filter((x: string) => x !== name) } } : p);
    await apiFetch("/security/settings", {
      method: "POST", tenant,
      body: disable ? { disable_pattern: name } : { enable_pattern: name },
    });
    fetchData();
  };
  const toggleCodeSafety = async (key: string) => {
    const next = !(posture?.validator as any)?.[key];
    setPosture(p => p ? { ...p, validator: { ...p.validator, [key]: next } } : p);
    await apiFetch("/security/settings", { method: "POST", tenant, body: { [key]: next } });
    fetchData();
  };
  const saveConstitution = async (rules: string) => {
    await apiFetch("/constitution", { method: "POST", tenant, body: { rules } });
    fetchData();
  };

  return {
    posture, events, stats, loading, liveEvents, vaultKeys, hostPending,
    fetchData, refresh, refreshing,
    toggleEgress, addDomain, removeDomain, approvePattern, approvePending, denyPending,
    blockSafePattern, unblockPattern, denyPattern, addSecret, deleteSecret,
    toggleDLPPattern, toggleCodePattern, toggleCodeSafety, saveConstitution,
  };
}
