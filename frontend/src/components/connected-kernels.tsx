"use client";
import { apiFetch } from "@/lib/api";
import { getApiUrl } from "@/lib/api-url";
import { useApi } from "@/hooks/useApi";
import { usePolling } from "@/hooks/usePolling";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  Cpu, RefreshCw, Plus, Copy, CheckCheck, Trash, Server, KeyRound,
  ChevronRight, ChevronDown, Activity, ArrowUpRight, Play, Zap, Lock,
  CheckCircle2, XCircle,
} from "lucide-react";
import { useTenant } from "@/context/tenant";
import { Spinner } from "@/components/ui/Spinner";

interface Instance { instance_id: string; name: string; project: string; host?: string; pid?: number; last_seen?: number; registered_at?: number; tasks_ingested?: number; allow_control?: boolean; live: boolean; }
interface KeyRow { key_preview: string; label: string; project: string; created_at?: number; }

function ago(ms?: number) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/**
 * "Connected kernels" — embedded kernelmcp instances that report to this self-hosted
 * Hub via connect_hub(). Lists live instances + their recent runs, and mints the hub
 * key + the connect snippet. Read-only telemetry (Phase 1: monitor).
 */
export default function ConnectedKernels() {
  const apiOrigin = getApiUrl().replace(/\/$/, "");
  const { tenant } = useTenant();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, any[]>>({});
  const [commands, setCommands] = useState<Record<string, any[]>>({});
  const [runGoal, setRunGoal] = useState("");
  const [cmdBusy, setCmdBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [newProject, setNewProject] = useState("prod");
  const [newLabel, setNewLabel] = useState("");
  const [minting, setMinting] = useState(false);
  const [freshKey, setFreshKey] = useState<{ key: string; project: string } | null>(null);

  const { data, loading, refresh } = useApi<{ instances: Instance[]; keys: KeyRow[] }>(
    async () => {
      // Per-endpoint catch keeps the panel partially alive if one call fails.
      const [ri, rk] = await Promise.all([
        apiFetch<{ instances?: Instance[] }>("/hub/instances", { tenant }).catch(() => ({ instances: [] })),
        apiFetch<{ keys?: KeyRow[] }>("/hub/keys", { tenant }).catch(() => ({ keys: [] })),
      ]);
      return { instances: ri.instances || [], keys: rk.keys || [] };
    },
    { poll: 10000, deps: [tenant], initialData: { instances: [], keys: [] } }
  );
  const instances = data?.instances ?? [];
  const keys = data?.keys ?? [];

  const loadRuns = useCallback(async (id: string) => {
    try { const d = await apiFetch<{ runs?: any[] }>(`/hub/instances/${id}/runs`, { tenant }); setRuns(p => ({ ...p, [id]: d.runs || [] })); }
    catch { /* ignore */ }
  }, [tenant]);

  const loadCommands = useCallback(async (id: string) => {
    try { const d = await apiFetch<{ commands?: any[] }>(`/hub/instances/${id}/commands`, { tenant }); setCommands(p => ({ ...p, [id]: d.commands || [] })); }
    catch { /* ignore */ }
  }, [tenant]);

  const sendCmd = useCallback(async (id: string, type: string, args: any = {}) => {
    setCmdBusy(true);
    try {
      await apiFetch(`/hub/instances/${id}/commands`, { method: "POST", tenant, body: { type, args } });
      await loadCommands(id); // show it as pending; the expanded poll updates status + new runs
    } catch {} finally { setCmdBusy(false); }
  }, [tenant, loadCommands]);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => (prev === id ? null : id));
  }, []);

  // Poll the expanded instance's runs + command statuses (fires immediately on expand,
  // pauses while the tab is hidden, stops entirely when nothing is expanded).
  usePolling(() => {
    if (expanded) { loadRuns(expanded); loadCommands(expanded); }
  }, expanded ? 5000 : null, [expanded]);

  const mintKey = useCallback(async () => {
    setMinting(true); setFreshKey(null);
    try {
      const d = await apiFetch<{ key?: string; project: string }>("/hub/keys", { method: "POST", tenant, body: { label: newLabel.trim() || "kernel", project: newProject.trim() || "default" } });
      if (d.key) { setFreshKey({ key: d.key, project: d.project }); refresh(); }
    } catch {} finally { setMinting(false); }
  }, [newLabel, newProject, tenant, refresh]);

  const deleteKey = useCallback(async (preview: string) => {
    const prefix = preview.split("…")[0];
    try { await apiFetch(`/hub/keys/${encodeURIComponent(prefix)}`, { method: "DELETE", tenant }); } catch {}
    refresh();
  }, [tenant, refresh]);

  const copy = (text: string, k: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };

  const snippet = (key: string, project: string) =>
    `from kernelmcp import KernelFactory, connect_hub\n\nkernel = KernelFactory.create(...)\nawait connect_hub(\n    kernel,\n    hub_url="${apiOrigin}",\n    project="${project}",\n    api_key="${key}",\n    # allow_control=True,  # opt in to let the Hub send ping/stats/run/config commands\n)`;

  const liveCount = instances.filter(i => i.live).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06] shrink-0">
        <Server className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-slate-200">Connected kernels</h3>
        <span className="text-[10px] text-slate-500">{liveCount} live · {instances.length} total</span>
        <button onClick={refresh} className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"><Spinner icon={RefreshCw} spinning={loading} className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Kernels you embed in your own apps can report their traces here via <code className="text-violet-300">connect_hub()</code> — outbound only, no inbound port needed. They show up with their runs, and each trace opens in Observability. Telemetry is read-only (monitoring).
        </p>

        {/* Instances */}
        <div>
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Instances</div>
          {loading && instances.length === 0 ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-600 py-2"><Spinner className="h-3.5 w-3.5" /> Loading…</div>
          ) : instances.length === 0 ? (
            <p className="text-[11px] text-slate-600 py-2">No kernels connected yet. Mint a key below and call <code className="text-violet-300">connect_hub()</code> from your app.</p>
          ) : (
            <div className="space-y-1.5">
              {instances.map((inst, i) => (
                <div key={inst.instance_id} style={{ animationDelay: `${i * 30}ms` }} className="animate-stagger rounded-lg border border-white/[0.06] bg-white/[0.015] overflow-hidden">
                  <button onClick={() => toggle(inst.instance_id)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors text-left">
                    {expanded === inst.instance_id ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${inst.live ? "bg-emerald-400" : "bg-slate-600"}`} />
                    <Cpu className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                    <span className="text-[12px] text-slate-200 truncate">{inst.name}</span>
                    <span className="text-[9px] text-violet-300/80 bg-violet-500/10 px-1.5 py-0.5 rounded shrink-0">{inst.project}</span>
                    <span className="ml-auto text-[9px] text-slate-500 shrink-0">{inst.tasks_ingested || 0} runs · {inst.live ? "live" : ago(inst.last_seen)}</span>
                  </button>
                  {expanded === inst.instance_id && (
                    <div className="px-3 pb-2.5 border-t border-white/[0.04]">
                      <div className="flex items-center gap-2 text-[9px] text-slate-600 mt-1.5 mb-1">
                        {inst.host && <span>host {inst.host}</span>}{inst.pid && <span>· pid {inst.pid}</span>}<span>· since {ago(inst.registered_at)}</span>
                      </div>
                      {(runs[inst.instance_id] || []).length === 0 ? (
                        <p className="text-[10px] text-slate-600 py-1">No runs reported yet.</p>
                      ) : (runs[inst.instance_id] || []).map(r => (
                        <Link key={r.id} href={`/observability?task=${r.id}`} className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-white/[0.03] group">
                          <span className={`h-1 w-1 rounded-full shrink-0 ${r.status === "failed" ? "bg-red-400" : "bg-emerald-400"}`} />
                          <span className="text-[11px] text-slate-300 truncate flex-1">{r.goal}</span>
                          <span className="text-[9px] text-slate-600 shrink-0 tabular-nums">{(r.tokens || 0).toLocaleString()} tok</span>
                          <ArrowUpRight className="h-3 w-3 text-slate-600 group-hover:text-violet-400 shrink-0" />
                        </Link>
                      ))}

                      {/* Control panel — only if the kernel opted into control */}
                      <div className="mt-2.5 pt-2.5 border-t border-white/[0.04]">
                        {!inst.allow_control ? (
                          <p className="flex items-center gap-1.5 text-[10px] text-slate-600"><Lock className="h-3 w-3" /> Control disabled — connect with <code className="text-slate-500">allow_control=True</code> to send commands.</p>
                        ) : (
                          <>
                            <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-1.5">Health &amp; ops checks</p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button onClick={() => sendCmd(inst.instance_id, "ping")} disabled={cmdBusy} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg border border-white/[0.07] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"><Zap className="h-3 w-3" /> Ping</button>
                              <button onClick={() => sendCmd(inst.instance_id, "stats")} disabled={cmdBusy} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg border border-white/[0.07] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"><Activity className="h-3 w-3" /> Stats</button>
                              <div className="flex items-center gap-1 flex-1 min-w-[160px]">
                                <input value={runGoal} onChange={e => setRunGoal(e.target.value)} placeholder="goal for a smoke test…" className="flex-1 !py-1 !px-2 !text-[10.5px] !bg-[#08080f] !border-white/[0.06]" />
                                <button onClick={() => { if (runGoal.trim()) { sendCmd(inst.instance_id, "run", { goal: runGoal.trim() }); setRunGoal(""); } }} disabled={cmdBusy || !runGoal.trim()} title="Fires a one-off goal to verify the kernel actually executes (LLM key, engine, tools). Not how you drive production runs — use the embedding app or a Deployment for that." className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600">{cmdBusy ? <Spinner className="h-3 w-3" /> : <Play className="h-3 w-3" />} Test run</button>
                              </div>
                            </div>
                            <p className="text-[9px] text-slate-600 mt-1.5">A smoke test — proves the kernel is truly operational. Production runs are driven by the embedding app or a Deployment.</p>
                            {(commands[inst.instance_id] || []).length > 0 && (
                              <div className="mt-2 space-y-1">
                                {(commands[inst.instance_id] || []).slice(0, 6).map((c: any) => (
                                  <div key={c.id} className="flex items-start gap-1.5 text-[10px]">
                                    {c.status === "done" ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" /> : c.status === "failed" ? <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" /> : <Spinner className="h-3 w-3 text-slate-500 shrink-0 mt-0.5" />}
                                    <span className="text-slate-400 shrink-0">{c.type}</span>
                                    <span className="text-slate-600 truncate flex-1">{c.error || (c.result ? JSON.stringify(c.result).slice(0, 80) : c.status)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Connect a kernel */}
        <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] p-3.5 space-y-3">
          <div className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5 text-violet-400" /><span className="text-[11px] font-semibold text-slate-200">Connect a kernel</span></div>
          <div className="flex gap-2">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (e.g. my-app)" className="flex-1 !py-1.5 !px-2.5 !text-[12px]" />
            <input value={newProject} onChange={e => setNewProject(e.target.value)} placeholder="project" className="w-28 !py-1.5 !px-2.5 !text-[12px]" />
            <button onClick={mintKey} disabled={minting} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 rounded-lg transition-all shrink-0">
              {minting ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} Mint key
            </button>
          </div>

          {freshKey && (
            <div className="space-y-2 animate-fade-in">
              <div className="text-[9px] text-amber-400/90">New key — copy it now, it won't be shown in full again:</div>
              <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-[#08080f] px-2.5 py-1.5">
                <code className="flex-1 text-[11px] text-amber-300 break-all">{freshKey.key}</code>
                <button onClick={() => copy(freshKey.key, "key")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "key" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
              </div>
              <div className="relative rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                <button onClick={() => copy(snippet(freshKey.key, freshKey.project), "snip")} className="absolute top-2 right-2 text-slate-500 hover:text-slate-200">{copied === "snip" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                <pre className="text-[10.5px] text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">{snippet(freshKey.key, freshKey.project)}</pre>
              </div>
            </div>
          )}

          {keys.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-slate-600 uppercase tracking-wide">Existing keys</div>
              {keys.map(k => (
                <div key={k.key_preview} className="flex items-center gap-2 text-[11px] text-slate-400">
                  <code className="text-slate-500">{k.key_preview}</code>
                  <span className="text-[9px] text-violet-300/70 bg-violet-500/10 px-1.5 py-0.5 rounded">{k.project}</span>
                  <span className="text-slate-600 truncate flex-1">{k.label}</span>
                  <button onClick={() => deleteKey(k.key_preview)} className="text-slate-600 hover:text-red-400 shrink-0"><Trash className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
