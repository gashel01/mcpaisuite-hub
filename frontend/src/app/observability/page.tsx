"use client";
import { apiFetch } from "@/lib/api";
import { stripTaskforcePrefix } from "@/lib/taskforce";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Download, ArrowLeft, PanelRightOpen, PanelRightClose,
  History, X, Menu, Copy, Check,
} from "lucide-react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { useSearchParams } from "next/navigation";

import MetricsBar from "@/components/execution/MetricsBar";
import ExecutionGraph from "@/components/execution/ExecutionGraph";
import TopologyView from "@/components/observability/TopologyView";
import StepDetail from "@/components/execution/StepDetail";
import { useExecutionStore } from "@/stores/execution";
import { useTaskStream } from "@/hooks/useTaskStream";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { useBreakpoint } from "@/hooks/useBreakpoint";

import TaskInputBar from "@/components/observability/TaskInputBar";
import EventsPanel from "@/components/observability/EventsPanel";
import { useAuditStore } from "@/stores/audit";
import TraceWaterfall from "@/components/observability/TraceWaterfall";
import RunWorkspacesButton from "@/components/observability/RunWorkspacesButton";
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


import type { PageMode, Analytics, Stats } from "./types";
import { RightPanelContent, CollapsibleSection } from "./right-panel";

const TASK_PAGE_SIZE = 100;

// ── Main Export ─────────────────────────────────────────────────────────────

export default function ObservabilityPage() {
  return <Suspense><ObservabilityInner /></Suspense>;
}

// ── Inner Component ────────────────────────────────────────────────────────

function ObservabilityInner() {
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  // Memoize so `th` keeps a stable identity across renders. Otherwise every render makes a
  // new object → refreshTasks/loadKernels change identity → their interval effects re-run and
  // fire immediately every render → setState → re-render → a runaway /api/tool + /hub/instances
  // polling storm. (Fleet already memoizes this; Observability had not.)
  const th = useMemo(() => tenantHeaders(tenant), [tenant]);
  const { isMobile, isTablet, isMobileOrTablet, isDesktop } = useBreakpoint();

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
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [rightPanelOpen, setRightPanelOpen] = useState(!isMobile);
  const [mobilePanel, setMobilePanel] = useState<"none" | "sidebar" | "right">("none");

  // Auto-close sidebar on mobile
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setRightPanelOpen(false);
    } else {
      setSidebarOpen(true);
      setRightPanelOpen(true);
    }
  }, [isMobile]);

  // ── Trace mode: right panel sub-tab ────────────────────────────────────
  const [traceSub, setTraceSub] = useState<"events" | "spans" | "stats" | "replay">("events");
  const [copiedTrace, setCopiedTrace] = useState(false);

  // ── Dashboard mode: right panel sub-tab ────────────────────────────────
  const [dashSub, setDashSub] = useState<"alerts" | "queue" | "insights">("alerts");

  // ── Task history state ─────────────────────────────────────────────────
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Scope: local Hub tasks, or a connected remote kernel's ingested runs ──
  // Keeps the history list to ONE source at a time so local stays clean by default.
  const [scope, setScope] = useState<string>("local"); // "local" | <instance_id>
  const [kernels, setKernels] = useState<{ instance_id: string; name: string; project: string; live: boolean }[]>([]);

  // ── Recent Tasks pagination (local scope) ──────────────────────────────
  const [taskPage, setTaskPage] = useState(0); // 0-based, newest first
  const [taskTotal, setTaskTotal] = useState(0);
  // Reset to the newest page whenever the source changes.
  useEffect(() => { setTaskPage(0); }, [scope]);

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
        apiFetch<any>("/api/tool", { method: "POST", headers: th, body: { tool: "get_analytics", args: {} } }).catch(() => null),
        apiFetch<any>("/stats", { headers: th }).catch(() => null),
        apiFetch<any>("/api/tool", { method: "POST", headers: th, body: { tool: "list_tasks", args: {} } }).catch(() => null),
      ]);
      if (analyticsRes?.result) setAnalytics(analyticsRes.result);
      if (statsRes) setStats(statsRes);
      if (scope === "local" && tasksRes?.result?.tasks) {
        setTaskTotal(tasksRes.result.total ?? tasksRes.result.tasks.length);
        setTasks(tasksRes.result.tasks.map((t: any) => {
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
            source: t.source,
            deploymentName: t.deployment_name,
          };
        }));
      }
    } catch { /* ignore */ }
    setAnalyticsLoading(false);
  }, [th, scope]);

  useEffect(() => { loadAnalytics(); }, []); // eslint-disable-line

  // Refresh analytics when returning to dashboard
  useEffect(() => {
    if (mode === "dashboard") loadAnalytics();
  }, [mode]); // eslint-disable-line

  // Task-list refresh + auto-switch-to-running is defined after startPolling (below).

  // ── Auto-switch to trace mode on task start ────────────────────────────
  useEffect(() => {
    if (status === "streaming") { setMode("trace"); setViewMode("task"); setTraceSub("events"); }
    // SSE terminated (terminal event or server close) — useTaskStream sets status but not
    // viewState, and the "Live" indicator reads viewState. Flip it so a finished live trace
    // stops showing "Streaming".
    else if (status === "completed" || status === "error") {
      if (useExecutionStore.getState().viewState === "running") setViewState("completed");
    }
  }, [status]); // eslint-disable-line

  // ── URL param: auto-load task ──────────────────────────────────────────

  // Deep-link: ?task=<id> opens that run's trace exactly like clicking it in the list —
  // it SELECTS the task (highlights it in the bar), loads the trace, and shows the graph in
  // review mode. We deliberately do NOT setTaskId here: that opens a live SSE stream and
  // resets the graph for an already-finished run (the old bug — blank graph, no selection).
  // Works regardless of pagination: selection is by id, independent of the visible page.
  const deepLinkedTask = useRef<string | null>(null);
  useEffect(() => {
    const urlTask = searchParams.get("task");
    if (urlTask && deepLinkedTask.current !== urlTask) {
      deepLinkedTask.current = urlTask;
      selectHistoryTask(urlTask);
    }
  }, [searchParams]); // eslint-disable-line

  // ── Task actions ───────────────────────────────────────────────────────

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const store = useExecutionStore.getState();
    store.startStream(id);
    store.setStatus("streaming");

    let done = false;

    pollRef.current = setInterval(async () => {
      if (done) return;
      try {
        const data = await apiFetch<any>(`/tasks/${id}`, { headers: th });
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
          done = true;
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          const traceData = await apiFetch<any>("/api/tool", { method: "POST", headers: th, body: { tool: "get_trace", args: { task_id: id } } }).catch(() => null);
          const turns = traceData?.result?.turns ?? data.turns ?? [];
          s.loadTrace(id, turns, data.total_tokens, data.total_cost, data.status, data.duration_ms);
        }
      } catch {}
    }, 1500);
  }, [th]);

  // Refresh the task list and, if a NEW run is in flight, switch to it live.
  // Reads current taskId/status from the store so it runs on a stable interval
  // without stale closures.
  const refreshTasks = useCallback(async () => {
    try {
      // Remote scope: show one connected kernel's ingested runs (already terminal).
      if (scope !== "local") {
        const res = await apiFetch<any>(`/hub/instances/${scope}/runs`, { headers: th });
        setTasks((res.runs || []).map((t: any) => ({
          id: t.id,
          goal: t.goal || t.id.slice(0, 12),
          status: t.status || "completed",
          startedAt: new Date(t.createdAt || 0).toISOString(),
          durationMs: undefined,
        })));
        return; // no live auto-switch for remote runs — they arrive already finished
      }

      const res = await apiFetch<any>("/api/tool", {
        method: "POST", headers: th,
        body: { tool: "list_tasks", args: { limit: TASK_PAGE_SIZE, offset: taskPage * TASK_PAGE_SIZE } },
      });
      if (!res?.result?.tasks) return;
      setTaskTotal(res.result.total ?? res.result.tasks.length);
      const mapped = res.result.tasks.map((t: any) => {
        let status = t.status || "completed";
        if (status === "running" && t.created_at && (Date.now() / 1000 - t.created_at) > 300) status = "failed";
        return { id: t.task_id, goal: t.query || t.task_id.slice(0, 12), status, startedAt: new Date(t.created_at * 1000).toISOString(), durationMs: t.duration_ms, source: t.source, deploymentName: t.deployment_name };
      });
      setTasks(mapped);

      // Auto-switch only makes sense on the newest page — never yank the user off a
      // page they paged back to.
      if (taskPage !== 0) return;

      // Auto-switch to a running task as soon as it appears — unless we're already
      // streaming one, or the user is deliberately reviewing a picked history task.
      // Just set the taskId: useTaskStream(taskId) opens the live SSE (which resets the
      // graph via startStream and streams progress + completion). We deliberately do NOT
      // also startPolling here — that would double-stream the same task.
      const st = useExecutionStore.getState();
      if (st.status === "streaming" || st.viewState === "reviewing") return;
      const running = mapped.find((t: any) => t.status === "running");
      if (running && running.id !== st.taskId) {
        setTaskId(running.id);
        setGoal(stripTaskforcePrefix(running.goal));
        setMode("trace");
      }
    } catch { /* ignore */ }
  }, [th, scope, taskPage]);

  // Audit-driven refresh (fast path) + periodic poll (robust: runs appear/update
  // live even when launched from another page and no audit event fired).
  useEffect(() => { if (taskChangeCounter > 0) refreshTasks(); }, [taskChangeCounter]); // eslint-disable-line
  useEffect(() => {
    refreshTasks(); // immediate reload (covers scope changes)
    const id = setInterval(refreshTasks, 2500);
    return () => clearInterval(id);
  }, [refreshTasks]);

  // Connected kernels feed the scope selector (poll so live/offline stays current).
  const loadKernels = useCallback(async () => {
    try {
      const d = await apiFetch<any>("/hub/instances", { headers: th });
      setKernels(d.instances || []);
    } catch { /* ignore */ }
  }, [th]);
  useEffect(() => {
    loadKernels();
    const id = setInterval(loadKernels, 10000);
    return () => clearInterval(id);
  }, [loadKernels]);

  const launchTask = useCallback(async () => {
    if (!goal.trim()) return;
    setLaunching(true);
    try {
      const data = await apiFetch<any>("/chat", {
        method: "POST", headers: th,
        body: { message: goal.trim(), mode: "kernel" },
      });
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
    setMobilePanel("none");
  }, [disconnect, reset]);

  // ── History task selection ────────────────────────────────────────────

  const selectHistoryTask = useCallback(async (id: string) => {
    setSelectedHistoryTask(id);
    setHistoryLoading(true);
    setMode("trace");
    setTraceSub("events");
    if (isMobile) setMobilePanel("none");
    try {
      const json = await apiFetch<any>("/api/tool", {
        method: "POST", headers: th,
        body: { tool: "get_trace", args: { task_id: id } },
      });
      const turns = json.result?.turns ?? json.turns ?? [];
      const taskData = await apiFetch<any>(`/tasks/${id}`, { headers: th }).catch(() => null);
      const store = useExecutionStore.getState();
      store.loadTrace(id, turns, taskData?.total_tokens, taskData?.total_cost, taskData?.status, taskData?.duration_ms);
      store.setViewState("reviewing");
      if (taskData?.goal) setGoal(stripTaskforcePrefix(taskData.goal));
    } catch {}
    setHistoryLoading(false);
  }, [th, isMobile]);

  // Cleanup on unmount
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  // ── Mobile panel toggle helpers ────────────────────────────────────────
  const toggleMobileSidebar = () => {
    setMobilePanel(p => p === "sidebar" ? "none" : "sidebar");
  };
  const toggleMobileRight = () => {
    setMobilePanel(p => p === "right" ? "none" : "right");
  };

  // Copy the current trace (task id, goal, metrics, full event log) to the clipboard as JSON.
  const copyTrace = useCallback(() => {
    const st = useExecutionStore.getState();
    const payload = {
      taskId,
      goal: stripTaskforcePrefix(goal) || undefined,
      status: st.viewState,
      metrics: { turns: st.turns, tokens: st.tokens, cost: st.cost, elapsedMs: st.elapsed },
      events: st.events.map(e => ({ type: e.type, message: e.message, data: e.data, timestamp: e.timestamp })),
      exportedAt: new Date().toISOString(),
    };
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
      .then(() => { setCopiedTrace(true); setTimeout(() => setCopiedTrace(false), 1500); })
      .catch(() => {});
  }, [taskId, goal]);

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveRightWidth = isMobile ? "100%" : isTablet ? 320 : rightPanelWidth;

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden relative">

      {/* ── Unified Header + Task Input (single row) ──────────────────── */}
      <div className="obs-header flex items-center gap-2 px-3 py-1.5 shrink-0 z-50">
        {/* Nav menu (replaces layout hamburger on mobile) */}
        <button
          onClick={() => {
            // Click the layout's sidebar hamburger programmatically
            const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
            if (btn) btn.click();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Task history toggle (mobile/tablet) */}
        {isMobileOrTablet && (
          <button
            onClick={toggleMobileSidebar}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0"
            aria-label="Task history"
          >
            <History className="h-4 w-4" />
          </button>
        )}

        {mode === "trace" && (
          <button
            onClick={backToDashboard}
            className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg transition-all touch-target shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center">
            <Activity className="h-4 w-4 text-violet-400" />
          </div>
          <h1 className="text-sm font-semibold text-slate-100 leading-tight hidden lg:block">
            {mode === "dashboard" ? "Observability" : "Trace"}
          </h1>
        </div>

        {/* Center: in TRACE mode this is the selected run's goal as a read-only label (the
            "Dashboard" button on the left clears/restores). Editing a past run's goal + Execute
            would launch a brand-new task, which is misleading — so trace mode is observe-only.
            In DASHBOARD mode it's the launcher: run a task and watch its trace live. */}
        {mode === "trace" && status !== "streaming" ? (
          <span className="flex-1 min-w-0 text-[12px] sm:text-[13px] text-slate-300 truncate" title={goal}>
            {goal || "Trace"}
          </span>
        ) : (
          <div className="flex-1 min-w-0">
            <TaskInputBar
              goal={goal} setGoal={setGoal}
              onExecute={launchTask} onStop={handleStop} onReset={backToDashboard}
              status={status} launching={launching}
            />
          </div>
        )}

        {/* Right: metrics (desktop only) + actions */}
        <div className="flex items-center gap-1 shrink-0">
          {mode === "trace" && isDesktop && <MetricsBar />}

          <AlertBell onClick={() => { setDashSub("alerts"); if (isMobile) setMobilePanel("right"); else setRightPanelOpen(true); }} />

          <button onClick={() => setShowExport(true)} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all touch-target hidden sm:flex" title="Export">
            <Download className="h-3.5 w-3.5" />
          </button>
          <RefreshButton onRefresh={loadAnalytics} className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all touch-target hidden sm:flex" />

          {!isMobile && (
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all"
              title={rightPanelOpen ? "Hide panel" : "Show panel"}
            >
              {rightPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            </button>
          )}

          {isMobile && (
            <button
              onClick={toggleMobileRight}
              className="p-1.5 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-white/[0.04] transition-all touch-target"
              aria-label="Toggle details panel"
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Main Grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-3 py-2 flex flex-col gap-2">
        <div className="flex-1 min-h-0 flex gap-2">

          {/* ══════════════ LEFT SIDEBAR (desktop inline / mobile overlay) ══════════════ */}
          {!isMobile ? (
            <HistorySidebar
              open={sidebarOpen}
              setOpen={setSidebarOpen}
              tasks={tasks}
              selectedTask={selectedHistoryTask}
              onSelect={selectHistoryTask}
              loading={historyLoading}
              namespace={tenant}
              scope={scope}
              setScope={setScope}
              kernels={kernels}
              total={scope === "local" ? taskTotal : undefined}
              page={taskPage}
              pageSize={TASK_PAGE_SIZE}
              onPageChange={scope === "local" ? setTaskPage : undefined}
            />
          ) : null}

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
                    className="absolute inset-0 overflow-y-auto p-3 sm:p-4"
                  >
                    <ChartGrid namespace={tenant} />
                    <CollapsibleSection title="Latency & Cost Analysis" defaultOpen={false}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
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
                    <TopologyView taskId={selectedHistoryTask || taskId} tenant={tenant} />

                    {/* Status banner */}
                    <AnimatePresence>
                      {isDone && (
                        <motion.div
                          initial={{ opacity: 0, y: -20, x: "-50%" }}
                          animate={{ opacity: 1, y: 0, x: "-50%" }}
                          exit={{ opacity: 0, y: -20, x: "-50%" }}
                          className="absolute top-3 left-1/2 z-20 pointer-events-auto"
                        >
                          <div className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-full border ${
                            viewState === "completed"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                              : "bg-violet-500/10 border-violet-500/20 text-violet-300"
                          } text-[10px] sm:text-[11px] font-medium shadow-lg backdrop-blur-sm`}>
                            <div className={`h-1.5 w-1.5 rounded-full ${viewState === "completed" ? "bg-emerald-400" : "bg-violet-400"}`} />
                            <span className="hidden sm:inline">{viewState === "completed" ? "Task completed" : "Viewing trace"}</span>
                            <span className="sm:hidden">{viewState === "completed" ? "Done" : "Trace"}</span>
                            {(["events", "spans", "stats", "replay"] as const).map(t => (
                              <button
                                key={t}
                                onClick={() => { setTraceSub(t); if (isMobile) setMobilePanel("right"); }}
                                className={`px-2 py-0.5 rounded-full transition-colors text-[9px] sm:text-[10px] touch-target ${
                                  traceSub === t ? "bg-white/[0.15] text-white" : "bg-white/[0.06] hover:bg-white/[0.1]"
                                }`}
                              >
                                {t === "events" ? "Events" : t === "spans" ? "Spans" : t === "stats" ? "Stats" : "Replay"}
                              </button>
                            ))}
                            <button
                              onClick={copyTrace}
                              data-tooltip="Copy trace as JSON"
                              className="flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors text-[9px] sm:text-[10px] touch-target bg-white/[0.06] hover:bg-white/[0.1]"
                            >
                              {copiedTrace ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                              <span className="hidden sm:inline">{copiedTrace ? "Copied" : "Copy"}</span>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Live indicator */}
                    {isLive && (
                      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/50 backdrop-blur-sm border border-green-500/20">
                        <motion.div
                          className="h-2 w-2 rounded-full bg-green-400"
                          animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                          transition={{ repeat: Infinity, duration: 1.2 }}
                        />
                        <span className="text-[10px] sm:text-[11px] text-green-400 font-medium">Live</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
          </div>

          {/* ── Resize handle (desktop only) ─────────────────────────── */}
          {isDesktop && rightPanelOpen && (
            <div className="w-1.5 shrink-0 cursor-col-resize group flex items-center justify-center"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = rightPanelWidth;
                const onMove = (ev: MouseEvent) => setRightPanelWidth(Math.max(280, Math.min(600, startW - (ev.clientX - startX))));
                const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            >
              <div className="w-0.5 h-8 rounded-full bg-white/[0.06] group-hover:bg-violet-500/40 group-active:bg-violet-500/60 transition-colors" />
            </div>
          )}

          {/* ══════════════ RIGHT PANEL (desktop inline) ══════════════ */}
          {!isMobile && rightPanelOpen && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              style={{ width: effectiveRightWidth }}
              className="shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden"
            >
              <RightPanelContent
                mode={mode}
                traceSub={traceSub} setTraceSub={setTraceSub}
                dashSub={dashSub} setDashSub={setDashSub}
                isLive={isLive}
                executionEvents={executionEvents}
                auditEvents={auditEvents}
                viewMode={viewMode} setViewMode={setViewMode}
                sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
                textFilter={textFilter} setTextFilter={setTextFilter}
                activeEventId={activeEventId}
                taskId={taskId}
                selectedHistoryTask={selectedHistoryTask}
                tenant={tenant}
                analytics={analytics}
                stats={stats}
                th={th}
                setActiveEvent={setActiveEvent}
                setDrawerOpen={setDrawerOpen}
                selectHistoryTask={selectHistoryTask}
              />
            </motion.div>
          )}
        </div>

        {/* ── Bottom Drawer (trace mode only) ──────────────────────────── */}
        {mode === "trace" && (
          <BottomDrawer open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)}>
            <StepDetail />
          </BottomDrawer>
        )}
      </div>

      {/* ══════════════ MOBILE OVERLAYS ══════════════ */}

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {isMobile && mobilePanel === "sidebar" && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 mobile-overlay z-40"
              onClick={() => setMobilePanel("none")}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="fixed left-0 top-0 bottom-0 w-[85vw] max-w-[320px] z-50 flex flex-col bg-surface-1 border-r border-white/[0.06]"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                <h2 className="text-sm font-semibold text-slate-200">History</h2>
                <button onClick={() => setMobilePanel("none")} className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] touch-target">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <HistorySidebar
                  open={true}
                  setOpen={() => setMobilePanel("none")}
                  tasks={tasks}
                  selectedTask={selectedHistoryTask}
                  onSelect={(id) => { selectHistoryTask(id); setMobilePanel("none"); }}
                  loading={historyLoading}
                  namespace={tenant}
                  scope={scope}
                  setScope={setScope}
                  kernels={kernels}
                  total={scope === "local" ? taskTotal : undefined}
                  page={taskPage}
                  pageSize={TASK_PAGE_SIZE}
                  onPageChange={scope === "local" ? setTaskPage : undefined}
                  embedded
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile right panel (bottom sheet) */}
      <AnimatePresence>
        {isMobile && mobilePanel === "right" && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 mobile-overlay z-40"
              onClick={() => setMobilePanel("none")}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="fixed left-0 right-0 bottom-0 z-50 flex flex-col bg-surface-1 border-t border-white/[0.08] rounded-t-2xl"
              style={{ height: "75vh", maxHeight: "75vh" }}
            >
              {/* Sheet handle */}
              <div className="flex items-center justify-center py-2 shrink-0">
                <div className="w-10 h-1 rounded-full bg-white/[0.12]" />
              </div>
              <div className="flex items-center justify-between px-4 pb-2 shrink-0">
                <h2 className="text-sm font-semibold text-slate-200">
                  {mode === "trace" ? "Trace Details" : "Dashboard Panel"}
                </h2>
                <button onClick={() => setMobilePanel("none")} className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] touch-target">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <RightPanelContent
                  mode={mode}
                  traceSub={traceSub} setTraceSub={setTraceSub}
                  dashSub={dashSub} setDashSub={setDashSub}
                  isLive={isLive}
                  executionEvents={executionEvents}
                  auditEvents={auditEvents}
                  viewMode={viewMode} setViewMode={setViewMode}
                  sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
                  textFilter={textFilter} setTextFilter={setTextFilter}
                  activeEventId={activeEventId}
                  taskId={taskId}
                  selectedHistoryTask={selectedHistoryTask}
                  tenant={tenant}
                  analytics={analytics}
                  stats={stats}
                  th={th}
                  setActiveEvent={setActiveEvent}
                  setDrawerOpen={setDrawerOpen}
                  selectHistoryTask={selectHistoryTask}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Export & Retention Dialog */}
      <AnimatePresence>
        {showExport && (
          <ExportRetentionDialog open={showExport} onClose={() => setShowExport(false)} namespace={tenant} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Right Panel Content (shared between inline & mobile sheet) ────────────
