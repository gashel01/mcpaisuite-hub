"use client";

import { useState } from "react";
import {
  Bot, Play, Loader2, CheckCircle2, XCircle, Zap, DollarSign,
  RotateCw, Activity, ChevronRight, ChevronDown, X, Clock,
  AlertCircle, MessageSquare, ArrowRight, Download, Plus, Save, Maximize2,
} from "lucide-react";
import Link from "next/link";
import CopyButton from "@/components/copy-button";
import { renderMarkdown } from "@/components/markdown";
import { BASE_URL, AGENT_META } from "./constants";
import type { TeamAgent, LiveAgentEvent, AgentSession } from "@/stores/agent-sessions";

// Lazy import to avoid circular deps
let HumanGateActions: any = null;

interface OutputPanelProps {
  session: AgentSession;
  agents: TeamAgent[];
  isRunning: boolean;
  isDone: boolean;
  isConfiguring: boolean;
  isWaiting: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  tenant: string;
  th: Record<string, string>;
  store: any;
  showEval: boolean;
  setShowEval: (v: boolean) => void;
  HumanGateActionsComponent?: any;
  mobile?: boolean;
}

export default function OutputPanel({
  session, agents, isRunning, isDone, isConfiguring, isWaiting,
  open, setOpen, tenant, th, store, showEval, setShowEval, HumanGateActionsComponent,
  mobile = false,
}: OutputPanelProps) {
  const [traceOpen, setTraceOpen] = useState(true);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  HumanGateActions = HumanGateActionsComponent;

  return (
    <div className={`min-h-0 relative ${mobile ? "flex-1 w-full" : "transition-all duration-300 ease-in-out shrink-0"}`}
      style={mobile ? undefined : { width: open ? "42%" : 48 }}>

      {/* Collapsed state (desktop only) */}
      {!mobile && (
        <button onClick={() => setOpen(true)}
          className={`absolute inset-0 w-12 h-full flex flex-col items-center gap-2 py-3 rounded-xl border border-white/[0.06] bg-white/[0.015] text-slate-400 hover:text-slate-200 hover:border-violet-500/20 transition-all duration-300 ${open ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
          {isRunning ? <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" /> : isDone ? (
            session.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />
          ) : <Activity className="h-3.5 w-3.5" />}
          <span className="text-[9px] font-medium [writing-mode:vertical-lr] rotate-180">{isRunning ? "Live" : isDone ? "Result" : "Output"}</span>
          {session.liveEvents.length > 0 && <span className="text-[8px] text-violet-400">{session.liveEvents.length}</span>}
        </button>
      )}

      {/* Expanded state */}
      <div className={`rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col h-full ${mobile ? "" : "transition-opacity duration-300"} ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {/* Header */}
        <div className="px-3 py-2 border-b border-white/[0.04] flex items-center gap-2 shrink-0">
          {isRunning && <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />}
          {session.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          {session.status === "failed" && <XCircle className="h-3.5 w-3.5 text-red-400" />}
          {isConfiguring && <Activity className="h-3.5 w-3.5 text-slate-600" />}
          <span className="text-[11px] font-semibold text-slate-300">
            {isRunning ? "Running..." : isDone ? (session.status === "completed" ? "Completed" : "Failed") : "Output"}
          </span>
          {session.metrics && (
            <div className="flex items-center gap-2 text-[9px] text-slate-600">
              <span>{session.metrics.turns} turns</span>
              <span>{session.metrics.tokens.toLocaleString()} tok</span>
              <span>{(session.metrics.duration / 1000).toFixed(1)}s</span>
              {session.metrics.cost > 0 && <span>${session.metrics.cost.toFixed(4)}</span>}
            </div>
          )}
          {session.liveEvents.length > 0 && (
            <span className="text-[10px] text-slate-500 ml-auto">{session.liveEvents.length} events</span>
          )}
          <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-300 p-0.5 transition-colors hidden lg:block ml-auto">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Empty state */}
          {isConfiguring && session.liveEvents.length === 0 && !session.answer && (
            <div className="flex flex-col items-center justify-center flex-1 text-center animate-fade-in p-4">
              <div className="h-12 w-12 rounded-2xl bg-violet-500/8 border border-violet-500/15 flex items-center justify-center mb-3 animate-glow">
                <Bot className="h-6 w-6 text-violet-500/30" />
              </div>
              <p className="text-[11px] text-slate-500 mb-1">Configure your agents and hit Run</p>
              <p className="text-[10px] text-slate-700">Results and execution trace will appear here</p>
            </div>
          )}

          {/* Live token stream (typewriter) — assistant text as it's generated */}
          {isRunning && session.streamingText && (
            <div className="shrink-0 border-b border-white/[0.04] max-h-[45%] overflow-y-auto px-4 py-3 animate-fade-in">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Loader2 className="h-3 w-3 text-violet-400 animate-spin" />
                <span className="text-[10px] font-medium text-violet-300">Streaming&hellip;</span>
              </div>
              <p className="text-[12px] leading-relaxed text-slate-300 whitespace-pre-wrap break-words">
                {session.streamingText}
                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-violet-400 align-middle animate-pulse" />
              </p>
            </div>
          )}

          {/* Output section (top) */}
          {isDone && session.answer && (
            <div className="shrink-0 border-b border-white/[0.04] max-h-[50%] overflow-y-auto animate-fade-in">
              <OutputResult session={session} store={store} th={th} />
            </div>
          )}

          {/* Trace section (bottom, collapsible) */}
          {(isRunning || isDone) && session.liveEvents.length > 0 && (
            <div className={`flex flex-col transition-all duration-300 ${traceOpen ? "flex-1 min-h-0" : ""}`}>
              <button onClick={() => setTraceOpen(!traceOpen)} className="flex items-center gap-2 px-4 py-2 text-[10px] text-slate-400 hover:text-slate-300 transition-colors shrink-0 border-b border-white/[0.04]">
                <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${traceOpen ? "rotate-90" : ""}`} />
                <span className="font-medium">Trace</span>
                <span className="text-slate-600">{session.liveEvents.length} events</span>
                {isRunning && <Loader2 className="h-2.5 w-2.5 text-violet-400 animate-spin ml-auto" />}
              </button>
              {traceOpen && (
                <div className="flex-1 min-h-0 overflow-y-auto animate-fade-in">
                  <TraceView session={session} agents={agents} isDone={isDone} isWaiting={isWaiting} tenant={tenant} th={th} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer metrics + links */}
        {isDone && session.metrics && (
          <div className="border-t border-white/[0.04] shrink-0">
            <div className="flex items-center gap-3 px-4 py-2 text-[9px] text-slate-500">
              <span className="flex items-center gap-1"><RotateCw className="h-2.5 w-2.5" />{session.metrics.turns}</span>
              <span className="flex items-center gap-1"><Zap className="h-2.5 w-2.5" />{session.metrics.tokens}</span>
              <span className="flex items-center gap-1"><DollarSign className="h-2.5 w-2.5" />${session.metrics.cost.toFixed(4)}</span>
              <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{(session.metrics.duration / 1000).toFixed(1)}s</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-t border-white/[0.04]">
              <Link href={`/chat${session.convId ? `?conv=${encodeURIComponent(session.convId)}` : ""}`} className="text-[10px] text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-3 py-1.5 rounded-lg transition-all">
                Chat &rarr;
              </Link>
              <Link href={`/observability${session.taskId ? `?task=${session.taskId}` : ""}`} className="text-[10px] text-slate-400 hover:text-slate-300 bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 rounded-lg transition-all flex items-center gap-1">
                <Activity className="h-2.5 w-2.5" /> Observability
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Output Result sub-component ──────────────────────────────────────────

function OutputResult({ session, store, th }: { session: AgentSession; store: any; th: Record<string, string> }) {
  const [view, setView] = useState<"md" | "raw">("md");
  const [expanded, setExpanded] = useState(false);
  const answer = session.answer || "";
  const download = () => {
    const blob = new Blob([answer], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(session.config.goal || "output").slice(0, 40).replace(/[^a-z0-9]+/gi, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const ViewToggle = () => (
    <div className="flex rounded-md bg-white/[0.03] border border-white/[0.06] p-0.5 text-[9px] font-medium">
      <button onClick={() => setView("md")} className={`px-1.5 py-0.5 rounded ${view === "md" ? "bg-violet-500/20 text-violet-300" : "text-slate-500 hover:text-slate-300"}`}>Markdown</button>
      <button onClick={() => setView("raw")} className={`px-1.5 py-0.5 rounded ${view === "raw" ? "bg-violet-500/20 text-violet-300" : "text-slate-500 hover:text-slate-300"}`}>Raw</button>
    </div>
  );
  const Body = ({ max }: { max: string }) => (
    view === "raw"
      ? <pre className={`px-4 py-3 text-[12px] text-slate-300 whitespace-pre-wrap break-words font-mono ${max} overflow-y-auto`}>{answer}</pre>
      : <div className={`px-4 py-3 prose-kernel text-sm ${max} overflow-y-auto`}>{renderMarkdown(answer)}</div>
  );
  return (
    <div className="p-4 space-y-3">
      {/* Full-screen report */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setExpanded(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold text-slate-200">Report</span>
              <div className="ml-auto flex items-center gap-1.5">
                <ViewToggle />
                <button onClick={download} title="Download .md" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]"><Download className="h-3.5 w-3.5" /></button>
                <CopyButton text={answer} />
                <button onClick={() => setExpanded(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]"><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="flex-1 min-h-0"><Body max="max-h-[calc(85vh-3.5rem)]" /></div>
          </div>
        </div>
      )}
      {session.status === "failed" ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="h-3.5 w-3.5 text-red-400" />
            <span className="text-[11px] font-semibold text-red-400">Failed</span>
            <div className="ml-auto"><CopyButton text={session.answer || ""} /></div>
          </div>
          <p className="text-[12px] text-red-300/80">{session.answer}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.04] bg-white/[0.01]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-emerald-400">Output</span>
            <div className="ml-auto flex items-center gap-1.5">
              <ViewToggle />
              <button onClick={download} title="Download .md" className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]"><Download className="h-3 w-3" /></button>
              <button onClick={() => setExpanded(true)} title="Expand" className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]"><Maximize2 className="h-3 w-3" /></button>
              <CopyButton text={answer} />
            </div>
          </div>
          <Body max="max-h-[300px]" />
          {/* Feedback */}
          {session.status === "completed" && (
            <div className="px-4 py-2.5 border-t border-white/[0.04] flex items-center gap-2">
              <span className="text-[10px] text-slate-500">Rate:</span>
              <button onClick={() => {
                store.setFeedback(session.id, "good");
                fetch(`${BASE_URL}/runs/${session.runId || session.taskId || session.id}/feedback`, {
                  method: "POST", headers: { "Content-Type": "application/json", ...th },
                  body: JSON.stringify({ rating: "good", goal: session.config.goal, output: session.answer?.slice(0, 500) }),
                }).catch(() => {});
              }} className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all ${session.feedback?.rating === "good" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-emerald-400"}`}>
                👍
              </button>
              <button onClick={() => {
                store.setFeedback(session.id, "bad");
                fetch(`${BASE_URL}/runs/${session.runId || session.taskId || session.id}/feedback`, {
                  method: "POST", headers: { "Content-Type": "application/json", ...th },
                  body: JSON.stringify({ rating: "bad", goal: session.config.goal, output: session.answer?.slice(0, 500) }),
                }).catch(() => {});
              }} className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all ${session.feedback?.rating === "bad" ? "bg-red-500/15 text-red-400 border border-red-500/25" : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-red-400"}`}>
                👎
              </button>
              {session.feedback?.rating && (
                <input placeholder="Comment..." defaultValue={session.feedback?.comment || ""}
                  onBlur={e => {
                    if (session.feedback) {
                      store.setFeedback(session.id, session.feedback.rating!, e.target.value);
                      fetch(`${BASE_URL}/runs/${session.runId || session.taskId || session.id}/feedback`, {
                        method: "POST", headers: { "Content-Type": "application/json", ...th },
                        body: JSON.stringify({ rating: session.feedback.rating, comment: e.target.value, goal: session.config.goal }),
                      }).catch(() => {});
                    }
                  }}
                  className="flex-1 !py-1 !px-2 !text-[10px] !bg-white/[0.02] !border-white/[0.04] ml-1" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trace View sub-component ─────────────────────────────────────────────

function TraceView({ session, agents, isDone, isWaiting, tenant, th }: {
  session: AgentSession; agents: TeamAgent[]; isDone: boolean; isWaiting: boolean; tenant: string; th: Record<string, string>;
}) {
  // Build path
  const pathParts: string[] = ["Trigger"];
  let lastAgent = "";
  session.liveEvents.forEach(evt => {
    const label = evt.agentRole || agents[evt.agentIndex]?.role || agents[evt.agentIndex]?.type || "";
    if (label && label !== lastAgent && (evt.type === "thinking" || evt.type === "message")) {
      pathParts.push(label);
      lastAgent = label;
    }
  });
  pathParts.push("End");

  return (
    <div className="p-4 space-y-0">
      {/* Trigger */}
      <div className="flex items-center gap-2 pb-2">
        <div className="h-5 w-5 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Play className="h-2.5 w-2.5 text-violet-400" />
        </div>
        <span className="text-[10px] font-semibold text-violet-300">Manual Run</span>
        <span className="text-[9px] text-slate-600 ml-auto">{session.metrics && `${session.metrics.turns} turns · ${session.metrics.tokens} tok · ${(session.metrics.duration / 1000).toFixed(1)}s`}</span>
      </div>

      {/* Events */}
      {session.liveEvents.map((evt, i) => {
        if (evt.agentIndex === -1) {
          return <SystemEvent key={i} evt={evt} i={i} session={session} isWaiting={isWaiting} tenant={tenant} th={th} />;
        }
        return <AgentEvent key={i} evt={evt} i={i} agents={agents} session={session} />;
      })}

      {/* End marker */}
      <div className="flex items-center gap-2 pt-2 mt-1">
        <div className="w-px h-3 bg-white/[0.06] ml-2.5" />
      </div>
      {isDone ? (
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
          </div>
          <span className="text-[10px] font-semibold text-emerald-400">End</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
            <Loader2 className="h-2.5 w-2.5 text-violet-400 animate-spin" />
          </div>
          <span className="text-[10px] font-semibold text-violet-400 animate-pulse">Running...</span>
        </div>
      )}

      {/* Path */}
      {isDone && (
        <div className="mt-3 pt-3 border-t border-white/[0.04]">
          <div className="text-[9px] text-slate-500 mb-1">Path</div>
          <div className="flex items-center gap-1 flex-wrap text-[9px]">
            {pathParts.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-700">→</span>}
                <span className={`px-1.5 py-0.5 rounded ${i === 0 ? "bg-violet-500/10 text-violet-300" : i === pathParts.length - 1 ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[0.03] text-slate-400"}`}>{p}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── System Event ─────────────────────────────────────────────────────────

function SystemEvent({ evt, i, session, isWaiting, tenant, th }: {
  evt: LiveAgentEvent; i: number; session: AgentSession; isWaiting: boolean; tenant: string; th: Record<string, string>;
}) {
  const isWave = evt.content.includes("wave");
  const isCondition = evt.type === "condition";
  const isSkipped = evt.type === "skipped";
  const isHumanGate = evt.type === "human_gate";

  return (
    <div className={`flex items-center gap-2 py-1.5 ${isWave ? "mt-2" : "mt-1"}`}>
      {isWave ? (
        <>
          <div className="flex-1 border-t border-dashed border-white/[0.08]" />
          <span className="text-[9px] text-slate-500 px-2 shrink-0">{evt.content}</span>
          <div className="flex-1 border-t border-dashed border-white/[0.08]" />
        </>
      ) : isCondition ? (
        <div className="flex items-center gap-2 ml-7 text-[10px]">
          <div className="h-4 w-4 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-[8px] text-amber-400">?</div>
          <span className="text-amber-300">{evt.content}</span>
        </div>
      ) : isSkipped ? (
        <div className="flex items-center gap-2 ml-7 text-[10px]">
          <div className="h-4 w-4 rounded bg-slate-500/10 border border-slate-500/20 flex items-center justify-center text-[8px] text-slate-600">⊘</div>
          <span className="text-slate-600 italic">{evt.content}</span>
        </div>
      ) : isHumanGate ? (
        <div className="ml-7 text-[10px]">
          <div className="flex items-center gap-2">
            <div className={`h-4 w-4 rounded flex items-center justify-center text-[8px] ${evt.content.includes("approved") ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : evt.content.includes("rejected") ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-blue-500/10 border border-blue-500/20 text-blue-400"}`}>
              {evt.content.includes("approved") ? "✓" : evt.content.includes("rejected") ? "✗" : "⏸"}
            </div>
            <span className={evt.content.includes("approved") ? "text-emerald-400" : evt.content.includes("rejected") ? "text-red-400" : "text-blue-400"}>
              {evt.content.includes("---") ? evt.content.split("\n---")[0] : evt.content}
            </span>
          </div>
          {HumanGateActions && (() => {
            if (!isWaiting || !session.taskId || !evt.nodeId) return null;
            if (evt.content.includes("approved") || evt.content.includes("denied") || evt.content.includes("Revision")) return null;
            const laterReview = session.liveEvents.slice(i + 1).some(e => e.type === "human_gate" && e.nodeId === evt.nodeId);
            if (laterReview) return null;
            return <HumanGateActions taskId={session.taskId} nodeId={evt.nodeId} tenant={tenant} hasFeedback={evt.hasFeedback}
              currentOutput={evt.content.includes("---") ? evt.content.split("---\n").slice(1).join("---\n").trim() : undefined} />;
          })()}
        </div>
      ) : (
        <span className="text-[9px] text-slate-600 ml-7">{evt.content}</span>
      )}
    </div>
  );
}

// ── Agent Event ──────────────────────────────────────────────────────────

function AgentEvent({ evt, i, agents, session }: {
  evt: LiveAgentEvent; i: number; agents: TeamAgent[]; session: AgentSession;
}) {
  const agent = agents[evt.agentIndex];
  const meta = agent ? (AGENT_META[agent.type] || { color: "#64748b" }) : { color: "#64748b" };
  const agentLabel = evt.agentRole || agent?.role || agent?.type || evt.agentType || "";
  const prevEvt = i > 0 ? session.liveEvents[i - 1] : null;
  const isNewAgent = !prevEvt || prevEvt.agentIndex === -1 || evt.agentIndex !== prevEvt.agentIndex || (evt.type === "thinking" && (evt.content.includes("started") || evt.content.includes("Self-refine") || evt.content.includes("Round")));
  const isSelfRefine = evt.type === "thinking" && evt.content.includes("Self-refine");
  const isMessage = evt.type === "message";
  const isError = evt.type === "error";

  return (
    <div>
      {isNewAgent && agentLabel && (
        <>
          <div className="flex items-center gap-2 py-1.5 mt-1"><div className="w-px h-3 bg-white/[0.06] ml-2.5" /></div>
          <div className="flex items-center gap-2 pb-1">
            <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${isSelfRefine ? "border-2 border-dashed" : ""}`}
              style={{ backgroundColor: meta.color + "20", borderColor: isSelfRefine ? meta.color + "60" : meta.color + "40", borderStyle: isSelfRefine ? "dashed" : "solid", borderWidth: 1 }}>
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
            </div>
            <span className="text-[10px] font-semibold text-slate-200">{agentLabel}</span>
            <span className="text-[9px] text-slate-600">({agent?.type || evt.agentType})</span>
          </div>
        </>
      )}

      {evt.type === "thinking" && (evt.content.includes("started") || evt.content.includes("Round")) ? null : (
        <div className={`flex items-start gap-2 text-[10px] py-0.5 ml-7 border-l pl-3 ${
          evt.type === "input" ? "border-cyan-500/20" :
          evt.type === "tool_call" ? "border-amber-500/20" :
          evt.type === "tool_result" ? "border-amber-500/10" :
          isError ? "border-red-500/20" :
          isMessage ? "border-emerald-500/15" : "border-white/[0.04]"
        }`}>
          {evt.type === "input" && <ArrowRight className="h-2.5 w-2.5 text-cyan-400 shrink-0 mt-0.5" />}
          {evt.type === "tool_call" && <Zap className="h-2.5 w-2.5 text-amber-400 shrink-0 mt-0.5" />}
          {evt.type === "tool_result" && <CheckCircle2 className="h-2.5 w-2.5 text-amber-300/60 shrink-0 mt-0.5" />}
          {isError && <AlertCircle className="h-2.5 w-2.5 text-red-400 shrink-0 mt-0.5" />}
          {isMessage && <MessageSquare className="h-2.5 w-2.5 text-emerald-400 shrink-0 mt-0.5" />}
          {evt.type === "thinking" && <Bot className="h-2.5 w-2.5 text-slate-600 shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            {evt.toolName && <span className="font-mono text-amber-300 text-[9px] mr-1">{evt.toolName}</span>}
            {evt.type === "tool_call" && evt.content ? (
              <span className="text-amber-300/50 text-[9px]">{evt.content}</span>
            ) : evt.type === "tool_result" ? (
              <details className="group/tr">
                <summary className="text-amber-300/50 cursor-pointer list-none text-[9px]">
                  → {evt.content.slice(0, 120)}{evt.content.length > 120 ? "..." : ""}
                  {evt.content.length > 120 && <span className="text-[8px] text-amber-400/30 ml-1">expand</span>}
                </summary>
                <pre className="text-amber-200/40 whitespace-pre-wrap break-all mt-1 text-[9px] max-h-[200px] overflow-y-auto bg-amber-500/[0.02] rounded p-2 border border-amber-500/[0.06]">{evt.content}</pre>
              </details>
            ) : evt.type === "input" ? (
              <details className="group/inp">
                <summary className="text-cyan-400/70 cursor-pointer list-none text-[9px]">
                  input: {evt.content.slice(0, 100)}{evt.content.length > 100 ? "..." : ""}
                  <span className="text-[8px] text-cyan-400/40 ml-1">expand</span>
                </summary>
                <pre className="text-cyan-400/50 whitespace-pre-wrap break-all mt-1 text-[9px] max-h-[200px] overflow-y-auto bg-cyan-500/[0.02] rounded p-2 border border-cyan-500/[0.06]">{evt.content}</pre>
              </details>
            ) : isMessage ? (
              <details className="group/msg">
                <summary className="text-slate-300 cursor-pointer list-none">
                  {evt.content.slice(0, 150)}{evt.content.length > 150 ? "..." : ""}
                  {evt.content.length > 150 && <span className="text-[8px] text-violet-400 ml-1">expand</span>}
                </summary>
                <pre className="text-slate-400 whitespace-pre-wrap break-all mt-1 text-[9px] max-h-[300px] overflow-y-auto bg-white/[0.01] rounded p-2 border border-white/[0.04]">{evt.content}</pre>
              </details>
            ) : (
              <span className={`${isError ? "text-red-400" : "text-slate-500"}`}>{evt.content}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
