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
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

export function StatCard({ label, value, unit, trend, sparkline, icon, color = '#8b5cf6' }: StatCardProps) {
  return (
    <div className="obs-card p-4 sm:p-5 flex flex-col gap-2.5 sm:gap-3 min-w-0">
      {/* Top: icon + label */}
      <div className="flex items-center gap-2">
        {icon && <span className="text-[#8b8ba8]">{icon}</span>}
        <span className="text-[#8b8ba8] text-[11px] sm:text-xs font-medium uppercase tracking-wide truncate">{label}</span>
      </div>

      {/* Middle: value */}
      <div className="flex items-baseline gap-1">
        <span className="text-white font-bold text-xl sm:text-2xl transition-opacity duration-300">{value}</span>
        {unit && <span className="text-[#8b8ba8] text-xs sm:text-sm">{unit}</span>}
      </div>

      {/* Bottom: trend + sparkline */}
      <div className="flex items-end justify-between">
        <div>
          {trend != null && trend !== 0 && (
            <div className="flex items-center gap-1">
              <span className={`text-[11px] sm:text-xs font-medium ${trend > 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
                {trend > 0 ? '↑' : '↓'}{Math.abs(trend).toFixed(1)}%
              </span>
              <span className="text-[#8b8ba8] text-[9px] sm:text-[10px]">vs previous</span>
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
