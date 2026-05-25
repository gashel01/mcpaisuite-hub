"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Clock, Cpu, Wrench, Users, Database, Link2, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

// ── Types ──────────────────────────────────────────────────────────────────

interface Span {
  id: string;
  parent_id: string | null;
  trace_id: string;
  name: string;
  type: "llm" | "tool" | "agent" | "retrieval" | "chain";
  start_time: number;
  end_time: number | null;
  duration_ms: number | null;
  status: "running" | "ok" | "error";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  error: string;
  children: Span[];
}

interface Props {
  taskId: string;
  namespace: string;
}

// ── Color config per span type ─────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; icon: typeof Cpu }> = {
  llm:       { bg: "bg-blue-500/10",    border: "border-blue-500/30",    text: "text-blue-300",    icon: Cpu },
  tool:      { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-300",   icon: Wrench },
  agent:     { bg: "bg-violet-500/10",  border: "border-violet-500/30",  text: "text-violet-300",  icon: Users },
  retrieval: { bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    text: "text-cyan-300",    icon: Database },
  chain:     { bg: "bg-slate-500/10",   border: "border-slate-500/30",   text: "text-slate-300",   icon: Link2 },
};

// ── Main component ─────────────────────────────────────────────────────────

export default function TraceWaterfall({ taskId, namespace }: Props) {
  const [spans, setSpans] = useState<Span[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);

  const fetchSpans = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/tasks/${taskId}/spans`, {
        headers: { "x-tenant-id": namespace },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setSpans(data.spans || []);
      // Auto-expand root spans
      const rootIds = new Set<string>((data.spans || []).map((s: Span) => s.id));
      setExpandedSpans(rootIds);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load spans");
    }
    setLoading(false);
  }, [taskId, namespace]);

  useEffect(() => { fetchSpans(); }, [fetchSpans]);

  const toggleExpand = (id: string) => {
    setExpandedSpans(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Calculate timeline range for bar widths
  const allFlat = flattenSpans(spans);
  const minTime = allFlat.length > 0 ? Math.min(...allFlat.map(s => s.start_time)) : 0;
  const maxTime = allFlat.length > 0 ? Math.max(...allFlat.map(s => (s.end_time ?? s.start_time))) : 1;
  const totalRange = maxTime - minTime || 1;

  if (!taskId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        Select a task to view its trace spans
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-medium text-slate-300">Trace Waterfall</span>
          <span className="text-[11px] text-slate-500">{allFlat.length} spans</span>
        </div>
        <button
          onClick={fetchSpans}
          className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <motion.div whileHover={{ rotate: 180 }} transition={{ duration: 0.3 }}>
            <Loader2 className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </motion.div>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 text-[9px] text-red-400 bg-red-500/5 border-b border-red-500/10">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && spans.length === 0 && (
        <div className="flex items-center justify-center py-8 text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}

      {/* No spans */}
      {!loading && spans.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-xs gap-1">
          <Clock className="w-6 h-6 text-slate-600" />
          <span>No spans recorded yet</span>
          <span className="text-[11px] text-slate-600">Spans appear after task execution</span>
        </div>
      )}

      {/* Span tree */}
      <div className="flex-1 overflow-y-auto">
        {spans.map(span => (
          <SpanRow
            key={span.id}
            span={span}
            depth={0}
            minTime={minTime}
            totalRange={totalRange}
            expanded={expandedSpans}
            onToggle={toggleExpand}
            onSelect={setSelectedSpan}
            selected={selectedSpan?.id || ""}
          />
        ))}
      </div>

      {/* Selected span detail */}
      <AnimatePresence>
        {selectedSpan && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/[0.06] overflow-hidden"
          >
            <SpanDetail span={selectedSpan} onClose={() => setSelectedSpan(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Span Row (recursive) ───────────────────────────────────────────────────

function SpanRow({
  span, depth, minTime, totalRange, expanded, onToggle, onSelect, selected,
}: {
  span: Span; depth: number; minTime: number; totalRange: number;
  expanded: Set<string>; onToggle: (id: string) => void;
  onSelect: (s: Span) => void; selected: string;
}) {
  const colors = TYPE_COLORS[span.type] || TYPE_COLORS.chain;
  const Icon = colors.icon;
  const hasChildren = span.children && span.children.length > 0;
  const isExpanded = expanded.has(span.id);
  const isSelected = selected === span.id;

  // Bar positioning
  const leftPct = ((span.start_time - minTime) / totalRange) * 100;
  const widthPct = span.duration_ms != null
    ? Math.max(1, (span.duration_ms / 1000 / totalRange) * 100)
    : 2;

  const durationText = span.duration_ms != null
    ? span.duration_ms < 1000
      ? `${Math.round(span.duration_ms)}ms`
      : `${(span.duration_ms / 1000).toFixed(1)}s`
    : "running";

  return (
    <>
      <div
        className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors hover:bg-white/[0.02] ${
          isSelected ? "bg-violet-500/5 border-l-2 border-violet-500/40" : "border-l-2 border-transparent"
        }`}
        style={{ paddingLeft: `${10 + depth * 18}px` }}
        onClick={() => onSelect(span)}
      >
        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(span.id); }}
          className={`w-4 h-4 flex items-center justify-center ${hasChildren ? "text-slate-400" : "text-transparent"}`}
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
        </button>

        {/* Type icon */}
        <div className={`w-5 h-5 rounded flex items-center justify-center ${colors.bg}`}>
          <Icon className={`w-3 h-3 ${colors.text}`} />
        </div>

        {/* Name */}
        <span className={`text-xs font-medium truncate flex-1 min-w-0 ${colors.text}`}>
          {span.name}
        </span>

        {/* Status icon */}
        {span.status === "ok" && <CheckCircle2 className="w-3 h-3 text-emerald-400/60 shrink-0" />}
        {span.status === "error" && <AlertCircle className="w-3 h-3 text-red-400/60 shrink-0" />}
        {span.status === "running" && <Loader2 className="w-3 h-3 text-blue-400/60 animate-spin shrink-0" />}

        {/* Duration */}
        <span className="text-[11px] text-slate-400 font-mono shrink-0 w-14 text-right">
          {durationText}
        </span>
      </div>

      {/* Waterfall bar (below the row) */}
      <div className="h-1.5 mx-2 relative" style={{ marginLeft: `${28 + depth * 18}px` }}>
        <div
          className={`absolute top-0 h-full rounded-full ${
            span.status === "error" ? "bg-red-500/40" : span.status === "running" ? "bg-blue-500/30 animate-pulse" : "bg-gradient-to-r from-violet-500/30 to-blue-500/20"
          }`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: "4px" }}
        />
      </div>

      {/* Children */}
      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {span.children.map(child => (
              <SpanRow
                key={child.id}
                span={child}
                depth={depth + 1}
                minTime={minTime}
                totalRange={totalRange}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                selected={selected}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Span Detail Panel ──────────────────────────────────────────────────────

function SpanDetail({ span, onClose }: { span: Span; onClose: () => void }) {
  const colors = TYPE_COLORS[span.type] || TYPE_COLORS.chain;

  return (
    <div className="p-3 max-h-56 overflow-y-auto">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className={`px-2 py-0.5 rounded text-[11px] font-medium ${colors.bg} ${colors.text} ${colors.border} border`}>
            {span.type}
          </div>
          <span className="text-xs text-slate-300 font-medium">{span.name}</span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-[11px]">
          close
        </button>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] mb-2.5">
        {span.duration_ms != null && (
          <div><span className="text-slate-500">Duration:</span> <span className="text-slate-300 font-mono">{span.duration_ms.toFixed(1)}ms</span></div>
        )}
        {"model" in span.metadata && (
          <div><span className="text-slate-500">Model:</span> <span className="text-slate-300">{String(span.metadata.model)}</span></div>
        )}
        {"tool" in span.metadata && (
          <div><span className="text-slate-500">Tool:</span> <span className="text-slate-300">{String(span.metadata.tool)}</span></div>
        )}
        {"agent" in span.metadata && (
          <div><span className="text-slate-500">Agent:</span> <span className="text-slate-300">{String(span.metadata.agent)}</span></div>
        )}
        {span.status === "error" && span.error && (
          <div className="col-span-2"><span className="text-red-400">Error:</span> <span className="text-red-300">{span.error}</span></div>
        )}
      </div>

      {/* Input/Output */}
      {Object.keys(span.input).length > 0 && (
        <div className="mb-2">
          <div className="text-[11px] text-slate-500 mb-0.5">Input</div>
          <pre className="text-[11px] text-slate-400 bg-white/[0.02] rounded p-2 overflow-x-auto max-h-20 overflow-y-auto font-mono">
            {JSON.stringify(span.input, null, 1)}
          </pre>
        </div>
      )}
      {Object.keys(span.output).length > 0 && (
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Output</div>
          <pre className="text-[11px] text-slate-400 bg-white/[0.02] rounded p-2 overflow-x-auto max-h-20 overflow-y-auto font-mono">
            {JSON.stringify(span.output, null, 1)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Helper ─────────────────────────────────────────────────────────────────

function flattenSpans(spans: Span[]): Span[] {
  const result: Span[] = [];
  function walk(list: Span[]) {
    for (const s of list) {
      result.push(s);
      if (s.children) walk(s.children);
    }
  }
  walk(spans);
  return result;
}
