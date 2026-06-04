"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff,
  RefreshCw, Lock, Unlock, Eye, EyeOff,
  Globe, Terminal, Code2, KeyRound, FileWarning, ScrollText,
  AlertTriangle, CheckCircle2, XCircle, Radio,
  ChevronRight, Plus, X, Trash2, ToggleLeft, ToggleRight, Menu,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import type { SecurityPosture as SecurityPostureData, SecurityAuditEvent } from "@/components/security/types";


// ── Color utils ─────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500", ring: "#10b981", glow: "shadow-emerald-500/20" };
  if (s >= 50) return { text: "text-amber-400", bg: "bg-amber-500", ring: "#f59e0b", glow: "shadow-amber-500/20" };
  return { text: "text-red-400", bg: "bg-red-500", ring: "#ef4444", glow: "shadow-red-500/20" };
}

function categoryScore(posture: SecurityPostureData | null, cat: string): number {
  if (!posture) return 0;
  switch (cat) {
    case "network": return posture.egress?.enabled ? 100 : 30;
    case "host": return posture.host?.auto_approve ? 40 : (posture.host?.pending_count > 0 ? 60 : 100);
    case "code": {
      let s = 50;
      if (posture.validator?.reject_dangerous) s += 25;
      if (posture.validator?.auto_fix) s += 25;
      // Each disabled pattern reduces score (9 total patterns)
      const disabled = posture.validator?.disabled_patterns?.length || 0;
      if (disabled > 0) s = Math.max(20, s - disabled * 8);
      return s;
    }
    case "dlp": {
      if (posture.dlp?.enabled === false) return 20;
      const dlpDisabled = posture.dlp?.disabled_patterns?.length || 0;
      return dlpDisabled > 0 ? Math.max(30, 100 - dlpDisabled * 5) : 100;
    }
    case "governance": {
      const activeTemplates = (posture?.constitution?.active_templates || []).length;
      const hasCustom = (posture?.constitution?.rules || "").trim().length > 0;
      if (activeTemplates >= 3 && hasCustom) return 100;
      if (activeTemplates >= 2) return 80;
      if (activeTemplates >= 1 || hasCustom) return 60;
      return 30;
    }
    default: return 50;
  }
}

function overallScore(posture: SecurityPostureData | null): number {
  if (!posture) return 0;
  const cats = ["network", "host", "code", "dlp", "governance"];
  return Math.round(cats.reduce((sum, c) => sum + categoryScore(posture, c), 0) / cats.length);
}

// ── Interfaces ──────────────────────────────────────────────────────────

interface AuditStats { total: number; blocked: number; approved: number; secrets_detected: number; }

// ── Main Page ───────────────────────────────────────────────────────────

export default function SecurityPage() {
  const BASE = getApiUrl();
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  const [posture, setPosture] = useState<SecurityPostureData | null>(null);
  const [events, setEvents] = useState<SecurityAuditEvent[]>([]);
  const [stats, setStats] = useState<AuditStats>({ total: 0, blocked: 0, approved: 0, secrets_detected: 0 });
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<SecurityAuditEvent[]>([]);
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [hostPending, setHostPending] = useState<{ pattern: string; namespace?: string }[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const { isMobile, isDesktop } = useBreakpoint();

  // Fetch
  const fetchData = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        fetch(`${BASE}/security/posture`, { headers: th }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/security/audit`, { headers: th }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (p) setPosture(p);
      if (a) { setEvents(a.events ?? []); setStats(a.stats ?? { total: 0, blocked: 0, approved: 0, secrets_detected: 0 }); }
      // Vault + Host pending
      fetch(`${BASE}/vault/secrets`, { headers: th }).then(r => r.ok ? r.json() : null).then(d => { if (d) setVaultKeys(d.keys || []); }).catch(() => {});
      fetch(`${BASE}/host`, { headers: th }).then(r => r.ok ? r.json() : null).then(d => { if (d) setHostPending(d.pending || []); }).catch(() => {});
    } catch {} finally { setLoading(false); }
  }, [tenant]); // eslint-disable-line

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 60000); return () => clearInterval(i); }, [fetchData]);
  // Fast poll for host pending (agents block for max 30s waiting for approval)
  useEffect(() => {
    const i = setInterval(() => {
      fetch(`${BASE}/host`, { headers: th }).then(r => r.ok ? r.json() : null).then(d => { if (d) setHostPending(d.pending || []); }).catch(() => {});
    }, 3000);
    return () => clearInterval(i);
  }, []);

  // SSE live events — only connect when page is visible, close on hide
  useEffect(() => {
    let es: EventSource | null = null;
    const connect = () => {
      if (es) return;
      es = new EventSource(`${BASE}/audit/stream`);
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

  const score = overallScore(posture);
  const sc = scoreColor(score);
  const categories = [
    { id: "network", label: "Network", icon: Globe, desc: "Egress control & domain whitelist", score: categoryScore(posture, "network") },
    { id: "host", label: "Host Access", icon: Terminal, desc: "Command approval & blocking", score: categoryScore(posture, "host") },
    { id: "code", label: "Code Safety", icon: Code2, desc: "AST validation & dangerous patterns", score: categoryScore(posture, "code") },
    { id: "dlp", label: "Secret Detection", icon: KeyRound, desc: "DLP patterns & vault management", score: categoryScore(posture, "dlp") },
    { id: "governance", label: "Governance", icon: ScrollText, desc: "Constitution & safety rules", score: categoryScore(posture, "governance") },
  ];

  // Actions
  // Actions — optimistic updates + backend calls
  const toggleEgress = async () => {
    const next = !(posture?.egress?.enabled);
    setPosture(p => p ? { ...p, egress: { ...p.egress, enabled: next } } : p);
    await fetch(`${BASE}/egress/toggle`, { method: "POST", headers: th });
    fetchData();
  };
  const addDomain = async (domain: string) => {
    setPosture(p => p ? { ...p, egress: { ...p.egress, allowed_domains: [...(p.egress?.allowed_domains || []), domain] } } : p);
    await fetch(`${BASE}/egress/allow?domain=${encodeURIComponent(domain)}`, { method: "POST", headers: th });
    fetchData();
  };
  const removeDomain = async (domain: string) => {
    setPosture(p => p ? { ...p, egress: { ...p.egress, allowed_domains: (p.egress?.allowed_domains || []).filter((d: string) => d !== domain) } } : p);
    await fetch(`${BASE}/egress/allow?domain=${encodeURIComponent(domain)}`, { method: "DELETE", headers: th });
    fetchData();
  };
  const approvePattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, approved_patterns: [...(p.host?.approved_patterns || []), pattern], pending_count: Math.max(0, (p.host?.pending_count || 0) - 1) } } : p);
    await fetch(`${BASE}/host/approve?pattern=${encodeURIComponent(pattern)}`, { method: "POST", headers: th });
    fetchData();
  };
  const approvePending = async (pattern: string, guardNs?: string) => {
    await fetch(`${BASE}/host/approve?pattern=${encodeURIComponent(pattern)}${guardNs ? `&guard_ns=${encodeURIComponent(guardNs)}` : ""}`, { method: "POST", headers: th });
    setHostPending(prev => prev.filter(p => p.pattern !== pattern));
    fetchData();
  };
  const denyPending = async (pattern: string, guardNs?: string) => {
    await fetch(`${BASE}/host/deny?pattern=${encodeURIComponent(pattern)}`, { method: "POST", headers: th });
    setHostPending(prev => prev.filter(p => p.pattern !== pattern));
  };
  const blockSafePattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, safe_patterns: (p.host?.safe_patterns || []).filter((x: string) => x !== pattern), blocked_patterns: [...(p.host?.blocked_patterns || []), pattern] } } : p);
    await fetch(`${BASE}/host/block-safe?pattern=${encodeURIComponent(pattern)}`, { method: "POST", headers: th });
    fetchData();
  };
  const unblockPattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, blocked_patterns: (p.host?.blocked_patterns || []).filter((x: string) => x !== pattern) } } : p);
    await fetch(`${BASE}/host/unblock?pattern=${encodeURIComponent(pattern)}`, { method: "POST", headers: th });
    fetchData();
  };
  const denyPattern = async (pattern: string) => {
    setPosture(p => p ? { ...p, host: { ...p.host, approved_patterns: (p.host?.approved_patterns || []).filter((x: string) => x !== pattern), blocked_patterns: [...(p.host?.blocked_patterns || []), pattern] } } : p);
    await fetch(`${BASE}/host/deny?pattern=${encodeURIComponent(pattern)}`, { method: "POST", headers: th });
    fetchData();
  };
  const addSecret = async (key: string, value: string) => {
    setVaultKeys(prev => [...prev, key]);
    await fetch(`${BASE}/vault/secrets`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ key, value }) });
    fetchData();
  };
  const deleteSecret = async (key: string) => {
    setVaultKeys(prev => prev.filter(k => k !== key));
    await fetch(`${BASE}/vault/secrets?key=${encodeURIComponent(key)}`, { method: "DELETE", headers: th });
    fetchData();
  };
  const toggleDLPPattern = async (name: string, disable: boolean) => {
    setPosture(p => p ? { ...p, dlp: { ...p.dlp, disabled_patterns: disable ? [...(p.dlp?.disabled_patterns || []), name] : (p.dlp?.disabled_patterns || []).filter((x: string) => x !== name) } } : p);
    await fetch(`${BASE}/security/settings`, {
      method: "POST", headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify(disable ? { disable_dlp_pattern: name } : { enable_dlp_pattern: name }),
    });
    fetchData();
  };
  const toggleCodePattern = async (name: string, disable: boolean) => {
    // Optimistic update
    setPosture(p => p ? { ...p, validator: { ...p.validator, disabled_patterns: disable ? [...(p.validator?.disabled_patterns || []), name] : (p.validator?.disabled_patterns || []).filter((x: string) => x !== name) } } : p);
    await fetch(`${BASE}/security/settings`, {
      method: "POST", headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify(disable ? { disable_pattern: name } : { enable_pattern: name }),
    });
    fetchData();
  };
  const toggleCodeSafety = async (key: string) => {
    const next = !(posture?.validator as any)?.[key];
    setPosture(p => p ? { ...p, validator: { ...p.validator, [key]: next } } : p);
    await fetch(`${BASE}/security/settings`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ [key]: next }) });
    fetchData();
  };
  const saveConstitution = async (rules: string) => {
    await fetch(`${BASE}/constitution`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ rules }) });
    fetchData();
  };

  const pendingCount = hostPending.length;

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden bg-[#060610] relative">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 shrink-0 border-b border-white/[0.04]">
        <button
          onClick={() => {
            const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
            if (btn) btn.click();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <Shield className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Security</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Real-time monitoring, threat detection & governance</p>
        </div>
        {!isDesktop && pendingCount > 0 && (
          <button onClick={() => setInboxOpen(true)} className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 transition-all touch-target shrink-0">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>{pendingCount}</span>
          </button>
        )}
        <button onClick={fetchData} className="p-1.5 text-slate-600 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── LEFT: Main Dashboard ──────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">

        {/* Hero: Score + Status */}
        <div className="shrink-0 px-3 sm:px-5 lg:px-6 pt-2 sm:pt-4 pb-3 sm:pb-4">
          <div className="flex items-start gap-3 sm:gap-6">
            {/* Score Ring */}
            <div className="relative shrink-0">
              <svg width={isMobile ? 80 : 120} height={isMobile ? 80 : 120} viewBox="0 0 120 120" className="drop-shadow-lg">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" />
                <motion.circle
                  cx="60" cy="60" r="52" fill="none" stroke={sc.ring} strokeWidth="8"
                  strokeLinecap="round" strokeDasharray={`${score * 3.27} 327`}
                  transform="rotate(-90 60 60)"
                  initial={{ strokeDasharray: "0 327" }}
                  animate={{ strokeDasharray: `${score * 3.27} 327` }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                  className={`text-2xl sm:text-3xl font-black ${sc.text}`}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                >{score}</motion.span>
                <span className="text-[10px] sm:text-[11px] text-slate-600 -mt-1">/ 100</span>
              </div>
            </div>

            {/* Status info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Shield className={`h-4 w-4 sm:h-5 sm:w-5 ${sc.text}`} />
                <h1 className="text-sm sm:text-lg font-bold text-white truncate">Security Center</h1>
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
                  <span className="text-[10px] sm:text-[11px] text-emerald-400 font-medium">LIVE</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mb-2 sm:mb-3 hidden lg:block">Real-time monitoring & governance controls</p>

              {/* Quick stats */}
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <StatPill icon={XCircle} value={stats.blocked} label="Blocked" color="text-red-400" bg="bg-red-500/10 border-red-500/20" />
                <StatPill icon={CheckCircle2} value={stats.approved} label="Approved" color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/20" />
                <StatPill icon={KeyRound} value={stats.secrets_detected} label="Secrets" color="text-amber-400" bg="bg-amber-500/10 border-amber-500/20" compact={isMobile} />
                <StatPill icon={AlertTriangle} value={posture?.host?.pending_count || 0} label="Pending" color="text-violet-400" bg="bg-violet-500/10 border-violet-500/20" compact={isMobile} />
              </div>
            </div>
          </div>
        </div>

        {/* Category Cards */}
        <div className="shrink-0 px-3 sm:px-5 lg:px-6 pb-3 sm:pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
            {categories.map((cat, i) => {
              const cs = scoreColor(cat.score);
              const isActive = activePanel === cat.id;
              return (
                <motion.button
                  key={cat.id}
                  onClick={() => setActivePanel(isActive ? null : cat.id)}
                  className={`relative text-left p-2.5 sm:p-3 rounded-xl border transition-all group touch-target ${
                    isActive ? `border-white/[0.15] bg-white/[0.04] ${cs.glow} shadow-lg` : "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.1] hover:bg-white/[0.03]"
                  }`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                    <cat.icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isActive ? cs.text : "text-slate-500 group-hover:text-slate-300"} transition-colors`} />
                    <span className={`text-[11px] sm:text-xs font-bold truncate ${isActive ? "text-white" : "text-slate-400"}`}>{cat.label}</span>
                    <span className={`ml-auto text-[11px] sm:text-xs font-bold ${cs.text} shrink-0`}>{cat.score}</span>
                  </div>
                  <div className="w-full h-1 bg-white/[0.04] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full" style={{ backgroundColor: cs.ring }}
                      initial={{ width: 0 }} animate={{ width: `${cat.score}%` }}
                      transition={{ duration: 1, delay: 0.3 + i * 0.08 }}
                    />
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-600 mt-1 sm:mt-1.5 line-clamp-1 hidden sm:block">{cat.desc}</p>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Active Panel Content */}
        <div className="flex-1 min-h-0 px-3 sm:px-5 lg:px-6 pb-3 sm:pb-4">
          <AnimatePresence mode="wait">
            {activePanel === "network" && (
              <ControlPanel key="network" title="Network Egress Control" icon={Globe} color="cyan">
                <NetworkPanel posture={posture} onToggle={toggleEgress} onAdd={addDomain} onRemove={removeDomain} />
              </ControlPanel>
            )}
            {activePanel === "host" && (
              <ControlPanel key="host" title="Host Access Control" icon={Terminal} color="violet">
                <HostPanel posture={posture} pendingRequests={hostPending} onApprove={approvePattern} onDeny={denyPattern} onBlockSafe={blockSafePattern} onUnblock={unblockPattern} onApprovePending={approvePending} onDenyPending={denyPending} />
              </ControlPanel>
            )}
            {activePanel === "code" && (
              <ControlPanel key="code" title="Code Safety" icon={Code2} color="emerald">
                <CodePanel posture={posture} events={events} onToggle={toggleCodeSafety} onTogglePattern={toggleCodePattern} />
              </ControlPanel>
            )}
            {activePanel === "dlp" && (
              <ControlPanel key="dlp" title="Secret Detection (DLP)" icon={KeyRound} color="amber">
                <DLPPanel posture={posture} events={events} onTogglePattern={toggleDLPPattern} vaultKeys={vaultKeys} onAddSecret={addSecret} onDeleteSecret={deleteSecret} />
              </ControlPanel>
            )}
            {activePanel === "governance" && (
              <ControlPanel key="governance" title="Governance & Constitution" icon={ScrollText} color="pink">
                <GovernancePanel posture={posture} onSave={saveConstitution} />
              </ControlPanel>
            )}
            {!activePanel && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex items-center justify-center">
                <div className="text-center px-4">
                  <ShieldCheck className="h-10 w-10 sm:h-12 sm:w-12 text-slate-800 mx-auto mb-3" />
                  <p className="text-xs sm:text-sm text-slate-600">Select a security category above to view controls</p>
                  <p className="text-[11px] text-slate-700 mt-1 hidden sm:block">Click any card to expand its configuration panel</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── RIGHT: Security Inbox (desktop inline) ────────────────── */}
      {isDesktop && (
        <SecurityInbox
          events={events} liveEvents={liveEvents} hostPending={hostPending}
          onApprovePending={approvePending} onDenyPending={denyPending}
        />
      )}
      </div>{/* close flex row wrapper */}

      {/* ── Mobile/Tablet: Security Inbox bottom sheet ────────────── */}
      <AnimatePresence>
        {!isDesktop && inboxOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 mobile-overlay z-40"
              onClick={() => setInboxOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="fixed left-0 right-0 bottom-0 z-50 flex flex-col bg-[#08080f] border-t border-white/[0.08] rounded-t-2xl"
              style={{ height: "75vh" }}
            >
              <div className="flex items-center justify-center py-2 shrink-0">
                <div className="w-10 h-1 rounded-full bg-white/[0.12]" />
              </div>
              <div className="flex items-center justify-between px-4 pb-2 shrink-0">
                <span className="text-sm font-semibold text-slate-200">Security Inbox</span>
                <button onClick={() => setInboxOpen(false)} className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] touch-target">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SecurityInbox
                events={events} liveEvents={liveEvents} hostPending={hostPending}
                onApprovePending={approvePending} onDenyPending={denyPending}
                embedded
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Security Inbox (right sidebar) ──────────────────────────────────────

function SecurityInbox({ events, liveEvents, hostPending, onApprovePending, onDenyPending, embedded }: {
  events: SecurityAuditEvent[]; liveEvents: SecurityAuditEvent[];
  hostPending: { pattern: string; namespace?: string }[];
  onApprovePending: (p: string, ns?: string) => void; onDenyPending: (p: string, ns?: string) => void;
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState<"action" | "blocked" | "all">("action");

  // Categorize events
  const allEvents = [...[...liveEvents].reverse(), ...events.slice(0, 100)];
  const blocked = allEvents.filter(e => /block|denied|reject/i.test(e.type) || /block|denied/i.test(e.detail));
  const secrets = allEvents.filter(e => /secret|dlp|redact/i.test(e.type));

  // Action items = things that need human attention
  const actionItems: { type: "pending" | "blocked" | "secret"; label: string; detail: string; data: any; ts: number }[] = [];

  // Pending host approvals
  for (const p of hostPending) {
    actionItems.push({ type: "pending", label: `Host access: ${p.pattern}`, detail: "Agent waiting for approval", data: p, ts: Date.now() / 1000 });
  }

  // Recent blocks (last 20)
  for (const e of blocked.slice(0, 20)) {
    actionItems.push({ type: "blocked", label: (e.detail || e.type).slice(0, 60), detail: e.source, data: e, ts: e.ts });
  }

  // Secret detections
  for (const e of secrets.slice(0, 10)) {
    actionItems.push({ type: "secret", label: (e.detail || e.type).slice(0, 60), detail: e.source, data: e, ts: e.ts });
  }

  const filteredItems = filter === "action" ? actionItems : filter === "blocked" ? actionItems.filter(i => i.type === "blocked") : actionItems;
  const pendingCount = hostPending.length;
  const blockedCount = blocked.length;

  return (
    <div className={`${embedded ? "flex-1 min-h-0" : "w-[320px] shrink-0 border-l border-white/[0.04]"} flex flex-col bg-[#08080f]`}>
      {/* Header */}
      {!embedded && (
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-slate-200">Security Inbox</span>
          {pendingCount > 0 && <span className="h-4 min-w-[16px] flex items-center justify-center px-1 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold animate-pulse">{pendingCount}</span>}
        </div>
        {/* Filter tabs */}
        <div className="flex gap-1 p-0.5 bg-white/[0.02] rounded-lg">
          {([
            { id: "action" as const, label: "Action", count: pendingCount },
            { id: "blocked" as const, label: "Blocked", count: blockedCount },
            { id: "all" as const, label: "All", count: actionItems.length },
          ]).map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${filter === f.id ? "bg-violet-500/15 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>
              {f.label}
              {f.count > 0 && <span className={`text-[9px] ${filter === f.id ? "text-violet-400" : "text-slate-700"}`}>{f.count}</span>}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Filter tabs (embedded mode) */}
      {embedded && (
        <div className="shrink-0 px-3 pb-2">
          <div className="flex gap-1 p-0.5 bg-white/[0.02] rounded-lg">
            {([
              { id: "action" as const, label: "Action", count: pendingCount },
              { id: "blocked" as const, label: "Blocked", count: blockedCount },
              { id: "all" as const, label: "All", count: actionItems.length },
            ]).map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-md transition-all touch-target ${filter === f.id ? "bg-violet-500/15 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>
                {f.label}
                {f.count > 0 && <span className={`text-[10px] ${filter === f.id ? "text-violet-400" : "text-slate-700"}`}>{f.count}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {/* Pending approvals — always on top when in action view */}
        {(filter === "action" || filter === "all") && hostPending.map((p, i) => (
          <div key={`pending-${i}`} className="px-3 py-2.5 border-b border-amber-500/10 bg-amber-500/[0.03] animate-fade-in">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-300 font-medium flex-1 truncate">{p.pattern}</span>
              <span className="text-[9px] text-amber-500/60">now</span>
            </div>
            <p className="text-[10px] text-slate-500 mb-2 ml-5">Agent requesting host command access</p>
            <div className="flex gap-2 ml-5">
              <button onClick={() => onApprovePending(p.pattern, p.namespace)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px] font-medium transition-colors">
                Approve
              </button>
              <button onClick={() => onDenyPending(p.pattern, p.namespace)}
                className="px-3 py-1 bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white rounded-md text-[10px] font-medium transition-colors">
                Deny
              </button>
            </div>
          </div>
        ))}

        {/* Blocked / Secret events */}
        {filteredItems.filter(i => i.type !== "pending").map((item, i) => {
          const ago = Math.max(0, Math.floor(Date.now() / 1000 - (item.ts || 0)));
          const timeStr = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.floor(ago / 60)}m` : `${Math.floor(ago / 3600)}h`;
          const icon = item.type === "blocked" ? <XCircle className="h-3 w-3 text-red-400 shrink-0" /> : <KeyRound className="h-3 w-3 text-amber-400 shrink-0" />;
          const border = item.type === "blocked" ? "border-red-500/10" : "border-amber-500/10";

          return (
            <div key={`item-${i}`} className={`px-3 py-2 border-b ${border} hover:bg-white/[0.02] transition-colors`}>
              <div className="flex items-center gap-2">
                {icon}
                <span className="text-[11px] text-slate-300 flex-1 truncate">{item.label}</span>
                <span className="text-[9px] text-slate-700 shrink-0">{timeStr}</span>
              </div>
              <p className="text-[10px] text-slate-600 mt-0.5 ml-5 truncate">{item.detail}</p>
            </div>
          );
        })}

        {filteredItems.length === 0 && hostPending.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <ShieldCheck className="h-8 w-8 text-slate-800 mb-3" />
            <p className="text-xs text-slate-500">All clear</p>
            <p className="text-[10px] text-slate-700 mt-1">No actions needed right now</p>
          </div>
        )}
      </div>

      {/* Footer link to observability */}
      <div className="shrink-0 px-3 py-2 border-t border-white/[0.04]">
        <a href="/observability" className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-violet-400 transition-colors">
          <Eye className="h-3 w-3" /> View full audit log in Observability
        </a>
      </div>
    </div>
  );
}

// ── Reusable Components ─────────────────────────────────────────────────

function StatPill({ icon: Icon, value, label, color, bg, compact }: { icon: any; value: number; label: string; color: string; bg: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border ${bg}`}>
      <Icon className={`h-3 w-3 ${color}`} />
      <span className={`text-[11px] font-bold ${color}`}>{value}</span>
      {!compact && <span className="text-[11px] sm:text-xs text-slate-600 hidden sm:inline">{label}</span>}
    </div>
  );
}

function ControlPanel({ title, icon: Icon, color, children }: { title: string; icon: any; color: string; children: React.ReactNode }) {
  const colors: Record<string, string> = { cyan: "text-cyan-400", violet: "text-violet-400", emerald: "text-emerald-400", amber: "text-amber-400", pink: "text-pink-400" };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden"
    >
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04]">
        <Icon className={`h-4 w-4 ${colors[color] || "text-slate-400"}`} />
        <span className="text-xs font-semibold text-white">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </motion.div>
  );
}


// ── Panel Contents ──────────────────────────────────────────────────────

function NetworkPanel({ posture, onToggle, onAdd, onRemove }: { posture: SecurityPostureData | null; onToggle: () => void; onAdd: (d: string) => void; onRemove: (d: string) => void }) {
  const [newDomain, setNewDomain] = useState("");
  const enabled = posture?.egress?.enabled ?? false;
  const domains = posture?.egress?.allowed_domains ?? [];

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]">
        <div>
          <div className="flex items-center gap-2">
            {enabled ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <ShieldOff className="h-4 w-4 text-red-400" />}
            <span className="text-xs font-semibold text-white">Whitelist Mode</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 ml-6">{enabled ? "Only whitelisted domains can be accessed" : "All outbound traffic is allowed — not recommended"}</p>
        </div>
        <button onClick={onToggle} className={`p-1 rounded-lg transition-colors ${enabled ? "text-emerald-400" : "text-red-400"}`}>
          {enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
        </button>
      </div>

      {/* Add domain */}
      <div className="flex gap-2">
        <input
          value={newDomain} onChange={e => setNewDomain(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && newDomain.trim()) { onAdd(newDomain.trim()); setNewDomain(""); } }}
          placeholder="Add domain (e.g. api.example.com)"
          className="flex-1 px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-violet-500/30"
        />
        <button onClick={() => { if (newDomain.trim()) { onAdd(newDomain.trim()); setNewDomain(""); } }} className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium transition-colors">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Domain list */}
      <div className="space-y-1">
        <span className="text-[11px] text-slate-600 font-medium">Allowed domains ({domains.length})</span>
        {domains.length === 0 && <p className="text-[11px] text-slate-700 py-4 text-center">No domains whitelisted. Add domains above to allow outbound access.</p>}
        {domains.map((d: string) => (
          <div key={d} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] group">
            <div className="flex items-center gap-2">
              <Globe className="h-3 w-3 text-cyan-400/50" />
              <span className="text-xs text-slate-300 font-mono">{d}</span>
            </div>
            <button onClick={() => onRemove(d)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Pending requests */}
      {(posture?.egress?.pending_count ?? 0) > 0 && (
        <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <span className="text-xs text-amber-300 font-medium">{posture?.egress?.pending_count} pending egress requests</span>
          </div>
        </div>
      )}
    </div>
  );
}

function HostPanel({ posture, pendingRequests, onApprove, onDeny, onBlockSafe, onUnblock, onApprovePending, onDenyPending }: { posture: SecurityPostureData | null; pendingRequests: { pattern: string; namespace?: string }[]; onApprove: (p: string) => void; onDeny: (p: string) => void; onBlockSafe: (p: string) => void; onUnblock: (p: string) => void; onApprovePending: (p: string, ns?: string) => void; onDenyPending: (p: string, ns?: string) => void }) {
  const [newPattern, setNewPattern] = useState("");
  const approved = posture?.host?.approved_patterns ?? [];
  const pendingCount = pendingRequests.length;
  const blocked = posture?.host?.blocked_patterns ?? [];
  const safe = posture?.host?.safe_patterns ?? [];
  const [tab, setTab] = useState<"safe" | "approved" | "blocked" | "pending">(pendingCount > 0 ? "pending" : "safe");

  const tabs = [
    { id: "safe" as const, label: "Safe", count: safe.length, color: "text-cyan-400" },
    { id: "approved" as const, label: "Approved", count: approved.length, color: "text-emerald-400" },
    { id: "blocked" as const, label: "Blocked", count: blocked.length, color: "text-red-400" },
    { id: "pending" as const, label: "Pending", count: pendingCount, color: "text-amber-400" },
  ];

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/[0.02] rounded-lg border border-white/[0.04]">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium rounded-lg transition-all ${
            tab === t.id ? "bg-violet-500/15 text-violet-300" : "text-slate-600 hover:text-slate-400"
          }`}>
            {t.label}
            {t.count > 0 && <span className={`text-[10px] ${tab === t.id ? "text-violet-400" : "text-slate-700"}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Safe — pre-allowed read-only commands */}
      {tab === "safe" && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500 mb-2">Read-only commands allowed by default. Disable any you want to restrict.</p>
          {safe.length === 0 && <p className="text-xs text-slate-600 py-4 text-center">No safe patterns configured</p>}
          {safe.map((p: string) => (
            <div key={p} className="flex items-center justify-between px-3 py-2 rounded-lg bg-cyan-500/[0.03] border border-cyan-500/10 group">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-400/60" />
                <span className="text-xs text-slate-300 font-mono">{p}</span>
              </div>
              <button onClick={() => onBlockSafe(p)} className="opacity-0 group-hover:opacity-100 text-xs text-slate-600 hover:text-red-400 transition-all">Block</button>
            </div>
          ))}
        </div>
      )}

      {/* Approved — user-approved patterns */}
      {tab === "approved" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={newPattern} onChange={e => setNewPattern(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newPattern.trim()) { onApprove(newPattern.trim()); setNewPattern(""); } }}
              placeholder="Add pattern (e.g. docker *)"
              className="flex-1 px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-violet-500/30 font-mono" />
            <button onClick={() => { if (newPattern.trim()) { onApprove(newPattern.trim()); setNewPattern(""); } }} className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-medium transition-colors">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {approved.length === 0 && <p className="text-xs text-slate-600 py-4 text-center">No custom approved patterns. Add one above or approve from pending requests.</p>}
          {approved.map((p: string) => (
            <div key={p} className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/[0.03] border border-emerald-500/10 group">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/60" />
                <span className="text-xs text-slate-300 font-mono">{p}</span>
              </div>
              <button onClick={() => onDeny(p)} className="opacity-0 group-hover:opacity-100 text-xs text-slate-600 hover:text-red-400 transition-all">Revoke</button>
            </div>
          ))}
        </div>
      )}

      {/* Blocked — dangerous patterns */}
      {tab === "blocked" && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500 mb-2">Dangerous commands that are always blocked. Remove with caution.</p>
          {blocked.length === 0 && <p className="text-xs text-slate-600 py-4 text-center">No blocked patterns</p>}
          {blocked.map((p: string) => (
            <div key={p} className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/[0.03] border border-red-500/10 group">
              <div className="flex items-center gap-2.5">
                <XCircle className="h-3.5 w-3.5 text-red-400/60" />
                <span className="text-xs text-slate-400 font-mono">{p}</span>
              </div>
              <button onClick={() => onUnblock(p)} className="opacity-0 group-hover:opacity-100 text-xs text-slate-600 hover:text-emerald-400 transition-all">Allow</button>
            </div>
          ))}
        </div>
      )}

      {/* Pending */}
      {tab === "pending" && (
        <div className="space-y-2">
          {pendingRequests.length === 0 ? (
            <p className="text-xs text-slate-600 py-4 text-center">No pending requests</p>
          ) : (
            <>
              <p className="text-xs text-amber-300/70">An agent is waiting for your decision:</p>
              {pendingRequests.map((p, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] animate-pulse">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                  <code className="text-xs text-amber-300 font-mono flex-1">{p.pattern}</code>
                  <button onClick={() => onApprovePending(p.pattern, p.namespace)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors">
                    Approve
                  </button>
                  <button onClick={() => onDenyPending(p.pattern, p.namespace)}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors">
                    Deny
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CodePanel({ posture, events, onToggle, onTogglePattern }: { posture: SecurityPostureData | null; events: SecurityAuditEvent[]; onToggle: (key: string) => void; onTogglePattern: (name: string, disable: boolean) => void }) {
  const disabledPatterns = new Set<string>(posture?.validator?.disabled_patterns || []);
  const allPatterns = [
    { name: "os.system()", severity: "critical", why: "Executes shell commands with no sandboxing — allows arbitrary code execution on the host" },
    { name: "eval()", severity: "critical", why: "Evaluates arbitrary Python expressions — can execute injected malicious code" },
    { name: "exec()", severity: "critical", why: "Executes arbitrary Python code blocks — same risks as eval but for statements" },
    { name: "subprocess shell=True", severity: "high", why: "Runs shell commands via subprocess with shell expansion — vulnerable to command injection" },
    { name: "__import__()", severity: "high", why: "Dynamic module import — can load arbitrary modules to bypass restrictions" },
    { name: "pickle.loads()", severity: "high", why: "Deserializes Python objects — untrusted pickle data can execute arbitrary code" },
    { name: "shutil.rmtree()", severity: "medium", why: "Recursively deletes entire directory trees — accidental data loss risk" },
    { name: "ctypes", severity: "medium", why: "Foreign function interface — can call native C code and bypass Python safety" },
    { name: "socket.socket()", severity: "medium", why: "Creates raw network sockets — can open unauthorized network connections" },
  ];
  const patterns = allPatterns.filter(p => !disabledPatterns.has(p.name));
  const codeEvents = events.filter(e => e.source === "validator" || e.source === "sandbox").slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${posture?.validator?.reject_dangerous ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-red-500/30 bg-red-500/[0.05]"}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${posture?.validator?.reject_dangerous ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
              {posture?.validator?.reject_dangerous ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <ShieldAlert className="h-4 w-4 text-red-400" />}
            </div>
            <div className="flex-1">
              <span className="text-sm font-semibold text-white">Reject Dangerous</span>
              <p className="text-xs text-slate-400 mt-0.5">{posture?.validator?.reject_dangerous ? "Dangerous code is blocked before execution" : "Warning only — dangerous code can still run"}</p>
            </div>
            <button onClick={() => onToggle("reject_dangerous")} className="p-1 hover:bg-white/[0.05] rounded-lg transition-colors">
              {posture?.validator?.reject_dangerous ? <ToggleRight className="h-7 w-7 text-emerald-400" /> : <ToggleLeft className="h-7 w-7 text-red-400" />}
            </button>
          </div>
        </div>
        <div className={`p-4 rounded-xl border-2 transition-all ${posture?.validator?.auto_fix ? "border-cyan-500/30 bg-cyan-500/[0.05]" : "border-white/[0.08] bg-white/[0.02]"}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${posture?.validator?.auto_fix ? "bg-cyan-500/15" : "bg-white/[0.05]"}`}>
              <Code2 className={`h-4 w-4 ${posture?.validator?.auto_fix ? "text-cyan-400" : "text-slate-500"}`} />
            </div>
            <div className="flex-1">
              <span className="text-sm font-semibold text-white">Auto-Fix</span>
              <p className="text-xs text-slate-400 mt-0.5">{posture?.validator?.auto_fix ? "Missing imports and issues fixed automatically" : "No auto-correction applied"}</p>
            </div>
            <button onClick={() => onToggle("auto_fix")} className="p-1 hover:bg-white/[0.05] rounded-lg transition-colors">
              {posture?.validator?.auto_fix ? <ToggleRight className="h-7 w-7 text-cyan-400" /> : <ToggleLeft className="h-7 w-7 text-slate-600" />}
            </button>
          </div>
        </div>
      </div>

      <div>
        <span className="text-xs text-slate-500 font-medium">Blocked Patterns ({patterns.length}/{allPatterns.length} active)</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {allPatterns.map(p => {
            const disabled = disabledPatterns.has(p.name);
            return (
              <button key={p.name} onClick={() => onTogglePattern(p.name, !disabled)} data-tooltip={p.why}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-left group touch-target ${disabled ? "bg-white/[0.01] border-white/[0.03] opacity-40" : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"}`}>
                <div className={`h-2 w-2 rounded-full shrink-0 ${disabled ? "bg-slate-600" : p.severity === "critical" ? "bg-red-400" : p.severity === "high" ? "bg-amber-400" : "bg-blue-400"}`} />
                <span className={`text-xs font-mono truncate flex-1 ${disabled ? "text-slate-600 line-through" : "text-slate-300"}`}>{p.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${disabled ? "bg-white/[0.02] text-slate-700" : p.severity === "critical" ? "bg-red-500/10 text-red-400" : p.severity === "high" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}>{disabled ? "off" : p.severity}</span>
              </button>
            );
          })}
        </div>
      </div>

      {codeEvents.length > 0 && (
        <div>
          <span className="text-xs text-slate-500 font-medium">Recent Validations ({codeEvents.length})</span>
          <div className="mt-2 space-y-1">
            {codeEvents.map((e, i) => <ValidationEvent key={i} event={e} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationEvent({ event }: { event: SecurityAuditEvent }) {
  const [open, setOpen] = useState(false);
  const isFailed = /reject|block|fail/i.test(event.type) || /reject|block|fail/i.test(event.detail);
  const isFixed = /fix|auto/i.test(event.type) || /fix/i.test(event.detail);
  const dot = isFailed ? "bg-red-400" : isFixed ? "bg-amber-400" : "bg-emerald-400";
  const ts = event.ts ? new Date(event.ts * 1000) : null;

  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors">
        <div className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-xs text-slate-300 flex-1 truncate">{event.detail || event.type.replace(/_/g, " ")}</span>
        {ts && <span className="text-[10px] text-slate-700 shrink-0">{ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
        <ChevronRight className={`h-3 w-3 text-slate-700 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 ml-[18px] space-y-1 animate-fade-in border-t border-white/[0.03]">
          <div className="flex items-center gap-3 text-[10px] text-slate-600">
            <span>Type: <span className="text-slate-400">{event.type}</span></span>
            <span>Source: <span className="text-slate-400">{event.source}</span></span>
            {ts && <span>{ts.toLocaleDateString()} {ts.toLocaleTimeString()}</span>}
          </div>
          {event.detail && <p className="text-[11px] text-slate-400">{event.detail}</p>}
          {event.data && Object.keys(event.data).length > 0 && (
            <pre className="text-[10px] text-slate-600 font-mono whitespace-pre-wrap bg-black/20 rounded p-2 max-h-24 overflow-y-auto border border-white/[0.03]">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DLPPanel({ posture, events, onTogglePattern, vaultKeys, onAddSecret, onDeleteSecret }: { posture: SecurityPostureData | null; events: SecurityAuditEvent[]; onTogglePattern: (name: string, disable: boolean) => void; vaultKeys: string[]; onAddSecret: (key: string, value: string) => void; onDeleteSecret: (key: string) => void }) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const disabledPatterns = new Set<string>(posture?.dlp?.disabled_patterns || []);
  const allPatterns = [
    { name: "AWS Access Keys", icon: "🔑" }, { name: "API Tokens", icon: "🎫" }, { name: "GitHub Tokens", icon: "🐙" },
    { name: "Credit Cards", icon: "💳" }, { name: "Email Addresses", icon: "📧" }, { name: "Phone Numbers", icon: "📱" },
    { name: "Private Keys", icon: "🔐" }, { name: "JWT Tokens", icon: "🪙" }, { name: "Connection Strings", icon: "🔗" },
    { name: "OAuth Secrets", icon: "🛡" }, { name: "SSL Certificates", icon: "📜" }, { name: "Passwords", icon: "••" },
    { name: "Webhooks", icon: "🪝" }, { name: "Encryption Keys", icon: "🗝" },
  ];
  const activeCount = allPatterns.filter(p => !disabledPatterns.has(p.name)).length;
  const secretEvents = events.filter(e => /secret|dlp|redact/i.test(e.type) || /secret|dlp/i.test(e.source)).slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">Vault</span>
            <span className="text-xs text-amber-300">{vaultKeys.length} secrets</span>
          </div>
        </div>
        <div className="px-4 pb-3 space-y-2">
          {/* Clarity note: how the Vault differs from Settings → Environment Variables */}
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400/80 shrink-0 mt-0.5" />
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Vault secrets are <span className="text-slate-200">isolated to sandboxed code</span>, scoped per tenant, and audited — they are <span className="text-slate-200">never</span> exposed on <code className="text-slate-300">os.environ</code>. Use this for credentials the agents&apos; code should hold securely.
              <br />
              For general config or tokens that tools / MCP servers read as plain environment variables, use <span className="text-lime-300">Settings → Environment</span> instead.
            </p>
          </div>
          {/* Add secret */}
          <div className="flex gap-2">
            <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key (e.g. OPENAI_API_KEY)"
              className="flex-1 px-3 py-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-slate-300 placeholder:text-slate-700 font-mono focus:outline-none focus:border-amber-500/30" />
            <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value" type="password"
              className="flex-1 px-3 py-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-slate-300 placeholder:text-slate-700 font-mono focus:outline-none focus:border-amber-500/30"
              onKeyDown={e => { if (e.key === "Enter" && newKey.trim() && newValue) { onAddSecret(newKey.trim(), newValue); setNewKey(""); setNewValue(""); }}} />
            <button onClick={() => { if (newKey.trim() && newValue) { onAddSecret(newKey.trim(), newValue); setNewKey(""); setNewValue(""); }}}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium transition-colors">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Secret list */}
          {vaultKeys.length === 0 && <p className="text-xs text-slate-600 py-2 text-center">No secrets stored. Add API keys, tokens, or credentials above.</p>}
          {vaultKeys.map(k => (
            <div key={k} className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/[0.03] border border-amber-500/10 group">
              <div className="flex items-center gap-2.5">
                <Lock className="h-3.5 w-3.5 text-amber-400/60" />
                <span className="text-xs text-slate-300 font-mono">{k}</span>
                <span className="text-[10px] text-slate-700">••••••••</span>
              </div>
              <button onClick={() => onDeleteSecret(k)} className="opacity-0 group-hover:opacity-100 text-xs text-slate-600 hover:text-red-400 transition-all">Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs text-slate-500 font-medium">DLP Patterns ({activeCount}/{allPatterns.length} active)</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {allPatterns.map(p => {
            const disabled = disabledPatterns.has(p.name);
            return (
              <button key={p.name} onClick={() => onTogglePattern(p.name, !disabled)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all text-left touch-target ${disabled ? "bg-white/[0.01] border-white/[0.03] opacity-40" : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"}`}>
                <span className="text-sm">{p.icon}</span>
                <span className={`text-xs flex-1 ${disabled ? "text-slate-600 line-through" : "text-slate-300"}`}>{p.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${disabled ? "bg-white/[0.02] text-slate-700" : "bg-emerald-500/10 text-emerald-400"}`}>{disabled ? "Off" : "Active"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {secretEvents.length > 0 && (
        <div>
          <span className="text-[11px] text-slate-600 font-medium">Recent Detections</span>
          <div className="mt-2 space-y-1">
            {secretEvents.map((e, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-500/[0.04] border border-amber-500/10">
                <KeyRound className="h-3 w-3 text-amber-400" />
                <span className="text-xs text-slate-400 truncate">{e.detail || e.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const RULE_TEMPLATES = [
  { id: "safety", label: "Safety First", icon: "🛡", desc: "Prevent destructive actions", rules: "- Never execute destructive commands (rm -rf, drop database, format) without explicit user confirmation\n- Always create a backup/checkpoint before modifying important files\n- If unsure about a command's impact, ask the user first" },
  { id: "privacy", label: "Privacy & Data", icon: "🔒", desc: "Protect sensitive information", rules: "- Never include API keys, passwords, or tokens in output\n- Redact credit card numbers, SSNs, and personal identifiers\n- Do not send sensitive data to external services without user approval" },
  { id: "quality", label: "Code Quality", icon: "✨", desc: "Enforce coding standards", rules: "- Always add error handling to generated code\n- Include type hints in Python code\n- Write docstrings for functions with more than 3 parameters\n- Prefer async/await over threading for I/O operations" },
  { id: "web", label: "Web Safety", icon: "🌐", desc: "Safe web interactions", rules: "- Always verify URLs before fetching — reject suspicious domains\n- Prefer official documentation and trusted sources\n- Never follow redirect chains longer than 3 hops\n- Do not submit forms or POST data without user approval" },
  { id: "language", label: "French Output", icon: "🇫🇷", desc: "Respond in French", rules: "- Always respond in French\n- Use formal language (vouvoiement) unless asked otherwise\n- Keep technical terms in English when no French equivalent exists" },
  { id: "concise", label: "Concise Mode", icon: "⚡", desc: "Short, direct answers", rules: "- Keep responses under 3 paragraphs unless the task requires more\n- Lead with the answer, not the reasoning\n- No filler phrases or unnecessary preamble\n- Use bullet points for lists of 3+ items" },
  { id: "planning", label: "Always Plan", icon: "📋", desc: "Plan before executing", rules: "- For any task with 3+ steps, create a plan first and show it to the user\n- Wait for user approval before executing multi-step plans\n- After each major step, report progress" },
  { id: "workspace", label: "Workspace Hygiene", icon: "📁", desc: "Keep workspace organized", rules: "- Organize files in logical folders (src/, docs/, tests/)\n- Never leave temporary files behind\n- Add a README.md to new projects\n- Use meaningful file names, not temp_1.py" },
];

function GovernancePanel({ posture, onSave }: { posture: SecurityPostureData | null; onSave: (rules: string) => void }) {
  const [activeTemplates, setActiveTemplates] = useState<Set<string>>(() => new Set(posture?.constitution?.active_templates || []));
  const [customRules, setCustomRules] = useState("");
  const [editingCustom, setEditingCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  // Extract custom rules (non-template part) from saved rules
  useEffect(() => {
    if (!posture?.constitution?.rules) return;
    setActiveTemplates(new Set(posture.constitution.active_templates || []));
    // Custom rules = everything that's not from templates
    let custom = posture.constitution.rules;
    for (const tpl of RULE_TEMPLATES) {
      custom = custom.replace(`## ${tpl.label}\n${tpl.rules}`, "").trim();
    }
    // Clean up extra newlines
    custom = custom.replace(/\n{3,}/g, "\n\n").trim();
    setCustomRules(custom);
  }, [posture?.constitution?.rules]);

  const toggleTemplate = (id: string) => {
    setActiveTemplates(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // Auto-save when toggling
      const combined = buildRules(next, customRules);
      onSave(combined);
      return next;
    });
  };

  const buildRules = (templates: Set<string>, custom: string): string => {
    const parts: string[] = [];
    for (const tpl of RULE_TEMPLATES) {
      if (templates.has(tpl.id)) {
        parts.push(`## ${tpl.label}\n${tpl.rules}`);
      }
    }
    if (custom.trim()) parts.push(`## Custom Rules\n${custom.trim()}`);
    return parts.join("\n\n");
  };

  const saveCustom = async () => {
    setSaving(true);
    await onSave(buildRules(activeTemplates, customRules));
    setSaving(false);
    setEditingCustom(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-pink-400" />
        <span className="text-sm font-semibold text-white">Constitution</span>
        <span className="text-xs text-slate-500">Toggle rules injected into every agent prompt</span>
      </div>

      {/* Template toggles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {RULE_TEMPLATES.map(tpl => {
          const active = activeTemplates.has(tpl.id);
          return (
            <button key={tpl.id} onClick={() => toggleTemplate(tpl.id)} data-tooltip={tpl.rules.replace(/\n/g, " | ")}
              className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${active ? "border-pink-500/30 bg-pink-500/[0.05]" : "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.1]"}`}>
              <span className="text-lg mt-0.5">{tpl.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${active ? "text-pink-300" : "text-slate-300"}`}>{tpl.label}</span>
                  {active ? <ToggleRight className="h-4 w-4 text-pink-400 ml-auto shrink-0" /> : <ToggleLeft className="h-4 w-4 text-slate-700 ml-auto shrink-0" />}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{tpl.desc}</p>
                {active && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-mono">{tpl.rules.split("\n")[0]}</p>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom rules */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04]">
          <span className="text-xs font-semibold text-slate-300">Custom Rules</span>
          <button onClick={() => editingCustom ? saveCustom() : setEditingCustom(true)}
            className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${editingCustom ? "bg-pink-600 hover:bg-pink-500 text-white" : "bg-white/[0.04] text-slate-500 hover:text-white border border-white/[0.06]"}`}>
            {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : editingCustom ? "Save" : "Edit"}
          </button>
        </div>
        {editingCustom ? (
          <textarea value={customRules} onChange={e => setCustomRules(e.target.value)} rows={6}
            placeholder="Add your own rules here..."
            className="w-full px-4 py-3 bg-transparent text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none font-mono resize-none leading-relaxed" />
        ) : (
          <div className="px-4 py-3 min-h-[60px]">
            {customRules ? (
              <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono leading-relaxed">{customRules}</pre>
            ) : (
              <p className="text-xs text-slate-700 text-center py-2">No custom rules. Click Edit to add your own.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
