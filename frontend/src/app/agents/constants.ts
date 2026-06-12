import { Code, Globe, FolderOpen, Brain, Map, Wand2, ArrowRight, Users, Layers, MessageSquare, GitBranch, Sparkles, Bot } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentInfo { type: string; constitution: string; tools: string[]; max_turns: number; custom?: boolean; }
export type Pattern = "sequential" | "parallel" | "supervisor" | "debate" | "swarm";

// ── Constants ──────────────────────────────────────────────────────────────

export const AGENT_ICONS: Record<string, typeof Code> = { code: Code, research: Globe, file: FolderOpen, memory: Brain, plan: Map, rag: Layers, ltp: GitBranch, custom: Wand2 };
export const AGENT_TYPES = ["code", "research", "file", "memory", "plan", "rag", "ltp", "custom"] as const;

export const AGENT_META: Record<string, { color: string; accent: string; bg: string; desc: string }> = {
  code:     { color: "#8b5cf6", accent: "text-violet-400", bg: "bg-violet-500", desc: "Write & execute code" },
  research: { color: "#06b6d4", accent: "text-cyan-400", bg: "bg-cyan-500", desc: "Web search & analysis" },
  file:     { color: "#f59e0b", accent: "text-amber-400", bg: "bg-amber-500", desc: "File management" },
  memory:   { color: "#10b981", accent: "text-emerald-400", bg: "bg-emerald-500", desc: "Facts & recall" },
  plan:     { color: "#f43f5e", accent: "text-rose-400", bg: "bg-rose-500", desc: "Structured plans" },
  rag:      { color: "#a855f7", accent: "text-purple-400", bg: "bg-purple-500", desc: "Document retrieval & RAG" },
  ltp:      { color: "#ec4899", accent: "text-pink-400", bg: "bg-pink-500", desc: "Long-term planning" },
  custom:   { color: "#6366f1", accent: "text-indigo-400", bg: "bg-indigo-500", desc: "Custom config" },
};

export const PATTERNS: { value: Pattern; label: string; icon: typeof ArrowRight; desc: string }[] = [
  { value: "sequential", label: "Sequential", icon: ArrowRight, desc: "Agents run one after another, each building on the previous result" },
  { value: "parallel", label: "Parallel", icon: Layers, desc: "All agents run simultaneously, results are merged" },
  { value: "supervisor", label: "Supervisor", icon: Users, desc: "First agent delegates tasks and reviews the work of others" },
  { value: "debate", label: "Debate", icon: MessageSquare, desc: "Agents propose solutions and critique each other until consensus" },
  { value: "swarm", label: "Swarm", icon: GitBranch, desc: "Agents self-organize and hand off tasks dynamically" },
];

export interface TemplateAgent { type: string; role: string; instructions?: string; }
export interface Template { label: string; icon: typeof Code; goal: string; agents: TemplateAgent[]; pattern: Pattern; complexity: "simple" | "medium" | "advanced" | "extreme"; }

export const TEMPLATES: Template[] = [
  { label: "Quick Code", icon: Code, complexity: "simple", goal: "Write a Python function and run it", agents: [{ type: "code", role: "Developer" }], pattern: "sequential" },
  { label: "Fact Check", icon: Globe, complexity: "simple", goal: "Verify a claim by searching the web and citing sources", agents: [{ type: "research", role: "Fact checker", instructions: "Always cite the URL of each source. State your confidence level (high/medium/low) for each claim." }], pattern: "sequential" },
  { label: "Memorize", icon: Brain, complexity: "simple", goal: "Store key facts from a document into memory for later recall", agents: [{ type: "memory", role: "Knowledge curator", instructions: "Extract only factual claims, not opinions. Tag each fact with a relevant category." }], pattern: "sequential" },
  { label: "Research", icon: Globe, complexity: "medium", goal: "Research a topic thoroughly with cross-verification", agents: [{ type: "research", role: "Primary researcher", instructions: "Find 3-5 diverse sources. Summarize each source's key claims with URLs." }, { type: "research", role: "Fact checker", instructions: "Verify each claim from the primary researcher using different sources. Flag any contradictions." }], pattern: "sequential" },
  { label: "Debate", icon: MessageSquare, complexity: "medium", goal: "Evaluate the pros and cons of a technical decision", agents: [{ type: "research", role: "Advocate", instructions: "Build the strongest possible case FOR the proposition. Use data and examples." }, { type: "research", role: "Skeptic", instructions: "Build the strongest possible case AGAINST. Find counterexamples, risks, and failure modes." }], pattern: "debate" },
  { label: "Code Review", icon: Code, complexity: "medium", goal: "Review code for bugs, security issues, and performance", agents: [{ type: "code", role: "Security reviewer", instructions: "Focus on OWASP top 10, injection, auth flaws, data exposure." }, { type: "code", role: "Performance reviewer", instructions: "Focus on algorithmic complexity, memory leaks, N+1 queries." }], pattern: "parallel" },
  { label: "Summarize & Store", icon: Brain, complexity: "medium", goal: "Read a document, summarize it, and store key facts in memory", agents: [{ type: "file", role: "Reader", instructions: "Read the file completely. Extract the main thesis, key arguments, and conclusions." }, { type: "memory", role: "Curator", instructions: "Store each key fact from the reader's output. Tag with document name and topic." }], pattern: "sequential" },
  { label: "Full Stack", icon: Code, complexity: "advanced", goal: "Build a feature with backend, tests, and documentation", agents: [{ type: "code", role: "Backend developer" }, { type: "code", role: "Test writer", instructions: "Write unit tests with pytest. Aim for >80% coverage." }, { type: "file", role: "Documentation writer" }], pattern: "sequential" },
  { label: "Deep Research", icon: Globe, complexity: "advanced", goal: "Produce a comprehensive research report with verified sources", agents: [{ type: "research", role: "Lead researcher" }, { type: "research", role: "Source verifier" }, { type: "memory", role: "Knowledge integrator" }, { type: "file", role: "Report writer" }], pattern: "sequential" },
  { label: "Product Sprint", icon: Users, complexity: "advanced", goal: "Plan, build, test, and document a small product feature", agents: [{ type: "plan", role: "Product manager" }, { type: "code", role: "Developer" }, { type: "code", role: "QA engineer" }, { type: "file", role: "Technical writer" }], pattern: "supervisor" },
  { label: "Data Pipeline", icon: Sparkles, complexity: "advanced", goal: "Collect data from the web, clean it, analyze it, and produce a report", agents: [{ type: "research", role: "Data collector" }, { type: "code", role: "Data cleaner" }, { type: "code", role: "Analyst" }, { type: "file", role: "Report generator" }], pattern: "sequential" },
  { label: "Security Audit", icon: Bot, complexity: "advanced", goal: "Audit a codebase for vulnerabilities, research fixes, implement and verify them", agents: [{ type: "code", role: "Vulnerability scanner" }, { type: "research", role: "CVE researcher" }, { type: "code", role: "Fix implementer" }, { type: "code", role: "Fix verifier" }], pattern: "supervisor" },
  { label: "Full Product", icon: Users, complexity: "extreme", goal: "Design, build, test, document, and deploy a complete micro-product", agents: [{ type: "research", role: "Market researcher" }, { type: "plan", role: "Architect" }, { type: "code", role: "Backend developer" }, { type: "code", role: "Frontend developer" }, { type: "code", role: "QA engineer" }, { type: "file", role: "Technical writer" }], pattern: "supervisor" },
  { label: "Research Paper", icon: Globe, complexity: "extreme", goal: "Produce a structured research paper with abstract, methodology, findings, and references", agents: [{ type: "research", role: "Literature reviewer" }, { type: "research", role: "Data gatherer" }, { type: "code", role: "Data analyst" }, { type: "research", role: "Critic" }, { type: "memory", role: "Fact curator" }, { type: "file", role: "Paper writer" }], pattern: "sequential" },
  { label: "Incident Response", icon: Bot, complexity: "extreme", goal: "Investigate a production incident: diagnose root cause, implement fix, verify, and write post-mortem", agents: [{ type: "research", role: "Log analyst" }, { type: "code", role: "Root cause investigator" }, { type: "research", role: "Impact assessor" }, { type: "code", role: "Hotfix developer" }, { type: "code", role: "Fix verifier" }, { type: "memory", role: "Knowledge recorder" }, { type: "file", role: "Post-mortem writer" }], pattern: "supervisor" },
  { label: "Competitive Intel", icon: Globe, complexity: "extreme", goal: "Build a comprehensive competitive intelligence report", agents: [{ type: "research", role: "Company profiler" }, { type: "research", role: "Feature mapper" }, { type: "research", role: "Market analyst" }, { type: "research", role: "Sentiment scanner" }, { type: "code", role: "Data synthesizer" }, { type: "file", role: "Report compiler" }], pattern: "sequential" },
];

let _id = 0;
export function newId(): string { return `ag-${++_id}-${Date.now()}`; }

// SSE refs (module-level, outside React)
export const sseRefs: Record<string, EventSource> = {};
