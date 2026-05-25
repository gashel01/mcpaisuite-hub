"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  LayoutGrid,
  List,
  ChevronDown,
  Clock,
  Timer,
  Eye,
  CalendarClock,
  CalendarCheck,
} from "lucide-react";
import type { ScheduledJob } from "@/types/scheduler";
import StatusDot from "@/components/scheduler/StatusDot";

interface SchedulerGridProps {
  jobs: ScheduledJob[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  activeFilter: string | null;
  onFilterChange: (status: string | null) => void;
}

type SortKey = "next_run" | "created_at" | "run_count" | "failures";
type ViewMode = "list" | "grid";

const typeIcons: Record<ScheduledJob["schedule_type"], React.ComponentType<{ className?: string }>> = {
  once: CalendarCheck,
  cron: CalendarClock,
  interval: Timer,
  watch: Eye,
};

const typeColors: Record<ScheduledJob["schedule_type"], string> = {
  once: "text-blue-400 border-blue-500/20 bg-blue-500/10",
  cron: "text-violet-400 border-violet-500/20 bg-violet-500/10",
  interval: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
  watch: "text-amber-400 border-amber-500/20 bg-amber-500/10",
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getScheduleExpr(job: ScheduledJob): string {
  if (job.cron) return job.cron;
  if (job.interval_seconds) return `${job.interval_seconds}s`;
  if (job.watch_condition) return job.watch_condition.slice(0, 30);
  return "once";
}

function getSuccessRate(job: ScheduledJob): number {
  if (!job.history.length) return 0;
  return job.history.filter((r) => r.success).length / job.history.length;
}

function MiniSuccessBar({ job, width = 60 }: { job: ScheduledJob; width?: number }) {
  const rate = getSuccessRate(job);
  if (!job.history.length) {
    return <div className="h-1.5 rounded-full bg-white/[0.03]" style={{ width }} />;
  }
  return (
    <div
      className="h-1.5 rounded-full bg-red-400/30 overflow-hidden"
      style={{ width }}
    >
      <div
        className="h-full bg-green-400/60 rounded-full transition-all duration-300"
        style={{ width: `${rate * 100}%` }}
      />
    </div>
  );
}

function MiniSparkline({ job }: { job: ScheduledJob }) {
  const last5 = job.history.slice(-5);
  if (!last5.length) return null;
  const maxDur = Math.max(...last5.map((r) => r.duration_ms), 1);

  return (
    <div className="flex items-end gap-px h-5">
      {last5.map((run) => (
        <div
          key={run.run_id}
          className={`w-1.5 rounded-sm ${run.success ? "bg-green-400/50" : "bg-red-400/50"}`}
          style={{ height: `${(run.duration_ms / maxDur) * 100}%`, minHeight: 2 }}
        />
      ))}
    </div>
  );
}

export default function SchedulerGrid({
  jobs,
  selectedJobId,
  onSelectJob,
  activeFilter,
  onFilterChange,
}: SchedulerGridProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ScheduledJob["schedule_type"] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("next_run");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortOpen, setSortOpen] = useState(false);

  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    // Status filter from hero
    if (activeFilter) {
      result = result.filter((j) => j.status === activeFilter);
    }

    // Type filter
    if (typeFilter) {
      result = result.filter((j) => j.schedule_type === typeFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((j) => j.goal.toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      switch (sortKey) {
        case "next_run": {
          const aT = a.next_run ? new Date(a.next_run).getTime() : Infinity;
          const bT = b.next_run ? new Date(b.next_run).getTime() : Infinity;
          return aT - bT;
        }
        case "created_at": {
          const aT = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bT = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bT - aT;
        }
        case "run_count":
          return b.run_count - a.run_count;
        case "failures":
          return b.consecutive_failures - a.consecutive_failures;
        default:
          return 0;
      }
    });

    return result;
  }, [jobs, activeFilter, typeFilter, search, sortKey]);

  const sortLabels: Record<SortKey, string> = {
    next_run: "Next Run",
    created_at: "Created",
    run_count: "Run Count",
    failures: "Failures",
  };

  const typeOptions: ScheduledJob["schedule_type"][] = ["once", "cron", "interval", "watch"];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-white/[0.06] bg-white/[0.02] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/30 transition-colors"
          />
        </div>

        {/* Type filter chips */}
        <div className="flex items-center gap-1">
          {typeOptions.map((type) => {
            const Icon = typeIcons[type];
            const isActive = typeFilter === type;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(isActive ? null : type)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                  isActive
                    ? typeColors[type]
                    : "text-slate-500 border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <Icon className="h-3 w-3" />
                {type}
              </button>
            );
          })}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-slate-400 border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
          >
            {sortLabels[sortKey]}
            <ChevronDown className="h-3 w-3" />
          </button>
          {sortOpen && (
            <div className="absolute top-full mt-1 right-0 z-30 rounded-lg border border-white/[0.06] bg-[#0c0c14] shadow-xl py-1 min-w-[120px]">
              {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setSortKey(key);
                    setSortOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    sortKey === key
                      ? "text-violet-400 bg-violet-500/10"
                      : "text-slate-400 hover:bg-white/[0.04]"
                  }`}
                >
                  {sortLabels[key]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          <button
            onClick={() => setViewMode("list")}
            className={`p-1 rounded ${viewMode === "list" ? "bg-white/[0.06] text-slate-200" : "text-slate-500"}`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1 rounded ${viewMode === "grid" ? "bg-white/[0.06] text-slate-200" : "text-slate-500"}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Active filter badge */}
      {activeFilter && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">Filtered by:</span>
          <button
            onClick={() => onFilterChange(null)}
            className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
          >
            {activeFilter} &times;
          </button>
        </div>
      )}

      {/* Empty state */}
      {filteredJobs.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          <Clock className="h-8 w-8 text-slate-700 mb-3" />
          <p className="text-sm text-slate-400 font-medium">No scheduled jobs yet</p>
          <p className="text-[11px] text-slate-600 mt-1">
            Jobs are created from chat or agent workflows
          </p>
        </motion.div>
      )}

      {/* List view */}
      {viewMode === "list" && filteredJobs.length > 0 && (
        <div className="space-y-0.5">
          <AnimatePresence mode="popLayout">
            {filteredJobs.map((job, i) => (
              <motion.button
                key={job.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: i * 0.03, type: "spring", stiffness: 300, damping: 30 }}
                onClick={() => onSelectJob(job.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors group ${
                  selectedJobId === job.id
                    ? "border-violet-500/30 bg-violet-500/[0.04]"
                    : "border-transparent hover:bg-white/[0.02]"
                }`}
              >
                <StatusDot status={job.status} size="sm" />
                <span className="flex-1 text-xs text-slate-200 truncate min-w-0">
                  {job.goal}
                </span>
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-medium ${typeColors[job.schedule_type]}`}>
                  {job.schedule_type}
                </span>
                <span className="shrink-0 text-[10px] font-mono text-slate-500 w-20 text-right">
                  {getScheduleExpr(job)}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500 w-12 text-right">
                  {formatRelativeTime(job.next_run)}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500 w-8 text-right">
                  {job.run_count}
                </span>
                <MiniSuccessBar job={job} />
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Grid view */}
      {viewMode === "grid" && filteredJobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <AnimatePresence mode="popLayout">
            {filteredJobs.map((job, i) => {
              const TypeIcon = typeIcons[job.schedule_type];
              return (
                <motion.button
                  key={job.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.03, type: "spring", stiffness: 300, damping: 30 }}
                  onClick={() => onSelectJob(job.id)}
                  className={`text-left rounded-xl border p-3 transition-colors ${
                    selectedJobId === job.id
                      ? "border-violet-500/30 bg-violet-500/[0.04]"
                      : "border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.03]"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <TypeIcon className={`h-3.5 w-3.5 ${typeColors[job.schedule_type].split(" ")[0]}`} />
                    <StatusDot status={job.status} size="sm" />
                    <span className="text-[9px] text-slate-500 capitalize ml-auto">
                      {job.status}
                    </span>
                  </div>

                  {/* Goal */}
                  <p className="text-xs text-slate-200 line-clamp-2 mb-2 leading-relaxed">
                    {job.goal}
                  </p>

                  {/* Schedule info */}
                  <p className="text-[10px] font-mono text-slate-500 mb-2">
                    {getScheduleExpr(job)}
                  </p>

                  {/* Bottom row */}
                  <div className="flex items-center justify-between">
                    <MiniSparkline job={job} />
                    <span className="text-[10px] text-slate-500">
                      {formatRelativeTime(job.next_run)}
                    </span>
                  </div>

                  {/* Success bar */}
                  <div className="mt-2">
                    <MiniSuccessBar job={job} width={9999} />
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
