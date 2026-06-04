"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, Globe, Trash, Copy, CheckCheck, Terminal,
  KeyRound, Plus, Loader2, Play, CheckCircle2, XCircle,
  Power, PlayCircle, Clock, Repeat, Link2, ChevronRight, Activity,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { renderMarkdown } from "@/components/markdown";
import ExecutionsFeed from "@/components/executions-feed";

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

const AGENT_COLORS: Record<string, string> = {
  code: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  research: "text-sky-300 bg-sky-500/10 border-sky-500/20",
  file: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  memory: "text-violet-300 bg-violet-500/10 border-violet-500/20",
};
const agentColor = (t?: string) => AGENT_COLORS[t || ""] || "text-slate-300 bg-white/[0.04] border-white/[0.08]";

function StatCard({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "amber" }) {
  const color = accent === "emerald" ? "text-emerald-300" : accent === "amber" ? "text-amber-300" : "text-slate-100";
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[16px] font-bold tabular-nums mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Tabbed, product-style detail for a single deployment: Overview (metrics +
 * what-it-does pipeline + run), Runs (its executions), Triggers, and API (the
 * developer endpoint/token/curl). Used as the right-hand panel of the Fleet hub.
 */
export default function DeploymentDetail({ dep, onChanged, onDeleted }: {
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
  const [tab, setTab] = useState<"overview" | "runs" | "triggers" | "api">("overview");
  const [copied, setCopied] = useState("");
  const [openAgent, setOpenAgent] = useState<number | null>(null);
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

  useEffect(() => {
    setSelected(dep); setTab("overview"); setOpenAgent(null); setTestInputs({}); setTestResult(null); setTesting(false);
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
    setTab("overview"); setTesting(true); setTestResult(null);
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

  const agents = selected.config?.agents || [];
  const paused = selected.status === "paused";
  const hasInputs = !!(selected.inputs && selected.inputs.length);
  const inputsReady = !(selected.inputs || []).some(k => !(testInputs[k]?.trim()));

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "runs", label: "Runs" },
    { id: "triggers", label: `Triggers${triggers.length ? ` (${triggers.length})` : ""}` },
    { id: "api", label: "API" },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — identity + primary action + quiet controls */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-slate-100 truncate">{selected.name}</h3>
          <span className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 border ${paused ? "text-amber-300 bg-amber-500/12 border-amber-500/20" : "text-emerald-300 bg-emerald-500/12 border-emerald-500/20"}`}>
            <span className={`h-1 w-1 rounded-full ${paused ? "bg-amber-400" : "bg-emerald-400"}`} /> {paused ? "Offline" : "Live"}
          </span>
          <span className="text-[9px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">v{selected.version || 1}</span>
        </div>
        <button onClick={runTest} disabled={testing || (hasInputs && !inputsReady)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 transition-all shrink-0"
          data-tooltip={hasInputs && !inputsReady ? "Fill the inputs in Overview first" : "Run this deployment now"}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
        </button>
        <button onClick={toggleStatus} disabled={statusBusy}
          className={`p-1.5 rounded-lg transition-all shrink-0 ${paused ? "text-emerald-300 hover:bg-emerald-500/10" : "text-amber-300 hover:bg-amber-500/10"}`}
          data-tooltip={paused ? "Bring online" : "Take offline"}>
          {statusBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paused ? <PlayCircle className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
        </button>
        <button onClick={remove} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0" data-tooltip="Delete deployment"><Trash className="h-3.5 w-3.5" /></button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-white/[0.06] shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`relative px-3 py-2 text-[12px] font-medium transition-colors ${tab === t.id ? "text-violet-200" : "text-slate-500 hover:text-slate-300"}`}>
            {t.label}
            {tab === t.id && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-violet-400" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* ── Overview ── */}
        {tab === "overview" && (
          <div className="h-full overflow-y-auto px-5 py-4 space-y-5">
            {selected.release_notes && (
              <p className="text-[12px] text-slate-400 leading-relaxed">{selected.release_notes}</p>
            )}

            {/* Metric cards */}
            <div>
              {!metrics ? (
                <div className="flex items-center gap-2 text-[11px] text-slate-600 py-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading metrics…</div>
              ) : metrics.totalCalls === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <StatCard label="Calls" value="0" />
                  <StatCard label="Success" value="—" />
                  <StatCard label="Avg latency" value="—" />
                  <StatCard label="Cost" value="$0" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <StatCard label="Calls" value={metrics.totalCalls.toLocaleString()} />
                    <StatCard label="Success" value={metrics.successRate != null ? `${Math.round(metrics.successRate * 100)}%` : "—"} accent={metrics.byStatus?.failed ? "amber" : "emerald"} />
                    <StatCard label="Avg latency" value={metrics.avg?.durationMs ? `${(metrics.avg.durationMs / 1000).toFixed(1)}s` : "—"} />
                    <StatCard label="Cost" value={`$${(metrics.totals?.cost || 0).toFixed(3)}`} />
                  </div>
                  {(() => {
                    const tl = metrics.timeline || [];
                    const maxC = Math.max(1, ...tl.map((d: any) => d.calls));
                    return (
                      <div className="flex items-end gap-1 h-10" data-tooltip="Calls · last 14 days">
                        {tl.map((d: any) => {
                          const ok = d.calls - d.failures;
                          return (
                            <div key={d.date} className="flex-1 flex flex-col justify-end h-full" data-tooltip={`${d.date}: ${d.calls} call(s)${d.failures ? `, ${d.failures} failed` : ""}`}>
                              {d.failures > 0 && <div className="w-full bg-red-500/70 rounded-t-sm" style={{ height: `${(d.failures / maxC) * 100}%` }} />}
                              {ok > 0 && <div className={`w-full bg-emerald-500/55 ${d.failures > 0 ? "" : "rounded-t-sm"}`} style={{ height: `${(ok / maxC) * 100}%` }} />}
                              {d.calls === 0 && <div className="w-full bg-white/[0.04] rounded-t-sm" style={{ height: "2px" }} />}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* What it does — goal + agent pipeline */}
            {selected.config && (
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5">What it does</div>
                {selected.config.goal && <p className="text-[12px] text-slate-400 leading-relaxed mb-2.5">{selected.config.goal}</p>}
                {agents.length > 0 && (
                  <>
                    <div className="flex items-center gap-1 flex-wrap">
                      {agents.map((a, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <ChevronRight className="h-3 w-3 text-slate-700 shrink-0" />}
                          <button onClick={() => setOpenAgent(openAgent === i ? null : i)}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] transition-all ${agentColor(a.type)} ${openAgent === i ? "ring-1 ring-white/20" : "hover:brightness-125"}`}>
                            <span className="font-medium">{a.role || `Agent ${i + 1}`}</span>
                            {a.type && <span className="opacity-60 text-[9px] uppercase tracking-wide">{a.type}</span>}
                          </button>
                        </span>
                      ))}
                    </div>
                    {openAgent != null && agents[openAgent]?.instructions && (
                      <div className="mt-2 rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2 text-[11px] text-slate-400 leading-relaxed animate-fade-in">
                        <span className="text-slate-300 font-medium">{agents[openAgent].role || `Agent ${openAgent + 1}`}: </span>
                        {agents[openAgent].instructions}
                      </div>
                    )}
                    <p className="text-[9px] text-slate-600 mt-1.5">{selected.config.pattern || "sequential"} · click an agent to see its instructions</p>
                  </>
                )}
              </div>
            )}

            {/* Run inputs + result */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-2"><Play className="h-3 w-3 text-violet-400" /><span className="text-[11px] font-semibold text-slate-300">Run it</span><span className="text-[9px] text-slate-500">— as owner, no token needed</span></div>
              {hasInputs && (
                <div className="space-y-1.5 mb-2.5">
                  {selected.inputs!.map(k => (
                    <div key={k}>
                      <label className="text-[9px] text-violet-300 font-medium block mb-0.5">{k}</label>
                      <input value={testInputs[k] || ""} onChange={e => setTestInputs(p => ({ ...p, [k]: e.target.value }))} placeholder={`Value for {${k}}…`} className="w-full !py-1.5 !px-2.5 !text-[12px] !bg-[#08080f] !border-white/[0.06]" />
                    </div>
                  ))}
                </div>
              )}
              <button onClick={runTest} disabled={testing || (hasInputs && !inputsReady)} className="w-full flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all">
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
          </div>
        )}

        {/* ── Runs ── */}
        {tab === "runs" && (
          <ExecutionsFeed key={selected.id} initialQuery={selected.name} />
        )}

        {/* ── Triggers ── */}
        {tab === "triggers" && (
          <div className="h-full overflow-y-auto px-5 py-4 space-y-3">
            <p className="text-[11px] text-slate-500">Run this deployment automatically on a schedule or via a webhook URL.</p>
            {triggers.length > 0 && (
              <div className="space-y-1.5">
                {triggers.map(t => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
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
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3">
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
                <p className="text-[10px] text-slate-500 mb-2 leading-relaxed">Generates a secret URL — POST to it to run the deployment from any external system.</p>
              )}
              {hasInputs && (
                <div className="space-y-1.5 mb-2">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide">Default inputs</div>
                  {selected.inputs!.map(k => (
                    <input key={k} value={trigInputs[k] || ""} onChange={e => setTrigInputs(p => ({ ...p, [k]: e.target.value }))} placeholder={`{${k}}…`} className="w-full !py-1.5 !px-2.5 !text-[12px] !bg-[#08080f] !border-white/[0.06]" />
                  ))}
                </div>
              )}
              {trigError && <p className="text-[10px] text-red-400 mb-1.5">{trigError}</p>}
              <button onClick={addTrigger} disabled={addingTrigger} className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-violet-200 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/25 rounded-lg transition-all disabled:opacity-40">
                {addingTrigger ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add {trigType} trigger
              </button>
            </div>
          </div>
        )}

        {/* ── API ── */}
        {tab === "api" && (
          <div className="h-full overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1"><Globe className="h-3 w-3 text-sky-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Endpoint</span></div>
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2">
                <code className="flex-1 text-[11px] text-sky-300 break-all">POST {apiOrigin}{selected.endpoint}</code>
                <button onClick={() => copy(`${apiOrigin}${selected.endpoint}`, "ep")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "ep" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
              </div>
            </div>

            {hasInputs && (
              <div>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Expected inputs</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {selected.inputs!.map(k => <span key={k} className="text-[11px] text-violet-200 bg-violet-500/12 border border-violet-500/15 px-2 py-0.5 rounded">{k}</span>)}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <KeyRound className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <p className="flex-1 text-[10.5px] text-slate-400 leading-relaxed">Calls require the <span className="text-amber-300">bearer token</span> shown once at publish. Lost it? Rotate to issue a new one (the old token stops working).</p>
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

            <div>
              <div className="flex items-center gap-1.5 mb-1"><Terminal className="h-3 w-3 text-slate-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Call it</span></div>
              <div className="relative rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                <button onClick={() => copy(curlFor(selected), "curl")} className="absolute top-2 right-2 text-slate-500 hover:text-slate-200">{copied === "curl" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                <pre className="text-[10.5px] text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">{curlFor(selected)}</pre>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Activity className="h-3 w-3" /> <span className="text-slate-300 font-semibold tabular-nums">{selected.run_count ?? selected.runs ?? 0}</span> total API calls — see the <button onClick={() => setTab("runs")} className="text-violet-400 hover:text-violet-300">Runs tab</button>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
