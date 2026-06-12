"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ShieldAlert, ShieldCheck,
  RefreshCw, Globe, Terminal, Code2, KeyRound, ScrollText,
  AlertTriangle, CheckCircle2, XCircle, Radio, X, Menu,
} from "lucide-react";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useSecurity } from "./useSecurity";
import { Spinner } from "@/components/ui/Spinner";
import { scoreColor, categoryScore, overallScore } from "./scoring";
import {
  StatPill, ControlPanel, SecurityInbox,
  NetworkPanel, HostPanel, CodePanel, DLPPanel, GovernancePanel,
} from "./components";

// ── Main Page ───────────────────────────────────────────────────────────

export default function SecurityPage() {
  const { isMobile, isDesktop } = useBreakpoint();

  const {
    posture, events, stats, loading, liveEvents, vaultKeys, hostPending,
    refresh, refreshing,
    toggleEgress, addDomain, removeDomain, approvePattern, approvePending, denyPending,
    blockSafePattern, unblockPattern, denyPattern, addSecret, deleteSecret,
    toggleDLPPattern, toggleCodePattern, toggleCodeSafety, saveConstitution,
  } = useSecurity();

  // UI-only state
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  // Deep-link: ?panel=<id> opens a specific security panel (e.g. from the Settings env-vars note)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("panel");
    if (p) setActivePanel(p);
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
        <button onClick={refresh} className="p-1.5 text-slate-600 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0">
          <Spinner icon={RefreshCw} spinning={loading || refreshing} className="h-3.5 w-3.5" />
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
