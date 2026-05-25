"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield, RefreshCw, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Plus, Upload, Network,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BASE_URL } from "@/types";
import { useTenant, tenantHeaders } from "@/context/tenant";

interface Gap {
  severity: "high" | "medium" | "low";
  message: string;
  details?: string[];
  suggestion?: string;
  action?: "add_facts" | "upload_docs" | "rebuild_graph";
  affected_entities?: string[];
}

interface GapReport {
  score: number;
  gaps: Gap[];
}

interface GapDetectorProps {
  onNavigateToNode?: (nodeId: string) => void;
}

function severityConfig(s: string) {
  switch (s) {
    case "high":
      return { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", dot: "bg-red-500" };
    case "medium":
      return { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", dot: "bg-amber-500" };
    default:
      return { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-500" };
  }
}

function scoreColor(score: number): string {
  if (score >= 0.8) return "text-emerald-400";
  if (score >= 0.5) return "text-amber-400";
  return "text-red-400";
}

function scoreBarColor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

const ACTION_CONFIG: Record<string, { icon: any; label: string }> = {
  add_facts: { icon: Plus, label: "Add Facts" },
  upload_docs: { icon: Upload, label: "Upload Docs" },
  rebuild_graph: { icon: Network, label: "Rebuild Graph" },
};

export function GapDetector({ onNavigateToNode }: GapDetectorProps) {
  const { tenant } = useTenant();
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<GapReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/rag/gaps`, {
        headers: tenantHeaders(tenant),
      });
      if (!res.ok) throw new Error("Failed to analyze gaps");
      const data = await res.json();
      setReport({
        score: data.score ?? data.health_score ?? 0.5,
        gaps: data.gaps || [],
      });
    } catch (err: any) {
      setError(err.message || "Failed to fetch gap analysis");
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchGaps();
  }, [fetchGaps]);

  const overallScore = report?.score ?? 0;
  const gapCount = report?.gaps?.length ?? 0;

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <Shield className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-200 flex-1 text-left">Brain Health</span>

        {report && !loading && (
          <span className={`text-[10px] font-bold ${scoreColor(overallScore)}`}>
            {Math.round(overallScore * 100)}%
          </span>
        )}

        {loading && <Loader2 className="h-3 w-3 text-slate-500 animate-spin" />}

        <button
          onClick={(e) => {
            e.stopPropagation();
            fetchGaps();
          }}
          className="p-0.5 text-slate-600 hover:text-slate-300 transition-colors"
          title="Re-analyze"
        >
          <RefreshCw className="h-2.5 w-2.5" />
        </button>

        {collapsed ? (
          <ChevronDown className="h-3 w-3 text-slate-600" />
        ) : (
          <ChevronUp className="h-3 w-3 text-slate-600" />
        )}
      </button>

      {/* Score bar */}
      {report && (
        <div className="h-0.5 bg-white/[0.04]">
          <div
            className={`h-full ${scoreBarColor(overallScore)} transition-all duration-700`}
            style={{ width: `${overallScore * 100}%` }}
          />
        </div>
      )}

      {/* Body */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 py-2.5 space-y-2 max-h-[320px] overflow-y-auto">
              {/* Error */}
              {error && (
                <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                  {error}
                </p>
              )}

              {/* Loading */}
              {loading && !report && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
                </div>
              )}

              {/* Healthy */}
              {report && gapCount === 0 && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">Brain is healthy</span>
                </div>
              )}

              {/* Gaps */}
              {report?.gaps?.map((gap, i) => {
                const sev = severityConfig(gap.severity);
                const actionCfg = gap.action ? ACTION_CONFIG[gap.action] : null;

                return (
                  <div
                    key={i}
                    className={`rounded-xl border ${sev.border} ${sev.bg} px-3 py-2.5 space-y-1.5`}
                  >
                    {/* Severity + message */}
                    <div className="flex items-start gap-2">
                      <div className={`h-2 w-2 rounded-full ${sev.dot} mt-1 shrink-0`} />
                      <p className={`text-[10px] font-medium ${sev.color} leading-relaxed flex-1`}>
                        {gap.message}
                      </p>
                    </div>

                    {/* Affected entities */}
                    {gap.affected_entities && gap.affected_entities.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-4">
                        {gap.affected_entities.map((entity) => (
                          <button
                            key={entity}
                            onClick={() => onNavigateToNode?.(entity)}
                            className="text-[8px] text-slate-400 bg-white/[0.04] hover:bg-violet-500/10 hover:text-violet-300 px-1.5 py-0.5 rounded-md transition-all cursor-pointer"
                          >
                            {entity}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Details */}
                    {gap.details && gap.details.length > 0 && (
                      <ul className="pl-4 space-y-0.5">
                        {gap.details.map((d, j) => (
                          <li key={j} className="text-[9px] text-slate-500 leading-relaxed">
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Suggestion */}
                    {gap.suggestion && (
                      <p className="text-[9px] text-slate-500 italic pl-4">
                        {gap.suggestion}
                      </p>
                    )}

                    {/* Action */}
                    {actionCfg && (
                      <div className="pl-4">
                        <button
                          className={`flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded-lg border ${sev.border} ${sev.color} hover:bg-white/[0.04] transition-all`}
                        >
                          <actionCfg.icon className="h-2.5 w-2.5" />
                          {actionCfg.label}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
