"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  Gauge, X, Rocket, Power, PlayCircle, Loader2, Activity, DollarSign,
  Repeat, ArrowUpRight,
} from "lucide-react";
import { getApiUrl } from "@/lib/api-url";
import { useTenant, tenantHeaders } from "@/context/tenant";

const BASE = getApiUrl();

export default function FleetDrawer() {
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(`${BASE}/control-plane`, { headers: th }); setData(await r.json()); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [th]);

  const openDrawer = () => { setOpen(true); load(); };

  const toggle = useCallback(async (dep: any) => {
    const next = dep.status === "paused" ? "live" : "paused";
    setBusy(dep.id);
    try {
      await fetch(`${BASE}/deployments/${dep.id}/status`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ status: next }) });
      load();
    } catch {} finally { setBusy(""); }
  }, [th, load]);

  const s = data?.stats || {};
  const deps = data?.deployments || [];

  return (
    <>
      <button onClick={openDrawer} className="p-1.5 rounded-lg text-slate-600 hover:text-violet-400 transition-colors touch-target relative" data-tooltip="Fleet — control plane">
        <Gauge className="h-3.5 w-3.5" />
        {(s.running ?? 0) > 0 && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm bg-[#0c0c14] border-l border-white/[0.08] shadow-2xl shadow-black/50 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-violet-400" /><h3 className="text-sm font-semibold text-slate-200">Fleet</h3></div>
              <button onClick={() => setOpen(false)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loading && !data ? (
                <div className="flex items-center gap-2 text-slate-600 text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Mini icon={<Rocket className="h-3 w-3 text-emerald-400" />} label="Live" value={s.live ?? 0} />
                    <Mini icon={<Loader2 className="h-3 w-3 text-sky-400" />} label="Running" value={s.running ?? 0} />
                    <Mini icon={<Activity className="h-3 w-3 text-slate-300" />} label="Runs today" value={s.runs_today ?? 0} />
                    <Mini icon={<DollarSign className="h-3 w-3 text-emerald-400" />} label="Cost today" value={`$${(s.cost_today ?? 0).toFixed(3)}`} />
                  </div>

                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Deployments</div>
                    {deps.length === 0 ? (
                      <p className="text-[11px] text-slate-600">Nothing deployed yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {deps.map((d: any) => (
                          <div key={d.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${d.status === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} />
                            <span className="text-[11px] text-slate-200 truncate flex-1">{d.name}</span>
                            {d.triggers > 0 && <span className="text-[9px] text-violet-400 shrink-0 flex items-center gap-0.5"><Repeat className="h-2.5 w-2.5" />{d.triggers}</span>}
                            <button onClick={() => toggle(d)} disabled={busy === d.id} className={`shrink-0 p-1 rounded ${d.status === "paused" ? "text-emerald-300 hover:bg-emerald-500/10" : "text-amber-300 hover:bg-amber-500/10"}`} data-tooltip={d.status === "paused" ? "Bring online" : "Take offline"}>
                              {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : d.status === "paused" ? <PlayCircle className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-white/[0.06] shrink-0">
              <Link href="/fleet" onClick={() => setOpen(false)} className="flex items-center justify-center gap-1.5 w-full py-2 text-[12px] font-medium text-violet-200 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/25 rounded-lg transition-all">
                <Gauge className="h-3.5 w-3.5" /> Open fleet <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Mini({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-1 mb-0.5">{icon}<span className="text-[8.5px] text-slate-500 uppercase tracking-wide">{label}</span></div>
      <div className="text-[15px] font-bold text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}
