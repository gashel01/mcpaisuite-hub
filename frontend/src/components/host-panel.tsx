"use client";

import { Terminal, ShieldAlert, Plus, X } from "lucide-react";

interface HostPanelProps {
  hostPending: { namespace: string; pattern: string }[];
  hostApproved: string[];
  newHostPattern: string;
  setNewHostPattern: (v: string) => void;
  onApprove: (pattern: string) => void;
  onDeny: (pattern: string) => void;
  onAdd: () => void;
  onRevoke: (pattern: string) => void;
}

export default function HostPanel({ hostPending, hostApproved, newHostPattern, setNewHostPattern, onApprove, onDeny, onAdd, onRevoke }: HostPanelProps) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 md:p-4 mx-4 mb-2 space-y-3 shrink-0 ">
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-medium text-slate-300">Host Command Access</h3>
      </div>
      {hostPending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-amber-400 font-medium flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Pending:</p>
          {hostPending.map(p => (
            <div key={p.pattern} className="flex items-center gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
              <code className="text-xs text-amber-300 flex-1 font-mono">{p.pattern}</code>
              <button onClick={() => onApprove(p.pattern)} className="bg-green-600 hover:bg-green-500 text-white px-2.5 py-1 rounded text-xs font-medium">Approve</button>
              <button onClick={() => onDeny(p.pattern)} className="bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded text-xs font-medium">Deny</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={newHostPattern} onChange={e => setNewHostPattern(e.target.value)} onKeyDown={e => e.key === "Enter" && onAdd()} placeholder="docker restart *" className="flex-1 bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50 font-mono" />
        <button onClick={onAdd} className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs"><Plus className="h-3.5 w-3.5" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {hostApproved.map(p => (
          <span key={p} className="flex items-center gap-1 bg-violet-900/30 text-violet-400 text-[11px] px-2 py-0.5 rounded-md border border-violet-800/40 font-mono">
            {p}<button onClick={() => onRevoke(p)} className="hover:text-red-400"><X className="h-2.5 w-2.5" /></button>
          </span>
        ))}
        {hostApproved.length === 0 && hostPending.length === 0 && <span className="text-[11px] text-slate-600">Safe commands pre-allowed (ls, docker ps, git status...)</span>}
      </div>
    </div>
  );
}
