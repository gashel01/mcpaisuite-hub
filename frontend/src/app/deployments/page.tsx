"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Rocket, RefreshCw, Globe, Trash, Copy, CheckCheck, X, Terminal,
  KeyRound, Plus, History, ArrowUpRight, Loader2, Zap, Play, CheckCircle2, XCircle, Bot,
  Power, PlayCircle,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { renderMarkdown } from "@/components/markdown";

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
  isOwner?: boolean;
  config?: {
    goal?: string;
    pattern?: string;
    agents?: { type?: string; role?: string; instructions?: string }[];
  };
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
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output: string } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);

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
    setTestInputs({});
    setTestResult(null);
    setTesting(false);
    setRotatedToken(null);
    try {
      const r = await fetch(`${BASE}/deployments/${dep.id}`, { headers: th });
      setSelected(await r.json());
    } catch { /* keep summary */ }
  }, [BASE, th]);

  const runTest = useCallback(async (dep: Deployment) => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${BASE}/deployments/${dep.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ inputs: testInputs }),
      });
      const d = await r.json();
      if (!r.ok) {
        setTestResult({ success: false, output: d.detail || `Error ${r.status}` });
      } else {
        setTestResult({ success: d.success !== false, output: d.final_output || d.error || "(no output)" });
        // reflect the new call count
        setSelected(s => s ? { ...s, runs: (s.runs ?? 0) + 1, run_count: (s.run_count ?? 0) + 1 } : s);
      }
    } catch (e: any) {
      setTestResult({ success: false, output: String(e?.message || e) });
    } finally {
      setTesting(false);
    }
  }, [BASE, th, testInputs]);

  const remove = useCallback(async (id: string) => {
    try { await fetch(`${BASE}/deployments/${id}`, { method: "DELETE", headers: th }); } catch {}
    setSelected(null);
    load();
  }, [BASE, th, load]);

  const [statusBusy, setStatusBusy] = useState(false);
  const toggleStatus = useCallback(async (dep: Deployment) => {
    const next = dep.status === "paused" ? "live" : "paused";
    setStatusBusy(true);
    try {
      const r = await fetch(`${BASE}/deployments/${dep.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ status: next }),
      });
      if (r.ok) {
        setSelected(s => s ? { ...s, status: next } : s);
        setDeployments(list => list.map(d => d.id === dep.id ? { ...d, status: next } : d));
      }
    } catch { /* ignore */ }
    finally { setStatusBusy(false); }
  }, [BASE, th]);

  const rotateToken = useCallback(async (id: string) => {
    setRotating(true);
    try {
      const r = await fetch(`${BASE}/deployments/${id}/rotate-token`, { method: "POST", headers: th });
      const d = await r.json();
      if (r.ok && d.token) setRotatedToken(d.token);
    } catch { /* ignore */ }
    finally { setRotating(false); }
  }, [BASE, th]);

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
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dep.status === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} />
                  <span className="text-[13px] font-semibold text-slate-200 truncate flex-1">{dep.name}</span>
                  {dep.status === "paused" && <span className="text-[8px] font-semibold text-amber-300 bg-amber-500/12 border border-amber-500/20 px-1.5 py-0.5 rounded-full">Offline</span>}
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
                <span className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 border ${selected.status === "paused" ? "text-amber-300 bg-amber-500/12 border-amber-500/20" : "text-emerald-300 bg-emerald-500/12 border-emerald-500/20"}`}>
                  <span className={`h-1 w-1 rounded-full ${selected.status === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} /> {selected.status === "paused" ? "Offline" : "Live"}
                </span>
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

              {/* Deployed workflow (owner-only) */}
              {selected.config && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5"><Bot className="h-3 w-3 text-violet-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Deployed workflow</span><span className="text-[9px] text-slate-600">· {selected.config.pattern || "sequential"}</span></div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5 space-y-2">
                    {selected.config.goal && (
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Goal</div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">{selected.config.goal}</p>
                      </div>
                    )}
                    {(selected.config.agents || []).map((a, i) => (
                      <div key={i} className="border-t border-white/[0.05] pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-200">{a.role || `Agent ${i + 1}`}</span>
                          {a.type && <span className="text-[9px] text-violet-300/80 bg-violet-500/10 px-1.5 py-0.5 rounded">{a.type}</span>}
                        </div>
                        {a.instructions && <p className="text-[10.5px] text-slate-500 leading-relaxed mt-0.5">{a.instructions}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auth / token */}
              <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="flex-1 text-[10.5px] text-slate-400 leading-relaxed">Calls require the <span className="text-amber-300">bearer token</span> from when you published — it's shown only once. Lost it? Rotate to issue a new one (the old token stops working).</p>
                  <button onClick={() => rotateToken(selected.id)} disabled={rotating}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded transition-all disabled:opacity-40">
                    {rotating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />} Rotate
                  </button>
                </div>
                {rotatedToken && (
                  <div className="mt-2.5 animate-fade-in">
                    <div className="text-[9px] text-amber-400/90 font-medium mb-1">New token — copy it now, it won't be shown again:</div>
                    <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-[#08080f] px-2.5 py-1.5">
                      <code className="flex-1 text-[11px] text-amber-300 break-all">{rotatedToken}</code>
                      <button onClick={() => copy(rotatedToken, "rot")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "rot" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                    </div>
                  </div>
                )}
              </div>

              {/* curl */}
              <div>
                <div className="flex items-center gap-1.5 mb-1"><Terminal className="h-3 w-3 text-slate-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Call it</span></div>
                <div className="relative rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                  <button onClick={() => copy(curlFor(selected), "curl")} className="absolute top-2 right-2 text-slate-500 hover:text-slate-200">{copied === "curl" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                  <pre className="text-[10.5px] text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">{curlFor(selected)}</pre>
                </div>
              </div>

              {/* Test run (owner — no bearer token needed) */}
              <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03] px-3 py-3">
                <div className="flex items-center gap-1.5 mb-2"><Play className="h-3 w-3 text-sky-400" /><span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">Test run</span><span className="text-[9px] text-slate-500">— as owner, no token needed</span></div>
                {selected.inputs && selected.inputs.length > 0 && (
                  <div className="space-y-1.5 mb-2.5">
                    {selected.inputs.map(k => (
                      <div key={k}>
                        <label className="text-[9px] text-violet-300 font-medium block mb-0.5">{k}</label>
                        <input
                          value={testInputs[k] || ""}
                          onChange={e => setTestInputs(p => ({ ...p, [k]: e.target.value }))}
                          placeholder={`Value for {${k}}…`}
                          className="w-full !py-1.5 !px-2.5 !text-[12px] !bg-[#08080f] !border-white/[0.06]"
                        />
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => runTest(selected)}
                  disabled={testing || (selected.inputs || []).some(k => !(testInputs[k]?.trim()))}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {testing ? "Running…" : "Run test"}
                </button>

                {testResult && (
                  <div className="mt-2.5 animate-fade-in">
                    <div className="flex items-center gap-1.5 mb-1">
                      {testResult.success ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-red-400" />}
                      <span className={`text-[10px] font-semibold ${testResult.success ? "text-emerald-300" : "text-red-300"}`}>{testResult.success ? "Success" : "Failed"}</span>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5 max-h-56 overflow-y-auto text-[12px] text-slate-300 leading-relaxed">
                      {testResult.success ? renderMarkdown(testResult.output) : <span className="text-red-300">{testResult.output}</span>}
                    </div>
                  </div>
                )}
              </div>

              {/* Calls + executions link */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="text-[11px] text-slate-400"><span className="text-slate-200 font-semibold tabular-nums">{selected.run_count ?? selected.runs ?? 0}</span> API calls</div>
                <Link href="/executions" className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300">
                  <History className="h-3 w-3" /> View in Executions <ArrowUpRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/[0.06] shrink-0">
              <button onClick={() => toggleStatus(selected)} disabled={statusBusy}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all disabled:opacity-40 ${selected.status === "paused" ? "text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/20" : "text-amber-300 hover:bg-amber-500/10 border border-amber-500/20"}`}
                data-tooltip={selected.status === "paused" ? "Bring the endpoint back online" : "Take the endpoint offline — calls return 503, history kept"}>
                {statusBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selected.status === "paused" ? <PlayCircle className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                {selected.status === "paused" ? "Bring online" : "Take offline"}
              </button>
              <button onClick={() => remove(selected.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all">
                <Trash className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
