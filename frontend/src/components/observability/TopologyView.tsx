"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PencilRuler } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { tenantHeaders } from "@/context/tenant";
import FlowEditor from "@/components/flow-editor";
import ExecutionGraph from "@/components/execution/ExecutionGraph";

type Graph = { nodes: any[]; edges: any[] };

interface ReplayMeta {
  graph?: Graph | null;
  goal?: string;
  workflow_id?: string | null;
  version_id?: string | null;
  workflow_exists?: boolean;
}

/**
 * Observability execution view.
 *
 * For a graph / TaskForce run we persist the real node/edge topology on the task,
 * so we render it READ-ONLY here (reusing the agent-view FlowEditor in `locked`
 * mode) — real node names + types instead of the generic "Turn 1/2/3" chain.
 * Temporal ordering (incl. parallel overlap) stays in the Spans waterfall by design.
 *
 * Falls back to the live event-derived ExecutionGraph for chat / single-agent runs
 * (which have no stored topology).
 *
 * "Open in agent view" lets the user run/edit the run:
 *  - linked to a still-saved workflow/version → deep-link `/agents?wf=&v=` (editable).
 *  - otherwise (unlinked or version deleted) → hand the captured graph off via
 *    sessionStorage so the agent view can load an editable copy with no saved workflow.
 */
export default function TopologyView({ taskId, tenant }: { taskId: string | null; tenant: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const graphRef = useRef<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });

  useEffect(() => {
    if (!taskId) { setMeta(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch<ReplayMeta>(`/tasks/${taskId}/replay`, { headers: tenantHeaders(tenant) });
        if (!cancelled) setMeta(r);
      } catch {
        if (!cancelled) setMeta(null);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId, tenant]);

  // Normalize the persisted graph: ReactFlow requires a unique `id` on every edge,
  // but older runs were stored with edges lacking it → links wouldn't render. Synthesize
  // a stable id from source→target when missing so the topology always shows its links.
  const graph = (() => {
    if (!meta?.graph?.nodes?.length) return null;
    return {
      nodes: meta.graph.nodes,
      edges: (meta.graph.edges || []).map((e: any) => ({
        ...e, id: e.id || `${e.source}->${e.target}`,
      })),
    };
  })();

  const openInAgentView = useCallback(() => {
    if (!graph) return;
    // Always hand the captured topology off via sessionStorage — self-contained, so the
    // exact graph always renders in the agent view regardless of workflow-store timing.
    // Carry the saved-workflow linkage too: if that workflow/version still exists, the
    // agent view re-links the session (so Save keeps versioning the same workflow).
    try {
      sessionStorage.setItem("agentview_handoff", JSON.stringify({
        graph,
        goal: (meta?.goal || "").replace(/^\[TaskForce:[^\]]*\]\s*/, ""),
        workflowId: meta?.workflow_exists ? meta?.workflow_id : undefined,
        versionId: meta?.workflow_exists ? meta?.version_id : undefined,
      }));
    } catch { /* sessionStorage unavailable — agent view will just open empty */ }
    router.push("/agents?handoff=1");
  }, [graph, meta, router]);

  // No stored topology → live event-derived graph (chat / single-agent runs).
  if (!graph) return <ExecutionGraph />;

  return (
    <div className="relative w-full h-full">
      <FlowEditor
        key={taskId || "topology"}  /* FlowEditor only ingests initialGraph on mount → remount per run */
        agents={[]}
        pattern="graph"
        locked
        topologyOnly
        initialGraph={graph}
        graphRef={graphRef}
        onUpdateFlow={() => {}}
      />
      <button
        onClick={openInAgentView}
        className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-200 text-[11px] font-medium shadow-lg backdrop-blur-sm hover:bg-violet-500/20 transition-colors"
        title="Open this run's topology in the agent view to run or edit it"
      >
        <PencilRuler className="h-3.5 w-3.5" />
        Open in agent view
      </button>
    </div>
  );
}
