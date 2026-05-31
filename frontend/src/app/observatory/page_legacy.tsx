"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Telescope, RefreshCw, CheckCircle2, XCircle, Zap, DollarSign,
  Clock, Hash, Wrench, Bot, User, MessageSquare, Shield,
  Sparkles, ArrowRight, ChevronDown, AlertTriangle, Coins,
  GitBranch, TrendingUp, Server, Copy, Check,
} from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import EmptyState from "@/components/empty-state";
import CopyButton from "@/components/copy-button";
import TimeAgo from "@/components/time-ago";


// ── Types ──────────────────────────────────────────────────────────────────

interface Analytics {
  tasks_completed: number;
  tasks_failed: number;
  total_tokens: number;
  total_cost: number;
  avg_tokens_per_task: number;
  avg_duration_ms: number;
  top_tools: { name: string; count: number }[];
  top_models: { name: string; count: number }[];
}

interface Stats {
  total_tokens: number;
  total_cost: number;
  tasks_completed: number;
  tasks_failed: number;
  total_turns: number;
  avg_turns_per_task: number;
  connected_servers: number;
  model?: string;
}

interface TaskSummary {
  task_id: string;
  query: string;
  status: string;
  created_at: number;
  duration_ms?: number;
}

interface TraceTurn {
  role: string;
  tool?: string;
  duration_ms?: number;
  tokens?: number;
  success?: boolean;
  content?: string;
}

interface Analysis {
  total_runs: number;
  failed_runs: number;
  slow_runs: number;
  expensive_runs: number;
  suggestions: Suggestion[];
}

interface Suggestion {
  type: string;
  content: string;
  rationale: string;
  confidence: number;
}

interface ApplyResult {
  applied: number;
  details: string[];
}

type Tab = "overview" | "tasks" | "improve";

// ── Styles ─────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, { color: string; bg: string; icon: typeof User }> = {
  user:        { color: "text-blue-400", bg: "bg-blue-500/8 border-blue-500/15", icon: User },
  assistant:   { color: "text-green-400", bg: "bg-green-500/8 border-green-500/15", icon: Bot },
  tool_call:   { color: "text-amber-400", bg: "bg-amber-500/8 border-amber-500/15", icon: Wrench },
  tool_result: { color: "text-slate-400", bg: "bg-white/[0.02] border-white/[0.04]", icon: MessageSquare },
  system:      { color: "text-purple-400", bg: "bg-purple-500/8 border-purple-500/15", icon: Shield },
};

const DEFAULT_ROLE = { color: "text-slate-400", bg: "bg-white/[0.02] border-white/[0.04]", icon: MessageSquare };

const TYPE_COLORS: Record<string, string> = {
  constitution: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  template: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  tool_config: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

// ── Main component ─────────────────────────────────────────────────────────

const BASE = getApiUrl();

export default function ObservatoryPage() {
  return <Suspense><ObservatoryPageInner /></Suspense>;
}

function ObservatoryPageInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);

  // Data
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);

  // Trace state
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceTurn[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);

  // Improve state
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  // ── Data loading ───────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, statsRes, tasksRes] = await Promise.all([
        fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "get_analytics", args: {} }) }).then(r => r.json()).catch(() => null),
        fetch(`${BASE}/stats`).then(r => r.json()).catch(() => null),
        fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "list_tasks", args: {} }) }).then(r => r.json()).catch(() => null),
      ]);
      if (analyticsRes) setAnalytics(analyticsRes.result ?? analyticsRes);
      if (statsRes) setStats(statsRes);
      if (tasksRes) setTasks(tasksRes.result?.tasks ?? tasksRes.tasks ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const fetchTrace = useCallback(async (taskId: string) => {
    setSelectedTask(taskId);
    setTraceLoading(true);
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_trace", args: { task_id: taskId } }),
      });
      const json = await res.json();
      setTrace(json.result?.turns ?? json.turns ?? []);
    } catch { setTrace([]); }
    setTraceLoading(false);
  }, []);

  // Auto-select task from URL param and switch to Tasks tab
  useEffect(() => {
    const urlTask = searchParams.get("task");
    if (urlTask && !selectedTask) {
      setTab("tasks");
      // Fetch trace directly (don't wait for task list to load)
      fetchTrace(urlTask);
      // Also fetch task summary to add to list if missing
      fetch(`${BASE}/tasks/${urlTask}`).then(r => r.ok ? r.json() : null).then(data => {
        if (data && !tasks.some(t => t.task_id === urlTask)) {
          setTasks(prev => [{ task_id: urlTask, query: data.goal || "", status: data.status || "completed", created_at: data.created_at || Date.now(), duration_ms: 0 }, ...prev]);
        }
      }).catch(() => {});
    }
  }, [searchParams]); // eslint-disable-line

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setApplyResult(null);
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "improve", args: { dry_run: true } }),
      });
      const json = await res.json();
      const result = json.result ?? json;
      setAnalysis(result);
      if (result.suggestions) setSelectedSuggestions(new Set(result.suggestions.map((_: unknown, i: number) => i)));
    } catch { /* ignore */ }
    setAnalyzing(false);
  }, []);

  const runApply = useCallback(async () => {
    setApplying(true);
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "improve", args: { dry_run: false } }),
      });
      const json = await res.json();
      setApplyResult(json.result ?? json);
    } catch { /* ignore */ }
    setApplying(false);
  }, []);

  // ── Computed values ────────────────────────────────────────────────────

  const totalTasks = analytics ? analytics.tasks_completed + analytics.tasks_failed : 0;
  const successRate = totalTasks > 0 ? Math.round((analytics!.tasks_completed / totalTasks) * 100) : 0;
  const maxToolCount = analytics?.top_tools?.length ? Math.max(...analytics.top_tools.map(t => t.count)) : 1;
  const hasData = analytics || stats;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] max-w-6xl mx-auto">
      <PageHeader
        icon={Telescope}
        title="Observatory"
        subtitle="Performance, cost, traces, and AI-powered optimization — all in one view"
        actions={[{ label: "Refresh", icon: RefreshCw, onClick: loadAll, loading }]}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 shrink-0">
        {([
          { id: "overview" as Tab, label: "Overview", desc: "Metrics & cost" },
          { id: "tasks" as Tab, label: "Tasks", desc: `${tasks.length} runs` },
          { id: "improve" as Tab, label: "Improve", desc: "AI suggestions" },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
              tab === t.id
                ? "bg-violet-500/12 text-violet-300 border border-violet-500/20 shadow-sm shadow-violet-500/5"
                : "text-slate-500 border border-transparent hover:text-slate-300 hover:bg-white/[0.03]"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[9px] text-slate-600">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && !hasData && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-white/[0.04] p-4">
                <div className="skeleton h-3 w-20 mb-3" />
                <div className="skeleton h-7 w-24" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/[0.04] p-4"><div className="skeleton h-40 w-full" /></div>
            <div className="rounded-xl border border-white/[0.04] p-4"><div className="skeleton h-40 w-full" /></div>
          </div>
        </div>
      )}

      {!loading && !hasData && (
        <EmptyState
          icon={Telescope}
          title="No data yet"
          description="Performance data appears automatically as you use Chat, Agents, or the Scheduler. Send your first message to get started."
          action={{ label: "Open Chat", href: "/chat" }}
        />
      )}

      {/* ── OVERVIEW TAB ──────────────────────────────────────────────── */}
      {tab === "overview" && hasData && (
        <div className="flex-1 overflow-y-auto space-y-5 min-h-0 pb-4">
          {/* Hero metrics row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard icon={CheckCircle2} color="text-emerald-400" bg="bg-emerald-500/8" label="Success Rate" value={`${successRate}%`} sub={`${analytics?.tasks_completed ?? 0} of ${totalTasks} tasks`} />
            <MetricCard icon={DollarSign} color="text-emerald-400" bg="bg-emerald-500/8" label="Total Cost" value={`$${(analytics?.total_cost ?? stats?.total_cost ?? 0).toFixed(4)}`} sub={totalTasks > 0 ? `$${((analytics?.total_cost ?? 0) / totalTasks).toFixed(4)} avg/task` : undefined} />
            <MetricCard icon={Zap} color="text-blue-400" bg="bg-blue-500/8" label="Tokens Used" value={(analytics?.total_tokens ?? stats?.total_tokens ?? 0).toLocaleString()} sub={totalTasks > 0 ? `${Math.round(analytics?.avg_tokens_per_task ?? 0)} avg/task` : undefined} />
            <MetricCard icon={Clock} color="text-amber-400" bg="bg-amber-500/8" label="Avg Duration" value={`${Math.round(analytics?.avg_duration_ms ?? 0)}ms`} sub={`${stats?.total_turns ?? 0} total turns`} />
          </div>

          {/* Two column: success ring + cost breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Success ring + insights */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
              <h3 className="text-xs font-semibold text-slate-300 mb-4">Performance</h3>
              <div className="flex items-center gap-5 mb-4">
                <div className="relative h-20 w-20 shrink-0">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke={successRate >= 80 ? "#10b981" : successRate >= 50 ? "#f59e0b" : "#ef4444"} strokeWidth="3" strokeDasharray={`${successRate} ${100 - successRate}`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-slate-100">{successRate}%</span>
                  </div>
                </div>
                <div className="space-y-2 flex-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Completed</span>
                    <span className="text-emerald-400 font-medium">{analytics?.tasks_completed ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Failed</span>
                    <span className={`font-medium ${(analytics?.tasks_failed ?? 0) > 0 ? "text-red-400" : "text-slate-600"}`}>{analytics?.tasks_failed ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Avg turns/task</span>
                    <span className="text-slate-300 font-medium">{stats?.avg_turns_per_task?.toFixed(1) ?? "—"}</span>
                  </div>
                </div>
              </div>
              {/* Insights */}
              <div className="space-y-1.5 pt-3 border-t border-white/[0.04]">
                {analytics?.top_tools?.[0] && (
                  <p className="text-[11px] text-slate-400">
                    Most used tool: <span className="text-violet-400 font-medium">{analytics.top_tools[0].name}</span> ({analytics.top_tools[0].count} calls)
                  </p>
                )}
                {(analytics?.tasks_failed ?? 0) > 0 && (
                  <p className="text-[11px] text-amber-400">
                    {analytics!.tasks_failed} task{analytics!.tasks_failed > 1 ? "s" : ""} failed —{" "}
                    <button onClick={() => setTab("tasks")} className="underline hover:text-amber-300 transition-colors">view details</button>
                  </p>
                )}
                {stats?.model && (
                  <p className="text-[11px] text-slate-500">
                    Model: <span className="text-slate-300 font-mono">{stats.model}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Right: Cost breakdown */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-slate-300">Cost Breakdown</h3>
                <Link href="/settings" className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">Change model &rarr;</Link>
              </div>
              <div className="space-y-3.5">
                <CostRow label="Cost per 1K tokens" value={(analytics?.total_tokens ?? 0) > 0 ? `$${(((analytics?.total_cost ?? 0) / (analytics?.total_tokens ?? 1)) * 1000).toFixed(5)}` : "—"} color="text-emerald-400" />
                <CostRow label="Avg cost per task" value={totalTasks > 0 ? `$${((analytics?.total_cost ?? 0) / totalTasks).toFixed(4)}` : "—"} color="text-blue-400" />
                <CostRow label="Avg tokens per task" value={totalTasks > 0 ? Math.round((analytics?.total_tokens ?? 0) / totalTasks).toLocaleString() : "—"} color="text-violet-400" />
                <CostRow label="Connected servers" value={String(stats?.connected_servers ?? 0)} color="text-slate-200" pulse />
              </div>
              {/* Total cost highlight */}
              <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Total spend</span>
                <span className="text-lg font-bold text-emerald-400">${(analytics?.total_cost ?? stats?.total_cost ?? 0).toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Top tools + models */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Tools */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
              <h3 className="text-xs font-semibold text-slate-300 mb-3">Top Tools</h3>
              {analytics?.top_tools?.length ? (
                <div className="space-y-2.5">
                  {analytics.top_tools.slice(0, 8).map(t => {
                    const pct = maxToolCount > 0 ? Math.round((t.count / maxToolCount) * 100) : 0;
                    return (
                      <div key={t.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-slate-300 font-mono truncate max-w-[200px]">{t.name}</span>
                          <span className="text-[10px] text-slate-500">{t.count}</span>
                        </div>
                        <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="text-[11px] text-slate-600">No tool usage data yet.</p>}
            </div>

            {/* Top Models */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5">
              <h3 className="text-xs font-semibold text-slate-300 mb-3">Models</h3>
              {analytics?.top_models?.length ? (
                <div className="space-y-2">
                  {analytics.top_models.map(m => (
                    <div key={m.name} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                      <span className="text-[11px] text-slate-300 font-mono">{m.name}</span>
                      <span className="text-[10px] font-medium bg-blue-500/8 text-blue-400 border border-blue-500/15 px-2.5 py-0.5 rounded-full">{m.count} calls</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-slate-600">No model usage data yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── TASKS TAB ─────────────────────────────────────────────────── */}
      {tab === "tasks" && (
        <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
          {/* Task list */}
          <div className="w-72 shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-[#0c0c14] overflow-hidden">
            <div className="px-3 py-2.5 border-b border-white/[0.04]">
              <span className="text-[11px] font-semibold text-slate-300">Recent Tasks</span>
              <span className="text-[10px] text-slate-600 ml-1.5">({tasks.length})</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {tasks.length === 0 && (
                <div className="py-12 text-center">
                  <GitBranch className="h-5 w-5 text-slate-700 mx-auto mb-2" />
                  <p className="text-[11px] text-slate-600">No tasks yet</p>
                </div>
              )}
              {tasks.map(t => (
                <button
                  key={t.task_id}
                  onClick={() => fetchTrace(t.task_id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-white/[0.03] transition-all ${
                    selectedTask === t.task_id ? "bg-violet-500/8" : "hover:bg-white/[0.02]"
                  }`}
                >
                  <p className="text-[11px] text-slate-200 truncate mb-1">{t.query || t.task_id.slice(0, 12)}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${
                      t.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15" :
                      t.status === "failed" ? "bg-red-500/10 text-red-400 border border-red-500/15" :
                      "bg-white/[0.03] text-slate-500 border border-white/[0.06]"
                    }`}>{t.status}</span>
                    {t.created_at && <TimeAgo timestamp={t.created_at} className="text-[9px] text-slate-600" />}
                    {t.duration_ms != null && <span className="text-[9px] text-slate-600">{t.duration_ms}ms</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Trace detail */}
          <div className="flex-1 flex flex-col rounded-xl border border-white/[0.06] bg-[#0c0c14] overflow-hidden">
            <div className="px-3 py-2.5 border-b border-white/[0.04] flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300">
                {selectedTask ? (
                  <span className="flex items-center gap-1.5">
                    Trace <span className="font-mono text-slate-500">{selectedTask.slice(0, 12)}</span>
                    <CopyButton text={selectedTask} />
                  </span>
                ) : "Select a task to view its trace"}
              </span>
              {trace.length > 0 && (
                <span className="text-[9px] text-slate-600">{trace.length} turns</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {!selectedTask && (
                <div className="flex flex-col items-center justify-center py-16">
                  <GitBranch className="h-8 w-8 text-slate-700 mb-3" />
                  <p className="text-[11px] text-slate-500">Click a task on the left to see its execution trace</p>
                </div>
              )}
              {traceLoading && (
                <div className="space-y-2 py-4">
                  {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}
                </div>
              )}
              {selectedTask && !traceLoading && trace.length === 0 && (
                <p className="text-[11px] text-slate-600 text-center py-8">No trace data for this task.</p>
              )}
              {trace.map((turn, i) => {
                const style = ROLE_STYLES[turn.role] || DEFAULT_ROLE;
                const Icon = style.icon;
                return (
                  <details key={i} className={`rounded-lg border ${style.bg} overflow-hidden group`}>
                    <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none select-none hover:bg-white/[0.02] transition-colors">
                      <Icon className={`h-3 w-3 ${style.color} shrink-0`} />
                      <span className={`text-[10px] font-semibold uppercase w-16 shrink-0 ${style.color}`}>{turn.role}</span>
                      {turn.tool && (
                        <span className="text-[9px] font-mono bg-white/[0.04] text-slate-300 px-1.5 py-0.5 rounded border border-white/[0.06]">{turn.tool}</span>
                      )}
                      {turn.duration_ms != null && (
                        <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" /> {turn.duration_ms}ms
                        </span>
                      )}
                      {turn.tokens != null && <span className="text-[9px] text-slate-500">{turn.tokens} tok</span>}
                      <div className="ml-auto flex items-center gap-1.5">
                        {turn.success === true && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                        {turn.success === false && <XCircle className="h-3 w-3 text-red-400" />}
                        <svg className="h-2.5 w-2.5 text-slate-600 transition-transform group-open:rotate-90" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </div>
                    </summary>
                    {turn.content && (
                      <div className="px-3 pb-2.5 pt-1 border-t border-white/[0.03]">
                        <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">{turn.content}</pre>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── IMPROVE TAB ───────────────────────────────────────────────── */}
      {tab === "improve" && (
        <div className="flex-1 overflow-y-auto space-y-4 min-h-0 pb-4">
          {/* Analyze button */}
          <div className="flex items-center gap-2">
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {analyzing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {analyzing ? "Analyzing..." : "Analyze Performance"}
            </button>
            {analysis && analysis.suggestions?.length > 0 && (
              <button
                onClick={runApply}
                disabled={applying || selectedSuggestions.size === 0}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                {applying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                Apply {selectedSuggestions.size} selected
              </button>
            )}
          </div>

          {!analysis && !analyzing && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-8 text-center">
              <Sparkles className="h-8 w-8 text-slate-700 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-300 mb-1">AI-Powered Optimization</h3>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                Click "Analyze Performance" to scan your recent tasks. The meta-agent identifies patterns across failures, slow runs, and expensive tasks to suggest targeted improvements.
              </p>
            </div>
          )}

          {analysis && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat icon={CheckCircle2} color="text-emerald-400" label="Total Runs" value={analysis.total_runs} />
                <MiniStat icon={XCircle} color="text-red-400" label="Failed" value={analysis.failed_runs} />
                <MiniStat icon={Clock} color="text-amber-400" label="Slow" value={analysis.slow_runs} />
                <MiniStat icon={Coins} color="text-cyan-400" label="Expensive" value={analysis.expensive_runs} />
              </div>

              {/* Suggestions */}
              {analysis.suggestions?.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">
                    Suggestions ({analysis.suggestions.length})
                  </h3>
                  {analysis.suggestions.map((s, i) => (
                    <div
                      key={i}
                      className={`rounded-xl border p-4 transition-all ${
                        selectedSuggestions.has(i) ? "bg-white/[0.02] border-violet-500/20" : "bg-white/[0.01] border-white/[0.04] opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedSuggestions.has(i)}
                          onChange={() => {
                            setSelectedSuggestions(prev => {
                              const next = new Set(prev);
                              next.has(i) ? next.delete(i) : next.add(i);
                              return next;
                            });
                          }}
                          className="accent-violet-500 shrink-0"
                        />
                        <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded border ${TYPE_COLORS[s.type] || "bg-white/[0.03] text-slate-400 border-white/[0.06]"}`}>
                          {s.type}
                        </span>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <span className="text-[10px] text-slate-500">{Math.round(s.confidence * 100)}%</span>
                          <div className="w-14 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${s.confidence >= 0.7 ? "bg-emerald-500" : s.confidence >= 0.4 ? "bg-amber-500" : "bg-red-500"}`}
                              style={{ width: `${s.confidence * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-200 mb-1">{s.content}</p>
                      <p className="text-[10px] text-slate-500">{s.rationale}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">No suggestions at this time. Your agent is performing well.</p>
              )}
            </>
          )}

          {/* Apply result */}
          {applyResult && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Applied {applyResult.applied} improvement{applyResult.applied !== 1 ? "s" : ""}
              </h3>
              {applyResult.details?.map((d, i) => (
                <p key={i} className="text-[11px] text-slate-300 ml-5">- {d}</p>
              ))}
              <div className="flex gap-2 mt-3 ml-5">
                <Link href="/settings" className="text-[11px] text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-3 py-1.5 rounded-lg transition-all">View Settings &rarr;</Link>
                <Link href="/chat" className="text-[11px] text-slate-400 hover:text-slate-300 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-lg transition-all">Test in Chat &rarr;</Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, color, bg, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>; color: string; bg: string; label: string; value: string; sub?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/[0.06] ${bg} p-4 card-hover`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function CostRow({ label, value, color, pulse }: { label: string; value: string; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {pulse && <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        <span className={`text-sm font-bold ${color}`}>{value}</span>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, color, label, value }: {
  icon: React.ComponentType<{ className?: string }>; color: string; label: string; value: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3 w-3 ${color}`} />
        <span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
