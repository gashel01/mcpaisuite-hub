"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, Clock, DollarSign, Cpu, Wrench, Layers, Loader2 } from "lucide-react";


interface SpanGroup {
  p50: number; p95: number; p99: number;
  min: number; max: number; avg: number; count: number;
}

interface Props {
  taskId: string;
  namespace: string;
  totalTokens?: number;
  totalCost?: number;
  totalTurns?: number;
}

const TYPE_COLORS: Record<string, { color: string; label: string; icon: typeof Cpu }> = {
  llm:   { color: "#3b82f6", label: "LLM", icon: Cpu },
  tool:  { color: "#f59e0b", label: "Tools", icon: Wrench },
  agent: { color: "#8b5cf6", label: "Agents", icon: Layers },
  chain: { color: "#64748b", label: "Chain", icon: BarChart3 },
  total: { color: "#ec4899", label: "Total", icon: Clock },
};

export default function RunStats({ taskId, namespace, totalTokens, totalCost, totalTurns }: Props) {
  const [spans, setSpans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSpans = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const data = await apiFetch<any>(`/tasks/${taskId}/spans`, { tenant: namespace });
      setSpans(data.spans || []);
    } catch {}
    setLoading(false);
  }, [taskId, namespace]);

  useEffect(() => { fetchSpans(); }, [fetchSpans]);

  // Compute per-type stats from spans
  const typeStats = computeTypeStats(spans);
  const totalDuration = spans[0]?.duration_ms ?? null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Run summary */}
      <div className="px-3 py-2.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-medium text-slate-300">Run Metrics</span>
          {loading && <Loader2 className="w-2.5 h-2.5 animate-spin text-slate-500" />}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Tokens" value={totalTokens != null ? totalTokens.toLocaleString() : "—"} color="#06b6d4" />
          <MiniStat label="Cost" value={totalCost != null ? `$${totalCost.toFixed(4)}` : "—"} color="#10b981" />
          <MiniStat label="Turns" value={totalTurns != null ? String(totalTurns) : "—"} color="#8b5cf6" />
        </div>
        {totalDuration != null && (
          <div className="mt-2 text-[9px] text-slate-500 text-center">
            Total duration: <span className="text-slate-300 font-mono">{fmtMs(totalDuration)}</span>
          </div>
        )}
      </div>

      {/* Per-type latency breakdown */}
      {Object.keys(typeStats).length > 0 && (
        <div className="px-3 py-2.5 border-b border-white/[0.04]">
          <div className="text-[10px] font-medium text-slate-400 mb-2">Latency by Type</div>
          <div className="space-y-2.5">
            {Object.entries(typeStats).map(([type, stats]) => {
              const cfg = TYPE_COLORS[type] || TYPE_COLORS.chain;
              const Icon = cfg.icon;
              return (
                <div key={type}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="w-2.5 h-2.5" style={{ color: cfg.color }} />
                    <span className="text-[9px] text-slate-400">{cfg.label}</span>
                    <span className="text-[8px] text-slate-600 ml-auto">{stats.count} spans</span>
                  </div>
                  <div className="space-y-0.5">
                    <LatencyBar label="p50" value={stats.p50} max={stats.max} color={cfg.color} />
                    <LatencyBar label="p95" value={stats.p95} max={stats.max} color={cfg.color} />
                  </div>
                  <div className="flex items-center justify-between mt-0.5 text-[8px] text-slate-600">
                    <span>avg {fmtMs(stats.avg)}</span>
                    <span>min {fmtMs(stats.min)}</span>
                    <span>max {fmtMs(stats.max)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cost breakdown from spans */}
      {spans.length > 0 && (
        <div className="px-3 py-2.5">
          <div className="text-[10px] font-medium text-slate-400 mb-2">Span Breakdown</div>
          <SpanTimeline spans={spans} />
        </div>
      )}

      {/* Empty state */}
      {!loading && spans.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-slate-500">
            <BarChart3 className="w-5 h-5 mx-auto text-slate-600 mb-1" />
            <p className="text-[10px]">No span data yet</p>
            <p className="text-[9px] text-slate-600">Metrics appear after execution</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white/[0.02] rounded-md px-2 py-1.5 text-center">
      <div className="text-[8px] text-slate-500">{label}</div>
      <div className="text-[11px] font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function LatencyBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[7px] text-slate-500 w-4 text-right font-mono">{label}</span>
      <div className="flex-1 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, opacity: label === "p50" ? 0.5 : 0.8 }} />
      </div>
      <span className="text-[8px] text-slate-400 font-mono w-12 text-right">{fmtMs(value)}</span>
    </div>
  );
}

function SpanTimeline({ spans }: { spans: any[] }) {
  // Flatten all spans to show a simple timeline
  const flat: { name: string; type: string; duration: number }[] = [];
  function walk(list: any[]) {
    for (const s of list) {
      if (s.duration_ms != null && s.duration_ms > 0) {
        flat.push({ name: s.name, type: s.type, duration: s.duration_ms });
      }
      if (s.children) walk(s.children);
    }
  }
  walk(spans);

  if (flat.length === 0) return null;
  const maxDur = Math.max(...flat.map(s => s.duration));

  return (
    <div className="space-y-0.5">
      {flat.slice(0, 15).map((s, i) => {
        const cfg = TYPE_COLORS[s.type] || TYPE_COLORS.chain;
        const pct = Math.max(3, (s.duration / maxDur) * 100);
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[8px] text-slate-500 truncate w-20" title={s.name}>
              {s.name.replace("tool.", "").replace("llm.", "").replace("chain.", "").replace("agent.", "")}
            </span>
            <div className="flex-1 h-1.5 bg-white/[0.02] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cfg.color, opacity: 0.6 }} />
            </div>
            <span className="text-[8px] text-slate-400 font-mono w-10 text-right">{fmtMs(s.duration)}</span>
          </div>
        );
      })}
      {flat.length > 15 && (
        <div className="text-[8px] text-slate-600 text-center">+{flat.length - 15} more spans</div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeTypeStats(spans: any[]): Record<string, SpanGroup> {
  const groups: Record<string, number[]> = {};
  function walk(list: any[]) {
    for (const s of list) {
      const dur = s.duration_ms;
      if (dur != null && dur > 0) {
        const type = s.type || "chain";
        if (!groups[type]) groups[type] = [];
        groups[type].push(dur);
      }
      if (s.children) walk(s.children);
    }
  }
  walk(spans);

  const result: Record<string, SpanGroup> = {};
  for (const [type, durations] of Object.entries(groups)) {
    const sorted = [...durations].sort((a, b) => a - b);
    const len = sorted.length;
    result[type] = {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      min: sorted[0],
      max: sorted[len - 1],
      avg: durations.reduce((s, v) => s + v, 0) / len,
      count: len,
    };
  }
  return result;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function fmtMs(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
