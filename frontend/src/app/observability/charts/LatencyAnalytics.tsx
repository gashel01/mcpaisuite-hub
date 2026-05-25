'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Clock, Cpu, Wrench, Users, Link2, Database, Loader2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8007';

// ── Types ─────────────────────────────────────────────────────────────────

interface PercentileGroup {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

interface HistogramBin {
  min: number;
  max: number;
  count: number;
  label: string;
}

interface LatencyData {
  window: string;
  group_by: string;
  groups: Record<string, PercentileGroup>;
  histogram: HistogramBin[];
  task_count: number;
}

interface Props {
  namespace: string;
  window?: string;
  onSelectWindow?: (w: string) => void;
}

// ── Colors & icons per type ──────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { color: string; icon: typeof Cpu; label: string }> = {
  llm:       { color: '#3b82f6', icon: Cpu,      label: 'LLM Calls' },
  tool:      { color: '#f59e0b', icon: Wrench,   label: 'Tool Calls' },
  agent:     { color: '#8b5cf6', icon: Users,    label: 'Agents' },
  retrieval: { color: '#06b6d4', icon: Database, label: 'Retrieval' },
  chain:     { color: '#64748b', icon: Link2,    label: 'Chains' },
  total:     { color: '#ec4899', icon: Clock,    label: 'End-to-End' },
};

const WINDOWS = ['1h', '6h', '24h', '7d'] as const;

// ── Component ────────────────────────────────────────────────────────────

export function LatencyAnalytics({ namespace, window: externalWindow, onSelectWindow }: Props) {
  const [win, setWin] = useState(externalWindow || '24h');
  const [data, setData] = useState<LatencyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<'type' | 'name'>('type');

  const activeWindow = externalWindow || win;

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/analytics/latency?window=${activeWindow}&group_by=${groupBy}`, {
        headers: { 'X-Tenant-Id': namespace },
      });
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeWindow, groupBy, namespace]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const handleWindow = (w: string) => {
    setWin(w);
    onSelectWindow?.(w);
  };

  const groups = data?.groups || {};
  const histogram = data?.histogram || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-white">Latency Analytics</h3>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
        </div>
        <div className="flex items-center gap-1">
          {/* Group by toggle */}
          <div className="flex items-center bg-white/[0.03] rounded-md p-0.5 mr-2">
            {(['type', 'name'] as const).map(g => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
                  groupBy === g ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          {/* Window selector */}
          <div className="flex items-center bg-white/[0.03] rounded-md p-0.5">
            {WINDOWS.map(w => (
              <button
                key={w}
                onClick={() => handleWindow(w)}
                className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
                  activeWindow === w ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Percentile cards */}
      {Object.keys(groups).length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {Object.entries(groups).map(([key, g]) => {
            const cfg = TYPE_CONFIG[key] || { color: '#64748b', icon: Clock, label: key };
            const Icon = cfg.icon;
            return (
              <div
                key={key}
                className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3 hover:border-white/[0.12] transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className="w-3 h-3" style={{ color: cfg.color }} />
                  <span className="text-[10px] font-medium text-slate-400">{cfg.label}</span>
                  <span className="text-[8px] text-slate-600 ml-auto">{g.count} spans</span>
                </div>

                {/* Percentile bars */}
                <div className="space-y-1">
                  <PercentileBar label="p50" value={g.p50} max={g.max} color={cfg.color} opacity={0.5} />
                  <PercentileBar label="p95" value={g.p95} max={g.max} color={cfg.color} opacity={0.75} />
                  <PercentileBar label="p99" value={g.p99} max={g.max} color={cfg.color} opacity={1} />
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between mt-2 text-[8px] text-slate-500">
                  <span>avg {fmtMs(g.avg)}</span>
                  <span>min {fmtMs(g.min)}</span>
                  <span>max {fmtMs(g.max)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : !loading ? (
        <div className="text-center py-8 text-slate-500 text-xs">
          No span data available for this time window.
          <br />
          <span className="text-[10px] text-slate-600">Run some tasks to see latency analytics.</span>
        </div>
      ) : null}

      {/* Histogram */}
      {histogram.length > 0 && (
        <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3">
          <h4 className="text-[10px] font-medium text-slate-400 mb-2">Duration Distribution</h4>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={histogram} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: '#64748b', fontSize: 8 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: '#14142a',
                  border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '6px',
                  fontSize: '10px',
                  color: '#fff',
                }}
                formatter={(value: unknown) => [`${value} spans`, 'Count']}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {histogram.map((_, i) => (
                  <Cell
                    key={i}
                    fill={`rgba(139, 92, 246, ${0.2 + (i / histogram.length) * 0.6})`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Task count footer */}
      {data && (
        <div className="text-[9px] text-slate-600 text-center">
          Based on {data.task_count} task{data.task_count !== 1 ? 's' : ''} in the last {activeWindow}
        </div>
      )}
    </div>
  );
}

// ── PercentileBar sub-component ──────────────────────────────────────────

function PercentileBar({ label, value, max, color, opacity }: {
  label: string; value: number; max: number; color: string; opacity: number;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] text-slate-500 w-5 text-right font-mono">{label}</span>
      <div className="flex-1 h-2 bg-white/[0.03] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color, opacity }}
        />
      </div>
      <span className="text-[9px] text-slate-400 font-mono w-14 text-right">{fmtMs(value)}</span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
