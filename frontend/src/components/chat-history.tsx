"use client";

import { MessageSquare, SquarePen, PanelLeftClose, Trash2, Loader2, CheckCircle2, XCircle, Clock, Timer, CalendarClock } from "lucide-react";
import type { ConvInfo, TaskInfo, ScheduledJob } from "@/types";

interface ChatHistoryProps {
  conversations: ConvInfo[];
  tasks: TaskInfo[];
  schedules: ScheduledJob[];
  convId: string;
  onSwitchConv: (id: string) => void;
  onNewChat: () => void;
  onDeleteConv: (id: string) => void;
  onSelectTask: (id: string) => void;
  onClose: () => void;
}

export default function ChatHistory({ conversations, tasks, schedules, convId, onSwitchConv, onNewChat, onDeleteConv, onSelectTask, onClose }: ChatHistoryProps) {
  return (
    <div className="hidden md:flex w-56 shrink-0 flex-col border-r border-slate-800/60 bg-[#0e0e15]">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/40">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">History</span>
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
        {/* Conversations */}
        <p className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Chats</p>
        {conversations.length === 0 && (
          <p className="text-[11px] text-slate-600 px-3 py-2 text-center">No conversations yet</p>
        )}
        {conversations.map(c => (
          <div key={c.id} className="group relative">
            <button
              onClick={() => onSwitchConv(c.id)}
              className={`w-full text-left px-3 py-1.5 text-[12px] truncate transition-colors ${c.id === convId ? "bg-violet-600/15 text-violet-300" : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-300"}`}
            >
              <MessageSquare className="h-3 w-3 inline mr-1.5 -mt-0.5" />
              {c.title || (c.id === "default" ? "Default" : c.id)}
              <span className="text-slate-600 ml-1 text-[10px]">{c.messages}</span>
            </button>
            <button
              onClick={() => onDeleteConv(c.id)}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-0.5 transition-all"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {/* Scheduled Jobs */}
        {schedules.length > 0 && (
          <>
            <p className="px-3 pt-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Scheduled</p>
            {schedules.map(j => {
              const isPending = j.run_count === 0;
              const isDone = !isPending && j.status !== "active";
              return (
                <div key={j.id} className="w-full text-left px-3 py-1.5 text-[12px] truncate flex items-center gap-1.5 text-slate-500">
                  {isPending ? (
                    <CalendarClock className="h-3 w-3 text-cyan-400 shrink-0" />
                  ) : isDone ? (
                    <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                  ) : (
                    <Timer className="h-3 w-3 text-amber-400 shrink-0" />
                  )}
                  <span className="truncate flex-1">{j.goal.slice(0, 35)}</span>
                  <span className="text-[9px] text-slate-600 shrink-0">{j.schedule_type}</span>
                </div>
              );
            })}
          </>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (
          <>
            <p className="px-3 pt-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Tasks</p>
            {tasks.slice(0, 15).map(t => (
              <button
                key={t.id}
                onClick={() => onSelectTask(t.id)}
                className="w-full text-left px-3 py-1.5 text-[12px] truncate transition-colors text-slate-500 hover:bg-slate-800/50 hover:text-slate-300 flex items-center gap-1.5"
              >
                {t.status === "running" && <Loader2 className="h-3 w-3 text-violet-400 animate-spin shrink-0" />}
                {t.status === "completed" && <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />}
                {t.status === "failed" && <XCircle className="h-3 w-3 text-red-400 shrink-0" />}
                {!["running", "completed", "failed"].includes(t.status) && <Clock className="h-3 w-3 text-slate-600 shrink-0" />}
                <span className="truncate">{t.goal.replace(/^\[SCHEDULED[^\]]*\]\s*/i, "").slice(0, 40)}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
