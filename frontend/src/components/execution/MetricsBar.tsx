"use client";

import { motion } from "framer-motion";
import { Clock, Zap, DollarSign, RotateCw } from "lucide-react";
import { useExecutionStore } from "@/stores/execution";
import { useShallow } from "zustand/react/shallow";

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}.${Math.floor((ms % 1000) / 100)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

interface MetricsBarProps {
  compact?: boolean;
}

export default function MetricsBar({ compact }: MetricsBarProps) {
  const { turns, tokens, cost, elapsed, status } = useExecutionStore(
    useShallow(s => ({ turns: s.turns, tokens: s.tokens, cost: s.cost, elapsed: s.elapsed, status: s.status }))
  );

  const metrics = [
    { icon: RotateCw, label: "Turns", value: turns.toString(), color: "text-violet-400" },
    { icon: Zap, label: "Tokens", value: tokens > 0 ? tokens.toLocaleString() : "—", color: "text-blue-400" },
    { icon: DollarSign, label: "Cost", value: formatCost(cost), color: "text-emerald-400" },
    { icon: Clock, label: "Elapsed", value: formatElapsed(elapsed), color: "text-amber-400" },
  ];

  if (compact) {
    return (
      <div className="flex items-center gap-3 overflow-x-auto pb-0.5 scrollbar-none">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-1.5 shrink-0">
            <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
            <span className={`text-[11px] font-mono font-medium ${m.color}`}>{m.value}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          <div className={`h-2 w-2 rounded-full ${
            status === "streaming" ? "bg-green-400 status-dot-live" :
            status === "completed" ? "bg-violet-400" :
            status === "error" ? "bg-red-400" :
            "bg-slate-600"
          }`} />
          <span className="text-[10px] text-slate-500 capitalize">{status}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg hover:bg-white/[0.05] transition-colors"
        >
          <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
          <span className="text-[10px] text-slate-500 uppercase tracking-wide hidden xl:inline">{m.label}</span>
          <span className={`text-xs font-mono font-medium ${m.color}`}>{m.value}</span>
        </motion.div>
      ))}

      {/* Status indicator */}
      <div className="ml-1.5 flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white/[0.02]">
        <motion.div
          className={`h-2 w-2 rounded-full ${
            status === "streaming" ? "bg-green-400" :
            status === "completed" ? "bg-violet-400" :
            status === "error" ? "bg-red-400" :
            "bg-slate-600"
          }`}
          animate={status === "streaming" ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
          transition={{ repeat: Infinity, duration: 1.2 }}
        />
        <span className="text-[10px] text-slate-500 capitalize font-medium">{status}</span>
      </div>
    </div>
  );
}
