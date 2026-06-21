"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { tenantHeaders } from "@/context/tenant";
import { useExecutionStore } from "@/stores/execution";
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
 * Falls back to the live event-derived ExecutionGraph for chat / single-agent runs.
 *
 * Clicking a topology node selects the matching event/step (like ExecutionGraph), and
 * the "Open in agent view" action is exposed to the parent via `onOpenHandler` so the
 * button can live in the shared floating toolbar.
 */
export default function TopologyView({ taskId, tenant, onOpenHandler }: {
  taskId: string | null;
  tenant: string;
  onOpenHandler?: (open: (() => void) | null) => void;
}) {
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const graphRef = useRef<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const events = useExecutionStore(s => s.events);
  const setActiveEvent = useExecutionStore(s => s.setActiveEvent);
  const setDrawerOpen = useExecutionStore(s => s.setDrawerOpen);

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

  // Normalize the persisted graph (synthesize missing edge ids). Memoized on `meta` so
  // its identity is stable across renders — otherwise the onOpenHandler effect would loop.
  const graph = useMemo(() => {
    if (!meta?.graph?.nodes?.length) return null;
    return {
      nodes: meta.graph.nodes,
      edges: (meta.graph.edges || []).map((e: any) => ({ ...e, id: e.id || `${e.source}->${e.target}` })),
    };
  }, [meta]);

  const openInAgentView = useCallback(() => {
    if (!graph) return;
    try {
      // localStorage (not sessionStorage) so the handoff is readable in the NEW tab.
      localStorage.setItem("agentview_handoff", JSON.stringify({
        graph,
        goal: (meta?.goal || "").replace(/^\[TaskForce:[^\]]*\]\s*/, ""),
        workflowId: meta?.workflow_exists ? meta?.workflow_id : undefined,
        versionId: meta?.workflow_exists ? meta?.version_id : undefined,
      }));
    } catch { /* storage unavailable — agent view will just open empty */ }
    window.open("/agents?handoff=1", "_blank", "noopener");
  }, [graph, meta]);

  // Expose the open action to the parent (floating toolbar) while a topology is shown.
  useEffect(() => {
    onOpenHandler?.(graph ? openInAgentView : null);
    return () => onOpenHandler?.(null);
  }, [graph, openInAgentView, onOpenHandler]);

  // Click a topology node → select the matching event/step (mirrors ExecutionGraph).
  const onNodeClick = useCallback((node: any) => {
    const role = node?.data?.role;
    const label = node?.data?.label || node?.data?.tool;
    // Prefer the most recent matching event (latest run/round of that node).
    const match = [...events].reverse().find(e => {
      const d: any = e.data || {};
      return (role && d.agent_role === role)
        || (label && (d.tool === label || e.message === label))
        || (node?.id && (d.node_id === node.id || d.node === node.id));
    });
    if (match) {
      setActiveEvent(match.id);
      setDrawerOpen(true);
    }
  }, [events, setActiveEvent, setDrawerOpen]);

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
        onNodeClick={onNodeClick}
        initialGraph={graph}
        graphRef={graphRef}
        onUpdateFlow={() => {}}
      />
    </div>
  );
}
