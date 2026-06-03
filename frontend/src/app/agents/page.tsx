"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter as useNextRouter } from "next/navigation";
import {
  Bot, Play, Loader2, CheckCircle2, XCircle,
  Plus, Zap, DollarSign, RotateCw, Square, Activity,
  Settings, ChevronRight, Save, Download, Globe,
  X, Clock, AlertCircle, MessageSquare, Sparkles,
  PanelLeftOpen, PanelLeftClose, ArrowLeftRight, ArrowRight,
  History, Calendar, Copy, Trash, FolderOpen as FolderIcon, Menu,
  Rocket, KeyRound, Terminal, CheckCheck,
} from "lucide-react";
import Link from "next/link";
import CopyButton from "@/components/copy-button";
import { renderMarkdown } from "@/components/markdown";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { useAgentSessionStore, type TeamAgent, type LiveAgentEvent, type AgentSession } from "@/stores/agent-sessions";
import FlowEditor from "@/components/flow-editor";

// Extracted modules
import { BASE_URL, AGENT_META, TEMPLATES, PATTERNS, newId, sseRefs, type Pattern, type AgentInfo, type Template } from "./constants";
import TemplateSelector from "./template-selector";
import AgentEventItem from "./agent-event-item";
import CompareView, { CompareTray, type CompareItem } from "./compare-view";
import OutputPanel from "./output-panel";
import { useWorkflowStore } from "@/stores/workflow-store";
import LibraryPanel from "./library-panel";
import { useBreakpoint } from "@/hooks/useBreakpoint";



// ── Human Gate Actions component ─────────────────────────────────────────
function HumanGateActions({ taskId, nodeId, tenant, currentOutput, hasFeedback }: { taskId: string; nodeId: string; tenant: string; currentOutput?: string; hasFeedback?: boolean }) {
  const [editText, setEditText] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const send = (action: string, modifiedOutput?: string) => {
    const body: any = { action };
    if (modifiedOutput) body.modified_output = modifiedOutput;
    fetch(`${BASE_URL}/tasks/${taskId}/human-gate/${nodeId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(tenant ? { "x-tenant-id": tenant } : {}) },
      body: JSON.stringify(body),
    }).catch(() => {});
    setSubmitted(true);
  };

  if (submitted) return null;

  return (
    <div className="mt-2 ml-6 space-y-2">
      {currentOutput && (
        <div className="px-2.5 py-1.5 bg-slate-800/30 border border-white/[0.06] rounded-lg max-h-32 overflow-y-auto">
          <div className="text-[9px] text-slate-500 mb-1">Output from previous agent:</div>
          <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono">{currentOutput}</pre>
        </div>
      )}
      {showEdit && (
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          placeholder={hasFeedback ? "Write feedback for the agent to revise..." : "Edit the output that will be passed to the next agent..."}
          className="w-full px-2.5 py-1.5 bg-slate-800/50 border border-white/[0.08] rounded-lg text-[11px] text-slate-300 placeholder:text-slate-600 resize-none focus:outline-none focus:border-violet-500/30"
          rows={3}
          autoFocus
        />
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => send("approve", editText.trim() || undefined)} className="px-3 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-md text-[10px] font-medium transition-all">
          {showEdit && editText.trim() ? "Continue with edit" : "Approve"}
        </button>
        {hasFeedback && (
          <button onClick={() => showEdit ? send("feedback", editText.trim() || "Please revise.") : setShowEdit(true)} className="px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-300 rounded-md text-[10px] font-medium transition-all">
            {showEdit && editText.trim() ? "Send feedback" : "Request revision"}
          </button>
        )}
        <button onClick={() => send("deny")} className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-300 rounded-md text-[10px] font-medium transition-all">
          Deny
        </button>
        {!showEdit && (
          <button onClick={() => setShowEdit(true)} className="px-3 py-1 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] text-slate-400 rounded-md text-[10px] font-medium transition-all">
            Edit output
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AgentsPage() {
  return <Suspense><AgentsPageInner /></Suspense>;
}

function AgentsPageInner() {
  const searchParams = useSearchParams();
  const navRouter = useNextRouter();
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  const store = useAgentSessionStore();
  const { sessions, activeId, history } = store;
  const wfStore = useWorkflowStore();

  const [agentInfos, setAgentInfos] = useState<AgentInfo[]>([]);
  const [loadingInfos, setLoadingInfos] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"result" | "trace">("trace"); // kept for auto-switch logic
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [agentRatings, setAgentRatings] = useState<Record<number, "good" | "bad">>({});
  const [compareItems, setCompareItems] = useState<import("./compare-view").CompareItem[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [abTestHint, setAbTestHint] = useState(false);
  const [showEval, setShowEval] = useState(false);
  const [flowWarnings, setFlowWarnings] = useState<string[]>([]);
  const flowGraphRef = useRef<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [errorNodeIds, setErrorNodeIds] = useState<string[]>([]);
  const [errorReasons, setErrorReasons] = useState<Record<string, string>>({});
  const [evalCases, setEvalCases] = useState<{input: string; expected: string; result?: string; passed?: boolean}[]>([]);
  const [evalRunning, setEvalRunning] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<{id: string; name: string; config: AgentSession["config"]; createdAt: number}[]>([]);

  // Responsive
  const { isMobile } = useBreakpoint();
  const [mobileTab, setMobileTab] = useState<"build" | "output">("build");

  // Chat-to-build (conversational architect: narrate + diff the team onto the canvas)
  const [building, setBuilding] = useState(false);
  const [buildChat, setBuildChat] = useState<{ role: "user" | "architect"; text: string }[]>([]);
  const [buildInput, setBuildInput] = useState("");
  const [buildSuggestions, setBuildSuggestions] = useState<string[]>([]);
  const [buildMissing, setBuildMissing] = useState<string[]>([]);
  const buildScrollRef = useRef<HTMLDivElement>(null);

  // Run parameters: {placeholders} in the goal/instructions become typed inputs before a run.
  const [runParamsOpen, setRunParamsOpen] = useState(false);
  const [runParamValues, setRunParamValues] = useState<Record<string, string>>({});

  // ── Publish → deploy (workflow as a token-authed callable API) ──
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishNotes, setPublishNotes] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishLog, setPublishLog] = useState<{ phase: string; text: string }[]>([]);
  const [publishResult, setPublishResult] = useState<{ id: string; name: string; endpoint: string; token: string } | null>(null);
  const [deployments, setDeployments] = useState<{ id: string; name: string; endpoint: string; runs: number; created_at: number; release_notes?: string; workflowId?: string; status?: string }[]>([]);
  const [copied, setCopied] = useState<string>("");
  // Reset the architect conversation when switching sessions (it's per-workflow).
  useEffect(() => { setBuildChat([]); setBuildSuggestions([]); setBuildMissing([]); setBuildInput(""); }, [activeId]);
  // Auto-scroll the architect thread to the latest as narration streams in.
  useEffect(() => { const el = buildScrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [buildChat]);

  // Workflow library panel
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"workflows" | "runs" | "scheduled">("workflows");
  const [savingName, setSavingName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [schedules, setSchedules] = useState<{id: string; schedule: any; config: any; createdAt: number; active: boolean}[]>([]);

  // Load data on mount
  useEffect(() => {
    fetch(`${BASE_URL}/agents`).then(r => r.json()).then(d => setAgentInfos(d.agents || [])).catch(() => {}).finally(() => setLoadingInfos(false));
    wfStore.load(th);
    wfStore.loadSchedules(th);
    loadDeployments();
    store.loadHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved templates from localStorage (legacy compat)
  useEffect(() => {
    try { setSavedTemplates(JSON.parse(localStorage.getItem("kernelmcp_saved_templates") || "[]")); } catch {}
  }, []);

  // ── URL-based state: restore from URL on mount ──
  const urlRestored = useRef(false);
  useEffect(() => {
    if (urlRestored.current || !wfStore.loaded) return;
    const wfId = searchParams.get("wf");
    const verId = searchParams.get("v");
    const runId = searchParams.get("r");
    if (!wfId) return;
    urlRestored.current = true;

    const wf = wfStore.getWorkflow(wfId);
    if (!wf) return;
    const ver = verId ? wf.versions.find(v => v.id === verId) : wf.versions[wf.versions.length - 1];
    if (!ver) return;

    // Check if a session for this already exists
    const existing = sessions.find(s => runId ? s.runId === runId : (s.workflowId === wfId && s.versionId === ver.id && !s.runId));
    if (existing) { store.setActive(existing.id); return; }

    // Create session from URL params
    const newSess = store.createSession();
    store.updateConfig(newSess, ver.config);

    if (runId) {
      const run = wf.runs.find(r => r.id === runId);
      useAgentSessionStore.setState(s => ({
        sessions: s.sessions.map(sess => sess.id === newSess ? {
          ...sess, graph: ver.graph, readOnly: true, status: (run?.status as any) || "completed",
          answer: run?.answer || null, metrics: run?.metrics || null, liveEvents: run?.liveEvents || [],
          feedback: run?.feedback || null, workflowId: wfId, versionId: ver.id, runId, workflowName: wf.name,
          completedAgents: ver.config.agents.map((_: any, i: number) => i),
        } : sess),
      }));
    } else {
      useAgentSessionStore.setState(s => ({
        sessions: s.sessions.map(sess => sess.id === newSess ? {
          ...sess, graph: ver.graph, readOnly: false, workflowId: wfId, versionId: ver.id, workflowName: wf.name,
        } : sess),
      }));
    }
  }, [searchParams, wfStore.loaded]); // eslint-disable-line

  // ── URL sync: update URL when active session changes ──
  useEffect(() => {
    if (!activeId) return;
    const sess = sessions.find(s => s.id === activeId);
    if (!sess) return;
    const params = new URLSearchParams();
    if (sess.workflowId) params.set("wf", sess.workflowId);
    if (sess.versionId) params.set("v", sess.versionId);
    if (sess.runId) params.set("r", sess.runId);
    const url = params.toString() ? `/agents?${params}` : "/agents";
    if (window.location.pathname + window.location.search !== url) {
      navRouter.replace(url, { scroll: false });
    }
  }, [activeId, sessions.find(s => s.id === activeId)?.workflowId, sessions.find(s => s.id === activeId)?.versionId, sessions.find(s => s.id === activeId)?.runId]); // eslint-disable-line

  // Create initial session if none exist
  useEffect(() => {
    if (sessions.length === 0 && !activeId) {
      store.createSession();
    }
  }, [sessions.length, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active session
  const session = sessions.find(s => s.id === activeId) || null;
  const isRunning = session?.status === "running" || session?.status === "waiting";
  const isWaiting = session?.status === "waiting";
  const isConfiguring = session?.status === "configuring";
  const isDone = session?.status === "completed" || session?.status === "failed";
  const isReadOnly = session?.readOnly || false;

  // Find the node_id of the currently waiting human gate
  const waitingNodeId = useMemo(() => {
    if (!isWaiting || !session?.liveEvents) return null;
    for (let i = session.liveEvents.length - 1; i >= 0; i--) {
      const evt = session.liveEvents[i];
      if (evt.type === "human_gate" && !evt.content.includes("approved") && !evt.content.includes("denied") && !evt.content.includes("Revision") && evt.nodeId) {
        return evt.nodeId;
      }
    }
    return null;
  }, [isWaiting, session?.liveEvents]);

  // Find all denied human gate node IDs
  const deniedNodeIds = useMemo(() => {
    if (!session?.liveEvents) return [];
    return session.liveEvents
      .filter(evt => evt.type === "human_gate" && evt.content.includes("denied") && evt.nodeId)
      .map(evt => evt.nodeId!);
  }, [session?.liveEvents]);

  // Find all approved human gate node IDs (for completed runs)
  const approvedNodeIds = useMemo(() => {
    if (!session?.liveEvents) return [];
    // Only count as "approved" if the LAST event for this node is an approval
    const nodeLastState: Record<string, string> = {};
    for (const evt of session.liveEvents) {
      if (evt.type === "human_gate" && evt.nodeId) {
        if (evt.content.includes("approved")) nodeLastState[evt.nodeId] = "approved";
        else if (evt.content.includes("denied")) nodeLastState[evt.nodeId] = "denied";
        else if (evt.content.includes("Revision")) nodeLastState[evt.nodeId] = "revision";
        else nodeLastState[evt.nodeId] = "pending";
      }
    }
    return Object.entries(nodeLastState).filter(([, s]) => s === "approved").map(([id]) => id);
  }, [session?.liveEvents]);

  // Find nodes currently in revision (feedback sent, waiting for re-run)
  const revisionNodeIds = useMemo(() => {
    if (!session?.liveEvents) return [];
    const nodeLastState: Record<string, string> = {};
    for (const evt of session.liveEvents) {
      if (evt.type === "human_gate" && evt.nodeId) {
        if (evt.content.includes("approved")) nodeLastState[evt.nodeId] = "approved";
        else if (evt.content.includes("denied")) nodeLastState[evt.nodeId] = "denied";
        else if (evt.content.includes("Revision")) nodeLastState[evt.nodeId] = "revision";
        else nodeLastState[evt.nodeId] = "pending";
      }
    }
    return Object.entries(nodeLastState).filter(([, s]) => s === "revision").map(([id]) => id);
  }, [session?.liveEvents]);

  // Auto-open right panel when running/done
  useEffect(() => {
    if (isRunning || isDone) setRightPanelOpen(true);
  }, [isRunning, isDone]);

  // Auto-switch right panel tabs
  useEffect(() => {
    if (isRunning) setRightTab("trace");
    else if (isDone) setRightTab("result");
  }, [isRunning, isDone]);

  // Local config helpers — read from session, write to store
  const goal = session?.config.goal || "";
  const agents = session?.config.agents || [];
  const pattern = (session?.config.pattern || "sequential") as Pattern;
  const teamConstitution = session?.config.constitution || "";

  const triggerType = session?.config.triggerType || "manual";
  const workspaceEnabled = session?.config.workspaceEnabled || false;
  const humanGates = session?.config.humanGates || [];

  const setGoal = (v: string) => activeId && store.updateConfig(activeId, { goal: v });
  const setPattern = (v: Pattern) => activeId && store.updateConfig(activeId, { pattern: v });
  const setTeamConstitution = (v: string) => activeId && store.updateConfig(activeId, { constitution: v });
  const setTriggerType = (v: string) => activeId && store.updateConfig(activeId, { triggerType: v as any });
  const setWorkspaceEnabled = (v: boolean) => activeId && store.updateConfig(activeId, { workspaceEnabled: v });
  const setAgents = (updater: TeamAgent[] | ((prev: TeamAgent[]) => TeamAgent[])) => {
    if (!activeId) return;
    const next = typeof updater === "function" ? updater(agents) : updater;
    store.updateConfig(activeId, { agents: next });
  };


  const agentsWithoutRole = agents.filter(a => !a.role.trim());
  const hasFlowErrors = flowWarnings.length > 0 || errorNodeIds.length > 0;
  const canRun = goal.trim() && agents.length > 0 && agentsWithoutRole.length === 0 && flowWarnings.length === 0;

  // ── Conversational chat-to-build: architect narrates (streamed), then we diff its
  //    full team onto the canvas (match by role to keep node identity / avoid flashing). ──
  const handleArchitect = useCallback(async (message: string) => {
    const msg = message.trim();
    if (!msg || !activeId || building) return;
    const aid = activeId;
    setBuilding(true);
    setBuildSuggestions([]);
    setBuildMissing([]);
    // Snapshot the conversation history (before adding this turn) for the backend.
    const history = buildChat.map(m => ({ role: m.role === "architect" ? "assistant" : "user", content: m.text }));
    setBuildChat(c => [...c, { role: "user", text: msg }, { role: "architect", text: "" }]);
    const archIdx = buildChat.length + 1; // index of the architect message we'll stream into

    // Current workflow snapshot for refinement context (agents + trigger + workspace + gates).
    const curCfg = store.sessions.find(s => s.id === aid)?.config;
    const curAgents = curCfg?.agents || [];

    try {
      const res = await fetch(`${BASE_URL}/agents/architect`, {
        method: "POST", headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({
          message: msg, history,
          current: {
            pattern: curCfg?.pattern || "sequential",
            agents: curAgents.map(a => ({ type: a.type, role: a.role, instructions: a.instructions, max_turns: a.max_turns, tools: a.tools })),
            trigger: { type: curCfg?.triggerType || "manual", cron: curCfg?.cronExpression, interval_seconds: curCfg?.intervalSeconds, webhook_path: curCfg?.webhookPath },
            human_gates: curCfg?.humanGates || [],
            workspace: { enabled: !!curCfg?.workspaceEnabled, name: curCfg?.workspaceName, mode: curCfg?.workspaceMode },
          },
        }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === "narration") {
            setBuildChat(c => c.map((m, i) => i === archIdx ? { ...m, text: m.text + ev.text } : m));
          } else if (ev.type === "team") {
            // Diff onto canvas: keep ids of agents whose role is unchanged so they don't flash.
            const existing = (store.sessions.find(s => s.id === aid)?.config.agents) || [];
            const used = new Set<string>();
            const next = (ev.agents || []).map((a: any) => {
              const match = existing.find(e => e.role && e.role === a.role && !used.has(e.id));
              if (match) used.add(match.id);
              return {
                id: match?.id || newId(), name: match?.name || "", description: "",
                type: a.type || "custom", role: a.role || "", max_turns: a.max_turns || 5,
                instructions: a.instructions || "", tools: Array.isArray(a.tools) ? a.tools : [],
              };
            });
            // Trigger (manual / cron / interval / scheduled / watch / webhook).
            const tr = ev.trigger || { type: "manual" };
            const trigCfg: any = { triggerType: tr.type || "manual" };
            if (tr.cron) trigCfg.cronExpression = tr.cron;
            if (tr.interval_seconds) trigCfg.intervalSeconds = tr.interval_seconds;
            if (tr.webhook_path) trigCfg.webhookPath = tr.webhook_path;
            if (tr.schedule_date) trigCfg.scheduleDate = tr.schedule_date;
            if (tr.schedule_time) trigCfg.scheduleTime = tr.schedule_time;
            if (tr.watch_command) trigCfg.watchCommand = tr.watch_command;
            if (tr.watch_condition) trigCfg.watchCondition = tr.watch_condition;
            // Workspace + human gates.
            const ws = ev.workspace || {};
            const wsCfg: any = ws.enabled
              ? { workspaceEnabled: true, workspaceName: ws.name || "", workspaceMode: ws.mode || "persistent" }
              : { workspaceEnabled: false };
            const humanGates = Array.isArray(ev.human_gates) ? ev.human_gates.filter((x: any) => typeof x === "number") : [];
            store.updateConfig(aid, { pattern: ev.pattern || "sequential", agents: next, ...trigCfg, ...wsCfg, humanGates });
            setBuildSuggestions(Array.isArray(ev.suggestions) ? ev.suggestions.filter((s: any) => typeof s === "string").slice(0, 4) : []);
            setBuildMissing(Array.isArray(ev.missing) ? ev.missing.filter((s: any) => typeof s === "string") : []);
          } else if (ev.type === "error") {
            setBuildChat(c => c.map((m, i) => i === archIdx ? { ...m, text: (m.text || "") + "⚠ " + (ev.message || "failed") } : m));
          }
        }
      }
    } catch (e: any) {
      setBuildChat(c => c.map((m, i) => i === archIdx ? { ...m, text: (m.text || "") + "⚠ " + (e?.message || "failed") } : m));
    } finally {
      setBuilding(false);
    }
  }, [activeId, building, buildChat, th]);

  // ── Agent CRUD ─────────────────────────────────────────────────────────

  const addAgent = (type: string) => { setAgents(prev => [...prev, { id: newId(), name: "", description: "", type, role: "", max_turns: 5, instructions: "", tools: [] }]); };
  const removeAgent = (id: string) => { setAgents(prev => prev.filter(a => a.id !== id)); };
  const duplicateAgent = (id: string) => { const src = agents.find(a => a.id === id); if (src) setAgents(prev => [...prev, { ...src, id: newId(), name: src.name ? src.name + " (copy)" : "" }]); };
  const moveAgent = (index: number, dir: -1 | 1) => {
    setAgents(prev => {
      const n = [...prev]; const t = index + dir;
      if (t < 0 || t >= n.length) return prev;
      [n[index], n[t]] = [n[t], n[index]];
      return n;
    });
  };
  const updateAgent = (id: string, patch: Partial<TeamAgent>) => { setAgents(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a)); };

  const applyTemplate = (tpl: Template) => {
    if (!activeId) return;
    store.updateConfig(activeId, {
      goal: tpl.goal,
      pattern: tpl.pattern,
      constitution: "",
      agents: tpl.agents.map(a => ({ id: newId(), name: "", description: "", type: a.type, role: a.role, max_turns: a.type === "research" ? 6 : 5, instructions: a.instructions || "", tools: [] })),
    });
  };

  // ── Cost estimate ──────────────────────────────────────────────────────

  const costEstimate = useMemo(() => {
    if (agents.length === 0) return null;
    const avgTurns = agents.reduce((s, a) => s + a.max_turns, 0) / agents.length;
    const totalTokens = agents.length * avgTurns * 1500;
    const cost = totalTokens * 0.003 / 1000;
    return { agents: agents.length, avgTurns: Math.round(avgTurns), tokens: Math.round(totalTokens), cost };
  }, [agents]);

  // ── Run ────────────────────────────────────────────────────────────────

  const handleRun = useCallback(async (paramsOverride?: Record<string, string>) => {
    if (!canRun || !activeId || isRunning) return;

    // ── Run parameters: if the workflow has {placeholders}, collect them first ──
    const _nodeInstr = (flowGraphRef.current?.nodes || []).map((n: any) => String((n.data as any)?.instructions || ""));
    const _vars = Array.from(new Set(
      [goal, ...agents.map(a => a.instructions || ""), ..._nodeInstr]
        .flatMap(t => [...String(t).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]))
    ));
    const _params = paramsOverride || runParamValues;
    if (_vars.length && _vars.some(v => !(_params[v]?.trim()))) {
      setRunParamValues(prev => { const next = { ...prev }; _vars.forEach(v => { if (!(v in next)) next[v] = ""; }); return next; });
      setRunParamsOpen(true);
      return;
    }
    const subst = (t: string) => String(t || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => _params[k] ?? m);

    // On mobile, surface the live output as soon as the run starts
    if (isMobile) setMobileTab("output");

    const sessionId = activeId;
    // Close any stale SSE connection from a previous run
    const oldEs = sseRefs[sessionId];
    if (oldEs) { oldEs.close(); delete sseRefs[sessionId]; }

    const sess = store.sessions?.find(s => s.id === sessionId);

    // Snapshot the current graph layout
    const { nodes: snapNodes, edges: snapEdges } = flowGraphRef.current;
    const graphSnapshot = snapNodes.length > 0 ? {
      nodes: snapNodes.map((n: any) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
      edges: snapEdges.map((e: any) => ({ id: e.id, source: e.source, target: e.target, label: e.label, style: e.style, type: e.type })),
    } : null;

    // ── Scratchpad mode: only persist if already linked to a workflow ──
    let currentWorkflowId = sess?.workflowId;
    let currentVersionId = sess?.versionId;
    let currentWorkflowName = sess?.workflowName;

    // If linked to a workflow and config/graph changed, auto-create new version
    if (currentWorkflowId && currentVersionId && sess) {
      const sourceVersion = wfStore.getVersion(currentWorkflowId, currentVersionId);
      if (sourceVersion) {
        const configChanged = JSON.stringify(sess.config) !== JSON.stringify(sourceVersion.config);
        const graphChanged = JSON.stringify(graphSnapshot) !== JSON.stringify(sourceVersion.graph);
        if (configChanged || graphChanged) {
          const newVer = await wfStore.addVersion(currentWorkflowId, {
            parentVersionId: currentVersionId,
            config: { ...sess.config },
            graph: graphSnapshot,
            note: "Auto-created from modified run",
          }, th);
          if (newVer) {
            currentVersionId = newVer.id;
          }
        }
      }
    }

    // Create run in workflow store (only if linked to a workflow)
    let currentRunId: string | undefined;
    if (currentWorkflowId && currentVersionId) {
      const run = await wfStore.addRun(currentWorkflowId, currentVersionId, {
        status: "running",
      }, th);
      if (run) currentRunId = run.id;
    }

    // Set running status + link to workflow/version/run
    useAgentSessionStore.setState((s) => ({
      sessions: s.sessions.map(sess2 => sess2.id === sessionId ? {
        ...sess2,
        status: "running" as const,
        graph: graphSnapshot || sess2.graph,
        workflowId: currentWorkflowId || sess2.workflowId,
        versionId: currentVersionId || sess2.versionId,
        workflowName: currentWorkflowName || sess2.workflowName,
        runId: currentRunId,
        liveEvents: [],
        completedAgents: [],
        activeAgentIndex: -1,
        activeAgentIndices: [],
        answer: null,
        metrics: null,
      } : sess2),
    }));

    const currentAgents = store.sessions?.find(s => s.id === sessionId)?.config.agents || agents;
    const currentGoal = store.sessions?.find(s => s.id === sessionId)?.config.goal || goal;
    const currentPattern = store.sessions?.find(s => s.id === sessionId)?.config.pattern || pattern;
    const currentConstitution = store.sessions?.find(s => s.id === sessionId)?.config.constitution || teamConstitution;

    const startTime = Date.now();
    const { nodes: checkNodes } = flowGraphRef.current;
    const hasGraphNodes = checkNodes.length > 0;
    const isTeam = currentAgents.length > 1 || hasGraphNodes; // Always use taskforce when graph exists

    // Merge constitution INTO the goal so agents treat it as the actual topic/context.
    // Run-parameter {placeholders} are substituted into the goal here.
    const substGoal = subst(currentGoal);
    const effectiveGoal = currentConstitution
      ? `${substGoal}\n\nContext & requirements: ${subst(currentConstitution)}`
      : substGoal;

    try {
      if (isTeam) {
        // ── Multi-agent: use /agents/taskforce with SSE streaming ──
        // The flow graph is always the source of truth for execution topology
        const { nodes: flowNodes, edges: flowEdges } = flowGraphRef.current;
        const hasGraph = flowNodes.length > 0;

        const config: Record<string, any> = {
          goal: effectiveGoal,
          pattern: hasGraph ? "graph" : currentPattern,
          constitution: currentConstitution || undefined,
          agents: currentAgents.map(a => ({
            type: a.type, role: a.role, max_turns: a.max_turns,
            ...(a.instructions ? { instructions: subst(a.instructions) } : {}),
            ...(a.tools?.length ? { tools: a.tools } : {}),
          })),
        };

        // Always send the graph — it's the source of truth (substitute placeholders in node instructions)
        if (hasGraph) {
          config.graph = {
            nodes: flowNodes.map(n => ({ id: n.id, type: n.type, data: (n.data as any)?.instructions ? { ...n.data, instructions: subst((n.data as any).instructions) } : n.data, position: n.position })),
            edges: flowEdges.map(e => ({ source: e.source, target: e.target, label: e.label, style: e.style })),
          };
        }

        // Workspace isolation
        if (workspaceEnabled) {
          config.workspace = {
            name: session?.config.workspaceName || "output",
            mode: session?.config.workspaceMode || "isolated",
          };
        }

        const convId = `agents-${Date.now().toString(36)}`;
        store.setConvId(sessionId, convId);

        // Fire /chat in background for conversation history
        const chatMsg = `[TaskForce] Goal: ${effectiveGoal}\nPattern: ${currentPattern}\nAgents: ${currentAgents.map(a => `${a.type}(${a.role})`).join(", ")}`;
        fetch(`${BASE_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify({ message: chatMsg, conversation_id: convId, execution_mode: "react" }),
        }).catch(() => {});

        // Launch taskforce (async — returns task_id immediately)
        const res = await fetch(`${BASE_URL}/agents/taskforce`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify(config),
        });
        const launch = await res.json();

        if (!launch.task_id) {
          // Fallback: blocking response (old format)
          const data = launch;
          const duration = Date.now() - startTime;
          const answer = data.final_output || data.output || JSON.stringify(data, null, 2);
          store.setResult(sessionId, answer, { tokens: data.total_tokens || 0, cost: data.total_cost || 0, turns: data.total_turns || 0, duration: data.duration_ms || duration });
        } else {
          // SSE streaming mode — save to history immediately so it appears in Runs
          const taskId = launch.task_id;
          store.setTaskId(sessionId, taskId);
          store.saveToHistory(sessionId);

          const es = new EventSource(`${BASE_URL}/api/stream/${taskId}?tenant=${encodeURIComponent(tenant)}`);
          (es as any)._currentAgentIdx = 0; // Track active agent locally in closure
          sseRefs[sessionId] = es;

          es.onmessage = (ev) => {
            try {
              const event = JSON.parse(ev.data);
              const eventData = event.data || {};

              // Live token stream (typewriter) — high frequency, handle and skip the rest.
              if (event.type === "llm.delta") {
                store.appendStreamToken(sessionId, event.message || "");
                return;
              }
              // New turn / agent → clear the previous turn's streamed text.
              if (event.type === "turn.started" || event.message === "agent.started" || event.message === "wave.started") {
                store.resetStreamToken(sessionId);
              }

              // Wave marker (parallel group indicator)
              if (event.message === "wave.started") {
                const waveNum = eventData.wave || 1;
                const isParallel = eventData.parallel;
                const waveAgents = (eventData.agents || []) as { role: string; self_refine: boolean; round: number }[];
                const labels = waveAgents.map((a: any) => `${a.self_refine ? "🔄 " : ""}${a.role}${a.round > 1 ? ` r${a.round}` : ""}`).join(", ");
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `${isParallel ? "⚡ Parallel" : "→ Sequential"} wave ${waveNum}: ${labels}`,
                  timestamp: Date.now(),
                });
              }

              // Condition evaluated
              if (event.message === "condition.evaluated") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "condition",
                  content: `◆ ${eventData.label || "Condition"}: ${eventData.expression || "?"} → ${eventData.result ? "YES" : "NO"}`,
                  timestamp: Date.now(),
                });
              }

              // Node skipped (branch not taken)
              if (event.message === "node.skipped") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "skipped",
                  content: `⊘ ${eventData.label || "Node"} (${eventData.type}) — branch not taken`,
                  timestamp: Date.now(),
                });
              }

              // Workspace aggregated
              if (event.message === "workspace.aggregated") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `📁 ${eventData.name || "Workspace"} — aggregated from: ${(eventData.sources || []).join(", ")} (${eventData.size || 0} chars)`,
                  timestamp: Date.now(),
                });
              }

              // Sub-workflow events
              if (event.message === "workflow.started") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `📦 Sub-workflow started: ${eventData.template || "workflow"} (${eventData.agents || 0} agents)`,
                  timestamp: Date.now(),
                });
              }
              if (event.message === "workflow.completed") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `📦 Sub-workflow completed: ${eventData.template || "workflow"} — ${eventData.success ? "success" : "failed"} (${eventData.tokens || 0} tokens)`,
                  timestamp: Date.now(),
                });
              }
              if (event.message === "workflow.failed") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "error",
                  content: `📦 Sub-workflow failed: ${eventData.template || "workflow"} — ${eventData.error || "unknown error"}`,
                  timestamp: Date.now(),
                });
              }

              // Human gate
              if (event.message === "human.review_required") {
                const currentOutput = eventData.current_output || "";
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `⏸ Human review required: ${eventData.instructions || "Review and approve"}${currentOutput ? `\n---\n${currentOutput}` : ""}`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                  hasFeedback: eventData.has_feedback || false,
                });
                store.setStatus(sessionId, "waiting");
              }
              if (event.message === "human.approved") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `✅ Human approved${eventData.modified ? " (output edited)" : ""}`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                });
                store.setStatus(sessionId, "running");
              }
              if (event.message === "human.denied") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `🛑 Human denied — workflow stopped`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                });
                store.setStatus(sessionId, "running");
              }
              if (event.message === "human.feedback") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `🔄 Revision requested: ${(eventData.feedback || "").slice(0, 100)}`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                });
                store.setStatus(sessionId, "running");
              }

              // Agent-level events from patterns
              if (event.message === "agent.started" && eventData.agent_index != null) {
                store.setActiveAgent(sessionId, eventData.agent_index);
                (es as any)._currentAgentIdx = eventData.agent_index;
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "thinking",
                  content: `${eventData.agent_role || eventData.agent_type} started...`,
                  timestamp: Date.now(),
                });
              } else if (event.message?.startsWith("agent.self_refine_") && eventData.agent_index != null) {
                const roundNum = event.message.split("_").pop() || "2";
                store.setActiveAgent(sessionId, eventData.agent_index);
                (es as any)._currentAgentIdx = eventData.agent_index;
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "thinking",
                  content: `🔄 Self-refine (round ${roundNum}): ${eventData.agent_role || eventData.agent_type}`,
                  timestamp: Date.now(),
                });
              } else if (event.message?.startsWith("agent.round_") && eventData.agent_index != null) {
                const roundNum = event.message.split("_")[1] || "2";
                store.setActiveAgent(sessionId, eventData.agent_index);
                (es as any)._currentAgentIdx = eventData.agent_index;
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "thinking",
                  content: `Round ${roundNum}: ${eventData.agent_role || eventData.agent_type} refining...`,
                  timestamp: Date.now(),
                });
              } else if (event.message === "agent.input" && eventData.agent_index != null) {
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "input",
                  content: eventData.output || "",
                  timestamp: Date.now(),
                });
              } else if ((event.message === "agent.completed" || event.message === "agent.failed") && eventData.agent_index != null) {
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: eventData.success === false ? "error" : "message",
                  content: eventData.output || "Done",
                  timestamp: Date.now(),
                });
                store.completeAgent(sessionId, eventData.agent_index);
              }

              // Tool & turn events — resolve agent index from role or fallback to tracked index
              const evType = event.type || "";
              const toolName = eventData.tool_name || eventData.tool || "";

              // Track current agent index locally (closure-safe, not from store)
              if (event.message === "agent.started" && eventData.agent_index != null) {
                (es as any)._currentAgentIdx = eventData.agent_index;
              }

              // Resolve agent index: prefer matching by role (works during parallel execution)
              let localIdx: number = (es as any)._currentAgentIdx ?? 0;
              if (eventData.role) {
                const matchIdx = currentAgents.findIndex(a => a.role === eventData.role);
                if (matchIdx >= 0) localIdx = matchIdx;
              }
              const localAgent = currentAgents[localIdx];

              if (evType === "tool.called" && toolName && !toolName.startsWith("spawn_agent")) {
                // Format arguments as readable string
                const args = eventData.arguments || {};
                const argStr = Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(", ");
                store.addLiveEvent(sessionId, {
                  agentIndex: localIdx,
                  agentType: localAgent?.type || eventData.agent || "", agentRole: localAgent?.role || "",
                  type: "tool_call",
                  content: argStr ? `(${argStr})` : "",
                  toolName,
                  timestamp: Date.now(),
                });
              } else if (evType === "tool.succeeded" && toolName && !toolName.startsWith("spawn_agent")) {
                const output = eventData.output || "";
                if (output) {
                  store.addLiveEvent(sessionId, {
                    agentIndex: localIdx,
                    agentType: localAgent?.type || eventData.agent || "", agentRole: localAgent?.role || "",
                    type: "tool_result",
                    content: output,
                    toolName,
                    timestamp: Date.now(),
                  });
                }
              } else if (evType === "tool.failed" && toolName) {
                store.addLiveEvent(sessionId, {
                  agentIndex: localIdx,
                  agentType: localAgent?.type || eventData.agent || "", agentRole: localAgent?.role || "",
                  type: "error",
                  content: `${toolName} failed: ${eventData.output || "unknown error"}`,
                  toolName,
                  timestamp: Date.now(),
                });
              }

              if (evType === "turn.started" || evType === "turn.completed") {
                store.addLiveEvent(sessionId, {
                  agentIndex: localIdx,
                  agentType: localAgent?.type || "", agentRole: localAgent?.role || "",
                  type: "thinking",
                  content: eventData.content?.slice(0, 200) || event.message || "Thinking...",
                  timestamp: Date.now(),
                });
              }

              // Terminal events
              if (event.type === "task_complete" || event.type === "task.completed" || event.type === "task.failed" || event.type === "crew.completed" || event.type === "crew.failed") {
                es.close();
                delete sseRefs[sessionId];

                // Fetch final result (small delay to let backend store metadata after event emit)
                const fetchResult = (retries = 3) => {
                  fetch(`${BASE_URL}/agents/taskforce/${taskId}`, { headers: th })
                    .then(r => r.json())
                    .then(resp => {
                      const data = resp.result || {};
                      const duration = Date.now() - startTime;
                      const answer = data.final_output || data.error || "";

                      // If result is empty and retries left, the backend hasn't written metadata yet
                      if (!answer && retries > 0) {
                        setTimeout(() => fetchResult(retries - 1), 500);
                        return;
                      }

                      const metrics = {
                        tokens: data.total_tokens || 0,
                        cost: data.total_cost || 0,
                        turns: data.total_turns || 0,
                        duration: data.duration_ms || duration,
                      };
                      if (data.success !== false) {
                        store.setResult(sessionId, answer || "Completed", metrics);
                      } else {
                        store.setStatus(sessionId, "failed");
                        store.setResult(sessionId, answer || "Failed", metrics);
                      }
                      // Update run in workflow hierarchy
                      const sess = useAgentSessionStore.getState().sessions.find(s => s.id === sessionId);
                      if (sess?.workflowId && sess?.runId) {
                        wfStore.updateRun(sess.workflowId, sess.runId, {
                          status: data.success !== false ? "completed" : "failed",
                          answer: answer || null, metrics,
                          liveEvents: sess.liveEvents.slice(-30),
                          ...(sess.taskId ? { taskId: sess.taskId } : {}),
                        }, th);
                      }
                    })
                    .catch(() => {
                      if (retries > 0) { setTimeout(() => fetchResult(retries - 1), 500); return; }
                      store.setStatus(sessionId, "failed");
                      store.setResult(sessionId, "Failed to fetch result", { tokens: 0, cost: 0, turns: 0, duration: Date.now() - startTime });
                    });
                };
                setTimeout(() => fetchResult(), 300);
              }
            } catch { /* ignore parse errors */ }
          };

          es.onerror = () => {
            es.close();
            delete sseRefs[sessionId];
            // Check if we already got a result
            const sess = store.sessions.find(s => s.id === sessionId);
            if (sess && sess.status === "running") {
              // SSE dropped — try fetching result
              fetch(`${BASE_URL}/agents/taskforce/${taskId}`, { headers: th })
                .then(r => r.json())
                .then(resp => {
                  const data = resp.result;
                  if (data) {
                    const answer = data.final_output || "Completed";
                    store.setResult(sessionId, answer, { tokens: data.total_tokens || 0, cost: data.total_cost || 0, turns: data.total_turns || 0, duration: data.duration_ms || Date.now() - startTime });
                  }
                })
                .catch(() => {});
            }
          };

          return; // Don't fall through — SSE handles completion
        }

      } else {
        // ── Single agent: use /agents/spawn (direct execution) ──
        const agent = currentAgents[0];
        const convId = `agents-${Date.now().toString(36)}`;
        store.setConvId(sessionId, convId);

        // Also send via /chat for conversation record
        const chatMsg = `[Agent: ${agent.type}] ${effectiveGoal}`;
        fetch(`${BASE_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify({ message: chatMsg, conversation_id: convId, execution_mode: "react" }),
        }).catch(() => {});

        // Execute agent directly
        const res = await fetch(`${BASE_URL}/agents/spawn`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify({
            agent_type: agent.type,
            task: effectiveGoal,
            max_turns: agent.max_turns,
            constitution: agent.instructions || "",
            ...(agent.tools?.length ? { tools: agent.tools } : {}),
          }),
        });
        const data = await res.json();
        const duration = Date.now() - startTime;

        // Store task_id if returned by spawn
        if (data.task_id) store.setTaskId(sessionId, data.task_id);

        store.addLiveEvent(sessionId, {
          agentIndex: 0, agentType: agent.type, agentRole: agent.role,
          type: "message", content: data.output?.slice(0, 300) || "Completed", timestamp: Date.now(),
        });
        store.completeAgent(sessionId, 0);

        if (data.success !== false) {
          store.setResult(sessionId, data.output || "Agent completed.", {
            tokens: data.tokens_used || 0, cost: data.cost || 0,
            turns: data.turns_used || 0, duration,
          });
        } else {
          store.setStatus(sessionId, "failed");
          store.setResult(sessionId, data.error || data.output || "Agent failed.", {
            tokens: data.tokens_used || 0, cost: data.cost || 0,
            turns: data.turns_used || 0, duration,
          });
        }
      }
    } catch (e) {
      store.setStatus(sessionId, "failed");
      store.setResult(sessionId, String(e), { tokens: 0, cost: 0, turns: 0, duration: Date.now() - startTime });
    }
  }, [canRun, activeId, isRunning, goal, agents, pattern, teamConstitution, th, store, wfStore, isMobile, runParamValues]);

  const handleStop = useCallback(() => {
    if (!activeId) return;
    const es = sseRefs[activeId];
    if (es) { es.close(); delete sseRefs[activeId]; }
    const sess = sessions.find(s => s.id === activeId);
    if (sess?.taskId) fetch(`${BASE_URL}/tasks/${sess.taskId}`, { method: "DELETE", headers: th }).catch(() => {});
    store.setStatus(activeId, "failed");
    store.setResult(activeId, "Cancelled.", { tokens: 0, cost: 0, turns: 0, duration: 0 });
    // Update the run in workflow store
    if (sess?.workflowId && (sess as any)?.runId) {
      wfStore.updateRun(sess.workflowId, (sess as any).runId, { status: "cancelled" }, th);
    }
  }, [activeId, sessions, th, store, wfStore]);

  const [paused, setPaused] = useState(false);
  const [resumeOutput, setResumeOutput] = useState("");

  const handlePause = useCallback(() => {
    if (!activeId) return;
    const sess = sessions.find(s => s.id === activeId);
    if (sess?.taskId) {
      fetch(`${BASE_URL}/tasks/${sess.taskId}/pause`, { method: "POST", headers: th }).catch(() => {});
      setPaused(true);
      store.addLiveEvent(activeId, {
        agentIndex: sess.activeAgentIndex, agentType: "system", agentRole: "system",
        type: "message", content: "⏸ Execution paused by user", timestamp: Date.now(),
      });
    }
  }, [activeId, sessions, th, store]);

  const handleResume = useCallback((modifiedOutput?: string) => {
    if (!activeId) return;
    const sess = sessions.find(s => s.id === activeId);
    if (sess?.taskId) {
      fetch(`${BASE_URL}/tasks/${sess.taskId}/resume`, {
        method: "POST", headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ modified_output: modifiedOutput || undefined }),
      }).catch(() => {});
      setPaused(false);
      setResumeOutput("");
      store.addLiveEvent(activeId, {
        agentIndex: sess.activeAgentIndex, agentType: "system", agentRole: "system",
        type: "message", content: modifiedOutput ? "▶ Resumed with modified output" : "▶ Resumed", timestamp: Date.now(),
      });
    }
  }, [activeId, sessions, th, store]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      Object.values(sseRefs).forEach(es => es.close());
    };
  }, []);

  // ── Workflow library helpers ──────────────────────────────────────────
  const saveWorkflow = async (name: string) => {
    if (!session || !name.trim()) return;
    const { nodes: snapNodes, edges: snapEdges } = flowGraphRef.current;
    const graphSnapshot = snapNodes.length > 0 ? {
      nodes: snapNodes.map((n: any) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
      edges: snapEdges.map((e: any) => ({ id: e.id, source: e.source, target: e.target, label: e.label, style: e.style, type: e.type })),
    } : null;

    const versionData = {
      config: { ...session.config },
      graph: graphSnapshot,
      note: saveNotes.trim() || undefined,
    };

    // Check if session is linked to an existing workflow → add version
    const existingWfId = (session as any).workflowId;
    if (existingWfId && wfStore.getWorkflow(existingWfId)) {
      // An explicit Save is a deliberate release → promote it to the live version
      const newVer = await wfStore.addVersion(existingWfId, {
        parentVersionId: (session as any).versionId,
        ...versionData,
        activate: true,
      }, th);
      if (newVer) {
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === activeId ? { ...sess, versionId: newVer.id } : sess),
        }));
      }
    } else {
      // Create new workflow + retroactively save current run if done
      const wf = await wfStore.createWorkflow(name.trim(), versionData, th);
      if (wf && activeId) {
        const verId = wf.versions[0]?.id;
        let runId: string | undefined;
        // If session has a completed run, save it to the new workflow
        if (session.status === "completed" || session.status === "failed") {
          const run = await wfStore.addRun(wf.id, verId, {
            status: session.status as any,
            answer: session.answer,
            metrics: session.metrics,
            liveEvents: session.liveEvents,
          }, th);
          if (run) runId = run.id;
        }
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === activeId ? { ...sess, workflowId: wf.id, versionId: verId, workflowName: wf.name, ...(runId ? { runId } : {}) } : sess),
        }));
      }
    }

    // Also keep legacy localStorage for backward compat
    const legacyWf = { id: `wf-${Date.now().toString(36)}`, name: name.trim(), config: { ...session.config }, createdAt: Date.now() };
    const updated = [legacyWf, ...savedTemplates.filter(t => t.name !== name.trim())].slice(0, 30);
    setSavedTemplates(updated);
    localStorage.setItem("kernelmcp_saved_templates", JSON.stringify(updated));

    setShowSaveDialog(false);
    setSavingName("");
    setSaveNotes("");
  };

  // Re-run from history
  const handleRerun = (histSession: AgentSession) => {
    store.duplicateSession(histSession.id);
  };

  const handleABTest = () => {
    if (!activeId || !session) return;
    const newId = store.duplicateSession(activeId);
    setAbTestHint(true);
    setTimeout(() => setAbTestHint(false), 5000);
  };

  // View a history session (load it into the workspace as read-only)
  const handleViewHistory = (histSession: AgentSession) => {
    store.restoreSession(histSession);
  };

  // ── Publish: package the current workflow for a managed, callable deployment ──
  // Placeholders are kept intact so they become per-call inputs on the live API.
  const buildDeployConfig = useCallback(() => {
    const { nodes: snapNodes, edges: snapEdges } = flowGraphRef.current;
    const hasGraph = snapNodes.length > 0;
    const cfg: Record<string, any> = {
      goal: teamConstitution ? `${goal}\n\nContext & requirements: ${teamConstitution}` : goal,
      pattern: hasGraph ? "graph" : pattern,
      constitution: teamConstitution || undefined,
      agents: agents.map(a => ({
        type: a.type, role: a.role, max_turns: a.max_turns,
        ...(a.instructions ? { instructions: a.instructions } : {}),
        ...(a.tools?.length ? { tools: a.tools } : {}),
      })),
    };
    if (hasGraph) {
      cfg.graph = {
        nodes: snapNodes.map((n: any) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
        edges: snapEdges.map((e: any) => ({ source: e.source, target: e.target, label: e.label, style: e.style })),
      };
    }
    return cfg;
  }, [goal, pattern, agents, teamConstitution]);

  const loadDeployments = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/deployments`, { headers: th });
      const d = await r.json();
      setDeployments(d.deployments || []);
    } catch { /* ignore */ }
  }, [th]);

  const openPublish = useCallback(() => {
    setPublishResult(null);
    setPublishLog([]);
    setPublishName(prev => prev || (goal.slice(0, 48) || "My automation"));
    setPublishOpen(true);
    loadDeployments();
  }, [goal, loadDeployments]);

  const doPublish = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishLog([]);
    setPublishResult(null);
    try {
      const res = await fetch(`${BASE_URL}/deployments/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ name: publishName.trim() || "My automation", release_notes: publishNotes, config: buildDeployConfig(),
          workflow_id: session?.workflowId, version_id: session?.versionId }),
      });
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const p of parts) {
          const line = p.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "step") setPublishLog(prev => [...prev, { phase: ev.phase, text: ev.text }]);
          else if (ev.type === "done") {
            setPublishResult({ id: ev.id, name: ev.name, endpoint: ev.endpoint, token: ev.token });
            loadDeployments();
          }
        }
      }
    } catch (e: any) {
      setPublishLog(prev => [...prev, { phase: "Error", text: String(e?.message || e) }]);
    } finally {
      setPublishing(false);
    }
  }, [publishing, publishName, publishNotes, buildDeployConfig, th, loadDeployments, session?.workflowId, session?.versionId]);

  const deleteDeployment = useCallback(async (id: string) => {
    try { await fetch(`${BASE_URL}/deployments/${id}`, { method: "DELETE", headers: th }); } catch { /* ignore */ }
    loadDeployments();
  }, [th, loadDeployments]);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  }, []);

  const apiOrigin = typeof window !== "undefined" ? BASE_URL.replace(/\/$/, "") : "";
  const curlExample = publishResult
    ? `curl -X POST ${apiOrigin}${publishResult.endpoint} \\\n  -H "Authorization: Bearer ${publishResult.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"inputs": {}}'`
    : "";

  // ── Render ────────────────────────────────────────────────────────────

  // Map workflowId → deployment status, so the library can flag genuinely-deployed workflows
  const liveWorkflows = useMemo(() => {
    const m: Record<string, "live" | "paused"> = {};
    for (const d of deployments) {
      if (!d.workflowId) continue;
      if (d.status !== "paused" || !m[d.workflowId]) m[d.workflowId] = d.status === "paused" ? "paused" : "live";
    }
    return m;
  }, [deployments]);

  const libraryPanelEl = (
    <LibraryPanel
      open={libraryOpen} setOpen={setLibraryOpen}
      liveWorkflows={liveWorkflows}
      workflows={wfStore.workflows}
      schedules={wfStore.schedules}
      activeWorkflowId={session?.workflowId}
      activeVersionId={session?.versionId}
      activeRunId={(session as any)?.runId}
      canSave={!!session && session.config.agents.length > 0}
      onSave={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }}
      onLoadVersion={(wf, ver) => {
        // Dedup: check if already open
        const existing = sessions.find(s => s.workflowId === wf.id && s.versionId === ver.id && !s.runId);
        if (existing) { store.setActive(existing.id); if (isMobile) setLibraryOpen(false); return; }
        const newSess = store.createSession();
        store.updateConfig(newSess, ver.config);
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === newSess ? { ...sess, graph: ver.graph, readOnly: false, workflowId: wf.id, versionId: ver.id, workflowName: wf.name } : sess),
        }));
        if (isMobile) setLibraryOpen(false);
      }}
      onViewRun={(wf, ver, run) => {
        // Dedup: check if run already open
        const existing = sessions.find(s => s.runId === run.id);
        if (existing) { store.setActive(existing.id); if (isMobile) setLibraryOpen(false); return; }
        const newSess = store.createSession();
        store.updateConfig(newSess, ver.config);
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === newSess ? {
            ...sess, graph: ver.graph, readOnly: true, status: run.status as any,
            answer: run.answer, metrics: run.metrics, liveEvents: run.liveEvents || [],
            feedback: run.feedback, workflowId: wf.id, versionId: ver.id, runId: run.id, workflowName: wf.name,
            completedAgents: ver.config.agents.map((_: any, i: number) => i),
          } : sess),
        }));
        if (isMobile) { setLibraryOpen(false); setMobileTab("output"); }
      }}
      onForkVersion={(wf, ver) => {
        // Fork always creates a new session (intentional — new editable copy)
        const newSess = store.createSession();
        store.updateConfig(newSess, ver.config);
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === newSess ? { ...sess, graph: ver.graph ? JSON.parse(JSON.stringify(ver.graph)) : null, readOnly: false, workflowId: wf.id, versionId: ver.id, workflowName: wf.name } : sess),
        }));
        if (isMobile) setLibraryOpen(false);
      }}
      onDeleteWorkflow={(id) => wfStore.deleteWorkflow(id, th)}
      onActivateVersion={(wid, vid) => wfStore.activateVersion(wid, vid, th)}
      onDeleteSchedule={(id) => {
        fetch(`${BASE_URL}/agents/taskforce/schedules/${id}`, { method: "DELETE", headers: th }).catch(() => {});
        wfStore.loadSchedules(th);
      }}
      compareItems={compareItems}
      onAddToCompare={(item) => setCompareItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item])}
    />
  );

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden">

      {/* Run parameters (modal) — fill {placeholders} + preview before running */}
      {runParamsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setRunParamsOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
              <div className="flex items-center gap-2"><Settings className="h-4 w-4 text-violet-400" /><h3 className="text-sm font-semibold text-slate-200">Run parameters</h3></div>
              <button onClick={() => setRunParamsOpen(false)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <p className="text-[11px] text-slate-500">This workflow uses placeholders — fill them in and they're substituted everywhere they appear.</p>
              {Object.keys(runParamValues).map((k, i) => (
                <div key={k}>
                  <label className="text-[10px] font-medium text-violet-300 block mb-1">{k}</label>
                  <input
                    autoFocus={i === 0}
                    value={runParamValues[k]}
                    onChange={e => setRunParamValues(p => ({ ...p, [k]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" && !Object.values(runParamValues).some(v => !v.trim())) { setRunParamsOpen(false); handleRun(runParamValues); } }}
                    placeholder={`Enter ${k}…`}
                    className="w-full !py-2 !px-3 text-sm"
                  />
                </div>
              ))}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="text-[10px] text-slate-500 mb-1">Preview — goal</div>
                <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                  {String(goal).split(/(\{[a-zA-Z0-9_]+\})/g).map((part, idx) => {
                    const m = part.match(/^\{([a-zA-Z0-9_]+)\}$/);
                    if (m) return <span key={idx} className="px-1 rounded bg-violet-500/20 text-violet-200 font-medium">{runParamValues[m[1]]?.trim() || m[1]}</span>;
                    return <span key={idx}>{part}</span>;
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
              <button onClick={() => setRunParamsOpen(false)} className="px-3.5 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors">Cancel</button>
              <button
                disabled={Object.values(runParamValues).some(v => !v.trim())}
                onClick={() => { setRunParamsOpen(false); handleRun(runParamValues); }}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all"
              >
                <Play className="h-3.5 w-3.5" /> Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish → deploy modal (workflow as a callable API) ───────────── */}
      {publishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" onClick={() => !publishing && setPublishOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 animate-scale-in max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-200">{publishResult ? "Deployment is live" : "Ready to go live"}</h3>
              </div>
              <button onClick={() => !publishing && setPublishOpen(false)} disabled={publishing}><X className="h-4 w-4 text-slate-500 hover:text-slate-300 disabled:opacity-30" /></button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {/* Success card */}
              {publishResult ? (
                <div className="space-y-3 animate-fade-in">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-[12px] font-semibold text-emerald-300">{publishResult.name} is deployed</span>
                    </div>
                    <p className="text-[10.5px] text-slate-400">Your workflow is now a public, token-authed API. Any <code className="text-slate-300">{`{placeholder}`}</code> becomes a per-call input.</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1"><Globe className="h-3 w-3 text-sky-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Endpoint</span></div>
                    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2">
                      <code className="flex-1 text-[11px] text-sky-300 break-all">POST {apiOrigin}{publishResult.endpoint}</code>
                      <button onClick={() => copyToClipboard(`${apiOrigin}${publishResult.endpoint}`, "ep")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "ep" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1"><KeyRound className="h-3 w-3 text-amber-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Bearer token</span><span className="text-[9px] text-amber-400/80">— shown once, copy it now</span></div>
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/15 bg-[#08080f] px-3 py-2">
                      <code className="flex-1 text-[11px] text-amber-300 break-all">{publishResult.token}</code>
                      <button onClick={() => copyToClipboard(publishResult.token, "tok")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "tok" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1"><Terminal className="h-3 w-3 text-slate-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Call it</span></div>
                    <div className="relative rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                      <button onClick={() => copyToClipboard(curlExample, "curl")} className="absolute top-2 right-2 text-slate-500 hover:text-slate-200">{copied === "curl" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                      <pre className="text-[10.5px] text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">{curlExample}</pre>
                    </div>
                  </div>
                </div>
              ) : publishing || publishLog.length ? (
                /* Deploy pipeline log */
                <div className="space-y-2">
                  {publishLog.map((s, i) => (
                    <div key={i} className="flex items-center gap-2.5 animate-fade-in">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.phase === "Error" ? "bg-red-400" : i === publishLog.length - 1 && publishing ? "bg-sky-400 animate-pulse" : "bg-emerald-400"}`} />
                      <span className={`text-[10px] font-semibold uppercase tracking-wide w-24 shrink-0 ${s.phase === "Error" ? "text-red-400" : "text-slate-400"}`}>{s.phase}</span>
                      <span className="text-[11px] text-slate-300">{s.text}</span>
                    </div>
                  ))}
                  {publishing && <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1"><Loader2 className="h-3 w-3 animate-spin" /> Deploying…</div>}
                </div>
              ) : (
                /* Publish form */
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Automation name</label>
                    <input value={publishName} onChange={e => setPublishName(e.target.value)} placeholder="My automation" className="w-full !py-2 !px-3 text-sm" autoFocus />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Release notes <span className="text-slate-600 normal-case">(optional)</span></label>
                    <textarea value={publishNotes} onChange={e => setPublishNotes(e.target.value)} rows={2} placeholder="What's in this version…" className="w-full !text-[12px] !bg-[#08080f] !border-white/[0.06]" />
                  </div>
                  <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.04] px-3 py-2.5 text-[10.5px] text-slate-400 leading-relaxed">
                    Packages <span className="text-slate-200 font-medium">{agents.length} agent(s)</span> · pattern <span className="text-slate-200 font-medium">{(flowGraphRef.current?.nodes?.length || 0) > 0 ? "graph" : pattern}</span> into a token-authed API endpoint. Placeholders stay as runtime inputs.
                  </div>
                </div>
              )}

              {/* Live deployments console */}
              {deployments.length > 0 && (
                <div className="pt-1 border-t border-white/[0.06]">
                  <div className="flex items-center gap-1.5 mb-2 mt-3"><Globe className="h-3 w-3 text-slate-500" /><span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Live deployments ({deployments.length})</span></div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {deployments.map(d => (
                      <div key={d.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-200 font-medium truncate">{d.name}</div>
                          <div className="text-[9.5px] text-slate-500 truncate">{d.runs} run(s) · <code className="text-slate-400">{d.endpoint}</code></div>
                        </div>
                        <button onClick={() => copyToClipboard(`${apiOrigin}${d.endpoint}`, `dep-${d.id}`)} className="text-slate-500 hover:text-sky-300 shrink-0" data-tooltip="Copy endpoint">{copied === `dep-${d.id}` ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                        <button onClick={() => deleteDeployment(d.id)} className="text-slate-500 hover:text-red-400 shrink-0" data-tooltip="Delete deployment"><Trash className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06] shrink-0">
              {publishResult ? (
                <button onClick={() => { setPublishResult(null); setPublishLog([]); }} className="px-3.5 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors">Publish another</button>
              ) : (
                <button onClick={() => setPublishOpen(false)} disabled={publishing} className="px-3.5 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors disabled:opacity-30">Close</button>
              )}
              {!publishResult && (
                <button onClick={doPublish} disabled={publishing || !publishName.trim()} className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all">
                  {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />} {publishing ? "Deploying…" : "Deploy"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save dialog (modal overlay) */}
      {showSaveDialog && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 " onClick={() => setShowSaveDialog(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#0c0c14] border border-white/[0.08] rounded-2xl p-5 w-80 shadow-2xl shadow-black/40 animate-scale-in">
            <div className="flex items-center gap-2 mb-3">
              <Save className="h-4 w-4 text-violet-400" />
              <span className="text-sm font-semibold text-slate-200">Save Workflow</span>
            </div>
            <input value={savingName} onChange={e => setSavingName(e.target.value)} onKeyDown={e => e.key === "Enter" && savingName.trim() && saveWorkflow(savingName)}
              placeholder="Workflow name..." className="w-full !py-2.5 !px-3 !text-sm mb-2" autoFocus />
            <textarea value={saveNotes} onChange={e => setSaveNotes(e.target.value)} rows={2}
              placeholder="Release notes (optional) — what changed in this version…"
              className="w-full !text-[12px] !bg-[#08080f] !border-white/[0.06] mb-1" />
            {session?.workflowId && <p className="text-[9px] text-slate-600 mb-3">Saving creates a new version and makes it the active one.</p>}
            <div className="flex gap-2">
              <button onClick={() => saveWorkflow(savingName)} disabled={!savingName.trim()}
                className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-all">Save</button>
              <button onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 text-xs font-medium rounded-lg border border-white/[0.06] transition-all">Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 shrink-0 border-b border-white/[0.04]">
        <button
          onClick={() => {
            const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
            if (btn) btn.click();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
        <button
          onClick={() => setLibraryOpen(true)}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Library"
        >
          <FolderIcon className="h-4 w-4" />
        </button>
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Agents</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Multi-agent orchestration & workflows</p>
        </div>
        <button
          onClick={() => store.createSession()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/20 transition-all touch-target shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Session</span>
        </button>
      </div>

      <div className="flex gap-2 sm:gap-3 flex-1 min-h-0 px-2 sm:px-3 py-2 sm:py-3">

      {/* Library — inline on desktop */}
      {!isMobile && libraryPanelEl}

      {/* Library — slide-in drawer on mobile */}
      {isMobile && libraryOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setLibraryOpen(false)} />
          <div className="fixed top-0 left-0 bottom-0 z-50 w-[272px] max-w-[85vw] p-2 flex md:hidden animate-slide-in bg-[#0c0c14] border-r border-white/[0.08] shadow-2xl shadow-black/50">
            {libraryPanelEl}
          </div>
        </>
      )}

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-2">

      {/* ── Session Tabs ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide shrink-0 px-1">
        <button
          onClick={() => store.createSession()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-white/[0.08] text-slate-500 hover:text-violet-300 hover:border-violet-500/20 transition-all text-[11px] font-medium shrink-0 hover:scale-105"
        >
          <Plus className="h-3 w-3" /> New
        </button>
        {sessions.map((sess, si) => {
          const isActive = sess.id === activeId;
          const isFork = sess.status === "configuring" && !!sess.graph;
          const statusIcon = sess.status === "waiting" ? (
            <span className="relative flex h-2 w-2"><span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" /></span>
          ) : sess.status === "running" ? (
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" /></span>
          ) : sess.status === "completed" ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          ) : sess.status === "failed" ? (
            <XCircle className="h-3 w-3 text-red-400" />
          ) : isFork ? (
            <Copy className="h-3 w-3 text-violet-400" />
          ) : (
            <Settings className="h-3 w-3 text-slate-600" />
          );

          const goalText = sess.config.goal ? sess.config.goal.slice(0, 25) + (sess.config.goal.length > 25 ? "..." : "") : "Untitled";
          const label = sess.workflowName || goalText;
          const m = sess.metrics;

          return (
            <button
              key={sess.id}
              onClick={() => store.setActive(sess.id)}
              className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all shrink-0 animate-stagger ${
                isActive
                  ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                  : "border-white/[0.06] bg-white/[0.015] text-slate-400 hover:text-slate-200 hover:border-white/[0.1]"
              }`}
              style={{ animationDelay: `${si * 30}ms` }}
            >
              {statusIcon}
              <span className="max-w-[120px] truncate">{label}</span>
              {m && <span className="text-[8px] text-slate-600">{(m.duration / 1000).toFixed(1)}s</span>}
              {sess.status !== "running" && sess.status !== "waiting" && (
                <X
                  className="h-3 w-3 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); store.removeSession(sess.id); }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Compare Mode ─────────────────────────────────────────────── */}
      {compareMode && compareItems.length >= 2 && (
        <CompareView items={compareItems} onRemove={(id) => {
          const next = compareItems.filter(i => i.id !== id);
          setCompareItems(next);
          if (next.length < 2) setCompareMode(false);
        }} onClose={() => { setCompareMode(false); setCompareItems([]); }} />
      )}

      {/* ── Main Layout ───────────────────────────────────────────────── */}
      {(!compareMode || compareItems.length < 2) && session && (
        <div className="flex flex-col md:flex-row gap-2 md:gap-3 flex-1 min-h-0 animate-fade-in">

          {/* Mobile Build / Output switcher */}
          {isMobile && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06] shrink-0">
              <button
                onClick={() => setMobileTab("build")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all touch-target ${mobileTab === "build" ? "bg-violet-500/15 text-violet-300" : "text-slate-500"}`}
              >
                <Settings className="h-3.5 w-3.5" /> Build
              </button>
              <button
                onClick={() => setMobileTab("output")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all touch-target ${mobileTab === "output" ? "bg-violet-500/15 text-violet-300" : "text-slate-500"}`}
              >
                <Activity className="h-3.5 w-3.5" /> Output
                {session.liveEvents.length > 0 && <span className="text-[8px] px-1 rounded bg-violet-500/20 text-violet-300">{session.liveEvents.length}</span>}
              </button>
            </div>
          )}

          {/* ── Left: Config Panel ─────────────────────────────────────── */}
          <div className={`transition-all duration-300 ease-in-out flex-col min-h-0 gap-2 flex-1 ${isMobile && mobileTab !== "build" ? "hidden" : "flex"}`} style={{ minWidth: 0 }}>

            {/* Goal + Templates (disabled during run or read-only) */}
            <div className={isRunning || isReadOnly ? "opacity-60 pointer-events-none select-none" : ""}>
            <div className="shrink-0">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Goal</label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleArchitect(goal)}
                    disabled={!goal.trim() || isRunning || building}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 rounded-lg transition-all disabled:opacity-30"
                    data-tooltip="AI architects the agent team — describe, then refine in chat"
                  >
                    {building ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {building ? "Building…" : "Build with AI"}
                  </button>
                  <TemplateSelector templates={TEMPLATES} onSelect={applyTemplate} />
                </div>
              </div>
              <input
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={e => e.key === "Enter" && canRun && !isRunning && handleRun()}
                placeholder="What should the agent(s) accomplish?"
                className="w-full !py-2.5 !px-4 text-sm"
                disabled={isRunning}
              />
              {/* Conversational chat-to-build: architect thread + refine input */}
              {(building || buildChat.length > 0) && (
                <div className="mt-2 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2 animate-fade-in">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="h-3 w-3 text-violet-400" />
                    <span className="text-[10px] font-semibold text-violet-300 uppercase tracking-wide">AI Architect</span>
                    {!building && (
                      <button onClick={() => setBuildChat([])} className="ml-auto text-[10px] text-slate-500 hover:text-slate-300">clear</button>
                    )}
                  </div>
                  <div ref={buildScrollRef} className="space-y-2 max-h-56 overflow-y-auto pr-1 scroll-smooth">
                    {buildChat.map((m, i) => (
                      m.role === "user" ? (
                        <div key={i} className="flex justify-end">
                          <span className="text-[11px] bg-violet-500/15 text-violet-200 rounded-lg px-2.5 py-1.5 max-w-[85%]">{m.text}</span>
                        </div>
                      ) : (
                        <p key={i} className="text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap break-words">
                          {m.text}
                          {building && i === buildChat.length - 1 && <span className="inline-block w-1 h-3 ml-0.5 bg-violet-400 align-middle animate-pulse" />}
                        </p>
                      )
                    ))}
                  </div>
                  {/* Missing capability — actionable: jump to connect it */}
                  {!building && buildMissing.length > 0 && (
                    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-2.5 py-2 animate-fade-in">
                      <div className="flex items-start gap-1.5">
                        <AlertCircle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-amber-300/90 leading-relaxed">Needs connecting: {buildMissing.join(", ")}</div>
                          <Link href="/settings" className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-amber-300 hover:text-amber-200">
                            Connect it in Settings <ArrowRight className="h-2.5 w-2.5" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Quick-refine suggestion chips (architect-proposed, one click) */}
                  {!building && buildSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {buildSuggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => handleArchitect(s)}
                          className="text-[10px] px-2 py-1 rounded-full bg-violet-500/8 border border-violet-500/20 text-violet-300 hover:bg-violet-500/15 hover:border-violet-500/40 transition-all animate-fade-in"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Refine input */}
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.05]">
                    <input
                      value={buildInput}
                      onChange={e => setBuildInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && buildInput.trim() && !building) { handleArchitect(buildInput); setBuildInput(""); } }}
                      placeholder={building ? "Architect is thinking…" : "Refine: add a tester, make it parallel…"}
                      disabled={building}
                      className="flex-1 !py-1.5 !px-3 text-[11px] bg-white/[0.03] border border-white/[0.08] rounded-lg disabled:opacity-50"
                    />
                    <button
                      onClick={() => { if (buildInput.trim() && !building) { handleArchitect(buildInput); setBuildInput(""); } }}
                      disabled={!buildInput.trim() || building}
                      className="p-1.5 rounded-lg bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-30 transition-all"
                    >
                      {building ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            </div>{/* end disabled-during-run wrapper */}

            <div className="flex-1 min-h-0 relative">
            <FlowEditor key={activeId} agents={agents} pattern={pattern} triggerType={triggerType} triggerConfig={{ cronExpression: session?.config.cronExpression, intervalSeconds: session?.config.intervalSeconds, scheduleDate: session?.config.scheduleDate, scheduleTime: session?.config.scheduleTime, webhookPath: session?.config.webhookPath, watchCommand: session?.config.watchCommand, watchCondition: session?.config.watchCondition }} workspaceEnabled={workspaceEnabled} workspaceName={session?.config.workspaceName} workspaceMode={session?.config.workspaceMode} humanGates={humanGates} errorNodeIds={errorNodeIds} errorReasons={errorReasons} validationWarnings={[...agentsWithoutRole.length > 0 ? [`${agentsWithoutRole.length} agent${agentsWithoutRole.length > 1 ? "s" : ""} missing a role`] : [], ...flowWarnings]} activeAgentIndex={session?.activeAgentIndex ?? -1} activeAgentIndices={session?.activeAgentIndices ?? []} completedAgents={session?.completedAgents ?? []} isRunning={isRunning} locked={isRunning || isDone || isReadOnly || building} waitingNodeId={waitingNodeId} deniedNodeIds={deniedNodeIds} approvedNodeIds={approvedNodeIds} revisionNodeIds={revisionNodeIds} agentOutputs={(() => {
              const outputs: Record<number, string> = {};
              (session?.liveEvents || []).forEach(e => {
                if (e.type === "message" && e.content) outputs[e.agentIndex] = e.content;
              });
              return outputs;
            })()} graphRef={flowGraphRef} initialGraph={session?.graph} onPatternChange={(p) => setPattern(p as Pattern)} onUpdateFlow={(nodes, edges) => {
              // Sync agent nodes back to store
              const agentNodes = nodes.filter(n => n.type === "agent");
              const synced: TeamAgent[] = agentNodes.map(n => {
                const d = n.data as any;
                const existing = agents.find(a => a.id === n.id);
                return {
                  id: n.id,
                  name: d.label ?? existing?.name ?? "",
                  description: d.description ?? existing?.description ?? "",
                  type: d.agentType ?? existing?.type ?? "custom",
                  role: d.role ?? existing?.role ?? "",
                  max_turns: d.maxTurns ?? existing?.max_turns ?? 5,
                  instructions: d.instructions ?? existing?.instructions ?? "",
                  tools: d.tools ?? existing?.tools ?? [],
                };
              });
              // Only write back when VALUES actually changed — the debounced sync fires on
              // every node touch (incl. React Flow's own measurements), and an unconditional
              // store write here would re-render → re-measure → sync → … a CPU-burning loop
              // (the cause of other tabs hanging). Compare by value signature, ignoring ids.
              const aSig = (a: any) => `${a.type}|${a.role}|${(a.tools || []).join(",")}|${a.instructions || ""}|${a.max_turns}|${a.name || ""}`;
              if (synced.map(aSig).join("§") !== agents.map(aSig).join("§")) {
                setAgents(synced);
              }

              // Sync the trigger node (type + cron/interval/… value) back to the session
              // config so scheduling/runs use what the user set — but only when it changed.
              const trig = nodes.find(n => n.type === "trigger");
              if (trig && activeId) {
                const td = trig.data as any;
                const cfg = session?.config as any;
                const tKeys = ["cronExpression", "intervalSeconds", "scheduleDate", "scheduleTime", "webhookPath", "watchCommand", "watchCondition"];
                const newType = td.triggerType || "manual";
                const trigChanged = newType !== (cfg?.triggerType || "manual") || tKeys.some(kk => td[kk] !== undefined && td[kk] !== "" && td[kk] !== cfg?.[kk]);
                if (trigChanged) {
                  const tPatch: any = { triggerType: newType };
                  for (const kk of tKeys) if (td[kk] !== undefined && td[kk] !== "") tPatch[kk] = td[kk];
                  store.updateConfig(activeId, tPatch);
                }
              }

              // Validate connectivity + collect error node IDs with reason
              const triggerNode = nodes.find(n => n.type === "trigger");
              const endNode = nodes.find(n => n.type === "end");
              const warnings: string[] = [];
              const reasons: Record<string, string> = {};

              // All functional nodes (everything except trigger and end)
              const functionalNodes = nodes.filter(n => n.type !== "trigger" && n.type !== "end");
              const getLabel = (n: any) => (n.data as any).label || (n.data as any).role || (n.data as any).agentType || n.type || "?";

              // Agents without role
              for (const n of agentNodes) {
                const d = n.data as any;
                if (!(d.role ?? "").trim()) reasons[n.id] = "missing role";
              }

              // Orphans: functional nodes with no incoming edges
              const nodesWithIncoming = new Set(edges.map(e => e.target));
              const orphans = functionalNodes.filter(n => !nodesWithIncoming.has(n.id));
              if (orphans.length > 0) {
                const names = orphans.map(getLabel).join(", ");
                warnings.push(`No incoming connection: ${names}`);
                orphans.forEach(n => { reasons[n.id] = reasons[n.id] ? reasons[n.id] + " + no input" : "no input"; });
              }

              // Dead ends: functional nodes with no outgoing edges
              const nodesWithOutgoing = new Set(edges.map(e => e.source));
              const deadEnds = functionalNodes.filter(n => !nodesWithOutgoing.has(n.id));
              if (deadEnds.length > 0) {
                const names = deadEnds.map(getLabel).join(", ");
                warnings.push(`No outgoing connection: ${names}`);
                deadEnds.forEach(n => { reasons[n.id] = reasons[n.id] ? reasons[n.id] + " + no output" : "no output"; });
              }

              setFlowWarnings(warnings);
              setErrorNodeIds(Object.keys(reasons));
              setErrorReasons(reasons);
            }} />
            {/* Block + overlay the canvas while the AI is editing the graph */}
            {building && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0a10]/55 backdrop-blur-[2px] cursor-wait animate-fade-in">
                <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-violet-500/12 border border-violet-500/25 shadow-xl">
                  <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
                  <span className="text-[13px] font-medium text-violet-200">AI is building your workflow&hellip;</span>
                </div>
              </div>
            )}
            </div>

            {/* Run / Stop / Fork */}
            <div className="shrink-0">
              <div className="flex gap-2">
                {isDone ? (
                  <>
                    {!isReadOnly && (
                      <button onClick={() => handleRun()} disabled={!canRun}
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium rounded-lg transition-all">
                        <Play className="h-4 w-4" /> Run Again
                      </button>
                    )}
                    <button onClick={() => { if (activeId) { store.duplicateSession(activeId); } }}
                      className={`${isReadOnly ? "flex-1" : ""} flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-violet-300 border border-white/[0.06] hover:border-violet-500/20 text-sm font-medium rounded-lg transition-all shrink-0`}>
                      <Copy className="h-4 w-4" /> Fork & Edit
                    </button>
                    {!isReadOnly && agents.length > 0 && (
                      <button onClick={openPublish}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 border border-sky-500/25 text-sm font-medium rounded-lg transition-all shrink-0"
                        data-tooltip="Publish as a callable API endpoint (bearer-token auth)" data-tooltip-top data-tooltip-left>
                        <Rocket className="h-4 w-4" /> Publish
                      </button>
                    )}
                    {!session?.workflowId ? (
                      <button onClick={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600/80 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all shrink-0">
                        <Save className="h-4 w-4" /> Save
                      </button>
                    ) : (
                      <button onClick={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-emerald-300 border border-white/[0.06] hover:border-emerald-500/20 text-sm font-medium rounded-lg transition-all shrink-0">
                        <Save className="h-4 w-4" />
                      </button>
                    )}
                  </>
                ) : isRunning ? (
                  <>
                    {!paused ? (
                      <button onClick={handlePause} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-amber-600/80 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-all">
                        <Square className="h-4 w-4" /> Pause
                      </button>
                    ) : (
                      <button onClick={() => handleResume()} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600/80 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all">
                        <Play className="h-4 w-4" /> Resume
                      </button>
                    )}
                    <button onClick={handleStop} className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600/80 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-all shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleRun()} disabled={!canRun} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium rounded-lg transition-all">
                      <Play className="h-4 w-4" /> Run
                    </button>
                    {agents.length > 0 && !session?.workflowId && (
                      <button onClick={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600/80 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-all shrink-0">
                        <Save className="h-4 w-4" /> Save
                      </button>
                    )}
                    {agents.length > 0 && !isReadOnly && (
                      <button onClick={openPublish} disabled={!canRun}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 border border-sky-500/25 disabled:opacity-30 text-sm font-medium rounded-lg transition-all shrink-0"
                        data-tooltip="Publish as a callable API endpoint (bearer-token auth)" data-tooltip-top data-tooltip-left>
                        <Rocket className="h-4 w-4" /> Publish
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Pause: Modify & Resume panel */}
            {paused && isRunning && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <Square className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[11px] font-semibold text-amber-300">Execution Paused</span>
                </div>
                <p className="text-[10px] text-slate-400">Edit the output below before resuming, or resume as-is.</p>
                <textarea
                  value={resumeOutput}
                  onChange={e => setResumeOutput(e.target.value)}
                  rows={3}
                  placeholder="Modify the current output before passing to the next agent..."
                  className="w-full !text-[11px] !bg-[#08080f] !border-white/[0.06]"
                />
                <div className="flex gap-2">
                  <button onClick={() => handleResume(resumeOutput || undefined)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-white text-[10px] font-medium rounded-lg transition-all">
                    <Play className="h-3 w-3" /> {resumeOutput.trim() ? "Resume with edits" : "Resume"}
                  </button>
                  <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-[10px] font-medium rounded-lg border border-red-500/20 transition-all">
                    <X className="h-3 w-3" /> Stop
                  </button>
                </div>
              </div>
            )}


          </div>

          {/* ── Right: Output Panel ──────────────────────────────────────── */}
          {(!isMobile || mobileTab === "output") && (
            <OutputPanel
              session={session} agents={agents} isRunning={isRunning} isDone={isDone}
              isConfiguring={isConfiguring} isWaiting={isWaiting} open={isMobile ? true : rightPanelOpen}
              setOpen={setRightPanelOpen} tenant={tenant} th={th} store={store}
              showEval={showEval} setShowEval={setShowEval}
              HumanGateActionsComponent={HumanGateActions} mobile={isMobile}
            />
          )}
        </div>
      )}

      </div>
      </div>

      {/* ── Compare Tray (floating) ─────────────────────────────────── */}
      {!compareMode && (
        <CompareTray
          items={compareItems}
          onRemove={(id) => setCompareItems(prev => prev.filter(i => i.id !== id))}
          onCompare={() => setCompareMode(true)}
          onClear={() => setCompareItems([])}
        />
      )}
    </div>
  );
}

