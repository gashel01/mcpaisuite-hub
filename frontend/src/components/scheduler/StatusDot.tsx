"use client";

import { motion } from "framer-motion";
import type { ScheduledJob } from "@/types/scheduler";

interface StatusDotProps {
  status: ScheduledJob["status"];
  size?: "sm" | "md" | "lg";
}

const colorMap: Record<ScheduledJob["status"], string> = {
  active: "bg-green-400",
  paused: "bg-amber-400",
  pending: "bg-blue-400",
  completed: "bg-slate-400",
  failed: "bg-red-400",
  cancelled: "bg-slate-600",
};

const sizeMap: Record<NonNullable<StatusDotProps["size"]>, string> = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
  lg: "h-2.5 w-2.5",
};

export default function StatusDot({ status, size = "md" }: StatusDotProps) {
  const shouldPulse = status === "active" || status === "pending";

  return (
    <motion.div
      className={`rounded-full ${colorMap[status]} ${sizeMap[size]}`}
      animate={
        shouldPulse
          ? { scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }
          : {}
      }
      transition={
        shouldPulse
          ? { repeat: Infinity, duration: status === "pending" ? 2.5 : 1.5 }
          : {}
      }
    />
  );
}
