"use client";

import { Search, X, Target, Tag, Eye, Activity, Shield, Clock } from "lucide-react";
import type { UnifiedNode, GraphLink, GraphNode } from "../types";
import { getTypeColor } from "../types";

interface NodeDetailProps {
  node: UnifiedNode;
  edges: GraphLink[];
  allNodes: GraphNode[];
  onClose: () => void;
  onSearch: (query: string) => void;
  onFocus: () => void;
  onNodeClick: (node: GraphNode) => void;
}

export function NodeDetail({ node, edges, allNodes, onClose, onSearch, onFocus, onNodeClick }: NodeDetailProps) {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-black/85  border border-white/[0.1] rounded-2xl px-4 py-3 shadow-2xl max-w-lg w-full mx-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="h-4 w-4 rounded-full shrink-0 ring-2 ring-white/10" style={{ backgroundColor: getTypeColor(node.type) }} />
        <span className="text-sm font-semibold text-slate-100 truncate flex-1">{node.name}</span>
        <span className="text-[8px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded-full">{node.type}</span>

        {/* Importance bar */}
        {node.importance != null && (
          <div className="flex items-center gap-1">
            <div className="w-8 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${node.importance >= 0.7 ? "bg-amber-400" : "bg-blue-400"}`} style={{ width: `${node.importance * 100}%` }} />
            </div>
            <span className="text-[8px] text-amber-400">{Math.round(node.importance * 100)}%</span>
          </div>
        )}

        {/* Actions */}
        <button onClick={() => onSearch(node.name)} className="text-[8px] text-violet-400 hover:text-violet-300 p-1 rounded-lg hover:bg-violet-500/10 transition-all" title="Search">
          <Search className="h-2.5 w-2.5" />
        </button>
        <button onClick={onFocus} className="text-[8px] text-cyan-400 hover:text-cyan-300 p-1 rounded-lg hover:bg-cyan-500/10 transition-all" title="Focus mode">
          <Target className="h-2.5 w-2.5" />
        </button>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 p-1 rounded-lg hover:bg-white/[0.04] transition-all">
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Content */}
      {node.content && <p className="text-[10px] text-slate-400 leading-relaxed mb-1.5 line-clamp-3">{node.content}</p>}

      {/* Tags */}
      {node.tags && node.tags.length > 0 && (
        <div className="flex items-center gap-1 mb-1.5">
          <Tag className="h-2.5 w-2.5 text-slate-600" />
          {node.tags.map(t => <span key={t} className="text-[8px] text-violet-400/70 bg-violet-500/10 px-1.5 py-0.5 rounded">{t}</span>)}
        </div>
      )}

      {/* Connections */}
      {edges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {edges.slice(0, 10).map((e, i) => {
            const oid = (typeof e.source === "string" ? e.source : (e.source as any)?.id) === node.id
              ? (typeof e.target === "string" ? e.target : (e.target as any)?.id)
              : (typeof e.source === "string" ? e.source : (e.source as any)?.id);
            const o = allNodes.find(n => n.id === oid);
            if (!o) return null;
            return (
              <button key={i} onClick={() => onNodeClick(o)} className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.03] hover:bg-violet-500/10 border border-white/[0.06] rounded-lg text-[8px] transition-all hover:scale-105">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getTypeColor(o.type) }} />
                <span className="text-slate-400 truncate max-w-20">{o.name}</span>
                <span className="text-slate-700">{e.type}</span>
              </button>
            );
          })}
          {edges.length > 10 && <span className="text-[8px] text-slate-600 self-center">+{edges.length - 10}</span>}
        </div>
      )}
    </div>
  );
}
