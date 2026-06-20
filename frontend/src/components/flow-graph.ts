import { MarkerType, type Node, type Edge } from "@xyflow/react";
import type { TeamAgent } from "@/stores/agent-sessions";
import type { TriggerType, WorkspaceMode } from "./flow-types";

/**
 * Rebuild the team's agent list from the canvas nodes (sync-back).
 * Pure so it can be unit-tested; the page's onUpdateFlow delegates here.
 * Current behavior: only "agent" nodes become TeamAgents; their data fields map
 * back, falling back to the previous agent entry (matched by node id) when a
 * field is absent.
 */
export function nodesToAgents(nodes: Node[], prevAgents: TeamAgent[] = []): TeamAgent[] {
  return nodes
    .filter(n => n.type === "agent")
    .map(n => {
      const d = n.data as Record<string, unknown>;
      const existing = prevAgents.find(a => a.id === n.id);
      return {
        id: n.id,
        name: (d.label as string) ?? existing?.name ?? "",
        description: (d.description as string) ?? existing?.description ?? "",
        type: (d.agentType as string) ?? existing?.type ?? "custom",
        role: (d.role as string) ?? existing?.role ?? "",
        max_turns: (d.maxTurns as number) ?? existing?.max_turns ?? 5,
        instructions: (d.instructions as string) ?? existing?.instructions ?? "",
        tools: (d.tools as string[]) ?? existing?.tools ?? [],
      } as TeamAgent;
    });
}

/**
 * Check if adding an edge from `sourceId` to `targetId` would create a cycle.
 * Does a DFS from `targetId` following existing edges — if we can reach `sourceId`, it's a cycle.
 * No dependency on trigger node.
 */
export function isAncestorInGraph(targetId: string, sourceId: string, _allNodes: Node[], allEdges: Edge[]): boolean {
  // Build adjacency from existing NON-feedback edges only
  const adj: Record<string, string[]> = {};
  for (const e of allEdges) {
    if (e.label === "feedback" || e.label === "loop" || e.label === "retry") continue;
    if (e.style && typeof e.style === "object" && (e.style as any).strokeDasharray) continue;
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  // DFS from targetId — can we reach sourceId?
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const child of (adj[cur] || [])) stack.push(child);
  }
  return false;
}

let _idC = 0;
export function gid() { return `n${++_idC}-${Date.now().toString(36).slice(-4)}`; }

// Styled label for built-in (smoothstep) edges — feedback / yes / no … — so the label
// matches its line's colour and the app's small-pill aesthetic instead of React Flow's
// raw white default. `rgb` is the edge's base colour as an "r,g,b" string.
export function edgeLabelDeco(rgb: string) {
  return {
    labelShowBg: true,
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 6,
    labelStyle: { fill: `rgba(${rgb},0.95)`, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const },
    labelBgStyle: { fill: "rgba(8,8,18,0.92)", stroke: `rgba(${rgb},0.45)`, strokeWidth: 1 },
  };
}

// Pure BFS "auto layout": lay nodes out top-down in layers from the trigger.
// Shared by the floating toolbar's Auto-layout button and the AI-build flow so both
// produce the exact same tidy arrangement. Cyclic/feedback edges are ignored once a
// node already has a layer; orphans are pushed to a trailing layer.
export function bfsLayout(nodes: Node[], edges: Edge[]): Node[] {
  const trigger = nodes.find(n => n.type === "trigger");
  if (!trigger) return nodes;
  const layers: Record<string, number> = { [trigger.id]: 0 };
  const queue = [trigger.id];
  while (queue.length) {
    const c = queue.shift()!;
    for (const e of edges.filter(e => e.source === c)) {
      if (layers[e.target] === undefined) { layers[e.target] = (layers[c] || 0) + 1; queue.push(e.target); }
    }
  }
  nodes.forEach(n => { if (layers[n.id] === undefined) layers[n.id] = Object.keys(layers).length; });
  const byLayer: Record<number, string[]> = {};
  Object.entries(layers).forEach(([id, l]) => (byLayer[l] ||= []).push(id));
  return nodes.map(n => {
    const l = layers[n.id] || 0;
    const sibs = byLayer[l] || [n.id];
    const idx = sibs.indexOf(n.id);
    return { ...n, position: { x: 300 - (sibs.length * 200) / 2 + idx * 200 + 100, y: l * 120 } };
  });
}

export function buildInitialFlow(
  agents: TeamAgent[], pattern: string,
  opts?: { triggerType?: string; workspaceEnabled?: boolean; workspaceName?: string; workspaceMode?: string; humanGates?: number[]; triggerConfig?: Record<string, any> }
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const tt = (opts?.triggerType || "manual") as TriggerType;
  const sid = gid(), eid = gid();

  nodes.push({ id: sid, type: "trigger", position: { x: 300, y: 0 }, data: { triggerType: tt, label: tt === "manual" ? "Manual Run" : tt, ...(opts?.triggerConfig || {}) } });

  const hGates = opts?.humanGates || [];
  const yStep = 120;

  const n = agents.length;
  const totalW = n * 200;
  const centerX = 300;

  // Position agents based on pattern
  const agentNodes: Node[] = agents.map((a, i) => {
    let x = centerX, y = yStep + i * yStep;

    const workerSpacing = Math.min(200, 800 / Math.max(n, 1));

    if (pattern === "parallel") {
      x = centerX - (n * workerSpacing) / 2 + i * workerSpacing + workerSpacing / 2;
      y = yStep;
    } else if (pattern === "supervisor") {
      if (i === 0) { x = centerX; y = yStep; } // Supervisor at top center
      else {
        const wCount = n - 1;
        const wSpacing = Math.min(200, 900 / Math.max(wCount, 1));
        x = centerX - (wCount * wSpacing) / 2 + (i - 1) * wSpacing + wSpacing / 2;
        y = yStep * 3; // Workers well below supervisor for clean back-edge routing
      }
    } else if (pattern === "debate" && n >= 2) {
      if (n >= 3 && i === n - 1) {
        x = centerX; y = yStep * 2.6; // judge: centered, below the debaters
      } else {
        const dCount = n >= 3 ? n - 1 : n;
        const sp = Math.min(320, 700 / Math.max(dCount, 1));
        x = centerX - (dCount * sp) / 2 + i * sp + sp / 2;
        y = yStep;
      }
    } else if (pattern === "swarm") {
      // Circular layout for swarm — agents arranged in a ring
      const radius = Math.max(160, n * 50);
      const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top
      x = centerX + Math.cos(angle) * radius;
      y = yStep + radius + Math.sin(angle) * radius;
    }

    return {
      id: gid(), type: "agent",
      position: { x, y },
      data: { agentType: a.type, role: a.role, label: a.name || a.role || a.type, maxTurns: a.max_turns, instructions: a.instructions, tools: a.tools || [] },
    };
  });
  nodes.push(...agentNodes);

  // Human gates
  const humanNodes: Node[] = [];
  for (const gi of hGates) {
    if (gi >= 0 && gi < agents.length) {
      const after = agentNodes[gi];
      humanNodes.push({
        id: gid(), type: "human",
        position: { x: after.position.x, y: after.position.y + yStep * 0.6 },
        data: { label: `Review ${agents[gi].name || agents[gi].role || agents[gi].type}`, instructions: "" },
      });
    }
  }
  nodes.push(...humanNodes);

  // Workspace
  let wsNode: Node | null = null;
  if (opts?.workspaceEnabled) {
    const lastAgentY = Math.max(...agentNodes.map(a => a.position.y), ...humanNodes.map(h => h.position.y), yStep);
    wsNode = {
      id: gid(), type: "workspace",
      position: { x: centerX, y: lastAgentY + yStep },
      data: { workspaceName: opts.workspaceName || "output", workspaceMode: (opts.workspaceMode || "isolated") as WorkspaceMode, label: opts.workspaceName || "Workspace" },
    };
    nodes.push(wsNode);
  }

  // END — always centered below everything
  const allNodeYs = nodes.filter(nd => nd.id !== sid).map(nd => nd.position.y);
  const endY = Math.max(...allNodeYs, yStep) + yStep * 1.2;
  nodes.push({ id: eid, type: "end", position: { x: centerX, y: endY }, data: { label: "END" } });

  // Single edge style — same as what user gets when connecting manually
  const es = { type: "smoothstep" as const, markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(139,92,246,0.5)" }, style: { stroke: "rgba(139,92,246,0.3)", strokeWidth: 2 } };
  const lastTarget = wsNode ? wsNode.id : eid;

  // Auto-styled edge: detect feedback by graph hierarchy, not Y position
  // An edge is feedback if the target is an ancestor of the source (creates a cycle)
  function autoEdge(srcId: string, tgtId: string, label?: string): Edge {
    const isSelf = srcId === tgtId;
    const isFeedback = label === "feedback" || (!label && isAncestorInGraph(tgtId, srcId, nodes, edges));

    if (isSelf) {
      return { id: gid(), source: srcId, target: tgtId, type: "selfLoop", markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(245,158,11,0.6)" }, style: { stroke: "rgba(245,158,11,0.4)", strokeWidth: 2, strokeDasharray: "6 3" }, label: label || "loop" };
    }
    if (isFeedback) {
      return { id: gid(), source: srcId, target: tgtId, ...es, style: { stroke: "rgba(245,158,11,0.4)", strokeWidth: 2, strokeDasharray: "6 3" }, markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(245,158,11,0.6)" }, label: label || "feedback", ...edgeLabelDeco("245,158,11") };
    }
    return { id: gid(), source: srcId, target: tgtId, ...es, ...(label ? { label } : {}) };
  }


  // Build chain helper (agents + human gates interleaved)
  const buildChain = (): Node[] => {
    const chain: Node[] = [];
    for (let i = 0; i < agentNodes.length; i++) {
      chain.push(agentNodes[i]);
      if (hGates.includes(i)) {
        const hIdx = hGates.filter(g => g <= i).length - 1;
        if (humanNodes[hIdx]) chain.push(humanNodes[hIdx]);
      }
    }
    return chain;
  };

  if (pattern === "sequential") {
    const chain = [nodes[0], ...buildChain(), ...(wsNode ? [wsNode] : []), nodes[nodes.length - 1]];
    for (let i = 0; i < chain.length - 1; i++) edges.push(autoEdge(chain[i].id, chain[i + 1].id));

  } else if (pattern === "parallel") {
    for (const a of agentNodes) {
      edges.push(autoEdge(sid, a.id));
      edges.push(autoEdge(a.id, lastTarget));
    }
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else if (pattern === "supervisor" && n > 0) {
    edges.push(autoEdge(sid, agentNodes[0].id));
    for (let i = 1; i < n; i++) {
      edges.push(autoEdge(agentNodes[0].id, agentNodes[i].id));
    }
    for (let i = 1; i < n; i++) {
      edges.push(autoEdge(agentNodes[i].id, agentNodes[0].id, "feedback"));
    }
    edges.push(autoEdge(agentNodes[0].id, agentNodes[0].id, "evaluate"));
    edges.push(autoEdge(agentNodes[0].id, lastTarget));
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else if (pattern === "debate" && n >= 2) {
    if (n === 2) {
      // Two debaters argue each other, both → END.
      edges.push(autoEdge(sid, agentNodes[0].id));
      edges.push(autoEdge(sid, agentNodes[1].id));
      edges.push(autoEdge(agentNodes[0].id, agentNodes[1].id));
      edges.push(autoEdge(agentNodes[1].id, agentNodes[0].id, "feedback"));
      edges.push(autoEdge(agentNodes[0].id, lastTarget));
      edges.push(autoEdge(agentNodes[1].id, lastTarget));
    } else {
      // n >= 3: the LAST agent is the JUDGE. The others debate in parallel and feed the
      // judge, who merges/reconciles and is the only node going to END.
      const judge = agentNodes[n - 1];
      const debaters = agentNodes.slice(0, n - 1);
      for (const d of debaters) {
        edges.push(autoEdge(sid, d.id));        // trigger → each debater
        edges.push(autoEdge(d.id, judge.id));   // debater → judge
      }
      if (debaters.length >= 2) {
        edges.push(autoEdge(debaters[1].id, debaters[0].id, "feedback")); // cross-talk
      }
      edges.push(autoEdge(judge.id, lastTarget)); // judge → END (the missing wire)
    }
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else if (pattern === "swarm") {
    for (let i = 0; i < n; i++) {
      edges.push(autoEdge(sid, agentNodes[i].id));
    }
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      edges.push(autoEdge(agentNodes[i].id, agentNodes[next].id));
      edges.push(autoEdge(agentNodes[next].id, agentNodes[i].id, "feedback"));
    }
    for (let i = 0; i < n; i++) {
      edges.push(autoEdge(agentNodes[i].id, lastTarget));
    }
    if (wsNode) edges.push(autoEdge(wsNode.id, eid));

  } else {
    // Fallback: simple chain
    const chain = [nodes[0], ...buildChain(), ...(wsNode ? [wsNode] : []), nodes[nodes.length - 1]];
    for (let i = 0; i < chain.length - 1; i++) edges.push({ id: gid(), source: chain[i].id, target: chain[i + 1].id, ...es });
  }

  // Human gates: sequential/fallback interleave them via buildChain. Every OTHER pattern
  // (parallel/supervisor/debate/swarm) wires agents directly, leaving the human node dangling.
  // Splice each gate's human node into its agent's forward output so it's never an orphan.
  if (pattern !== "sequential" && hGates.length) {
    for (const gi of hGates) {
      const agent = agentNodes[gi];
      if (!agent) continue;
      const hIdx = hGates.filter(g => g <= gi).length - 1;
      const human = humanNodes[hIdx];
      if (!human) continue;
      let redirected = false;
      for (const e of [...edges]) {
        if (e.source === agent.id && e.target !== human.id && !["feedback", "loop", "evaluate"].includes(String(e.label))) {
          edges.push(autoEdge(human.id, e.target)); // human → original forward target
          e.target = human.id;                      // agent → human
          redirected = true;
        }
      }
      if (!redirected) {
        edges.push(autoEdge(agent.id, human.id));
        edges.push(autoEdge(human.id, lastTarget));
      }
    }
  }

  return { nodes, edges };
}
