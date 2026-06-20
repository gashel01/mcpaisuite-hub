import { describe, it, expect } from "vitest";
import { buildInitialFlow, nodesToAgents } from "./flow-graph";
import type { TeamAgent } from "@/stores/agent-sessions";

// Characterization tests — lock the CURRENT behavior of the agents→graph builder
// before the id-based / deterministic-node refactor, so a regression is caught.

let _idc = 0;
function agent(partial: Partial<TeamAgent>): TeamAgent {
  return {
    id: partial.id || `a${++_idc}`,
    name: partial.name ?? "",
    description: partial.description ?? "",
    type: partial.type ?? "code",
    role: partial.role ?? "",
    max_turns: partial.max_turns ?? 5,
    instructions: partial.instructions ?? "",
    tools: partial.tools ?? [],
    ...(partial.kind ? { kind: partial.kind, tool: partial.tool, args: partial.args, code: partial.code } : {}),
  } as TeamAgent;
}

const byType = (nodes: any[], t: string) => nodes.filter(n => n.type === t);

describe("buildInitialFlow — sequential", () => {
  it("creates trigger + one agent node per agent + end", () => {
    const agents = [agent({ type: "research", role: "Researcher" }), agent({ type: "code", role: "Coder" })];
    const { nodes } = buildInitialFlow(agents, "sequential", { triggerType: "manual" });
    expect(byType(nodes, "trigger")).toHaveLength(1);
    expect(byType(nodes, "agent")).toHaveLength(2);
    expect(byType(nodes, "end")).toHaveLength(1);
  });

  it("agent nodes carry type/role/instructions/maxTurns/tools", () => {
    const agents = [agent({ type: "research", role: "R", instructions: "do x", max_turns: 7, tools: ["web_search"] })];
    const { nodes } = buildInitialFlow(agents, "sequential", {});
    const a = byType(nodes, "agent")[0];
    expect(a.data.agentType).toBe("research");
    expect(a.data.role).toBe("R");
    expect(a.data.instructions).toBe("do x");
    expect(a.data.maxTurns).toBe(7);
    expect(a.data.tools).toEqual(["web_search"]);
  });

  it("links nodes in a single chain trigger→a0→a1→end", () => {
    const agents = [agent({ role: "A" }), agent({ role: "B" })];
    const { nodes, edges } = buildInitialFlow(agents, "sequential", {});
    const trig = byType(nodes, "trigger")[0].id;
    const end = byType(nodes, "end")[0].id;
    // every non-trigger node has an incoming edge; every non-end has an outgoing edge.
    const targets = new Set(edges.map(e => e.target));
    const sources = new Set(edges.map(e => e.source));
    for (const n of nodes) {
      if (n.id !== trig) expect(targets.has(n.id)).toBe(true);
      if (n.id !== end) expect(sources.has(n.id)).toBe(true);
    }
    expect(edges).toHaveLength(3); // t→a0, a0→a1, a1→end
  });
});

describe("buildInitialFlow — parallel", () => {
  it("each agent is fed by the trigger and feeds the end", () => {
    const agents = [agent({ role: "A" }), agent({ role: "B" }), agent({ role: "C" })];
    const { nodes, edges } = buildInitialFlow(agents, "parallel", {});
    const trig = byType(nodes, "trigger")[0].id;
    const end = byType(nodes, "end")[0].id;
    for (const a of byType(nodes, "agent")) {
      expect(edges.some(e => e.source === trig && e.target === a.id)).toBe(true);
      expect(edges.some(e => e.source === a.id && e.target === end)).toBe(true);
    }
  });
});

describe("buildInitialFlow — workspace", () => {
  it("adds a workspace node when enabled", () => {
    const { nodes } = buildInitialFlow([agent({})], "sequential", { workspaceEnabled: true, workspaceName: "out" });
    expect(byType(nodes, "workspace")).toHaveLength(1);
  });
});

describe("deterministic nodes (kind) — architect wiring", () => {
  it("buildInitialFlow emits a tool node for kind='tool'", () => {
    const agents = [agent({ kind: "tool", tool: "web_search", args: '{"q":"x"}', role: "Search" })];
    const { nodes } = buildInitialFlow(agents, "sequential", {});
    const tn = byType(nodes, "tool");
    expect(tn).toHaveLength(1);
    expect(tn[0].data.tool).toBe("web_search");
    expect(tn[0].data.kind).toBe("tool");
    expect(byType(nodes, "agent")).toHaveLength(0);
  });

  it("buildInitialFlow emits a code node for kind='code'", () => {
    const agents = [agent({ kind: "code", code: "print(1)", role: "Calc" })];
    const { nodes } = buildInitialFlow(agents, "sequential", {});
    const cn = byType(nodes, "code");
    expect(cn).toHaveLength(1);
    expect(cn[0].data.code).toBe("print(1)");
  });

  it("uses the agent id as the node id (stable mapping)", () => {
    const agents = [agent({ id: "fixed1", role: "A" }), agent({ id: "fixed2", kind: "tool", tool: "calc" })];
    const { nodes } = buildInitialFlow(agents, "sequential", {});
    const ids = nodes.map(n => n.id);
    expect(ids).toContain("fixed1");
    expect(ids).toContain("fixed2");
  });

  it("round-trips a mixed agent + tool + code team", () => {
    const agents = [
      agent({ id: "x1", type: "research", role: "R" }),
      agent({ id: "x2", kind: "tool", tool: "web_search", args: '{"q":"1"}' }),
      agent({ id: "x3", kind: "code", code: "print(2)" }),
    ];
    const { nodes } = buildInitialFlow(agents, "sequential", {});
    const out = nodesToAgents(nodes);
    expect(out).toHaveLength(3);
    expect(out.find(a => a.id === "x1")).toMatchObject({ type: "research", role: "R" });
    expect(out.find(a => a.id === "x2")).toMatchObject({ kind: "tool", tool: "web_search" });
    expect(out.find(a => a.id === "x3")).toMatchObject({ kind: "code", code: "print(2)" });
  });
});

describe("nodesToAgents — sync-back", () => {
  const node = (id: string, type: string, data: any) => ({ id, type, position: { x: 0, y: 0 }, data } as any);

  it("keeps only agent nodes and maps their data", () => {
    const nodes = [
      node("t", "trigger", { triggerType: "manual" }),
      node("a1", "agent", { agentType: "research", role: "R", label: "Researcher", maxTurns: 6, instructions: "go", tools: ["web_search"] }),
      node("e", "end", { label: "END" }),
    ];
    const out = nodesToAgents(nodes);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a1", type: "research", role: "R", name: "Researcher", max_turns: 6, instructions: "go", tools: ["web_search"] });
  });

  it("falls back to the previous agent entry by id when data is absent", () => {
    const prev: TeamAgent[] = [agent({ id: "a1", type: "code", role: "Old", instructions: "prev" })];
    const nodes = [node("a1", "agent", { agentType: "code", role: "Old" })]; // no instructions in node data
    const out = nodesToAgents(nodes, prev);
    expect(out[0].instructions).toBe("prev");
  });

  it("round-trips buildInitialFlow output back to agents", () => {
    const agents = [agent({ type: "research", role: "A", instructions: "x" }), agent({ type: "code", role: "B", instructions: "y" })];
    const { nodes } = buildInitialFlow(agents, "sequential", {});
    const out = nodesToAgents(nodes);
    expect(out.map(a => a.role)).toEqual(["A", "B"]);
    expect(out.map(a => a.type)).toEqual(["research", "code"]);
  });
});
