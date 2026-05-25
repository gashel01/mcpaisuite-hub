'use client';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';

interface MetricsChartProps {
  metric: 'latency' | 'cost' | 'tokens' | 'success_rate' | 'turns' | 'throughput';
  data: Array<{timestamp: string; value: number; count: number}>;
  window: string;
  loading?: boolean;
  height?: number;
}

function formatXAxis(timestamp: string, window: string): string {
  const date = new Date(timestamp);
  if (window === '1h' || window === '6h' || window === '24h') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (window === '7d') {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTooltipValue(value: number, metric: string): string {
  switch (metric) {
    case 'latency': return `${value} ms`;
    case 'cost': return `$${value.toFixed(3)}`;
    case 'tokens': return `${value} tokens`;
    case 'success_rate': return `${value}%`;
    case 'turns': return `${value}`;
    case 'throughput': return `${value}`;
    default: return `${value}`;
  }
}

const CustomTooltip = ({ active, payload, metric }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: '#14142a',
      border: '1px solid rgba(139,92,246,0.3)',
      borderRadius: '8px',
      padding: '8px 12px',
      color: '#fff',
      fontSize: '12px',
    }}>
      <p>{formatTooltipValue(payload[0].value, metric)}</p>
    </div>
  );
};

export function MetricsChart({ metric, data, window: timeWindow, loading, height = 200 }: MetricsChartProps) {
  if (loading) {
    return (
      <div style={{ height }} className="animate-pulse bg-white/[0.03] rounded-lg" />
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[#8b8ba8] text-sm">
        No data for this period
      </div>
    );
  }

  const formatted = data.map(d => ({
    ...d,
    label: formatXAxis(d.timestamp, timeWindow),
  }));

  const commonAxisProps = {
    tick: { fill: '#8b8ba8', fontSize: 11 },
    axisLine: false,
    tickLine: false,
  };

  const gridProps = {
    strokeDasharray: "3 3",
    stroke: "rgba(255,255,255,0.05)",
  };

  const renderChart = () => {
    switch (metric) {
      case 'latency':
        return (
          <AreaChart data={formatted}>
            <defs>
              <linearGradient id="gradLatency" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...commonAxisProps} />
            <YAxis {...commonAxisProps} unit=" ms" />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#8b5cf6"
              strokeWidth={2}
              fill="url(#gradLatency)"
              animationDuration={500}
            />
          </AreaChart>
        );

      case 'cost':
        return (
          <AreaChart data={formatted}>
            <defs>
              <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={(v) => `$${v}`} />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#gradCost)"
              animationDuration={500}
            />
          </AreaChart>
        );

      case 'tokens':
        return (
          <BarChart data={formatted}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...commonAxisProps} />
            <YAxis {...commonAxisProps} />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            <Bar dataKey="value" fill="#06b6d4" radius={[3, 3, 0, 0]} animationDuration={500} />
          </BarChart>
        );

      case 'success_rate':
        return (
          <LineChart data={formatted}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...commonAxisProps} />
            <YAxis {...commonAxisProps} domain={[0, 100]} unit="%" />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            <ReferenceLine y={80} stroke="#f43f5e" strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceLine y={95} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.5} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
          </LineChart>
        );

      case 'turns':
        return (
          <LineChart data={formatted}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...commonAxisProps} />
            <YAxis {...commonAxisProps} />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#ec4899"
              strokeWidth={2}
              dot={false}
              animationDuration={500}
            />
          </LineChart>
        );

      case 'throughput':
        return (
          <BarChart data={formatted}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...commonAxisProps} />
            <YAxis {...commonAxisProps} />
            <Tooltip content={<CustomTooltip metric={metric} />} />
            <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]} animationDuration={500} />
            <Bar dataKey="count" fill="#f43f5e" radius={[3, 3, 0, 0]} animationDuration={500} />
          </BarChart>
        );

      default:
        return null;
    }
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      {renderChart()!}
    </ResponsiveContainer>
  );
}
