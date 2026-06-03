"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, addEdge, useReactFlow,
  Handle, Position, MarkerType, BaseEdge, getSmoothStepPath,
  type Node, type Edge, type Connection, type NodeTypes, type NodeProps, type EdgeTypes, type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, Layout, User, Settings, Sparkles, X, ChevronDown, AlertCircle, Download, Upload, Undo2, Redo2, Copy, Clipboard, Zap } from "lucide-react";
import type { TeamAgent } from "@/stores/agent-sessions";

// ── Types ──────────────────────────────────────────────────────────────────

export type TriggerType = "manual" | "scheduled" | "cron" | "interval" | "watch" | "webhook";
export type WorkspaceMode = "user" | "isolated" | "persistent";

interface AgentNodeData { agentType: string; role: string; label: string; maxTurns: number; instructions: string; [key: string]: unknown; }
interface TriggerNodeData { triggerType: TriggerType; label: string; [key: string]: unknown; }
interface ConditionNodeData { expression: string; label: string; [key: string]: unknown; }
interface HumanNodeData { label: string; instructions: string; [key: string]: unknown; }
interface WorkspaceNodeData { workspaceName: string; workspaceMode: WorkspaceMode; label: string; [key: string]: unknown; }
interface EndNodeData { label: string; [key: string]: unknown; }
interface WorkflowNodeData { templateId: string; templateName: string; label: string; agentCount: number; pattern: string; description: string; [key: string]: unknown; }

interface FlowEditorProps {
  agents: TeamAgent[];
  pattern: string;
  triggerType?: string;
  triggerConfig?: Record<string, any>;
  workspaceEnabled?: boolean;
  workspaceName?: string;
  workspaceMode?: string;
  humanGates?: number[];
  errorNodeIds?: string[];
  errorReasons?: Record<string, string>;
  validationWarnings?: string[];
  graphRef?: React.MutableRefObject<{ nodes: any[]; edges: any[] }>;
  initialGraph?: { nodes: any[]; edges: any[] } | null;
  activeAgentIndex?: number;
  activeAgentIndices?: number[];
  completedAgents?: number[];
  isRunning?: boolean;
  locked?: boolean;
  waitingNodeId?: string | null;
  deniedNodeIds?: string[];
  approvedNodeIds?: string[];
  revisionNodeIds?: string[];
  agentOutputs?: Record<number, string>;
  onPatternChange?: (pattern: string) => void;
  onUpdateFlow: (nodes: Node[], edges: Edge[]) => void;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  code: "#8b5cf6", research: "#06b6d4", file: "#f59e0b",
  memory: "#10b981", plan: "#f43f5e", rag: "#a855f7",
  ltp: "#ec4899", custom: "#6366f1",
};

const TRIGGER_COLORS: Record<string, string> = {
  manual: "#8b5cf6", scheduled: "#f59e0b", cron: "#10b981",
  interval: "#06b6d4", watch: "#f43f5e", webhook: "#6366f1",
};

const TRIGGER_ICONS: Record<string, string> = {
  manual: "👆", scheduled: "⏰", cron: "🔄", interval: "⏱", watch: "👁", webhook: "🔗",
};

// ── Custom Nodes ───────────────────────────────────────────────────────────

function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const color = AGENT_COLORS[data.agentType] || "#6366f1";
  const hasError = (data as any).hasError;
  const runState = (data as any).runState as "idle" | "running" | "done" | undefined;
  const isActive = runState === "running";
  const isDone = runState === "done";
  return (
    <div className={`px-3 py-2.5 rounded-xl border-2 min-w-[150px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""} ${hasError ? "animate-pulse" : ""} ${isActive ? "animate-pulse" : ""}`}
      style={{
        borderColor: hasError ? "rgb(239,68,68)" : isDone ? "rgb(16,185,129)" : isActive ? color : selected ? color : color + "50",
        background: hasError ? "rgba(239,68,68,0.06)" : isDone ? "rgba(16,185,129,0.04)" : isActive ? color + "08" : "#0c0c14",
        boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3), 0 0 4px rgba(239,68,68,0.2)" : isActive ? `0 0 20px ${color}50, 0 0 8px ${color}40` : isDone ? "0 0 12px rgba(16,185,129,0.2)" : selected ? `0 0 20px ${color}40, 0 0 6px ${color}30` : "none",
      }}>
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
      {hasError && <div className="text-[8px] text-red-400 mt-1">{(data as any).errorReason || "error"}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-violet-400" />
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData>>) {
  const tt = data.triggerType || "manual";
  const color = TRIGGER_COLORS[tt] || "#8b5cf6";
  return (
    <div className={`px-3 py-2.5 rounded-xl border-2 min-w-[150px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: selected ? color : color + "40", background: color + "10", boxShadow: selected ? `0 0 20px ${color}40, 0 0 6px ${color}30` : "none" }}>
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
    <div className={`px-3 py-2 rounded-lg border-2 min-w-[80px] text-center transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : selected ? "rgb(245,158,11)" : "rgba(245,158,11,0.4)", background: hasError ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)", boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3)" : selected ? "0 0 20px rgba(245,158,11,0.25), 0 0 6px rgba(245,158,11,0.2)" : "none" }}>
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
    <div className={`px-3 py-2.5 rounded-xl border-2 min-w-[130px] transition-all duration-200 ${isWaiting ? "animate-pulse" : ""} ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : stateColor, background: hasError ? "rgba(239,68,68,0.06)" : stateBg, boxShadow: (isWaiting || isRevision) ? `0 0 20px ${stateColor}40` : isDenied ? `0 0 16px ${stateColor}40` : "none" }}>
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
    <div className={`px-3 py-2.5 rounded-xl border-2 min-w-[130px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : selected ? "rgb(20,184,166)" : "rgba(20,184,166,0.4)", background: hasError ? "rgba(239,68,68,0.06)" : "rgba(20,184,166,0.06)", boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3)" : selected ? "0 0 20px rgba(20,184,166,0.25), 0 0 6px rgba(20,184,166,0.2)" : "none" }}>
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
    <div className={`px-3 py-2.5 rounded-xl border-2 min-w-[160px] transition-all duration-200 ${selected ? "scale-[1.03]" : ""}`}
      style={{ borderColor: hasError ? "rgb(239,68,68)" : selected ? "rgb(236,72,153)" : "rgba(236,72,153,0.4)", background: hasError ? "rgba(239,68,68,0.06)" : "rgba(236,72,153,0.06)", boxShadow: hasError ? "0 0 16px rgba(239,68,68,0.3)" : selected ? "0 0 20px rgba(236,72,153,0.25), 0 0 6px rgba(236,72,153,0.2)" : "none" }}>
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

const nodeTypes: NodeTypes = {
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

const edgeTypes: EdgeTypes = {
  selfLoop: SelfLoopEdge,
};

// ── Initialize flow ────────────────────────────────────────────────────────

/**
 * Check if adding an edge from `sourceId` to `targetId` would create a cycle.
 * Does a DFS from `targetId` following existing edges — if we can reach `sourceId`, it's a cycle.
 * No dependency on trigger node.
 */
function isAncestorInGraph(targetId: string, sourceId: string, _allNodes: Node[], allEdges: Edge[]): boolean {
  // Build adjacency from existing NON-feedback edges only
  const adj: Record<string, string[]> = {};
  for (const e of allEdges) {
    if (e.label === "feedback" || e.label === "loop" || e.label === "retry") continue;
    if (e.style && typeof e.style === "object" && (e.style as any).strokeDasharray) continue;
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  // DFS from targetId — can we reach sourceId?
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const child of (adj[cur] || [])) stack.push(child);
  }
  return false;
}

let _idC = 0;
function gid() { return `n${++_idC}-${Date.now().toString(36).slice(-4)}`; }

function buildInitialFlow(
  agents: TeamAgent[], pattern: string,
  opts?: { triggerType?: string; workspaceEnabled?: boolean; workspaceName?: string; workspaceMode?: string; humanGates?: number[]; triggerConfig?: Record<string, any> }
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const tt = (opts?.triggerType || "manual") as TriggerType;
  const sid = gid(), eid = gid();

  nodes.push({ id: sid, type: "trigger", position: { x: 300, y: 0 }, data: { triggerType: tt, label: tt === "manual" ? "Manual Run" : tt, ...(opts?.triggerConfig || {}) } });

  const hGates = opts?.humanGates || [];
  const yStep = 120;

  const n = agents.length;
  const totalW = n * 200;
  const centerX = 300;

  // Position agents based on pattern
  const agentNodes: Node[] = agents.map((a, i) => {
    let x = centerX, y = yStep + i * yStep;

    const workerSpacing = Math.min(200, 800 / Math.max(n, 1));

    if (pattern === "parallel") {
      x = centerX - (n * workerSpacing) / 2 + i * workerSpacing + workerSpacing / 2;
      y = yStep;
    } else if (pattern === "supervisor") {
      if (i === 0) { x = centerX; y = yStep; } // Supervisor at top center
      else {
        const wCount = n - 1;
        const wSpacing = Math.min(200, 900 / Math.max(wCount, 1));
        x = centerX - (wCount * wSpacing) / 2 + (i - 1) * wSpacing + wSpacing / 2;
        y = yStep * 3; // Workers well below supervisor for clean back-edge routing
      }
    } else if (pattern === "debate" && n >= 2) {
      if (n >= 3 && i === n - 1) {
        x = centerX; y = yStep * 2.6; // judge: centered, below the debaters
      } else {
        const dCount = n >= 3 ? n - 1 : n;
        const sp = Math.min(320, 700 / Math.max(dCount, 1));
        x = centerX - (dCount * sp) / 2 + i * sp + sp / 2;
        y = yStep;
      }
    } else if (pattern === "swarm") {
      // Circular layout for swarm — agents arranged in a ring
      const radius = Math.max(160, n * 50);
      const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top
      x = centerX + Math.cos(angle) * radius;
      y = yStep + radius + Math.sin(angle) * radius;
    }

    return {
      id: gid(), type: "agent",
      position: { x, y },
      data: { agentType: a.type, role: a.role, label: a.name || a.role || a.type, maxTurns: a.max_turns, instructions: a.instructions, tools: a.tools || [] },
    };
  });
  nodes.push(...agentNodes);

  // Human gates
  const humanNodes: Node[] = [];
  for (const gi of hGates) {
    if (gi >= 0 && gi < agents.length) {
      const after = agentNodes[gi];
      humanNodes.push({
        id: gid(), type: "human",
        position: { x: after.position.x, y: after.position.y + yStep * 0.6 },
        data: { label: `Review ${agents[gi].name || agents[gi].role || agents[gi].type}`, instructions: "" },
      });
    }
  }
  nodes.push(...humanNodes);

  // Workspace
  let wsNode: Node | null = null;
  if (opts?.workspaceEnabled) {
    const lastAgentY = Math.max(...agentNodes.map(a => a.position.y), ...humanNodes.map(h => h.position.y), yStep);
    wsNode = {
      id: gid(), type: "workspace",
      position: { x: centerX, y: lastAgentY + yStep },
      data: { workspaceName: opts.workspaceName || "output", workspaceMode: (opts.workspaceMode || "isolated") as WorkspaceMode, label: opts.workspaceName || "Workspace" },
    };
    nodes.push(wsNode);
  }

  // END — always centered below everything
  const allNodeYs = nodes.filter(nd => nd.id !== sid).map(nd => nd.position.y);
  const endY = Math.max(...allNodeYs, yStep) + yStep * 1.2;
  nodes.push({ id: eid, type: "end", position: { x: centerX, y: endY }, data: { label: "END" } });

  // Single edge style — same as what user gets when connecting manually
  const es = { type: "smoothstep" as const, markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(139,92,246,0.5)" }, style: { stroke: "rgba(139,92,246,0.3)", strokeWidth: 2 } };
  const lastTarget = wsNode ? wsNode.id : eid;

  // Auto-styled edge: detect feedback by graph hierarchy, not Y position
  // An edge is feedback if the target is an ancestor of the source (creates a cycle)
  function autoEdge(srcId: string, tgtId: string, label?: string): Edge {
    const isSelf = srcId === tgtId;
    const isFeedback = label === "feedback" || (!label && isAncestorInGraph(tgtId, srcId, nodes, edges));

    if (isSelf) {
      return { id: gid(), source: srcId, target: tgtId, type: "selfLoop", markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(245,158,11,0.6)" }, style: { stroke: "rgba(245,158,11,0.4)", strokeWidth: 2, strokeDasharray: "6 3" }, label: label || "loop" };
    }
    if (isFeedback) {
      return { id: gid(), source: srcId, target: tgtId, ...es, style: { stroke: "rgba(245,158,11,0.4)", strokeWidth: 2, strokeDasharray: "6 3" }, markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(245,158,11,0.6)" }, label: label || "feedback" };
    }
    return { id: gid(), source: srcId, target: tgtId, ...es, ...(label ? { label } : {}) };
  }


  // Build chain helper (agents + human gates interleaved)
  const buildChain = (): Node[] => {
    const chain: Node[] = [];
    for (let i = 0; i < agentNodes.length; i++) {
      chain.push(agentNodes[i]);
      if (hGates.includes(i)) {
        const hIdx = hGates.filter(g => g <= i).length - 1;
        if (humanNodes[hIdx]) chain.push(humanNodes[hIdx]);
      }
    }
    return chain;
  };

  if (pattern === "sequential") {
    const chain = [nodes[0], ...buildChain(), ...(wsNode ? [wsNode] : []), nodes[nodes.length - 1]];
    for (let i = 0; i < chain.length - 1; i++) edges.push(autoEdge(chain[i].id, chain[i + 1].id));

  } else if (pattern === "parallel") {
    for (const a of agentNodes) {
      edges.push(autoEdge(sid, a.id));
      edges.push(autoEdge(a.id, lastTarget));
    }
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else if (pattern === "supervisor" && n > 0) {
    edges.push(autoEdge(sid, agentNodes[0].id));
    for (let i = 1; i < n; i++) {
      edges.push(autoEdge(agentNodes[0].id, agentNodes[i].id));
    }
    for (let i = 1; i < n; i++) {
      edges.push(autoEdge(agentNodes[i].id, agentNodes[0].id, "feedback"));
    }
    edges.push(autoEdge(agentNodes[0].id, agentNodes[0].id, "evaluate"));
    edges.push(autoEdge(agentNodes[0].id, lastTarget));
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else if (pattern === "debate" && n >= 2) {
    if (n === 2) {
      // Two debaters argue each other, both → END.
      edges.push(autoEdge(sid, agentNodes[0].id));
      edges.push(autoEdge(sid, agentNodes[1].id));
      edges.push(autoEdge(agentNodes[0].id, agentNodes[1].id));
      edges.push(autoEdge(agentNodes[1].id, agentNodes[0].id, "feedback"));
      edges.push(autoEdge(agentNodes[0].id, lastTarget));
      edges.push(autoEdge(agentNodes[1].id, lastTarget));
    } else {
      // n >= 3: the LAST agent is the JUDGE. The others debate in parallel and feed the
      // judge, who merges/reconciles and is the only node going to END.
      const judge = agentNodes[n - 1];
      const debaters = agentNodes.slice(0, n - 1);
      for (const d of debaters) {
        edges.push(autoEdge(sid, d.id));        // trigger → each debater
        edges.push(autoEdge(d.id, judge.id));   // debater → judge
      }
      if (debaters.length >= 2) {
        edges.push(autoEdge(debaters[1].id, debaters[0].id, "feedback")); // cross-talk
      }
      edges.push(autoEdge(judge.id, lastTarget)); // judge → END (the missing wire)
    }
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else if (pattern === "swarm") {
    for (let i = 0; i < n; i++) {
      edges.push(autoEdge(sid, agentNodes[i].id));
    }
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      edges.push(autoEdge(agentNodes[i].id, agentNodes[next].id));
      edges.push(autoEdge(agentNodes[next].id, agentNodes[i].id, "feedback"));
    }
    for (let i = 0; i < n; i++) {
      edges.push(autoEdge(agentNodes[i].id, lastTarget));
    }
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else {
    // Fallback: simple chain
    const chain = [nodes[0], ...buildChain(), ...(wsNode ? [wsNode] : []), nodes[nodes.length - 1]];
    for (let i = 0; i < chain.length - 1; i++) edges.push({ id: gid(), source: chain[i].id, target: chain[i + 1].id, ...es });
  }

  return { nodes, edges };
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function FlowEditor({ agents, pattern, triggerType: propTriggerType, triggerConfig, workspaceEnabled, workspaceName, workspaceMode, humanGates, errorNodeIds, errorReasons, validationWarnings, graphRef, initialGraph, activeAgentIndex = -1, activeAgentIndices = [], completedAgents = [], isRunning = false, locked = false, waitingNodeId = null, deniedNodeIds = [], approvedNodeIds = [], revisionNodeIds = [], agentOutputs = {}, onPatternChange, onUpdateFlow }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Load available tools from backend
  const [availableTools, setAvailableTools] = useState<{name: string; description: string; category: string}[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    const BASE = getApiUrl();
    fetch(`${BASE}/tools`).then(r => r.json()).then(data => {
      const tools: {name: string; description: string; category: string}[] = [];
      (data.built_in?.tools || []).forEach((t: any) => tools.push({ name: t.name, description: t.description, category: "built-in" }));
      (data.mcp_external?.tools || []).forEach((t: any) => tools.push({ name: t.name, description: t.description, category: "mcp" }));
      (data.langchain?.tools || []).forEach((t: any) => tools.push({ name: t.name, description: t.description, category: "langchain" }));
      setAvailableTools(tools);
    }).catch(() => {});
  }, []);

  // Load saved workflows (templates) for reuse as nodes
  const [savedWorkflows, setSavedWorkflows] = useState<{id: string; name: string; config: {agents: TeamAgent[]; pattern: string}}[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("kernelmcp_saved_templates") || "[]");
      setSavedWorkflows(saved);
    } catch {}
  }, []);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;
  const selectedEdge = selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) : null;

  const updateNodeData = useCallback((id: string, patch: Record<string, unknown>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  }, [setNodes]);

  const updateEdgeData = useCallback((id: string, patch: Partial<Edge>) => {
    setEdges(eds => eds.map(e => e.id === id ? { ...e, ...patch } : e));
  }, [setEdges]);

  // Only rebuild flow from props on first mount or when pattern/trigger/workspace change
  // NOT when agents change (to avoid overwriting user's manual edits)
  const agentsKey = agents.map(a => `${a.type}:${a.role}`).join(",");
  const configKey = `${pattern}_${agentsKey}_${propTriggerType}_${workspaceEnabled}_${workspaceName}_${workspaceMode}_${(humanGates || []).join(",")}`;
  const isFirstMount = useRef(true);
  const lastBuiltKey = useRef("");
  const internalAgentsKey = useRef("");  // Track agents key set by flow editor (not external)

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      lastBuiltKey.current = configKey;
      internalAgentsKey.current = agentsKey;
      if (initialGraph && initialGraph.nodes.length > 0) {
        setNodes(initialGraph.nodes.map((n: any) => ({ ...n, data: { ...n.data } })));
        setEdges(initialGraph.edges.map((e: any) => ({ ...e })));
      } else {
        const { nodes: n, edges: e } = buildInitialFlow(agents, pattern, {
          triggerType: propTriggerType, triggerConfig, workspaceEnabled, workspaceName, workspaceMode, humanGates,
        });
        setNodes(n);
        setEdges(e);
      }
    }
  }, []); // eslint-disable-line

  // Rebuild when config changes from OUTSIDE (template applied, pattern changed)
  // Skip if agents changed from our own flow editor sync
  useEffect(() => {
    if (isFirstMount.current) return;
    if (lastBuiltKey.current === configKey) return;
    // Check what changed: only agents (from our sync) or also pattern/config?
    const prevParts = lastBuiltKey.current.split("_");
    const newParts = configKey.split("_");
    const onlyAgentsChanged = prevParts[0] === newParts[0] && internalAgentsKey.current === agentsKey;
    if (onlyAgentsChanged) {
      lastBuiltKey.current = configKey;
      return; // Internal agents sync — don't rebuild
    }
    // External change (template, pattern dropdown) — rebuild
    lastBuiltKey.current = configKey;
    internalAgentsKey.current = agentsKey;
    const { nodes: n, edges: e } = buildInitialFlow(agents, pattern, {
      triggerType: propTriggerType, workspaceEnabled, workspaceName, workspaceMode, humanGates,
    });
    setNodes(n);
    setEdges(e);
  }, [configKey]); // eslint-disable-line

  // Soft-sync agent node DATA (tools, instructions, maxTurns, type, role) from the agents prop
  // WITHOUT a structural rebuild — so AI-architect refinements that change tools/instructions
  // reflect on existing nodes (positions/edges kept). Without this, the debounced sync-back
  // would overwrite the architect's change with stale node data. The `changed` guard keeps it
  // from looping (returns the same nodes when nothing differs).
  const agentDataKey = agents.map(a => `${a.type}|${a.role}|${(a.tools || []).join(",")}|${a.instructions || ""}|${a.max_turns}`).join("§");
  useEffect(() => {
    if (isFirstMount.current) return;
    setNodes(nds => {
      let ai = 0;
      let changed = false;
      const out = nds.map(n => {
        if (n.type !== "agent") return n;
        const a = agents[ai++];
        if (!a) return n;
        const d = n.data as any;
        const sameTools = JSON.stringify(d.tools || []) === JSON.stringify(a.tools || []);
        if (d.agentType === a.type && d.role === a.role && (d.instructions || "") === (a.instructions || "") && d.maxTurns === a.max_turns && sameTools) return n;
        changed = true;
        return { ...n, data: { ...d, agentType: a.type, role: a.role, label: d.label || a.name || a.role || a.type, maxTurns: a.max_turns, instructions: a.instructions, tools: a.tools || [] } };
      });
      return changed ? out : nds;
    });
  }, [agentDataKey]); // eslint-disable-line

  // Soft-sync the trigger node's type + value (cron/interval/…) from props without rebuild,
  // so AI-architect trigger changes show on the existing node.
  const triggerKey = `${propTriggerType}|${JSON.stringify(triggerConfig || {})}`;
  useEffect(() => {
    if (isFirstMount.current) return;
    setNodes(nds => {
      let changed = false;
      const out = nds.map(n => {
        if (n.type !== "trigger") return n;
        const d = n.data as any;
        const want = { triggerType: propTriggerType || "manual", ...(triggerConfig || {}) };
        const same = (d.triggerType || "manual") === want.triggerType && Object.keys(triggerConfig || {}).every(k => d[k] === (triggerConfig as any)[k]);
        if (same) return n;
        changed = true;
        return { ...n, data: { ...d, ...want, label: want.triggerType === "manual" ? "Manual Run" : want.triggerType } };
      });
      return changed ? out : nds;
    });
  }, [triggerKey]); // eslint-disable-line

  // Update graph ref immediately (for handleRun to read)
  useEffect(() => {
    if (graphRef) graphRef.current = { nodes, edges };
  }, [nodes, edges, graphRef]);

  // Sync agent data back to parent (debounced to avoid tight loops)
  const syncTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      onUpdateFlow(nodes, edges);
      // Mark this agents key as internally generated (so rebuild doesn't trigger)
      const agentNodes = nodes.filter(n => n.type === "agent");
      internalAgentsKey.current = agentNodes.map(n => `${(n.data as any).agentType}:${(n.data as any).role}`).join(",");
    }, 100);
    return () => clearTimeout(syncTimer.current);
  }, [nodes, edges]); // eslint-disable-line

  // Mark error nodes with reason
  const errorSet = useMemo(() => new Set(errorNodeIds || []), [errorNodeIds]);
  useEffect(() => {
    if (errorSet.size === 0) {
      const hasErrors = nodes.some(n => (n.data as any)?.hasError);
      if (hasErrors) setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, hasError: false, errorReason: "" } })));
      return;
    }
    const needsUpdate = nodes.some(n => {
      const has = (n.data as any)?.hasError || false;
      const should = errorSet.has(n.id);
      return has !== should;
    });
    if (needsUpdate) {
      setNodes(nds => nds.map(n => ({
        ...n,
        data: { ...n.data, hasError: errorSet.has(n.id), errorReason: errorReasons?.[n.id] || "" },
      })));
    }
  }, [errorSet, errorReasons, nodes, setNodes]);

  // Mark agent nodes with execution state (running/completed/failed)
  useEffect(() => {
    const agentNodes = nodes.filter(n => n.type === "agent");
    if (agentNodes.length === 0) return;
    const needsUpdate = agentNodes.some((n, i) => {
      const current = (n.data as any)?.runState || "idle";
      let target = "idle";
      if (activeAgentIndices.includes(i)) {
        target = "running";
      } else if (completedAgents.includes(i)) {
        target = "done";
      }
      return current !== target;
    });
    if (needsUpdate) {
      setNodes(nds => nds.map(n => {
        if (n.type !== "agent") return n;
        const idx = agentNodes.findIndex(an => an.id === n.id);
        let runState = "idle";
        if (activeAgentIndices.includes(idx)) {
          runState = "running";
        } else if (completedAgents.includes(idx)) {
          runState = "done";
        }
        return { ...n, data: { ...n.data, runState } };
      }));
    }
  }, [activeAgentIndices, completedAgents, isRunning, nodes, setNodes]);

  // Mark human gate nodes with waiting/done/denied/revision state
  useEffect(() => {
    const humanNodes = nodes.filter(n => n.type === "human");
    if (humanNodes.length === 0) return;
    const getTarget = (n: any) => {
      if (deniedNodeIds.includes(n.id)) return "denied";
      if (approvedNodeIds.includes(n.id)) return "done";
      if (revisionNodeIds.includes(n.id)) return "revision";
      if (n.id === waitingNodeId) return "waiting";
      return "idle";
    };
    const needsUpdate = humanNodes.some(n => ((n.data as any)?.runState || "idle") !== getTarget(n));
    if (needsUpdate) {
      setNodes(nds => nds.map(n => {
        if (n.type !== "human") return n;
        return { ...n, data: { ...n.data, runState: getTarget(n) } };
      }));
    }
  }, [waitingNodeId, deniedNodeIds, approvedNodeIds, revisionNodeIds, isRunning, nodes, setNodes]);


  // ── Undo/Redo history ──────────────────────────────────────────────
  const undoStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const redoStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const skipHistory = useRef(false);

  const pushHistory = useCallback(() => {
    if (skipHistory.current) return;
    undoStack.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    skipHistory.current = true;
    setNodes(prev.nodes); setEdges(prev.edges);
    setTimeout(() => { skipHistory.current = false; }, 100);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
    skipHistory.current = true;
    setNodes(next.nodes); setEdges(next.edges);
    setTimeout(() => { skipHistory.current = false; }, 100);
  }, [nodes, edges, setNodes, setEdges]);

  // ── Copy/Paste ────────────────────────────────────────────────────
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  const copySelected = useCallback(() => {
    const sel = nodes.filter(n => n.selected && n.type !== "trigger" && n.type !== "end");
    if (sel.length === 0) return;
    const ids = new Set(sel.map(n => n.id));
    clipboardRef.current = { nodes: JSON.parse(JSON.stringify(sel)), edges: JSON.parse(JSON.stringify(edges.filter(e => ids.has(e.source) && ids.has(e.target)))) };
  }, [nodes, edges]);

  const pasteClipboard = useCallback(() => {
    if (!clipboardRef.current || clipboardRef.current.nodes.length === 0) return;
    pushHistory();
    const idMap: Record<string, string> = {};
    const newNodes = clipboardRef.current.nodes.map(n => { const nid = gid(); idMap[n.id] = nid; return { ...n, id: nid, selected: true, position: { x: n.position.x + 40, y: n.position.y + 40 } }; });
    const newEdges = clipboardRef.current.edges.map(e => ({ ...e, id: gid(), source: idMap[e.source] || e.source, target: idMap[e.target] || e.target })).filter(e => idMap[e.source] && idMap[e.target]);
    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes]);
    setEdges(eds => [...eds, ...newEdges]);
  }, [pushHistory, setNodes, setEdges]);

  // ── Undo/redo state ────────────────────────────────────────────────
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  useEffect(() => { setCanUndo(undoStack.current.length > 0); setCanRedo(redoStack.current.length > 0); }, [nodes, edges]);

  // ── Selection state ───────────────────────────────────────────────
  const hasSelection = nodes.some(n => n.selected && n.type !== "trigger" && n.type !== "end") || edges.some(e => e.selected);

  // ── Connect ───────────────────────────────────────────────────────
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    pushHistory();
    // Prevent duplicate edges
    const exists = edges.some(e => e.source === connection.source && e.target === connection.target);
    if (exists) return;
    const isSelf = connection.source === connection.target;
    const srcNode = nodes.find(n => n.id === connection.source);
    const srcIsCondition = srcNode?.type === "condition";
    // Check if target is an ancestor of source (feedback = creates a cycle)
    const isFeedback = !isSelf && connection.target && connection.source &&
      isAncestorInGraph(connection.target, connection.source, nodes, edges);

    // Auto-detect edge style from context
    let stroke = "rgba(139,92,246,0.3)";
    let label: string | undefined;
    let dash: string | undefined;
    let width = 2;

    if (isSelf) {
      stroke = "rgba(245,158,11,0.4)"; label = "loop"; dash = "6 3";
    } else if (srcIsCondition) {
      const existingFromCondition = edges.filter(e => e.source === connection.source).length;
      if (existingFromCondition === 0) {
        stroke = "rgba(16,185,129,0.4)"; label = "yes";
      } else {
        stroke = "rgba(239,68,68,0.4)"; label = "no";
      }
    } else if (isFeedback) {
      stroke = "rgba(245,158,11,0.4)"; label = "feedback"; dash = "6 3";
    }

    const edgeId = gid();
    const newEdge: Edge = {
      id: edgeId,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: isSelf ? "selfLoop" : "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke.replace(/[\d.]+\)$/, "0.6)") },
      style: { stroke, strokeWidth: width, ...(dash ? { strokeDasharray: dash } : {}) },
      label,
    };
    setEdges(eds => [...eds, newEdge]);
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, [pushHistory, setEdges, nodes, edges]);

  // ── Add node ──────────────────────────────────────────────────────
  const addNode = useCallback((type: string, agentType?: string) => {
    pushHistory();
    const id = gid();
    const x = 250 + Math.random() * 200;
    const y = 150 + Math.random() * 200;
    let newNode: Node;

    if (type === "agent") {
      newNode = { id, type: "agent", position: { x, y }, data: { agentType: agentType || "code", role: "", label: agentType || "Agent", maxTurns: 5, instructions: "", tools: [] } };
    } else if (type === "condition") {
      newNode = { id, type: "condition", position: { x, y }, data: { expression: "output.length > 100", label: "Check" } };
    } else if (type === "human") {
      newNode = { id, type: "human", position: { x, y }, data: { label: "Review", instructions: "" } };
    } else if (type === "workspace") {
      newNode = { id, type: "workspace", position: { x, y }, data: { workspaceName: "output", workspaceMode: "isolated", label: "Workspace" } };
    } else if (type === "trigger") {
      newNode = { id, type: "trigger", position: { x, y: 0 }, data: { triggerType: "manual", label: "Manual Run" } };
    } else return;

    setNodes(nds => [...nds, newNode]);
  }, [pushHistory, setNodes]);

  const deleteSelected = useCallback(() => {
    pushHistory();
    setNodes(nds => nds.filter(n => !n.selected || n.type === "trigger" || n.type === "end"));
    setEdges(eds => eds.filter(e => !e.selected));
  }, [pushHistory, setNodes, setEdges]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    if (locked) return;
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if (ctrl && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
      if (ctrl && e.key === "y") { e.preventDefault(); redo(); }
      if (ctrl && e.key === "c") { copySelected(); }
      if (ctrl && e.key === "v") { e.preventDefault(); pasteClipboard(); }
      if ((e.key === "Delete" || e.key === "Backspace") && !ctrl) { deleteSelected(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [locked, undo, redo, copySelected, pasteClipboard, deleteSelected]);

  const autoLayout = useCallback(() => {
    setNodes(nds => {
      const trigger = nds.find(n => n.type === "trigger");
      if (!trigger) return nds;
      // Simple BFS layout
      const layers: Record<string, number> = { [trigger.id]: 0 };
      const queue = [trigger.id];
      while (queue.length) {
        const c = queue.shift()!;
        for (const e of edges.filter(e => e.source === c)) {
          if (layers[e.target] === undefined) { layers[e.target] = (layers[c] || 0) + 1; queue.push(e.target); }
        }
      }
      nds.forEach(n => { if (layers[n.id] === undefined) layers[n.id] = Object.keys(layers).length; });
      const byLayer: Record<number, string[]> = {};
      Object.entries(layers).forEach(([id, l]) => (byLayer[l] ||= []).push(id));

      return nds.map(n => {
        const l = layers[n.id] || 0;
        const sibs = byLayer[l] || [n.id];
        const idx = sibs.indexOf(n.id);
        return { ...n, position: { x: 300 - (sibs.length * 200) / 2 + idx * 200 + 100, y: l * 120 } };
      });
    });
  }, [edges, setNodes]);

  const [canvasHover, setCanvasHover] = useState(false);
  const [patternDropdown, setPatternDropdown] = useState<{x: number; y: number} | null>(null);
  const [wsDropdown, setWsDropdown] = useState<{x: number; y: number} | null>(null);

  const PATTERNS = [
    { value: "sequential", label: "Sequential" },
    { value: "parallel", label: "Parallel" },
    { value: "supervisor", label: "Supervisor" },
    { value: "debate", label: "Debate" },
    { value: "swarm", label: "Swarm" },
  ];

  // Existing workspace nodes in graph
  const workspaceNodes = nodes.filter(n => n.type === "workspace");

  const openDropdown = (e: React.MouseEvent, setter: (pos: {x: number; y: number} | null) => void, other: (pos: null) => void) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    other(null);
    setter({ x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Canvas + Edit Panel */}
      <div className="flex gap-2 flex-1 min-h-0">
        <div className={`rounded-xl border border-white/[0.06] overflow-hidden ${selectedNode || selectedEdge ? "flex-1" : "w-full"} h-full`}
          onMouseEnter={() => setCanvasHover(true)} onMouseLeave={() => setCanvasHover(false)}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={locked ? undefined : onConnect}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={true}
            nodesConnectable={!locked}
            elementsSelectable={true}
            defaultEdgeOptions={{
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(139,92,246,0.5)" },
              style: { stroke: "rgba(139,92,246,0.3)", strokeWidth: 2 },
            }}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: false }}
            className="bg-[#060610]"
            connectionLineStyle={{ stroke: "rgba(139,92,246,0.5)", strokeWidth: 2 }}
            connectionLineType={"smoothstep" as any}
            snapToGrid
            snapGrid={[10, 10]}
            deleteKeyCode={null}
            multiSelectionKeyCode="Shift"
            isValidConnection={(connection) => !locked}
            connectOnClick={!locked}
          >
            <Background color="rgba(139,92,246,0.06)" gap={20} size={1} />
            <Controls className="!bg-[#0c0c14] !border-white/10 !rounded-lg [&>button]:!bg-[#0c0c14] [&>button]:!border-white/10 [&>button]:!text-slate-400 [&>button:hover]:!bg-white/5" />

            {/* Floating toolbar — auto-hides on mouse leave */}
            <Panel position="top-center">
              <div className={`transition-all duration-300 ease-in-out ${locked ? "hidden" : canvasHover || patternDropdown || wsDropdown ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0 pointer-events-none"}`}>
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#0c0c14]/90  border border-white/[0.08] shadow-xl max-w-[90vw] overflow-visible flex-wrap">
                  {/* Pattern dropdown */}
                  <button onClick={(e) => openDropdown(e, setPatternDropdown, setWsDropdown)} className="px-2 py-1 text-[9px] font-medium text-violet-300 bg-violet-500/10 hover:bg-violet-500/15 rounded transition-all flex items-center gap-1 capitalize shrink-0">
                    {pattern} <ChevronDown className="h-2.5 w-2.5" />
                  </button>

                  <div className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />

                  {/* Agent types */}
                  {["code", "research", "file", "memory", "plan", "rag", "ltp", "custom"].map(t => (
                    <button key={t} onClick={() => addNode("agent", t)} className="px-2 py-1 text-[9px] font-medium text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 rounded transition-all capitalize shrink-0">{t}</button>
                  ))}

                  <div className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />

                  {/* Special nodes */}
                  <button onClick={() => addNode("trigger")} className="px-2 py-1 text-[9px] font-medium text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 rounded transition-all flex items-center gap-1 shrink-0"><Zap className="h-2.5 w-2.5" /> Trigger</button>
                  <button onClick={() => addNode("condition")} className="px-2 py-1 text-[9px] font-medium text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-all shrink-0">Condition</button>
                  <button onClick={() => addNode("human")} className="px-2 py-1 text-[9px] font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-all flex items-center gap-1 shrink-0"><User className="h-2.5 w-2.5" /> Human</button>
                  <button onClick={() => addNode("workspace")} className="px-2 py-1 text-[9px] font-medium text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 rounded transition-all shrink-0">Workspace</button>

                  {/* Workflows dropdown */}
                  {savedWorkflows.length > 0 && (
                    <>
                      <div className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
                      <button onClick={(e) => openDropdown(e, setWsDropdown, setPatternDropdown)} className="px-2 py-1 text-[9px] font-medium text-pink-300 hover:text-pink-200 hover:bg-pink-500/10 rounded transition-all shrink-0 flex items-center gap-1">
                        <span className="text-[8px]">📦</span> Workflows <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                    </>
                  )}

                  <div className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
                  <button onClick={autoLayout} className="px-1.5 py-1 text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] rounded transition-all shrink-0" data-tooltip="Auto layout"><Layout className="h-3 w-3" /></button>
                  <button onClick={() => {
                    const data = JSON.stringify({
                      nodes: nodes.map(n => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
                      edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, style: e.style, type: e.type })),
                    }, null, 2);
                    navigator.clipboard.writeText(data).then(() => {
                      const btn = document.activeElement as HTMLButtonElement;
                      if (btn) { const orig = btn.dataset.tooltip; btn.dataset.tooltip = "Copied!"; setTimeout(() => { btn.dataset.tooltip = orig || ""; }, 1500); }
                    });
                  }} className="px-1.5 py-1 text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] rounded transition-all shrink-0" data-tooltip="Export graph"><Download className="h-3 w-3" /></button>
                  <button onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      const data = JSON.parse(text);
                      if (data.nodes && data.edges) {
                        setNodes(data.nodes);
                        setEdges(data.edges);
                      }
                    } catch { /* invalid clipboard */ }
                  }} className="px-1.5 py-1 text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] rounded transition-all shrink-0" data-tooltip="Import graph from clipboard"><Upload className="h-3 w-3" /></button>
                  <div className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
                  <button onClick={undo} disabled={!canUndo} className={`px-1.5 py-1 rounded transition-all shrink-0 ${canUndo ? "text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]" : "text-slate-700 cursor-default"}`} data-tooltip="Undo (Ctrl+Z)"><Undo2 className="h-3 w-3" /></button>
                  <button onClick={redo} disabled={!canRedo} className={`px-1.5 py-1 rounded transition-all shrink-0 ${canRedo ? "text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]" : "text-slate-700 cursor-default"}`} data-tooltip="Redo (Ctrl+Shift+Z)"><Redo2 className="h-3 w-3" /></button>
                </div>
              </div>
            </Panel>
            {/* Contextual selection bar */}
            {!locked && hasSelection && (
              <Panel position="bottom-right">
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#0c0c14]/90  border border-white/[0.08] shadow-xl animate-scale-in">
                  <button onClick={copySelected} className="px-2 py-1 text-[9px] font-medium text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 rounded transition-all flex items-center gap-1"><Copy className="h-2.5 w-2.5" /> Copy</button>
                  <button onClick={pasteClipboard} className="px-2 py-1 text-[9px] font-medium text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 rounded transition-all flex items-center gap-1"><Clipboard className="h-2.5 w-2.5" /> Paste</button>
                  <div className="w-px h-4 bg-white/[0.08] mx-0.5" />
                  <button onClick={deleteSelected} className="px-2 py-1 text-[9px] font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all flex items-center gap-1"><Trash2 className="h-2.5 w-2.5" /> Delete</button>
                </div>
              </Panel>
            )}

            {/* Validation warnings — floating inside canvas */}
            {validationWarnings && validationWarnings.length > 0 && (
              <Panel position="bottom-center">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-950/80  border border-red-500/20 shadow-lg max-w-[500px]">
                  <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
                  <span className="text-[9px] text-red-300 truncate">{validationWarnings.join(" · ")}</span>
                </div>
              </Panel>
            )}

            <MiniMap
              className="!bg-[#0c0c14] !border-white/10 !rounded-lg"
              nodeColor={(n) => {
                if (n.type === "trigger") return TRIGGER_COLORS[(n.data as TriggerNodeData)?.triggerType || "manual"] || "#8b5cf6";
                if (n.type === "agent") return AGENT_COLORS[(n.data as AgentNodeData)?.agentType || "code"] || "#6366f1";
                if (n.type === "condition") return "#f59e0b";
                if (n.type === "human") return "#3b82f6";
                if (n.type === "workspace") return "#14b8a6";
                if (n.type === "end") return "#10b981";
                return "#64748b";
              }}
              maskColor="rgba(0,0,0,0.7)"
            />
          </ReactFlow>
        </div>

        {/* ── Edit Panel ──────────────────────────────────────────────── */}
        {selectedNode && selectedNode.type !== "end" && (
          <div className={`w-60 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 overflow-y-auto animate-slide-in-right h-full ${locked ? "[&_input]:pointer-events-none [&_input]:opacity-60 [&_select]:pointer-events-none [&_select]:opacity-60 [&_textarea]:pointer-events-none [&_textarea]:opacity-60 [&_button:not([data-close])]:pointer-events-none [&_button:not([data-close])]:opacity-40" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-200 capitalize">{selectedNode.type}</span>
              {locked && <span className="text-[8px] text-amber-400/70 bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded">locked</span>}
              <button data-close onClick={() => setSelectedNodeId(null)} className="text-slate-600 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
            </div>

            {/* Trigger */}
            {selectedNode.type === "trigger" && (() => {
              const td = selectedNode.data as TriggerNodeData & Record<string, any>;
              const tt = td.triggerType || "manual";
              return (
              <>
                <div>
                  <label className="text-[9px] text-slate-500 block mb-1">Trigger Type</label>
                  <select value={tt} onChange={e => updateNodeData(selectedNode.id, { triggerType: e.target.value, label: e.target.value === "manual" ? "Manual Run" : e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]">
                    <option value="manual">👆 Manual</option>
                    <option value="scheduled">⏰ Scheduled</option>
                    <option value="cron">🔄 Cron</option>
                    <option value="interval">⏱ Interval</option>
                    <option value="watch">👁 Watch</option>
                    <option value="webhook">🔗 Webhook</option>
                  </select>
                </div>
                {tt === "cron" && (
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Cron expression</label>
                    <input value={td.cronExpression || ""} onChange={e => updateNodeData(selectedNode.id, { cronExpression: e.target.value })} placeholder="0 * * * *  (every hour)" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {[["Hourly","0 * * * *"],["Daily 9am","0 9 * * *"],["Every 15m","*/15 * * * *"],["Mon 8am","0 8 * * 1"]].map(([lbl,expr]) => (
                        <button key={expr} onClick={() => updateNodeData(selectedNode.id, { cronExpression: expr })} className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/8 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15">{lbl}</button>
                      ))}
                    </div>
                  </div>
                )}
                {tt === "interval" && (
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Every (seconds)</label>
                    <input type="number" min={5} value={td.intervalSeconds || 3600} onChange={e => updateNodeData(selectedNode.id, { intervalSeconds: Number(e.target.value) })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {[["1m",60],["5m",300],["15m",900],["1h",3600],["1d",86400]].map(([lbl,s]) => (
                        <button key={s} onClick={() => updateNodeData(selectedNode.id, { intervalSeconds: s })} className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/8 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/15">{lbl}</button>
                      ))}
                    </div>
                  </div>
                )}
                {tt === "scheduled" && (
                  <div className="flex gap-1.5">
                    <div className="flex-1"><label className="text-[9px] text-slate-500 block mb-1">Date</label>
                      <input type="date" value={td.scheduleDate || ""} onChange={e => updateNodeData(selectedNode.id, { scheduleDate: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" /></div>
                    <div className="flex-1"><label className="text-[9px] text-slate-500 block mb-1">Time</label>
                      <input type="time" value={td.scheduleTime || ""} onChange={e => updateNodeData(selectedNode.id, { scheduleTime: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" /></div>
                  </div>
                )}
                {tt === "webhook" && (
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Webhook path</label>
                    <input value={td.webhookPath || ""} onChange={e => updateNodeData(selectedNode.id, { webhookPath: e.target.value })} placeholder="/hooks/my-trigger" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                  </div>
                )}
                {tt === "watch" && (
                  <>
                    <div><label className="text-[9px] text-slate-500 block mb-1">Watch command</label>
                      <input value={td.watchCommand || ""} onChange={e => updateNodeData(selectedNode.id, { watchCommand: e.target.value })} placeholder="curl -s https://… | grep …" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" /></div>
                    <div><label className="text-[9px] text-slate-500 block mb-1">Re-run when</label>
                      <input value={td.watchCondition || ""} onChange={e => updateNodeData(selectedNode.id, { watchCondition: e.target.value })} placeholder="output changed / non-empty" className="w-full !py-1.5 !px-2 !text-[11px]" /></div>
                  </>
                )}
              </>
              );
            })()}

            {/* Agent */}
            {selectedNode.type === "agent" && (() => {
              const d = selectedNode.data as AgentNodeData;
              const agentNodes = nodes.filter(n => n.type === "agent");
              const agentIdx = agentNodes.findIndex(n => n.id === selectedNode.id);
              const output = agentOutputs[agentIdx];
              const isDoneAgent = completedAgents.includes(agentIdx);

              return (
                <>
                  {/* Params (always shown, locked when running/done) */}
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Name</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} placeholder="e.g. CodeReviewer" className="w-full !py-1.5 !px-2 !text-[11px] font-medium" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Type</label>
                    <select value={d.agentType || "code"} onChange={e => updateNodeData(selectedNode.id, { agentType: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px] capitalize">
                      {["code","research","file","memory","plan","rag","ltp","custom"].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Role</label>
                    <input value={d.role || ""} onChange={e => updateNodeData(selectedNode.id, { role: e.target.value })} placeholder="Role description" className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Max Turns</label>
                    <input type="number" value={d.maxTurns || 5} onChange={e => updateNodeData(selectedNode.id, { maxTurns: Number(e.target.value) })} min={1} max={20} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Instructions</label>
                    <textarea value={d.instructions || ""} onChange={e => updateNodeData(selectedNode.id, { instructions: e.target.value })} rows={3} placeholder="Custom instructions..." className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  {/* Extra tools */}
                  {availableTools.length > 0 && (
                    <div>
                      <button onClick={() => setToolsOpen(!toolsOpen)} className="flex items-center gap-1.5 text-[9px] text-slate-500 hover:text-slate-300 transition-colors mb-1">
                        <Settings className="h-2.5 w-2.5" />
                        Tools ({(d as any).tools?.[0] === "__none__" ? "none" : ((d as any).tools || []).length || (d.agentType === "custom" ? "all" : "default")})
                        <span className="text-[8px] text-slate-600 ml-auto">{(d as any).tools?.[0] === "__none__" ? "no tools" : d.agentType === "custom" && (d as any).tools?.length ? "only selected" : d.agentType === "custom" ? "all tools" : "base + selected"}</span>
                      </button>
                      {toolsOpen && (
                        <div className="max-h-[150px] overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.01] p-1.5 space-y-0.5">
                          <button onClick={() => updateNodeData(selectedNode.id, { tools: ["__none__"] })}
                            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all ${(d as any).tools?.[0] === "__none__" ? "bg-red-500/10 border border-red-500/20" : "hover:bg-white/[0.03]"}`}>
                            <div className={`h-2 w-2 rounded-sm border ${(d as any).tools?.[0] === "__none__" ? "bg-red-500 border-red-500" : "border-white/[0.15]"}`} />
                            <span className="text-[9px] font-medium text-red-400">No tools</span>
                            <span className="text-[8px] text-slate-600 ml-auto">Text only</span>
                          </button>
                          <div className="border-t border-white/[0.04] my-1" />
                          {availableTools.map(t => {
                            const selected = ((d as any).tools || []).includes(t.name);
                            return (
                              <button key={t.name} onClick={() => {
                                const current: string[] = (d as any).tools || [];
                                const next = selected ? current.filter((n: string) => n !== t.name) : [...current, t.name];
                                updateNodeData(selectedNode.id, { tools: next });
                              }}
                                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all ${selected ? "bg-violet-500/10 border border-violet-500/20" : "hover:bg-white/[0.03]"}`}
                              >
                                <div className={`h-2 w-2 rounded-sm border ${selected ? "bg-violet-500 border-violet-500" : "border-white/[0.15]"}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-medium text-slate-300 truncate">{t.name}</div>
                                  <div className="text-[8px] text-slate-600 truncate">{t.description}</div>
                                </div>
                                <span className="text-[7px] text-slate-700 shrink-0">{t.category}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Condition */}
            {selectedNode.type === "condition" && (() => {
              const d = selectedNode.data as ConditionNodeData;
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Label</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Expression</label>
                    <input value={d.expression || ""} onChange={e => updateNodeData(selectedNode.id, { expression: e.target.value })} placeholder="output.length > 100" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                  </div>
                </>
              );
            })()}

            {/* Human */}
            {selectedNode.type === "human" && (() => {
              const d = selectedNode.data as HumanNodeData;
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Gate Label</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Reviewer Instructions</label>
                    <textarea value={d.instructions || ""} onChange={e => updateNodeData(selectedNode.id, { instructions: e.target.value })} rows={3} placeholder="What to check..." className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div className="bg-blue-500/[0.06] border border-blue-500/15 rounded-lg px-2.5 py-2 text-[9px] text-blue-300">
                    Execution pauses here for human review.
                  </div>
                </>
              );
            })()}

            {/* Workspace */}
            {selectedNode.type === "workspace" && (() => {
              const d = selectedNode.data as WorkspaceNodeData;
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Workspace Name</label>
                    <input value={d.workspaceName || ""} onChange={e => updateNodeData(selectedNode.id, { workspaceName: e.target.value, label: e.target.value })} placeholder="output-folder" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Mode</label>
                    <select value={d.workspaceMode || "isolated"} onChange={e => updateNodeData(selectedNode.id, { workspaceMode: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]">
                      <option value="isolated">🔒 Isolated</option>
                      <option value="persistent">💾 Persistent</option>
                      <option value="user">👤 User workspace</option>
                    </select>
                  </div>
                </>
              );
            })()}

            {/* Workflow (sub-agent) */}
            {selectedNode.type === "workflow" && (() => {
              const d = selectedNode.data as WorkflowNodeData;
              const template = savedWorkflows.find(w => w.id === d.templateId);
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Workflow Name</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px] font-medium" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Description</label>
                    <input value={d.description || ""} onChange={e => updateNodeData(selectedNode.id, { description: e.target.value })} placeholder="What this workflow does" className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>

                  {/* Internal flow preview */}
                  <div className="rounded-lg bg-pink-500/[0.04] border border-pink-500/15 p-2.5 space-y-2">
                    <div className="text-[10px] text-pink-300 font-medium flex items-center gap-1.5">📦 {d.templateName} <span className="text-slate-600">· {d.pattern}</span></div>

                    {/* Agent chain preview */}
                    {template && template.config.agents.length > 0 && (
                      <div className="space-y-1">
                        {template.config.agents.map((a, i) => {
                          const color = AGENT_COLORS[a.type] || "#6366f1";
                          return (
                            <div key={i} className="flex items-center gap-2">
                              {i > 0 && <div className="w-3 flex justify-center"><div className="h-3 w-px bg-white/[0.1]" /></div>}
                              {i > 0 && null}
                              <div className="flex items-center gap-1.5 flex-1 rounded-md bg-white/[0.03] border border-white/[0.06] px-2 py-1">
                                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                <span className="text-[9px] text-slate-300 truncate">{a.name || a.role || a.type}</span>
                                <span className="text-[8px] text-slate-600 ml-auto">{a.type}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!template && (
                      <div className="text-[9px] text-slate-500">{d.agentCount} agents · template not found locally</div>
                    )}
                  </div>

                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-2 text-[9px] text-slate-400">
                    Runs as a single step. Input flows in, the internal agents execute, output flows out to the next node.
                  </div>
                </>
              );
            })()}

            {/* Delete */}
            {/* Output preview (below params, when agent completed) */}
            {selectedNode.type === "agent" && (() => {
              const agentNodes = nodes.filter(n => n.type === "agent");
              const idx = agentNodes.findIndex(n => n.id === selectedNode.id);
              const out = agentOutputs[idx];
              if (!out || !completedAgents.includes(idx)) return null;
              return (
                <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-2.5 animate-fade-in">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg className="h-3 w-3 text-emerald-400 shrink-0" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span className="text-[9px] font-semibold text-emerald-400">Output</span>
                  </div>
                  <div className="text-[10px] text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">{out}</div>
                </div>
              );
            })()}

            {!locked && selectedNode.type !== "trigger" && (
              <button onClick={() => { deleteSelected(); setSelectedNodeId(null); }} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/8 border border-red-500/15 rounded-lg transition-all">
                <Trash2 className="h-3 w-3" /> Delete Node
              </button>
            )}
          </div>
        )}

        {/* Edge edit panel */}
        {selectedEdge && (
          <div className="w-60 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 overflow-y-auto animate-slide-in-right h-full">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-200">Connection</span>
              <button onClick={() => setSelectedEdgeId(null)} className="text-slate-600 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="text-[10px] text-slate-400">
              {String(nodes.find(n => n.id === selectedEdge.source)?.data?.label || selectedEdge.source)}
              <span className="text-slate-600 mx-1">→</span>
              {String(nodes.find(n => n.id === selectedEdge.target)?.data?.label || selectedEdge.target)}
            </div>

            {/* Path style */}
            <div>
              <label className="text-[9px] text-slate-500 block mb-1.5">Path Style</label>
              <div className="grid grid-cols-2 gap-1">
                {[
                  { id: "smoothstep", label: "Smooth", preview: "M2,6 L8,6 Q12,6 12,10 L12,16 Q12,20 16,20 L22,20" },
                  { id: "default", label: "Bezier", preview: "M2,2 C8,14 16,8 22,20" },
                  { id: "step", label: "Step", preview: "M2,6 L12,6 L12,16 L22,16" },
                  { id: "straight", label: "Straight", preview: "M2,2 L22,20" },
                ].map(pt => {
                  const isSelf = selectedEdge.source === selectedEdge.target;
                  const currentType = isSelf ? "selfLoop" : (selectedEdge.type || "smoothstep");
                  const isActive = currentType === pt.id;
                  return (
                    <button key={pt.id} onClick={() => {
                      if (!isSelf) updateEdgeData(selectedEdge.id, { type: pt.id as any });
                    }}
                      disabled={isSelf}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-all ${isActive ? "bg-violet-500/10 border border-violet-500/20" : "bg-white/[0.01] border border-white/[0.04] hover:bg-white/[0.03]"} ${isSelf ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <svg width="24" height="22" className="shrink-0">
                        <path d={pt.preview} fill="none" stroke={isActive ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.2)"} strokeWidth="1.5" />
                      </svg>
                      <span className="text-[9px] text-slate-400">{pt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom label */}
            <div>
              <label className="text-[9px] text-slate-500 block mb-1">Label</label>
              <input value={selectedEdge.label as string || ""} onChange={e => updateEdgeData(selectedEdge.id, { label: e.target.value })} placeholder="optional label" className="w-full !py-1.5 !px-2 !text-[11px]" />
            </div>

            {/* Delete */}
            {!locked && (
              <button onClick={() => { setEdges(eds => eds.filter(e => e.id !== selectedEdge.id)); setSelectedEdgeId(null); }} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/8 border border-red-500/15 rounded-lg transition-all">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            )}
          </div>
        )}
      </div>


      {/* Fixed-position dropdowns (outside overflow containers) */}
      {patternDropdown && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setPatternDropdown(null)} />
          <div className="fixed z-[61] bg-[#0c0c14] border border-white/[0.1] rounded-lg shadow-2xl shadow-black/50 py-1 min-w-[140px] animate-fade-in"
            style={{ left: patternDropdown.x, top: patternDropdown.y }}>
            {PATTERNS.map(p => (
              <button key={p.value} onClick={() => { onPatternChange?.(p.value); setPatternDropdown(null); }}
                className={`w-full text-left px-3 py-1.5 text-[10px] transition-all ${pattern === p.value ? "text-violet-300 bg-violet-500/10" : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}

      {wsDropdown && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setWsDropdown(null)} />
          <div className="fixed z-[61] bg-[#0c0c14] border border-white/[0.1] rounded-lg shadow-2xl shadow-black/50 py-1 min-w-[200px] animate-fade-in"
            style={{ left: wsDropdown.x, top: wsDropdown.y }}>
            {savedWorkflows.map(w => (
              <button key={w.id} onClick={() => {
                const id = gid();
                setNodes(nds => [...nds, {
                  id, type: "workflow",
                  position: { x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 },
                  data: { templateId: w.id, templateName: w.name, label: w.name, agentCount: w.config.agents.length, pattern: w.config.pattern, description: "" },
                }]);
                setWsDropdown(null);
              }}
                className="w-full text-left px-3 py-1.5 text-[10px] text-slate-300 hover:text-pink-300 hover:bg-pink-500/10 transition-all flex items-center gap-2 truncate">
                <span className="text-[9px]">📦</span>
                <span className="truncate flex-1">{w.name}</span>
                <span className="text-[8px] text-slate-600 shrink-0">{w.config.agents.length} agents</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
