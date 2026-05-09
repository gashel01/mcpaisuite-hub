"use client";

import { useEffect, useState } from "react";
import { DollarSign, Zap, Hash, Activity, RefreshCw, TrendingUp, Server } from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

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

export default function CostPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/stats`);
      if (r.ok) setStats(await r.json());
    } catch (_e) { }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Cost & Usage</h1>
            <p className="text-xs text-slate-500">Token consumption, task metrics, cost tracking</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs border border-slate-700/60 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {stats ? (
        <>
          {/* Summary cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Zap} color="text-violet-400" bg="bg-violet-600/10" label="Total Tokens" value={stats.total_tokens.toLocaleString()} />
            <StatCard icon={DollarSign} color="text-green-400" bg="bg-green-600/10" label="Total Cost" value={`$${stats.total_cost.toFixed(4)}`} />
            <StatCard icon={Hash} color="text-blue-400" bg="bg-blue-600/10" label="Tasks Completed" value={String(stats.tasks_completed)} sub={stats.tasks_failed > 0 ? `${stats.tasks_failed} failed` : undefined} />
            <StatCard icon={Activity} color="text-amber-400" bg="bg-amber-600/10" label="Total Turns" value={String(stats.total_turns)} sub={`~${stats.avg_turns_per_task.toFixed(1)} per task`} />
          </div>

          {/* Details table */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/40">
              <h2 className="text-sm font-medium text-slate-300">Detailed Metrics</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Tasks Completed", stats.tasks_completed, "text-green-400"],
                  ["Tasks Failed", stats.tasks_failed, stats.tasks_failed > 0 ? "text-red-400" : "text-slate-500"],
                  ["Total Turns", stats.total_turns, "text-slate-200"],
                  ["Avg Turns / Task", stats.avg_turns_per_task.toFixed(1), "text-slate-200"],
                  ["Total Tokens", stats.total_tokens.toLocaleString(), "text-violet-400"],
                  ["Total Cost", `$${stats.total_cost.toFixed(6)}`, "text-green-400"],
                  ["Connected Servers", stats.connected_servers, "text-slate-200"],
                  ["Model", stats.model || "N/A", "text-slate-400"],
                ].map(([label, value, color], i) => (
                  <tr key={i} className="border-b border-slate-700/30 last:border-0">
                    <td className="px-4 py-2.5 text-slate-400">{String(label)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${String(color)}`}>{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cost per token */}
          {stats.total_tokens > 0 && (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                <span>Average cost per 1K tokens: <strong className="text-green-400">${((stats.total_cost / stats.total_tokens) * 1000).toFixed(6)}</strong></span>
                <span className="text-slate-600 mx-2">&middot;</span>
                <Server className="h-3.5 w-3.5 text-violet-400" />
                <span>{stats.connected_servers} servers active</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16">
          <DollarSign className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No usage data yet. Run a task to start tracking.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, color, bg, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string; label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl px-4 py-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-7 w-7 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-slate-100">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}
