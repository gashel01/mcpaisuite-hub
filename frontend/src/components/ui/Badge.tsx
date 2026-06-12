"use client";

import type { LucideIcon } from "lucide-react";

export type BadgeTone = "violet" | "sky" | "emerald" | "amber" | "red" | "slate";

// text / bg / border triples — the exact values used by the existing source & status pills.
const TONES: Record<BadgeTone, string> = {
  violet: "text-violet-300 bg-violet-500/10 border-violet-500/15",
  sky: "text-sky-300 bg-sky-500/10 border-sky-500/15",
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/15",
  amber: "text-amber-300 bg-amber-500/10 border-amber-500/15",
  red: "text-red-300 bg-red-500/10 border-red-500/15",
  slate: "text-slate-300 bg-white/[0.04] border-white/[0.08]",
};

/**
 * Small inline pill (source/status tags). `tone` applies the matching color triple;
 * pass `className` to override radius/size or for one-off colors.
 */
export function Badge({
  tone, icon: Icon, className = "", children,
}: {
  tone?: BadgeTone;
  icon?: LucideIcon;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${tone ? TONES[tone] : ""} ${className}`}>
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {children}
    </span>
  );
}
