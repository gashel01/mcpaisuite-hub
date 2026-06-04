// TaskForce runs are tagged in their goal with [TaskForce:<pattern>] or
// [Scheduled TaskForce]. We never want that tag in the UI — surface it as an icon
// (parseTaskforce) or just drop it (stripTaskforcePrefix).

const TAG_RE = /^\s*\[([^\]]*taskforce[^\]]*)\]\s*/i;

export function parseTaskforce(goal: string): { isTaskforce: boolean; tag: string; text: string } {
  const m = (goal || "").match(TAG_RE);
  if (m) return { isTaskforce: true, tag: m[1].trim(), text: goal.slice(m[0].length) || goal };
  return { isTaskforce: false, tag: "", text: goal || "" };
}

export function stripTaskforcePrefix(goal: string): string {
  return parseTaskforce(goal).text;
}

// Turn a raw tag ("TaskForce:graph", "Scheduled TaskForce") into a human label.
const PRETTY_PATTERN: Record<string, string> = {
  graph: "graph", sequential: "sequential", parallel: "parallel",
  hierarchical: "hierarchical", router: "routed", swarm: "swarm",
};
export function taskforceLabel(tag: string): string {
  if (!tag) return "Multi-agent workflow";
  const scheduled = /scheduled/i.test(tag);
  const m = tag.match(/:\s*([a-z0-9_-]+)/i);
  const pattern = m ? m[1].toLowerCase() : "";
  const suffix = pattern ? ` · ${PRETTY_PATTERN[pattern] || pattern}` : "";
  return `${scheduled ? "Scheduled multi-agent workflow" : "Multi-agent workflow"}${suffix}`;
}
