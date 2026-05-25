export interface JobResult {
  run_id: string;
  success: boolean;
  output: string;
  error: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  tokens_used: number;
  cost: number;
}

export interface ScheduledJob {
  id: string;
  goal: string;
  schedule_type: "once" | "cron" | "interval" | "watch";
  status: "pending" | "active" | "paused" | "completed" | "failed" | "cancelled";
  next_run: string | null;
  last_run: string | null;
  created_at: string | null;
  run_count: number;
  namespace: string;
  enabled: boolean;
  cron: string | null;
  interval_seconds: number | null;
  delay_seconds: number | null;
  watch_command: string | null;
  watch_condition: string | null;
  watch_interval: number | null;
  watch_last_value: string | null;
  consecutive_failures: number;
  max_failures: number;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  max_runs: number;
  tags: string[];
  metadata: Record<string, unknown>;
  webhook_url: string | null;
  last_result: JobResult | null;
  history: JobResult[];
  // UI-only fields (added during merge)
  source: "scheduler" | "taskforce" | "chat" | "agent" | "manual";
  workflow_id?: string;
}

export interface SchedulerStats {
  total_jobs: number;
  active_jobs: number;
  paused_jobs: number;
  completed_jobs: number;
  total_runs: number;
  total_failures: number;
}
