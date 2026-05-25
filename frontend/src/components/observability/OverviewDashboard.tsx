"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  CheckCircle2, DollarSign, Zap, Clock, Server,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

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

interface OverviewDashboardProps {
  analytics: Analytics | null;
  stats: Stats | null;
  loading: boolean;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, color, bg, label, value, sub, delay }: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  label: string;
  value: string;
  sub?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className={`rounded-xl border border-white/[0.06] ${bg} p-4 card-hover`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </motion.div>
  );
}

function CostRow({ label, value, color, pulse }: {
  label: string; value: string; color: string; pulse?: boolean;
}) {
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

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 animate-pulse">
      <div className="h-3 w-20 bg-white/[0.04] rounded mb-3" />
      <div className="h-6 w-16 bg-white/[0.06] rounded" />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function OverviewDashboard({ analytics, stats, loading }: OverviewDashboardProps) {
  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  const totalTasks = (analytics?.tasks_completed ?? 0) + (analytics?.tasks_failed ?? 0);
  const successRate = totalTasks > 0
    ? Math.round(((analytics?.tasks_completed ?? 0) / totalTasks) * 100)
    : 0;
  const maxToolCount = analytics?.top_tools?.[0]?.count ?? 1;

  return (
    <div className="flex-1 overflow-y-auto space-y-5 min-h-0 pb-4">
      {/* Hero metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={CheckCircle2} color="text-emerald-400" bg="bg-emerald-500/8"
          label="Success Rate" value={`${successRate}%`}
          sub={`${analytics?.tasks_completed ?? 0} of ${totalTasks} tasks`}
          delay={0}
        />
        <MetricCard
          icon={DollarSign} color="text-emerald-400" bg="bg-emerald-500/8"
          label="Total Cost"
          value={`$${(analytics?.total_cost ?? stats?.total_cost ?? 0).toFixed(4)}`}
          sub={totalTasks > 0 ? `$${((analytics?.total_cost ?? 0) / totalTasks).toFixed(4)} avg/task` : undefined}
          delay={0.05}
        />
        <MetricCard
          icon={Zap} color="text-blue-400" bg="bg-blue-500/8"
          label="Tokens Used"
          value={(analytics?.total_tokens ?? stats?.total_tokens ?? 0).toLocaleString()}
          sub={totalTasks > 0 ? `${Math.round(analytics?.avg_tokens_per_task ?? 0)} avg/task` : undefined}
          delay={0.1}
        />
        <MetricCard
          icon={Clock} color="text-amber-400" bg="bg-amber-500/8"
          label="Avg Duration"
          value={`${Math.round(analytics?.avg_duration_ms ?? 0)}ms`}
          sub={`${stats?.total_turns ?? 0} total turns`}
          delay={0.15}
        />
      </div>

      {/* Two column: success ring + cost breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Success ring + insights */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
        >
          <h3 className="text-xs font-semibold text-slate-300 mb-4">Performance</h3>
          <div className="flex items-center gap-5 mb-4">
            <div className="relative h-20 w-20 shrink-0">
              <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none"
                  stroke={successRate >= 80 ? "#10b981" : successRate >= 50 ? "#f59e0b" : "#ef4444"}
                  strokeWidth="3"
                  strokeDasharray={`${successRate} ${100 - successRate}`}
                  strokeLinecap="round"
                />
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
                <span className={`font-medium ${(analytics?.tasks_failed ?? 0) > 0 ? "text-red-400" : "text-slate-600"}`}>
                  {analytics?.tasks_failed ?? 0}
                </span>
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
                {analytics!.tasks_failed} task{analytics!.tasks_failed > 1 ? "s" : ""} failed — review task history for details
              </p>
            )}
            {stats?.model && (
              <p className="text-[11px] text-slate-500">
                Model: <span className="text-slate-300 font-mono">{stats.model}</span>
              </p>
            )}
          </div>
        </motion.div>

        {/* Right: Cost breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-slate-300">Cost Breakdown</h3>
            <Link href="/settings" className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
              Change model &rarr;
            </Link>
          </div>
          <div className="space-y-3.5">
            <CostRow
              label="Cost per 1K tokens"
              value={(analytics?.total_tokens ?? 0) > 0 ? `$${(((analytics?.total_cost ?? 0) / (analytics?.total_tokens ?? 1)) * 1000).toFixed(5)}` : "—"}
              color="text-emerald-400"
            />
            <CostRow
              label="Avg cost per task"
              value={totalTasks > 0 ? `$${((analytics?.total_cost ?? 0) / totalTasks).toFixed(4)}` : "—"}
              color="text-blue-400"
            />
            <CostRow
              label="Avg tokens per task"
              value={totalTasks > 0 ? Math.round((analytics?.total_tokens ?? 0) / totalTasks).toLocaleString() : "—"}
              color="text-violet-400"
            />
            <CostRow
              label="Connected servers"
              value={String(stats?.connected_servers ?? 0)}
              color="text-slate-200"
              pulse
            />
          </div>
          {/* Total cost highlight */}
          <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Total spend</span>
            <span className="text-lg font-bold text-emerald-400">
              ${(analytics?.total_cost ?? stats?.total_cost ?? 0).toFixed(4)}
            </span>
          </div>
        </motion.div>
      </div>

      {/* Top tools + models */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Tools */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
        >
          <h3 className="text-xs font-semibold text-slate-300 mb-3">Top Tools</h3>
          {analytics?.top_tools?.length ? (
            <div className="space-y-2.5">
              {analytics.top_tools.slice(0, 8).map((t) => {
                const pct = maxToolCount > 0 ? Math.round((t.count / maxToolCount) * 100) : 0;
                return (
                  <div key={t.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-slate-300 font-mono truncate max-w-[200px]">{t.name}</span>
                      <span className="text-[10px] text-slate-500">{t.count}</span>
                    </div>
                    <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-slate-600">No tool usage data yet.</p>
          )}
        </motion.div>

        {/* Top Models */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
        >
          <h3 className="text-xs font-semibold text-slate-300 mb-3">Models</h3>
          {analytics?.top_models?.length ? (
            <div className="space-y-2">
              {analytics.top_models.map((m) => (
                <div key={m.name} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                  <span className="text-[11px] text-slate-300 font-mono">{m.name}</span>
                  <span className="text-[10px] font-medium bg-blue-500/8 text-blue-400 border border-blue-500/15 px-2.5 py-0.5 rounded-full">
                    {m.count} calls
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-600">No model usage data yet.</p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
