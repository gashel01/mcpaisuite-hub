"use client";

import { Bot } from "lucide-react";
import type { ChatMsg } from "@/types";
import { renderMarkdown, CopyButton } from "./markdown";
import { TurnsPanel } from "./turns";

export default function ChatMessage({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex gap-2.5 justify-end">
        <div className="max-w-[85%] md:max-w-[70%] bg-violet-900/30 border border-violet-800/40 rounded-2xl rounded-tr-md px-4 py-3 text-sm text-violet-100 whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div className="flex gap-2.5">
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
        </div>
      </div>
    );
  }

  return null;
}
