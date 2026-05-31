"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, RefreshCw, Download, ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";

import MetricsBar from "@/components/execution/MetricsBar";
import ExecutionGraph from "@/components/execution/ExecutionGraph";
import StepDetail from "@/components/execution/StepDetail";
import { useExecutionStore } from "@/stores/execution";
import { useTaskStream } from "@/hooks/useTaskStream";
import { useTenant, tenantHeaders } from "@/context/tenant";

import TaskInputBar from "@/components/observability/TaskInputBar";
import EventsPanel from "@/components/observability/EventsPanel";
import { useAuditStore } from "@/stores/audit";
import TraceWaterfall from "@/components/observability/TraceWaterfall";
import OverviewDashboard from "@/components/observability/OverviewDashboard";
import { type TaskSummary } from "@/components/observability/TaskHistoryList";
import HistorySidebar from "@/components/observability/HistorySidebar";
import BottomDrawer from "@/components/observability/BottomDrawer";
import ReviewQueue from "@/components/observability/ReviewQueue";
import InsightsPanel from "@/components/observability/InsightsPanel";
import ImprovePanel from "@/components/observability/ImprovePanel";
import ExportRetentionDialog from "@/components/observability/ExportRetentionDialog";
import RunStats from "@/components/observability/RunStats";
import { ChartGrid, LatencyAnalytics, CostBreakdown } from "./charts";
import { AlertBell, AlertsPanel } from "./alerts";

import { RegressionPanel } from "./studio";


// ── Types ───────────────────────────────────────────────────────────────────

type PageMode = "dashboard" | "trace";

interface Analytics {
  tasks_completed: number; tasks_failed: number; total_tokens: number;
  total_cost: number; avg_tokens_per_task: number; avg_duration_ms: number;
  top_tools: { name: string; count: number }[];
  top_models: { name: string; count: number }[];
}

interface Stats {
  total_tokens: number; total_cost: number; tasks_completed: number;
  tasks_failed: number; total_turns: number; avg_turns_per_task: number;
  connected_servers: number; model?: string;
}

// ── Main Export ─────────────────────────────────────────────────────────────

export default function ObservabilityPage() {
  return <Suspense><ObservabilityInner /></Suspense>;
}

// ── Inner Component ────────────────────────────────────────────────────────

function ObservabilityInner() {
  const BASE = getApiUrl();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  // ── Page mode ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<PageMode>("dashboard");

  // ── Execution state ────────────────────────────────────────────────────
  const [goal, setGoal] = useState("");
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const { status, disconnect } = useTaskStream(taskId, tenant);

  // Store selectors
  const executionEvents = useExecutionStore(s => s.events);
  const viewState = useExecutionStore(s => s.viewState);
  const activeEventId = useExecutionStore(s => s.activeEventId);
  const drawerOpen = useExecutionStore(s => s.drawerOpen);
  const reset = useExecutionStore(s => s.reset);
  const setViewState = useExecutionStore(s => s.setViewState);
  const setActiveEvent = useExecutionStore(s => s.setActiveEvent);
  const setDrawerOpen = useExecutionStore(s => s.setDrawerOpen);

  // ── Audit state (global store — persists across page navigations) ────
  const auditEvents = useAuditStore(s => s.events);
  const taskChangeCounter = useAuditStore(s => s.taskChangeCounter);
  const [viewMode, setViewMode] = useState<"task" | "all">("task");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [textFilter, setTextFilter] = useState("");

  // Auto-switch to "This Task" view when a node/event is selected from the graph
  useEffect(() => {
    if (activeEventId && viewMode === "all") setViewMode("task");
  }, [activeEventId]); // eslint-disable-line

  // ── Analytics state ────────────────────────────────────────────────────
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // ── UI state ───────────────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Trace mode: right panel sub-tab ────────────────────────────────────
  const [traceSub, setTraceSub] = useState<"events" | "spans" | "stats">("events");

  // ── Dashboard mode: right panel sub-tab ────────────────────────────────
  const [dashSub, setDashSub] = useState<"alerts" | "queue" | "insights">("alerts");

  // ── Task history state ─────────────────────────────────────────────────
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Polling fallback ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Derived state ──────────────────────────────────────────────────────
  const isLive = viewState === "running";
  const isDone = viewState === "completed" || viewState === "reviewing";

  // ── Load analytics on mount ────────────────────────────────────────────

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [analyticsRes, statsRes, tasksRes] = await Promise.all([
        fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ tool: "get_analytics", args: {} }) }).then(r => r.json()).catch(() => null),
        fetch(`${BASE}/stats`, { headers: th }).then(r => r.json()).catch(() => null),
        fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ tool: "list_tasks", args: {} }) }).then(r => r.json()).catch(() => null),
      ]);
      if (analyticsRes?.result) setAnalytics(analyticsRes.result);
      if (statsRes) setStats(statsRes);
      if (tasksRes?.result?.tasks) {
        setTasks(tasksRes.result.tasks.map((t: any) => {
          // Stale "running" tasks (> 5min old) are likely crashed — show as failed
          let status = t.status || "completed";
          if (status === "running" && t.created_at) {
            const age = Date.now() / 1000 - t.created_at;
            if (age > 300) status = "failed";
          }
          return {
            id: t.task_id,
            goal: t.query || t.task_id.slice(0, 12),
            status,
            startedAt: new Date(t.created_at * 1000).toISOString(),
            durationMs: t.duration_ms,
          };
        }));
      }
    } catch { /* ignore */ }
    setAnalyticsLoading(false);
  }, [th]);

  useEffect(() => { loadAnalytics(); }, []); // eslint-disable-line

  // Refresh analytics when returning to dashboard
  useEffect(() => {
    if (mode === "dashboard") loadAnalytics();
  }, [mode]); // eslint-disable-line

  // Reactive task list refresh — triggers instantly when any task starts/completes/fails (via SSE)
  useEffect(() => {
    if (taskChangeCounter === 0) return; // skip initial
    fetch(`${BASE}/api/tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify({ tool: "list_tasks", args: {} }),
    })
      .then(r => r.json())
      .then(res => {
        if (res?.result?.tasks) {
          const mapped = res.result.tasks.map((t: any) => {
            let status = t.status || "completed";
            if (status === "running" && t.created_at && (Date.now() / 1000 - t.created_at) > 300) status = "failed";
            return { id: t.task_id, goal: t.query || t.task_id.slice(0, 12), status, startedAt: new Date(t.created_at * 1000).toISOString(), durationMs: t.duration_ms };
          });
          setTasks(mapped);

          // Auto-connect to a running task if we're not already streaming
          const currentStatus = useExecutionStore.getState().status;
          if (currentStatus !== "streaming") {
            const running = mapped.find((t: any) => t.status === "running");
            if (running && running.id !== taskId) {
              setTaskId(running.id);
              setGoal(running.goal);
              setMode("trace");
              startPolling(running.id);
            }
          }
        }
      })
      .catch(() => {});
  }, [taskChangeCounter]); // eslint-disable-line

  // Audit events now come from global store (stores/audit.ts)
  // SSE runs at layout level via AuditStreamInit — persists across page navigations

  // ── Auto-switch to trace mode on task start ────────────────────────────
  useEffect(() => {
    if (status === "streaming") { setMode("trace"); setViewMode("task"); setTraceSub("events"); }
  }, [status]);

  // ── URL param: auto-load task ──────────────────────────────────────────

  useEffect(() => {
    const urlTask = searchParams.get("task");
    if (urlTask && !taskId) {
      setTaskId(urlTask);
      setMode("trace");
      Promise.all([
        fetch(`${BASE}/tasks/${urlTask}`, { headers: th }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ tool: "get_trace", args: { task_id: urlTask } }) }).then(r => r.json()).catch(() => null),
      ]).then(([taskData, traceData]) => {
        if (!taskData) return;
        const turns = traceData?.result?.turns ?? taskData.turns ?? [];
        useExecutionStore.getState().loadTrace(urlTask, turns, taskData.total_tokens, taskData.total_cost, taskData.status);
        setGoal(taskData.goal || taskData.metadata?.result?.goal || "");
      }).catch(() => {});
    }
  }, [searchParams]); // eslint-disable-line

  // ── Task actions ───────────────────────────────────────────────────────

  const startPolling = useCallback((id: string) => {
    // Don't start polling if already polling this task
    if (pollRef.current) clearInterval(pollRef.current);

    const store = useExecutionStore.getState();
    store.startStream(id);
    store.setStatus("streaming");

    let done = false;

    pollRef.current = setInterval(async () => {
      if (done) return;
      try {
        const res = await fetch(`${BASE}/tasks/${id}`, { headers: th });
        if (!res.ok) return;
        const data = await res.json();
        const s = useExecutionStore.getState();
        const currentTurns = s.events.filter(e => e.type === "tool_call" || e.type === "turn_complete").length;
        const remoteTurns = data.total_turns || 0;
        if (remoteTurns > currentTurns) {
          for (let i = currentTurns; i < remoteTurns; i++) {
            const turn = data.turns?.[i];
            s.addEvent({ id: `poll-${Date.now()}-${i}`, type: turn?.role === "tool_call" ? "tool_call" : "turn_complete", message: turn?.tool || `Turn ${i + 1}`, data: { turn: i + 1, tool: turn?.tool, role: turn?.role }, timestamp: new Date().toISOString() });
          }
        }
        if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
          done = true; // Prevent re-entry
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          // Load the full trace instead of adding a single completion event
          const traceRes = await fetch(`${BASE}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ tool: "get_trace", args: { task_id: id } }) }).catch(() => null);
          const traceData = traceRes ? await traceRes.json() : null;
          const turns = traceData?.result?.turns ?? data.turns ?? [];
          s.loadTrace(id, turns, data.total_tokens, data.total_cost, data.status);
        }
      } catch {}
    }, 1500);
  }, [th]);

  const launchTask = useCallback(async () => {
    if (!goal.trim()) return;
    setLaunching(true);
    try {
      const res = await fetch(`${BASE}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ message: goal.trim(), mode: "kernel" }),
      });
      const data = await res.json();
      const id = data.task_id || data.id;
      if (id) {
        await new Promise(r => setTimeout(r, 500));
        setTaskId(id);
        setMode("trace");
      }
    } catch (err) { console.error("Failed to launch task:", err); }
    finally { setLaunching(false); }
  }, [goal, th]);

  const handleStop = useCallback(() => {
    disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
    useExecutionStore.getState().setStatus("error");
    useExecutionStore.getState().setViewState("completed");
  }, [disconnect]);

  const backToDashboard = useCallback(() => {
    disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
    setTaskId(null);
    setGoal("");
    setSelectedHistoryTask(null);
    reset();
    setMode("dashboard");
  }, [disconnect, reset]);

  // ── History task selection → switches to trace mode ────────────────────

  const selectHistoryTask = useCallback(async (id: string) => {
    setSelectedHistoryTask(id);
    setHistoryLoading(true);
    setMode("trace");
    setTraceSub("events");
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST", headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ tool: "get_trace", args: { task_id: id } }),
      });
      const json = await res.json();
      const turns = json.result?.turns ?? json.turns ?? [];
      const taskRes = await fetch(`${BASE}/tasks/${id}`, { headers: th });
      const taskData = taskRes.ok ? await taskRes.json() : null;
      const store = useExecutionStore.getState();
      store.loadTrace(id, turns, taskData?.total_tokens, taskData?.total_cost, taskData?.status);
      store.setViewState("reviewing");
      if (taskData?.goal) setGoal(taskData.goal);
    } catch {}
    setHistoryLoading(false);
  }, [th]);

  // Cleanup on unmount
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          {/* Back button in trace mode */}
          {mode === "trace" && (
            <button
              onClick={backToDashboard}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg transition-all"
            >
              <ArrowLeft className="h-3 w-3" />
              Dashboard
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Activity className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-200">
                {mode === "dashboard" ? "Observability" : "Trace Inspector"}
              </h1>
              <p className="text-[9px] text-slate-600">
                {mode === "dashboard" ? "Metrics, alerts & analytics" : goal ? goal.slice(0, 60) : "Viewing execution trace"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === "trace" && <MetricsBar />}

          <AlertBell onClick={() => setDashSub("alerts")} />
          <button onClick={() => setShowExport(true)} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors" title="Export & Retention">
            <Download className="h-3.5 w-3.5" />
          </button>
          <button onClick={loadAnalytics} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Task Input (both modes) ───────────────────────────────────── */}
      <div className="px-4 pb-2 shrink-0">
        <TaskInputBar
          goal={goal} setGoal={setGoal}
          onExecute={launchTask} onStop={handleStop} onReset={backToDashboard}
          status={status} launching={launching}
        />
      </div>

      {/* ── Main Grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-4 pb-2 flex flex-col gap-2">
        <div className="flex-1 min-h-0 flex gap-3">

          {/* ══════════════ LEFT SIDEBAR ══════════════ */}
          <HistorySidebar
            open={sidebarOpen}
            setOpen={setSidebarOpen}
            tasks={tasks}
            selectedTask={selectedHistoryTask}
            onSelect={selectHistoryTask}
            loading={historyLoading}
            namespace={tenant}
          />

          {/* ══════════════ MAIN STAGE ══════════════ */}
          <div className="flex-1 min-w-0 min-h-0 relative rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">
              <AnimatePresence mode="wait">
                {mode === "dashboard" ? (
                  <motion.div
                    key="dashboard"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 overflow-y-auto p-4"
                  >
                    <ChartGrid namespace={tenant} />
                    <CollapsibleSection title="Latency & Cost Analysis" defaultOpen={false}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <LatencyAnalytics namespace={tenant} />
                        <CostBreakdown namespace={tenant} />
                      </div>
                    </CollapsibleSection>
                    <CollapsibleSection title="Regression Detection" defaultOpen={false}>
                      <RegressionPanel namespace={tenant} />
                    </CollapsibleSection>
                    <CollapsibleSection title="Overview" defaultOpen={false}>
                      <OverviewDashboard analytics={analytics} stats={stats} loading={analyticsLoading} />
                    </CollapsibleSection>
                  </motion.div>
                ) : (
                  <motion.div
                    key="trace"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0"
                  >
                    <ExecutionGraph />

                    {/* Status banner */}
                    <AnimatePresence>
                      {isDone && (
                        <motion.div
                          initial={{ opacity: 0, y: -20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
                        >
                          <div className={`flex items-center gap-2 px-4 py-2 rounded-full  border ${
                            viewState === "completed"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                              : "bg-violet-500/10 border-violet-500/20 text-violet-300"
                          } text-[10px] font-medium shadow-lg`}>
                            <div className={`h-1.5 w-1.5 rounded-full ${viewState === "completed" ? "bg-emerald-400" : "bg-violet-400"}`} />
                            {viewState === "completed" ? "Task completed" : "Viewing trace"}
                            {(["events", "spans", "stats"] as const).map(t => (
                              <button
                                key={t}
                                onClick={() => setTraceSub(t)}
                                className={`px-2 py-0.5 rounded-full transition-colors text-[9px] ${
                                  traceSub === t ? "bg-white/[0.15] text-white" : "bg-white/[0.06] hover:bg-white/[0.1]"
                                }`}
                              >
                                {t === "events" ? "Events" : t === "spans" ? "Spans" : "Stats"}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Live indicator */}
                    {isLive && (
                      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40  border border-green-500/20">
                        <motion.div
                          className="h-1.5 w-1.5 rounded-full bg-green-400"
                          animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                          transition={{ repeat: Infinity, duration: 1.2 }}
                        />
                        <span className="text-[9px] text-green-400">Streaming</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
          </div>

          {/* ── Resize handle ─────────────────────────────────────────── */}
          <div className="w-1 shrink-0 cursor-col-resize hover:bg-violet-500/30 active:bg-violet-500/50 transition-colors rounded-full"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = rightPanelWidth;
              const onMove = (ev: MouseEvent) => setRightPanelWidth(Math.max(260, Math.min(600, startW - (ev.clientX - startX))));
              const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />

          {/* ══════════════ RIGHT PANEL ══════════════ */}
          <div style={{ width: rightPanelWidth }} className="shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">

            {mode === "trace" ? (
              /* ── Trace mode: Events / Spans ─────────────── */
              <>
                <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.04] shrink-0">
                  {([
                    { id: "events" as const, label: "Events" },
                    { id: "spans" as const, label: "Spans" },
                    { id: "stats" as const, label: "Run Stats" },
                  ]).map(t => (
                    <button key={t.id} onClick={() => setTraceSub(t.id)}
                      className={`relative px-2.5 py-1.5 text-[10px] font-medium rounded-md transition-all ${traceSub === t.id ? "text-violet-300" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {t.label}
                      {traceSub === t.id && (
                        <motion.div layoutId="trace-tab-bg" className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-md -z-10" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                      )}
                    </button>
                  ))}
                  {isLive && (
                    <div className="ml-auto flex items-center gap-1">
                      <motion.div className="h-1.5 w-1.5 rounded-full bg-green-400" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                      <span className="text-[9px] text-green-400/60">live</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AnimatePresence mode="wait">
                    {traceSub === "events" && (
                      <motion.div key="events" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                        <EventsPanel
                          events={executionEvents} auditEvents={auditEvents}
                          viewMode={viewMode} setViewMode={setViewMode}
                          sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
                          textFilter={textFilter} setTextFilter={setTextFilter}
                          onEventClick={(id) => { setActiveEvent(id); setDrawerOpen(true); }}
                          onLoadTrace={(evt) => { const id = (evt.data.task_id as string) || ""; if (id) selectHistoryTask(id); }}
                          activeEventId={activeEventId}
                          activeTaskId={taskId || selectedHistoryTask || ""}
                        />
                      </motion.div>
                    )}
                    {traceSub === "spans" && (
                      <motion.div key="spans" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
                        <TraceWaterfall taskId={taskId || selectedHistoryTask || ""} namespace={tenant} />
                      </motion.div>
                    )}
                    {traceSub === "stats" && (
                      <motion.div key="stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                        <RunStats
                          taskId={taskId || selectedHistoryTask || ""}
                          namespace={tenant}
                          totalTokens={useExecutionStore.getState().tokens}
                          totalCost={useExecutionStore.getState().cost}
                          totalTurns={useExecutionStore.getState().turns}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              /* ── Dashboard mode: Alerts / Queue / Insights / Studio ─── */
              <>
                <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.04] shrink-0">
                  {(["alerts", "queue", "insights"] as const).map(t => (
                    <button key={t} onClick={() => setDashSub(t)}
                      className={`relative px-3 py-1.5 text-[10px] font-medium rounded-md transition-all capitalize ${dashSub === t ? "text-violet-300" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      {t === "queue" ? "Review" : t}
                      {dashSub === t && (
                        <motion.div layoutId="dash-tab-bg" className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-md -z-10" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AnimatePresence mode="wait">
                    {dashSub === "alerts" && (
                      <motion.div key="alerts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
                        <AlertsPanel />
                      </motion.div>
                    )}
                    {dashSub === "queue" && (
                      <motion.div key="queue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                        <ReviewQueue namespace={tenant} onSelectTask={selectHistoryTask} />
                      </motion.div>
                    )}
                    {dashSub === "insights" && (
                      <motion.div key="insights" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
                        <InsightsPanel analytics={analytics} stats={stats} />
                        <div className="p-2">
                          <ImprovePanel analytics={analytics} tenantHeaders={th} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Bottom Drawer (trace mode only) ──────────────────────────── */}
        {mode === "trace" && (
          <BottomDrawer open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)}>
            <StepDetail />
          </BottomDrawer>
        )}
      </div>

      {/* Export & Retention Dialog */}
      <AnimatePresence>
        {showExport && (
          <ExportRetentionDialog open={showExport} onClose={() => setShowExport(false)} namespace={tenant} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Collapsible Section ────────────────────────────────────────────────────

function CollapsibleSection({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-1 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors group"
      >
        <span>{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-slate-600 group-hover:text-slate-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
