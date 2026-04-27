"use client";

import { User, Bot, Wrench } from "lucide-react";
import type { Turn } from "@/lib/api";

const ROLE_META: Record<
  Turn["role"],
  { icon: typeof User; color: string; label: string }
> = {
  user: { icon: User, color: "text-blue-400", label: "User" },
  assistant: { icon: Bot, color: "text-violet-400", label: "Assistant" },
  tool: { icon: Wrench, color: "text-amber-400", label: "Tool" },
};

export default function TurnViewer({ turn }: { turn: Turn }) {
  const { icon: Icon, color, label } = ROLE_META[turn.role];

  return (
    <div className="rounded-lg border border-[#2a2a3a] bg-[#16161e] p-4">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <Icon size={16} className={color} />
        <span className={`text-sm font-semibold ${color}`}>{label}</span>

        {turn.tool_call && (
          <span className="ml-auto rounded-full bg-violet-600/20 px-2.5 py-0.5 text-xs font-medium text-violet-400">
            {turn.tool_call.name}
          </span>
        )}
      </div>

      {/* Content */}
      {turn.content && (
        <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[#c4c4d8]">
          {turn.content}
        </pre>
      )}

      {/* Tool call arguments */}
      {turn.tool_call && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[#9090a8] hover:text-[#e4e4ef]">
            Arguments
          </summary>
          <pre className="mt-1 overflow-auto rounded bg-[#0f0f14] p-2 text-xs text-[#9090a8]">
            {JSON.stringify(turn.tool_call.arguments, null, 2)}
          </pre>
        </details>
      )}

      {/* Tool result */}
      {turn.tool_result && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-xs text-[#9090a8] hover:text-[#e4e4ef]">
            Result
          </summary>
          <pre className="mt-1 overflow-auto rounded bg-[#0f0f14] p-2 text-xs text-emerald-400/80">
            {turn.tool_result}
          </pre>
        </details>
      )}
    </div>
  );
}
