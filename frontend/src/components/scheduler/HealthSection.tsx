"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import type { ScheduledJob } from "@/types/scheduler";

interface HealthSectionProps {
  job: ScheduledJob;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function HealthSection({ job }: HealthSectionProps) {
  const history = job.history ?? [];
  const totalRuns = history.length;
  const successCount = history.filter((r) => r.success).length;
  const successRate = totalRuns > 0 ? (successCount / totalRuns) * 100 : 0;

  // Computed stats
  const avgDuration =
    totalRuns > 0
      ? history.reduce((sum, r) => sum + r.duration_ms, 0) / totalRuns
      : 0;
  const totalCost = history.reduce((sum, r) => sum + r.cost, 0);
  const totalTokens = history.reduce((sum, r) => sum + r.tokens_used, 0);

  // Last 10 runs for mini bar chart
  const last10 = history.slice(-10);

  // Ring chart dimensions
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (successRate / 100) * circumference;

  const ringColor =
    successRate >= 80
      ? "#10b981"
      : successRate >= 50
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 space-y-4">
      <div className="flex items-center gap-4">
        {/* Success rate ring */}
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="4"
            />
            <motion.circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold text-slate-100">
              {Math.round(successRate)}%
            </span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div>
            <p className="text-[10px] text-slate-500">Avg Duration</p>
            <p className="text-xs font-medium text-slate-200">
              {formatDuration(avgDuration)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">Total Cost</p>
            <p className="text-xs font-medium text-emerald-400">
              ${totalCost.toFixed(4)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">Total Tokens</p>
            <p className="text-xs font-medium text-violet-400">
              {totalTokens.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">Success/Total</p>
            <p className="text-xs font-medium text-slate-200">
              {successCount}/{totalRuns}
            </p>
          </div>
        </div>
      </div>

      {/* Mini bar chart - last 10 runs */}
      {last10.length > 0 && (
        <div className="flex items-end gap-0.5 h-10">
          {last10.map((run, i) => (
            <motion.div
              key={run.run_id}
              className={`flex-1 rounded-sm ${
                run.success ? "bg-green-400/60" : "bg-red-400/60"
              }`}
              initial={{ height: 0 }}
              animate={{ height: "100%" }}
              transition={{
                delay: i * 0.03,
                type: "spring",
                stiffness: 300,
                damping: 30,
              }}
            />
          ))}
        </div>
      )}

      {/* Consecutive failures warning */}
      {job.consecutive_failures > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0" />
          <span className="text-[11px] text-orange-300">
            {job.consecutive_failures} consecutive failure
            {job.consecutive_failures > 1 ? "s" : ""} — auto-pause at{" "}
            {job.max_failures}
          </span>
        </motion.div>
      )}

      {/* Retry progress */}
      {job.retry_count > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Retry progress</span>
            <span className="text-[10px] text-slate-400">
              {job.retry_count}/{job.max_retries}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.03] overflow-hidden">
            <motion.div
              className="h-full bg-violet-500 rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${(job.retry_count / job.max_retries) * 100}%`,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
