"use client";

import { motion } from "framer-motion";
import { Clock, Zap, DollarSign, RotateCw } from "lucide-react";
import { useExecutionStore } from "@/stores/execution";

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

export default function MetricsBar() {
  const { turns, tokens, cost, elapsed, status } = useExecutionStore();

  const metrics = [
    { icon: RotateCw, label: "Turns", value: turns.toString(), color: "text-violet-400" },
    { icon: Zap, label: "Tokens", value: tokens > 0 ? tokens.toLocaleString() : "—", color: "text-blue-400" },
    { icon: DollarSign, label: "Cost", value: formatCost(cost), color: "text-emerald-400" },
    { icon: Clock, label: "Elapsed", value: formatElapsed(elapsed), color: "text-amber-400" },
  ];

  return (
    <div className="flex items-center gap-1">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/50 border border-slate-700/40 rounded-lg"
        >
          <m.icon className={`h-3.5 w-3.5 ${m.color}`} />
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">{m.label}</span>
          <span className={`text-xs font-mono font-medium ${m.color}`}>{m.value}</span>
        </motion.div>
      ))}

      {/* Status indicator */}
      <div className="ml-2 flex items-center gap-1.5">
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
        <span className="text-[10px] text-slate-500 capitalize">{status}</span>
      </div>
    </div>
  );
}
