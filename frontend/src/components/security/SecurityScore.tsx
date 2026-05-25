"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield, Lock, ShieldCheck, Eye, ScrollText, Box, Wifi,
  AlertTriangle, TrendingUp, TrendingDown, Minus, Zap,
} from "lucide-react";
import type { SecurityPosture, SecurityAuditEvent } from "./types";

interface Props {
  posture: SecurityPosture | null;
  events: SecurityAuditEvent[];
  loading: boolean;
  onLockDown?: () => void;
  onReviewPending?: () => void;
}

interface ScoreCategory {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  score: number;
  maxScore: number;
  color: string;
}

export default function SecurityScore({ posture, events, loading, onLockDown, onReviewPending }: Props) {
  const { totalScore, categories, trend, pendingActions } = useMemo(() => {
    if (!posture) return { totalScore: 0, categories: [], trend: "stable" as const, pendingActions: 0 };

    const cats: ScoreCategory[] = [
      {
        id: "network",
        label: "Network",
        icon: Wifi,
        score: !posture.egress.enabled ? 20 : Math.max(5, 20 - posture.egress.allowed_domains.length * 2),
        maxScore: 20,
        color: "text-blue-400",
      },
      {
        id: "host",
        label: "Host",
        icon: Lock,
        score: posture.host.auto_approve ? 0 : (20 - Math.min(10, posture.host.pending_count * 3)),
        maxScore: 20,
        color: "text-violet-400",
      },
      {
        id: "code",
        label: "Code",
        icon: ShieldCheck,
        score: (posture.validator.reject_dangerous ? 15 : 5) + (posture.validator.auto_fix ? 5 : 0),
        maxScore: 20,
        color: "text-emerald-400",
      },
      {
        id: "dlp",
        label: "DLP",
        icon: Eye,
        score: posture.dlp.enabled ? 20 : 5,
        maxScore: 20,
        color: "text-amber-400",
      },
      {
        id: "governance",
        label: "Governance",
        icon: ScrollText,
        score: posture.constitution.has_custom_rules ? 20 : 10,
        maxScore: 20,
        color: "text-purple-400",
      },
    ];

    const total = Math.min(100, cats.reduce((s, c) => s + c.score, 0));

    // Trend based on recent blocked events (more blocks = system is working but under pressure)
    const recentBlocked = events.filter(e => {
      const age = Date.now() / 1000 - e.ts;
      return age < 3600 && (e.type.includes("block") || e.type.includes("denied"));
    }).length;
    const olderBlocked = events.filter(e => {
      const age = Date.now() / 1000 - e.ts;
      return age >= 3600 && age < 7200 && (e.type.includes("block") || e.type.includes("denied"));
    }).length;
    const t = recentBlocked > olderBlocked + 2 ? "declining" : recentBlocked < olderBlocked ? "improving" : "stable";

    const pending = posture.host.pending_count + posture.egress.pending_count;

    return { totalScore: total, categories: cats, trend: t, pendingActions: pending };
  }, [posture, events]);

  const scoreColor = totalScore >= 80 ? "text-emerald-400" : totalScore >= 50 ? "text-amber-400" : "text-red-400";
  const ringColor = totalScore >= 80 ? "#34d399" : totalScore >= 50 ? "#fbbf24" : "#f87171";
  const ringBg = totalScore >= 80 ? "rgba(52,211,153,0.1)" : totalScore >= 50 ? "rgba(251,191,36,0.1)" : "rgba(248,113,113,0.1)";

  if (loading || !posture) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-6 animate-pulse">
        <div className="flex items-center gap-8">
          <div className="h-28 w-28 rounded-full bg-white/[0.04]" />
          <div className="flex-1 space-y-3">
            <div className="h-5 w-48 bg-white/[0.04] rounded" />
            <div className="h-3 w-64 bg-white/[0.03] rounded" />
            <div className="flex gap-4">{Array.from({length: 5}).map((_, i) => <div key={i} className="h-8 w-20 bg-white/[0.03] rounded" />)}</div>
          </div>
        </div>
      </div>
    );
  }

  // SVG ring parameters
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const progress = (totalScore / 100) * circumference;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.02] to-transparent p-5 md:p-6">
      <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
        {/* Score Ring */}
        <div className="relative shrink-0">
          <svg width="120" height="120" className="transform -rotate-90">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="8" />
            <motion.circle
              cx="60" cy="60" r={radius} fill="none"
              stroke={ringColor} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: circumference - progress }}
              transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              className={`text-2xl font-bold ${scoreColor}`}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, type: "spring" }}
            >
              {totalScore}
            </motion.span>
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Score</span>
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0 text-center md:text-left">
          <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
            <h2 className="text-lg font-bold text-slate-100">Security Posture</h2>
            {trend === "improving" && <TrendingUp className="h-4 w-4 text-emerald-400" />}
            {trend === "declining" && <TrendingDown className="h-4 w-4 text-red-400" />}
            {trend === "stable" && <Minus className="h-4 w-4 text-slate-500" />}
            <span className={`text-[10px] font-medium ${trend === "improving" ? "text-emerald-400" : trend === "declining" ? "text-red-400" : "text-slate-500"}`}>
              {trend === "improving" ? "Improving" : trend === "declining" ? "Under pressure" : "Stable"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            {totalScore >= 80 ? "Strong security posture. All systems nominal." :
             totalScore >= 50 ? "Moderate posture. Some areas need attention." :
             "Weak posture. Immediate action recommended."}
          </p>

          {/* Category breakdown */}
          <div className="flex flex-wrap gap-2 mb-4">
            {categories.map((cat, i) => {
              const Icon = cat.icon;
              const pct = Math.round((cat.score / cat.maxScore) * 100);
              return (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * i + 0.5 }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02]"
                >
                  <Icon className={`h-3 w-3 ${cat.color}`} />
                  <span className="text-[10px] text-slate-400">{cat.label}</span>
                  <div className="w-8 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: pct >= 70 ? "#34d399" : pct >= 40 ? "#fbbf24" : "#f87171" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ delay: 0.2 * i + 0.8, duration: 0.5 }}
                    />
                  </div>
                  <span className={`text-[9px] font-bold ${pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400"}`}>{cat.score}</span>
                </motion.div>
              );
            })}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            {pendingActions > 0 && onReviewPending && (
              <motion.button
                onClick={onReviewPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-all"
                animate={{ boxShadow: ["0 0 0 0 rgba(251,191,36,0)", "0 0 0 4px rgba(251,191,36,0.1)", "0 0 0 0 rgba(251,191,36,0)"] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <AlertTriangle className="h-3 w-3" />
                {pendingActions} pending review{pendingActions > 1 ? "s" : ""}
              </motion.button>
            )}
            {onLockDown && totalScore < 60 && (
              <button onClick={onLockDown} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-all">
                <Zap className="h-3 w-3" /> Emergency Lock Down
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
