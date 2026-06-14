import React from "react";
import { Monitor, Server, Cloud, Brain, Cpu, HardDrive, Shield, Database, Clock, Search, Wrench, KeyRound } from "lucide-react";

export interface FullConfig {
  provider: string; model: string; api_key: string; base_url: string;
  max_turns: number; max_tokens: number; max_cost: number; execution_mode: string; routing_enabled: boolean;
  context_window_tokens: number; kernel_checkpoint_url: string; bootstrap_min_score: number;
  graph_max_self_refines: number; graph_max_feedback_runs: number; graph_max_total_steps: number;
  num_ctx: number; keep_alive: string;
  workspace_root: string; tenant_isolation: boolean; max_file_size_mb: number; checkpoint_enabled: boolean;
  host_exec_enabled: boolean; auto_approve: boolean; sandbox_timeout: number; max_output_chars: number;
  memory_importance_threshold: number; memory_max_results: number; memory_default_tags: string;
  memory_enable_rerank: boolean; memory_rerank_model: string;
  memory_enable_query_expansion: boolean; memory_query_expansion_threshold: number;
  scheduler_tick_interval: number; scheduler_max_concurrent: number; scheduler_enabled: boolean;
  rag_chunk_size: number; rag_chunk_overlap: number; rag_top_k: number; rag_embedding_model: string;
  memory_backend: string; memory_semantic_backend: string; memory_redis_url: string; memory_decay_mode: string;
  memory_hotcache_backend: string; memory_graph_backend: string;
  memory_qdrant_url: string; memory_qdrant_collection: string;
  memory_neo4j_uri: string; memory_neo4j_user: string; memory_neo4j_password: string;
  rag_vectorstore: string; rag_vectorstore_url: string; rag_vectorstore_api_key: string;
  rag_graph_backend: string; rag_neo4j_uri: string; rag_neo4j_user: string; rag_neo4j_password: string;
  workspace_checkpoint_store: string; workspace_audit_store: string;
  sandbox_audit_store: string; sandbox_vault: string; scheduler_store: string;
}

export const DEFAULTS: FullConfig = {
  provider: "ollama", model: "qwen3.5:9b", api_key: "", base_url: "",
  max_turns: 10, max_tokens: 50000, max_cost: 1.0, execution_mode: "hybrid", routing_enabled: true,
  context_window_tokens: 40000, kernel_checkpoint_url: "", bootstrap_min_score: 0.35,
  graph_max_self_refines: 1, graph_max_feedback_runs: 1, graph_max_total_steps: 30,
  num_ctx: 16384, keep_alive: "30m",
  workspace_root: "~/.kernelmcp/workspace", tenant_isolation: true,
  max_file_size_mb: 50, checkpoint_enabled: true,
  host_exec_enabled: true, auto_approve: false, sandbox_timeout: 30, max_output_chars: 5000,
  memory_importance_threshold: 0.5, memory_max_results: 10, memory_default_tags: "",
  memory_enable_rerank: false, memory_rerank_model: "",
  memory_enable_query_expansion: false, memory_query_expansion_threshold: 0.5,
  scheduler_tick_interval: 15, scheduler_max_concurrent: 5, scheduler_enabled: true,
  rag_chunk_size: 512, rag_chunk_overlap: 50, rag_top_k: 5, rag_embedding_model: "BAAI/bge-small-en-v1.5",
  memory_backend: "sqlite", memory_semantic_backend: "chroma", memory_redis_url: "", memory_decay_mode: "exponential",
  memory_hotcache_backend: "", memory_graph_backend: "",
  memory_qdrant_url: "http://host.docker.internal:6333", memory_qdrant_collection: "memorymcp_facts",
  memory_neo4j_uri: "", memory_neo4j_user: "neo4j", memory_neo4j_password: "",
  rag_vectorstore: "qdrant", rag_vectorstore_url: "", rag_vectorstore_api_key: "",
  rag_graph_backend: "networkx",
  rag_neo4j_uri: "", rag_neo4j_user: "neo4j", rag_neo4j_password: "",
  workspace_checkpoint_store: "sqlite", workspace_audit_store: "sqlite",
  sandbox_audit_store: "sqlite", sandbox_vault: "memory", scheduler_store: "sqlite",
};

// ── Presets ────────────────────────────────────────────────────────────────

export const PRESETS: Record<string, { label: string; icon: React.ComponentType<{className?: string}>; desc: string; values: Partial<FullConfig> }> = {
  dev: {
    label: "Development",
    icon: Monitor,
    desc: "Local Ollama, SQLite, in-memory stores. Fast iteration.",
    values: {
      provider: "ollama", model: "qwen3.5:9b", base_url: "http://localhost:11434",
      memory_backend: "sqlite", memory_semantic_backend: "chroma",
      rag_vectorstore: "chroma", rag_graph_backend: "networkx",
      workspace_checkpoint_store: "sqlite", scheduler_store: "sqlite",
      sandbox_vault: "memory", execution_mode: "hybrid",
    },
  },
  prod: {
    label: "Production",
    icon: Server,
    desc: "Redis, Qdrant, Neo4j. Persistent, multi-server ready.",
    values: {
      memory_backend: "redis", memory_semantic_backend: "chroma",
      memory_redis_url: "redis://:password@localhost:6379/0",
      rag_vectorstore: "qdrant", rag_vectorstore_url: "http://localhost:6333",
      rag_graph_backend: "neo4j", rag_neo4j_uri: "bolt://localhost:7687",
      workspace_checkpoint_store: "sqlite", scheduler_store: "sqlite",
      sandbox_vault: "env", execution_mode: "hybrid", memory_decay_mode: "adaptive",
    },
  },
  cloud: {
    label: "Cloud",
    icon: Cloud,
    desc: "OpenAI/Anthropic + managed vector DB. Zero local infra.",
    values: {
      provider: "anthropic", model: "claude-sonnet-4-20250514",
      memory_backend: "redis", memory_semantic_backend: "chroma",
      rag_vectorstore: "qdrant", rag_graph_backend: "neo4j",
      execution_mode: "hybrid", routing_enabled: true,
    },
  },
};

// ── Tab definitions ────────────────────────────────────────────────────────

export const TABS = [
  { id: "llm", label: "LLM Provider", icon: Brain, color: "text-violet-400", bg: "bg-violet-400" },
  { id: "engine", label: "Engine", icon: Cpu, color: "text-blue-400", bg: "bg-blue-400" },
  { id: "workspace", label: "Workspace", icon: HardDrive, color: "text-green-400", bg: "bg-green-400" },
  { id: "sandbox", label: "Sandbox & Host", icon: Shield, color: "text-amber-400", bg: "bg-amber-400" },
  { id: "memory", label: "Memory", icon: Database, color: "text-pink-400", bg: "bg-pink-400" },
  { id: "scheduler", label: "Scheduler", icon: Clock, color: "text-cyan-400", bg: "bg-cyan-400" },
  { id: "rag", label: "Knowledge / RAG", icon: Search, color: "text-orange-400", bg: "bg-orange-400" },
  { id: "tools", label: "Tools", icon: Wrench, color: "text-violet-400", bg: "bg-violet-400" },
  { id: "env", label: "Environment", icon: KeyRound, color: "text-lime-400", bg: "bg-lime-400" },
  { id: "infra", label: "Infrastructure", icon: HardDrive, color: "text-slate-400", bg: "bg-slate-400" },
  { id: "remote", label: "Backend", icon: Server, color: "text-teal-400", bg: "bg-teal-400" },
] as const;

export type TabId = typeof TABS[number]["id"];

// Map fields to tabs for dirty tracking
export const TAB_FIELDS: Record<TabId, (keyof FullConfig)[]> = {
  llm: [],
  engine: ["max_turns", "max_tokens", "max_cost", "context_window_tokens", "kernel_checkpoint_url", "execution_mode", "routing_enabled", "graph_max_self_refines", "graph_max_feedback_runs", "graph_max_total_steps"],
  workspace: ["workspace_root", "tenant_isolation", "max_file_size_mb", "checkpoint_enabled"],
  sandbox: ["host_exec_enabled", "auto_approve", "sandbox_timeout", "max_output_chars"],
  memory: ["memory_importance_threshold", "memory_max_results", "memory_default_tags", "memory_enable_rerank", "memory_rerank_model", "memory_enable_query_expansion", "memory_query_expansion_threshold"],
  scheduler: ["scheduler_tick_interval", "scheduler_max_concurrent", "scheduler_enabled"],
  rag: ["rag_chunk_size", "rag_chunk_overlap", "rag_top_k", "rag_embedding_model"],
  tools: [],
  env: [],
  infra: ["memory_backend", "memory_semantic_backend", "memory_hotcache_backend", "memory_graph_backend", "memory_qdrant_url", "memory_qdrant_collection", "memory_redis_url", "memory_decay_mode", "memory_neo4j_uri", "memory_neo4j_user", "memory_neo4j_password", "rag_vectorstore", "rag_vectorstore_url", "rag_vectorstore_api_key", "rag_graph_backend", "rag_neo4j_uri", "rag_neo4j_user", "rag_neo4j_password", "workspace_checkpoint_store", "workspace_audit_store", "sandbox_audit_store", "sandbox_vault", "scheduler_store"],
  remote: [],
};

// ── Health service definitions ─────────────────────────────────────────────

export const HEALTH_SERVICES = [
  { id: "llm", label: "LLM", tab: "llm" as TabId, color: "bg-violet-400" },
  { id: "memory", label: "Memory", tab: "memory" as TabId, color: "bg-pink-400" },
  { id: "rag", label: "RAG", tab: "rag" as TabId, color: "bg-orange-400" },
  { id: "workspace", label: "Workspace", tab: "workspace" as TabId, color: "bg-green-400" },
  { id: "sandbox", label: "Sandbox", tab: "sandbox" as TabId, color: "bg-amber-400" },
  { id: "scheduler", label: "Scheduler", tab: "scheduler" as TabId, color: "bg-cyan-400" },
];

export function pickDefined(obj: Record<string, unknown>): Partial<FullConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<FullConfig>;
}
