"use client";

import { useState, useEffect } from "react";

interface NextRunCountdownProps {
  nextRun: string | null;
  compact?: boolean;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total_ms: number;
}

function computeRemaining(nextRun: string): TimeRemaining {
  const diff = new Date(nextRun).getTime() - Date.now();
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total_ms: diff };
  }
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / 60000) % 60;
  const hours = Math.floor(diff / 3600000) % 24;
  const days = Math.floor(diff / 86400000);
  return { days, hours, minutes, seconds, total_ms: diff };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Plain text digit — no per-digit framer-motion popLayout/spring (those forced a layout
// measurement every second, per countdown, which was a major perf cost on the scheduler page).
function DigitBox({ value, color, compact }: { value: string; color: string; compact?: boolean }) {
  return (
    <span
      className={`inline-block bg-white/[0.03] font-mono ${color} ${
        compact ? "rounded px-1.5 py-0.5 font-medium text-xs" : "rounded-md px-2 py-1 font-bold text-sm"
      }`}
    >
      {value}
    </span>
  );
}

export default function NextRunCountdown({ nextRun, compact = false }: NextRunCountdownProps) {
  const [remaining, setRemaining] = useState<TimeRemaining | null>(
    nextRun ? computeRemaining(nextRun) : null
  );

  useEffect(() => {
    if (!nextRun) {
      setRemaining(null);
      return;
    }

    setRemaining(computeRemaining(nextRun));
    const interval = setInterval(() => {
      setRemaining(computeRemaining(nextRun));
    }, 1000);

    return () => clearInterval(interval);
  }, [nextRun]);

  if (!nextRun || !remaining) {
    return (
      <div className={`flex items-center gap-2 ${compact ? "" : "flex-col"}`}>
        <span className="text-slate-600 text-sm font-mono">&mdash;</span>
        {!compact && (
          <span className="text-[10px] text-slate-600">No upcoming run</span>
        )}
      </div>
    );
  }

  // Overdue state
  if (remaining.total_ms < 0) {
    return (
      <div className="flex items-center gap-1">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/20 animate-pulse">
          OVERDUE
        </span>
      </div>
    );
  }

  // Determine color based on remaining time
  const totalSeconds = remaining.total_ms / 1000;
  const color =
    totalSeconds < 10
      ? "text-red-400"
      : totalSeconds < 60
        ? "text-amber-400"
        : "text-slate-200";

  const separator = <span className={`${color} font-mono text-xs opacity-50`}>:</span>;

  return (
    <div className={`flex ${compact ? "items-center gap-1" : "flex-col items-center gap-2"}`}>
      <div className="flex items-center gap-0.5">
        {remaining.days > 0 && (
          <>
            <DigitBox value={pad(remaining.days)} color={color} compact={compact} />
            {separator}
          </>
        )}
        <DigitBox value={pad(remaining.hours)} color={color} compact={compact} />
        {separator}
        <DigitBox value={pad(remaining.minutes)} color={color} compact={compact} />
        {separator}
        <span className={totalSeconds < 10 ? "animate-pulse" : ""}>
          <DigitBox value={pad(remaining.seconds)} color={color} compact={compact} />
        </span>
      </div>
      {!compact && (
        <span className="text-[10px] text-slate-500">until next execution</span>
      )}
    </div>
  );
}
