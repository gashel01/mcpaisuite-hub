"use client";

import { useState } from "react";
import { PanelLeftOpen, PanelLeftClose, History, Search, Loader2 } from "lucide-react";
import TaskHistoryList, { type TaskSummary } from "./TaskHistoryList";
import { SearchPanel } from "../../app/observability/search";

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
  tasks: TaskSummary[];
  selectedTask: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  namespace: string;
}

export default function HistorySidebar({ open, setOpen, tasks, selectedTask, onSelect, loading, namespace }: Props) {
  const [tab, setTab] = useState<"history" | "search">("history");

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
          className="flex flex-col items-center gap-2 w-full text-slate-400 hover:text-slate-200 transition-colors"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
          <span className="text-[8px] font-medium [writing-mode:vertical-lr] rotate-180">History</span>
        </button>
      </div>

      {/* ── Expanded panel ───────────────────────────────────────── */}
      <div className={`w-[260px] rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col flex-1 min-h-0 transition-opacity duration-300 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}>
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center gap-0.5 flex-1 bg-white/[0.02] rounded-md p-0.5">
            <button
              onClick={() => setTab("history")}
              className={`flex items-center gap-1 flex-1 px-2 py-1 text-[10px] font-medium rounded transition-all ${
                tab === "history" ? "bg-violet-500/15 text-violet-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <History className="h-3 w-3" />
              History
            </button>
            <button
              onClick={() => setTab("search")}
              className={`flex items-center gap-1 flex-1 px-2 py-1 text-[10px] font-medium rounded transition-all ${
                tab === "search" ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Search className="h-3 w-3" />
              Search
            </button>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "history" ? (
            <TaskHistoryList
              tasks={tasks}
              selectedTask={selectedTask}
              onSelect={onSelect}
              loading={loading}
            />
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
