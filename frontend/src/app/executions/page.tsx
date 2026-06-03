"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  History, RefreshCw, Search, CheckCircle2, XCircle, Loader2, PauseCircle,
  X, Rocket, Bot, Zap, DollarSign, ArrowUpRight, Activity, Play, Link2, Clock,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { renderMarkdown } from "@/components/markdown";

interface RunSummary {
  id: string;
  source: "builder" | "api" | "test" | "webhook" | "schedule";
  status: string;
  label: string;
  workflowId?: string;
  versionId?: string;
  deploymentId?: string;
  metrics?: { tokens: number; cost: number; turns: number; duration: number } | null;
  feedback?: { rating: string | null; comment: string } | null;
  answerPreview?: string;
  createdAt?: number;
  completedAt?: number;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-400" />,
  running: <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />,
  waiting: <PauseCircle className="h-3.5 w-3.5 text-amber-400" />,
  cancelled: <XCircle className="h-3.5 w-3.5 text-slate-500" />,
};

function fmtDate(ms?: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function ExecutionsPage() {
  const BASE = getApiUrl();
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      if (q.trim()) params.set("q", q.trim());
      const r = await fetch(`${BASE}/runs?${params.toString()}`, { headers: th });
      const d = await r.json();
      setRuns(d.runs || []);
      setTotal(d.total || 0);
    } catch { setRuns([]); }
    finally { setLoading(false); }
  }, [BASE, th, status, source, q]);

  useEffect(() => { fetchRuns(); /* eslint-disable-next-line */ }, [status, source]);
  // initial load
  useEffect(() => { fetchRuns(); /* eslint-disable-next-line */ }, []);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await fetch(`${BASE}/runs/${id}`, { headers: th });
      setDetail(await r.json());
    } catch { setDetail({ error: "Failed to load" }); }
    finally { setDetailLoading(false); }
  }, [BASE, th]);

  const stats = useMemo(() => {
    const completed = runs.filter(r => r.status === "completed").length;
    const failed = runs.filter(r => r.status === "failed").length;
    const tokens = runs.reduce((a, r) => a + (r.metrics?.tokens || 0), 0);
    const cost = runs.reduce((a, r) => a + (r.metrics?.cost || 0), 0);
    return { completed, failed, tokens, cost };
  }, [runs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] shrink-0">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center">
          <History className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Executions</h1>
          <p className="text-[11px] text-slate-500">Every run — builder sessions and live deployment API calls</p>
        </div>
        <button onClick={fetchRuns} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 border border-white/[0.06] transition-all">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Stat chips */}
      <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-white/[0.04] shrink-0">
        <Chip icon={<Activity className="h-3 w-3" />} label="Runs" value={String(total)} />
        <Chip icon={<CheckCircle2 className="h-3 w-3 text-emerald-400" />} label="Completed" value={String(stats.completed)} />
        <Chip icon={<XCircle className="h-3 w-3 text-red-400" />} label="Failed" value={String(stats.failed)} />
        <Chip icon={<Zap className="h-3 w-3 text-amber-400" />} label="Tokens" value={stats.tokens.toLocaleString()} />
        <Chip icon={<DollarSign className="h-3 w-3 text-emerald-400" />} label="Cost" value={`$${stats.cost.toFixed(3)}`} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchRuns()}
            placeholder="Search workflow / output…" className="w-full !pl-8 !py-1.5 !text-[12px]" />
        </div>
        <select value={source} onChange={e => setSource(e.target.value)} className="!py-1.5 !text-[12px] !px-2.5">
          <option value="">All sources</option>
          <option value="builder">Builder</option>
          <option value="api">Deployment API</option>
          <option value="test">Owner test</option>
          <option value="webhook">Webhook</option>
          <option value="schedule">Schedule</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="!py-1.5 !text-[12px] !px-2.5">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="waiting">Waiting</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && runs.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-600 text-xs gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : runs.length === 0 ? (
          <div className="text-center py-16">
            <History className="h-10 w-10 text-slate-800 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No executions yet</p>
            <p className="text-[11px] text-slate-600 mt-1">Run a workflow or call a deployment to see it here</p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[#0a0a12] z-10">
              <tr className="text-[10px] uppercase tracking-wide text-slate-600 border-b border-white/[0.05]">
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium px-2 py-2">Workflow / Deployment</th>
                <th className="text-left font-medium px-2 py-2">Source</th>
                <th className="text-right font-medium px-2 py-2">Duration</th>
                <th className="text-right font-medium px-2 py-2">Tokens</th>
                <th className="text-right font-medium px-2 py-2">Cost</th>
                <th className="text-right font-medium px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} onClick={() => openDetail(r.id)}
                  className={`border-b border-white/[0.03] cursor-pointer transition-colors ${selectedId === r.id ? "bg-violet-500/10" : "hover:bg-white/[0.025]"}`}>
                  <td className="px-4 py-2.5"><div className="flex items-center gap-1.5">{STATUS_ICON[r.status] || STATUS_ICON.cancelled}<span className="text-slate-400 capitalize text-[11px]">{r.status}</span></div></td>
                  <td className="px-2 py-2.5">
                    <div className="text-slate-200 truncate max-w-[260px]">{r.label || "—"}</div>
                    {r.answerPreview && <div className="text-[10px] text-slate-600 truncate max-w-[260px]">{r.answerPreview}</div>}
                  </td>
                  <td className="px-2 py-2.5">
                    {r.source === "api" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-sky-300 bg-sky-500/10 border border-sky-500/15 px-1.5 py-0.5 rounded"><Rocket className="h-2.5 w-2.5" /> API</span>
                    ) : r.source === "test" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded"><Play className="h-2.5 w-2.5" /> Test</span>
                    ) : r.source === "webhook" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-sky-300 bg-sky-500/10 border border-sky-500/15 px-1.5 py-0.5 rounded"><Link2 className="h-2.5 w-2.5" /> Webhook</span>
                    ) : r.source === "schedule" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-violet-300 bg-violet-500/10 border border-violet-500/15 px-1.5 py-0.5 rounded"><Clock className="h-2.5 w-2.5" /> Schedule</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-violet-300 bg-violet-500/10 border border-violet-500/15 px-1.5 py-0.5 rounded"><Bot className="h-2.5 w-2.5" /> Builder</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right text-slate-400 tabular-nums">{r.metrics?.duration ? `${(r.metrics.duration / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="px-2 py-2.5 text-right text-slate-400 tabular-nums">{r.metrics?.tokens?.toLocaleString() || "—"}</td>
                  <td className="px-2 py-2.5 text-right text-slate-400 tabular-nums">{r.metrics?.cost ? `$${r.metrics.cost.toFixed(3)}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 text-[11px] whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail drawer */}
      {selectedId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedId(null)} />
          <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-xl bg-[#0c0c14] border-l border-white/[0.08] shadow-2xl shadow-black/50 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {detail && (STATUS_ICON[detail.status] || STATUS_ICON.cancelled)}
                <h3 className="text-sm font-semibold text-slate-200 truncate">{detail?.deploymentName || detail?.label || "Run detail"}</h3>
              </div>
              <button onClick={() => setSelectedId(null)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {detailLoading ? (
                <div className="flex items-center gap-2 text-slate-600 text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : !detail || detail.error ? (
                <p className="text-xs text-red-400">Failed to load run.</p>
              ) : (
                <>
                  {/* Metrics */}
                  <div className="grid grid-cols-4 gap-2">
                    <Metric label="Tokens" value={detail.metrics?.tokens?.toLocaleString() || "0"} />
                    <Metric label="Cost" value={`$${(detail.metrics?.cost || 0).toFixed(4)}`} />
                    <Metric label="Turns" value={String(detail.metrics?.turns ?? "—")} />
                    <Metric label="Duration" value={detail.metrics?.duration ? `${(detail.metrics.duration / 1000).toFixed(1)}s` : "—"} />
                  </div>

                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="text-slate-500">Started <span className="text-slate-300">{fmtDate(detail.createdAt)}</span></span>
                    {detail.source === "builder" && detail.workflowId && (
                      <Link href={`/agents?wf=${detail.workflowId}${detail.versionId ? `&v=${detail.versionId}` : ""}&r=${detail.id}`} className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300">Open in builder <ArrowUpRight className="h-2.5 w-2.5" /></Link>
                    )}
                    {detail.taskId && (
                      <Link href={`/observability?task=${detail.taskId}`} className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300">View full trace <ArrowUpRight className="h-2.5 w-2.5" /></Link>
                    )}
                  </div>

                  {/* Inputs (api runs) */}
                  {detail.inputs && Object.keys(detail.inputs).length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Inputs</div>
                      <div className="rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2 space-y-1">
                        {Object.entries(detail.inputs).map(([k, v]) => (
                          <div key={k} className="flex gap-2 text-[11px]"><span className="text-sky-300 font-medium">{k}</span><span className="text-slate-400 truncate">{String(v)}</span></div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {detail.error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-[11px] text-red-300">{detail.error}</div>
                  )}

                  {/* Answer */}
                  {detail.answer && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Output</div>
                      <div className="rounded-lg border border-white/[0.06] bg-[#08080f] px-3.5 py-3 text-[12px] text-slate-300 leading-relaxed prose-tight max-w-none">
                        {renderMarkdown(String(detail.answer))}
                      </div>
                    </div>
                  )}

                  {/* Feedback */}
                  {detail.feedback?.rating && (
                    <div className="text-[11px] text-slate-400">Feedback: <span className={detail.feedback.rating === "good" ? "text-emerald-400" : "text-red-400"}>{detail.feedback.rating}</span>{detail.feedback.comment ? ` — ${detail.feedback.comment}` : ""}</div>
                  )}

                  {/* Live event timeline */}
                  {Array.isArray(detail.liveEvents) && detail.liveEvents.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Timeline ({detail.liveEvents.length})</div>
                      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                        {detail.liveEvents.map((ev: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-[10.5px]">
                            <span className="h-1 w-1 rounded-full bg-slate-600 mt-1.5 shrink-0" />
                            <span className="text-slate-500 shrink-0">{ev.type || ev.event || "event"}</span>
                            <span className="text-slate-400 truncate">{ev.agent || ev.role || ev.tool || ev.message || ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.025] border border-white/[0.05]">
      {icon}
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className="text-[11px] font-semibold text-slate-200 tabular-nums">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-center">
      <div className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-[12px] font-semibold text-slate-200 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
