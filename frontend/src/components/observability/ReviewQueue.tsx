"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardList, RefreshCw, Check, Trash2, Star, Tag, MessageSquare,
  Loader2, AlertTriangle, ChevronDown, Zap,
} from "lucide-react";


interface QueueItem {
  id: string;
  task_id: string;
  reason: string;
  priority: number;
  status: string;
  queued_at: string;
  reviewed_at: string | null;
}

interface ReviewStats {
  pending: number;
  reviewed: number;
  label_distribution: Record<string, number>;
}

interface Label {
  id: string;
  label: string;
  color: string;
}

interface Props {
  namespace: string;
  onSelectTask?: (taskId: string) => void;
}

const LABEL_COLORS: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  red: "bg-red-500/10 text-red-400 border-red-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export default function ReviewQueue({ namespace, onSelectTask }: Props) {
  const BASE = getApiUrl();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "reviewed">("pending");
  const [annotating, setAnnotating] = useState<string | null>(null);

  // Annotation form state
  const [rating, setRating] = useState(0);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");

  const th = { "X-Tenant-Id": namespace };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [qRes, sRes, lRes] = await Promise.all([
      fetch(`${BASE}/review/queue?status=${filter}`, { headers: th }).then(r => r.json()).catch(() => ({ items: [] })),
      fetch(`${BASE}/review/stats`, { headers: th }).then(r => r.json()).catch(() => null),
      fetch(`${BASE}/review/labels`, { headers: th }).then(r => r.json()).catch(() => ({ labels: [] })),
    ]);
    setItems(qRes.items || []);
    setStats(sRes);
    setLabels(lRes.labels || []);
    setLoading(false);
  }, [filter, namespace]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const autoQueue = async () => {
    await fetch(`${BASE}/review/auto-queue`, { method: "POST", headers: th });
    fetchAll();
  };

  const markReviewed = async (itemId: string) => {
    await fetch(`${BASE}/review/queue/${itemId}/review`, { method: "POST", headers: th });
    setItems(prev => prev.filter(i => i.id !== itemId && i.task_id !== itemId));
  };

  const removeFromQueue = async (itemId: string) => {
    await fetch(`${BASE}/review/queue/${itemId}`, { method: "DELETE", headers: th });
    setItems(prev => prev.filter(i => i.id !== itemId && i.task_id !== itemId));
  };

  const submitAnnotation = async (taskId: string) => {
    await fetch(`${BASE}/traces/${taskId}/annotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify({
        rating,
        labels: Array.from(selectedLabels),
        feedback,
      }),
    });
    setAnnotating(null);
    setRating(0);
    setSelectedLabels(new Set());
    setFeedback("");
    markReviewed(taskId);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-medium text-slate-300">Review Queue</span>
          {stats && (
            <span className="text-[8px] text-slate-500">
              {stats.pending} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={autoQueue}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] text-amber-400 hover:bg-amber-500/5 rounded transition-colors"
            title="Auto-queue failed & expensive tasks"
          >
            <Zap className="w-2.5 h-2.5" /> Auto
          </button>
          <button onClick={fetchAll} className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className={`w-2.5 h-2.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-white/[0.04]">
        {(["pending", "reviewed"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 text-[9px] rounded transition-colors capitalize ${
              filter === f ? "bg-violet-500/10 text-violet-300" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {f} {f === "pending" && stats ? `(${stats.pending})` : ""}
          </button>
        ))}
      </div>

      {/* Label distribution */}
      {stats && Object.keys(stats.label_distribution).length > 0 && (
        <div className="px-3 py-1.5 border-b border-white/[0.04] flex flex-wrap gap-1">
          {Object.entries(stats.label_distribution).map(([label, count]) => {
            const lbl = labels.find(l => l.id === label);
            const colorCls = LABEL_COLORS[lbl?.color || "slate"] || LABEL_COLORS.slate;
            return (
              <span key={label} className={`text-[8px] px-1.5 py-0.5 rounded border ${colorCls}`}>
                {lbl?.label || label}: {count}
              </span>
            );
          })}
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-slate-500">
            <ClipboardList className="w-5 h-5 text-slate-600 mb-1" />
            <span className="text-[10px]">
              {filter === "pending" ? "No items to review" : "No reviewed items"}
            </span>
            {filter === "pending" && (
              <button onClick={autoQueue} className="mt-2 text-[9px] text-violet-400 hover:text-violet-300">
                Auto-queue from tasks
              </button>
            )}
          </div>
        )}

        <AnimatePresence>
          {items.map(item => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="border-b border-white/[0.03] px-3 py-2 hover:bg-white/[0.01] transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => onSelectTask?.(item.task_id)}
                    className="text-[10px] text-slate-300 hover:text-violet-300 transition-colors truncate block"
                  >
                    {item.task_id.slice(0, 12)}...
                  </button>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[8px] px-1 py-0.5 rounded ${
                      item.reason === "failed" ? "bg-red-500/10 text-red-400" :
                      item.reason.startsWith("expensive") ? "bg-amber-500/10 text-amber-400" :
                      "bg-slate-500/10 text-slate-400"
                    }`}>
                      {item.reason}
                    </span>
                    {item.priority > 0 && (
                      <span className="text-[8px] text-slate-500">P{item.priority}</span>
                    )}
                  </div>
                </div>

                {filter === "pending" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setAnnotating(annotating === item.task_id ? null : item.task_id)}
                      className="p-1 text-violet-400/60 hover:text-violet-400 transition-colors"
                      title="Annotate"
                    >
                      <Tag className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => markReviewed(item.task_id)}
                      className="p-1 text-emerald-400/60 hover:text-emerald-400 transition-colors"
                      title="Mark reviewed"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="p-1 text-slate-500/60 hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Inline annotation form */}
              <AnimatePresence>
                {annotating === item.task_id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-2 overflow-hidden"
                  >
                    <div className="bg-white/[0.02] rounded-md p-2 space-y-2 border border-white/[0.04]">
                      {/* Rating */}
                      <div className="flex items-center gap-1">
                        <span className="text-[8px] text-slate-500 w-10">Rating</span>
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            onClick={() => setRating(n)}
                            className={`p-0.5 transition-colors ${n <= rating ? "text-amber-400" : "text-slate-600"}`}
                          >
                            <Star className="w-3 h-3" fill={n <= rating ? "currentColor" : "none"} />
                          </button>
                        ))}
                      </div>

                      {/* Labels */}
                      <div className="flex flex-wrap gap-1">
                        {labels.map(l => {
                          const colorCls = LABEL_COLORS[l.color] || LABEL_COLORS.slate;
                          const active = selectedLabels.has(l.id);
                          return (
                            <button
                              key={l.id}
                              onClick={() => setSelectedLabels(prev => {
                                const next = new Set(prev);
                                if (next.has(l.id)) next.delete(l.id);
                                else next.add(l.id);
                                return next;
                              })}
                              className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${
                                active ? colorCls : "border-white/[0.04] text-slate-500"
                              }`}
                            >
                              {l.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Feedback */}
                      <input
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        placeholder="Optional feedback..."
                        className="w-full bg-white/[0.02] border border-white/[0.04] rounded px-2 py-1 text-[9px] text-slate-300 placeholder:text-slate-600 outline-none"
                      />

                      <button
                        onClick={() => submitAnnotation(item.task_id)}
                        className="w-full px-2 py-1 text-[9px] bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 rounded transition-colors font-medium"
                      >
                        Submit & Mark Reviewed
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
