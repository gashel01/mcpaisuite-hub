"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, Globe, AlertTriangle, Plus, X, ToggleLeft, ToggleRight } from "lucide-react";
import type { SecurityPosture as SecurityPostureData } from "@/components/security/types";

export function NetworkPanel({ posture, onToggle, onAdd, onRemove }: { posture: SecurityPostureData | null; onToggle: () => void; onAdd: (d: string) => void; onRemove: (d: string) => void }) {
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
