"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";

interface ReplayState {
  turn_index: number;
  total_turns: number;
  total_tokens: number;
  total_cost: number;
  tool_calls: string[];
  tool_results: { tool: string; success: boolean }[];
  last_content: string;
  status: string;
}
interface TimelineEvent {
  index: number;
  role?: string;
  content?: string;
  tool_call?: { tool: string; arguments: unknown };
  tool_result?: { success: boolean; output: string };
}
interface ReplayData {
  task_id: string;
  goal: string;
  total_turns: number;
  timeline: TimelineEvent[];
  states: ReplayState[];
}

/**
 * Time-travel debugging: step through a finished run and inspect the accumulated
 * state at each turn. Data comes from the backend /tasks/{id}/replay endpoint,
 * which reuses kernelmcp's ReplayEngine (single source of truth for step state).
 */
export default function TimeTravelPanel({ taskId, namespace }: { taskId: string; namespace: string }) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!taskId) { setData(null); return; }
    setLoading(true);
    apiFetch<ReplayData>(`/tasks/${encodeURIComponent(taskId)}/replay`, { tenant: namespace })
      .then((d) => { setData(d); setIdx(Math.max(0, (d.total_turns || 1) - 1)); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [taskId, namespace]);

  useEffect(() => { load(); }, [load]);

  if (!taskId) return <div className="p-4 text-xs text-slate-500">Select a run to step through it.</div>;
  if (loading) return <div className="p-4 text-xs text-slate-500">Loading replay…</div>;
  if (!data || data.total_turns === 0) return <div className="p-4 text-xs text-slate-500">No steps recorded for this run.</div>;

  const state = data.states[idx];
  const ev = data.timeline[idx];
  const last = data.total_turns - 1;

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4 space-y-3">
      {/* Scrubber */}
      <div className="flex items-center gap-2">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx <= 0}
          className="px-2 py-1 text-xs rounded-md bg-white/[0.04] text-slate-300 disabled:opacity-30 hover:bg-white/[0.08]">←</button>
        <input
          type="range" min={0} max={last} value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="flex-1 accent-violet-500"
        />
        <button onClick={() => setIdx((i) => Math.min(last, i + 1))} disabled={idx >= last}
          className="px-2 py-1 text-xs rounded-md bg-white/[0.04] text-slate-300 disabled:opacity-30 hover:bg-white/[0.08]">→</button>
        <span className="text-[11px] text-slate-400 font-mono shrink-0">step {idx + 1}/{data.total_turns}</span>
      </div>

      {/* Step event */}
      {ev && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{ev.role || "step"}</div>
          {ev.tool_call && (
            <div className="text-xs text-violet-300 font-mono break-all">
              {ev.tool_call.tool}({JSON.stringify(ev.tool_call.arguments)})
            </div>
          )}
          {ev.tool_result && (
            <div className={`text-xs font-mono break-all ${ev.tool_result.success ? "text-emerald-300" : "text-red-300"}`}>
              {ev.tool_result.success ? "✓" : "✗"} {ev.tool_result.output}
            </div>
          )}
          {ev.content && <div className="text-xs text-slate-300 whitespace-pre-wrap">{ev.content}</div>}
        </div>
      )}

      {/* Accumulated state at this step */}
      {state && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">State at this step</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><div className="text-slate-500 text-[10px]">Tokens</div><div className="text-slate-200 font-mono">{state.total_tokens.toLocaleString()}</div></div>
            <div><div className="text-slate-500 text-[10px]">Cost</div><div className="text-slate-200 font-mono">${state.total_cost.toFixed(4)}</div></div>
            <div><div className="text-slate-500 text-[10px]">Status</div><div className="text-slate-200">{state.status}</div></div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px] mb-1">Tools called so far ({state.tool_calls.length})</div>
            <div className="flex flex-wrap gap-1">
              {state.tool_calls.length === 0 && <span className="text-[11px] text-slate-600">none yet</span>}
              {state.tool_calls.map((t, i) => (
                <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300">{t}</span>
              ))}
            </div>
          </div>
          {state.last_content && (
            <div>
              <div className="text-slate-500 text-[10px] mb-1">Last text</div>
              <div className="text-[11px] text-slate-300 whitespace-pre-wrap line-clamp-4">{state.last_content}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
