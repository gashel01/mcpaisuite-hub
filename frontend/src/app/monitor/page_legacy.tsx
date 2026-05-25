"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Play, Square, RotateCw, Activity, Tv2, Filter, RefreshCw,
  Cpu, Wrench, Zap, Bot, AlertCircle, CheckCircle2, Clock,
  ArrowRight, Shield, ChevronDown, X, Copy, Check, GitBranch,
} from "lucide-react";
import { useTaskStream } from "@/hooks/useTaskStream";
import { useExecutionStore } from "@/stores/execution";
import { useTenant, tenantHeaders } from "@/context/tenant";
import PageHeader from "@/components/page-header";
import MetricsBar from "@/components/execution/MetricsBar";
import ExecutionGraph from "@/components/execution/ExecutionGraph";
import StepDetail from "@/components/execution/StepDetail";
import CopyButton from "@/components/copy-button";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

// ── Audit event types ──────────────────────────────────────────────────────

interface AuditEvent {
  id: number;
  ts: number;
  source: string;
  type: string;
  detail: string;
  data: Record<string, unknown>;
}

const SOURCE_STYLES: Record<string, { color: string; bg: string }> = {
  kernel:       { color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  engine:       { color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  llm:          { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  orchestrator: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  chat:         { color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  rag:          { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  scheduler:    { color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
  memory:       { color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20" },
  workspace:    { color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
  subagent:     { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  sandbox:      { color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
  planner:      { color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
  ltp:          { color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20" },
  planning:     { color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
  validator:    { color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
};

const DEFAULT_SOURCE = { color: "text-slate-400", bg: "bg-white/[0.03] border-white/[0.06]" };

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

// ── Main component ─────────────────────────────────────────────────────────

export default function MonitorPage() {
  return <Suspense><MonitorPageInner /></Suspense>;
}

function MonitorPageInner() {
  // Task execution state
  const searchParams = useSearchParams();
  const [goal, setGoal] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const { tenant } = useTenant();
  const { status, disconnect } = useTaskStream(taskId, tenant);

  // Auto-load task from URL param
  useEffect(() => {
    const urlTask = searchParams.get("task");
    if (urlTask && !taskId) {
      setTaskId(urlTask);
      // Fetch task data directly (works for completed tasks)
      fetch(`${BASE}/tasks/${urlTask}`, { headers: tenantHeaders(tenant) })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          const store = useExecutionStore.getState();
          store.startStream(urlTask);
          setGoal(data.goal || data.metadata?.result?.goal || "");
          // Add turns as events
          (data.turns || []).forEach((turn: any, i: number) => {
            store.addEvent({
              id: `loaded-${i}`, type: turn.role === "tool_call" ? "tool_call" : "turn_complete",
              message: turn.tool || turn.role || `Turn ${i + 1}`,
              data: { turn: i + 1, tool: turn.tool, role: turn.role, content: turn.content?.slice(0, 200) },
              timestamp: new Date().toISOString(),
            });
          });
          if (data.status === "completed" || data.status === "failed") {
            store.addEvent({
              id: "loaded-done", type: data.status === "completed" ? "task_complete" : "error",
              message: data.status, data: { tokens: data.total_tokens, cost: data.total_cost, turns: data.total_turns },
              timestamp: new Date().toISOString(),
            });
            store.setStatus(data.status === "completed" ? "completed" : "error");
          }
          setViewMode("task");
        }).catch(() => {});
    }
  }, [searchParams]); // eslint-disable-line
  const reset = useExecutionStore((s) => s.reset);
  const executionEvents = useExecutionStore((s) => s.events);

  // Audit state
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLive, setAuditLive] = useState(true);
  const auditEsRef = useRef<EventSource | null>(null);

  // View state
  const [viewMode, setViewMode] = useState<"task" | "all">("task");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [textFilter, setTextFilter] = useState("");
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const eventScrollRef = useRef<HTMLDivElement>(null);

  // Polling fallback
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load past audit events on mount ─────────────────────────────────

  useEffect(() => {
    fetch(`${BASE}/audit/events?limit=200`)
      .then(r => r.json())
      .then(data => {
        const events = (data.events || []).map((raw: any) => ({
          id: raw.id || Date.now() + Math.random(),
          ts: raw.ts || 0,
          source: raw.source || "unknown",
          type: raw.type || "",
          detail: raw.detail || "",
          data: raw.data || {},
        }));
        if (events.length > 0) setAuditEvents(events);
      })
      .catch(() => {});
  }, []);

  // ── Audit SSE ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!auditLive) return;

    const es = new EventSource(`${BASE}/audit/stream`);
    auditEsRef.current = es;

    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        if (raw.type === "ping" || raw.type === "connected") return;
        const evt: AuditEvent = {
          id: Date.now() + Math.random(),
          ts: raw.ts || Date.now() / 1000,
          source: raw.source || "unknown",
          type: raw.type || "",
          detail: raw.detail || raw.message || "",
          data: raw.data || raw,
        };
        setAuditEvents((prev) => {
          const next = [...prev, evt];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (auditLive) setAuditLive(false);
        setTimeout(() => setAuditLive(true), 100);
      }, 3000);
    };

    return () => { es.close(); auditEsRef.current = null; };
  }, [auditLive]);

  // Auto-scroll event stream
  useEffect(() => {
    if (eventScrollRef.current && viewMode === "all") {
      eventScrollRef.current.scrollTop = eventScrollRef.current.scrollHeight;
    }
  }, [auditEvents.length, viewMode]);

  // Auto-switch to "task" mode when a task starts
  useEffect(() => {
    if (status === "streaming") setViewMode("task");
  }, [status]);

  // ── Task actions ───────────────────────────────────────────────────────

  const startPolling = useCallback((id: string) => {
    const store = useExecutionStore.getState();
    store.startStream(id);
    store.setStatus("streaming");

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/tasks/${id}`, { headers: tenantHeaders(tenant) });
        if (!res.ok) return;
        const data = await res.json();
        const s = useExecutionStore.getState();
        const currentTurns = s.events.filter((e) => e.type === "turn_complete").length;
        const remoteTurns = data.total_turns || 0;
        if (remoteTurns > currentTurns) {
          for (let i = currentTurns; i < remoteTurns; i++) {
            const turn = data.turns?.[i];
            s.addEvent({
              id: `poll-${Date.now()}-${i}`,
              type: turn?.role === "tool_call" ? "tool_call" : "turn_complete",
              message: turn?.tool || `Turn ${i + 1}`,
              data: { turn: i + 1, tool: turn?.tool, role: turn?.role },
              timestamp: new Date().toISOString(),
            });
          }
        }
        if (data.status === "completed" || data.status === "failed") {
          s.addEvent({
            id: `poll-done-${Date.now()}`,
            type: data.status === "completed" ? "task_complete" : "error",
            message: data.status,
            data: { tokens: data.total_tokens, cost: data.total_cost, turns: data.total_turns },
            timestamp: new Date().toISOString(),
          });
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* ignore */ }
    }, 1500);
  }, [tenant]);

  const launchTask = useCallback(async () => {
    if (!goal.trim()) return;
    setLaunching(true);
    try {
      const res = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantHeaders(tenant) },
        body: JSON.stringify({ message: goal.trim(), mode: "kernel" }),
      });
      const data = await res.json();
      const id = data.task_id || data.id;
      if (id) {
        await new Promise((r) => setTimeout(r, 500));
        setTaskId(id);
      }
    } catch (err) {
      console.error("Failed to launch task:", err);
    } finally {
      setLaunching(false);
    }
  }, [goal, tenant]);

  // SSE fallback to polling
  useEffect(() => {
    if (status === "error" && taskId) {
      startPolling(taskId);
    }
  }, [status, taskId, startPolling]);

  const handleStop = useCallback(() => {
    disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
    setTaskId(null);
  }, [disconnect]);

  const handleReset = useCallback(() => {
    disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
    setTaskId(null);
    setGoal("");
    reset();
  }, [disconnect, reset]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && status === "idle") {
        launchTask();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [launchTask, status]);

  // ── Load trace for an audit event's task ────────────────────────────────

  const [loadingTraceFor, setLoadingTraceFor] = useState<string | null>(null);

  const loadTraceForEvent = useCallback(async (event: AuditEvent) => {
    const tid = (event.data.task_id as string) || (event.data.id as string);
    if (!tid || tid === loadingTraceFor) return;

    setLoadingTraceFor(tid);
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "get_trace", args: { task_id: tid } }),
      });
      const json = await res.json();
      const turns = json.result?.turns ?? json.turns ?? [];

      // Also get task info for tokens/cost
      const taskRes = await fetch(`${BASE}/tasks/${tid}`, { headers: tenantHeaders(tenant) }).then(r => r.json()).catch(() => null);

      useExecutionStore.getState().loadTrace(
        tid,
        turns,
        taskRes?.total_tokens,
        taskRes?.total_cost,
      );
    } catch { /* ignore */ }
    setLoadingTraceFor(null);
  }, [tenant, loadingTraceFor]);

  // ── Filtered events ────────────────────────────────────────────────────

  const filteredAuditEvents = auditEvents.filter((e) => {
    if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
    if (textFilter && !e.type.includes(textFilter) && !e.source.includes(textFilter) && !e.detail.includes(textFilter)) return false;
    return true;
  });

  const activeSources = [...new Set(auditEvents.map((e) => e.source))].sort();

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center">
            <Activity className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100">Monitor</h1>
            <p className="text-[10px] text-slate-500">Real-time execution graph &amp; system event stream</p>
          </div>
        </div>
        <MetricsBar />
      </div>

      {/* Input bar */}
      <div className="flex gap-2 shrink-0">
        <div className="flex-1 relative">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && status === "idle" && launchTask()}
            placeholder="Enter a task to monitor its execution..."
            disabled={status === "streaming"}
            className="w-full !py-2.5 !pl-4 !pr-24 text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 hidden sm:block">
            {status === "idle" ? "Ctrl+Enter" : ""}
          </span>
        </div>

        {status === "idle" ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={launchTask}
            disabled={!goal.trim() || launching}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {launching ? "Launching..." : "Execute"}
          </motion.button>
        ) : status === "streaming" ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleStop}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600/80 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-sm font-medium rounded-lg border border-white/[0.06] transition-colors"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Reset
          </motion.button>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-2.5 min-h-0">
        {/* Left: Graph + Detail */}
        <div className="flex flex-col gap-2.5 min-h-0">
          {/* Execution Graph */}
          <div className="flex-1 min-h-[250px]">
            <ExecutionGraph />
          </div>
          {/* Step Detail */}
          <div className="h-44 lg:h-52 bg-[#0c0c14] rounded-xl border border-white/[0.06] overflow-hidden">
            <StepDetail />
          </div>
        </div>

        {/* Right: Event Stream */}
        <div className="flex flex-col bg-[#0c0c14] rounded-xl border border-white/[0.06] overflow-hidden min-h-0">
          {/* Stream header */}
          <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-200">Event Stream</h3>
                <div className="flex items-center gap-1">
                  <div className={`h-1.5 w-1.5 rounded-full ${auditLive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                  <span className="text-[9px] text-slate-500">{auditLive ? "live" : "paused"}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-slate-600">
                  {viewMode === "task" ? `${executionEvents.length} events` : `${filteredAuditEvents.length} events`}
                </span>
                <button onClick={() => setShowFilters(!showFilters)} className={`p-1 rounded transition-colors ${showFilters ? "text-violet-400 bg-violet-500/10" : "text-slate-600 hover:text-slate-400"}`} data-tooltip="Filters">
                  <Filter className="h-3 w-3" />
                </button>
                <button onClick={() => setAuditLive(!auditLive)} className={`p-1 rounded transition-colors ${auditLive ? "text-emerald-400" : "text-slate-600 hover:text-slate-400"}`} data-tooltip={auditLive ? "Pause" : "Resume"}>
                  {auditLive ? <Activity className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-1 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
              <button
                onClick={() => setViewMode("task")}
                className={`flex-1 px-3 py-1 text-[10px] font-medium rounded-md transition-all ${
                  viewMode === "task"
                    ? "bg-violet-500/15 text-violet-300 shadow-sm"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                This Task
              </button>
              <button
                onClick={() => setViewMode("all")}
                className={`flex-1 px-3 py-1 text-[10px] font-medium rounded-md transition-all ${
                  viewMode === "all"
                    ? "bg-violet-500/15 text-violet-300 shadow-sm"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                All Events
              </button>
            </div>

            {/* Filters (collapsible) */}
            {showFilters && viewMode === "all" && (
              <div className="mt-2 space-y-1.5 animate-fade-in">
                {/* Source chips */}
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setSourceFilter("all")}
                    className={`px-2 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
                      sourceFilter === "all" ? "bg-violet-500/15 text-violet-300 border-violet-500/25" : "text-slate-500 border-white/[0.06] hover:text-slate-300"
                    }`}
                  >All</button>
                  {activeSources.map((s) => {
                    const style = SOURCE_STYLES[s] || DEFAULT_SOURCE;
                    return (
                      <button
                        key={s}
                        onClick={() => setSourceFilter(sourceFilter === s ? "all" : s)}
                        className={`px-2 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
                          sourceFilter === s ? `${style.bg} ${style.color}` : "text-slate-500 border-white/[0.06] hover:text-slate-300"
                        }`}
                      >{s}</button>
                    );
                  })}
                </div>
                {/* Text filter */}
                <input
                  value={textFilter}
                  onChange={(e) => setTextFilter(e.target.value)}
                  placeholder="Filter events..."
                  className="w-full !py-1 !px-2.5 !text-[11px] !bg-white/[0.02] !border-white/[0.04]"
                />
              </div>
            )}
          </div>

          {/* Event list */}
          <div ref={eventScrollRef} className="flex-1 overflow-y-auto min-h-0">
            {viewMode === "task" ? (
              /* Task events from execution store */
              <div className="p-1.5 space-y-0.5">
                {executionEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Tv2 className="h-6 w-6 text-slate-700 mb-2" />
                    <p className="text-[11px] text-slate-600">Execute a task to see events here</p>
                  </div>
                )}
                {executionEvents.map((evt) => (
                  <TaskEventRow key={evt.id} event={evt} />
                ))}
              </div>
            ) : (
              /* All audit events */
              <div className="p-1.5 space-y-0.5">
                {filteredAuditEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Activity className="h-6 w-6 text-slate-700 mb-2" />
                    <p className="text-[11px] text-slate-600">{auditLive ? "Waiting for events..." : "Stream paused"}</p>
                  </div>
                )}
                {filteredAuditEvents.map((evt) => (
                  <AuditEventRow
                    key={evt.id}
                    event={evt}
                    expanded={expandedEvent === evt.id}
                    onToggle={() => setExpandedEvent(expandedEvent === evt.id ? null : evt.id)}
                    onLoadTrace={loadTraceForEvent}
                    isLoadingTrace={loadingTraceFor === ((evt.data.task_id as string) || (evt.data.id as string))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Task Event Row ─────────────────────────────────────────────────────────

const TASK_EVENT_STYLES: Record<string, { icon: typeof Zap; color: string; bg: string }> = {
  task_started:         { icon: Play, color: "text-violet-400", bg: "bg-violet-500/8 border-violet-500/15" },
  task_complete:        { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/8 border-emerald-500/15" },
  turn_started:         { icon: RotateCw, color: "text-blue-400", bg: "bg-blue-500/8 border-blue-500/15" },
  turn_complete:        { icon: CheckCircle2, color: "text-blue-300", bg: "bg-blue-500/5 border-blue-500/10" },
  tool_call:            { icon: Wrench, color: "text-amber-400", bg: "bg-amber-500/8 border-amber-500/15" },
  tool_result:          { icon: CheckCircle2, color: "text-slate-300", bg: "bg-white/[0.02] border-white/[0.04]" },
  token:                { icon: Zap, color: "text-cyan-400", bg: "bg-cyan-500/5 border-cyan-500/10" },
  error:                { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/8 border-red-500/15" },
  context_bootstrapped: { icon: Shield, color: "text-indigo-400", bg: "bg-indigo-500/8 border-indigo-500/15" },
  plan_enforced:        { icon: ArrowRight, color: "text-pink-400", bg: "bg-pink-500/8 border-pink-500/15" },
  agent_handoff:        { icon: ArrowRight, color: "text-teal-400", bg: "bg-teal-500/8 border-teal-500/15" },
};

function TaskEventRow({ event }: { event: { id: string; type: string; message: string; data: Record<string, unknown>; timestamp: string } }) {
  const config = TASK_EVENT_STYLES[event.type] || { icon: Zap, color: "text-slate-400", bg: "bg-white/[0.02] border-white/[0.04]" };
  const Icon = config.icon;
  const isActive = useExecutionStore((s) => s.activeEventId === event.id);

  let timeStr = "";
  try {
    const d = new Date(event.timestamp);
    timeStr = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { /* ignore */ }

  return (
    <button
      onClick={() => useExecutionStore.getState().setActiveEvent(event.id)}
      className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all ${config.bg} ${
        isActive ? "ring-1 ring-violet-500/30 shadow-sm shadow-violet-500/5" : "hover:bg-white/[0.03]"
      }`}
    >
      <Icon className={`h-3 w-3 ${config.color} shrink-0`} />
      <span className={`text-[10px] font-medium ${config.color} truncate flex-1`}>
        {event.type.replace(/_/g, " ")}
        {event.message && <span className="text-slate-500 font-normal ml-1.5">{event.message.slice(0, 60)}</span>}
      </span>
      {event.type === "tool_call" && event.data.tool ? (
        <span className="text-[9px] font-mono bg-white/[0.04] text-amber-300 px-1.5 py-0.5 rounded border border-white/[0.06] shrink-0">
          {String(event.data.tool)}
        </span>
      ) : null}
      <span className="text-[9px] text-slate-600 font-mono shrink-0">{timeStr}</span>
    </button>
  );
}

// ── Audit Event Row ────────────────────────────────────────────────────────

function AuditEventRow({ event, expanded, onToggle, onLoadTrace, isLoadingTrace }: { event: AuditEvent; expanded: boolean; onToggle: () => void; onLoadTrace?: (event: AuditEvent) => void; isLoadingTrace?: boolean }) {
  const style = SOURCE_STYLES[event.source] || DEFAULT_SOURCE;

  // Quick-info badges
  const badges: { label: string; value: string }[] = [];
  const d = event.data;
  if (d.tool) badges.push({ label: "tool", value: String(d.tool) });
  if (d.model) badges.push({ label: "model", value: String(d.model).split("/").pop() || String(d.model) });
  if (d.duration_ms) badges.push({ label: "dur", value: `${d.duration_ms}ms` });
  if (d.tokens_in || d.tokens_out) badges.push({ label: "tok", value: `${d.tokens_in || 0}/${d.tokens_out || 0}` });
  if (d.caller) badges.push({ label: "from", value: String(d.caller) });

  const hasError = event.type.includes("fail") || event.type.includes("error") || d.success === false;
  const hasSuccess = d.success === true || event.type.includes("completed") || event.type.includes("succeeded");

  return (
    <div className={`rounded-lg border transition-all ${expanded ? "bg-white/[0.02] border-white/[0.06]" : "border-transparent hover:bg-white/[0.02]"}`}>
      <button onClick={onToggle} className="w-full text-left flex items-center gap-2 px-2.5 py-1.5">
        {/* Source badge */}
        <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border shrink-0 ${style.bg} ${style.color}`}>
          {event.source.slice(0, 4)}
        </span>
        {/* Type */}
        <span className="text-[10px] text-slate-300 font-medium truncate min-w-0">
          {event.type}
        </span>
        {/* Quick badges */}
        {badges.slice(0, 3).map((b, i) => (
          <span key={i} className="hidden sm:inline text-[8px] text-slate-500 bg-white/[0.03] px-1 py-0.5 rounded border border-white/[0.04] shrink-0">
            {b.value}
          </span>
        ))}
        {/* Status */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {hasError && <AlertCircle className="h-3 w-3 text-red-400" />}
          {hasSuccess && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
          <span className="text-[9px] text-slate-600 font-mono">{formatTs(event.ts)}</span>
          <ChevronDown className={`h-2.5 w-2.5 text-slate-600 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-2.5 pb-2 animate-fade-in">
          {event.detail && (
            <p className="text-[10px] text-slate-400 mb-1.5 px-1">{event.detail}</p>
          )}
          {/* All badges */}
          {badges.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {badges.map((b, i) => (
                <span key={i} className="text-[8px] text-slate-400 bg-white/[0.03] px-1.5 py-0.5 rounded border border-white/[0.04]">
                  <span className="text-slate-600">{b.label}:</span> {b.value}
                </span>
              ))}
            </div>
          ) : null}
          {/* Load trace button */}
          {(event.data.task_id || event.data.id) && onLoadTrace ? (
            <button
              onClick={() => onLoadTrace(event)}
              disabled={isLoadingTrace}
              className="flex items-center gap-1.5 mb-2 px-2.5 py-1.5 text-[10px] font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 rounded-lg transition-all disabled:opacity-50 w-full justify-center"
            >
              {isLoadingTrace ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <GitBranch className="h-3 w-3" />
              )}
              {isLoadingTrace ? "Loading trace..." : "View execution graph"}
            </button>
          ) : null}
          {/* JSON data */}
          <div className="relative">
            <pre className="text-[10px] text-slate-400 bg-[#08080f] rounded-lg p-2.5 overflow-x-auto max-h-32 font-mono border border-white/[0.03]">
              {JSON.stringify(event.data, null, 2)}
            </pre>
            <div className="absolute top-1.5 right-1.5">
              <CopyButton text={JSON.stringify(event.data, null, 2)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
