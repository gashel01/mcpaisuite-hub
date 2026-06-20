"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import EventsPanel from "@/components/observability/EventsPanel";
import TraceWaterfall from "@/components/observability/TraceWaterfall";
import RunStats from "@/components/observability/RunStats";
import TimeTravelPanel from "@/components/observability/TimeTravelPanel";
import RunWorkspacesButton from "@/components/observability/RunWorkspacesButton";
import ReviewQueue from "@/components/observability/ReviewQueue";
import InsightsPanel from "@/components/observability/InsightsPanel";
import ImprovePanel from "@/components/observability/ImprovePanel";
import { AlertsPanel } from "./alerts";
import { useExecutionStore } from "@/stores/execution";
import type { PageMode, Analytics, Stats } from "./types";

interface RightPanelContentProps {
  mode: PageMode;
  traceSub: "events" | "spans" | "stats" | "replay";
  setTraceSub: (t: "events" | "spans" | "stats" | "replay") => void;
  dashSub: "alerts" | "queue" | "insights";
  setDashSub: (t: "alerts" | "queue" | "insights") => void;
  isLive: boolean;
  executionEvents: any[];
  auditEvents: any[];
  viewMode: "task" | "all";
  setViewMode: (m: "task" | "all") => void;
  sourceFilter: string;
  setSourceFilter: (s: string) => void;
  textFilter: string;
  setTextFilter: (t: string) => void;
  activeEventId: string | null;
  taskId: string | null;
  selectedHistoryTask: string | null;
  tenant: string;
  analytics: Analytics | null;
  stats: Stats | null;
  th: Record<string, string>;
  setActiveEvent: (id: string | null) => void;
  setDrawerOpen: (open: boolean) => void;
  selectHistoryTask: (id: string) => void;
}

export function RightPanelContent({
  mode, traceSub, setTraceSub, dashSub, setDashSub, isLive,
  executionEvents, auditEvents, viewMode, setViewMode,
  sourceFilter, setSourceFilter, textFilter, setTextFilter,
  activeEventId, taskId, selectedHistoryTask, tenant,
  analytics, stats, th, setActiveEvent, setDrawerOpen, selectHistoryTask,
}: RightPanelContentProps) {
  return mode === "trace" ? (
    <>
      <div className="flex items-center gap-0.5 px-2.5 sm:px-3 py-2 border-b border-white/[0.04] shrink-0">
        {([
          { id: "events" as const, label: "Events" },
          { id: "spans" as const, label: "Spans" },
          { id: "stats" as const, label: "Run Stats" },
          { id: "replay" as const, label: "Replay" },
        ]).map(t => (
          <button key={t.id} onClick={() => setTraceSub(t.id)}
            className={`relative px-3 py-2 text-[11px] sm:text-xs font-medium rounded-lg transition-all touch-target ${traceSub === t.id ? "text-violet-300" : "text-slate-500 hover:text-slate-300"}`}
          >
            {t.label}
            {traceSub === t.id && (
              <motion.div layoutId="trace-tab-bg" className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-lg -z-10" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <RunWorkspacesButton taskId={taskId || selectedHistoryTask || ""} />
          {isLive && (
            <div className="flex items-center gap-1.5">
              <motion.div className="h-2 w-2 rounded-full bg-green-400" animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
              <span className="text-[10px] text-green-400/70 font-medium">live</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {traceSub === "events" && (
            <motion.div key="events" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <EventsPanel
                events={executionEvents} auditEvents={auditEvents}
                viewMode={viewMode} setViewMode={setViewMode}
                sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
                textFilter={textFilter} setTextFilter={setTextFilter}
                onEventClick={(id) => { setActiveEvent(id); setDrawerOpen(true); }}
                onLoadTrace={(evt) => { const id = (evt.data.task_id as string) || ""; if (id) selectHistoryTask(id); }}
                activeEventId={activeEventId}
                activeTaskId={taskId || selectedHistoryTask || ""}
              />
            </motion.div>
          )}
          {traceSub === "spans" && (
            <motion.div key="spans" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <TraceWaterfall taskId={taskId || selectedHistoryTask || ""} namespace={tenant} />
            </motion.div>
          )}
          {traceSub === "stats" && (
            <motion.div key="stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <RunStats
                taskId={taskId || selectedHistoryTask || ""}
                namespace={tenant}
                totalTokens={useExecutionStore.getState().tokens}
                totalCost={useExecutionStore.getState().cost}
                totalTurns={useExecutionStore.getState().turns}
              />
            </motion.div>
          )}
          {traceSub === "replay" && (
            <motion.div key="replay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <TimeTravelPanel taskId={taskId || selectedHistoryTask || ""} namespace={tenant} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  ) : (
    <>
      <div className="flex items-center gap-0.5 px-2.5 sm:px-3 py-2 border-b border-white/[0.04] shrink-0">
        {(["alerts", "queue", "insights"] as const).map(t => (
          <button key={t} onClick={() => setDashSub(t)}
            className={`relative px-3 sm:px-4 py-2 text-[11px] sm:text-xs font-medium rounded-lg transition-all capitalize touch-target ${dashSub === t ? "text-violet-300" : "text-slate-500 hover:text-slate-300"}`}
          >
            {t === "queue" ? "Review" : t}
            {dashSub === t && (
              <motion.div layoutId="dash-tab-bg" className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-lg -z-10" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {dashSub === "alerts" && (
            <motion.div key="alerts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <AlertsPanel />
            </motion.div>
          )}
          {dashSub === "queue" && (
            <motion.div key="queue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <ReviewQueue namespace={tenant} onSelectTask={selectHistoryTask} />
            </motion.div>
          )}
          {dashSub === "insights" && (
            <motion.div key="insights" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <InsightsPanel analytics={analytics} stats={stats} />
              <div className="p-2 sm:p-3">
                <ImprovePanel analytics={analytics} tenantHeaders={th} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

// ── Collapsible Section ────────────────────────────────────────────────────

export function CollapsibleSection({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-5 sm:mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-1 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors group touch-target"
      >
        <span>{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-slate-600 group-hover:text-slate-400">
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
