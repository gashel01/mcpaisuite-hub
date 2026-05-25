"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, Zap, Wrench, CheckCircle2, AlertCircle } from "lucide-react";
import { useExecutionStore, type StreamEvent } from "@/stores/execution";

function DataRow({ label, value }: { label: string; value: string | number | boolean | undefined | null }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-xs text-slate-200 font-mono">{String(value)}</span>
    </div>
  );
}

function DataObject({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null);

  if (entries.length === 0) {
    return <p className="text-[11px] text-slate-600 italic">No data</p>;
  }

  return (
    <div className="space-y-0">
      {entries.map(([key, value]) => {
        if (typeof value === "object" && value !== null) {
          return (
            <div key={key} className="py-1.5 border-b border-slate-800/40 last:border-0">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{key}</span>
              <pre className="mt-1 text-[10px] text-slate-300 font-mono bg-slate-900/60 rounded p-2 overflow-x-auto max-h-32">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          );
        }
        return <DataRow key={key} label={key} value={value as string} />;
      })}
    </div>
  );
}

export default function StepDetail() {
  const { events, activeEventId, setActiveEvent } = useExecutionStore();
  const activeEvent = events.find((e) => e.id === activeEventId) || null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/60">
        <h3 className="text-xs font-medium text-slate-300">Step Detail</h3>
        {activeEvent && (
          <button
            onClick={() => setActiveEvent(null)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <AnimatePresence mode="wait">
          {activeEvent ? (
            <motion.div
              key={activeEvent.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="space-y-3"
            >
              {/* Header */}
              <div className="flex items-center gap-2">
                <EventTypeIcon type={activeEvent.type} />
                <div>
                  <p className="text-sm font-medium text-slate-200 capitalize">
                    {activeEvent.type.replace(/_/g, " ")}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono">
                    {new Date(activeEvent.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>

              {/* Message */}
              {activeEvent.message && (
                <div className="px-3 py-2 bg-slate-800/40 rounded-lg border border-slate-700/30">
                  <p className="text-[11px] text-slate-300">{activeEvent.message}</p>
                </div>
              )}

              {/* Data */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Data</p>
                <div className="bg-slate-800/30 rounded-lg border border-slate-700/30 px-3 py-2">
                  <DataObject data={activeEvent.data} />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-32 text-center"
            >
              <div className="h-8 w-8 rounded-lg bg-slate-800/40 border border-slate-700/30 flex items-center justify-center mb-2">
                <Zap className="h-4 w-4 text-slate-600" />
              </div>
              <p className="text-[11px] text-slate-600">Click an event to see details</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EventTypeIcon({ type }: { type: string }) {
  const map: Record<string, { icon: typeof Zap; color: string }> = {
    task_started: { icon: Clock, color: "text-violet-400" },
    task_complete: { icon: CheckCircle2, color: "text-emerald-400" },
    tool_call: { icon: Wrench, color: "text-amber-400" },
    tool_result: { icon: CheckCircle2, color: "text-slate-400" },
    error: { icon: AlertCircle, color: "text-red-400" },
  };
  const config = map[type] || { icon: Zap, color: "text-slate-400" };
  const Icon = config.icon;
  return <Icon className={`h-4 w-4 ${config.color}`} />;
}
