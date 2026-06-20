"use client";
import { apiFetch } from "@/lib/api";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, addEdge, useReactFlow,
  Handle, Position, MarkerType, BaseEdge, getSmoothStepPath,
  type Node, type Edge, type Connection, type NodeTypes, type NodeProps, type EdgeTypes, type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, Layout, User, Settings, Sparkles, X, ChevronDown, AlertCircle, Download, Upload, Undo2, Redo2, Copy, Clipboard, Zap, Search, Check, Cpu } from "lucide-react";
import type { TeamAgent } from "@/stores/agent-sessions";

// ── Types ──────────────────────────────────────────────────────────────────


import type { TriggerType, WorkspaceMode, AgentNodeData, TriggerNodeData, ConditionNodeData, HumanNodeData, WorkspaceNodeData, EndNodeData, WorkflowNodeData } from "./flow-types";
import { AGENT_COLORS, TRIGGER_COLORS, AgentNode, nodeTypes, edgeTypes } from "./flow-nodes";
import { buildInitialFlow, bfsLayout, gid, isAncestorInGraph, edgeLabelDeco } from "./flow-graph";
import { NodeInspector } from "./flow-node-inspector";

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
  building?: boolean;
  locked?: boolean;
  topologyOnly?: boolean;  // Observability: pure read-only viewer — no node/edge selection, no inspector, no drag.
  waitingNodeId?: string | null;
  deniedNodeIds?: string[];
  approvedNodeIds?: string[];
  revisionNodeIds?: string[];
  agentOutputs?: Record<number, string>;
  onPatternChange?: (pattern: string) => void;
  onUpdateFlow: (nodes: Node[], edges: Edge[]) => void;
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function FlowEditor({ agents, pattern, triggerType: propTriggerType, triggerConfig, workspaceEnabled, workspaceName, workspaceMode, humanGates, errorNodeIds, errorReasons, validationWarnings, graphRef, initialGraph, activeAgentIndex = -1, activeAgentIndices = [], completedAgents = [], isRunning = false, building = false, locked = false, topologyOnly = false, waitingNodeId = null, deniedNodeIds = [], approvedNodeIds = [], revisionNodeIds = [], agentOutputs = {}, onPatternChange, onUpdateFlow }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // ReactFlow instance (captured via onInit) so we can drive fitView programmatically.
  const rfRef = useRef<any>(null);

  // Load available tools from backend
  const [availableTools, setAvailableTools] = useState<{name: string; description: string; category: string}[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const [toolCat, setToolCat] = useState<"all" | "built-in" | "mcp" | "langchain">("all");
  useEffect(() => {
    apiFetch<any>("/tools").then(data => {
      const tools: {name: string; description: string; category: string}[] = [];
      (data.built_in?.tools || []).forEach((t: any) => tools.push({ name: t.name, description: t.description, category: "built-in" }));
      (data.mcp_external?.tools || []).forEach((t: any) => tools.push({ name: t.name, description: t.description, category: "mcp" }));
      (data.langchain?.tools || []).forEach((t: any) => tools.push({ name: t.name, description: t.description, category: "langchain" }));
      setAvailableTools(tools);
    }).catch(() => {});
  }, []);

  // Load saved LLM connections so each node can pick its own model (else uses global default)
  const [connections, setConnections] = useState<{id: string; name: string; provider: string; model: string}[]>([]);
  useEffect(() => {
    apiFetch<any>("/llm/connections").then(d => setConnections(d.connections || [])).catch(() => {});
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
  // Structural identity = the set/order of agent ids (data changes are handled by the
  // soft-sync below; this only triggers a rebuild on add/remove/reorder). Id-based so
  // deterministic tool/code entries are treated like any other node.
  const agentsKey = agents.map(a => a.id).join(",");
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
    // When this rebuild is driven by the AI architect (building in progress), the
    // pattern-specific positions from buildInitialFlow can overlap/scatter — so tidy the
    // brand-new graph with the shared auto-layout right here, on the fresh nodes/edges.
    // Doing it on `n`/`e` directly (not via state) avoids any race with setNodes/setEdges.
    setNodes(building ? bfsLayout(n, e) : n);
    setEdges(e);
    if (building) {
      const t = setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 400 }), 80);
      return () => clearTimeout(t);
    }
  }, [configKey]); // eslint-disable-line

  // Soft-sync agent node DATA (tools, instructions, maxTurns, type, role) from the agents prop
  // WITHOUT a structural rebuild — so AI-architect refinements that change tools/instructions
  // reflect on existing nodes (positions/edges kept). Without this, the debounced sync-back
  // would overwrite the architect's change with stale node data. The `changed` guard keeps it
  // from looping (returns the same nodes when nothing differs).
  // Map by node id (== agent id), not position, so interleaved deterministic
  // tool/code nodes don't drift the agent↔node alignment.
  const agentDataKey = agents.map(a => `${a.id}|${a.kind || a.type}|${a.role}|${(a.tools || []).join(",")}|${a.instructions || ""}|${a.max_turns}|${a.tool || ""}|${a.args || ""}|${a.code || ""}`).join("§");
  useEffect(() => {
    if (isFirstMount.current) return;
    setNodes(nds => {
      const byId = new Map(agents.map(a => [a.id, a]));
      let changed = false;
      const out = nds.map(n => {
        const a = byId.get(n.id);
        if (!a) return n;
        const d = n.data as any;
        if (n.type === "tool" || n.type === "code") {
          if ((d.tool || "") === (a.tool || "") && (d.args || "") === (a.args || "") && (d.code || "") === (a.code || "")) return n;
          changed = true;
          return { ...n, data: { ...d, kind: a.kind, tool: a.tool || "", args: a.args || "{}", code: a.code || "" } };
        }
        if (n.type !== "agent") return n;
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
      // Mark this agents key as internally generated (so rebuild doesn't trigger).
      // Must match agentsKey (agent ids, in order) — includes deterministic tool/code nodes.
      internalAgentsKey.current = nodes
        .filter(n => n.type === "agent" || n.type === "tool" || n.type === "code")
        .map(n => n.id).join(",");
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
    let rgb = "139,92,246";
    let label: string | undefined;
    let dash: string | undefined;
    let width = 2;

    if (isSelf) {
      stroke = "rgba(245,158,11,0.4)"; rgb = "245,158,11"; label = "loop"; dash = "6 3";
    } else if (srcIsCondition) {
      const existingFromCondition = edges.filter(e => e.source === connection.source).length;
      if (existingFromCondition === 0) {
        stroke = "rgba(16,185,129,0.4)"; rgb = "16,185,129"; label = "yes";
      } else {
        stroke = "rgba(239,68,68,0.4)"; rgb = "239,68,68"; label = "no";
      }
    } else if (isFeedback) {
      stroke = "rgba(245,158,11,0.4)"; rgb = "245,158,11"; label = "feedback"; dash = "6 3";
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
      // Style the rendered label (smoothstep edges) to match the line; self-loops use a
      // custom edge that doesn't render a label, so skip the decoration there.
      ...(label && !isSelf ? edgeLabelDeco(rgb) : {}),
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
    } else if (type === "tool") {
      newNode = { id, type: "tool", position: { x, y }, data: { kind: "tool", label: "Tool", tool: "web_search", args: "{}", code: "" } };
    } else if (type === "code") {
      newNode = { id, type: "code", position: { x, y }, data: { kind: "code", label: "Python", tool: "", args: "{}", code: "# deterministic python\nprint('hello')" } };
    } else if (type === "map") {
      newNode = { id, type: "map", position: { x, y }, data: { label: "Map", over: "${input}", reducer: "append", into: "", max_fanout: 50, body: { kind: "tool", tool: "web_fetch", args: '{"url": "${item}"}', code: "" } } };
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
      // Don't hijack keystrokes while typing in a field (inspector inputs/textareas/selects):
      // Backspace/Delete must edit text, not delete the selected node; Ctrl+C/V/Z stay native.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
    setNodes(nds => bfsLayout(nds, edges));
  }, [edges, setNodes]);

  // After the AI architect finishes building (building: true → false), do a final tidy +
  // fit. The rebuild effect already lays the new graph out race-free while building is in
  // progress; this is a safety net (re-runs the same auto-layout on the now-settled state,
  // then fits the viewport — same as ReactFlow's "fit view" control).
  const prevBuilding = useRef(building);
  useEffect(() => {
    const was = prevBuilding.current;
    prevBuilding.current = building;
    if (!was || building) return; // only fire on the build-finished edge
    const t1 = setTimeout(() => autoLayout(), 80);
    const t2 = setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 400 }), 220);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [building, autoLayout]);

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
            onInit={(inst) => { rfRef.current = inst; }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={locked ? undefined : onConnect}
            onNodeClick={topologyOnly ? undefined : (_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={topologyOnly ? undefined : (_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={!topologyOnly}
            nodesConnectable={!locked && !topologyOnly}
            elementsSelectable={!topologyOnly}
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
                  <button onClick={() => addNode("tool")} className="px-2 py-1 text-[9px] font-medium text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 rounded transition-all shrink-0" title="Run a governed tool — no LLM">⚙ Tool</button>
                  <button onClick={() => addNode("code")} className="px-2 py-1 text-[9px] font-medium text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 rounded transition-all shrink-0" title="Run sandboxed Python — no LLM (vs the 'code' agent which uses an LLM)">🐍 Python</button>
                  <button onClick={() => addNode("map")} className="px-2 py-1 text-[9px] font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-all shrink-0" title="Fan out over a runtime list — run the body in parallel for each item, then reduce">🔀 Map</button>

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
        <NodeInspector selectedNode={selectedNode} updateNodeData={updateNodeData} availableTools={availableTools} connections={connections} nodes={nodes} setSelectedNodeId={setSelectedNodeId} deleteSelected={deleteSelected} locked={locked} agentOutputs={agentOutputs} completedAgents={completedAgents} savedWorkflows={savedWorkflows} toolsOpen={toolsOpen} setToolsOpen={setToolsOpen} toolCat={toolCat} setToolCat={setToolCat} toolSearch={toolSearch} setToolSearch={setToolSearch} />

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
