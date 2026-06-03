"use client";

import { useState } from "react";
import { Wrench, AlertCircle, CheckCircle2, Zap, ChevronDown, ChevronRight, Play, Pencil, FileCode } from "lucide-react";
import type { Turn } from "@/types";
import { useCodeRunner } from "@/context/code-runner";
import { useTenant } from "@/context/tenant";

const CODE_TOOLS = new Set(["execute_code", "validate_code"]);
const FILE_TOOLS = new Set(["write_file", "edit_file", "read_file"]);

export function TurnsPanel({ turns, tokens, cost, bootstrapSources }: { turns: Turn[]; tokens?: number; cost?: number; bootstrapSources?: (string | { tool: string; summary: string; content?: string })[] }) {
  const [open, setOpen] = useState(false);
  const toolCalls = turns.filter(t => t.role === "tool_call");
  const hasBootstrap = bootstrapSources && bootstrapSources.length > 0;

  const inlineSteps: string[] = [];
  if (hasBootstrap) for (const s of bootstrapSources!) inlineSteps.push(typeof s === "string" ? s.split(" ")[0] : s.tool);
  for (const t of turns) {
    if (t.role === "tool_call" && t.tool_name) inlineSteps.push(t.tool_name);
    else if (t.role === "system" && t.content && t.content.startsWith("LLM error")) inlineSteps.push("error");
  }

  // Build the trace IN ORDER: assistant reasoning, tool call+result pairs, system notes —
  // so the LLM's thinking before each tool call is preserved, not just the tool names.
  // The final assistant turn is the answer (already shown in the message bubble) — skip it.
  let lastAssistantIdx = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "assistant" && (turns[i].content || "").trim()) lastAssistantIdx = i;
  }
  type Item = { kind: "reasoning" | "tool" | "other"; turn: Turn; result?: Turn; key: string };
  const orderedItems: Item[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role === "tool_call") {
      const result = turns[i + 1]?.role === "tool_result" ? turns[i + 1] : undefined;
      orderedItems.push({ kind: "tool", turn: t, result, key: `tc-${i}` });
      if (result) i++; // skip result, already paired
    } else if (t.role === "tool_result") {
      orderedItems.push({ kind: "other", turn: t, key: `ot-${i}` });
    } else if (t.role === "system") {
      orderedItems.push({ kind: "other", turn: t, key: `sy-${i}` });
    } else if (t.role === "assistant" && (t.content || "").trim() && i !== lastAssistantIdx) {
      orderedItems.push({ kind: "reasoning", turn: t, key: `as-${i}` });
    }
  }

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden mt-2 bg-white/[0.015] transition-all hover:border-white/[0.1]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-300 transition-colors flex-wrap">
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Zap className="h-3 w-3 text-violet-500 shrink-0" />
        {inlineSteps.length > 0 && (
          <>
            <span className="text-violet-400">{inlineSteps.join(" → ")}</span>
            <span className="text-slate-600">&middot;</span>
          </>
        )}
        <span>{toolCalls.length + (hasBootstrap ? bootstrapSources!.length : 0)} tool{(toolCalls.length + (hasBootstrap ? bootstrapSources!.length : 0)) !== 1 ? "s" : ""} used</span>
        <span className="text-slate-600">&middot;</span>
        <span>{turns.length} steps</span>
        {tokens ? <><span className="text-slate-600">&middot;</span><span>{tokens.toLocaleString()} tokens</span></> : null}
        {cost ? <><span className="text-slate-600">&middot;</span><span>${cost.toFixed(4)}</span></> : null}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/[0.04] animate-fade-in">
          {hasBootstrap && bootstrapSources!.map((src, i) => (
            <div key={`bs-${i}`} className="animate-stagger" style={{ animationDelay: `${i * 50}ms` }}>
              <BootstrapItem source={src} />
            </div>
          ))}
          {orderedItems.map((item, i) => (
            <div key={item.key} className="animate-stagger" style={{ animationDelay: `${(hasBootstrap ? bootstrapSources!.length : 0) * 50 + i * 30}ms` }}>
              {item.kind === "tool" ? <ToolCallItem call={item.turn} result={item.result} allTurns={turns} />
                : item.kind === "reasoning" ? <ReasoningItem text={item.turn.content || ""} />
                : <OtherTurnItem turn={item.turn} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Paired tool call + result ──────────────────────────────────────────────

function ToolCallItem({ call, result, allTurns }: { call: Turn; result?: Turn; allTurns: Turn[] }) {
  const [expanded, setExpanded] = useState(false);
  const { runInEditor, openEditor } = useCodeRunner();

  const toolName = call.tool_name || "tool";
  const isCodeTool = CODE_TOOLS.has(toolName) || FILE_TOOLS.has(toolName);
  const argsStr = call.tool_args && Object.keys(call.tool_args).length > 0 ? JSON.stringify(call.tool_args, null, 2) : "";
  const resultContent = result?.tool_result || result?.content || "";
  const resultOk = result ? result.tool_success !== false : true;

  // Summarize the result for the collapsed view
  const resultSummary = resultContent.length > 80 ? resultContent.slice(0, 80) + "..." : resultContent;

  // Code info for code tools
  const codeInfo = isCodeTool ? getCodeInfo(call) : null;

  return (
    <div className="text-xs">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 w-full text-left hover:bg-white/[0.02] rounded-lg px-1 py-1 -mx-1 transition-colors">
        <Wrench className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-violet-300 font-mono font-medium">{toolName}</span>
            {result && (resultOk
              ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              : <AlertCircle className="h-3 w-3 text-red-400" />
            )}
            {resultContent && !expanded && (
              <span className="text-slate-600 font-mono text-[10px] truncate max-w-60">{resultSummary}</span>
            )}
          </div>
        </div>
        {(argsStr || resultContent) && (
          <ChevronRight className={`h-3 w-3 text-slate-600 shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </button>

      {expanded && (
        <div className="ml-6 mt-1 space-y-2">
          {/* Args */}
          {argsStr && (
            <div className="bg-violet-500/[0.04] border border-violet-500/10 rounded-lg px-3 py-2">
              <div className="text-[10px] text-violet-400/60 mb-1">Arguments</div>
              {isCodeTool && codeInfo ? (
                <div>
                  <pre className="text-violet-300/80 font-mono text-[11px] max-h-48 overflow-auto whitespace-pre-wrap">{codeInfo.code}</pre>
                  <div className="flex items-center gap-1 mt-2">
                    <button onClick={() => runInEditor(codeInfo.code, codeInfo.language)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/8 border border-emerald-500/15 rounded-md">
                      <Play className="h-2.5 w-2.5" /> Run
                    </button>
                    <button onClick={() => openEditor(codeInfo.code, codeInfo.language)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-slate-400 bg-white/[0.03] border border-white/[0.06] rounded-md">
                      <Pencil className="h-2.5 w-2.5" /> Edit
                    </button>
                  </div>
                </div>
              ) : (
                <pre className="text-violet-300/70 font-mono text-[11px] max-h-40 overflow-auto whitespace-pre-wrap">{argsStr}</pre>
              )}
            </div>
          )}

          {/* Result */}
          {resultContent && (
            <div className={`rounded-lg px-3 py-2 ${resultOk ? "bg-emerald-500/[0.04] border border-emerald-500/10" : "bg-red-500/[0.04] border border-red-500/10"}`}>
              <div className={`text-[10px] mb-1 ${resultOk ? "text-emerald-400/60" : "text-red-400/60"}`}>Result ({resultContent.length} chars)</div>
              <pre className={`font-mono text-[11px] max-h-60 overflow-auto whitespace-pre-wrap ${resultOk ? "text-emerald-300/80" : "text-red-300/80"}`}>{resultContent}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Assistant reasoning (the LLM's thinking before a tool call) ─────────────

function ReasoningItem({ text }: { text: string }) {
  const t = text.trim();
  if (!t) return null;
  return <p className="text-[12px] leading-relaxed text-slate-300/90 whitespace-pre-wrap break-words">{t}</p>;
}

// ── Other turns (system messages, orphan results) ──────────────────────────

function OtherTurnItem({ turn }: { turn: Turn }) {
  if (turn.role === "system" && turn.content) {
    const internal = turn.content.startsWith("Tool returned:") || turn.content.startsWith("TOOL OUTPUT") || turn.content.includes("do not echo the full output") || turn.content.includes("using ONLY this data") || turn.content.includes("do NOT invent");
    if (internal) return null;
    return <div className="text-xs text-amber-500/60 italic ml-5 whitespace-pre-wrap">{turn.content}</div>;
  }
  if (turn.role === "tool_result") {
    const content = turn.tool_result || turn.content || "";
    const ok = turn.tool_success !== false;
    return (
      <div className="flex items-start gap-2 text-xs ml-5">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />}
        <pre className={`font-mono text-[11px] max-h-32 overflow-auto whitespace-pre-wrap ${ok ? "text-emerald-300/70" : "text-red-300/70"}`}>{content.slice(0, 300)}</pre>
      </div>
    );
  }
  return null;
}

// ── Bootstrap source (expandable) ──────────────────────────────────────────

function BootstrapItem({ source }: { source: string | { tool: string; summary: string; content?: string } }) {
  const [expanded, setExpanded] = useState(false);
  const isObj = typeof source !== "string";
  const toolName = isObj ? source.tool : source.split(" ")[0];
  const summary = isObj ? source.summary : source;
  const content = isObj ? source.content : null;

  return (
    <div className="text-xs">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 w-full text-left hover:bg-white/[0.02] rounded-lg px-1 py-1 -mx-1 transition-colors">
        <Wrench className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-cyan-300 font-mono font-medium">{toolName}</span>
          <span className="text-cyan-400/50 text-[10px] truncate">{summary}</span>
        </div>
        {content && <ChevronRight className={`h-3 w-3 text-slate-600 shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />}
      </button>
      {expanded && content && (
        <div className="ml-6 mt-1">
          <div className="bg-cyan-500/[0.04] border border-cyan-500/10 rounded-lg px-3 py-2">
            <div className="text-[10px] text-cyan-400/50 mb-1">Retrieved context</div>
            <pre className="text-cyan-300/70 font-mono text-[11px] max-h-60 overflow-auto whitespace-pre-wrap">{content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Standalone TurnItem for live progress ──────────────────────────────────

export function TurnItem({ turn }: { turn: Turn }) {
  // Assistant reasoning (the text the LLM emits before deciding to call a tool, or its
  // final answer) — persist it in the trace so it doesn't vanish when the turn completes.
  const reasoning = (turn.content || "").trim();
  if (turn.role === "tool_call" && turn.tool_name) {
    return (
      <div className="space-y-1.5">
        {reasoning && (
          <p className="text-[12px] leading-relaxed text-slate-300 whitespace-pre-wrap break-words">{reasoning}</p>
        )}
        <div className="flex items-start gap-2 text-xs">
          <Wrench className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
          <div className="bg-violet-500/[0.05] border border-violet-500/15 rounded-lg px-3 py-2 w-full">
            <span className="text-violet-300 font-mono font-medium">{turn.tool_name}</span>
          </div>
        </div>
      </div>
    );
  }
  if (turn.role === "assistant" && reasoning) {
    return <p className="text-[12px] leading-relaxed text-slate-300 whitespace-pre-wrap break-words">{reasoning}</p>;
  }
  if (turn.role === "tool_result") {
    const ok = turn.tool_success !== false;
    const content = turn.tool_result || turn.content || "";
    return (
      <div className="flex items-start gap-2 text-xs ml-5">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />}
        <pre className={`font-mono text-[11px] max-h-20 overflow-hidden whitespace-pre-wrap ${ok ? "text-emerald-300/70" : "text-red-300/70"}`}>{content.slice(0, 200)}</pre>
      </div>
    );
  }
  if (turn.role === "system" && turn.content) {
    return <div className="text-xs text-amber-500/60 italic ml-5">{turn.content}</div>;
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getCodeInfo(turn: Turn): { code: string; language: string } | null {
  if (!turn.tool_args) return null;
  if (CODE_TOOLS.has(turn.tool_name || "")) {
    return { code: turn.tool_args.code as string || "", language: (turn.tool_args.language as string) || "python" };
  }
  if (FILE_TOOLS.has(turn.tool_name || "")) {
    const content = (turn.tool_args.content as string) || "";
    const path = (turn.tool_args.path as string) || "";
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = { py: "python", js: "node", ts: "node", sh: "shell", bash: "shell" };
    if (content) return { code: content, language: langMap[ext] || "python" };
  }
  return null;
}
