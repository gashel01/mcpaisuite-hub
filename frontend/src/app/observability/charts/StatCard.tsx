'use client';
import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number;
  sparkline?: number[];
  icon?: React.ReactNode;
  color?: string;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 28;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  const pathD = `M${points.join(' L')}`;

  return (
    <svg width={w} height={h} className="flex-shrink-0">
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({ label, value, unit, trend, sparkline, icon, color = '#8b5cf6' }: StatCardProps) {
  return (
    <div className="bg-[#0f0f1c] border border-white/[0.07] rounded-xl p-5 hover:border-purple-500/30 hover:shadow-[0_0_15px_rgba(139,92,246,0.1)] transition-all duration-300 flex flex-col gap-3 min-w-0">
      {/* Top: icon + label */}
      <div className="flex items-center gap-2">
        {icon && <span className="text-[#8b8ba8]">{icon}</span>}
        <span className="text-[#8b8ba8] text-xs font-medium uppercase tracking-wide truncate">{label}</span>
      </div>

      {/* Middle: value */}
      <div className="flex items-baseline gap-1">
        <span className="text-white font-bold text-2xl transition-opacity duration-300">{value}</span>
        {unit && <span className="text-[#8b8ba8] text-sm">{unit}</span>}
      </div>

      {/* Bottom: trend + sparkline */}
      <div className="flex items-end justify-between">
        <div>
          {trend != null && trend !== 0 && (
            <div className="flex items-center gap-1">
              <span className={`text-xs font-medium ${trend > 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
                {trend > 0 ? '↑' : '↓'}{Math.abs(trend).toFixed(1)}%
              </span>
              <span className="text-[#8b8ba8] text-[10px]">vs previous period</span>
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} color={color} />
        )}
      </div>
    </div>
  );
}
