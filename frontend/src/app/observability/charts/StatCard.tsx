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
  // When true, a rising trend is "bad" (e.g. cost, latency): up arrow shows red,
  // down arrow green. Defaults to false (rising = good = green).
  lowerIsBetter?: boolean;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  // Stretch to the card width via a viewBox; vector-effect keeps the stroke crisp.
  const w = 100;
  const h = 28;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 3) - 1.5; // pad so the line never clips top/bottom
    return [x, y] as const;
  });
  const lineD = `M${pts.map(p => `${p[0]},${p[1]}`).join(' L')}`;
  const areaD = `${lineD} L${w},${h} L0,${h} Z`;
  const gid = `spark-${color.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-7">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gid})`} stroke="none" />
      <path d={lineD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatCard({ label, value, unit, trend, sparkline, icon, color = '#8b5cf6', lowerIsBetter = false }: StatCardProps) {
  // A rising trend is "good" unless lowerIsBetter (cost/latency), where it's "bad".
  const isGood = trend != null && (lowerIsBetter ? trend < 0 : trend > 0);
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

      {/* Trend (vs previous) — its own row */}
      {trend != null && trend !== 0 ? (
        <div className="flex items-center gap-1">
          <span className={`text-[11px] sm:text-xs font-medium ${isGood ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
            {trend > 0 ? '↑' : '↓'}{Math.abs(trend).toFixed(1)}%
          </span>
          <span className="text-[#8b8ba8] text-[9px] sm:text-[10px]">vs previous</span>
        </div>
      ) : (
        // No comparison available (e.g. nothing in the previous period yet) — neutral placeholder.
        <div className="flex items-center gap-1">
          <span className="text-[#8b8ba8]/70 text-[11px] sm:text-xs font-medium">—</span>
          <span className="text-[#8b8ba8]/70 text-[9px] sm:text-[10px]">vs previous</span>
        </div>
      )}

      {/* Sparkline — full width below the stats so it fits the card cleanly */}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-auto pt-1">
          <Sparkline data={sparkline} color={color} />
        </div>
      )}
    </div>
  );
}
