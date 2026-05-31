"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Sparkles, RefreshCw, ArrowRight, CheckCircle2, XCircle, Clock, Coins,
} from "lucide-react";


// ── Types ───────────────────────────────────────────────────────────────────

interface Analytics {
  tasks_completed: number;
  tasks_failed: number;
  total_tokens: number;
  total_cost: number;
  avg_tokens_per_task: number;
  avg_duration_ms: number;
  top_tools: { name: string; count: number }[];
  top_models: { name: string; count: number }[];
}

interface Suggestion {
  type: string;
  content: string;
  rationale: string;
  confidence: number;
}

interface Analysis {
  total_runs: number;
  failed_runs: number;
  slow_runs: number;
  expensive_runs: number;
  suggestions: Suggestion[];
}

interface ApplyResult {
  applied: number;
  details: string[];
}

interface ImprovePanelProps {
  analytics: Analytics | null;
  onAnalyze?: () => void;
  onApply?: () => void;
  tenantHeaders?: Record<string, string>;
}

const TYPE_COLORS: Record<string, string> = {
  constitution: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  template: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  tool_config: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

// ── Sub-components ──────────────────────────────────────────────────────────

function MiniStat({ icon: Icon, color, label, value }: {
  icon: React.ComponentType<{ className?: string }>; color: string; label: string; value: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`h-3 w-3 ${color}`} />
        <span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ImprovePanel({ analytics, onAnalyze, onApply, tenantHeaders }: ImprovePanelProps) {
  const BASE = getApiUrl();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setApplyResult(null);
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tenantHeaders ?? {}) },
        body: JSON.stringify({ tool: "improve", args: { dry_run: true } }),
      });
      const data = await res.json();
      setAnalysis(data);
      // Pre-select all suggestions
      if (data.suggestions?.length) {
        setSelectedSuggestions(new Set(data.suggestions.map((_: Suggestion, i: number) => i)));
      }
      onAnalyze?.();
    } catch {
      // silent
    } finally {
      setAnalyzing(false);
    }
  };

  const runApply = async () => {
    if (!analysis || selectedSuggestions.size === 0) return;
    setApplying(true);
    try {
      const res = await fetch(`${BASE}/api/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tenantHeaders ?? {}) },
        body: JSON.stringify({ tool: "improve", args: { dry_run: false } }),
      });
      const data = await res.json();
      setApplyResult(data);
      onApply?.();
    } catch {
      // silent
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto space-y-4 min-h-0 pb-4">
      {/* Analyze button */}
      <div className="flex items-center gap-2">
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {analyzing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {analyzing ? "Analyzing..." : "Analyze Performance"}
        </button>
        {analysis && analysis.suggestions?.length > 0 && (
          <button
            onClick={runApply}
            disabled={applying || selectedSuggestions.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
          >
            {applying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            Apply {selectedSuggestions.size} selected
          </button>
        )}
      </div>

      {!analysis && !analyzing && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-8 text-center"
        >
          <Sparkles className="h-8 w-8 text-slate-700 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-300 mb-1">AI-Powered Optimization</h3>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
            Run analysis to get AI-powered suggestions. The meta-agent identifies patterns across failures,
            slow runs, and expensive tasks to suggest targeted improvements.
          </p>
        </motion.div>
      )}

      {analysis && (
        <>
          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <MiniStat icon={CheckCircle2} color="text-emerald-400" label="Total Runs" value={analysis.total_runs} />
            <MiniStat icon={XCircle} color="text-red-400" label="Failed" value={analysis.failed_runs} />
            <MiniStat icon={Clock} color="text-amber-400" label="Slow" value={analysis.slow_runs} />
            <MiniStat icon={Coins} color="text-cyan-400" label="Expensive" value={analysis.expensive_runs} />
          </motion.div>

          {/* Suggestions */}
          {analysis.suggestions?.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300">
                Suggestions ({analysis.suggestions.length})
              </h3>
              {analysis.suggestions.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.04 }}
                  className={`rounded-xl border p-4 transition-all ${
                    selectedSuggestions.has(i)
                      ? "bg-white/[0.02] border-violet-500/20"
                      : "bg-white/[0.01] border-white/[0.04] opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(i)}
                      onChange={() => {
                        setSelectedSuggestions((prev) => {
                          const next = new Set(prev);
                          next.has(i) ? next.delete(i) : next.add(i);
                          return next;
                        });
                      }}
                      className="accent-violet-500 shrink-0"
                    />
                    <span className={`text-[9px] font-semibold uppercase px-2 py-0.5 rounded border ${TYPE_COLORS[s.type] || "bg-white/[0.03] text-slate-400 border-white/[0.06]"}`}>
                      {s.type}
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[10px] text-slate-500">{Math.round(s.confidence * 100)}%</span>
                      <div className="w-14 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.confidence >= 0.7 ? "bg-emerald-500" : s.confidence >= 0.4 ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${s.confidence * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-200 mb-1">{s.content}</p>
                  <p className="text-[10px] text-slate-500">{s.rationale}</p>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">No suggestions at this time. Your agent is performing well.</p>
          )}
        </>
      )}

      {/* Apply result */}
      {applyResult && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"
        >
          <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Applied {applyResult.applied} improvement{applyResult.applied !== 1 ? "s" : ""}
          </h3>
          {applyResult.details?.map((d, i) => (
            <p key={i} className="text-[11px] text-slate-300 ml-5">- {d}</p>
          ))}
          <div className="flex gap-2 mt-3 ml-5">
            <Link
              href="/settings"
              className="text-[11px] text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-3 py-1.5 rounded-lg transition-all"
            >
              View Settings &rarr;
            </Link>
            <Link
              href="/chat"
              className="text-[11px] text-slate-400 hover:text-slate-300 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-lg transition-all"
            >
              Test in Chat &rarr;
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  );
}
