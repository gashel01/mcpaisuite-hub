"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { JobResult } from "@/types/scheduler";

interface RunHistoryTimelineProps {
  history: JobResult[];
  maxItems?: number;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function RunItem({ result, index }: { result: JobResult; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const content = result.success ? result.output : result.error;
  const isLong = content.length > 100;
  const displayContent = expanded ? content : content.slice(0, 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: "spring", stiffness: 300, damping: 30 }}
      className="flex gap-3"
    >
      {/* Left: dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={`h-2.5 w-2.5 rounded-full shrink-0 mt-1.5 ${
            result.success ? "bg-green-400" : "bg-red-400"
          }`}
        />
        <div className="w-px flex-1 bg-white/[0.06] mt-1" />
      </div>

      {/* Right: content card */}
      <div
        className={`flex-1 rounded-lg border px-3 py-2 mb-2 ${
          result.success
            ? "border-green-500/10 bg-white/[0.015] border-l-2 border-l-green-500/30"
            : "border-red-500/10 bg-red-500/[0.02] border-l-2 border-l-red-500/30"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono text-slate-500">
            {result.run_id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-slate-600">
            {formatRelativeTime(result.started_at)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-400 mb-1">
          <span>{formatDuration(result.duration_ms)}</span>
          <span>{result.tokens_used.toLocaleString()} tok</span>
          <span>${result.cost.toFixed(4)}</span>
        </div>
        {content && (
          <div className="mt-1">
            <p
              className={`text-[11px] break-words ${
                result.success ? "text-slate-400" : "text-red-300/80"
              }`}
            >
              {displayContent}
              {isLong && !expanded && "..."}
            </p>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[10px] text-violet-400 hover:text-violet-300 mt-1 flex items-center gap-0.5"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-2.5 w-2.5" /> Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-2.5 w-2.5" /> More
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function RunHistoryTimeline({
  history,
  maxItems = 20,
}: RunHistoryTimelineProps) {
  if (!history.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-600">
        <Clock className="h-5 w-5 mb-2" />
        <span className="text-xs">No runs yet</span>
      </div>
    );
  }

  const sorted = [...history]
    .sort(
      (a, b) =>
        new Date(b.started_at ?? 0).getTime() -
        new Date(a.started_at ?? 0).getTime()
    )
    .slice(0, maxItems);

  return (
    <div className="max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
      <AnimatePresence>
        {sorted.map((result, i) => (
          <RunItem key={result.run_id} result={result} index={i} />
        ))}
      </AnimatePresence>
    </div>
  );
}
