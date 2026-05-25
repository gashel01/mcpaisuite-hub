"use client";

import {
  FileSearch, Layers, Brain, Database, CheckCircle2, AlertCircle, FileText, Loader2,
} from "lucide-react";
import type { UploadEntry } from "../types";

const PIPELINE_STEPS = [
  { id: "parsing", label: "Parse", icon: FileSearch, color: "text-blue-400" },
  { id: "chunking", label: "Chunk", icon: Layers, color: "text-violet-400" },
  { id: "embedding", label: "Embed", icon: Brain, color: "text-pink-400" },
  { id: "indexing", label: "Index", icon: Database, color: "text-emerald-400" },
  { id: "done", label: "Done", icon: CheckCircle2, color: "text-green-400" },
] as const;

export function IngestionStepper({ entry }: { entry: UploadEntry }) {
  const currentIdx = PIPELINE_STEPS.findIndex(s => s.id === entry.status);

  if (entry.status === "error") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-500/[0.05] border border-red-500/20 rounded-xl animate-fade-in">
        <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        <span className="text-[10px] text-red-300 truncate flex-1">{entry.name}</span>
        <span className="text-[9px] text-red-400/70">{entry.error?.slice(0, 40)}</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 bg-black/40 backdrop-blur-md border border-white/[0.08] rounded-xl animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        {entry.status === "done" ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
        ) : (
          <Loader2 className="h-3 w-3 text-violet-400 animate-spin shrink-0" />
        )}
        <span className="text-[10px] text-slate-300 truncate flex-1">{entry.name}</span>
        <span className="text-[8px] text-slate-600">{(entry.size / 1024).toFixed(0)} KB</span>
      </div>
      <div className="flex items-center gap-0.5">
        {PIPELINE_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === currentIdx;
          const isDone = i < currentIdx || entry.status === "done";
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className={`flex items-center justify-center h-5 w-5 rounded-full transition-all duration-300 ${
                isDone ? "bg-emerald-500/20 border border-emerald-500/30" :
                isActive ? "bg-violet-500/20 border border-violet-500/40 animate-pulse" :
                "bg-white/[0.03] border border-white/[0.06]"
              }`}>
                <Icon className={`h-2.5 w-2.5 ${isDone ? "text-emerald-400" : isActive ? "text-violet-400" : "text-slate-700"}`} />
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-0.5 transition-all duration-500 ${isDone ? "bg-emerald-500/40" : "bg-white/[0.04]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
