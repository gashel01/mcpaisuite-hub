'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import { DollarSign, Cpu, Wrench, Users, Loader2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8007';

interface CostData {
  window: string;
  total_cost: number;
  total_tokens: number;
  task_count: number;
  by_model: Record<string, number>;
  by_tool: Record<string, number>;
  by_agent: Record<string, number>;
  cost_over_time: { timestamp: string; cost: number; count: number }[];
}

interface Props {
  namespace: string;
  window?: string;
}

const WINDOWS = ['1h', '6h', '24h', '7d'] as const;

export function CostBreakdown({ namespace, window: externalWindow }: Props) {
  const [win, setWin] = useState(externalWindow || '24h');
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(false);

  const activeWindow = externalWindow || win;

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/analytics/cost?window=${activeWindow}`, {
        headers: { 'X-Tenant-Id': namespace },
      });
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeWindow, namespace]);

  useEffect(() => { fetch_(); }, [fetch_]);

  if (!data && !loading) {
    return (
      <div className="text-center py-8 text-slate-500 text-xs">
        No cost data available.
      </div>
    );
  }

  const modelEntries = Object.entries(data?.by_model || {}).slice(0, 6);
  const toolEntries = Object.entries(data?.by_tool || {}).slice(0, 8);
  const agentEntries = Object.entries(data?.by_agent || {}).slice(0, 6);
  const costTimeline = data?.cost_over_time || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Cost Breakdown</h3>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
        </div>
        <div className="flex items-center bg-white/[0.03] rounded-md p-0.5">
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
                activeWindow === w ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard label="Total Cost" value={`$${data.total_cost.toFixed(4)}`} color="#10b981" />
          <SummaryCard label="Total Tokens" value={data.total_tokens.toLocaleString()} color="#06b6d4" />
          <SummaryCard label="Tasks" value={String(data.task_count)} color="#8b5cf6" />
        </div>
      )}

      {/* Cost over time */}
      {costTimeline.length > 1 && (
        <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3">
          <h4 className="text-[10px] font-medium text-slate-400 mb-2">Cost Over Time</h4>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={costTimeline} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="cost" stroke="#10b981" fill="url(#costGradient)" strokeWidth={1.5} />
              <Tooltip
                contentStyle={{
                  background: '#14142a', border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '6px', fontSize: '10px', color: '#fff',
                }}
                formatter={(value: unknown) => [`$${Number(value).toFixed(6)}`, 'Cost']}
                labelFormatter={(label: unknown) => new Date(String(label)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Breakdown sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* By Model */}
        {modelEntries.length > 0 && (
          <BreakdownSection
            title="By Model"
            icon={<Cpu className="w-3 h-3 text-blue-400" />}
            entries={modelEntries}
            color="#3b82f6"
            format="cost"
          />
        )}

        {/* By Agent */}
        {agentEntries.length > 0 && (
          <BreakdownSection
            title="By Agent"
            icon={<Users className="w-3 h-3 text-violet-400" />}
            entries={agentEntries}
            color="#8b5cf6"
            format="cost"
          />
        )}
      </div>

      {/* By Tool (horizontal bar chart) */}
      {toolEntries.length > 0 && (
        <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Wrench className="w-3 h-3 text-amber-400" />
            <h4 className="text-[10px] font-medium text-slate-400">Tool Invocations</h4>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(80, toolEntries.length * 22)}>
            <BarChart
              data={toolEntries.map(([name, count]) => ({ name: name.replace('tool.', ''), count }))}
              layout="vertical"
              margin={{ top: 0, right: 0, bottom: 0, left: 80 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#94a3b8', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                contentStyle={{
                  background: '#14142a', border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: '6px', fontSize: '10px', color: '#fff',
                }}
                formatter={(value: unknown) => [`${value} calls`, 'Invocations']}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {toolEntries.map((_, i) => (
                  <Cell key={i} fill={`rgba(245, 158, 11, ${0.3 + (i / toolEntries.length) * 0.5})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-2.5 text-center">
      <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function BreakdownSection({ title, icon, entries, color, format }: {
  title: string;
  icon: React.ReactNode;
  entries: [string, number][];
  color: string;
  format: 'cost' | 'count';
}) {
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h4 className="text-[10px] font-medium text-slate-400">{title}</h4>
      </div>
      <div className="space-y-1.5">
        {entries.map(([name, value]) => (
          <div key={name} className="flex items-center gap-2">
            <span className="text-[9px] text-slate-400 truncate w-20" title={name}>
              {name.length > 12 ? name.slice(0, 12) + '...' : name}
            </span>
            <div className="flex-1 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(value / maxVal) * 100}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-[9px] text-slate-400 font-mono w-14 text-right">
              {format === 'cost' ? `$${value.toFixed(4)}` : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
