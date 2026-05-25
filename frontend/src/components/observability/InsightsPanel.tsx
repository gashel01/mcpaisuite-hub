"use client";

import { motion } from "framer-motion";
import {
  CheckCircle2, DollarSign, Zap, Clock, Server, Wrench, Bot,
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

interface InsightsPanelProps {
  analytics: Analytics | null;
  stats: Stats | null;
}

// ── Main component ──────────────────────────────────────────────────────────

export default function InsightsPanel({ analytics, stats }: InsightsPanelProps) {
  const totalTasks = (analytics?.tasks_completed ?? 0) + (analytics?.tasks_failed ?? 0);
  const successRate = totalTasks > 0
    ? Math.round(((analytics?.tasks_completed ?? 0) / totalTasks) * 100)
    : 0;
  const maxToolCount = analytics?.top_tools?.[0]?.count ?? 1;

  const metrics = [
    {
      icon: CheckCircle2,
      color: "text-emerald-400",
      label: "Success Rate",
      value: `${successRate}%`,
    },
    {
      icon: DollarSign,
      color: "text-emerald-400",
      label: "Total Cost",
      value: `$${(analytics?.total_cost ?? stats?.total_cost ?? 0).toFixed(4)}`,
    },
    {
      icon: Zap,
      color: "text-blue-400",
      label: "Tokens",
      value: (analytics?.total_tokens ?? stats?.total_tokens ?? 0).toLocaleString(),
    },
    {
      icon: Clock,
      color: "text-amber-400",
      label: "Avg Duration",
      value: `${Math.round(analytics?.avg_duration_ms ?? 0)}ms`,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35 }}
      className="w-[380px] shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 space-y-4 overflow-y-auto"
    >
      {/* Key metrics - vertical list */}
      <div>
        <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2.5">Key Metrics</h3>
        <div className="space-y-2">
          {metrics.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
                <span className="text-[11px] text-slate-400">{m.label}</span>
              </div>
              <span className={`text-xs font-mono font-semibold ${m.color}`}>{m.value}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Top 5 tools */}
      <div>
        <div className="flex items-center gap-1.5 mb-2.5">
          <Wrench className="h-3 w-3 text-violet-400" />
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Top Tools</h3>
        </div>
        {analytics?.top_tools?.length ? (
          <div className="space-y-2">
            {analytics.top_tools.slice(0, 5).map((t) => {
              const pct = maxToolCount > 0 ? Math.round((t.count / maxToolCount) * 100) : 0;
              return (
                <div key={t.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-slate-300 font-mono truncate max-w-[180px]">{t.name}</span>
                    <span className="text-[9px] text-slate-500">{t.count}</span>
                  </div>
                  <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
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
          <p className="text-[10px] text-slate-600">No tool data.</p>
        )}
      </div>

      {/* Top 3 models */}
      <div>
        <div className="flex items-center gap-1.5 mb-2.5">
          <Bot className="h-3 w-3 text-blue-400" />
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Models</h3>
        </div>
        {analytics?.top_models?.length ? (
          <div className="space-y-1.5">
            {analytics.top_models.slice(0, 3).map((m) => (
              <div key={m.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                <span className="text-[10px] text-slate-300 font-mono truncate max-w-[200px]">{m.name}</span>
                <span className="text-[9px] font-medium text-blue-400 bg-blue-500/8 border border-blue-500/15 px-2 py-0.5 rounded-full">
                  {m.count}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-600">No model data.</p>
        )}
      </div>

      {/* Connected servers */}
      <div className="flex items-center justify-between py-2 px-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[11px] text-slate-400">Connected Servers</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono font-semibold text-emerald-400">
            {stats?.connected_servers ?? 0}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
