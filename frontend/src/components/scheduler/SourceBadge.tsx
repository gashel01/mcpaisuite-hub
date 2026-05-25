"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { MessageSquare, Bot, Terminal, GitBranch } from "lucide-react";
import type { ScheduledJob } from "@/types/scheduler";

interface SourceBadgeProps {
  source: ScheduledJob["source"];
  workflowId?: string;
}

function getBadgeConfig(source: ScheduledJob["source"], workflowId?: string) {
  if (workflowId) {
    return {
      icon: GitBranch,
      label: "Workflow",
      color: "text-violet-400",
      border: "border-violet-500/20",
      bg: "bg-violet-500/10",
    };
  }

  switch (source) {
    case "chat":
      return {
        icon: MessageSquare,
        label: "Chat",
        color: "text-blue-400",
        border: "border-blue-500/20",
        bg: "bg-blue-500/10",
      };
    case "taskforce":
    case "agent":
      return {
        icon: Bot,
        label: "Agent",
        color: "text-emerald-400",
        border: "border-emerald-500/20",
        bg: "bg-emerald-500/10",
      };
    case "manual":
    case "scheduler":
    default:
      return {
        icon: Terminal,
        label: "Manual",
        color: "text-slate-400",
        border: "border-slate-500/20",
        bg: "bg-slate-500/10",
      };
  }
}

export default function SourceBadge({ source, workflowId }: SourceBadgeProps) {
  const config = getBadgeConfig(source, workflowId);
  const Icon = config.icon;

  const badge = (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`px-2 py-0.5 rounded-full text-[9px] font-medium border flex items-center gap-1 ${config.color} ${config.border} ${config.bg}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </motion.span>
  );

  if (workflowId) {
    return <Link href="/agents">{badge}</Link>;
  }

  return badge;
}
