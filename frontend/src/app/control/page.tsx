"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Gauge, RefreshCw, Rocket, Power, PlayCircle, Clock, Link2, Repeat, Activity,
  Zap, DollarSign, History, ArrowUpRight, Loader2, Copy, CheckCheck,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";

const BASE = getApiUrl();

export default function ControlPlanePage() {
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [copied, setCopied] = useState("");
  const apiOrigin = BASE.replace(/\/$/, "");

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(`${BASE}/control-plane`, { headers: th }); setData(await r.json()); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [th]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); /* eslint-disable-line */ }, []);

  const toggle = useCallback(async (dep: any) => {
    const next = dep.status === "paused" ? "live" : "paused";
    setBusy(dep.id);
    try {
      await fetch(`${BASE}/deployments/${dep.id}/status`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ status: next }) });
      load();
    } catch {} finally { setBusy(""); }
  }, [th, load]);

  const copy = (text: string, key: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };

  const s = data?.stats || {};
  const deps = data?.deployments || [];
  const trigs = data?.triggers || [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] shrink-0">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center">
          <Gauge className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Control Plane</h1>
          <p className="text-[11px] text-slate-500">Live view of your deployed fleet — deployments, triggers and today's activity</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 border border-white/[0.06] transition-all">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <Stat icon={<Rocket className="h-3.5 w-3.5 text-emerald-400" />} label="Live" value={s.live ?? 0} />
          <Stat icon={<Power className="h-3.5 w-3.5 text-amber-400" />} label="Offline" value={s.paused ?? 0} />
          <Stat icon={<Repeat className="h-3.5 w-3.5 text-violet-400" />} label="Triggers" value={s.triggers ?? 0} />
          <Stat icon={<Loader2 className="h-3.5 w-3.5 text-sky-400" />} label="Running" value={s.running ?? 0} />
          <Stat icon={<Activity className="h-3.5 w-3.5 text-slate-300" />} label="Runs today" value={s.runs_today ?? 0} />
          <Stat icon={<DollarSign className="h-3.5 w-3.5 text-emerald-400" />} label="Cost today" value={`$${(s.cost_today ?? 0).toFixed(3)}`} />
        </div>

        {/* Deployments */}
        <section>
          <div className="flex items-center gap-2 mb-2"><Rocket className="h-3.5 w-3.5 text-sky-400" /><h2 className="text-[12px] font-semibold text-slate-300">Deployments</h2><Link href="/deployments" className="ml-auto text-[10px] text-sky-400 hover:text-sky-300 inline-flex items-center gap-0.5">Manage <ArrowUpRight className="h-2.5 w-2.5" /></Link></div>
          {deps.length === 0 ? (
            <p className="text-[11px] text-slate-600 px-1 py-3">No deployments. Publish a workflow from <Link href="/agents" className="text-violet-400 hover:text-violet-300">Agents</Link>.</p>
          ) : (
            <div className="space-y-1.5">
              {deps.map((d: any) => (
                <div key={d.id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${d.status === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} />
                  <span className="text-[12px] font-medium text-slate-200 truncate flex-1">{d.name}</span>
                  <span className="text-[9px] text-slate-500 shrink-0">v{d.version}</span>
                  <span className="text-[9px] text-slate-500 shrink-0 flex items-center gap-1"><Zap className="h-2.5 w-2.5" />{d.runs}</span>
                  {d.triggers > 0 && <span className="text-[9px] text-violet-400 shrink-0 flex items-center gap-1"><Repeat className="h-2.5 w-2.5" />{d.triggers}</span>}
                  <button onClick={() => toggle(d)} disabled={busy === d.id}
                    className={`shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-all disabled:opacity-40 ${d.status === "paused" ? "text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/20" : "text-amber-300 hover:bg-amber-500/10 border border-amber-500/20"}`}>
                    {busy === d.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : d.status === "paused" ? <PlayCircle className="h-2.5 w-2.5" /> : <Power className="h-2.5 w-2.5" />}
                    {d.status === "paused" ? "Bring online" : "Take offline"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Triggers */}
        <section>
          <div className="flex items-center gap-2 mb-2"><Repeat className="h-3.5 w-3.5 text-violet-400" /><h2 className="text-[12px] font-semibold text-slate-300">Active triggers</h2></div>
          {trigs.length === 0 ? (
            <p className="text-[11px] text-slate-600 px-1 py-3">No triggers. Add a cron, interval or webhook from a deployment.</p>
          ) : (
            <div className="space-y-1.5">
              {trigs.map((t: any) => (
                <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
                  {t.type === "webhook" ? <Link2 className="h-3 w-3 text-sky-400 shrink-0" /> : t.type === "cron" ? <Clock className="h-3 w-3 text-violet-400 shrink-0" /> : <Repeat className="h-3 w-3 text-violet-400 shrink-0" />}
                  <span className="text-[11px] text-slate-200 shrink-0">{t.label}</span>
                  <span className="text-[10px] text-slate-500 truncate flex-1">→ {t.deploymentName}</span>
                  {t.webhook_url && (
                    <button onClick={() => copy(`${apiOrigin}${t.webhook_url}`, t.id)} className="text-slate-500 hover:text-sky-300 shrink-0" data-tooltip="Copy webhook URL">{copied === t.id ? <CheckCheck className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <Link href="/executions" className="inline-flex items-center gap-1.5 text-[11px] text-violet-400 hover:text-violet-300"><History className="h-3.5 w-3.5" /> View all executions <ArrowUpRight className="h-2.5 w-2.5" /></Link>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span></div>
      <div className="text-[18px] font-bold text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}
