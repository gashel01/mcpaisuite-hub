const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

/* ---------- Types ---------- */

export interface Turn {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  tool_result?: string;
}

export interface TaskStatus {
  id: string;
  task_id?: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "done" | "error";
  turns: Turn[];
  cost?: CostSummary;
  error?: string;
  total_tokens?: number;
  total_cost?: number;
  total_turns?: number;
}

export interface ServerInfo {
  name: string;
  status: "connected" | "disconnected" | "error";
  tool_count: number;
  tools?: string[];
}

export interface Constitution {
  rules: string;
}

export interface CostSummary {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost_usd: number;
  model_breakdown: Record<
    string,
    { tokens: number; cost_usd: number }
  >;
}

export interface LLMConfig {
  provider: string;
  model: string;
  api_key: string;
  base_url: string;
  routing_enabled: boolean;
  max_turns: number;
  max_tokens: number;
}

/* ---------- Helpers ---------- */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

/* ---------- Tasks ---------- */

export async function submitTask(goal: string): Promise<TaskStatus> {
  return request<TaskStatus>("/tasks", {
    method: "POST",
    body: JSON.stringify({ goal }),
  });
}

export async function getTask(taskId: string): Promise<TaskStatus> {
  return request<TaskStatus>(`/tasks/${taskId}`);
}

export async function listTasks(): Promise<TaskStatus[]> {
  return request<TaskStatus[]>("/tasks");
}

/* ---------- Servers ---------- */

export async function listServers(): Promise<ServerInfo[]> {
  const data = await request<{ servers: Record<string, { connected: boolean; tools: number }>; connected: number }>("/servers");
  return Object.entries(data.servers).map(([name, info]) => ({
    name,
    status: info.connected ? "connected" as const : "disconnected" as const,
    tool_count: info.tools,
  }));
}

/* ---------- Constitution ---------- */

export async function getConstitution(): Promise<Constitution> {
  return request<Constitution>("/constitution");
}

export async function saveConstitution(rules: string): Promise<Constitution> {
  return request<Constitution>("/constitution", {
    method: "PUT",
    body: JSON.stringify({ rules }),
  });
}

/* ---------- Cost ---------- */

export async function getCost(): Promise<CostSummary> {
  return request<CostSummary>("/cost");
}

/* ---------- Settings ---------- */

export async function getSettings(): Promise<LLMConfig> {
  const llm = await request<Record<string, unknown>>("/llm/config");
  return {
    provider: (llm.provider as string) || "echo",
    model: (llm.model as string) || "",
    api_key: "",  // never returned by backend (security)
    base_url: (llm.base_url as string) || "",
    routing_enabled: true,
    max_turns: 20,
    max_tokens: 50000,
  };
}

export async function saveSettings(cfg: Partial<LLMConfig>): Promise<LLMConfig> {
  return request<LLMConfig>("/llm/config", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}
