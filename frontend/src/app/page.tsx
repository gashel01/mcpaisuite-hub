"use client";

import { useCallback, useRef, useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { submitTask, getTask, type TaskStatus } from "@/lib/api";
import TurnViewer from "@/components/turn-viewer";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  running: "bg-violet-500/20 text-violet-400",
  done: "bg-emerald-500/20 text-emerald-400",
  error: "bg-red-500/20 text-red-400",
};

export default function TaskRunner() {
  const [goal, setGoal] = useState("");
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!goal.trim() || loading) return;

      setLoading(true);
      stopPolling();

      try {
        const created = await submitTask(goal.trim());
        setTask(created);

        // Poll for live updates
        pollRef.current = setInterval(async () => {
          try {
            const updated = await getTask(created.id ?? created.task_id ?? "");
            setTask(updated);
            if (updated.status === "completed" || updated.status === "failed" || updated.status === "cancelled" || updated.status === "done" || updated.status === "error") {
              stopPolling();
              setLoading(false);
            }
          } catch {
            stopPolling();
            setLoading(false);
          }
        }, 1000);
      } catch (err) {
        setTask({
          id: "",
          goal,
          status: "error",
          turns: [],
          error: String(err),
        });
        setLoading(false);
      }
    },
    [goal, loading, stopPolling]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Task Runner</h1>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          placeholder="Describe your goal..."
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="flex-1"
        />
        <button
          type="submit"
          disabled={loading || !goal.trim()}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
          Run
        </button>
      </form>

      {/* Status header */}
      {task && (
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_BADGE[task.status] ?? ""
            }`}
          >
            {task.status}
          </span>
          {task.cost && (
            <span className="text-xs text-[#9090a8]">
              ${task.cost.total_cost_usd.toFixed(4)} &middot;{" "}
              {task.cost.total_tokens.toLocaleString()} tokens
            </span>
          )}
          {task.error && (
            <span className="text-xs text-red-400">{task.error}</span>
          )}
        </div>
      )}

      {/* Turn list */}
      <div className="space-y-3">
        {task?.turns.map((turn, i) => (
          <TurnViewer key={i} turn={turn} />
        ))}
      </div>
    </div>
  );
}
