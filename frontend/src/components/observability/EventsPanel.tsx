"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity, Tv2, Filter, Play, Wrench, Zap, AlertCircle,
  CheckCircle2, ChevronDown, RefreshCw, GitBranch, Shield,
  ArrowRight, RotateCw,
} from "lucide-react";
import type { StreamEvent } from "@/stores/execution";
import CopyButton from "@/components/copy-button";

// ── Source styles ─────────────────────────────────────────────────────────────

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

// ── Task event styles ─────────────────────────────────────────────────────────

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

// ── Audit Event type ──────────────────────────────────────────────────────────

// Re-export AuditEvent from global store for backward compat
export type { AuditEvent } from "@/stores/audit";
import type { AuditEvent } from "@/stores/audit";

// ── Props ─────────────────────────────────────────────────────────────────────

interface EventsPanelProps {
  events: StreamEvent[];
  auditEvents: AuditEvent[];
  viewMode: "task" | "all";
  setViewMode: (mode: "task" | "all") => void;
  sourceFilter: string;
  setSourceFilter: (source: string) => void;
  textFilter: string;
  setTextFilter: (text: string) => void;
  onEventClick?: (eventId: string) => void;
  onLoadTrace?: (event: AuditEvent) => void;
  activeEventId?: string | null;
  activeTaskId?: string;  // filter "All Events" to this task when set
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EventsPanel({
  events,
  auditEvents,
  viewMode,
  setViewMode,
  sourceFilter,
  setSourceFilter,
  textFilter,
  setTextFilter,
  onEventClick,
  onLoadTrace,
  activeEventId,
  activeTaskId,
}: EventsPanelProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [auditLive, setAuditLive] = useState(true);
  const [expandedEvent, setExpandedEvent] = useState<number | string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const eventScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (eventScrollRef.current && auditLive) {
      eventScrollRef.current.scrollTop = eventScrollRef.current.scrollHeight;
    }
  }, [events.length, auditEvents.length, auditLive]);

  // Derive active sources from audit events
  const activeSources = Array.from(new Set(auditEvents.map((e) => e.source)));

  // Filter + sort audit events
  const filteredAuditEvents = auditEvents
    .filter((evt) => {
      // When viewing a specific task, filter audit events to that task
      if (activeTaskId) {
        const evtTaskId = evt.data.task_id || evt.data.taskId || "";
        if (evtTaskId && String(evtTaskId) !== activeTaskId) return false;
      }
      if (sourceFilter !== "all" && evt.source !== sourceFilter) return false;
      if (textFilter && !evt.type.includes(textFilter) && !evt.detail.includes(textFilter)) return false;
      return true;
    })
    .sort((a, b) => sortOrder === "newest" ? b.ts - a.ts : a.ts - b.ts);

  return (
    <div className="flex flex-col h-full bg-[#0c0c14] rounded-xl border border-white/[0.06] overflow-hidden">
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
              {viewMode === "task" ? `${events.length} events` : `${filteredAuditEvents.length} events`}
            </span>
            {viewMode === "all" && (
              <>
                <button
                  onClick={() => setSortOrder(s => s === "newest" ? "oldest" : "newest")}
                  className="p-1 rounded text-slate-600 hover:text-slate-400 transition-colors"
                  title={sortOrder === "newest" ? "Newest first" : "Oldest first"}
                >
                  <ArrowRight className={`h-3 w-3 transition-transform ${sortOrder === "newest" ? "rotate-[-90deg]" : "rotate-90"}`} />
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-1 rounded transition-colors ${showFilters ? "text-violet-400 bg-violet-500/10" : "text-slate-600 hover:text-slate-400"}`}
                >
                  <Filter className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setAuditLive(!auditLive)}
                  className={`p-1 rounded transition-colors ${auditLive ? "text-emerald-400" : "text-slate-600 hover:text-slate-400"}`}
                >
                  {auditLive ? <Activity className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </button>
              </>
            )}
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
          <div className="p-1.5 space-y-0.5">
            {events.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Tv2 className="h-6 w-6 text-slate-700 mb-2" />
                <p className="text-[11px] text-slate-600">Execute a task to see events here</p>
              </div>
            )}
            {events.map((evt, i) => (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3) }}
              >
                <TaskEventRow event={evt} activeEventId={activeEventId} onEventClick={onEventClick} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {filteredAuditEvents.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="h-6 w-6 text-slate-700 mb-2" />
                <p className="text-[11px] text-slate-600">{auditLive ? "Waiting for events..." : "Stream paused"}</p>
              </div>
            )}
            {filteredAuditEvents.map((evt, i) => {
              // Match audit event to active task event by tool_name or event type
              const activeEvt = activeEventId ? events.find(e => e.id === activeEventId) : null;
              const isMatch = activeEvt ? matchAuditToTask(evt, activeEvt) : false;
              return (
                <motion.div
                  key={evt.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3) }}
                >
                  <AuditEventRow
                    event={evt}
                    expanded={expandedEvent === evt.id}
                    onToggle={() => setExpandedEvent(expandedEvent === evt.id ? null : evt.id)}
                    onLoadTrace={onLoadTrace}
                    highlighted={isMatch}
                  />
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Task Event Row ────────────────────────────────────────────────────────────

function TaskEventRow({
  event,
  activeEventId,
  onEventClick,
}: {
  event: StreamEvent;
  activeEventId?: string | null;
  onEventClick?: (id: string) => void;
}) {
  const config = TASK_EVENT_STYLES[event.type] || { icon: Zap, color: "text-slate-400", bg: "bg-white/[0.02] border-white/[0.04]" };
  const Icon = config.icon;
  const isActive = activeEventId === event.id;
  const ref = useRef<HTMLButtonElement>(null);

  // Auto-scroll into view when selected from the graph
  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  let timeStr = "";
  try {
    const d = new Date(event.timestamp);
    timeStr = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { /* ignore */ }

  return (
    <button
      ref={ref}
      onClick={() => onEventClick?.(event.id)}
      className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all ${config.bg} ${
        isActive ? "ring-2 ring-violet-500/40 shadow-md shadow-violet-500/10 bg-violet-500/5" : "hover:bg-white/[0.03]"
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

// ── Match audit event to selected task event (production: correlation_id) ────

function matchAuditToTask(audit: AuditEvent, taskEvt: StreamEvent): boolean {
  // Primary match: correlation_id (exact, reliable)
  const auditCid = audit.data.correlation_id;
  const taskCid = taskEvt.data.correlation_id || taskEvt.data.tool_call_id;
  if (auditCid && taskCid && String(auditCid) === String(taskCid)) return true;

  // Secondary match: task_id for task-level events
  const auditTaskId = audit.data.task_id;
  const taskTaskId = taskEvt.data.task_id;
  if (auditTaskId && taskTaskId && String(auditTaskId) === String(taskTaskId)) {
    // Only match task-level events (not tool events which would match all tools in the same task)
    const isTaskLevel = taskEvt.type === "task_started" || taskEvt.type === "task_complete" || taskEvt.type === "error";
    const isAuditTaskLevel = audit.type.includes("task_started") || audit.type.includes("task_completed") || audit.type.includes("task_failed");
    if (isTaskLevel && isAuditTaskLevel) return true;
  }

  return false;
}

// ── Audit Event Row ───────────────────────────────────────────────────────────

function AuditEventRow({
  event,
  expanded,
  onToggle,
  onLoadTrace,
  highlighted = false,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
  onLoadTrace?: (event: AuditEvent) => void;
  highlighted?: boolean;
}) {
  const style = SOURCE_STYLES[event.source] || DEFAULT_SOURCE;

  const badges: { label: string; value: string }[] = [];
  const d = event.data;
  if (d.tool) badges.push({ label: "tool", value: String(d.tool) });
  if (d.model) badges.push({ label: "model", value: String(d.model).split("/").pop() || String(d.model) });
  if (d.duration_ms) badges.push({ label: "dur", value: `${d.duration_ms}ms` });
  if (d.tokens_in || d.tokens_out) badges.push({ label: "tok", value: `${d.tokens_in || 0}/${d.tokens_out || 0}` });
  if (d.caller) badges.push({ label: "from", value: String(d.caller) });

  const hasError = event.type.includes("fail") || event.type.includes("error") || d.success === false;
  const hasSuccess = d.success === true || event.type.includes("completed") || event.type.includes("succeeded");

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlighted]);

  return (
    <div
      ref={rowRef}
      className={`rounded-lg border transition-all ${
        highlighted
          ? "bg-violet-500/5 border-violet-500/30 ring-1 ring-violet-500/20"
          : expanded ? "bg-white/[0.02] border-white/[0.06]" : "border-transparent hover:bg-white/[0.02]"
      }`}
    >
      <button onClick={onToggle} className="w-full text-left flex items-center gap-2 px-2.5 py-1.5">
        <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border shrink-0 ${style.bg} ${style.color}`}>
          {event.source.slice(0, 4)}
        </span>
        <span className="text-[10px] text-slate-300 font-medium truncate min-w-0">
          {event.type}
        </span>
        {badges.slice(0, 3).map((b, i) => (
          <span key={i} className="hidden sm:inline text-[8px] text-slate-500 bg-white/[0.03] px-1 py-0.5 rounded border border-white/[0.04] shrink-0">
            {b.value}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {hasError && <AlertCircle className="h-3 w-3 text-red-400" />}
          {hasSuccess && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
          <span className="text-[9px] text-slate-600 font-mono">{formatTs(event.ts)}</span>
          <ChevronDown className={`h-2.5 w-2.5 text-slate-600 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 animate-fade-in">
          {event.detail && (
            <p className="text-[10px] text-slate-400 mb-1.5 px-1">{event.detail}</p>
          )}
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {badges.map((b, i) => (
                <span key={i} className="text-[8px] text-slate-400 bg-white/[0.03] px-1.5 py-0.5 rounded border border-white/[0.04]">
                  <span className="text-slate-600">{b.label}:</span> {b.value}
                </span>
              ))}
            </div>
          )}
          {Boolean(event.data.task_id || event.data.id) && onLoadTrace && (
            <button
              onClick={() => onLoadTrace(event)}
              className="flex items-center gap-1.5 mb-2 px-2.5 py-1.5 text-[10px] font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 rounded-lg transition-all w-full justify-center"
            >
              <GitBranch className="h-3 w-3" />
              View execution graph
            </button>
          )}
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
