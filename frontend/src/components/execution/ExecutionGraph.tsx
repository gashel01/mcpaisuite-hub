"use client";

import { useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
  Position, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Play, CheckCircle2, Wrench, MessageSquare, AlertCircle, RotateCw, Zap,
} from "lucide-react";
import { useExecutionStore, type GraphNode } from "@/stores/execution";

// ── Node styles ────────────────────────────────────────────────────────────

const NODE_STYLES: Record<string, { icon: typeof Play; color: string; bg: string; border: string; ring: string }> = {
  task:        { icon: Play, color: "text-violet-300", bg: "bg-violet-950/90", border: "border-violet-500/50", ring: "ring-violet-400/60" },
  turn:        { icon: RotateCw, color: "text-blue-300", bg: "bg-blue-950/90", border: "border-blue-500/50", ring: "ring-blue-400/60" },
  tool_call:   { icon: Wrench, color: "text-amber-300", bg: "bg-amber-950/90", border: "border-amber-500/50", ring: "ring-amber-400/60" },
  tool_result: { icon: MessageSquare, color: "text-slate-300", bg: "bg-slate-800/90", border: "border-slate-600/50", ring: "ring-slate-400/60" },
  complete:    { icon: CheckCircle2, color: "text-emerald-300", bg: "bg-emerald-950/90", border: "border-emerald-500/50", ring: "ring-emerald-400/60" },
  error:       { icon: AlertCircle, color: "text-red-300", bg: "bg-red-950/90", border: "border-red-500/50", ring: "ring-red-400/60" },
};

// ── Custom Node Component ──────────────────────────────────────────────────

function ExecutionNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) || "task";
  const style = NODE_STYLES[nodeType] || NODE_STYLES.task;
  const Icon = style.icon;
  const isActive = data.isActive as boolean;
  const nodeStatus = data.status as string;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-violet-500/50 !border-violet-400/30 !w-2 !h-2" />
      <div
        className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-colors min-w-[170px] ${style.bg} ${style.border} ${
          selected || isActive ? `ring-2 ${style.ring} shadow-lg` : "hover:ring-1 hover:ring-white/20"
        }`}
      >
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.bg} border ${style.border}`}>
          <Icon className={`h-4 w-4 ${style.color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-medium truncate ${style.color}`}>{data.label as string}</p>
          <p className="text-[10px] text-slate-500 capitalize">{nodeType.replace(/_/g, " ")}</p>
        </div>
        {nodeStatus === "active" && (
          <div className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500/50 !border-violet-400/30 !w-2 !h-2" />
    </>
  );
}

const nodeTypes = { execution: ExecutionNode };

// ── Main Component ─────────────────────────────────────────────────────────

export default function ExecutionGraph() {
  const storeNodes = useExecutionStore(s => s.nodes);
  const storeEdges = useExecutionStore(s => s.edges);
  const activeEventId = useExecutionStore(s => s.activeEventId);
  const setActiveEvent = useExecutionStore(s => s.setActiveEvent);
  const setDrawerOpen = useExecutionStore(s => s.setDrawerOpen);

  // Find active node
  const activeNode = activeEventId
    ? storeNodes.find(n => n.eventId === activeEventId)
    : null;
  const activeNodeId = activeNode?.id ?? (storeNodes.length > 0 ? storeNodes[storeNodes.length - 1]?.id : null);

  // Convert store nodes → ReactFlow nodes (vertical layout)
  const rfNodes: Node[] = useMemo(() => {
    return storeNodes.map((n, i) => ({
      id: n.id,
      type: "execution",
      position: { x: 0, y: i * 100 },
      data: {
        label: n.label,
        nodeType: n.type,
        status: n.status,
        isActive: n.id === activeNodeId,
        eventId: n.eventId,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }));
  }, [storeNodes, activeNodeId]);

  // Convert store edges → ReactFlow edges
  const rfEdges: Edge[] = useMemo(() => {
    return storeEdges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: false,
      style: { stroke: "rgba(139, 92, 246, 0.35)", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(139, 92, 246, 0.5)", width: 16, height: 12 },
    }));
  }, [storeEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync store → ReactFlow nodes/edges
  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  // Auto-layout: position nodes vertically with dagre-like spacing
  useEffect(() => {
    if (rfNodes.length === 0) return;
    const positioned = rfNodes.map((n, i) => ({
      ...n,
      position: { x: 120, y: i * 100 },
    }));
    setNodes(positioned);
  }, [storeNodes.length]); // eslint-disable-line

  // Handle node click → select event + open drawer
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const eventId = node.data?.eventId as string;
    if (eventId) {
      setActiveEvent(eventId);
      setDrawerOpen(true);
    }
  }, [setActiveEvent, setDrawerOpen]);

  if (storeNodes.length === 0) {
    return (
      <div className="relative w-full h-full overflow-auto bg-[#0a0a10] rounded-xl border border-slate-800/60 flex items-center justify-center">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "radial-gradient(circle, #8b5cf6 1px, transparent 1px)", backgroundSize: "24px 24px" }}
        />
        <div className="text-center relative z-10">
          <div className="h-12 w-12 mx-auto mb-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Zap className="h-5 w-5 text-violet-400" />
          </div>
          <p className="text-sm text-slate-500">Start a task to see the execution graph</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[#0a0a10] rounded-xl border border-slate-800/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(139, 92, 246, 0.06)" gap={24} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-[#14142a] !border-white/[0.06] !rounded-lg !shadow-lg [&>button]:!bg-[#14142a] [&>button]:!border-white/[0.06] [&>button]:!text-slate-400 [&>button:hover]:!bg-violet-500/10 [&>button:hover]:!text-violet-300"
        />
        <MiniMap
          nodeColor={(n) => {
            const t = n.data?.nodeType as string;
            if (t === "complete") return "#10b981";
            if (t === "error") return "#ef4444";
            if (t === "tool_call") return "#f59e0b";
            if (t === "task") return "#8b5cf6";
            return "#3b82f6";
          }}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-[#0a0a14] !border-white/[0.06] !rounded-lg"
        />
      </ReactFlow>
    </div>
  );
}
