"use client";

import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Play, CheckCircle2, Wrench, MessageSquare, AlertCircle,
  RotateCw, Zap, ArrowRight, Shield,
} from "lucide-react";
import { useExecutionStore, type StreamEvent, type EventType } from "@/stores/execution";

const EVENT_CONFIG: Record<EventType, { icon: typeof Play; color: string; bg: string }> = {
  task_started:         { icon: Play, color: "text-violet-400", bg: "bg-violet-500/20 border-violet-500/30" },
  task_complete:        { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/20 border-emerald-500/30" },
  turn_started:         { icon: RotateCw, color: "text-blue-400", bg: "bg-blue-500/20 border-blue-500/30" },
  turn_complete:        { icon: CheckCircle2, color: "text-blue-300", bg: "bg-blue-500/10 border-blue-500/20" },
  tool_call:            { icon: Wrench, color: "text-amber-400", bg: "bg-amber-500/20 border-amber-500/30" },
  tool_result:          { icon: MessageSquare, color: "text-slate-300", bg: "bg-slate-700/40 border-slate-600/40" },
  token:                { icon: Zap, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
  error:                { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/20 border-red-500/30" },
  context_bootstrapped: { icon: Shield, color: "text-indigo-400", bg: "bg-indigo-500/20 border-indigo-500/30" },
  plan_enforced:        { icon: ArrowRight, color: "text-pink-400", bg: "bg-pink-500/20 border-pink-500/30" },
  agent_handoff:        { icon: ArrowRight, color: "text-teal-400", bg: "bg-teal-500/20 border-teal-500/30" },
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      + "." + String(d.getMilliseconds()).padStart(3, "0");
  } catch {
    return "—";
  }
}

function TimelineItem({ event, isActive }: { event: StreamEvent; isActive: boolean }) {
  const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.token;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`relative flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
        isActive
          ? `${config.bg} ring-1 ring-violet-500/40`
          : "border-transparent hover:bg-slate-800/30"
      }`}
      onClick={() => useExecutionStore.getState().setActiveEvent(event.id)}
    >
      {/* Connector line */}
      <div className="absolute left-[21px] top-8 bottom-0 w-px bg-slate-700/50" />

      {/* Icon */}
      <motion.div
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${config.bg}`}
        animate={isActive ? { scale: [1, 1.1, 1] } : {}}
        transition={{ repeat: isActive ? Infinity : 0, duration: 2 }}
      >
        <Icon className={`h-3 w-3 ${config.color}`} />
      </motion.div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${config.color}`}>
            {event.type.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-slate-600 font-mono">{formatTime(event.timestamp)}</span>
        </div>
        {event.message && (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{event.message}</p>
        )}
        {event.type === "tool_call" && event.data.tool ? (
          <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-mono bg-amber-500/10 text-amber-300 rounded border border-amber-500/20">
            {String(event.data.tool)}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

export default function Timeline() {
  const { events, activeEventId } = useExecutionStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-800/60">
        <h3 className="text-xs font-medium text-slate-300">Event Stream</h3>
        <span className="text-[10px] text-slate-600">{events.length} events</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {events.map((event) => (
          <TimelineItem
            key={event.id}
            event={event}
            isActive={event.id === activeEventId}
          />
        ))}

        {events.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-600 text-xs">
            Waiting for events...
          </div>
        )}
      </div>
    </div>
  );
}
