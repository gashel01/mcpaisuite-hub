"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pause,
  Play,
  XCircle,
  Zap,
  RotateCcw,
  Check,
} from "lucide-react";
import type { ScheduledJob } from "@/types/scheduler";
import { Spinner } from "@/components/ui/Spinner";

interface QuickActionsProps {
  job: ScheduledJob;
  onAction: (jobId: string, action: string) => Promise<void>;
}

interface ActionDef {
  action: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  confirmColor: string;
}

function getActions(status: ScheduledJob["status"]): ActionDef[] {
  switch (status) {
    case "active":
    case "pending":
      return [
        {
          action: "pause",
          label: "Pause",
          icon: Pause,
          color: "text-amber-400 border-amber-500/20 bg-amber-500/10",
          confirmColor: "text-amber-300 border-amber-500/40 bg-amber-500/20",
        },
        {
          action: "trigger",
          label: "Trigger Now",
          icon: Zap,
          color: "text-blue-400 border-blue-500/20 bg-blue-500/10",
          confirmColor: "text-blue-300 border-blue-500/40 bg-blue-500/20",
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: XCircle,
          color: "text-red-400 border-red-500/20 bg-red-500/10",
          confirmColor: "text-red-300 border-red-500/40 bg-red-500/20",
        },
      ];
    case "paused":
      return [
        {
          action: "resume",
          label: "Resume",
          icon: Play,
          color: "text-green-400 border-green-500/20 bg-green-500/10",
          confirmColor: "text-green-300 border-green-500/40 bg-green-500/20",
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: XCircle,
          color: "text-red-400 border-red-500/20 bg-red-500/10",
          confirmColor: "text-red-300 border-red-500/40 bg-red-500/20",
        },
      ];
    case "failed":
      return [
        {
          action: "retry",
          label: "Retry",
          icon: RotateCcw,
          color: "text-violet-400 border-violet-500/20 bg-violet-500/10",
          confirmColor: "text-violet-300 border-violet-500/40 bg-violet-500/20",
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: XCircle,
          color: "text-red-400 border-red-500/20 bg-red-500/10",
          confirmColor: "text-red-300 border-red-500/40 bg-red-500/20",
        },
      ];
    default:
      return [];
  }
}

function ActionButton({
  def,
  jobId,
  onAction,
}: {
  def: ActionDef;
  jobId: string;
  onAction: (jobId: string, action: string) => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "confirm" | "loading" | "done">("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(async () => {
    if (state === "idle") {
      setState("confirm");
      timeoutRef.current = setTimeout(() => {
        setState("idle");
      }, 3000);
    } else if (state === "confirm") {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setState("loading");
      try {
        await onAction(jobId, def.action);
        setState("done");
        setTimeout(() => setState("idle"), 1200);
      } catch {
        setState("idle");
      }
    }
  }, [state, jobId, def.action, onAction]);

  const Icon = def.icon;
  const isConfirm = state === "confirm";
  const isLoading = state === "loading";
  const isDone = state === "done";

  return (
    <motion.button
      layout
      onClick={handleClick}
      disabled={isLoading}
      className={`relative overflow-hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        isConfirm ? def.confirmColor : def.color
      }`}
    >
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.span
            key="loading"
            initial={{ scale: 0 }}
            animate={{ scale: 1, rotate: 360 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <Spinner className="h-3.5 w-3.5" />
          </motion.span>
        ) : isDone ? (
          <motion.span
            key="done"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <Check className="h-3.5 w-3.5 text-green-400" />
          </motion.span>
        ) : (
          <motion.span
            key="icon"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <Icon className="h-3.5 w-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
      <span>{isConfirm ? "Confirm?" : def.label}</span>

      {/* Timeout bar */}
      {isConfirm && (
        <motion.div
          className="absolute bottom-0 left-0 h-0.5 bg-white/20"
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 3, ease: "linear" }}
        />
      )}
    </motion.button>
  );
}

export default function QuickActions({ job, onAction }: QuickActionsProps) {
  const actions = getActions(job.status);

  if (actions.length === 0) {
    return (
      <div className="flex items-center justify-center py-2">
        <span className="text-[11px] text-slate-600">Job finished</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {actions.map((def) => (
        <ActionButton key={def.action} def={def} jobId={job.id} onAction={onAction} />
      ))}
    </div>
  );
}
