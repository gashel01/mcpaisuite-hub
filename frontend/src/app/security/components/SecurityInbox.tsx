"use client";

import { useState } from "react";
import { ShieldAlert, ShieldCheck, AlertTriangle, XCircle, KeyRound, Eye } from "lucide-react";
import type { SecurityAuditEvent } from "@/components/security/types";

export function SecurityInbox({ events, liveEvents, hostPending, onApprovePending, onDenyPending, embedded }: {
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
