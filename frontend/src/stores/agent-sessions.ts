import { create } from "zustand";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamAgent {
  id: string;
  name: string;
  description: string;
  type: string;
  role: string;
  max_turns: number;
  instructions: string;
  tools: string[];
}

export interface LiveAgentEvent {
  agentIndex: number;
  agentType: string;
  agentRole: string;
  type: "thinking" | "tool_call" | "tool_result" | "message" | "done" | "error" | "input" | "condition" | "human_gate" | "skipped";
  content: string;
  toolName?: string;
  nodeId?: string;
  hasFeedback?: boolean;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  config: {
    goal: string;
    agents: TeamAgent[];
    pattern: string;
    constitution: string;
    // Trigger
    triggerType: "manual" | "scheduled" | "cron" | "interval" | "watch" | "webhook";
    scheduleDate?: string;
    scheduleTime?: string;
    cronExpression?: string;
    intervalSeconds?: number;
    watchCommand?: string;
    watchCondition?: string;
    webhookPath?: string;
    // Workspace
    workspaceEnabled: boolean;
    workspaceName?: string;
    workspaceMode?: "user" | "isolated" | "persistent";
    autoCheckpoint?: boolean;
    // Human gates (indices of agents that need human review after)
    humanGates: number[];
  };
  graph: { nodes: any[]; edges: any[] } | null;
  status: "configuring" | "running" | "waiting" | "completed" | "failed";
  taskId: string | null;
  convId: string | null;
  liveEvents: LiveAgentEvent[];
  activeAgentIndex: number; // legacy — last started agent
  activeAgentIndices: number[]; // all currently running agents
  completedAgents: number[];
  answer: string | null;
  streamingText: string; // live assistant text for the current turn (typewriter), reset at boundaries
  metrics: { tokens: number; cost: number; turns: number; duration: number } | null;
  feedback: { rating: "good" | "bad" | null; comment: string } | null;
  readOnly: boolean;
  workflowId?: string;
  versionId?: string;
  runId?: string;
  workflowName?: string;
  fromSnapshot?: boolean; // reconstructed from a run's graph snapshot (workflow was deleted)
  createdAt: number;
}

interface AgentSessionStore {
  sessions: AgentSession[];
  activeId: string | null;
  history: AgentSession[];
  _historyLoaded: boolean;

  createSession: () => string;
  setActive: (id: string) => void;
  updateConfig: (id: string, config: Partial<AgentSession["config"]>) => void;
  setStatus: (id: string, status: AgentSession["status"]) => void;
  addLiveEvent: (id: string, event: LiveAgentEvent) => void;
  setActiveAgent: (id: string, index: number) => void;
  completeAgent: (id: string, index: number) => void;
  setResult: (id: string, answer: string, metrics: AgentSession["metrics"]) => void;
  appendStreamToken: (id: string, text: string) => void;
  resetStreamToken: (id: string) => void;
  setTaskId: (id: string, taskId: string) => void;
  setConvId: (id: string, convId: string) => void;
  setFeedback: (id: string, rating: "good" | "bad", comment?: string) => void;
  removeSession: (id: string) => void;
  restoreSession: (histSession: AgentSession) => void;
  duplicateSession: (id: string) => string;

  loadHistory: () => void;
  saveToHistory: (id: string) => void;
}

const HISTORY_KEY = "kernelmcp_agent_history";
const MAX_HISTORY = 20;

let _sessionCounter = 0;
function newSessionId(): string {
  return `sess-${++_sessionCounter}-${Date.now().toString(36)}`;
}

function makeEmptySession(): AgentSession {
  return {
    id: newSessionId(),
    config: { goal: "", agents: [], pattern: "sequential", constitution: "", triggerType: "manual", workspaceEnabled: false, humanGates: [] },
    status: "configuring",
    taskId: null,
    convId: null,
    liveEvents: [],
    graph: null,
    readOnly: false,
    activeAgentIndex: -1,
    activeAgentIndices: [],
    completedAgents: [],
    answer: null,
    streamingText: "",
    metrics: null,
    feedback: null,
    createdAt: Date.now(),
  };
}

function loadHistoryFromStorage(): AgentSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentSession[];
    return parsed.slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistoryToStorage(history: AgentSession[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // storage full — silently fail
  }
}

export const useAgentSessionStore = create<AgentSessionStore>((set, get) => ({
  sessions: [],
  activeId: null,
  history: [],
  _historyLoaded: false,

  createSession: () => {
    const session = makeEmptySession();
    set((s) => {
      let sessions = [...s.sessions, session];
      // Auto-close oldest inactive sessions when > 10 tabs
      if (sessions.length > 10) {
        const toRemove = sessions
          .filter(sess => sess.id !== session.id && sess.status !== "running")
          .sort((a, b) => a.createdAt - b.createdAt);
        const removeIds = new Set(toRemove.slice(0, sessions.length - 10).map(s => s.id));
        sessions = sessions.filter(s => !removeIds.has(s.id));
      }
      return { sessions, activeId: session.id };
    });
    return session.id;
  },

  setActive: (id) => {
    set({ activeId: id });
  },

  updateConfig: (id, config) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, config: { ...sess.config, ...config } } : sess
      ),
    }));
  },

  setStatus: (id, status) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? {
          ...sess,
          status,
          // Clear previous run data when starting a NEW run, not when resuming from waiting
          ...(status === "running" && sess.status !== "waiting" ? { liveEvents: [], completedAgents: [], activeAgentIndex: -1, activeAgentIndices: [], answer: null, streamingText: "", metrics: null } : {}),
        } : sess
      ),
    }));
  },

  addLiveEvent: (id, event) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, liveEvents: [...sess.liveEvents, event] } : sess
      ),
    }));
  },

  appendStreamToken: (id, text) => {
    if (!text) return;
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, streamingText: sess.streamingText + text } : sess
      ),
    }));
  },

  resetStreamToken: (id) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.streamingText ? { ...sess, streamingText: "" } : sess
      ),
    }));
  },

  setActiveAgent: (id, index) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? {
          ...sess,
          activeAgentIndex: index,
          activeAgentIndices: sess.activeAgentIndices.includes(index) ? sess.activeAgentIndices : [...sess.activeAgentIndices, index],
          // Remove from completed — agent is starting a new round
          completedAgents: sess.completedAgents.filter(i => i !== index),
        } : sess
      ),
    }));
  },

  completeAgent: (id, index) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id
          ? {
              ...sess,
              completedAgents: sess.completedAgents.includes(index) ? sess.completedAgents : [...sess.completedAgents, index],
              activeAgentIndices: sess.activeAgentIndices.filter(i => i !== index),
            }
          : sess
      ),
    }));
  },

  setResult: (id, answer, metrics) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id
          ? {
              ...sess,
              answer,
              streamingText: "",
              metrics,
              // Keep failed status if already set, otherwise completed
              status: sess.status === "failed" ? "failed" as const : "completed" as const,
              activeAgentIndex: -1,
              activeAgentIndices: [],
              // On success: mark all agents done. On failure: keep only actually completed ones.
              completedAgents: sess.status === "failed" ? sess.completedAgents : sess.config.agents.map((_, i) => i),
            }
          : sess
      ),
    }));
    // Auto-save to history
    get().saveToHistory(id);
  },

  setTaskId: (id, taskId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, taskId } : sess
      ),
    }));
  },

  setConvId: (id, convId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, convId } : sess
      ),
    }));
  },

  setFeedback: (id, rating, comment) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, feedback: { rating, comment: comment ?? sess.feedback?.comment ?? "" } } : sess
      ),
    }));
    // If completed, re-save to history to preserve feedback
    const session = get().sessions.find((s) => s.id === id);
    if (session && (session.status === "completed" || session.status === "failed")) {
      get().saveToHistory(id);
    }
  },

  removeSession: (id) => {
    set((s) => {
      const remaining = s.sessions.filter((sess) => sess.id !== id);
      let newActiveId = s.activeId;
      if (s.activeId === id) {
        newActiveId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      return { sessions: remaining, activeId: newActiveId };
    });
  },

  restoreSession: (histSession: AgentSession) => {
    const state = get();
    // Don't add if already in sessions
    if (state.sessions.find(s => s.id === histSession.id)) {
      set({ activeId: histSession.id });
      return;
    }
    // History sessions are read-only (use Fork to edit)
    set((s) => ({
      sessions: [...s.sessions, { ...histSession, readOnly: true }],
      activeId: histSession.id,
    }));
  },

  duplicateSession: (id) => {
    const state = get();
    const source = state.sessions.find((s) => s.id === id) || state.history.find((s) => s.id === id);
    if (!source) return state.createSession();

    const newSession = makeEmptySession();
    newSession.config = { ...source.config, agents: source.config.agents.map((a) => ({ ...a, id: `ag-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })) };
    newSession.graph = source.graph ? JSON.parse(JSON.stringify(source.graph)) : null;
    newSession.readOnly = false; // Fork is always editable

    set((s) => ({
      sessions: [...s.sessions, newSession],
      activeId: newSession.id,
    }));
    return newSession.id;
  },

  loadHistory: () => {
    if (get()._historyLoaded) return;
    const history = loadHistoryFromStorage();
    set({ history, _historyLoaded: true });
  },

  saveToHistory: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;

    // Store a snapshot — keep answer and metrics, trim live events to last 20
    const snapshot: AgentSession = {
      ...session,
      liveEvents: session.liveEvents.slice(-20),
    };

    set((s) => {
      const newHistory = [snapshot, ...s.history.filter((h) => h.id !== id)].slice(0, MAX_HISTORY);
      saveHistoryToStorage(newHistory);
      return { history: newHistory };
    });
  },
}));
