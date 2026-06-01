"use client";

import {
  Search, Filter, Sparkles, Upload, RefreshCw, Loader2,
  Brain, FileText, Network, Target, X, PanelRightOpen,
} from "lucide-react";
import type { SearchMode, GraphMode, MemoryStats } from "../types";
import type { GraphStatus } from "../hooks";
import { KnowledgeScoreBar } from "./KnowledgeScoreBar";
import { IngestionStepper } from "./IngestionStepper";
import type { UploadEntry } from "../types";

// ── Stat Orb ────────────────────────────────────────────────────────────

function StatOrb({ icon: Icon, value, color, label }: { icon: any; value: number; color: string; label?: string }) {
  const c: Record<string, string> = { violet: "text-violet-300", emerald: "text-emerald-300", amber: "text-amber-300" };
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-black/40  rounded-xl border border-white/[0.06] group hover:border-white/[0.12] transition-all">
      <Icon className={`h-2.5 w-2.5 ${c[color] || "text-slate-400"}`} />
      <span className={`text-[10px] font-bold ${c[color] || "text-slate-300"}`}>{value}</span>
      {label && <span className="text-[8px] text-slate-600 hidden group-hover:inline">{label}</span>}
    </div>
  );
}

// ── Layer Toggle ────────────────────────────────────────────────────────

function LayerToggle({ active, color, label, onClick }: { active: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 px-1.5 py-1 bg-black/40  rounded-lg border transition-all text-[9px] font-medium hover:scale-105 active:scale-95 ${active ? "border-white/[0.12] text-slate-300" : "border-white/[0.04] text-slate-700"}`}>
      <span className="h-2 w-2 rounded-full transition-all" style={{ backgroundColor: color, opacity: active ? 1 : 0.2, boxShadow: active ? `0 0 6px ${color}40` : "none" }} />{label}
    </button>
  );
}

// ── Top Left HUD ────────────────────────────────────────────────────────

interface TopLeftHUDProps {
  query: string;
  setQuery: (q: string) => void;
  searchScope: SearchMode;
  setSearchScope: (s: SearchMode) => void;
  searching: boolean;
  onSearch: () => void;
  totalFacts: number;
  totalSources: number;
  totalNodes: number;
  showEntities: boolean;
  showFacts: boolean;
  showDocs: boolean;
  onToggleEntities: () => void;
  onToggleFacts: () => void;
  onToggleDocs: () => void;
  stats: MemoryStats | null;
  entityCount: number;
  insights: string[];
  activeUploads: UploadEntry[];
  graphControls: GraphControlsProps;
}

export function TopLeftHUD(props: TopLeftHUDProps) {
  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 sm:gap-2 w-[calc(100%-1.5rem)] sm:w-auto sm:max-w-[480px]">
      {/* Search */}
      <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-white/[0.08] rounded-2xl px-2 sm:px-3 py-1.5 sm:py-2 shadow-2xl">
        <Brain className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <input
          value={props.query}
          onChange={e => props.setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && props.onSearch()}
          placeholder="Ask the brain..."
          className="flex-1 bg-transparent text-xs sm:text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none min-w-0"
        />
        <div className="hidden sm:flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5 shrink-0">
          {(["all", "facts", "documents"] as SearchMode[]).map(s => (
            <button key={s} onClick={() => props.setSearchScope(s)} className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${props.searchScope === s ? "bg-violet-500/25 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>
              {s === "documents" ? "Docs" : s === "all" ? "All" : "Facts"}
            </button>
          ))}
          <div className="w-px h-3 bg-white/[0.08] mx-0.5" />
          {(["self_rag", "react"] as const).map(s => (
            <button key={s} onClick={() => props.setSearchScope(s as any)} className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${props.searchScope === s ? "bg-cyan-500/25 text-cyan-300" : "text-slate-600 hover:text-slate-400"}`}>
              {s === "self_rag" ? "Self-RAG" : "ReAct"}
            </button>
          ))}
        </div>
        <button onClick={props.onSearch} disabled={props.searching || !props.query.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-20 text-white rounded-xl p-1.5 transition-all active:scale-90 shrink-0 touch-target">
          {props.searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
        </button>
      </div>

      {/* Mobile: scope pills (left) + graph controls (right) on one row */}
      <div className="flex sm:hidden items-center justify-between gap-1.5 w-full">
        <div className="flex items-center gap-0.5 bg-black/50 backdrop-blur-sm rounded-xl border border-white/[0.06] p-0.5">
          {(["all", "facts", "documents"] as SearchMode[]).map(s => (
            <button key={s} onClick={() => props.setSearchScope(s)} className={`px-2 py-1 text-[9px] font-medium rounded-lg transition-all touch-target ${props.searchScope === s ? "bg-violet-500/25 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>
              {s === "documents" ? "Docs" : s === "all" ? "All" : "Facts"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <GraphControlButtons {...props.graphControls} />
        </div>
      </div>

      {/* Stats + layers */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
        <StatOrb icon={Brain} value={props.totalFacts} color="violet" label="Facts" />
        <StatOrb icon={FileText} value={props.totalSources} color="emerald" label="Docs" />
        <StatOrb icon={Network} value={props.totalNodes} color="amber" label="Nodes" />
        <div className="w-px h-4 bg-white/[0.06]" />
        <LayerToggle active={props.showEntities} color="#a78bfa" label="E" onClick={props.onToggleEntities} />
        <LayerToggle active={props.showFacts} color="#f472b6" label="F" onClick={props.onToggleFacts} />
        <LayerToggle active={props.showDocs} color="#34d399" label="D" onClick={props.onToggleDocs} />
      </div>

      {/* Knowledge score — hide on very small screens to save space */}
      <div className="hidden sm:block">
        <KnowledgeScoreBar stats={props.stats} factCount={props.totalFacts} sourceCount={props.totalSources} entityCount={props.entityCount} insights={props.insights} />
      </div>

      {/* Active uploads */}
      {props.activeUploads.slice(0, 2).map(u => (
        <IngestionStepper key={u.id} entry={u} />
      ))}
    </div>
  );
}

// ── Graph control buttons (shared: desktop top-right + mobile scope row) ──

interface GraphControlsProps {
  graphMode: GraphMode;
  setGraphMode: (m: GraphMode) => void;
  graphExtracting: boolean;
  extractProgress: { chunk: number; total: number } | null;
  graphStatus: GraphStatus | null;
  onExtractGraph: () => void;
  onUploadClick: () => void;
  onRefresh: () => void;
  sideOpen: boolean;
  onOpenSide: () => void;
}

function GraphControlButtons(props: GraphControlsProps) {
  return (
    <>
      <div className="flex items-center bg-black/50 backdrop-blur-sm rounded-xl border border-white/[0.08] p-0.5">
        <button onClick={() => props.setGraphMode("2d")} className={`px-2 py-1 text-[9px] font-medium rounded-lg transition-all touch-target ${props.graphMode === "2d" ? "bg-violet-500/25 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>2D</button>
        <button onClick={() => props.setGraphMode("3d")} className={`px-2 py-1 text-[9px] font-medium rounded-lg transition-all touch-target ${props.graphMode === "3d" ? "bg-violet-500/25 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>3D</button>
      </div>
      <button onClick={props.onExtractGraph} disabled={props.graphExtracting} className={`relative flex items-center gap-1 px-2 py-1.5 bg-black/50 backdrop-blur-sm border rounded-xl text-[9px] font-medium transition-all disabled:opacity-50 active:scale-95 touch-target ${
        props.graphStatus?.stale ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10" : "border-violet-500/20 text-violet-300 hover:bg-violet-500/10"
      }`}>
        {props.graphExtracting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
        <span className="hidden sm:inline">{props.extractProgress ? `${props.extractProgress.chunk}/${props.extractProgress.total}` : props.graphStatus?.stale ? "Update" : "Build"}</span>
        {props.graphStatus?.stale && !props.graphExtracting && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </button>
      <button onClick={props.onUploadClick} className="p-1.5 bg-black/50 backdrop-blur-sm border border-white/[0.08] rounded-xl text-slate-500 hover:text-violet-300 transition-all active:scale-95 touch-target">
        <Upload className="h-3 w-3" />
      </button>
      <button onClick={props.onRefresh} className="p-1.5 bg-black/50 backdrop-blur-sm border border-white/[0.08] rounded-xl text-slate-600 hover:text-slate-300 transition-all active:scale-95 touch-target">
        <RefreshCw className="h-3 w-3" />
      </button>
      {!props.sideOpen && (
        <button onClick={props.onOpenSide} className="p-1.5 bg-black/50 backdrop-blur-sm border border-white/[0.08] rounded-xl text-slate-500 hover:text-slate-300 transition-all active:scale-95 touch-target" aria-label="Open side panel">
          <PanelRightOpen className="h-3 w-3" />
        </button>
      )}
    </>
  );
}

// ── Top Right HUD (desktop only — mobile controls live in TopLeftHUD) ─────

interface TopRightHUDProps extends GraphControlsProps {
  graphSearch: string;
  setGraphSearch: (s: string) => void;
}

export function TopRightHUD(props: TopRightHUDProps) {
  const rightOffset = props.sideOpen ? "calc(340px + 12px)" : "12px";
  return (
    <div className="absolute top-3 z-20 hidden sm:flex items-center gap-1.5" style={{ right: rightOffset }}>
      {/* Filter */}
      <div className="relative">
        <input
          value={props.graphSearch}
          onChange={e => props.setGraphSearch(e.target.value)}
          placeholder="Filter nodes..."
          className="w-24 pl-6 pr-2 py-1.5 bg-black/50 backdrop-blur-sm border border-white/[0.08] rounded-xl text-[10px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-violet-500/30 focus:w-40 transition-all"
        />
        <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-600" />
      </div>
      <GraphControlButtons {...props} />
    </div>
  );
}

// ── Focus Mode Indicator ────────────────────────────────────────────────

export function FocusModeIndicator({ onExit }: { onExit: () => void }) {
  return (
    <div className="absolute bottom-20 sm:top-3 sm:bottom-auto left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 backdrop-blur-sm border border-violet-500/30 rounded-xl animate-fade-in">
      <Target className="h-3 w-3 text-violet-400" />
      <span className="text-[10px] text-violet-300 font-medium">Focus Mode</span>
      <span className="text-[8px] text-violet-400/50 hidden sm:inline">Right-click to exit</span>
      <button onClick={onExit} className="text-violet-400 hover:text-white transition-colors ml-1 touch-target"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// ── Graph Build Progress Bar ────────────────────────────────────────────

export function GraphBuildProgress({ progress }: { progress: { chunk: number; total: number } }) {
  const pct = Math.round((progress.chunk / progress.total) * 100);
  return (
    <div className="absolute top-0 left-0 right-0 z-30">
      {/* Full-width progress bar */}
      <div className="h-1 bg-black/30">
        <div
          className="h-full bg-gradient-to-r from-violet-500 via-cyan-500 to-emerald-500 transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Status pill */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-black/70  border border-violet-500/30 rounded-2xl shadow-2xl animate-fade-in">
        <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-200 font-medium">Building Knowledge Graph</span>
          <span className="text-[9px] text-slate-500">
            Processing chunk {progress.chunk} of {progress.total} — {pct}%
          </span>
        </div>
        <div className="ml-3 w-24 h-2 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
