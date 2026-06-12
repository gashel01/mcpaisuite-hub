"use client";

import {
  LayoutList,
  Play,
  Pause,
  CheckCircle2,
  Repeat,
  AlertTriangle,
} from "lucide-react";
import type { SchedulerStats } from "@/types/scheduler";

interface SchedulerHeroProps {
  stats: SchedulerStats | null;
  loading: boolean;
  activeFilter: string | null;
  onFilterClick: (status: string | null) => void;
}

interface CardDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  getValue: (s: SchedulerStats) => number;
  getColor: (s: SchedulerStats) => string;
  pulse?: boolean;
  filterStatus: string | null;
}

const cards: CardDef[] = [
  {
    key: "total",
    label: "Total Jobs",
    icon: LayoutList,
    getValue: (s) => s.total_jobs,
    getColor: () => "text-white",
    filterStatus: null,
  },
  {
    key: "active",
    label: "Active",
    icon: Play,
    getValue: (s) => s.active_jobs,
    getColor: () => "text-green-400",
    pulse: true,
    filterStatus: "active",
  },
  {
    key: "paused",
    label: "Paused",
    icon: Pause,
    getValue: (s) => s.paused_jobs,
    getColor: () => "text-amber-400",
    filterStatus: "paused",
  },
  {
    key: "completed",
    label: "Completed",
    icon: CheckCircle2,
    getValue: (s) => s.completed_jobs,
    getColor: () => "text-slate-400",
    filterStatus: "completed",
  },
  {
    key: "runs",
    label: "Total Runs",
    icon: Repeat,
    getValue: (s) => s.total_runs,
    getColor: () => "text-violet-400",
    filterStatus: null,
  },
  {
    key: "failures",
    label: "Failures",
    icon: AlertTriangle,
    getValue: (s) => s.total_failures,
    getColor: (s) => (s.total_failures > 0 ? "text-red-400" : "text-green-400"),
    filterStatus: "failed",
  },
];

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 animate-pulse">
      <div className="h-3 w-16 bg-white/[0.04] rounded mb-2" />
      <div className="h-6 w-12 bg-white/[0.06] rounded" />
    </div>
  );
}

export default function SchedulerHero({
  stats,
  loading,
  activeFilter,
  onFilterClick,
}: SchedulerHeroProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const s = stats ?? {
    total_jobs: 0,
    active_jobs: 0,
    paused_jobs: 0,
    completed_jobs: 0,
    total_runs: 0,
    total_failures: 0,
  };

  const allZero =
    s.total_jobs === 0 &&
    s.active_jobs === 0 &&
    s.paused_jobs === 0 &&
    s.completed_jobs === 0;

  // Segmented bar proportions
  const total = s.total_jobs || 1;
  const segments = [
    { key: "active", pct: (s.active_jobs / total) * 100, color: "bg-green-400" },
    { key: "paused", pct: (s.paused_jobs / total) * 100, color: "bg-amber-400" },
    { key: "completed", pct: (s.completed_jobs / total) * 100, color: "bg-slate-400" },
    {
      key: "failed",
      pct:
        ((s.total_jobs - s.active_jobs - s.paused_jobs - s.completed_jobs) / total) *
        100,
      color: "bg-red-400",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 animate-fade-in">
        {cards.map((card) => {
          const value = card.getValue(s);
          const color = card.getColor(s);
          const Icon = card.icon;
          const isActive = activeFilter === card.filterStatus && card.filterStatus !== null;

          return (
            <button
              key={card.key}
              onClick={() =>
                onFilterClick(isActive ? null : card.filterStatus)
              }
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                isActive
                  ? "border-violet-500/30 bg-violet-500/[0.06]"
                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                {card.pulse && value > 0 && (
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                )}
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              <span className={`text-xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      {/* Segmented bar below hero */}
      {!allZero && (
        <div className="h-1 rounded-full overflow-hidden flex animate-fade-in">
          {segments.map((seg) => (
            <div
              key={seg.key}
              className={`h-full ${seg.color} transition-[width] duration-500`}
              style={{ width: `${seg.pct}%` }}
            />
          ))}
        </div>
      )}

      {allZero && (
        <p className="text-[11px] text-slate-600 text-center py-1">No jobs yet</p>
      )}
    </div>
  );
}
