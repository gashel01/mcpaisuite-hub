// Shared eval domain types.

export interface Dataset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  case_count: number;
  cases?: EvalCase[];
  created_at: string;
  updated_at: string;
}

export interface EvalCase {
  id: string;
  input: string;
  expected_output: string;
  tags: string[];
}

export interface EvalRun {
  id: string;
  dataset_id: string;
  dataset_name: string;
  namespace?: string; // tenant the run executed under (provenance badge)
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: RunSummary;
}

export interface RunSummary {
  total_cases: number;
  avg_score: number;
  pass_rate: number;
  total_duration_ms: number;
  scores_by_scorer?: Record<string, { avg: number; count: number }>;
}

export interface RunResult {
  case_id: string;
  input: string;
  expected: string;
  output: string;
  scores: { scorer: string; score: number; passed: boolean; detail: string }[];
  error: string;
  duration_ms: number;
}

export interface Scorer {
  type: string;
  description: string;
}

// ── Page ───────────────────────────────────────────────────────────────────
