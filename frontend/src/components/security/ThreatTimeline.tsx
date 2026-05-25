"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, ShieldAlert, CheckCircle, Eye } from "lucide-react";
import type { SecurityAuditEvent } from "./types";

interface Props {
  events: SecurityAuditEvent[];
}

export default function ThreatTimeline({ events }: Props) {
  // Build hourly histogram for last 24h
  const { hours, maxCount, totalBlocked, totalApproved, totalSecrets } = useMemo(() => {
    const now = Date.now() / 1000;
    const buckets: { hour: number; blocked: number; approved: number; secrets: number; total: number }[] = [];

    for (let h = 23; h >= 0; h--) {
      const start = now - (h + 1) * 3600;
      const end = now - h * 3600;
      const hourEvents = events.filter(e => e.ts >= start && e.ts < end);
      const blocked = hourEvents.filter(e => e.type.includes("block") || e.type.includes("denied") || e.type.includes("reject")).length;
      const secrets = hourEvents.filter(e => e.type.includes("secret") || e.type.includes("dlp")).length;
      const approved = hourEvents.filter(e => e.type.includes("approved") || e.type.includes("allow") || e.type.includes("granted")).length;
      buckets.push({ hour: 23 - h, blocked, approved, secrets, total: blocked + approved + secrets });
    }

    const max = Math.max(1, ...buckets.map(b => b.total));
    const tb = events.filter(e => e.type.includes("block") || e.type.includes("denied") || e.type.includes("reject")).length;
    const ta = events.filter(e => e.type.includes("approved") || e.type.includes("allow") || e.type.includes("granted")).length;
    const ts = events.filter(e => e.type.includes("secret") || e.type.includes("dlp")).length;

    return { hours: buckets, maxCount: max, totalBlocked: tb, totalApproved: ta, totalSecrets: ts };
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-300">Threat Activity</h3>
          <span className="text-[10px] text-slate-600">Last 24h</span>
        </div>
        <div className="flex items-center justify-center h-20">
          <p className="text-xs text-slate-600">No security events recorded yet — this is good.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-300">Threat Activity</h3>
        <span className="text-[10px] text-slate-600 ml-1">Last 24h</span>
        <div className="flex items-center gap-3 ml-auto">
          {totalBlocked > 0 && (
            <span className="flex items-center gap-1 text-[9px] text-red-400">
              <ShieldAlert className="h-2.5 w-2.5" />{totalBlocked} blocked
            </span>
          )}
          {totalApproved > 0 && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-400">
              <CheckCircle className="h-2.5 w-2.5" />{totalApproved} approved
            </span>
          )}
          {totalSecrets > 0 && (
            <span className="flex items-center gap-1 text-[9px] text-amber-400">
              <Eye className="h-2.5 w-2.5" />{totalSecrets} detected
            </span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="flex items-end gap-px h-16 mt-3">
        {hours.map((bucket, i) => {
          const height = (bucket.total / maxCount) * 100;
          const isSpike = bucket.total > maxCount * 0.7 && bucket.total > 2;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <motion.div
                className="w-full rounded-t-sm relative overflow-hidden"
                style={{ height: `${Math.max(2, height)}%` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: i * 0.02, duration: 0.3 }}
              >
                {/* Stacked bar */}
                {bucket.blocked > 0 && (
                  <div className="absolute bottom-0 left-0 right-0 bg-red-500/60" style={{ height: `${(bucket.blocked / bucket.total) * 100}%` }} />
                )}
                {bucket.secrets > 0 && (
                  <div className="absolute bg-amber-500/60" style={{ bottom: `${(bucket.blocked / bucket.total) * 100}%`, left: 0, right: 0, height: `${(bucket.secrets / bucket.total) * 100}%` }} />
                )}
                {bucket.approved > 0 && (
                  <div className="absolute top-0 left-0 right-0 bg-emerald-500/40" style={{ height: `${(bucket.approved / bucket.total) * 100}%` }} />
                )}
                {bucket.total === 0 && <div className="w-full h-full bg-white/[0.03]" />}
                {isSpike && <div className="absolute inset-0 bg-red-500/20 animate-pulse" />}
              </motion.div>

              {/* Tooltip on hover */}
              {bucket.total > 0 && (
                <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10">
                  <div className="bg-slate-900 border border-white/[0.1] rounded-lg px-2 py-1 text-[8px] text-slate-300 whitespace-nowrap shadow-xl">
                    {bucket.total} event{bucket.total > 1 ? "s" : ""}
                    {bucket.blocked > 0 && <span className="text-red-400 ml-1">{bucket.blocked}B</span>}
                    {bucket.secrets > 0 && <span className="text-amber-400 ml-1">{bucket.secrets}S</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-slate-700">24h ago</span>
        <span className="text-[8px] text-slate-700">12h ago</span>
        <span className="text-[8px] text-slate-700">Now</span>
      </div>
    </div>
  );
}
