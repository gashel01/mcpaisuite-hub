"use client";

import { X, Play, Zap } from "lucide-react";
import type { TaskInfo } from "@/types";
import { TurnItem } from "./turns";
import { Modal } from "@/components/ui/Modal";

interface TaskModalProps {
  task: TaskInfo;
  onClose: () => void;
}

export default function TaskModal({ task, onClose }: TaskModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      backdropClassName="z-50 bg-black/60"
      className="w-[calc(100%-2rem)] md:w-[700px] max-h-[80vh] bg-[#111118] border border-slate-700/60 rounded-2xl flex flex-col overflow-hidden shadow-2xl"
    >
      {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800/60 shrink-0">
          <Play className="h-4 w-4 text-violet-400" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-100 truncate">{task.goal}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                task.status === "completed" ? "bg-green-900/30 text-green-400" :
                task.status === "failed" ? "bg-red-900/30 text-red-400" :
                task.status === "running" ? "bg-violet-900/30 text-violet-400" :
                "bg-slate-800 text-slate-500"
              }`}>{task.status}</span>
              {task.execution_mode_used === "jit" && (
                <span
                  title="Answered by the Agent-JIT cache — a validated solution pattern was reused instead of full reasoning."
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-300"
                >
                  <Zap className="h-2.5 w-2.5" /> JIT
                </span>
              )}
              {task.total_tokens != null && (
                <span className="text-[10px] text-slate-500">
                  {task.total_tokens?.toLocaleString()} tokens &middot; ${(task.total_cost || 0).toFixed(4)}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {task.turns && task.turns.length > 0 ? (
            task.turns.map((t, i) => <TurnItem key={i} turn={t} />)
          ) : (
            <p className="text-xs text-slate-500 text-center py-8">No turns recorded</p>
          )}
        </div>
    </Modal>
  );
}
