import { Handle, Position, BaseEdge, type Node, type NodeProps, type NodeTypes, type EdgeProps, type EdgeTypes } from "@xyflow/react";
import { Cpu } from "lucide-react";
import type { AgentNodeData, TriggerNodeData, ConditionNodeData, HumanNodeData, WorkspaceNodeData, EndNodeData, WorkflowNodeData } from "./flow-types";

// ── Colors ─────────────────────────────────────────────────────────────────

export const AGENT_COLORS: Record<string, string> = {
  code: "#8b5cf6", research: "#06b6d4", file: "#f59e0b",
  memory: "#10b981", plan: "#f43f5e", rag: "#a855f7",
  ltp: "#ec4899", custom: "#6366f1",
};

export const TRIGGER_COLORS: Record<string, string> = {
  manual: "#8b5cf6", scheduled: "#f59e0b", cron: "#10b981",
  interval: "#06b6d4", watch: "#f43f5e", webhook: "#6366f1",
};

const TRIGGER_ICONS: Record<string, string> = {
  manual: "👆", scheduled: "⏰", cron: "🔄", interval: "⏱", watch: "👁", webhook: "🔗",
};

// ── Custom Nodes ───────────────────────────────────────────────────────────

// Always-visible node-kind chip (top-right). Makes a node's TYPE clear at a glance even
// when its subtitle shows a live status instead (e.g. a human gate reading "approved").
function TypeTag({ label, color }: { label: string; color: string }) {
  return (
    <div
      className="absolute -top-2 right-2 z-10 px-1.5 py-[0.5px] rounded-full text-[7px] font-bold uppercase tracking-wider border pointer-events-none whitespace-nowrap"
      style={{ color, borderColor: color + "55", background: "#0c0c14" }}
    >
      {label}
    </div>
  );
}

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const color = AGENT_COLORS[data.agentType] || "#6366f1";
  const hasError = (data as any).hasError;
  const runState = (data as any).runState as "idle" | "running" | "done" | undefined;
  const isActive = runState === "running";
  const isDone = runState === "done";
  return (
    <div className={`relative px-3 py-2.5 rounded-xl border-2 min-w-[150px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""} ${hasError ? "animate-pulse" : ""} ${isActive ? "animate-pulse" : ""}`}
      style={{
        borderColor: hasError ? "rgb(239,68,68)" : isDone ? "rgb(16,185,129)" : isActive ? color : selected ? color : color + "50",
        background: hasError ? "rgba(239,68,68,0.06)" : isDone ? "rgba(16,185,129,0.04)" : isActive ? color + "08" : "#0c0c14",
        boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3), 0 0 4px rgba(239,68,68,0.2)" : isActive ? `0 0 20px ${color}50, 0 0 8px ${color}40` : isDone ? "0 0 12px rgba(16,185,129,0.2)" : selected ? `0 0 20px ${color}40, 0 0 6px ${color}30` : "none",
      }}>
      <TypeTag label="Agent" color={color} />
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-400" />
      <div className="flex items-center gap-2">
        {isDone ? (
          <svg className="h-3 w-3 shrink-0 text-emerald-400" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <div className={`h-3 w-3 rounded-full shrink-0 ${isActive ? "animate-ping" : ""}`} style={{ backgroundColor: hasError ? "#ef4444" : color }} />
        )}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-200 truncate">{data.label || data.role || data.agentType}</div>
          <div className="text-[9px] text-slate-500">{data.agentType} · {data.maxTurns} turns</div>
        </div>
      </div>
      {(data as any).connectionName && (
        <div className="flex items-center gap-1 mt-1 text-[8px] text-violet-300/90 bg-violet-500/10 border border-violet-500/15 rounded px-1.5 py-0.5 w-fit max-w-full">
          <Cpu className="h-2 w-2 shrink-0" /><span className="truncate">{(data as any).connectionName}</span>
        </div>
      )}
      {hasError && <div className="text-[8px] text-red-400 mt-1">{(data as any).errorReason || "error"}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData>>) {
  const tt = data.triggerType || "manual";
  const color = TRIGGER_COLORS[tt] || "#8b5cf6";
  return (
    <div className={`relative px-3 py-2.5 rounded-xl border-2 min-w-[150px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: selected ? color : color + "40", background: color + "10", boxShadow: selected ? `0 0 20px ${color}40, 0 0 6px ${color}30` : "none" }}>
      <TypeTag label="Trigger" color={color} />
      <div className="flex items-center gap-2">
        <span className="text-sm">{TRIGGER_ICONS[tt]}</span>
        <div>
          <div className="text-[11px] font-bold" style={{ color }}>{tt.charAt(0).toUpperCase() + tt.slice(1)}</div>
          <div className="text-[9px] text-slate-500">{data.label}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps<Node<ConditionNodeData>>) {
  const hasError = (data as any).hasError;
  return (
    <div className={`relative px-3 py-2 rounded-lg border-2 min-w-[80px] text-center transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : selected ? "rgb(245,158,11)" : "rgba(245,158,11,0.4)", background: hasError ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)", boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3)" : selected ? "0 0 20px rgba(245,158,11,0.25), 0 0 6px rgba(245,158,11,0.2)" : "none" }}>
      <TypeTag label="Condition" color="#f59e0b" />
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-400" />
      <div className="text-[10px] font-semibold text-amber-400">{data.label || "?"}</div>
      <div className="text-[8px] text-amber-400/50 font-mono">{data.expression}</div>
      {hasError && <div className="text-[8px] text-red-400 mt-0.5">{(data as any).errorReason || "error"}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

function HumanNode({ data, selected }: NodeProps<Node<HumanNodeData>>) {
  const hasError = (data as any).hasError;
  const runState = (data as any).runState as "idle" | "waiting" | "done" | "denied" | "revision" | undefined;
  const isWaiting = runState === "waiting";
  const isDone = runState === "done";
  const isDenied = runState === "denied";
  const isRevision = runState === "revision";
  const stateColor = isDenied ? "rgb(239,68,68)" : isRevision ? "rgb(249,115,22)" : isWaiting ? "rgb(234,179,8)" : isDone ? "rgb(16,185,129)" : selected ? "rgb(59,130,246)" : "rgba(59,130,246,0.4)";
  const stateBg = isDenied ? "rgba(239,68,68,0.08)" : isRevision ? "rgba(249,115,22,0.08)" : isWaiting ? "rgba(234,179,8,0.08)" : isDone ? "rgba(16,185,129,0.06)" : "rgba(59,130,246,0.06)";
  const stateLabel = isDenied ? "denied" : isRevision ? "revision requested..." : isWaiting ? "awaiting approval..." : isDone ? "approved" : "human-in-the-loop";
  const dotClass = isDenied ? "bg-red-500" : isRevision ? "bg-orange-500 animate-pulse" : isWaiting ? "bg-yellow-500 animate-ping" : isDone ? "bg-emerald-500" : "bg-blue-500";
  const textClass = isDenied ? "text-red-300" : isRevision ? "text-orange-300" : isWaiting ? "text-yellow-300" : isDone ? "text-emerald-300" : "text-blue-300";
  return (
    <div className={`relative px-3 py-2.5 rounded-xl border-2 min-w-[130px] transition-all duration-200 ${isWaiting ? "animate-pulse" : ""} ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : stateColor, background: hasError ? "rgba(239,68,68,0.06)" : stateBg, boxShadow: (isWaiting || isRevision) ? `0 0 20px ${stateColor}40` : isDenied ? `0 0 16px ${stateColor}40` : "none" }}>
      <TypeTag label="Human gate" color="#3b82f6" />
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-400" />
      <div className="flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full shrink-0 ${hasError ? "bg-red-500" : dotClass}`} />
        <div>
          <div className={`text-[11px] font-semibold ${hasError ? "text-red-300" : textClass}`}>{data.label || "Review"}</div>
          <div className="text-[9px] text-slate-500">{stateLabel}</div>
        </div>
      </div>
      {hasError && <div className="text-[8px] text-red-400 mt-1">{(data as any).errorReason || "error"}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

function WorkspaceNode({ data, selected }: NodeProps<Node<WorkspaceNodeData>>) {
  const modeIcons: Record<string, string> = { user: "👤", isolated: "🔒", persistent: "💾" };
  const hasError = (data as any).hasError;
  return (
    <div className={`relative px-3 py-2.5 rounded-xl border-2 min-w-[130px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : selected ? "rgb(20,184,166)" : "rgba(20,184,166,0.4)", background: hasError ? "rgba(239,68,68,0.06)" : "rgba(20,184,166,0.06)", boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3)" : selected ? "0 0 20px rgba(20,184,166,0.25), 0 0 6px rgba(20,184,166,0.2)" : "none" }}>
      <TypeTag label="Workspace" color="#14b8a6" />
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-400" />
      <div className="flex items-center gap-2">
        <span className="text-sm">📁</span>
        <div>
          <div className="text-[11px] font-semibold text-teal-300">{data.workspaceName || "Workspace"}</div>
          <div className="text-[9px] text-slate-500">{modeIcons[data.workspaceMode] || "🔒"} {data.workspaceMode}</div>
        </div>
      </div>
      {hasError && <div className="text-[8px] text-red-400 mt-1">{(data as any).errorReason || "error"}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

function EndNode({ selected }: NodeProps<Node<EndNodeData>>) {
  return (
    <div className={`px-3 py-2 rounded-full border-2 transition-all duration-200 ${selected ? "scale-[1.05]" : ""}`}
      style={{ borderColor: selected ? "rgb(16,185,129)" : "rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.08)", boxShadow: selected ? "0 0 20px rgba(16,185,129,0.25), 0 0 6px rgba(16,185,129,0.2)" : "none" }}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-400" />
      <div className="text-[9px] font-bold text-emerald-400 text-center px-2">END</div>
    </div>
  );
}

function WorkflowNode({ data, selected }: NodeProps<Node<WorkflowNodeData>>) {
  const hasError = (data as any).hasError;
  return (
    <div className={`relative px-3 py-2.5 rounded-xl border-2 min-w-[160px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : selected ? "rgb(236,72,153)" : "rgba(236,72,153,0.4)", background: hasError ? "rgba(239,68,68,0.06)" : "rgba(236,72,153,0.06)", boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3)" : selected ? "0 0 20px rgba(236,72,153,0.25), 0 0 6px rgba(236,72,153,0.2)" : "none" }}>
      <TypeTag label="Subflow" color="#ec4899" />
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-400" />
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-lg bg-pink-500/15 border border-pink-500/25 flex items-center justify-center shrink-0">
          <span className="text-[10px]">📦</span>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-pink-300 truncate">{data.label || data.templateName}</div>
          <div className="text-[9px] text-slate-500">{data.agentCount} agents · {data.pattern}</div>
        </div>
      </div>
      {data.description && <div className="text-[8px] text-slate-600 mt-1 truncate">{data.description}</div>}
      {hasError && <div className="text-[8px] text-red-400 mt-1">{(data as any).errorReason || "error"}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  agent: AgentNode,
  trigger: TriggerNode,
  condition: ConditionNode,
  human: HumanNode,
  workspace: WorkspaceNode,
  workflow: WorkflowNode,
  end: EndNode,
};

// ── Custom self-loop edge ──────────────────────────────────────────────────

function SelfLoopEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  // Route: down from source, right, up, left back to target
  const loopOffset = 100;
  const rightX = sourceX + loopOffset;
  const r = 10;
  const path = `M${sourceX},${sourceY} L${sourceX},${sourceY + 10} Q${sourceX},${sourceY + 10 + r} ${sourceX + r},${sourceY + 10 + r} L${rightX - r},${sourceY + 10 + r} Q${rightX},${sourceY + 10 + r} ${rightX},${sourceY + 10} L${rightX},${targetY - 10} Q${rightX},${targetY - 10 - r} ${rightX - r},${targetY - 10 - r} L${targetX + r},${targetY - 10 - r} Q${targetX},${targetY - 10 - r} ${targetX},${targetY - 10} L${targetX},${targetY}`;

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

export const edgeTypes: EdgeTypes = {
  selfLoop: SelfLoopEdge,
};
