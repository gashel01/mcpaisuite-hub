import { useState, useCallback, useMemo, type MutableRefObject } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import type { TeamAgent, AgentSession } from "@/stores/agent-sessions";

export function useDeployments({ goal, pattern, agents, teamConstitution, flowGraphRef, th, session }: {
  goal: string;
  pattern: string;
  agents: TeamAgent[];
  teamConstitution: string;
  flowGraphRef: MutableRefObject<{ nodes: any[]; edges: any[] }>;
  th: Record<string, string>;
  session: AgentSession | null;
}) {
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishNotes, setPublishNotes] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishLog, setPublishLog] = useState<{ phase: string; text: string }[]>([]);
  const [publishResult, setPublishResult] = useState<{ id: string; name: string; endpoint: string; token: string } | null>(null);
  const [deployments, setDeployments] = useState<{ id: string; name: string; endpoint: string; runs: number; created_at: number; release_notes?: string; workflowId?: string; status?: string }[]>([]);
  const [copied, setCopied] = useState<string>("");

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
      const r = await apiFetch<any>(`/deployments`, { headers: th });
      const d = r;
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
      const res = await apiFetch<Response>(`/deployments/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th }, raw: true,
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
    try { await apiFetch<any>(`/deployments/${id}`, { method: "DELETE", headers: th }); } catch { /* ignore */ }
    loadDeployments();
  }, [th, loadDeployments]);

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  }, []);

  const apiOrigin = typeof window !== "undefined" ? apiUrl("").replace(/\/$/, "") : "";
  const curlExample = publishResult
    ? `curl -X POST ${apiOrigin}${publishResult.endpoint} \\\n  -H "Authorization: Bearer ${publishResult.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"inputs": {}}'`
    : "";

  const liveWorkflows = useMemo(() => {
    const m: Record<string, "live" | "paused"> = {};
    for (const d of deployments) {
      if (!d.workflowId) continue;
      if (d.status !== "paused" || !m[d.workflowId]) m[d.workflowId] = d.status === "paused" ? "paused" : "live";
    }
    return m;
  }, [deployments]);

  return {
    publishOpen, setPublishOpen, publishName, setPublishName, publishNotes, setPublishNotes,
    publishing, publishLog, setPublishLog, publishResult, setPublishResult, deployments, copied,
    openPublish, doPublish, deleteDeployment, copyToClipboard, loadDeployments,
    apiOrigin, curlExample, liveWorkflows,
  };
}
