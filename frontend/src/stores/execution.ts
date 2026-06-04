import { create } from "zustand";

export type EventType =
  | "task_started"
  | "task_complete"
  | "turn_started"
  | "turn_complete"
  | "tool_call"
  | "tool_result"
  | "token"
  | "error"
  | "context_bootstrapped"
  | "plan_enforced"
  | "agent_handoff"
  | "agent_started"
  | "agent_completed"
  | string; // Backend may send other event types

export interface StreamEvent {
  id: string;
  type: EventType;
  message: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface GraphNode {
  id: string;
  eventId: string;  // maps back to StreamEvent.id for bidirectional selection
  type: "task" | "turn" | "tool_call" | "tool_result" | "complete" | "error";
  label: string;
  status: "active" | "done" | "error" | "pending";
  data: Record<string, unknown>;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export type StreamStatus = "idle" | "connecting" | "streaming" | "completed" | "error";

interface ExecutionStore {
  // Stream state
  status: StreamStatus;
  taskId: string | null;
  events: StreamEvent[];
  activeEventId: string | null;

  // Live token stream — assistant text for the current turn, accumulated from
  // llm.delta events as they arrive (typewriter). Reset at each turn boundary.
  streamingText: string;

  // Graph state
  nodes: GraphNode[];
  edges: GraphEdge[];

  // Metrics
  turns: number;
  tokens: number;
  cost: number;
  elapsed: number;
  startTime: number | null;

  // View state
  viewState: "idle" | "running" | "completed" | "reviewing";
  rightPanelTab: "live" | "analytics" | "alerts" | "studio";
  showTaskHistory: boolean;
  drawerOpen: boolean;

  // Actions
  startStream: (taskId: string) => void;
  addEvent: (event: StreamEvent) => void;
  setStatus: (status: StreamStatus) => void;
  setActiveEvent: (id: string | null) => void;
  reset: () => void;
  tick: () => void;
  loadTrace: (taskId: string, turns: Array<{ role: string; tool?: string; duration_ms?: number; tokens?: number; success?: boolean; content?: string }>, totalTokens?: number, totalCost?: number, taskStatus?: string) => void;
  setViewState: (state: "idle" | "running" | "completed" | "reviewing") => void;
  setRightPanelTab: (tab: "live" | "analytics" | "alerts" | "studio") => void;
  toggleTaskHistory: () => void;
  setDrawerOpen: (open: boolean) => void;
}

let nodeCounter = 0;

function eventToNode(event: StreamEvent): GraphNode | null {
  const id = `node-${++nodeCounter}`;
  const eid = event.id;

  switch (event.type) {
    case "task_started":
      return { id, eventId: eid, type: "task", label: (event.data.goal as string) || "Task", status: "active", data: event.data, x: 0, y: 0 };
    case "turn_started":
      return { id, eventId: eid, type: "turn", label: `Turn ${event.data.turn || "?"}`, status: "active", data: event.data, x: 0, y: 0 };
    case "turn_complete":
      return null; // Update previous turn node instead
    case "tool_call":
      return { id, eventId: eid, type: "tool_call", label: (event.data.tool_name as string) || (event.data.tool as string) || "Tool", status: "active", data: event.data, x: 0, y: 0 };
    case "tool_result":
      return { id, eventId: eid, type: "tool_result", label: (event.data.tool_name as string) || (event.data.tool as string) || "Result", status: event.data.success === false ? "error" : "done", data: event.data, x: 0, y: 0 };
    case "agent_started":
      return { id, eventId: eid, type: "turn", label: (event.data.agent_role as string) || (event.data.agent_type as string) || "Agent", status: "active", data: event.data, x: 0, y: 0 };
    case "agent_completed":
      return { id, eventId: eid, type: "tool_result", label: `${(event.data.agent_role as string) || "Agent"} done`, status: "done", data: event.data, x: 0, y: 0 };
    case "agent_handoff":
      return { id, eventId: eid, type: "turn", label: "Human Review", status: "active", data: event.data, x: 0, y: 0 };
    case "task_complete":
      return { id, eventId: eid, type: "complete", label: "Complete", status: "done", data: event.data, x: 0, y: 0 };
    case "task_failed":
      return { id, eventId: eid, type: "error", label: "Failed", status: "error", data: event.data, x: 0, y: 0 };
    case "error":
      return { id, eventId: eid, type: "error", label: (event.data.error as string)?.slice(0, 40) || "Error", status: "error", data: event.data, x: 0, y: 0 };
    default:
      return null;
  }
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  status: "idle",
  taskId: null,
  events: [],
  activeEventId: null,
  streamingText: "",
  nodes: [],
  edges: [],
  turns: 0,
  tokens: 0,
  cost: 0,
  elapsed: 0,
  startTime: null,
  viewState: "idle",
  rightPanelTab: "live",
  showTaskHistory: false,
  drawerOpen: false,

  startStream: (taskId) => {
    nodeCounter = 0;
    set({
      taskId,
      status: "connecting",
      events: [],
      streamingText: "",
      nodes: [],
      edges: [],
      activeEventId: null,
      turns: 0,
      tokens: 0,
      cost: 0,
      elapsed: 0,
      startTime: Date.now(),
      viewState: "running",
      rightPanelTab: "live",
      drawerOpen: false,
    });
  },

  addEvent: (event) => {
    const state = get();

    // Live token stream: accumulate assistant text without creating a node or event row
    // per token (there can be hundreds). A new turn starts fresh.
    if (event.type === "token") {
      if (event.message) set({ streamingText: state.streamingText + event.message });
      return;
    }
    const streamingText = event.type === "turn_started" ? "" : state.streamingText;

    const newEvents = [...state.events, event];
    const node = eventToNode(event);

    let newNodes = state.nodes;
    let newEdges = state.edges;
    let turns = state.turns;
    let tokens = state.tokens;
    let cost = state.cost;

    // Mark previous active nodes as done
    if (node) {
      newNodes = state.nodes.map((n) =>
        n.status === "active" ? { ...n, status: "done" as const } : n
      );
      newNodes = [...newNodes, node];

      // Add edge from last node
      if (newNodes.length > 1) {
        const prev = newNodes[newNodes.length - 2];
        newEdges = [...state.edges, { id: `edge-${prev.id}-${node.id}`, source: prev.id, target: node.id }];
      }
    }

    // Update metrics
    if (event.type === "turn_complete" || event.type === "agent_completed") {
      turns = state.turns + 1;
      // Mark latest turn node as done
      newNodes = newNodes.map((n) =>
        n.type === "turn" && n.status === "active" ? { ...n, status: "done" as const } : n
      );
    }
    if (event.type === "tool_result") {
      // Update tokens from tool results if available
      if (event.data.tokens) tokens = state.tokens + (event.data.tokens as number);
    }
    if (event.type === "task_complete") {
      tokens = (event.data.tokens as number) || state.tokens;
      cost = (event.data.cost as number) || state.cost;
      turns = (event.data.turns as number) || state.turns;
    }

    const isTerminal = event.type === "task_complete" || event.type === "task_failed" || event.type === "error";

    set({
      events: newEvents,
      nodes: newNodes,
      edges: newEdges,
      activeEventId: event.id,
      streamingText,
      turns,
      tokens,
      cost,
      status: isTerminal ? "completed" : "streaming",
      ...(isTerminal ? { viewState: "completed" as const } : {}),
    });
  },

  setStatus: (status) => set({ status }),
  setActiveEvent: (id) => set({ activeEventId: id }),
  reset: () => {
    nodeCounter = 0;
    set({
      status: "idle",
      taskId: null,
      events: [],
      activeEventId: null,
      streamingText: "",
      nodes: [],
      edges: [],
      turns: 0,
      tokens: 0,
      cost: 0,
      elapsed: 0,
      startTime: null,
      viewState: "idle",
      showTaskHistory: false,
      drawerOpen: false,
    });
  },
  tick: () => {
    const { startTime, status } = get();
    if (startTime && status === "streaming") {
      set({ elapsed: Date.now() - startTime });
    }
  },

  loadTrace: (taskId, turns, totalTokens, totalCost, taskStatus?: string) => {
    nodeCounter = 0;
    const events: StreamEvent[] = [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Create task start node
    const startId = `node-${++nodeCounter}`;
    nodes.push({ id: startId, eventId: "evt-start", type: "task", label: "Task", status: "done", data: { task_id: taskId }, x: 0, y: 0 });
    events.push({ id: "evt-start", type: "task_started", message: "Task started", data: { task_id: taskId }, timestamp: new Date().toISOString() });

    let prevNodeId = startId;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const nodeId = `node-${++nodeCounter}`;
      const evtId = `evt-${i}`;

      let nodeType: GraphNode["type"] = "turn";
      let label = `Turn ${i + 1}`;
      let evtType = "turn_complete";

      if (turn.role === "tool_call" || (turn.tool && turn.role !== "tool_result")) {
        nodeType = "tool_call";
        label = turn.tool || "Tool";
        evtType = "tool_call";
      } else if (turn.role === "tool_result") {
        nodeType = "tool_result";
        label = turn.tool || "Result";
        evtType = "tool_result";
      }

      const status: GraphNode["status"] = turn.success === false ? "error" : "done";
      nodes.push({ id: nodeId, eventId: evtId, type: nodeType, label, status, data: { ...turn, turn: i + 1 }, x: 0, y: 0 });
      edges.push({ id: `edge-${prevNodeId}-${nodeId}`, source: prevNodeId, target: nodeId });
      events.push({ id: evtId, type: evtType, message: turn.tool || turn.role || "", data: { ...turn, turn: i + 1 }, timestamp: new Date().toISOString() });
      prevNodeId = nodeId;
    }

    // Terminal node — only add if task is actually done (not still running)
    const isDone = !taskStatus || taskStatus === "completed" || taskStatus === "failed" || taskStatus === "cancelled";
    if (isDone) {
      const isFailed = taskStatus === "failed" || taskStatus === "cancelled";
      const terminalId = `node-${++nodeCounter}`;
      nodes.push({
        id: terminalId, eventId: "evt-terminal",
        type: isFailed ? "error" : "complete",
        label: isFailed ? "Failed" : "Complete",
        status: isFailed ? "error" : "done",
        data: {}, x: 0, y: 0,
      });
      edges.push({ id: `edge-${prevNodeId}-${terminalId}`, source: prevNodeId, target: terminalId });
      events.push({ id: "evt-terminal", type: isFailed ? "task_failed" : "task_complete", message: isFailed ? "Failed" : "Done", data: { tokens: totalTokens, cost: totalCost, turns: turns.length }, timestamp: new Date().toISOString() });
    }

    set({
      taskId,
      status: isDone ? "completed" : "streaming",
      // viewState drives the page's "Live" indicator — keep it in sync with the loaded
      // task's real state so opening/polling a finished trace doesn't stay stuck "Streaming".
      viewState: isDone ? "completed" : "running",
      events,
      nodes,
      edges,
      activeEventId: null,
      turns: turns.length,
      tokens: totalTokens || 0,
      cost: totalCost || 0,
      elapsed: 0,
      startTime: null,
    });
  },

  setViewState: (viewState) => set({ viewState }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  toggleTaskHistory: () => set((state) => ({ showTaskHistory: !state.showTaskHistory })),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));
