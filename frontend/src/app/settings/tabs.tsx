"use client";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import {
  Settings, Save, Cpu, Brain, HardDrive, Shield, Database, Clock, Search,
  Check, ChevronRight, ChevronDown, Plug, CircleCheck, CircleX, Server, Wifi, WifiOff, Wrench, RefreshCw,
  KeyRound, Eye, EyeOff, Copy, Trash2, Plus,
  Sparkles, Undo2, AlertTriangle, Zap, Cloud, Monitor, X, ArrowRight, ArrowLeft, Rocket, Link2Off, Menu,
} from "lucide-react";
import ConnectionsManager from "@/components/connections-manager";
import { TestBtn, Field, Toggle, NumberInput, TextInput, SelectInput, SectionHeader, AdvancedDisclosure } from "./_ui";
import EnvPanel from "./EnvPanel";
import ToolsPanel from "./ToolsPanel";
import type { FullConfig, TabId } from "./config";

function JitStatsLine({ enabled }: { enabled: boolean }) {
  const [s, setS] = useState<{ families: number; trusted: number; total_hits: number; embedder?: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) { setS(null); return; }
    let alive = true;
    const load = () => apiFetch<{ families: number; trusted: number; total_hits: number; embedder?: boolean }>("/jit/stats").then(d => { if (alive) setS(d); }).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <p className="text-[10px] text-slate-500 mt-1">
      {s
        ? <>Agent-JIT: <span className="text-slate-300">{s.families}</span> familles &middot; <span className="text-slate-300">{s.trusted}</span> trusted &middot; <span className="text-slate-300">{s.total_hits}</span> réutilisations{s.embedder ? "" : " · signature exacte (sans embedder)"}</>
        : "Agent-JIT: chargement…"}
    </p>
  );
}

export function SettingsTabs({ tab, cfg, update, testing, testResult, testConnection, remoteUrl, setRemoteUrl, saveRemote, testRemote, remoteEnabled, remoteTesting, remoteTestResult, clearRemote }: {
  tab: TabId;
  cfg: FullConfig;
  update: <K extends keyof FullConfig>(key: K, val: FullConfig[K]) => void;
  testing: string | null;
  testResult: { service: string; ok: boolean; detail: string } | null;
  testConnection: (service: string, params?: Record<string, string>) => void;
  remoteUrl: string;
  setRemoteUrl: React.Dispatch<React.SetStateAction<string>>;
  saveRemote: () => void;
  testRemote: () => void;
  remoteEnabled: boolean;
  remoteTesting: boolean;
  remoteTestResult: { ok: boolean; detail: string } | null;
  clearRemote: () => void;
}) {
  return (
    <>
            {/* ── LLM Provider ────────────────────────────────────────────── */}
            {tab === "llm" && (
              <>
                <SectionHeader icon={Brain} color="text-violet-400" title="LLM Provider" desc="Configure which language model powers the kernel" />

                {/* Saved connections — multi-provider presets, switchable from the chat/agents headers */}
                <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.02] p-3.5 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/15 shrink-0"><Cpu className="h-3.5 w-3.5 text-violet-400" /></div>
                    <div className="min-w-0">
                      <h3 className="text-[12px] font-semibold text-slate-200">Saved connections</h3>
                      <p className="text-[10px] text-slate-500 leading-relaxed">Store several provider / model / key combos and switch the active one in a click — here, or from the model picker in the chat &amp; agents headers. Activating a connection sets the provider config below.</p>
                    </div>
                  </div>
                  <ConnectionsManager />
                </div>
              </>
            )}

            {/* ── Engine ──────────────────────────────────────────────────── */}
            {tab === "engine" && (
              <>
                <SectionHeader icon={Cpu} color="text-blue-400" title="Kernel Engine" desc="ReAct loop, LTP compiler, tool routing" />
                <Field label="Default Execution Mode">
                  <SelectInput value={cfg.execution_mode} onChange={v => update("execution_mode", v)} options={[
                    { value: "react", label: "ReAct (multi-turn reasoning)" },
                    { value: "ltp", label: "LTP (compile-once, deterministic)" },
                    { value: "hybrid", label: "Hybrid (auto-select per task)" },
                  ]} />
                </Field>
                <Field label="Max Turns per Task" hint="Maximum reasoning steps before the engine stops">
                  <NumberInput value={cfg.max_turns} onChange={v => update("max_turns", v)} min={1} max={100} />
                </Field>
                <AdvancedDisclosure label="Limits & routing" hint="token / cost budget · smart routing">
                  <Field label="Max Tokens per Task" hint="Token budget across all turns">
                    <NumberInput value={cfg.max_tokens} onChange={v => update("max_tokens", v)} min={256} max={500000} step={1000} />
                  </Field>
                  <Field label="Max Cost per Task ($)" hint="Task stops when cost exceeds this amount">
                    <NumberInput value={cfg.max_cost} onChange={v => update("max_cost", v)} min={0.01} max={100} step={0.1} />
                  </Field>
                  <Field label="Context Window (tokens)" hint="Tokens sent to the LLM per turn — raise for repo-scale tasks (capped by Max Tokens)">
                    <NumberInput value={cfg.context_window_tokens} onChange={v => update("context_window_tokens", v)} min={4000} max={500000} step={1000} />
                  </Field>
                  <Field label="Bootstrap relevance floor" hint="Min similarity (0–1) for auto-injected RAG/memory/corrections. Higher = stricter, fewer wasted tokens on off-topic queries. 0 = inject nearest matches always.">
                    <NumberInput value={cfg.bootstrap_min_score} onChange={v => update("bootstrap_min_score", v)} min={0} max={1} step={0.05} />
                  </Field>
                  <Field label="Kernel Checkpoint URL" hint="postgres://… externalizes kernel state (cross-instance task resume); empty = local SQLite">
                    <TextInput value={cfg.kernel_checkpoint_url} onChange={v => update("kernel_checkpoint_url", v)} placeholder="postgresql://user:pass@host:5432/db" />
                  </Field>
                  <Toggle label="Smart Tool Routing" value={cfg.routing_enabled} onChange={v => update("routing_enabled", v)} />
                  <Field label="Agent-JIT cache" hint="Reuse shadow-validated solution patterns across repeated task families. First sighting reasons normally; a later one is validated once by deterministic output comparison, then reused cheaply. Off by default.">
                    <Toggle label="Enable Agent-JIT" value={cfg.jit_enabled} onChange={v => update("jit_enabled", v)} />
                    <JitStatsLine enabled={cfg.jit_enabled} />
                  </Field>
                </AdvancedDisclosure>
                <AdvancedDisclosure label="Multi-agent graph limits" hint="how far a TaskForce graph can iterate">
                  <p className="text-[10px] text-slate-500 leading-relaxed -mt-1">
                    Guardrails for graph workflows (the visual builder). Higher = deeper iteration and self-correction, at the cost of more steps, latency and tokens. Defaults are conservative on purpose.
                  </p>
                  <Field label="Max self-refine rounds" hint="How many times a node may re-run to improve its own output (self-loop)">
                    <NumberInput value={cfg.graph_max_self_refines} onChange={v => update("graph_max_self_refines", v)} min={0} max={10} />
                  </Field>
                  <Field label="Max feedback re-runs" hint="How many times a node may re-run when a downstream node sends feedback">
                    <NumberInput value={cfg.graph_max_feedback_runs} onChange={v => update("graph_max_feedback_runs", v)} min={0} max={10} />
                  </Field>
                  <Field label="Max graph steps" hint="Hard ceiling on total node executions per run — prevents a graph from running away">
                    <NumberInput value={cfg.graph_max_total_steps} onChange={v => update("graph_max_total_steps", v)} min={1} max={500} step={5} />
                  </Field>
                </AdvancedDisclosure>
                <div className="bg-slate-900/40 border border-slate-700/40 rounded-lg px-4 py-3 text-xs text-slate-400">
                  <strong className="text-slate-300">Hybrid mode</strong> classifies each task and routes to LTP for structured workflows (web search, data extraction) or ReAct for open-ended reasoning. Most efficient option.
                </div>
              </>
            )}

            {/* ── Workspace ───────────────────────────────────────────────── */}
            {tab === "workspace" && (
              <>
                <SectionHeader icon={HardDrive} color="text-green-400" title="Workspace" desc="File management, tenant isolation, checkpoints" />
                <Field label="Workspace Root" hint="Base directory for all workspace files">
                  <TextInput value={cfg.workspace_root} onChange={v => update("workspace_root", v)} placeholder="~/.kernelmcp/workspace" />
                </Field>
                <Toggle label="Tenant Isolation" value={cfg.tenant_isolation} onChange={v => update("tenant_isolation", v)} />
                <Toggle label="Checkpoint System" value={cfg.checkpoint_enabled} onChange={v => update("checkpoint_enabled", v)} />
                <Field label="Max File Size (MB)" hint="Maximum upload/write file size">
                  <NumberInput value={cfg.max_file_size_mb} onChange={v => update("max_file_size_mb", v)} min={1} max={500} />
                </Field>
                <div className="bg-green-950/20 border border-green-800/30 rounded-lg px-4 py-3 text-xs text-green-300">
                  When tenant isolation is enabled, each namespace gets its own subdirectory. Files cannot escape the tenant boundary.
                </div>
                <TestBtn service="workspace" testing={testing} result={testResult} onClick={() => testConnection("workspace")} />
              </>
            )}

            {/* ── Sandbox & Host ──────────────────────────────────────────── */}
            {tab === "sandbox" && (
              <>
                <SectionHeader icon={Shield} color="text-amber-400" title="Sandbox & Host Access" desc="Code execution, host commands, security" />
                <Toggle label="Host Command Execution" value={cfg.host_exec_enabled} onChange={v => update("host_exec_enabled", v)} />
                <Toggle label="Auto-Approve Commands" value={cfg.auto_approve} onChange={v => update("auto_approve", v)} />
                <Field label="Execution Timeout (seconds)" hint="Max runtime for code execution">
                  <NumberInput value={cfg.sandbox_timeout} onChange={v => update("sandbox_timeout", v)} min={5} max={300} />
                </Field>
                <Field label="Max Output Size (chars)" hint="Truncate tool output beyond this">
                  <NumberInput value={cfg.max_output_chars} onChange={v => update("max_output_chars", v)} min={500} max={50000} step={500} />
                </Field>
                {cfg.auto_approve && (
                  <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-4 py-3 text-xs text-amber-300 animate-fade-in">
                    <div className="flex items-center gap-2 mb-1"><AlertTriangle className="h-3.5 w-3.5" /><strong>Warning</strong></div>
                    Auto-approve is enabled. All host commands will execute without user confirmation. Use with caution in production.
                  </div>
                )}
                <TestBtn service="sandbox" testing={testing} result={testResult} onClick={() => testConnection("sandbox")} />
              </>
            )}

            {/* ── Memory ─────────────────────────────────────────────────── */}
            {tab === "memory" && (
              <>
                <SectionHeader icon={Database} color="text-pink-400" title="Memory" desc="Persistent fact storage, importance filtering" />
                <Field label="Importance Threshold" hint="Minimum score (0-1) for memory recall">
                  <NumberInput value={cfg.memory_importance_threshold} onChange={v => update("memory_importance_threshold", v)} min={0} max={1} step={0.1} />
                </Field>
                <Field label="Max Results per Query" hint="Number of memories returned per search">
                  <NumberInput value={cfg.memory_max_results} onChange={v => update("memory_max_results", v)} min={1} max={50} />
                </Field>
                <Field label="Default Tags" hint="Comma-separated tags added to all stored facts">
                  <TextInput value={cfg.memory_default_tags} onChange={v => update("memory_default_tags", v)} placeholder="project, notes" />
                </Field>
                <AdvancedDisclosure label="Reranking" hint="cross-encoder · higher recall, slower">
                  <Toggle label="Enable Reranker" value={cfg.memory_enable_rerank} onChange={v => update("memory_enable_rerank", v)} />
                  <Field label="Reranker Model" hint="Cross-encoder that re-scores retrieved memories for accuracy. Measured: recall@1 0.40→0.88. Cost ~+200ms/query, ~80MB model downloaded on first use. Empty = default (ms-marco-MiniLM-L-6-v2, English).">
                    <TextInput value={cfg.memory_rerank_model} onChange={v => update("memory_rerank_model", v)} placeholder="Xenova/ms-marco-MiniLM-L-6-v2" />
                  </Field>
                </AdvancedDisclosure>
                <AdvancedDisclosure label="Query expansion" hint="LLM paraphrase · recovers hard paraphrases">
                  <Toggle label="Enable Query Expansion" value={cfg.memory_enable_query_expansion} onChange={v => update("memory_enable_query_expansion", v)} />
                  <Field label="Expansion Threshold" hint="When a memory search scores below this, the query is rewritten into synonymous phrasings and re-searched — recovering facts worded differently than the question. Measured: retrieval recall@5 0.42→0.92 on zero-overlap paraphrases. Adaptive: costs one extra LLM call ONLY when the first pass is weak. Higher = expand more often (1.0 = always); lower = rarely. Default 0.5.">
                    <NumberInput value={cfg.memory_query_expansion_threshold} onChange={v => update("memory_query_expansion_threshold", v)} step={0.05} min={0} max={1} />
                  </Field>
                </AdvancedDisclosure>
                <TestBtn service="memory" testing={testing} result={testResult} onClick={() => testConnection("memory")} />
              </>
            )}

            {/* ── Scheduler ──────────────────────────────────────────────── */}
            {tab === "scheduler" && (
              <>
                <SectionHeader icon={Clock} color="text-cyan-400" title="Scheduler" desc="Task scheduling: once, cron, interval, watch" />
                <Toggle label="Scheduler Enabled" value={cfg.scheduler_enabled} onChange={v => update("scheduler_enabled", v)} />
                <Field label="Tick Interval (seconds)" hint="How often the scheduler checks for due jobs">
                  <NumberInput value={cfg.scheduler_tick_interval} onChange={v => update("scheduler_tick_interval", v)} min={5} max={300} />
                </Field>
                <Field label="Max Concurrent Jobs" hint="Maximum jobs running simultaneously">
                  <NumberInput value={cfg.scheduler_max_concurrent} onChange={v => update("scheduler_max_concurrent", v)} min={1} max={20} />
                </Field>
                <div className="bg-cyan-950/20 border border-cyan-800/30 rounded-lg px-4 py-3 text-xs text-cyan-300">
                  <strong className="text-cyan-200">Job types:</strong> once (delay/datetime), cron (recurring), interval (every N seconds), watch (event-driven with conditions).
                </div>
                <TestBtn service="scheduler" testing={testing} result={testResult} onClick={() => testConnection("scheduler")} />
              </>
            )}

            {/* ── RAG ────────────────────────────────────────────────────── */}
            {tab === "rag" && (
              <>
                <SectionHeader icon={Search} color="text-orange-400" title="Knowledge Base / RAG" desc="Document ingestion, embedding, semantic search" />
                <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-4 py-3 text-xs text-amber-300">
                  RAG settings are configured via environment variables at startup. Changes here show current defaults but require a server restart to take effect.
                </div>
                <Field label="Top-K Results" hint="Number of chunks returned per search">
                  <NumberInput value={cfg.rag_top_k} onChange={v => update("rag_top_k", v)} min={1} max={20} />
                </Field>
                <AdvancedDisclosure label="Indexing" hint="embedding model · chunking">
                  <Field label="Embedding Model" hint="Currently loaded at startup. Changing requires restart + collection recreation.">
                    <SelectInput value={cfg.rag_embedding_model} onChange={v => update("rag_embedding_model", v)} options={[
                      { value: "BAAI/bge-small-en-v1.5", label: "BGE Small EN (384d, 33M, fast)" },
                      { value: "BAAI/bge-base-en-v1.5", label: "BGE Base EN (768d, 110M, balanced)" },
                      { value: "BAAI/bge-large-en-v1.5", label: "BGE Large EN (1024d, 335M, accurate)" },
                      { value: "sentence-transformers/all-MiniLM-L6-v2", label: "MiniLM L6 (384d, 22M, lightweight)" },
                    ]} />
                  </Field>
                  <Field label="Chunk Size (tokens)" hint="Size of text chunks for indexing">
                    <NumberInput value={cfg.rag_chunk_size} onChange={v => update("rag_chunk_size", v)} min={128} max={2048} step={64} />
                  </Field>
                  <Field label="Chunk Overlap (tokens)" hint="Overlap between consecutive chunks">
                    <NumberInput value={cfg.rag_chunk_overlap} onChange={v => update("rag_chunk_overlap", v)} min={0} max={512} step={10} />
                  </Field>
                </AdvancedDisclosure>
                <TestBtn service="rag" testing={testing} result={testResult} onClick={() => testConnection("rag")} />
              </>
            )}

            {/* ── Tools ──────────────────────────────────────────────── */}
            {tab === "tools" && <ToolsPanel />}

            {tab === "env" && <EnvPanel />}

            {/* ── Infrastructure ─────────────────────────────────────────── */}
            {tab === "infra" && (
              <>
                <SectionHeader icon={HardDrive} color="text-slate-400" title="Infrastructure Backends" desc="Where each library stores its data — optional; changes require a server restart." />

                <AdvancedDisclosure label="Memory storage" hint="episodic · facts · graph · decay">
                <Field label="Episodic / Working Store" hint="Where episodes and working memory are stored">
                  <SelectInput value={cfg.memory_backend} onChange={v => update("memory_backend", v)} options={[
                    { value: "memory", label: "In-Memory (dev, volatile)" },
                    { value: "sqlite", label: "SQLite (persistent, single-server)" },
                    { value: "redis", label: "Redis (persistent, multi-server)" },
                  ]} />
                </Field>
                <Field label="Semantic Store (Facts)" hint="Where stored facts persist">
                  <SelectInput value={cfg.memory_semantic_backend} onChange={v => update("memory_semantic_backend", v)} options={[
                    { value: "memory", label: "In-Memory (volatile)" },
                    { value: "chroma", label: "ChromaDB (persistent, local)" },
                    { value: "pgvector", label: "pgvector (PostgreSQL)" },
                    { value: "qdrant", label: "Qdrant (vector DB)" },
                  ]} />
                </Field>
                {cfg.memory_semantic_backend === "qdrant" && (
                  <>
                    <Field label="Qdrant URL" hint="Server URL (inside Docker use host.docker.internal), or :memory: for in-process">
                      <TextInput value={cfg.memory_qdrant_url} onChange={v => update("memory_qdrant_url", v)} placeholder="http://host.docker.internal:6333" />
                    </Field>
                    <Field label="Qdrant Collection"><TextInput value={cfg.memory_qdrant_collection} onChange={v => update("memory_qdrant_collection", v)} placeholder="memorymcp_facts" /></Field>
                  </>
                )}
                <Field label="Hot Cache Backend" hint="Fast LRU cache of frequently-recalled facts (shared across instances if Redis)">
                  <SelectInput value={cfg.memory_hotcache_backend === "redis" ? "redis" : "memory"} onChange={v => update("memory_hotcache_backend", v === "redis" ? "redis" : "")} options={[
                    { value: "memory", label: "In-Memory (default)" },
                    { value: "redis", label: "Redis (shared)" },
                  ]} />
                </Field>
                {(cfg.memory_backend === "redis" || cfg.memory_hotcache_backend === "redis") && (
                  <>
                    <Field label="Redis URL" hint="Include password: redis://:password@host:6379/0">
                      <TextInput value={cfg.memory_redis_url} onChange={v => update("memory_redis_url", v)} placeholder="redis://:password@localhost:6379/0" />
                    </Field>
                    <TestBtn service="redis" testing={testing} result={testResult} onClick={() => testConnection("redis")} />
                  </>
                )}
                <Field label="Fact Graph Backend" hint="Stores how facts relate to each other (entities & links) for graph-aware recall">
                  <SelectInput value={cfg.memory_graph_backend === "neo4j" ? "neo4j" : "memory"} onChange={v => { if (v === "neo4j") { update("memory_graph_backend", "neo4j"); update("memory_neo4j_uri", cfg.memory_neo4j_uri || "bolt://localhost:7687"); } else { update("memory_graph_backend", ""); update("memory_neo4j_uri", ""); } }} options={[
                    { value: "memory", label: "In-Memory (dev)" },
                    { value: "neo4j", label: "Neo4j (production)" },
                  ]} />
                </Field>
                {cfg.memory_graph_backend === "neo4j" && (
                  <>
                    <Field label="Neo4j URI" hint="Connection address of your Neo4j instance"><TextInput value={cfg.memory_neo4j_uri} onChange={v => update("memory_neo4j_uri", v)} placeholder="bolt://localhost:7687" /></Field>
                    <Field label="Neo4j User"><TextInput value={cfg.memory_neo4j_user} onChange={v => update("memory_neo4j_user", v)} placeholder="neo4j" /></Field>
                    <Field label="Neo4j Password"><TextInput value={cfg.memory_neo4j_password} onChange={v => update("memory_neo4j_password", v)} placeholder="password" type="password" /></Field>
                    <TestBtn service="neo4j" testing={testing} result={testResult} onClick={() => testConnection("neo4j", { url: cfg.memory_neo4j_uri, user: cfg.memory_neo4j_user, password: cfg.memory_neo4j_password })} />
                  </>
                )}
                <Field label="Decay Mode" hint="How facts lose relevance over time">
                  <SelectInput value={cfg.memory_decay_mode} onChange={v => update("memory_decay_mode", v)} options={[
                    { value: "exponential", label: "Exponential (half-life 7d)" },
                    { value: "linear", label: "Linear (constant decay)" },
                    { value: "anchored", label: "Anchored (never decays)" },
                    { value: "adaptive", label: "Adaptive (slows with retrieval)" },
                  ]} />
                </Field>
                </AdvancedDisclosure>

                <AdvancedDisclosure label="Knowledge / vector storage" hint="vector store · graph store">
                <Field label="Vector Store" hint="Where document embeddings are indexed for semantic search">
                  <SelectInput value={cfg.rag_vectorstore} onChange={v => update("rag_vectorstore", v)} options={[
                    { value: "memory", label: "In-Memory (dev)" },
                    { value: "qdrant", label: "Qdrant (production)" },
                    { value: "chroma", label: "ChromaDB (local)" },
                    { value: "pgvector", label: "PostgreSQL + pgvector" },
                    { value: "milvus", label: "Milvus (distributed)" },
                  ]} />
                </Field>
                {["qdrant", "milvus", "pgvector"].includes(cfg.rag_vectorstore) && (
                  <>
                    <Field label="Vector Store URL" hint="Connection URL of your vector database">
                      <TextInput value={cfg.rag_vectorstore_url} onChange={v => update("rag_vectorstore_url", v)} placeholder={cfg.rag_vectorstore === "qdrant" ? "http://localhost:6333" : cfg.rag_vectorstore === "pgvector" ? "postgresql://user:pass@localhost/db" : "http://localhost:19530"} />
                    </Field>
                    {["qdrant", "milvus"].includes(cfg.rag_vectorstore) && (
                      <Field label="API Key" hint="Optional — for cloud-hosted instances">
                        <TextInput value={cfg.rag_vectorstore_api_key} onChange={v => update("rag_vectorstore_api_key", v)} placeholder="Optional API key" type="password" />
                      </Field>
                    )}
                    <TestBtn service={cfg.rag_vectorstore} testing={testing} result={testResult} onClick={() => testConnection(cfg.rag_vectorstore)} />
                  </>
                )}
                <Field label="Graph Store" hint="Stores the knowledge graph (entities & relations) extracted from documents">
                  <SelectInput value={cfg.rag_graph_backend} onChange={v => update("rag_graph_backend", v)} options={[
                    { value: "networkx", label: "NetworkX (in-memory)" },
                    { value: "neo4j", label: "Neo4j (persistent)" },
                  ]} />
                </Field>
                {cfg.rag_graph_backend === "neo4j" && (
                  <>
                    <Field label="Neo4j URI" hint="Connection address of your Neo4j instance"><TextInput value={cfg.rag_neo4j_uri} onChange={v => update("rag_neo4j_uri", v)} placeholder="bolt://localhost:7687" /></Field>
                    <Field label="Neo4j User"><TextInput value={cfg.rag_neo4j_user} onChange={v => update("rag_neo4j_user", v)} placeholder="neo4j" /></Field>
                    <Field label="Neo4j Password"><TextInput value={cfg.rag_neo4j_password} onChange={v => update("rag_neo4j_password", v)} placeholder="password" type="password" /></Field>
                    <TestBtn service="neo4j" testing={testing} result={testResult} onClick={() => testConnection("neo4j", { url: cfg.rag_neo4j_uri, user: cfg.rag_neo4j_user, password: cfg.rag_neo4j_password })} />
                  </>
                )}
                </AdvancedDisclosure>

                <AdvancedDisclosure label="Audit & vault stores" hint="workspace · sandbox · scheduler">
                <Field label="Workspace Audit" hint="Where workspace file operations (read/write/delete) are logged">
                  <SelectInput value={cfg.workspace_audit_store} onChange={v => update("workspace_audit_store", v)} options={[
                    { value: "memory", label: "In-Memory" }, { value: "sqlite", label: "SQLite" },
                  ]} />
                </Field>
                <Field label="Sandbox Vault" hint="Where the code sandbox keeps secrets/credentials it needs at runtime">
                  <SelectInput value={cfg.sandbox_vault} onChange={v => update("sandbox_vault", v)} options={[
                    { value: "memory", label: "In-Memory" }, { value: "env", label: "Environment Variables" },
                  ]} />
                </Field>
                <Field label="Scheduler Store" hint="Where scheduled jobs (once / cron / interval / watch) are persisted">
                  <SelectInput value={cfg.scheduler_store} onChange={v => update("scheduler_store", v)} options={[
                    { value: "memory", label: "In-Memory" }, { value: "sqlite", label: "SQLite" },
                  ]} />
                </Field>
                </AdvancedDisclosure>

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-4">Health Checks</p>
                <div className="flex flex-wrap gap-2">
                  <TestBtn service="memory" testing={testing} result={testResult} onClick={() => testConnection("memory")} />
                  <TestBtn service="rag" testing={testing} result={testResult} onClick={() => testConnection("rag")} />
                  <TestBtn service="planning" testing={testing} result={testResult} onClick={() => testConnection("planning")} />
                  <TestBtn service="workspace" testing={testing} result={testResult} onClick={() => testConnection("workspace")} />
                  <TestBtn service="sandbox" testing={testing} result={testResult} onClick={() => testConnection("sandbox")} />
                  <TestBtn service="scheduler" testing={testing} result={testResult} onClick={() => testConnection("scheduler")} />
                  <TestBtn service="searxng" testing={testing} result={testResult} onClick={() => testConnection("searxng")} />
                </div>
              </>
            )}

            {/* ── Backend (custom-backend override; replaces local) ──────────── */}
            {tab === "remote" && (
              <>
                <SectionHeader icon={Server} color="text-teal-400" title="Backend URL" desc="Point this dashboard at a different backend — replaces the local one" />

                {/* What this is / isn't */}
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    This <strong>swaps</strong> the backend every page talks to — the local kernel and its data are hidden while active. It&apos;s a deployment setting for when this UI has no co-located backend.{" "}
                    <strong>Not</strong> how you watch other kernels: to observe kernels embedded in your own apps without losing the local view, have them call <code className="text-amber-300">connect_hub()</code> — they show up as extra scopes in Observability.
                  </p>
                </div>

                {/* Current state banner */}
                {remoteEnabled ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-500/10 border border-teal-500/20">
                    <Server className="h-4 w-4 text-teal-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-teal-300">Using a custom backend — local replaced</p>
                      <p className="text-[10px] text-teal-500 truncate">{remoteUrl}</p>
                    </div>
                    <button
                      onClick={clearRemote}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 hover:bg-red-500/20 transition-all"
                    >
                      <Link2Off className="h-3.5 w-3.5" /> Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <p className="text-xs text-slate-400">Using the local backend (default)</p>
                  </div>
                )}

                <div className="space-y-4 pt-2">
                  <Field label="Backend URL" hint="Base URL of the kernelmcp API this dashboard should drive (e.g. http://my-server:8000). This becomes THE backend — it does not run alongside the local one.">
                    <div className="flex gap-2">
                      <TextInput
                        value={remoteUrl}
                        onChange={setRemoteUrl}
                        placeholder="http://my-production-app:8000"
                      />
                      <button
                        onClick={testRemote}
                        disabled={remoteTesting || !remoteUrl.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all disabled:opacity-40 shrink-0"
                      >
                        {remoteTesting ? <Spinner className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
                        Test
                      </button>
                    </div>
                    {remoteTestResult && (
                      <p className={`flex items-center gap-1.5 text-[11px] mt-1 ${remoteTestResult.ok ? "text-green-400" : "text-red-400"}`}>
                        {remoteTestResult.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
                        {remoteTestResult.detail}
                      </p>
                    )}
                  </Field>

                  <button
                    onClick={saveRemote}
                    disabled={!remoteUrl.trim()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600/20 border border-teal-500/30 text-sm font-medium text-teal-300 hover:bg-teal-600/30 transition-all disabled:opacity-40"
                  >
                    <Server className="h-4 w-4" />
                    {remoteEnabled ? "Switch to this backend & reload" : "Use this backend & reload"}
                  </button>

                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 space-y-2">
                    <p className="text-xs font-medium text-slate-300">How it works</p>
                    <ul className="space-y-1.5 text-[11px] text-slate-500">
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>Every page (chat, agents, memory, traces, security, scheduler…) is driven by this backend — the local one is hidden while active</li>
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>The backend must have CORS enabled for this dashboard&apos;s origin</li>
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>LLM config and settings changes apply to THIS backend, not the local one</li>
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>Disconnect to return to the local backend</li>
                    </ul>
                  </div>
                </div>
              </>
            )}
    </>
  );
}
