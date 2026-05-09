"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity, Pause, Play, Trash2, Filter, ChevronDown, ChevronRight,
  Cpu, Wrench, Zap, Bot, AlertCircle, CheckCircle2, Clock, ArrowRight,
} from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

interface AuditEvent {
  id: number;
  ts: number;
  source: string;
  type: string;
  detail: string;
  data: Record<string, unknown>;
}

const SOURCE_COLORS: Record<string, { bg: string; text: string; icon: typeof Cpu }> = {
  kernel:       { bg: "bg-violet-900/30 border-violet-700/40", text: "text-violet-400", icon: Cpu },
  engine:       { bg: "bg-violet-900/30 border-violet-700/40", text: "text-violet-400", icon: Cpu },
  llm:          { bg: "bg-blue-900/30 border-blue-700/40", text: "text-blue-400", icon: Zap },
  orchestrator: { bg: "bg-amber-900/30 border-amber-700/40", text: "text-amber-400", icon: Wrench },
  chat:         { bg: "bg-green-900/30 border-green-700/40", text: "text-green-400", icon: CheckCircle2 },
  rag:          { bg: "bg-orange-900/30 border-orange-700/40", text: "text-orange-400", icon: Activity },
  scheduler:    { bg: "bg-cyan-900/30 border-cyan-700/40", text: "text-cyan-400", icon: Clock },
  memory:       { bg: "bg-pink-900/30 border-pink-700/40", text: "text-pink-400", icon: Activity },
  workspace:    { bg: "bg-teal-900/30 border-teal-700/40", text: "text-teal-400", icon: Activity },
  subagent:     { bg: "bg-emerald-900/30 border-emerald-700/40", text: "text-emerald-400", icon: Bot },
  planner:      { bg: "bg-indigo-900/30 border-indigo-700/40", text: "text-indigo-400", icon: ArrowRight },
  ltp:          { bg: "bg-pink-900/30 border-pink-700/40", text: "text-pink-400", icon: ArrowRight },
  sandbox:      { bg: "bg-rose-900/30 border-rose-700/40", text: "text-rose-400", icon: Activity },
  planning:     { bg: "bg-indigo-900/30 border-indigo-700/40", text: "text-indigo-400", icon: ArrowRight },
  validator:    { bg: "bg-cyan-900/30 border-cyan-700/40", text: "text-cyan-400", icon: CheckCircle2 },
};

const DEFAULT_STYLE = { bg: "bg-slate-800 border-slate-700", text: "text-slate-400", icon: Activity };

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function DataView({ data, depth = 0 }: { data: unknown; depth?: number }): React.ReactNode {
  if (data === null || data === undefined) return null;
  if (typeof data === "string") {
    if (data.length > 200) {
      return <pre className="text-xs text-slate-300 bg-slate-950/50 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono">{data}</pre>;
    }
    return <span className="text-emerald-300 font-mono text-xs">&quot;{data}&quot;</span>;
  }
  if (typeof data === "number") return <span className="text-amber-300 font-mono text-xs">{String(data)}</span>;
  if (typeof data === "boolean") return <span className={`font-mono text-xs ${data ? "text-green-400" : "text-red-400"}`}>{String(data)}</span>;
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-slate-500 text-xs font-mono">[]</span>;
    return (
      <div className="ml-3 border-l border-slate-700/50 pl-2">
        {data.map((item: unknown, i: number) => (
          <div key={i} className="flex items-start gap-1 py-0.5">
            <span className="text-slate-600 text-xs shrink-0">{i}:</span>
            <DataView data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined);
    if (entries.length === 0) return <span className="text-slate-500 text-xs font-mono">{"{}"}</span>;
    return (
      <div className={depth > 0 ? "ml-3 border-l border-slate-700/50 pl-2" : ""}>
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start gap-1.5 py-0.5">
            <span className="text-slate-400 text-xs font-semibold shrink-0">{key}:</span>
            <DataView data={value} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-slate-300 text-xs">{String(data)}</span>;
}

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const style = SOURCE_COLORS[event.source] || DEFAULT_STYLE;
  const Icon = style.icon;
  const hasData = event.data && Object.keys(event.data).length > 0;

  const isError = event.type.includes("error") || event.type.includes("failed") || event.data?.success === false;
  const isSuccess = event.type.includes("complete") || event.type.includes("succeed") || event.data?.success === true;

  return (
    <div className={`rounded-lg border ${style.bg} transition-all ${expanded ? "ring-1 ring-white/10" : ""}`}>
      <button
        onClick={() => hasData && setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {hasData ? (
          expanded ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" /> : <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className={`h-3.5 w-3.5 ${style.text} shrink-0`} />
        <span className="text-[10px] text-slate-600 font-mono w-20 shrink-0">{formatTs(event.ts)}</span>
        <span className={`text-[10px] font-semibold uppercase w-20 shrink-0 ${style.text}`}>{event.source}</span>
        <span className="text-xs text-slate-300 font-medium">{event.type}</span>

        {/* Quick info badges */}
        {Boolean(event.data?.caller) && <span className={`text-[10px] px-1.5 py-0.5 rounded ${event.data.caller === "subagent" ? "bg-emerald-900/40 text-emerald-300" : "bg-violet-900/40 text-violet-300"}`}>{String(event.data.caller)}</span>}
        {Boolean(event.data?.tool) && <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono">{String(event.data.tool)}</span>}
        {Boolean(event.data?.model) && <span className="text-[10px] bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded font-mono">{String(event.data.model)}</span>}
        {event.data?.duration_ms != null && <span className="text-[10px] text-slate-500">{String(event.data.duration_ms)}ms</span>}
        {event.data?.tokens_in != null && <span className="text-[10px] text-slate-500">{String(Number(event.data.tokens_in) + Number(event.data.tokens_out || 0))} tok</span>}
        {Boolean(event.data?.step_count) && <span className="text-[10px] bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded">{String(event.data.step_count)} steps</span>}
        {Boolean(event.data?.agent) && <span className="text-[10px] bg-emerald-900/40 text-emerald-300 px-1.5 py-0.5 rounded">{String(event.data.agent)}Agent</span>}

        <div className="ml-auto flex items-center gap-1">
          {isError && <AlertCircle className="h-3 w-3 text-red-400" />}
          {isSuccess && <CheckCircle2 className="h-3 w-3 text-green-400" />}
          <span className="text-[10px] text-slate-600">#{event.id}</span>
        </div>
      </button>

      {expanded && hasData && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5">
          <DataView data={event.data} />
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const endRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // SSE connection
  useEffect(() => {
    if (!live) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const es = new EventSource(`${BASE}/audit/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === "ping" || evt.type === "connected") return;
        setEvents((prev) => [...prev.slice(-499), evt]);
      } catch (_e) { /* ignore */ }
    };

    es.onerror = () => {
      // Reconnect after 3s
      es.close();
      setTimeout(() => {
        if (live) setLive(false);
        setTimeout(() => setLive(true), 100);
      }, 3000);
    };

    return () => es.close();
  }, [live]);

  // Load existing events on mount
  useEffect(() => {
    fetch(`${BASE}/audit/events?limit=500`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, live]);

  const clearEvents = useCallback(async () => {
    await fetch(`${BASE}/audit/events`, { method: "DELETE" }).catch(() => {});
    setEvents([]);
  }, []);

  // Filter events
  const filtered = events.filter((e) => {
    if (sourceFilter && e.source !== sourceFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        e.type.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        JSON.stringify(e.data).toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sources = [...new Set(events.map((e) => e.source))];

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <Activity className={`h-6 w-6 ${live ? "text-green-400 animate-pulse" : "text-slate-500"}`} />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-100">Live Audit</h1>
          <p className="text-xs text-slate-500">
            Real-time event stream from all libraries — {events.length} events
          </p>
        </div>

        {/* Source filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSourceFilter("")}
            className={`text-[10px] px-2 py-1 rounded ${!sourceFilter ? "bg-violet-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            All
          </button>
          {sources.map((s) => {
            const style = SOURCE_COLORS[s] || DEFAULT_STYLE;
            return (
              <button
                key={s}
                onClick={() => setSourceFilter(sourceFilter === s ? "" : s)}
                className={`text-[10px] px-2 py-1 rounded capitalize ${
                  sourceFilter === s ? `${style.bg} ${style.text} font-semibold` : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Text filter */}
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        {/* Controls */}
        <button
          onClick={() => setLive(!live)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
            live
              ? "bg-green-900/40 text-green-400 border border-green-700"
              : "bg-slate-800 text-slate-400 border border-slate-700"
          }`}
        >
          {live ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {live ? "Live" : "Paused"}
        </button>
        <button onClick={clearEvents} className="text-slate-600 hover:text-red-400 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Activity className="h-10 w-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              {live ? "Waiting for events... Try sending a message in Chat." : "No events matching filter."}
            </p>
          </div>
        )}

        {filtered.map((evt) => (
          <EventRow key={evt.id} event={evt} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Stats bar */}
      <div className="shrink-0 flex items-center gap-4 mt-2 px-2 py-1.5 bg-slate-800/50 rounded-lg text-[10px] text-slate-500">
        <span>Total: {events.length}</span>
        {sources.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${(SOURCE_COLORS[s] || DEFAULT_STYLE).text.replace("text-", "bg-")}`} />
            {s}: {events.filter((e) => e.source === s).length}
          </span>
        ))}
        {live && <span className="ml-auto flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> streaming</span>}
      </div>
    </div>
  );
}
