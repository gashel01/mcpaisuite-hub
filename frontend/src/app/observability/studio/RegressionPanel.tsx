'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Activity,
  TrendingUp,
  Clock,
  DollarSign,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8007';

interface Baseline {
  pattern: string;
  avg_cost: number;
  avg_turns: number;
  avg_latency_ms: number;
  sample_count: number;
  last_updated: string;
  success_rate: number;
}

interface Regression {
  goal: string;
  metric: string;
  expected: number;
  actual: number;
  ratio: number;
  trace_id?: string;
  detected_at: string;
}

interface RegressionPanelProps {
  namespace: string;
}

type SortKey = 'samples' | 'cost' | 'latency' | 'pattern';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function healthColor(rate: number): string {
  if (rate >= 0.9) return 'bg-emerald-400';
  if (rate >= 0.7) return 'bg-amber-400';
  return 'bg-rose-400';
}

export function RegressionPanel({ namespace }: RegressionPanelProps) {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [regressions, setRegressions] = useState<Regression[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('samples');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [blRes, regRes] = await Promise.all([
        fetch(`${API}/regression/baselines?namespace=${namespace}`),
        fetch(`${API}/regression/active?namespace=${namespace}`),
      ]);
      if (blRes.ok) setBaselines(await blRes.json());
      if (regRes.ok) setRegressions(await regRes.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const sorted = [...baselines].sort((a, b) => {
    switch (sortBy) {
      case 'samples':
        return b.sample_count - a.sample_count;
      case 'cost':
        return b.avg_cost - a.avg_cost;
      case 'latency':
        return (b.avg_latency_ms || 0) - (a.avg_latency_ms || 0);
      case 'pattern':
        return a.pattern.localeCompare(b.pattern);
      default:
        return 0;
    }
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <Activity size={18} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Regression Detection</h2>
            <p className="text-[10px] text-slate-500">Baselines are learned from task history. Alerts trigger at 2.5x deviation.</p>
          </div>
        </div>
        <div
          className="text-xs px-2.5 py-1 rounded-full bg-[#14142a] text-[#8b8ba8] border border-white/5 cursor-help"
          title={baselines.length > 0
            ? `Tracking: ${baselines.map(b => b.pattern).join(', ')}`
            : 'No baselines yet — run tasks to build them'}
        >
          {baselines.length} baselines
        </div>
      </div>

      {/* Active regressions */}
      <AnimatePresence>
        {regressions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle size={14} className="text-rose-400" />
              <span className="text-sm text-rose-300 font-medium">
                {regressions.length} active regression{regressions.length > 1 ? 's' : ''} detected
              </span>
            </div>

            {regressions.map((reg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="p-3 rounded-lg bg-[#14142a] border border-rose-500/20 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <p className="text-sm text-white font-medium line-clamp-1">
                    {reg.goal}
                  </p>
                  <span className="text-xs text-rose-300 font-mono shrink-0 ml-2">
                    {(reg.ratio ?? 0).toFixed(1)}x above baseline
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#8b8ba8]">
                  <span>
                    Metric: <span className="text-rose-300">{reg.metric}</span>
                  </span>
                  <span>
                    Expected: <span className="text-white">{(reg.expected ?? 0).toFixed(2)}</span>
                  </span>
                  <span>
                    Actual: <span className="text-rose-300">{(reg.actual ?? 0).toFixed(2)}</span>
                  </span>
                </div>
                {reg.trace_id && (
                  <a
                    href={`#trace-${reg.trace_id}`}
                    className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    View trace <ArrowUpRight size={10} />
                  </a>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sort controls */}
      {baselines.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8b8ba8]">Sort:</span>
          {(['samples', 'cost', 'latency', 'pattern'] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                sortBy === key
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-[#8b8ba8] hover:text-white hover:bg-white/5'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Baselines list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
        </div>
      ) : baselines.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <BarChart3 size={32} className="text-[#8b8ba8]/40 mx-auto" />
          <p className="text-[#8b8ba8] text-sm">
            No baselines yet. Run a few tasks and baselines will be automatically learned.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((bl, idx) => (
            <motion.div
              key={bl.pattern}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.02 }}
              className="group p-3 rounded-lg bg-[#14142a]/60 border border-white/5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${healthColor(bl.success_rate)}`}
                    title={`Success rate: ${((bl.success_rate ?? 0) * 100).toFixed(0)}%`}
                  />
                  <span className="text-xs text-white font-medium truncate" title={bl.pattern}>
                    {bl.pattern}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-500">{bl.sample_count} runs</span>
                  <span className="text-[10px] text-slate-600">{relativeTime(bl.last_updated)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-slate-400" title="Average cost per run">
                  <DollarSign size={11} className="text-emerald-400" />
                  ${(bl.avg_cost ?? 0).toFixed(4)}
                </span>
                <span className="inline-flex items-center gap-1 text-slate-400" title="Average turns per run">
                  <TrendingUp size={11} className="text-violet-400" />
                  {(bl.avg_turns ?? 0).toFixed(1)} turns
                </span>
                <span className="inline-flex items-center gap-1 text-slate-400" title="Average latency per run">
                  <Clock size={11} className="text-amber-400" />
                  {((bl.avg_latency_ms ?? 0) / 1000).toFixed(1)}s
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Footer explanation */}
      <div className="pt-3 border-t border-white/5">
        <p className="text-xs text-[#8b8ba8]/70 leading-relaxed">
          Baselines update automatically after each task completion using exponential
          moving average (alpha=0.15). Regressions trigger at 2.5x the baseline.
        </p>
      </div>
    </div>
  );
}
