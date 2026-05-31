"use client";

import { Plus, X } from "lucide-react";

interface EgressPanelProps {
  networkEnabled: boolean;
  allowedDomains: string[];
  newDomain: string;
  setNewDomain: (v: string) => void;
  onToggle: () => void;
  onAddDomain: () => void;
  onRemoveDomain: (d: string) => void;
}

export default function EgressPanel({ networkEnabled, allowedDomains, newDomain, setNewDomain, onToggle, onAddDomain, onRemoveDomain }: EgressPanelProps) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 md:p-4 mx-4 mb-2 space-y-3 shrink-0 ">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Network Egress</h3>
        <button onClick={onToggle} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${networkEnabled ? "bg-green-600 text-white" : "bg-slate-700 text-slate-400"}`}>
          {networkEnabled ? "Enabled" : "Disabled"}
        </button>
      </div>
      {networkEnabled && (
        <>
          <div className="flex gap-2">
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)} onKeyDown={e => e.key === "Enter" && onAddDomain()} placeholder="api.example.com" className="flex-1 bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50" />
            <button onClick={onAddDomain} className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs"><Plus className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allowedDomains.map(d => (
              <span key={d} className="flex items-center gap-1 bg-green-900/30 text-green-400 text-[11px] px-2 py-0.5 rounded-md border border-green-800/40">
                {d}<button onClick={() => onRemoveDomain(d)} className="hover:text-red-400"><X className="h-2.5 w-2.5" /></button>
              </span>
            ))}
            {allowedDomains.length === 0 && <span className="text-[11px] text-slate-600">All domains allowed (no whitelist)</span>}
          </div>
        </>
      )}
    </div>
  );
}
