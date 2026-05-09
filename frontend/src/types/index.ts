export interface Turn {
  role: string;
  content: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: string;
  tool_success?: boolean;
}

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  turns?: Turn[];
  tokens?: number;
  cost?: number;
  taskId?: string;
  bootstrapSources?: string[];
}

export interface TaskInfo {
  id: string;
  goal: string;
  status: string;
  total_turns?: number;
  total_tokens?: number;
  total_cost?: number;
  turns?: Turn[];
}

export interface ConvInfo {
  id: string;
  title?: string;
  messages: number;
}

export interface ScheduledJob {
  id: string;
  goal: string;
  schedule_type: string;
  status: string;
  next_run: string | null;
  run_count: number;
}

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";
