"use client";

import { useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Plus } from "lucide-react";
import type { SecurityPosture as SecurityPostureData } from "@/components/security/types";

export function HostPanel({ posture, pendingRequests, onApprove, onDeny, onBlockSafe, onUnblock, onApprovePending, onDenyPending }: { posture: SecurityPostureData | null; pendingRequests: { pattern: string; namespace?: string }[]; onApprove: (p: string) => void; onDeny: (p: string) => void; onBlockSafe: (p: string) => void; onUnblock: (p: string) => void; onApprovePending: (p: string, ns?: string) => void; onDenyPending: (p: string, ns?: string) => void }) {
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
