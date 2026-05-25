"use client";

import { useState, useMemo } from "react";
import {
  Search, X, TrendingUp, Tag, Clock, Trash2, Activity,
  BarChart3, Eye, Hash, Shield,
} from "lucide-react";
import type { KnowledgeFact, FactSort, UnifiedNode } from "../types";

interface FactPanelProps {
  facts: KnowledgeFact[];
  onDelete: (id: string) => void;
  onSelect: (node: UnifiedNode) => void;
}

export function FactPanel({ facts, onDelete, onSelect }: FactPanelProps) {
  const [sort, setSort] = useState<FactSort>("importance");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const factTypes = useMemo(() => [...new Set(facts.map(f => f.fact_type).filter(Boolean))], [facts]);

  const displayed = useMemo(() => {
    let list = [...facts];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(f => f.content.toLowerCase().includes(q) || f.tags?.some(t => t.toLowerCase().includes(q)));
    }
    if (typeFilter) list = list.filter(f => f.fact_type === typeFilter);

    switch (sort) {
      case "importance": list.sort((a, b) => (b.importance || 0) - (a.importance || 0)); break;
      case "retrievals": list.sort((a, b) => (b.retrieval_count || 0) - (a.retrieval_count || 0)); break;
      case "type": list.sort((a, b) => (a.fact_type || "").localeCompare(b.fact_type || "")); break;
      case "recent": list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")); break;
      case "decay": list.sort((a, b) => (a.decay_score || 1) - (b.decay_score || 1)); break;
    }
    return list;
  }, [facts, sort, search, typeFilter]);

  const handleDelete = (id: string) => {
    if (confirmDelete === id) {
      onDelete(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Controls */}
      <div className="shrink-0 px-3 py-2 border-b border-white/[0.04] space-y-2">
        {/* Search */}
        <div className="flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg px-2 py-1.5">
          <Search className="h-2.5 w-2.5 text-slate-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter facts..." className="flex-1 bg-transparent text-[10px] text-slate-300 placeholder:text-slate-700 focus:outline-none" />
          {search && <button onClick={() => setSearch("")} className="text-slate-600 hover:text-slate-300"><X className="h-2.5 w-2.5" /></button>}
        </div>
        {/* Sort */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[8px] text-slate-600 mr-0.5">Sort:</span>
          {([
            { id: "importance" as FactSort, icon: TrendingUp, label: "Imp" },
            { id: "retrievals" as FactSort, icon: Eye, label: "Hits" },
            { id: "decay" as FactSort, icon: Activity, label: "Decay" },
            { id: "type" as FactSort, icon: Tag, label: "Type" },
            { id: "recent" as FactSort, icon: Clock, label: "New" },
          ]).map(s => (
            <button key={s.id} onClick={() => setSort(s.id)} className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] rounded transition-all ${sort === s.id ? "bg-violet-500/15 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>
              <s.icon className="h-2 w-2" />{s.label}
            </button>
          ))}
          {factTypes.length > 0 && (
            <>
              <div className="w-px h-3 bg-white/[0.06] mx-0.5" />
              <button onClick={() => setTypeFilter(null)} className={`px-1.5 py-0.5 text-[8px] rounded transition-all ${!typeFilter ? "bg-white/[0.06] text-slate-300" : "text-slate-600"}`}>All</button>
              {factTypes.slice(0, 4).map(t => (
                <button key={t} onClick={() => setTypeFilter(typeFilter === t ? null : t!)} className={`px-1.5 py-0.5 text-[8px] rounded transition-all ${typeFilter === t ? "bg-pink-500/15 text-pink-300" : "text-slate-600"}`}>{t}</button>
              ))}
            </>
          )}
        </div>
        {/* Summary */}
        <div className="text-[8px] text-slate-600">
          {displayed.length} of {facts.length} facts
          {search && ` matching "${search}"`}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {displayed.length === 0 && (
          <p className="text-[10px] text-slate-600 text-center py-8">
            {facts.length === 0 ? "No facts learned yet. Chat with the agent to build memory." : "No facts match your filter."}
          </p>
        )}
        {displayed.map(f => (
          <FactItem
            key={f.id}
            fact={f}
            isConfirmingDelete={confirmDelete === f.id}
            onDelete={() => handleDelete(f.id)}
            onClick={() => onSelect({
              id: `fact_${f.id}`, name: f.content.slice(0, 35), type: "Fact",
              category: "fact", content: f.content, importance: f.importance, tags: f.tags,
            })}
          />
        ))}
      </div>
    </div>
  );
}

// ── Fact Item ────────────────────────────────────────────────────────────

function FactItem({ fact, isConfirmingDelete, onDelete, onClick }: {
  fact: KnowledgeFact;
  isConfirmingDelete: boolean;
  onDelete: () => void;
  onClick: () => void;
}) {
  const imp = fact.importance || 0;
  const impColor = imp >= 0.8 ? "bg-red-500" : imp >= 0.5 ? "bg-amber-500" : "bg-blue-500";
  const impBarColor = imp >= 0.8 ? "bg-red-400" : imp >= 0.5 ? "bg-amber-400" : "bg-blue-400";

  return (
    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/[0.08] transition-all group cursor-pointer" onClick={onClick}>
      {/* Importance indicator */}
      <div className="flex flex-col items-center gap-0.5 mt-0.5 shrink-0">
        <div className={`h-1.5 w-1.5 rounded-full ${impColor}`} />
        <div className="w-0.5 h-4 bg-white/[0.04] rounded-full overflow-hidden">
          <div className={`w-full rounded-full ${impBarColor}`} style={{ height: `${imp * 100}%` }} />
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-2">{fact.content}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {fact.fact_type && <span className="text-[7px] text-slate-500 bg-white/[0.03] px-1 py-0.5 rounded">{fact.fact_type}</span>}
          {fact.retrieval_count != null && fact.retrieval_count > 0 && (
            <span className="flex items-center gap-0.5 text-[7px] text-cyan-400/60">
              <Eye className="h-2 w-2" />{fact.retrieval_count}
            </span>
          )}
          {fact.confidence != null && fact.confidence !== 0.5 && (
            <span className="flex items-center gap-0.5 text-[7px] text-emerald-400/60">
              <Shield className="h-2 w-2" />{Math.round(fact.confidence * 100)}%
            </span>
          )}
          {fact.decay_score != null && fact.decay_score < 0.5 && (
            <span className="flex items-center gap-0.5 text-[7px] text-amber-400/60">
              <Activity className="h-2 w-2" />fading
            </span>
          )}
          {fact.tags?.slice(0, 2).map(t => <span key={t} className="text-[7px] text-violet-400/50">{t}</span>)}
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className={`shrink-0 p-0.5 transition-all ${
          isConfirmingDelete
            ? "opacity-100 text-red-400"
            : "opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400"
        }`}
        title={isConfirmingDelete ? "Click again to confirm" : "Delete fact"}
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
