"use client";

import { useState } from "react";
import { Wrench, AlertCircle, CheckCircle2, Zap, ChevronDown, ChevronRight } from "lucide-react";
import type { Turn } from "@/types";

export function TurnsPanel({ turns, tokens, cost, bootstrapSources }: { turns: Turn[]; tokens?: number; cost?: number; bootstrapSources?: string[] }) {
  const [open, setOpen] = useState(false);
  const toolCalls = turns.filter(t => t.role === "tool_call");
  const systemMsgs = turns.filter(t => t.role === "system" && t.content);
  const hasTools = toolCalls.length > 0;
  const hasBootstrap = bootstrapSources && bootstrapSources.length > 0;

  // Build inline summary of key steps
  const inlineSteps: string[] = [];
  if (hasBootstrap) for (const s of bootstrapSources!) inlineSteps.push(s.split(" ")[0]); // e.g. "query_memory"
  for (const t of turns) {
    if (t.role === "tool_call" && t.tool_name) inlineSteps.push(t.tool_name);
    else if (t.role === "system" && t.content && t.content.startsWith("LLM error")) inlineSteps.push("error");
  }

  return (
    <div className="border border-slate-700/50 rounded-lg overflow-hidden mt-2 bg-slate-800/30">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-300 transition-colors flex-wrap">
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Zap className="h-3 w-3 text-violet-500 shrink-0" />
        {inlineSteps.length > 0 ? (
          <>
            <span className="text-violet-400">{inlineSteps.join(" → ")}</span>
            <span className="text-slate-600">&middot;</span>
          </>
        ) : null}
        <span>{toolCalls.length + (hasBootstrap ? bootstrapSources!.length : 0)} tool{(toolCalls.length + (hasBootstrap ? bootstrapSources!.length : 0)) !== 1 ? "s" : ""} used</span>
        <span className="text-slate-600">&middot;</span>
        <span>{turns.length} steps</span>
        {tokens ? <><span className="text-slate-600">&middot;</span><span>{tokens.toLocaleString()} tokens</span></> : null}
        {cost ? <><span className="text-slate-600">&middot;</span><span>${cost.toFixed(4)}</span></> : null}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-700/50">
          {hasBootstrap && bootstrapSources!.map((src, i) => (
            <div key={`bs-${i}`} className="flex items-start gap-2 text-xs">
              <Wrench className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
              <div className="bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2 w-full">
                <span className="text-cyan-300 font-mono font-medium">{src.split(" ")[0]}</span>
                <span className="text-cyan-400/60 ml-2 text-[10px]">{src}</span>
              </div>
            </div>
          ))}
          {turns.map((turn, i) => <TurnItem key={i} turn={turn} />)}
        </div>
      )}
    </div>
  );
}

export function TurnItem({ turn }: { turn: Turn }) {
  const [expanded, setExpanded] = useState(false);

  if (turn.role === "tool_call" && turn.tool_name) {
    const argsStr = turn.tool_args && Object.keys(turn.tool_args).length > 0 ? JSON.stringify(turn.tool_args, null, 2) : "";
    return (
      <div className="flex items-start gap-2 text-xs">
        <Wrench className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
        <div className="bg-violet-950/30 border border-violet-800/30 rounded-lg px-3 py-2 w-full">
          <span className="text-violet-300 font-mono font-medium">{turn.tool_name}</span>
          {argsStr && (
            <>
              <button onClick={() => setExpanded(!expanded)} className="ml-2 text-violet-500/60 hover:text-violet-400 text-[10px]">{expanded ? "hide" : "show args"}</button>
              {expanded && <pre className="text-violet-400/70 mt-1 text-xs max-h-40 overflow-auto whitespace-pre-wrap">{argsStr}</pre>}
            </>
          )}
        </div>
      </div>
    );
  }
  if (turn.role === "tool_result") {
    const ok = turn.tool_success !== false;
    const content = turn.tool_result || turn.content || "";
    const isLong = content.length > 200;
    return (
      <div className="flex items-start gap-2 text-xs ml-5">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />}
        <div className={`rounded-lg px-3 py-2 w-full text-xs ${ok ? "bg-green-950/20 text-green-300/80" : "bg-red-950/20 text-red-300/80"}`}>
          <pre className="whitespace-pre-wrap max-h-32 overflow-hidden">{expanded || !isLong ? content : content.slice(0, 200) + "..."}</pre>
          {isLong && (
            <button onClick={() => setExpanded(!expanded)} className={`mt-1 text-[10px] ${ok ? "text-green-500/60 hover:text-green-400" : "text-red-500/60 hover:text-red-400"}`}>
              {expanded ? "show less" : `show all (${content.length} chars)`}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (turn.role === "system" && turn.content) {
    return <div className="text-xs text-amber-500/60 italic ml-5 whitespace-pre-wrap">{turn.content}</div>;
  }
  return null;
}
