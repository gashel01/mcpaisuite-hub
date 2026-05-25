"use client";

import { useState } from "react";
import { Zap, CheckCircle2, AlertCircle, MessageSquare } from "lucide-react";
import type { LiveAgentEvent } from "@/stores/agent-sessions";

export default function AgentEventItem({ evt }: { evt: LiveAgentEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = evt.content.length > 100;
  const displayContent = expanded || !isLong ? evt.content : evt.content.slice(0, 100) + "...";

  const icon = evt.type === "tool_call" ? <Zap className="h-2.5 w-2.5 text-amber-400 shrink-0 mt-0.5" />
    : evt.type === "tool_result" ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 shrink-0 mt-0.5" />
    : evt.type === "error" ? <AlertCircle className="h-2.5 w-2.5 text-red-400 shrink-0 mt-0.5" />
    : <MessageSquare className="h-2.5 w-2.5 text-slate-600 shrink-0 mt-0.5" />;

  const textColor = evt.type === "tool_call" ? "text-amber-300"
    : evt.type === "error" ? "text-red-400"
    : "text-slate-400";

  if (evt.content.startsWith("Tool returned:") || evt.content.includes("do not echo the full output") || evt.content.includes("using ONLY this data")) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 text-[10px] py-0.5">
      {icon}
      <div className="min-w-0 flex-1">
        {evt.type === "tool_call" && evt.toolName && (
          <span className="font-mono text-amber-300 mr-1">{evt.toolName}</span>
        )}
        <span className={`${textColor} ${expanded ? "whitespace-pre-wrap" : ""}`}>{displayContent}</span>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)} className="ml-1 text-[9px] text-violet-400 hover:text-violet-300 transition-colors">
            {expanded ? "less" : "more"}
          </button>
        )}
      </div>
    </div>
  );
}
