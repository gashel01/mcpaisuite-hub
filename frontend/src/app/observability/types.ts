// Observability domain types.

export type PageMode = "dashboard" | "trace";

export interface Analytics {
  tasks_completed: number; tasks_failed: number; total_tokens: number;
  total_cost: number; avg_tokens_per_task: number; avg_duration_ms: number;
  top_tools: { name: string; count: number }[];
  top_models: { name: string; count: number }[];
}

export interface Stats {
  total_tokens: number; total_cost: number; tasks_completed: number;
  tasks_failed: number; total_turns: number; avg_turns_per_task: number;
  connected_servers: number; model?: string;
}
