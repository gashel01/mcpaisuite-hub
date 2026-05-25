"use client";

import { MessageSquare, SquarePen, PanelLeftClose, Trash2, Loader2 } from "lucide-react";
import type { ConvInfo } from "@/types";

interface ChatHistoryProps {
  conversations: ConvInfo[];
  convId: string;
  runningConvId?: string | null;
  open: boolean;
  onSwitchConv: (id: string) => void;
  onNewChat: () => void;
  onDeleteConv: (id: string) => void;
  onClose: () => void;
}

export default function ChatHistory({ conversations, convId, runningConvId, open, onSwitchConv, onNewChat, onDeleteConv, onClose }: ChatHistoryProps) {
  return (
    <div
      className="hidden md:flex shrink-0 flex-col border-r border-slate-800/60 bg-[#0e0e15] overflow-hidden transition-all duration-300 ease-in-out"
      style={{ width: open ? 224 : 0, opacity: open ? 1 : 0 }}
    >
      <div className="w-56 flex flex-col min-h-0 h-full">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/40 shrink-0">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Chats</span>
          <div className="flex items-center gap-1">
            <button onClick={onNewChat} className="text-slate-500 hover:text-violet-400 p-1 transition-colors" title="New chat">
              <SquarePen className="h-3.5 w-3.5" />
            </button>
            <button onClick={onClose} className="text-slate-600 hover:text-slate-400 p-1 transition-colors" title="Hide">
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {conversations.length === 0 && (
            <p className="text-[11px] text-slate-600 px-3 py-6 text-center">No conversations yet</p>
          )}
          {conversations.map((c, i) => {
            const isActive = c.id === convId;
            const isRunning = c.id === runningConvId;
            return (
              <div key={c.id} className="group relative" style={{ animation: open ? `stagger-in 0.25s ease-out ${i * 30}ms backwards` : "none" }}>
                <button
                  onClick={() => onSwitchConv(c.id)}
                  className={`w-full text-left px-3 py-2 text-[12px] truncate transition-colors flex items-center gap-2 ${isActive ? "bg-violet-600/15 text-violet-300" : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"}`}
                >
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 text-violet-400 animate-spin shrink-0" />
                  ) : (
                    <MessageSquare className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate flex-1">{c.title || (c.id === "default" ? "Default" : c.id)}</span>
                  {c.messages > 0 && <span className="text-[9px] text-slate-700 shrink-0">{c.messages}</span>}
                </button>
                <button
                  onClick={() => onDeleteConv(c.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-0.5 transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
