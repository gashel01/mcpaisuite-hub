"use client";

import { Tag, Trash2, Sparkles } from "lucide-react";

export interface Fact {
  id: string;
  content: string;
  importance: number;
  tags: string[];
  score?: number;
  fact_type?: string;
}

interface FactCardProps {
  fact: Fact;
  onDelete?: (id: string) => void;
}

function importanceColor(importance: number): string {
  if (importance >= 0.8) return "bg-red-500";
  if (importance >= 0.6) return "bg-orange-500";
  if (importance >= 0.4) return "bg-amber-500";
  if (importance >= 0.2) return "bg-blue-500";
  return "bg-slate-500";
}

function importanceLabel(importance: number): string {
  if (importance >= 0.8) return "Critical";
  if (importance >= 0.6) return "High";
  if (importance >= 0.4) return "Medium";
  if (importance >= 0.2) return "Low";
  return "Minimal";
}

export default function FactCard({ fact, onDelete }: FactCardProps) {
  const pct = Math.round(fact.importance * 100);

  return (
    <div className="bg-slate-900/80 border border-slate-700/50 rounded-xl p-4 group transition-colors hover:border-violet-600/30">
      {/* Top row: fact_type + score + delete */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {fact.fact_type && (
            <span className="text-[10px] font-medium uppercase tracking-wide bg-violet-600/20 text-violet-400 border border-violet-700/30 px-1.5 py-0.5 rounded">
              {fact.fact_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fact.score != null && (
            <span className="flex items-center gap-1 text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded">
              <Sparkles className="h-3 w-3" />
              {(fact.score * 100).toFixed(0)}%
            </span>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(fact.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-1 transition-all"
              title="Delete fact"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <p className="text-sm text-slate-200 leading-relaxed mb-3">{fact.content}</p>

      {/* Importance bar */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide w-16 shrink-0">
          {importanceLabel(fact.importance)}
        </span>
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${importanceColor(fact.importance)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-600 w-8 text-right">{pct}%</span>
      </div>

      {/* Tags */}
      {fact.tags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag className="h-3 w-3 text-slate-600 shrink-0" />
          {fact.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] bg-slate-800/80 text-slate-400 border border-slate-700/40 px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
