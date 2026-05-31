'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { MetricsChart } from './MetricsChart';
import { DateRangePicker } from './DateRangePicker';
import { StatCard } from './StatCard';
import { getApiUrl } from '@/lib/api-url';

interface ChartGridProps {
  namespace: string;
}

interface TimeseriesPoint {
  timestamp: string;
  value: number;
  count: number;
}

interface SummaryData {
  total_tasks?: number;
  total_cost?: number;
  total_tokens?: number;
  avg_latency?: number;
  tasks_trend?: number;
  cost_trend?: number;
  tokens_trend?: number;
  latency_trend?: number;
  tasks_sparkline?: number[];
  cost_sparkline?: number[];
  tokens_sparkline?: number[];
  latency_sparkline?: number[];
}

const METRICS = ['latency', 'cost', 'success_rate', 'throughput'] as const;

export function ChartGrid({ namespace }: ChartGridProps) {
  const API = getApiUrl();
  const [window, setWindow] = useState('24h');
  const [chartData, setChartData] = useState<Record<string, TimeseriesPoint[]>>({});
  const [chartLoading, setChartLoading] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<SummaryData>({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMetric = useCallback(async (metric: string) => {
    setChartLoading(prev => ({ ...prev, [metric]: true }));
    try {
      const res = await fetch(`${API}/metrics/timeseries?metric=${metric}&window=${window}`, {
        headers: { 'X-Tenant-Id': namespace },
      });
      if (res.ok) {
        const data = await res.json();
        setChartData(prev => ({ ...prev, [metric]: Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [] }));
      }
    } catch {
      // silently fail per chart
    } finally {
      setChartLoading(prev => ({ ...prev, [metric]: false }));
    }
  }, [window, namespace]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`${API}/metrics/summary?window=${window}`, {
        headers: { 'X-Tenant-Id': namespace },
      });
      if (res.ok) {
        const data = await res.json();
        setSummary({
          total_tasks: data.total_tasks ?? 0,
          total_cost: data.total_cost ?? 0,
          total_tokens: data.total_tokens ?? 0,
          avg_latency: data.avg_latency_ms ?? 0,
          tasks_trend: data.trends?.tasks,
          cost_trend: data.trends?.cost,
          tokens_trend: data.trends?.latency,
          latency_trend: data.trends?.latency,
        });
      }
    } catch {
      // silently fail
    }
  }, [window, namespace]);

  const fetchAll = useCallback(() => {
    METRICS.forEach(m => fetchMetric(m));
    fetchSummary();
  }, [fetchMetric, fetchSummary]);

  useEffect(() => {
    fetchAll();

    if (intervalRef.current) clearInterval(intervalRef.current);
    const interval = (window === '1h' || window === '6h') ? 30000 : 60000;
    intervalRef.current = setInterval(fetchAll, interval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll, window]);

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-white text-lg font-semibold">Performance Metrics</h2>
        <DateRangePicker value={window} onChange={setWindow} />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Tasks"
          value={summary.total_tasks ?? '—'}
          trend={summary.tasks_trend}
          sparkline={summary.tasks_sparkline}
          color="#8b5cf6"
          icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v2H2V3zm0 4h12v2H2V7zm0 4h8v2H2v-2z"/></svg>}
        />
        <StatCard
          label="Cost"
          value={summary.total_cost != null ? `$${summary.total_cost.toFixed(2)}` : '—'}
          trend={summary.cost_trend}
          sparkline={summary.cost_sparkline}
          color="#10b981"
          icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.5 10.5v1h-1v-1a2.5 2.5 0 01-2-1.5l1-.5a1.5 1.5 0 001 1h2a.5.5 0 000-1H7.5a1.5 1.5 0 010-3h1v-1h1v1a2.5 2.5 0 012 1.5l-1 .5a1.5 1.5 0 00-1-1h-2a.5.5 0 000 1h2a1.5 1.5 0 010 3h-1z"/></svg>}
        />
        <StatCard
          label="Tokens"
          value={summary.total_tokens != null ? summary.total_tokens.toLocaleString() : '—'}
          trend={summary.tokens_trend}
          sparkline={summary.tokens_sparkline}
          color="#06b6d4"
          icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h10l1 1v10l-1 1H3l-1-1V3l1-1zm1 2v8h8V4H4z"/></svg>}
        />
        <StatCard
          label="Avg Latency"
          value={summary.avg_latency != null ? summary.avg_latency.toFixed(0) : '—'}
          unit="ms"
          trend={summary.latency_trend}
          sparkline={summary.latency_sparkline}
          color="#ec4899"
          icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.5 3h1v4.5l3 1.5-.5 1-3.5-1.75V4z"/></svg>}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {METRICS.map((metric) => (
          <div
            key={metric}
            className="bg-[#0f0f1c] border border-white/[0.07] rounded-xl p-4 transition-opacity duration-300"
            style={{ opacity: chartLoading[metric] && !chartData[metric] ? 0.6 : 1 }}
          >
            <h3 className="text-[#8b8ba8] text-xs font-medium uppercase tracking-wide mb-3">
              {metric === 'latency' && 'Latency (ms)'}
              {metric === 'cost' && 'Cost ($)'}
              {metric === 'success_rate' && 'Success Rate (%)'}
              {metric === 'throughput' && 'Throughput'}
            </h3>
            <MetricsChart
              metric={metric}
              data={chartData[metric] || []}
              window={window}
              loading={chartLoading[metric]}
              height={200}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
