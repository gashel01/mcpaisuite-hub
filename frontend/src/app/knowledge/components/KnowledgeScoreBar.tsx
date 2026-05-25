"use client";

import { useMemo } from "react";
import { Gauge, BarChart3, Clock, Lightbulb, TrendingUp } from "lucide-react";
import type { MemoryStats } from "../types";

interface Props {
  stats: MemoryStats | null;
  factCount: number;
  sourceCount: number;
  entityCount: number;
  insights: string[];
}

export function KnowledgeScoreBar({ stats, factCount, sourceCount, entityCount, insights }: Props) {
  const healthScore = useMemo(() => {
    let score = 0;
    if (factCount > 0) score += Math.min(30, factCount * 3);
    if (sourceCount > 0) score += Math.min(25, sourceCount * 5);
    if (entityCount > 0) score += Math.min(25, entityCount * 2);
    if (stats?.avg_decay && stats.avg_decay > 0.5) score += 10;
    const connectedness = entityCount > 0 ? Math.min(10, (entityCount / Math.max(factCount, 1)) * 10) : 0;
    score += connectedness;
    return Math.min(100, Math.round(score));
  }, [factCount, sourceCount, entityCount, stats]);

  const scoreColor = healthScore >= 70 ? "text-emerald-400" : healthScore >= 40 ? "text-amber-400" : "text-red-400";
  const scoreBg = healthScore >= 70 ? "from-emerald-500/20" : healthScore >= 40 ? "from-amber-500/20" : "from-red-500/20";
  const scoreRing = healthScore >= 70 ? "border-emerald-500/30" : healthScore >= 40 ? "border-amber-500/30" : "border-red-500/30";

  if (factCount === 0 && sourceCount === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Score */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r ${scoreBg} to-transparent backdrop-blur-md rounded-xl border ${scoreRing}`}>
        <Gauge className={`h-3 w-3 ${scoreColor}`} />
        <span className={`text-[11px] font-bold ${scoreColor}`}>{healthScore}</span>
        <span className="text-[8px] text-slate-600">/100</span>
      </div>

      {/* Coverage */}
      {stats?.top_tags && stats.top_tags.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-black/40 backdrop-blur-md rounded-xl border border-white/[0.06]" title={stats.top_tags.map(([t, c]) => `${t}: ${c}`).join(", ")}>
          <BarChart3 className="h-2.5 w-2.5 text-slate-500" />
          <div className="flex items-end gap-px h-3">
            {stats.top_tags.slice(0, 5).map(([tag, count], i) => (
              <div key={tag} className="w-1 rounded-full bg-violet-400/60 transition-all" style={{ height: `${Math.max(3, Math.min(12, count * 2))}px` }} title={`${tag}: ${count}`} />
            ))}
          </div>
        </div>
      )}

      {/* Freshness */}
      {stats?.avg_decay != null && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-black/40 backdrop-blur-md rounded-xl border border-white/[0.06]">
          <Clock className={`h-2.5 w-2.5 ${stats.avg_decay > 0.7 ? "text-emerald-400/70" : stats.avg_decay > 0.4 ? "text-cyan-400/70" : "text-amber-400/70"}`} />
          <span className={`text-[9px] ${stats.avg_decay > 0.7 ? "text-emerald-300/80" : stats.avg_decay > 0.4 ? "text-cyan-300/80" : "text-amber-300/80"}`}>
            {Math.round(stats.avg_decay * 100)}% fresh
          </span>
        </div>
      )}

      {/* First insight */}
      {insights.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-black/40 backdrop-blur-md rounded-xl border border-white/[0.06]">
          <Lightbulb className="h-2.5 w-2.5 text-amber-400/70" />
          <span className="text-[9px] text-amber-300/80 max-w-[140px] truncate">{insights[0]}</span>
        </div>
      )}
    </div>
  );
}
