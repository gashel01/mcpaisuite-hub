import { useState, useCallback, useEffect, type MutableRefObject } from "react";
import { apiFetch } from "@/lib/api";
import { useAgentSessionStore, type AgentSession } from "@/stores/agent-sessions";
import { useWorkflowStore } from "@/stores/workflow-store";
import { sseRefs } from "./constants";

export function useWorkflowActions({ activeId, sessions, session, th, store, wfStore, flowGraphRef, saveNotes, savedTemplates, setSavedTemplates, setShowSaveDialog, setSavingName, setSaveNotes, setAbTestHint }: {
  activeId: string | null;
  sessions: AgentSession[];
  session: AgentSession | null;
  th: Record<string, string>;
  store: ReturnType<typeof useAgentSessionStore.getState>;
  wfStore: ReturnType<typeof useWorkflowStore.getState>;
  flowGraphRef: MutableRefObject<{ nodes: any[]; edges: any[] }>;
  saveNotes: string;
  savedTemplates: { id: string; name: string; config: AgentSession["config"]; createdAt: number }[];
  setSavedTemplates: React.Dispatch<React.SetStateAction<{ id: string; name: string; config: AgentSession["config"]; createdAt: number }[]>>;
  setShowSaveDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setSavingName: React.Dispatch<React.SetStateAction<string>>;
  setSaveNotes: React.Dispatch<React.SetStateAction<string>>;
  setAbTestHint: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [paused, setPaused] = useState(false);
  const [resumeOutput, setResumeOutput] = useState("");

  const handlePause = useCallback(() => {
    if (!activeId) return;
    const sess = sessions.find(s => s.id === activeId);
    if (sess?.taskId) {
      apiFetch<any>(`/tasks/${sess.taskId}/pause`, { method: "POST", headers: th }).catch(() => {});
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
      apiFetch<any>(`/tasks/${sess.taskId}/resume`, {
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
            graph: session.graph || undefined,
            workflowName: wf.name,
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

  return { paused, setPaused, resumeOutput, setResumeOutput, handlePause, handleResume, saveWorkflow, handleRerun, handleABTest, handleViewHistory };
}
