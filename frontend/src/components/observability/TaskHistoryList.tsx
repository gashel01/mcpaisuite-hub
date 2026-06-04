"use client";

import { motion } from "framer-motion";
import { Clock, CheckCircle2, AlertCircle, Loader2, History, Workflow, Rocket, ChevronLeft, ChevronRight } from "lucide-react";
import { parseTaskforce, taskforceLabel } from "@/lib/taskforce";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TaskSummary {
  id: string;
  goal: string;
  status: "completed" | "failed" | "running" | "idle";
  startedAt: string;
  durationMs?: number;
  source?: string;          // "chat" | "taskforce" | "deployment"
  deploymentName?: string;  // set when source === "deployment"
}

interface TaskHistoryListProps {
  tasks: TaskSummary[];
  selectedTask?: string | null;
  onSelect: (taskId: string) => void;
  loading?: boolean;
  // Optional pagination (local scope). When provided, a Prev/Next footer shows.
  total?: number;
  page?: number;            // 0-based
  pageSize?: number;
  onPageChange?: (page: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  return `${sec}s`;
}

const STATUS_CONFIG: Record<TaskSummary["status"], { icon: typeof Clock; color: string; bg: string; label: string }> = {
  completed: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "done" },
  failed:    { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", label: "fail" },
  running:   { icon: Loader2, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", label: "run" },
  idle:      { icon: Clock, color: "text-slate-400", bg: "bg-white/[0.03] border-white/[0.06]", label: "idle" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TaskHistoryList({ tasks, selectedTask, onSelect, loading, total, page = 0, pageSize = 100, onPageChange }: TaskHistoryListProps) {
  const paginated = typeof total === "number" && !!onPageChange;
  const pageCount = paginated ? Math.max(1, Math.ceil((total || 0) / pageSize)) : 1;
  const rangeStart = paginated ? page * pageSize + 1 : 1;
  const rangeEnd = paginated ? page * pageSize + tasks.length : tasks.length;

  return (
    <div className="flex flex-col h-full bg-[#0c0c14] rounded-xl border border-white/[0.06] overflow-hidden min-h-0">
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5 border-b border-white/[0.04] shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-slate-400" />
          <h3 className="text-[11px] sm:text-xs font-semibold text-slate-200">Recent Tasks ({total ?? tasks.length})</h3>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1">
        {tasks.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <History className="h-7 w-7 text-slate-700 mb-3" />
            <p className="text-xs text-slate-600">No tasks yet</p>
          </div>
        )}

        {tasks.map((task, i) => {
          const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.idle;
          const Icon = cfg.icon;
          const isSelected = selectedTask === task.id;
          const { isTaskforce, tag, text } = parseTaskforce(task.goal);

          return (
            <motion.button
              key={task.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => onSelect(task.id)}
              className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all touch-target ${
                isSelected
                  ? "bg-violet-500/8 border-violet-500/20 ring-1 ring-violet-500/20"
                  : "border-transparent hover:bg-white/[0.02]"
              }`}
            >
              {/* Status icon */}
              <Icon className={`h-4 w-4 shrink-0 ${cfg.color} ${task.status === "running" ? "animate-spin" : ""}`} />

              {/* Goal text — deployment runs show a rocket, other TaskForce runs a workflow
                  icon, each with a human-readable tooltip instead of a [TaskForce] prefix */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {task.source === "deployment" ? (
                  <span title={`Deployment${task.deploymentName ? `: ${task.deploymentName}` : ""}`} aria-label="Deployment run" className="shrink-0 flex items-center">
                    <Rocket className="h-3.5 w-3.5 text-emerald-400" />
                  </span>
                ) : isTaskforce ? (
                  <span title={taskforceLabel(tag)} aria-label={taskforceLabel(tag)} className="shrink-0 flex items-center">
                    <Workflow className="h-3.5 w-3.5 text-violet-400" />
                  </span>
                ) : null}
                <span className="text-[11px] sm:text-xs text-slate-300 font-medium truncate min-w-0">
                  {text}
                </span>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Status badge */}
                <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>
                  {cfg.label}
                </span>
                {/* Duration */}
                {task.durationMs && (
                  <span className="text-[10px] text-slate-600 font-mono hidden sm:inline">{formatDuration(task.durationMs)}</span>
                )}
                {/* Time ago */}
                <span className="text-[10px] text-slate-600 font-mono">{timeAgo(task.startedAt)}</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Pagination footer (local scope, when there is more than one page) */}
      {paginated && pageCount > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.04] shrink-0">
          <button
            onClick={() => onPageChange!(Math.max(0, page - 1))}
            disabled={page <= 0 || loading}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3 w-3" /> Newer
          </button>
          <span className="text-[9px] text-slate-500 font-mono tabular-nums">{rangeStart}–{rangeEnd} of {total} · p{page + 1}/{pageCount}</span>
          <button
            onClick={() => onPageChange!(Math.min(pageCount - 1, page + 1))}
            disabled={page >= pageCount - 1 || loading}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Older <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
