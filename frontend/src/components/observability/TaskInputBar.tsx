"use client";

import { motion } from "framer-motion";
import { Play, Square, RotateCw } from "lucide-react";
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
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex gap-2 shrink-0"
    >
      <div className="flex-1 relative">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What should the agent accomplish?"
          disabled={status === "streaming"}
          className="w-full !py-2.5 !pl-4 !pr-24 text-sm"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 hidden sm:block">
          {status === "idle" ? "Ctrl+Enter" : ""}
        </span>
      </div>

      {status === "idle" ? (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onExecute}
          disabled={!goal.trim() || launching}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Play className="h-3.5 w-3.5" />
          {launching ? "Launching..." : "Execute"}
        </motion.button>
      ) : status === "streaming" ? (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onStop}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-600/80 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Square className="h-3.5 w-3.5" />
          Stop
        </motion.button>
      ) : (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-sm font-medium rounded-lg border border-white/[0.06] transition-colors"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Reset
        </motion.button>
      )}
    </motion.div>
  );
}
