"use client";

import { useState } from "react";
import {
  Search, X, Sparkles, FileText, Network,
  RefreshCw, Hash, ChevronDown, ChevronRight,
} from "lucide-react";
import type { KnowledgeFact, SearchResult, SelfRagResult, UnifiedNode } from "../types";
import { renderMarkdown } from "@/components/markdown";
import { Spinner } from "@/components/ui/Spinner";

interface SearchResultsProps {
  query: string;
  searching: boolean;
  facts: KnowledgeFact[];
  docResults: SearchResult[];
  selfRagResult: SelfRagResult | null;
  onClose: () => void;
  onSelectFact: (node: UnifiedNode) => void;
}

export function SearchResults({ query, searching, facts, docResults, selfRagResult, onClose, onSelectFact }: SearchResultsProps) {
  const hasResults = facts.length > 0 || docResults.length > 0 || selfRagResult !== null;

  return (
    <div className="border-b border-violet-500/10 bg-violet-500/[0.02]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]">
        <Search className="h-3 w-3 text-violet-400" />
        <span className="text-[10px] font-medium text-violet-300 flex-1 truncate">
          &ldquo;{query}&rdquo;
        </span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors p-0.5 rounded hover:bg-white/[0.04]">
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="p-3 space-y-2 max-h-[420px] overflow-y-auto">
        {searching && (
          <div className="py-6 text-center">
            <Spinner className="h-5 w-5 text-violet-400 mx-auto" />
            <p className="text-[10px] text-slate-600 mt-2">Searching knowledge base...</p>
          </div>
        )}

        {selfRagResult && <SelfRagCard result={selfRagResult} />}

        {facts.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Facts ({facts.length})</p>
            {facts.map(f => (
              <button
                key={f.id}
                onClick={() => onSelectFact({ id: `fact_${f.id}`, name: f.content.slice(0, 35), type: "Fact", category: "fact", content: f.content })}
                className="w-full text-left rounded-lg border border-white/[0.04] bg-white/[0.01] px-2.5 py-2 hover:bg-white/[0.03] hover:border-white/[0.08] transition-all"
              >
                <p className="text-[10px] text-slate-300 line-clamp-2">{f.content}</p>
                <div className="flex items-center gap-2 mt-1">
                  {f.score != null && <ConfidenceBar value={f.score} />}
                  {f.fact_type && <span className="text-[7px] text-slate-600">{f.fact_type}</span>}
                  {f.retrieval_count != null && f.retrieval_count > 0 && (
                    <span className="text-[7px] text-cyan-400/60">{f.retrieval_count} retrievals</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {docResults.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Documents ({docResults.length})</p>
            {docResults.map((r, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 hover:border-white/[0.1] transition-all">
                <div className="flex items-center gap-1.5">
                  <FileText className="h-2.5 w-2.5 text-emerald-400" />
                  <span className="text-[9px] text-slate-400 font-mono truncate flex-1">
                    {r.metadata?.source ? String(r.metadata.source).split(/[/\\]/).pop() : `Chunk ${i + 1}`}
                  </span>
                  {r.score > 0 && <ConfidenceBar value={r.score} />}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{r.content}</p>
              </div>
            ))}
          </div>
        )}

        {!searching && !hasResults && (
          <p className="text-[10px] text-slate-600 text-center py-6">No results found</p>
        )}
      </div>
    </div>
  );
}

// ── Self-RAG Card ───────────────────────────────────────────────────────

function SelfRagCard({ result }: { result: SelfRagResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-2 animate-fade-in">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-emerald-400" />
        <span className="text-[9px] font-semibold text-emerald-300">AI Answer</span>
        <div className="flex-1" />
        <button onClick={() => setExpanded(!expanded)} className="text-[8px] text-slate-500 hover:text-slate-300 flex items-center gap-0.5 transition-colors">
          {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
          Details
        </button>
      </div>

      <div className="text-[11px] text-slate-200 leading-relaxed prose-sm [&_p]:mb-1 [&_ul]:mb-1 [&_li]:text-[11px]">
        {renderMarkdown(result.answer)}
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-3 pt-1 border-t border-emerald-500/10">
        <ConfidenceBar value={result.support_score} label="Support" />
        <ConfidenceBar value={result.completeness_score} label="Complete" />
        <div className="flex items-center gap-1 text-[8px] text-slate-500">
          <Hash className="h-2.5 w-2.5" />{result.chunks_used} chunks
        </div>
        {result.iterations > 1 && (
          <div className="flex items-center gap-1 text-[8px] text-violet-400/70">
            <RefreshCw className="h-2.5 w-2.5" />Refined {result.iterations}x
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-1 pt-2 border-t border-emerald-500/10 text-[9px] text-slate-500 space-y-1 animate-fade-in">
          <p>Self-RAG performed {result.iterations} iteration(s).</p>
          <p>Evidence: {result.chunks_used} document chunks.</p>
          <p>Support: {(result.support_score * 100).toFixed(0)}% — Completeness: {(result.completeness_score * 100).toFixed(0)}%</p>
        </div>
      )}
    </div>
  );
}

// ── Confidence Bar ──────────────────────────────────────────────────────

function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-400" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  const textColor = pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-center gap-1">
      {label && <span className="text-[8px] text-slate-500">{label}</span>}
      <div className="w-10 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[8px] font-medium ${textColor}`}>{pct}%</span>
    </div>
  );
}
