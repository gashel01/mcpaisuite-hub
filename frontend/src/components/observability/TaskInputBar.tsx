"use client";

import { motion } from "framer-motion";
import { Play, Square, RotateCw, Sparkles } from "lucide-react";
import type { StreamStatus } from "@/stores/execution";

interface TaskInputBarProps {
  goal: string;
  setGoal: (goal: string) => void;
  onExecute: () => void;
  onStop: () => void;
  onReset: () => void;
  status: StreamStatus;
  launching: boolean;
}

export default function TaskInputBar({
  goal,
  setGoal,
  onExecute,
  onStop,
  onReset,
  status,
  launching,
}: TaskInputBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && status === "idle") {
      onExecute();
    }
  };

  return (
    <div className="flex gap-1.5 items-center">
      <div className="flex-1 relative group min-w-0">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-violet-400 transition-colors">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What should the agent accomplish?"
          disabled={status === "streaming"}
          className="w-full !py-1.5 !pl-8 !pr-20 text-[12px] sm:text-[13px] !bg-white/[0.02] !border-white/[0.06] focus:!border-violet-500/40 focus:!bg-white/[0.03] placeholder:text-slate-600 !rounded-lg"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 hidden sm:block">
          {status === "idle" ? "Ctrl+Enter" : ""}
        </span>
      </div>

      {status === "idle" ? (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onExecute}
          disabled={!goal.trim() || launching}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white text-[12px] sm:text-[13px] font-medium rounded-lg transition-all shadow-lg shadow-violet-500/10 hover:shadow-violet-500/20 touch-target shrink-0"
        >
          <Play className="h-3.5 w-3.5" />
          <span>{launching ? "..." : "Execute"}</span>
        </motion.button>
      ) : status === "streaming" ? (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onStop}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-red-600/80 to-red-500/80 hover:from-red-500 hover:to-red-400 text-white text-[12px] sm:text-[13px] font-medium rounded-lg transition-all shadow-lg shadow-red-500/10 touch-target shrink-0"
        >
          <Square className="h-3.5 w-3.5" />
          <span>Stop</span>
        </motion.button>
      ) : (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-[12px] sm:text-[13px] font-medium rounded-lg border border-white/[0.06] transition-all touch-target shrink-0"
        >
          <RotateCw className="h-3.5 w-3.5" />
          <span>Reset</span>
        </motion.button>
      )}
    </div>
  );
}
