"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter as useNextRouter } from "next/navigation";
import {
  Bot, Play, CheckCircle2, XCircle,
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
import { AGENT_META, TEMPLATES, PATTERNS, newId, sseRefs, type Pattern, type AgentInfo, type Template } from "./constants";
import { apiFetch, apiUrl } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import ConnectionPicker from "@/components/connection-picker";
import TemplateSelector from "./template-selector";
import CompareView, { CompareTray, type CompareItem } from "./compare-view";
import OutputPanel from "./output-panel";
import { useWorkflowStore } from "@/stores/workflow-store";
import LibraryPanel from "./library-panel";
import HumanGateActions from "./human-gate-actions";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { RunParamsModal, PublishModal, SaveDialog } from "./dialogs";
import { useDeployments } from "./use-deployments";
import { useWorkflowRun } from "./use-workflow-run";
import { useWorkflowActions } from "./use-workflow-actions";
import { useWorkflowBuild } from "./use-workflow-build";



// HumanGateActions extracted to ./human-gate-actions.tsx

// ── Main page ──────────────────────────────────────────────────────────────

export default function AgentsPage() {
  return <Suspense><AgentsPageInner /></Suspense>;
}

function AgentsPageInner() {
  const searchParams = useSearchParams();
  const navRouter = useNextRouter();
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  // Selectors (not the whole store) so the page does NOT re-render on every streaming token.
  // streamingText now lives in its own store map, read only by the StreamingText leaf.
  const sessions = useAgentSessionStore(s => s.sessions);
  const activeId = useAgentSessionStore(s => s.activeId);
  const history = useAgentSessionStore(s => s.history);
  // Actions are stable references — grab them non-reactively. Inside callbacks, read fresh
  // state via useAgentSessionStore.getState() rather than this snapshot.
  const store = useAgentSessionStore.getState();
  const wfStore = useWorkflowStore();

  const [agentInfos, setAgentInfos] = useState<AgentInfo[]>([]);
  const [loadingInfos, setLoadingInfos] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"result" | "trace">("trace"); // kept for auto-switch logic
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
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
  const {
    building, setBuilding, buildChat, setBuildChat, buildInput, setBuildInput,
    buildSuggestions, setBuildSuggestions, buildMissing, setBuildMissing, handleArchitect,
  } = useWorkflowBuild({ activeId, th, store });
  const buildScrollRef = useRef<HTMLDivElement>(null);

  // Run parameters: {placeholders} in the goal/instructions become typed inputs before a run.
  const [runParamsOpen, setRunParamsOpen] = useState(false);
  const [runParamValues, setRunParamValues] = useState<Record<string, string>>({});

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
  // Deep-link to a run whose workflow no longer exists and has no snapshot to rebuild from
  const [deepLinkError, setDeepLinkError] = useState<string | boolean>(false);

  // Load data on mount
  useEffect(() => {
    apiFetch<any>(`/agents`).then(r => r.json()).then(d => setAgentInfos(d.agents || [])).catch(() => {}).finally(() => setLoadingInfos(false));
    wfStore.load(th);
    wfStore.loadSchedules(th);
    loadDeployments();
    store.loadHistory();
  }, [tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  // On tenant switch, reload the library then close only the sessions tied to a SAVED workflow
  // that isn't in this tenant (keep unsaved drafts + other tabs). "Reset only if not found."
  // Skip the first run so the URL-restored session on mount isn't touched.
  const agentsTenantRef = useRef(true);
  useEffect(() => {
    if (agentsTenantRef.current) { agentsTenantRef.current = false; return; }
    wfStore.load(th).then(() => {
      const st = useAgentSessionStore.getState();
      const ids = new Set(useWorkflowStore.getState().workflows.map(w => w.id));
      st.sessions.filter(s => s.workflowId && !ids.has(s.workflowId)).forEach(s => st.removeSession(s.id));
      if (useAgentSessionStore.getState().sessions.length === 0) st.createSession();
    });
  }, [tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved templates from localStorage (legacy compat)
  useEffect(() => {
    try { setSavedTemplates(JSON.parse(localStorage.getItem("kernelmcp_saved_templates") || "[]")); } catch {}
  }, []);

  // Recover the output of an older FAILED run persisted before answers were stored
  // (run.answer === null). The backend still holds it in the task result while the task
  // is loaded; fetch it and patch the session + run record so reopening isn't blank.
  const recoverFailedOutput = useCallback((sessionId: string, wfId: string, runId: string, taskId: string) => {
    apiFetch<any>(`/agents/taskforce/${taskId}`, { headers: th })
      .then(resp => {
        const res = resp?.result;
        const recovered: string = res?.final_output || res?.error || "";
        if (!recovered) return;
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === sessionId ? { ...sess, answer: recovered } : sess),
        }));
        wfStore.updateRun(wfId, runId, { answer: recovered }, th);
      })
      .catch(() => {});
  }, [th]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const ver = wf ? (verId ? wf.versions.find(v => v.id === verId) : wf.versions[wf.versions.length - 1]) : null;

    // ── Live path: the workflow + version still exist (editable) ──
    if (wf && ver) {
      const existing = sessions.find(s => runId ? s.runId === runId : (s.workflowId === wfId && s.versionId === ver.id && !s.runId));
      if (existing) { store.setActive(existing.id); return; }
      const newSess = store.createSession();
      store.updateConfig(newSess, ver.config);
      if (runId) {
        const run = wf.runs.find(r => r.id === runId);
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === newSess ? {
            ...sess, graph: ver.graph, readOnly: true, status: (run?.status as any) || "completed",
            answer: run?.answer || null, metrics: run?.metrics || null, liveEvents: run?.liveEvents || [],
            feedback: run?.feedback || null, workflowId: wfId, versionId: ver.id, runId, taskId: run?.taskId ?? null, workflowName: wf.name,
            completedAgents: ver.config.agents.map((_: any, i: number) => i),
          } : sess),
        }));
        // Older failed run stored with no answer → recover its output from the backend.
        if (run?.status === "failed" && !run.answer && run.taskId) {
          recoverFailedOutput(newSess, wfId, runId, run.taskId);
        }
      } else {
        useAgentSessionStore.setState(s => ({
          sessions: s.sessions.map(sess => sess.id === newSess ? {
            ...sess, graph: ver.graph, readOnly: false, workflowId: wfId, versionId: ver.id, workflowName: wf.name,
          } : sess),
        }));
      }
      return;
    }

    // ── Workflow/version gone → reconstruct READ-ONLY from the run's own graph snapshot ──
    if (!runId) { setDeepLinkError(true); return; }
    const existing = sessions.find(s => s.runId === runId);
    if (existing) { store.setActive(existing.id); return; }
    (async () => {
      try {
        const r = await apiFetch<any>(`/runs/${runId}`, { headers: th });
        const run = r;
        if (run && run.graph) {
          const newSess = store.createSession();
          useAgentSessionStore.setState(s => ({
            sessions: s.sessions.map(sess => sess.id === newSess ? {
              ...sess, graph: run.graph, readOnly: true, fromSnapshot: true,
              status: (run.status as any) || "completed",
              answer: run.answer || null, metrics: run.metrics || null, liveEvents: run.liveEvents || [],
              feedback: run.feedback || null, workflowId: wfId, versionId: run.versionId, runId, taskId: run.taskId ?? null,
              workflowName: run.workflowName || "Deleted workflow",
            } : sess),
          }));
          if (run.status === "failed" && !run.answer && run.taskId) {
            recoverFailedOutput(newSess, wfId, runId, run.taskId);
          }
        } else {
          // Legacy run with no snapshot — nothing to reconstruct.
          setDeepLinkError(run?.workflowName || true);
        }
      } catch { setDeepLinkError(true); }
    })();
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

  // Auto-open the output panel only when there's actual output to show.
  // - Fresh/configuring session with no output → stays collapsed.
  // - User hits run (output starts arriving) → opens.
  // - Reopening a past run that already has output → opens.
  // After that the user is free to collapse/expand; we only act on the rising
  // edge (no output → output) or when switching to a different session, so a
  // manual collapse is never overridden mid-run.
  const sessionHasOutput = !!session && (
    session.status !== "configuring" ||
    (session.liveEvents?.length ?? 0) > 0 ||
    !!session.answer
  );
  const lastPanelSessionId = useRef<string | null>(null);
  const prevHasOutput = useRef(false);
  useEffect(() => {
    const sid = session?.id ?? null;
    if (sid !== lastPanelSessionId.current) {
      // Switched session: default the panel to whether this one has output.
      lastPanelSessionId.current = sid;
      prevHasOutput.current = sessionHasOutput;
      setRightPanelOpen(sessionHasOutput);
      return;
    }
    // Same session: open when output first appears (e.g. user hit run).
    if (sessionHasOutput && !prevHasOutput.current) setRightPanelOpen(true);
    prevHasOutput.current = sessionHasOutput;
  }, [session?.id, sessionHasOutput]);

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
  const {
    publishOpen, setPublishOpen, publishName, setPublishName, publishNotes, setPublishNotes,
    publishing, publishLog, setPublishLog, publishResult, setPublishResult, deployments, copied,
    openPublish, doPublish, deleteDeployment, copyToClipboard, loadDeployments,
    apiOrigin, curlExample, liveWorkflows,
  } = useDeployments({ goal, pattern, agents, teamConstitution, flowGraphRef, th, session });

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

  const { handleRun, handleStop } = useWorkflowRun({
    canRun, activeId, isRunning, goal, agents, pattern, teamConstitution, th, tenant, store, wfStore, isMobile, runParamValues, sessions, session, workspaceEnabled,
    setRunParamsOpen, setRunParamValues, setMobileTab, flowGraphRef,
  });

  const { paused, setPaused, resumeOutput, setResumeOutput, handlePause, handleResume, saveWorkflow, handleRerun, handleABTest, handleViewHistory } = useWorkflowActions({
    activeId, sessions, session, th, store, wfStore, flowGraphRef, saveNotes, savedTemplates,
    setSavedTemplates, setShowSaveDialog, setSavingName, setSaveNotes, setAbTestHint,
  });

  // ── Publish: package the current workflow for a managed, callable deployment ──
  // Placeholders are kept intact so they become per-call inputs on the live API.

  // ── Render ────────────────────────────────────────────────────────────


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
        apiFetch<any>(`/agents/taskforce/schedules/${id}`, { method: "DELETE", headers: th }).catch(() => {});
        wfStore.loadSchedules(th);
      }}
      compareItems={compareItems}
      onAddToCompare={(item) => setCompareItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item])}
    />
  );

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden">

      {/* Reconstructed from a run snapshot (original workflow deleted/unsaved) */}
      {session?.fromSnapshot && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/[0.08] border-b border-amber-500/20 text-[11px] text-amber-200 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Reconstructed from this run's snapshot — the original workflow {session.workflowName && session.workflowName !== "Deleted workflow" ? <>(<span className="font-medium">{session.workflowName}</span>)</> : ""} no longer exists. Read-only; <button onClick={() => activeId && store.duplicateSession(activeId)} className="underline hover:text-amber-100">fork it</button> to edit.</span>
        </div>
      )}

      {/* Deep-link to a run whose workflow is gone and has no snapshot to rebuild from */}
      {deepLinkError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/[0.07] border-b border-red-500/20 text-[11px] text-red-200 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>That workflow is no longer available{typeof deepLinkError === "string" ? <> (<span className="font-medium">{deepLinkError}</span>)</> : ""} — it was deleted and this run predates graph snapshots, so it can't be reopened.</span>
          <button onClick={() => setDeepLinkError(false)} className="ml-auto text-red-300 hover:text-red-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <RunParamsModal runParamsOpen={runParamsOpen} setRunParamsOpen={setRunParamsOpen} runParamValues={runParamValues} setRunParamValues={setRunParamValues} handleRun={handleRun} goal={goal} />

      <PublishModal publishOpen={publishOpen} setPublishOpen={setPublishOpen} publishing={publishing} publishResult={publishResult} setPublishResult={setPublishResult} publishLog={publishLog} setPublishLog={setPublishLog} publishName={publishName} setPublishName={setPublishName} publishNotes={publishNotes} setPublishNotes={setPublishNotes} apiOrigin={apiOrigin} copyToClipboard={copyToClipboard} copied={copied} curlExample={curlExample} agents={agents} flowGraphRef={flowGraphRef} pattern={pattern} deployments={deployments} deleteDeployment={deleteDeployment} doPublish={doPublish} />

      <SaveDialog showSaveDialog={showSaveDialog} setShowSaveDialog={setShowSaveDialog} savingName={savingName} setSavingName={setSavingName} saveNotes={saveNotes} setSaveNotes={setSaveNotes} saveWorkflow={saveWorkflow} session={session} />

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
        <ConnectionPicker />
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
                    disabled={!goal.trim() || isRunning || building || isDone || isReadOnly}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 rounded-lg transition-all disabled:opacity-30"
                  >
                    {building ? <Spinner className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />} {building ? "Building…" : "Build with AI"}
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
                      {building ? <Spinner className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            </div>{/* end disabled-during-run wrapper */}

            <div className="flex-1 min-h-0 relative">
            <FlowEditor key={activeId} agents={agents} pattern={pattern} triggerType={triggerType} triggerConfig={{ cronExpression: session?.config.cronExpression, intervalSeconds: session?.config.intervalSeconds, scheduleDate: session?.config.scheduleDate, scheduleTime: session?.config.scheduleTime, webhookPath: session?.config.webhookPath, watchCommand: session?.config.watchCommand, watchCondition: session?.config.watchCondition }} workspaceEnabled={workspaceEnabled} workspaceName={session?.config.workspaceName} workspaceMode={session?.config.workspaceMode} humanGates={humanGates} errorNodeIds={errorNodeIds} errorReasons={errorReasons} validationWarnings={[...agentsWithoutRole.length > 0 ? [`${agentsWithoutRole.length} agent${agentsWithoutRole.length > 1 ? "s" : ""} missing a role`] : [], ...flowWarnings]} activeAgentIndex={session?.activeAgentIndex ?? -1} activeAgentIndices={session?.activeAgentIndices ?? []} completedAgents={session?.completedAgents ?? []} isRunning={isRunning} building={building} locked={isRunning || isDone || isReadOnly || building} waitingNodeId={waitingNodeId} deniedNodeIds={deniedNodeIds} approvedNodeIds={approvedNodeIds} revisionNodeIds={revisionNodeIds} agentOutputs={(() => {
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
                  <Spinner className="h-4 w-4 text-violet-400" />
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
                      <button onClick={() => handleRun()} disabled={!canRun || building}
                        className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium rounded-lg transition-all">
                        <Play className="h-4 w-4" /> Run Again
                      </button>
                    )}
                    <button onClick={() => { if (activeId) { store.duplicateSession(activeId); } }}
                      className={`${isReadOnly ? "flex-1" : ""} flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-violet-300 border border-white/[0.06] hover:border-violet-500/20 text-sm font-medium rounded-lg transition-all shrink-0`}>
                      <Copy className="h-4 w-4" /> Fork & Edit
                    </button>
                    {!isReadOnly && agents.length > 0 && (
                      <button onClick={openPublish} disabled={building}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 border border-sky-500/25 disabled:opacity-30 text-sm font-medium rounded-lg transition-all shrink-0"
                        data-tooltip="Publish as a callable API endpoint (bearer-token auth)" data-tooltip-top data-tooltip-left>
                        <Rocket className="h-4 w-4" /> Publish
                      </button>
                    )}
                    {!session?.workflowId ? (
                      <button onClick={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }} disabled={building}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-30 text-white text-sm font-medium rounded-lg transition-all shrink-0">
                        <Save className="h-4 w-4" /> Save
                      </button>
                    ) : (
                      <button onClick={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }} disabled={building}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-emerald-300 border border-white/[0.06] hover:border-emerald-500/20 disabled:opacity-30 text-sm font-medium rounded-lg transition-all shrink-0">
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
                    <button onClick={() => handleRun()} disabled={!canRun || building} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium rounded-lg transition-all">
                      <Play className="h-4 w-4" /> Run
                    </button>
                    {agents.length > 0 && !session?.workflowId && (
                      <button onClick={() => { if (session && session.config.agents.length > 0) { setSavingName(session.config.goal.slice(0, 40) || "My Workflow"); setShowSaveDialog(true); } }} disabled={building}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-30 text-white text-sm font-medium rounded-lg transition-all shrink-0">
                        <Save className="h-4 w-4" /> Save
                      </button>
                    )}
                    {agents.length > 0 && !isReadOnly && (
                      <button onClick={openPublish} disabled={!canRun || building}
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
