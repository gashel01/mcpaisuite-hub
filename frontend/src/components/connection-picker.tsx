"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Cpu, ChevronDown, Plus, Check, Pencil, X } from "lucide-react";
import { getApiUrl } from "@/lib/api-url";
import { useTenant, tenantHeaders } from "@/context/tenant";
import ConnectionsManager from "./connections-manager";

const BASE = getApiUrl();

export interface Connection {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url?: string;
  has_api_key: boolean;
  is_default: boolean;
  created_at?: number;
}

export default function ConnectionPicker({ compact }: { compact?: boolean }) {
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/llm/connections`, { headers: th });
      const d = await r.json();
      setConns(d.connections || []);
    } catch { /* ignore */ }
  }, [th]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const active = conns.find(c => c.is_default) || conns[0];

  const activate = useCallback(async (id: string) => {
    setConns(cs => cs.map(c => ({ ...c, is_default: c.id === id })));
    setOpen(false);
    try { await fetch(`${BASE}/llm/connections/${id}/default`, { method: "POST", headers: th }); } catch {}
    load();
  }, [th, load]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 transition-all ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}
        data-tooltip="Active model — click to switch">
        <Cpu className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <span className={`font-medium truncate ${compact ? "text-[11px] max-w-[110px]" : "text-xs max-w-[160px]"}`}>{active ? active.name : "Default"}</span>
        <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 animate-scale-in p-1">
          <div className="px-2.5 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Model connection</div>
          {conns.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-500">No connections yet.</p>
          ) : conns.map(c => (
            <button key={c.id} onClick={() => activate(c.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all ${c.is_default ? "bg-violet-500/12" : "hover:bg-white/[0.04]"}`}>
              <span className="h-4 w-4 shrink-0 flex items-center justify-center">{c.is_default ? <Check className="h-3.5 w-3.5 text-violet-400" /> : null}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-200 truncate">{c.name}</div>
                <div className="text-[9px] text-slate-500 truncate">{c.provider} · {c.model}</div>
              </div>
            </button>
          ))}
          <div className="h-px bg-white/[0.06] my-1" />
          <button onClick={() => { setOpen(false); setManaging(true); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-violet-300 hover:bg-violet-500/10 transition-all">
            {conns.length === 0 ? <><Plus className="h-3.5 w-3.5" /> Add connection</> : <><Pencil className="h-3.5 w-3.5" /> Manage connections</>}
          </button>
        </div>
      )}

      {/* Manage modal — reuses the shared ConnectionsManager surface */}
      {managing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setManaging(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 animate-scale-in flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-violet-400" /><h3 className="text-sm font-semibold text-slate-200">LLM connections</h3></div>
              <button onClick={() => setManaging(false)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto">
              <ConnectionsManager onChanged={load} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
