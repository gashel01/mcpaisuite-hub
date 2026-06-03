"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Rocket, RefreshCw, Globe, Trash, Copy, CheckCheck, X, Terminal,
  KeyRound, Plus, History, ArrowUpRight, Loader2, Zap,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";

interface Deployment {
  id: string;
  name: string;
  endpoint: string;
  runs?: number;
  run_count?: number;
  created_at: number;
  release_notes?: string;
  version?: number;
  status?: string;
  inputs?: string[];
}

function fmtDate(s?: number) {
  if (!s) return "—";
  const d = new Date(s * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function DeploymentsPage() {
  const BASE = getApiUrl();
  const apiOrigin = BASE.replace(/\/$/, "");
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Deployment | null>(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/deployments`, { headers: th });
      const d = await r.json();
      setDeployments(d.deployments || []);
    } catch { setDeployments([]); }
    finally { setLoading(false); }
  }, [BASE, th]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openDetail = useCallback(async (dep: Deployment) => {
    setSelected(dep);
    try {
      const r = await fetch(`${BASE}/deployments/${dep.id}`, { headers: th });
      setSelected(await r.json());
    } catch { /* keep summary */ }
  }, [BASE, th]);

  const remove = useCallback(async (id: string) => {
    try { await fetch(`${BASE}/deployments/${id}`, { method: "DELETE", headers: th }); } catch {}
    setSelected(null);
    load();
  }, [BASE, th, load]);

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  }, []);

  const curlFor = (dep: Deployment) => {
    const inputs = (dep.inputs && dep.inputs.length)
      ? "{" + dep.inputs.map(k => `"${k}": "…"`).join(", ") + "}"
      : "{}";
    return `curl -X POST ${apiOrigin}${dep.endpoint} \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"inputs": ${inputs}}'`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] shrink-0">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-600/15 to-sky-800/8 border border-sky-500/15 flex items-center justify-center">
          <Rocket className="h-4 w-4 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Deployments</h1>
          <p className="text-[11px] text-slate-500">Workflows published as token-authed callable APIs</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 border border-white/[0.06] transition-all">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        <Link href="/agents" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600/90 hover:bg-sky-500 text-white transition-all">
          <Plus className="h-3.5 w-3.5" /> Deploy a workflow
        </Link>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading && deployments.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-600 text-xs gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : deployments.length === 0 ? (
          <div className="text-center py-20 max-w-md mx-auto">
            <div className="h-14 w-14 rounded-2xl bg-sky-500/[0.06] border border-sky-500/15 flex items-center justify-center mx-auto mb-4">
              <Rocket className="h-6 w-6 text-sky-400" />
            </div>
            <p className="text-sm text-slate-300 font-medium">No deployments yet</p>
            <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
              Build an agent team in <span className="text-slate-300">Agents</span>, then hit <span className="inline-flex items-center gap-1 text-sky-300"><Rocket className="h-3 w-3" /> Publish</span> to turn it into a public API endpoint with a bearer token and a ready-to-paste curl.
            </p>
            <Link href="/agents" className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg text-xs font-medium bg-sky-600/90 hover:bg-sky-500 text-white transition-all">
              <ArrowUpRight className="h-3.5 w-3.5" /> Go to Agents
            </Link>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {deployments.map(dep => (
              <button key={dep.id} onClick={() => openDetail(dep)}
                className="text-left rounded-xl border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.03] hover:border-sky-500/20 p-3.5 transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-[13px] font-semibold text-slate-200 truncate flex-1">{dep.name}</span>
                  <span className="text-[9px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded">v{dep.version || 1}</span>
                </div>
                {dep.release_notes && <p className="text-[10.5px] text-slate-500 line-clamp-2 mb-2">{dep.release_notes}</p>}
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Globe className="h-3 w-3 text-sky-400/70" />
                  <code className="text-sky-300/80 truncate">{dep.endpoint}</code>
                </div>
                <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-white/[0.04] text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><Zap className="h-2.5 w-2.5" /> {dep.runs ?? 0} calls</span>
                  <span>{fmtDate(dep.created_at)}</span>
                  <span className="ml-auto text-sky-400/0 group-hover:text-sky-400/80 transition-colors">Details →</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setSelected(null)} />
          <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-xl bg-[#0c0c14] border-l border-white/[0.08] shadow-2xl shadow-black/50 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Rocket className="h-4 w-4 text-sky-400 shrink-0" />
                <h3 className="text-sm font-semibold text-slate-200 truncate">{selected.name}</h3>
                <span className="text-[9px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">v{selected.version || 1}</span>
              </div>
              <button onClick={() => setSelected(null)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {selected.release_notes && (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">{selected.release_notes}</div>
              )}

              {/* Endpoint */}
              <div>
                <div className="flex items-center gap-1.5 mb-1"><Globe className="h-3 w-3 text-sky-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Endpoint</span></div>
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2">
                  <code className="flex-1 text-[11px] text-sky-300 break-all">POST {apiOrigin}{selected.endpoint}</code>
                  <button onClick={() => copy(`${apiOrigin}${selected.endpoint}`, "ep")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "ep" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                </div>
              </div>

              {/* Inputs */}
              {selected.inputs && selected.inputs.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Expected inputs</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selected.inputs.map(k => <span key={k} className="text-[11px] text-violet-200 bg-violet-500/12 border border-violet-500/15 px-2 py-0.5 rounded">{k}</span>)}
                  </div>
                </div>
              )}

              {/* Auth note */}
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2">
                <KeyRound className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[10.5px] text-slate-400 leading-relaxed">Calls require the <span className="text-amber-300">bearer token</span> issued when you published. It's shown only once — re-publish to rotate it.</p>
              </div>

              {/* curl */}
              <div>
                <div className="flex items-center gap-1.5 mb-1"><Terminal className="h-3 w-3 text-slate-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Call it</span></div>
                <div className="relative rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                  <button onClick={() => copy(curlFor(selected), "curl")} className="absolute top-2 right-2 text-slate-500 hover:text-slate-200">{copied === "curl" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                  <pre className="text-[10.5px] text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">{curlFor(selected)}</pre>
                </div>
              </div>

              {/* Calls + executions link */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="text-[11px] text-slate-400"><span className="text-slate-200 font-semibold tabular-nums">{selected.run_count ?? selected.runs ?? 0}</span> API calls</div>
                <Link href="/executions" className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300">
                  <History className="h-3 w-3" /> View in Executions <ArrowUpRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06] shrink-0">
              <span className="text-[10px] text-slate-600">Created {fmtDate(selected.created_at)}</span>
              <button onClick={() => remove(selected.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all">
                <Trash className="h-3.5 w-3.5" /> Delete deployment
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
