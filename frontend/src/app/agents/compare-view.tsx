"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, X, ArrowLeftRight, Minus } from "lucide-react";
import { renderMarkdown } from "@/components/markdown";
import { AGENT_META } from "./constants";

export interface CompareItem {
  id: string;
  label: string; // "Workflow / v2 / Run #3"
  goal: string;
  agents: { type: string; role: string }[];
  pattern: string;
  status: string;
  answer: string | null;
  metrics: { tokens: number; cost: number; turns: number; duration: number } | null;
}

interface CompareViewProps {
  items: CompareItem[];
  onRemove: (id: string) => void;
  onClose: () => void;
}

function CompareColumn({ item }: { item: CompareItem }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-2">
          {item.status === "completed" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-red-400" />}
          <span className="text-[10px] font-semibold text-slate-200 truncate flex-1">{item.label}</span>
        </div>
        <div className="text-[9px] text-slate-500 mt-0.5 truncate">{item.goal}</div>
        <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-600">
          <span>{item.agents.length} agents</span>
          <span className="capitalize">{item.pattern}</span>
          {item.metrics && (
            <>
              <span>{item.metrics.turns} turns</span>
              <span>{item.metrics.tokens.toLocaleString()} tok</span>
              <span>${item.metrics.cost.toFixed(4)}</span>
              <span>{(item.metrics.duration / 1000).toFixed(1)}s</span>
            </>
          )}
        </div>
      </div>
      {/* Agents */}
      <div className="px-3 py-1.5 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.agents.map((a, i) => {
            const meta = AGENT_META[a.type] || { color: "#64748b" };
            return (
              <span key={i} className="flex items-center gap-1 text-[9px] text-slate-400 bg-white/[0.03] px-1.5 py-0.5 rounded">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                {a.role || a.type}
              </span>
            );
          })}
        </div>
      </div>
      {/* Output */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {item.answer ? (
          <div className="prose-kernel text-[11px]">{renderMarkdown(item.answer)}</div>
        ) : (
          <p className="text-[10px] text-slate-600 italic">No output</p>
        )}
      </div>
    </div>
  );
}

export default function CompareView({ items, onRemove, onClose }: CompareViewProps) {
  if (items.length < 2) return null;

  // Find best metrics
  const withMetrics = items.filter(i => i.metrics);
  const fastest = withMetrics.length > 1 ? withMetrics.reduce((a, b) => (a.metrics!.duration < b.metrics!.duration ? a : b)) : null;
  const cheapest = withMetrics.length > 1 ? withMetrics.reduce((a, b) => (a.metrics!.cost < b.metrics!.cost ? a : b)) : null;
  const leastTokens = withMetrics.length > 1 ? withMetrics.reduce((a, b) => (a.metrics!.tokens < b.metrics!.tokens ? a : b)) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <ArrowLeftRight className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-[11px] font-semibold text-slate-300">Comparing {items.length} runs</span>
        <span className="text-[9px] text-slate-600 flex-1">Select runs from Library using the + button</span>
        <button onClick={onClose} className="text-[10px] text-slate-400 hover:text-slate-200 bg-white/[0.03] border border-white/[0.06] px-3 py-1 rounded-lg transition-all">
          Close
        </button>
      </div>

      {/* Columns */}
      <div className="flex gap-3 flex-1 min-h-0">
        {items.map(item => (
          <div key={item.id} className="flex-1 min-w-0 flex flex-col min-h-0 relative group">
            <button
              onClick={() => onRemove(item.id)}
              className="absolute top-2 right-2 z-10 h-5 w-5 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Minus className="h-2.5 w-2.5 text-red-400" />
            </button>
            <CompareColumn item={item} />
          </div>
        ))}
      </div>

      {/* Summary */}
      {withMetrics.length > 1 && (
        <div className="shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <div className="text-[10px] font-semibold text-slate-300 mb-2">Comparison</div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
            {items.map(item => (
              <div key={item.id} className="text-[9px] space-y-1">
                <div className="font-medium text-slate-400 truncate">{item.label}</div>
                <div className="flex justify-between"><span className="text-slate-600">Status</span><span className={item.status === "completed" ? "text-emerald-400" : "text-red-400"}>{item.status}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Duration</span><span className={`${fastest?.id === item.id ? "text-emerald-400 font-semibold" : "text-slate-300"}`}>{((item.metrics?.duration || 0) / 1000).toFixed(1)}s</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Tokens</span><span className={`${leastTokens?.id === item.id ? "text-emerald-400 font-semibold" : "text-slate-300"}`}>{item.metrics?.tokens.toLocaleString() || 0}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Cost</span><span className={`${cheapest?.id === item.id ? "text-emerald-400 font-semibold" : "text-slate-300"}`}>${(item.metrics?.cost || 0).toFixed(4)}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-white/[0.04] text-[9px] text-slate-500 flex gap-3">
            {fastest && <span className="text-emerald-400/70">Fastest: {fastest.label}</span>}
            {cheapest && cheapest.id !== fastest?.id && <span className="text-emerald-400/70">Cheapest: {cheapest.label}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compare Tray (floating selection bar) ────────────────────────────────
export function CompareTray({ items, onRemove, onCompare, onClear }: { items: CompareItem[]; onRemove: (id: string) => void; onCompare: () => void; onClear: () => void }) {
  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-slate-900/95 backdrop-blur-sm border border-violet-500/20 rounded-2xl shadow-2xl shadow-violet-500/10">
      <ArrowLeftRight className="h-3.5 w-3.5 text-violet-400" />
      <div className="flex items-center gap-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-1.5 px-2 py-1 bg-violet-500/10 border border-violet-500/20 rounded-lg">
            <span className="text-[9px] text-violet-300 max-w-[100px] truncate">{item.label}</span>
            <button onClick={() => onRemove(item.id)} className="text-violet-400 hover:text-red-400 transition-colors">
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
      <span className="text-[9px] text-slate-500">{items.length}/2+</span>
      {items.length >= 2 && (
        <button onClick={onCompare} className="px-3 py-1 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 rounded-lg text-[10px] font-medium transition-all">
          Compare
        </button>
      )}
      <button onClick={onClear} className="text-slate-500 hover:text-slate-300 transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
