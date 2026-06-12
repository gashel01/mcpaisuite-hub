"use client";

import {
  Upload, FileText, Trash2, Eye, ChevronRight, ChevronDown, Layers,
} from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import ConfirmDialog from "@/components/ui/confirm";
import type { SourceInfo, DocChunk, UnifiedNode } from "../types";

interface DocumentPanelProps {
  sources: SourceInfo[];
  sourceChunks: Record<string, DocChunk[]>;
  onUploadClick: () => void;
  onLoadChunks: (source: string, sourceId?: string) => void;
  onDeleteSource: (source: string, sourceId?: string) => void;
  onSelectNode: (node: UnifiedNode) => void;
}

export function DocumentPanel({ sources, sourceChunks, onUploadClick, onLoadChunks, onDeleteSource, onSelectNode }: DocumentPanelProps) {
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ source: string; sourceId?: string; name: string } | null>(null);

  const toggleExpand = (source: string, sourceId?: string) => {
    if (expandedSource === source) {
      setExpandedSource(null);
    } else {
      setExpandedSource(source);
      onLoadChunks(source, sourceId);
    }
  };

  return (
    <div className="p-3 space-y-2">
      {/* Upload button */}
      <button onClick={onUploadClick} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/[0.08] hover:border-violet-500/30 rounded-xl text-[10px] text-slate-500 hover:text-violet-300 transition-all hover:bg-violet-500/[0.02]">
        <Upload className="h-3 w-3" /> Upload document
      </button>

      {sources.length === 0 && (
        <div className="text-center py-8">
          <FileText className="h-6 w-6 text-slate-800 mx-auto mb-2" />
          <p className="text-[10px] text-slate-600">No documents yet.</p>
          <p className="text-[9px] text-slate-700 mt-1">Drop files or click upload to start.</p>
        </div>
      )}

      {sources.map((s, i) => {
        const name = (s.source || "").split(/[/\\]/).pop() || s.source;
        const cc = s.chunks || s.chunk_count || 0;
        const isExpanded = expandedSource === s.source;

        return (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden hover:border-white/[0.1] transition-all">
            <div className="flex items-center gap-2 px-3 py-2 group">
              <button onClick={() => toggleExpand(s.source, s.source_id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {isExpanded ? <ChevronDown className="h-2.5 w-2.5 text-slate-500 shrink-0" /> : <ChevronRight className="h-2.5 w-2.5 text-slate-500 shrink-0" />}
                <FileText className="h-3 w-3 text-emerald-400 shrink-0" />
                <span className="text-[10px] text-slate-300 truncate">{name}</span>
              </button>
              {cc > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] text-slate-600 shrink-0 bg-white/[0.03] px-1.5 py-0.5 rounded">
                  <Layers className="h-2 w-2" />{cc}
                </span>
              )}
              <button
                onClick={() => onSelectNode({ id: `doc_${s.source}`, name, type: "Document", category: "document" })}
                className="text-slate-700 hover:text-violet-400 transition-colors p-0.5"
                title="Show on graph"
              >
                <Eye className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={() => setPendingDelete({ source: s.source, sourceId: s.source_id, name })}
                className="p-0.5 transition-all opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400"
                title="Delete source"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>

            {isExpanded && (
              <div className="border-t border-white/[0.04] px-3 py-2 space-y-1.5 max-h-60 overflow-y-auto bg-black/20 animate-fade-in">
                {!sourceChunks[s.source] && (
                  <div className="py-3 text-center"><Spinner className="h-3 w-3 text-slate-600 mx-auto" /></div>
                )}
                {(sourceChunks[s.source] || []).map((chunk, ci) => (
                  <div key={ci} className="text-[9px] text-slate-500 leading-relaxed border-l-2 border-emerald-500/20 pl-2 py-0.5 hover:border-emerald-500/40 transition-colors">
                    <span className="text-emerald-400/50 font-mono text-[8px]">#{ci + 1}</span>
                    <p className="line-clamp-3 mt-0.5">{chunk.content}</p>
                  </div>
                ))}
                {sourceChunks[s.source]?.length === 0 && (
                  <p className="text-[9px] text-slate-700 text-center py-2">No chunks found</p>
                )}
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete document"
        message={pendingDelete ? `"${pendingDelete.name}" and all its chunks will be permanently removed.` : ""}
        onConfirm={() => { if (pendingDelete) onDeleteSource(pendingDelete.source, pendingDelete.sourceId); setPendingDelete(null); }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
