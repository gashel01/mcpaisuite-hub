"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  RefreshCw, Globe, Trash, Copy, CheckCheck, Terminal,
  KeyRound, Plus, Loader2, Play, CheckCircle2, XCircle, Bot,
  Power, PlayCircle, BarChart3, Clock, Repeat, Link2,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { renderMarkdown } from "@/components/markdown";

const INTERVAL_PRESETS = [
  { label: "5m", s: 300 }, { label: "15m", s: 900 }, { label: "30m", s: 1800 },
  { label: "1h", s: 3600 }, { label: "6h", s: 21600 }, { label: "1d", s: 86400 },
];
const CRON_PRESETS = [
  { label: "Hourly", v: "0 * * * *" }, { label: "Daily 9am", v: "0 9 * * *" },
  { label: "Every 15m", v: "*/15 * * * *" }, { label: "Mon 8am", v: "0 8 * * 1" },
];
function trigSummary(t: any): string {
  if (t.type === "interval") {
    const p = INTERVAL_PRESETS.find(x => x.s === t.seconds);
    return `Every ${p ? p.label : `${t.seconds}s`}`;
  }
  if (t.type === "cron") return `Cron · ${t.cron}`;
  return "Webhook";
}

export interface Deployment {
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
  config?: { goal?: string; pattern?: string; agents?: { type?: string; role?: string; instructions?: string }[] };
}

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "amber" }) {
  const color = accent === "emerald" ? "text-emerald-300" : accent === "amber" ? "text-amber-300" : "text-slate-200";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-center">
      <div className="text-[8.5px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[13px] font-semibold tabular-nums mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Full detail surface for a single deployment — metrics, endpoint, config, token,
 * curl, owner test-run, triggers, and pause/delete actions. Extracted from the old
 * Deployments page so it can sit as the right-hand panel of the unified Fleet hub.
 * `onChanged` fires after status changes; `onDeleted` after a delete.
 */
export default function DeploymentDetail({ dep, onChanged, onDeleted, onViewRuns }: {
  dep: Deployment;
  onChanged?: (patch: Partial<Deployment>) => void;
  onDeleted?: (id: string) => void;
  onViewRuns?: (name: string) => void;
}) {
  const BASE = getApiUrl();
  const apiOrigin = BASE.replace(/\/$/, "");
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  const [selected, setSelected] = useState<Deployment>(dep);
  const [copied, setCopied] = useState("");
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output: string } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [trigType, setTrigType] = useState<"interval" | "cron" | "webhook">("interval");
  const [trigInterval, setTrigInterval] = useState(3600);
  const [trigCron, setTrigCron] = useState("0 9 * * *");
  const [trigInputs, setTrigInputs] = useState<Record<string, string>>({});
  const [addingTrigger, setAddingTrigger] = useState(false);
  const [trigError, setTrigError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const loadMetrics = useCallback(async (id: string) => {
    try { const r = await fetch(`${BASE}/deployments/${id}/metrics`, { headers: th }); setMetrics(r.ok ? await r.json() : null); }
    catch { setMetrics(null); }
  }, [BASE, th]);
  const loadTriggers = useCallback(async (id: string) => {
    try { const r = await fetch(`${BASE}/deployments/${id}/triggers`, { headers: th }); const d = await r.json(); setTriggers(d.triggers || []); }
    catch { setTriggers([]); }
  }, [BASE, th]);

  // Load full detail + metrics + triggers whenever the selected deployment changes
  useEffect(() => {
    setSelected(dep); setTestInputs({}); setTestResult(null); setTesting(false);
    setRotatedToken(null); setMetrics(null); setTriggers([]); setTrigError(""); setTrigInputs({});
    loadMetrics(dep.id); loadTriggers(dep.id);
    (async () => {
      try { const r = await fetch(`${BASE}/deployments/${dep.id}`, { headers: th }); setSelected(await r.json()); }
      catch { /* keep summary */ }
    })();
  }, [dep.id]); // eslint-disable-line

  const addTrigger = useCallback(async () => {
    setAddingTrigger(true); setTrigError("");
    const body: any = { type: trigType, inputs: trigInputs };
    if (trigType === "interval") body.seconds = trigInterval;
    if (trigType === "cron") body.cron = trigCron.trim();
    try {
      const r = await fetch(`${BASE}/deployments/${selected.id}/triggers`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify(body) });
      if (r.ok) { setTrigInputs({}); loadTriggers(selected.id); }
      else { const e = await r.json().catch(() => ({})); setTrigError(e.detail || `Error ${r.status}`); }
    } catch (e: any) { setTrigError(String(e?.message || e)); }
    finally { setAddingTrigger(false); }
  }, [BASE, th, trigType, trigInterval, trigCron, trigInputs, selected.id, loadTriggers]);

  const deleteTrigger = useCallback(async (tid: string) => {
    try { await fetch(`${BASE}/deployments/triggers/${tid}`, { method: "DELETE", headers: th }); } catch {}
    loadTriggers(selected.id);
  }, [BASE, th, selected.id, loadTriggers]);

  const runTest = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`${BASE}/deployments/${selected.id}/test`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ inputs: testInputs }) });
      const d = await r.json();
      if (!r.ok) setTestResult({ success: false, output: d.detail || `Error ${r.status}` });
      else {
        setTestResult({ success: d.success !== false, output: d.final_output || d.error || "(no output)" });
        setSelected(s => ({ ...s, runs: (s.runs ?? 0) + 1, run_count: (s.run_count ?? 0) + 1 }));
        loadMetrics(selected.id);
      }
    } catch (e: any) { setTestResult({ success: false, output: String(e?.message || e) }); }
    finally { setTesting(false); }
  }, [BASE, th, testInputs, selected.id, loadMetrics]);

  const remove = useCallback(async () => {
    try { await fetch(`${BASE}/deployments/${selected.id}`, { method: "DELETE", headers: th }); } catch {}
    onDeleted?.(selected.id);
  }, [BASE, th, selected.id, onDeleted]);

  const toggleStatus = useCallback(async () => {
    const next = selected.status === "paused" ? "live" : "paused";
    setStatusBusy(true);
    try {
      const r = await fetch(`${BASE}/deployments/${selected.id}/status`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ status: next }) });
      if (r.ok) { setSelected(s => ({ ...s, status: next })); onChanged?.({ id: selected.id, status: next } as any); }
    } catch {} finally { setStatusBusy(false); }
  }, [BASE, th, selected.id, selected.status, onChanged]);

  const rotateToken = useCallback(async () => {
    setRotating(true);
    try { const r = await fetch(`${BASE}/deployments/${selected.id}/rotate-token`, { method: "POST", headers: th }); const d = await r.json(); if (r.ok && d.token) setRotatedToken(d.token); }
    catch {} finally { setRotating(false); }
  }, [BASE, th, selected.id]);

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  }, []);

  const curlFor = (d: Deployment) => {
    const inputs = (d.inputs && d.inputs.length) ? "{" + d.inputs.map(k => `"${k}": "…"`).join(", ") + "}" : "{}";
    return `curl -X POST ${apiOrigin}${d.endpoint} \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"inputs": ${inputs}}'`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-200 truncate">{selected.name}</h3>
          <span className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 border ${selected.status === "paused" ? "text-amber-300 bg-amber-500/12 border-amber-500/20" : "text-emerald-300 bg-emerald-500/12 border-emerald-500/20"}`}>
            <span className={`h-1 w-1 rounded-full ${selected.status === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} /> {selected.status === "paused" ? "Offline" : "Live"}
          </span>
          <span className="text-[9px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">v{selected.version || 1}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {selected.release_notes && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">{selected.release_notes}</div>
        )}

        {/* Metrics */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5"><BarChart3 className="h-3 w-3 text-emerald-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Metrics</span></div>
          {!metrics ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-600 px-1 py-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : metrics.totalCalls === 0 ? (
            <p className="text-[11px] text-slate-600 px-1 py-2">No calls yet — run a test or call the endpoint to see metrics.</p>
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <MetricTile label="Calls" value={String(metrics.totalCalls)} />
                <MetricTile label="Success" value={metrics.successRate != null ? `${Math.round(metrics.successRate * 100)}%` : "—"} accent={metrics.byStatus?.failed ? "amber" : "emerald"} />
                <MetricTile label="Avg latency" value={metrics.avg?.durationMs ? `${(metrics.avg.durationMs / 1000).toFixed(1)}s` : "—"} />
                <MetricTile label="Tokens" value={(metrics.totals?.tokens || 0).toLocaleString()} />
                <MetricTile label="Cost" value={`$${(metrics.totals?.cost || 0).toFixed(4)}`} />
                <MetricTile label="p95 latency" value={metrics.latency?.p95 ? `${(metrics.latency.p95 / 1000).toFixed(1)}s` : "—"} />
              </div>
              {(() => {
                const tl = metrics.timeline || [];
                const maxC = Math.max(1, ...tl.map((d: any) => d.calls));
                return (
                  <div className="rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                    <div className="text-[9px] text-slate-600 uppercase tracking-wide mb-1.5">Calls · last 14 days</div>
                    <div className="flex items-end gap-1 h-12">
                      {tl.map((d: any) => {
                        const ok = d.calls - d.failures;
                        return (
                          <div key={d.date} className="flex-1 flex flex-col justify-end h-full relative" data-tooltip={`${d.date}: ${d.calls} call(s)${d.failures ? `, ${d.failures} failed` : ""}`}>
                            {d.failures > 0 && <div className="w-full bg-red-500/70 rounded-t-sm" style={{ height: `${(d.failures / maxC) * 100}%` }} />}
                            {ok > 0 && <div className={`w-full bg-emerald-500/60 ${d.failures > 0 ? "" : "rounded-t-sm"}`} style={{ height: `${(ok / maxC) * 100}%` }} />}
                            {d.calls === 0 && <div className="w-full bg-white/[0.04] rounded-t-sm" style={{ height: "2px" }} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {metrics.bySource && Object.keys(metrics.bySource).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="text-slate-600">Source:</span>
                  {Object.entries(metrics.bySource).map(([src, n]) => {
                    const c = src === "test" ? "text-amber-300 bg-amber-500/10 border-amber-500/15" : src === "schedule" ? "text-violet-300 bg-violet-500/10 border-violet-500/15" : "text-sky-300 bg-sky-500/10 border-sky-500/15";
                    return <span key={src} className={`inline-flex items-center gap-1 capitalize px-1.5 py-0.5 rounded border ${c}`}>{src} {String(n)}</span>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>

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

        {/* Deployed workflow */}
        {selected.config && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5"><Bot className="h-3 w-3 text-violet-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Deployed workflow</span><span className="text-[9px] text-slate-600">· {selected.config.pattern || "sequential"}</span></div>
            <div className="rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5 space-y-2">
              {selected.config.goal && (
                <div><div className="text-[9px] text-slate-600 uppercase tracking-wide mb-0.5">Goal</div><p className="text-[11px] text-slate-300 leading-relaxed">{selected.config.goal}</p></div>
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
            <button onClick={rotateToken} disabled={rotating} className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded transition-all disabled:opacity-40">
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

        {/* Test run */}
        <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03] px-3 py-3">
          <div className="flex items-center gap-1.5 mb-2"><Play className="h-3 w-3 text-sky-400" /><span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">Test run</span><span className="text-[9px] text-slate-500">— as owner, no token needed</span></div>
          {selected.inputs && selected.inputs.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              {selected.inputs.map(k => (
                <div key={k}>
                  <label className="text-[9px] text-violet-300 font-medium block mb-0.5">{k}</label>
                  <input value={testInputs[k] || ""} onChange={e => setTestInputs(p => ({ ...p, [k]: e.target.value }))} placeholder={`Value for {${k}}…`} className="w-full !py-1.5 !px-2.5 !text-[12px] !bg-[#08080f] !border-white/[0.06]" />
                </div>
              ))}
            </div>
          )}
          <button onClick={runTest} disabled={testing || (selected.inputs || []).some(k => !(testInputs[k]?.trim()))} className="w-full flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all">
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

        {/* Triggers */}
        <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.03] px-3 py-3">
          <div className="flex items-center gap-1.5 mb-2"><Repeat className="h-3 w-3 text-violet-400" /><span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">Triggers</span><span className="text-[9px] text-slate-500">— run this automatically</span></div>
          {triggers.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              {triggers.map(t => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
                  {t.type === "webhook" ? <Link2 className="h-3 w-3 text-sky-400 shrink-0" /> : t.type === "cron" ? <Clock className="h-3 w-3 text-violet-400 shrink-0" /> : <Repeat className="h-3 w-3 text-violet-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-slate-200">{trigSummary(t)}</div>
                    {t.type === "webhook" && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <code className="text-[9px] text-sky-300/80 truncate">{apiOrigin}{t.webhook_url}</code>
                        <button onClick={() => copy(`${apiOrigin}${t.webhook_url}`, `wh-${t.id}`)} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === `wh-${t.id}` ? <CheckCheck className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}</button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => deleteTrigger(t.id)} className="text-slate-500 hover:text-red-400 shrink-0"><Trash className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 mb-2 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            {(["interval", "cron", "webhook"] as const).map(tt => (
              <button key={tt} onClick={() => setTrigType(tt)} className={`flex-1 py-1 rounded-md text-[10px] font-medium capitalize transition-all ${trigType === tt ? "bg-violet-500/20 text-violet-200" : "text-slate-500 hover:text-slate-300"}`}>{tt}</button>
            ))}
          </div>
          {trigType === "interval" && (
            <div className="flex flex-wrap gap-1 mb-2">
              {INTERVAL_PRESETS.map(p => (
                <button key={p.s} onClick={() => setTrigInterval(p.s)} className={`px-2 py-1 text-[10px] rounded border transition-all ${trigInterval === p.s ? "text-violet-200 bg-violet-500/15 border-violet-500/25" : "text-slate-400 border-white/[0.06] hover:bg-white/[0.04]"}`}>{p.label}</button>
              ))}
            </div>
          )}
          {trigType === "cron" && (
            <div className="mb-2 space-y-1.5">
              <input value={trigCron} onChange={e => setTrigCron(e.target.value)} placeholder="min hour dom mon dow" className="w-full !py-1.5 !px-2.5 !text-[12px] !bg-[#08080f] !border-white/[0.06] font-mono" />
              <div className="flex flex-wrap gap-1">
                {CRON_PRESETS.map(p => (<button key={p.v} onClick={() => setTrigCron(p.v)} className="px-2 py-0.5 text-[9px] text-slate-400 border border-white/[0.06] rounded hover:bg-white/[0.04] transition-all">{p.label}</button>))}
              </div>
            </div>
          )}
          {trigType === "webhook" && (
            <p className="text-[10px] text-slate-500 mb-2 leading-relaxed">Generates a secret URL — POST to it to run the deployment from any external system. Defaults below are sent unless the caller overrides them.</p>
          )}
          {selected.inputs && selected.inputs.length > 0 && (
            <div className="space-y-1.5 mb-2">
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">Default inputs</div>
              {selected.inputs.map(k => (
                <input key={k} value={trigInputs[k] || ""} onChange={e => setTrigInputs(p => ({ ...p, [k]: e.target.value }))} placeholder={`{${k}}…`} className="w-full !py-1.5 !px-2.5 !text-[12px] !bg-[#08080f] !border-white/[0.06]" />
              ))}
            </div>
          )}
          {trigError && <p className="text-[10px] text-red-400 mb-1.5">{trigError}</p>}
          <button onClick={addTrigger} disabled={addingTrigger} className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-violet-200 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/25 rounded-lg transition-all disabled:opacity-40">
            {addingTrigger ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add {trigType} trigger
          </button>
        </div>

        {/* Calls + executions link */}
        <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="text-[11px] text-slate-400"><span className="text-slate-200 font-semibold tabular-nums">{selected.run_count ?? selected.runs ?? 0}</span> API calls</div>
          {onViewRuns
            ? <button onClick={() => onViewRuns(selected.name)} className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"><Clock className="h-3 w-3" /> View its runs →</button>
            : <Link href="/fleet?view=activity" className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"><Clock className="h-3 w-3" /> View runs →</Link>}
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/[0.06] shrink-0">
        <button onClick={toggleStatus} disabled={statusBusy}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all disabled:opacity-40 ${selected.status === "paused" ? "text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/20" : "text-amber-300 hover:bg-amber-500/10 border border-amber-500/20"}`}
          data-tooltip={selected.status === "paused" ? "Bring the endpoint back online" : "Take the endpoint offline — calls return 503, history kept"}>
          {statusBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selected.status === "paused" ? <PlayCircle className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
          {selected.status === "paused" ? "Bring online" : "Take offline"}
        </button>
        <button onClick={remove} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all">
          <Trash className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}
