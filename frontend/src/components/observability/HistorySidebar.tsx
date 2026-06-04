"use client";

import { useState } from "react";
import { PanelLeftOpen, PanelLeftClose, History, Search, Server, Home } from "lucide-react";
import TaskHistoryList, { type TaskSummary } from "./TaskHistoryList";
import { SearchPanel } from "../../app/observability/search";

interface Kernel { instance_id: string; name: string; project: string; live: boolean }

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
  tasks: TaskSummary[];
  selectedTask: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  namespace: string;
  embedded?: boolean;
  scope?: string;
  setScope?: (s: string) => void;
  kernels?: Kernel[];
  // Pagination for the history list (local scope only).
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
}

// Source switcher — local Hub vs a connected remote kernel. Only one source shows
// at a time, so the local list stays clean by default; you opt into a kernel.
function ScopeBar({ scope, setScope, kernels }: { scope: string; setScope: (s: string) => void; kernels: Kernel[] }) {
  if (!kernels.length) return null;
  const active = scope !== "local";
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/[0.04] shrink-0">
      {active ? <Server className="h-3 w-3 text-sky-400 shrink-0" /> : <Home className="h-3 w-3 text-slate-500 shrink-0" />}
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        className={`flex-1 min-w-0 bg-white/[0.03] border rounded-md px-1.5 py-1 text-[10.5px] outline-none cursor-pointer ${
          active ? "border-sky-500/30 text-sky-200" : "border-white/[0.06] text-slate-300"
        }`}
        title="Task source"
      >
        <option value="local">Local Hub</option>
        {kernels.map(k => (
          <option key={k.instance_id} value={k.instance_id}>
            {k.live ? "● " : "○ "}{k.name} · {k.project}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function HistorySidebar({ open, setOpen, tasks, selectedTask, onSelect, loading, namespace, embedded, scope = "local", setScope, kernels = [], total, page, pageSize, onPageChange }: Props) {
  const [tab, setTab] = useState<"history" | "search">("history");
  const showScope = !!setScope && kernels.length > 0;

  // Embedded mode (mobile overlay) — no collapse/expand chrome
  if (embedded) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center gap-0.5 flex-1 bg-white/[0.02] rounded-lg p-0.5">
            <button
              onClick={() => setTab("history")}
              className={`flex items-center gap-1.5 flex-1 px-3 py-2 text-[11px] sm:text-xs font-medium rounded-md transition-all touch-target ${
                tab === "history" ? "bg-violet-500/15 text-violet-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>
            <button
              onClick={() => setTab("search")}
              className={`flex items-center gap-1.5 flex-1 px-3 py-2 text-[11px] sm:text-xs font-medium rounded-md transition-all touch-target ${
                tab === "search" ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "history" ? (
            <div className="flex flex-col h-full min-h-0">
              {showScope && <ScopeBar scope={scope} setScope={setScope!} kernels={kernels} />}
              <div className="flex-1 min-h-0"><TaskHistoryList tasks={tasks} selectedTask={selectedTask} onSelect={onSelect} loading={loading} total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} /></div>
            </div>
          ) : (
            <SearchPanel namespace={namespace} onSelectTrace={onSelect} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="transition-all duration-300 ease-in-out shrink-0 flex flex-col relative"
      style={{ width: open ? 260 : 44 }}
    >
      {/* ── Collapsed bar ────────────────────────────────────────── */}
      <div className={`absolute inset-0 w-11 flex flex-col items-center gap-3 py-3 rounded-xl border border-white/[0.06] bg-white/[0.015] transition-all duration-300 ${
        open ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}>
        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-2 w-full text-slate-400 hover:text-slate-200 transition-colors touch-target"
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span className="text-[9px] font-medium [writing-mode:vertical-lr] rotate-180">History</span>
        </button>
      </div>

      {/* ── Expanded panel ───────────────────────────────────────── */}
      <div className={`w-[260px] rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col flex-1 min-h-0 transition-opacity duration-300 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}>
        {/* Header */}
        <div className="flex items-center gap-1 px-2.5 py-2 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center gap-0.5 flex-1 bg-white/[0.02] rounded-lg p-0.5">
            <button
              onClick={() => setTab("history")}
              className={`flex items-center gap-1 flex-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all ${
                tab === "history" ? "bg-violet-500/15 text-violet-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>
            <button
              onClick={() => setTab("search")}
              className={`flex items-center gap-1 flex-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all ${
                tab === "search" ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-md hover:bg-white/[0.04]"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "history" ? (
            <div className="flex flex-col h-full min-h-0">
              {showScope && <ScopeBar scope={scope} setScope={setScope!} kernels={kernels} />}
              <div className="flex-1 min-h-0">
                <TaskHistoryList
                  tasks={tasks}
                  selectedTask={selectedTask}
                  onSelect={onSelect}
                  loading={loading}
                  total={total}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={onPageChange}
                />
              </div>
            </div>
          ) : (
            <SearchPanel
              namespace={namespace}
              onSelectTrace={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  );
}
