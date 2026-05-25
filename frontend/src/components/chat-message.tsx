"use client";

import { Bot, Clock, Zap, DollarSign } from "lucide-react";
import type { ChatMsg } from "@/types";
import { renderMarkdown, CopyButton } from "./markdown";
import { TurnsPanel } from "./turns";

function formatTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatMessage({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex gap-2.5 justify-end animate-msg-user">
        <div className="max-w-[85%] md:max-w-[70%]">
          <div className="bg-violet-900/30 border border-violet-800/40 rounded-2xl rounded-tr-md px-4 py-3 text-sm text-violet-100 whitespace-pre-wrap">
            {msg.content}
          </div>
          {msg.timestamp && (
            <div className="flex justify-end mt-0.5 pr-1">
              <span className="text-[9px] text-slate-700">{formatTime(msg.timestamp)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div className="flex gap-2.5 animate-msg-assistant">
        <div className="h-7 w-7 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-violet-400" />
        </div>
        <div className="max-w-full md:max-w-[85%] min-w-0 space-y-1">
          <div className="group relative text-sm">
            <div className="prose-kernel">{renderMarkdown(msg.content)}</div>
            <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton text={msg.content} />
            </div>
          </div>
          {msg.turns && msg.turns.length > 0 && (
            <TurnsPanel turns={msg.turns} tokens={msg.tokens} cost={msg.cost} bootstrapSources={msg.bootstrapSources} />
          )}
          {/* Metadata: timestamp + tokens + cost */}
          {(msg.timestamp || msg.tokens || msg.cost) && (
            <div className="flex items-center gap-3 mt-1">
              {msg.timestamp && (
                <span className="flex items-center gap-1 text-[9px] text-slate-700">
                  <Clock className="h-2.5 w-2.5" />{formatTime(msg.timestamp)}
                </span>
              )}
              {msg.tokens != null && msg.tokens > 0 && (
                <span className="flex items-center gap-1 text-[9px] text-slate-700">
                  <Zap className="h-2.5 w-2.5" />{msg.tokens.toLocaleString()} tok
                </span>
              )}
              {msg.cost != null && msg.cost > 0 && (
                <span className="flex items-center gap-1 text-[9px] text-slate-700">
                  <DollarSign className="h-2.5 w-2.5" />${msg.cost.toFixed(4)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
