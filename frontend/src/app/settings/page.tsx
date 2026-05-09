"use client";

import { useEffect, useState } from "react";
import {
  Settings, Save, Loader2, Cpu, Brain, HardDrive, Shield, Database, Clock, Search,
  Check, ChevronRight, Plug, CircleCheck, CircleX,
} from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

// ── Types ──────────────────────────────────────────────────────────────────

interface FullConfig {
  // LLM
  provider: string;
  model: string;
  api_key: string;
  base_url: string;
  // Engine
  max_turns: number;
  max_tokens: number;
  execution_mode: string;
  routing_enabled: boolean;
  num_ctx: number;
  keep_alive: string;
  // Workspace
  workspace_root: string;
  tenant_isolation: boolean;
  max_file_size_mb: number;
  checkpoint_enabled: boolean;
  // Sandbox
  host_exec_enabled: boolean;
  auto_approve: boolean;
  sandbox_timeout: number;
  max_output_chars: number;
  // Memory
  memory_importance_threshold: number;
  memory_max_results: number;
  memory_default_tags: string;
  // Scheduler
  scheduler_tick_interval: number;
  scheduler_max_concurrent: number;
  scheduler_enabled: boolean;
  // RAG
  rag_chunk_size: number;
  rag_chunk_overlap: number;
  rag_top_k: number;
  rag_embedding_model: string;
  // Infrastructure backends
  memory_backend: string;
  memory_semantic_backend: string;
  memory_redis_url: string;
  memory_decay_mode: string;
  memory_neo4j_uri: string;
  memory_neo4j_user: string;
  memory_neo4j_password: string;
  rag_vectorstore: string;
  rag_vectorstore_url: string;
  rag_vectorstore_api_key: string;
  rag_graph_backend: string;
  rag_neo4j_uri: string;
  rag_neo4j_user: string;
  rag_neo4j_password: string;
  workspace_checkpoint_store: string;
  workspace_audit_store: string;
  sandbox_audit_store: string;
  sandbox_vault: string;
  scheduler_store: string;
}

const DEFAULTS: FullConfig = {
  provider: "ollama", model: "qwen3.5:9b", api_key: "", base_url: "",
  max_turns: 10, max_tokens: 50000, execution_mode: "hybrid", routing_enabled: true,
  num_ctx: 16384, keep_alive: "30m",
  workspace_root: "~/.kernelmcp/workspace", tenant_isolation: true,
  max_file_size_mb: 50, checkpoint_enabled: true,
  host_exec_enabled: true, auto_approve: false, sandbox_timeout: 30, max_output_chars: 5000,
  memory_importance_threshold: 0.5, memory_max_results: 10, memory_default_tags: "",
  scheduler_tick_interval: 15, scheduler_max_concurrent: 5, scheduler_enabled: true,
  rag_chunk_size: 512, rag_chunk_overlap: 50, rag_top_k: 5, rag_embedding_model: "BAAI/bge-small-en-v1.5",
  // Infrastructure
  memory_backend: "sqlite", memory_semantic_backend: "chroma", memory_redis_url: "", memory_decay_mode: "exponential",
  memory_neo4j_uri: "", memory_neo4j_user: "neo4j", memory_neo4j_password: "",
  rag_vectorstore: "qdrant", rag_vectorstore_url: "", rag_vectorstore_api_key: "",
  rag_graph_backend: "networkx",
  rag_neo4j_uri: "", rag_neo4j_user: "neo4j", rag_neo4j_password: "",
  workspace_checkpoint_store: "sqlite", workspace_audit_store: "sqlite",
  sandbox_audit_store: "sqlite", sandbox_vault: "memory",
  scheduler_store: "sqlite",
};

// ── Tab definitions ────────────────────────────────────────────────────────

const TABS = [
  { id: "llm", label: "LLM Provider", icon: Brain, color: "text-violet-400" },
  { id: "engine", label: "Engine", icon: Cpu, color: "text-blue-400" },
  { id: "workspace", label: "Workspace", icon: HardDrive, color: "text-green-400" },
  { id: "sandbox", label: "Sandbox & Host", icon: Shield, color: "text-amber-400" },
  { id: "memory", label: "Memory", icon: Database, color: "text-pink-400" },
  { id: "scheduler", label: "Scheduler", icon: Clock, color: "text-cyan-400" },
  { id: "rag", label: "Knowledge / RAG", icon: Search, color: "text-orange-400" },
  { id: "infra", label: "Infrastructure", icon: HardDrive, color: "text-slate-400" },
] as const;

type TabId = typeof TABS[number]["id"];

// ── Components ─────────────────────────────────────────────────────────────

function TestBtn({ service, testing, result, onClick }: { service: string; testing: string | null; result: { service: string; ok: boolean; detail: string } | null; onClick: () => void }) {
  const isThis = testing === service;
  const hasResult = result && result.service === service;
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={!!testing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 disabled:opacity-50"
      >
        {isThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
        {isThis ? "Testing..." : `Test ${service}`}
      </button>
      {hasResult && (
        <span className={`flex items-center gap-1 text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}>
          {result.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
          {result.detail.slice(0, 80)}
        </span>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-300">{label}</label>
      {hint && <p className="text-[11px] text-slate-500 -mt-0.5">{hint}</p>}
      {children}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-slate-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full transition-colors ${value ? "bg-violet-600" : "bg-slate-700"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
    />
  );
}

function TextInput({ value, onChange, placeholder, type }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type || "text"}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
    />
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [cfg, setCfg] = useState<FullConfig>(DEFAULTS);
  const [tab, setTab] = useState<TabId>("llm");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ service: string; ok: boolean; detail: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  const testConnection = async (service: string, params: Record<string, string> = {}) => {
    setTesting(service);
    setTestResult(null);
    try {
      const body: Record<string, string> = { service, ...params };
      if (service === "llm") {
        body.model = cfg.model;
        body.provider = cfg.provider;
        if (cfg.api_key) body.api_key = cfg.api_key;
        if (cfg.base_url) body.url = cfg.base_url;
      } else if (service === "redis") {
        body.url = cfg.memory_redis_url;
      } else if (service === "neo4j") {
        body.url = params.url || cfg.memory_neo4j_uri || cfg.rag_neo4j_uri;
        body.user = params.user || cfg.memory_neo4j_user || cfg.rag_neo4j_user;
        body.password = params.password || cfg.memory_neo4j_password || cfg.rag_neo4j_password;
      } else if (service === "qdrant") {
        body.url = cfg.rag_vectorstore_url;
        if (cfg.rag_vectorstore_api_key) body.api_key = cfg.rag_vectorstore_api_key;
      } else if (service === "pgvector" || service === "milvus") {
        body.url = cfg.rag_vectorstore_url;
      }
      const res = await fetch(`${BASE_URL}/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestResult({ service, ok: data.ok, detail: data.detail });
    } catch (e) {
      setTestResult({ service, ok: false, detail: String(e) });
    }
    setTesting(null);
  };

  useEffect(() => {
    fetch(`${BASE_URL}/settings`).then(r => r.json()).then(data => {
      setCfg(prev => ({ ...prev, ...pickDefined(data) }));
      if (data.has_api_key) setHasApiKey(true);
    }).catch(() => {});
  }, []);

  const update = <K extends keyof FullConfig>(key: K, val: FullConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Send all settings — backend saves what it knows, ignores the rest
      const payload: Record<string, unknown> = { ...cfg };
      if (!payload.api_key) payload.api_key = undefined;  // Don't send empty api_key (keeps existing)
      const res = await fetch(`${BASE_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (_e) { }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-9 w-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
          <Settings className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
          <p className="text-xs text-slate-500">Configure all 7 MCP servers</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        {/* Tab navigation */}
        <nav className="md:w-56 shrink-0">
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    active
                      ? "bg-slate-800 text-slate-100 border border-slate-700/60"
                      : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? t.color : ""}`} />
                  <span>{t.label}</span>
                  {active && <ChevronRight className="h-3 w-3 ml-auto hidden md:block" />}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 md:p-6 space-y-5">

            {/* ── LLM Provider ────────────────────────────────────────────── */}
            {tab === "llm" && (
              <>
                <SectionHeader icon={Brain} color="text-violet-400" title="LLM Provider" desc="Configure which language model powers the kernel" />
                <Field label="Provider">
                  <SelectInput value={cfg.provider} onChange={v => update("provider", v)} options={[
                    { value: "echo", label: "None (echo mode)" },
                    { value: "ollama", label: "Ollama (local)" },
                    { value: "openai", label: "OpenAI" },
                    { value: "anthropic", label: "Anthropic" },
                    { value: "groq", label: "Groq" },
                    { value: "cerebras", label: "Cerebras" },
                    { value: "gemini", label: "Google Gemini" },
                    { value: "openai_compatible", label: "OpenAI-compatible" },
                    { value: "sampling", label: "MCP Sampling (client LLM)" },
                  ]} />
                </Field>
                <Field label="Model" hint={{
                  ollama: "e.g., qwen3.5:9b, mistral, llama3.1",
                  openai: "e.g., gpt-4o, gpt-4o-mini",
                  anthropic: "e.g., claude-sonnet-4-20250514, claude-haiku-4-5-20251001",
                  groq: "e.g., llama-3.3-70b-versatile, llama-3.1-8b-instant",
                  cerebras: "e.g., llama-3.3-70b, llama-3.1-8b",
                  gemini: "e.g., gemini-2.0-flash, gemini-2.5-pro, gemini-2.5-flash",
                  openai_compatible: "e.g., mistral-large-latest",
                }[cfg.provider] || "Model name"}>
                  <TextInput value={cfg.model} onChange={v => update("model", v)} placeholder={{
                    ollama: "qwen3.5:9b",
                    openai: "gpt-4o-mini",
                    anthropic: "claude-sonnet-4-20250514",
                    groq: "llama-3.3-70b-versatile",
                    cerebras: "llama-3.3-70b",
                    gemini: "gemini-2.0-flash",
                    openai_compatible: "mistral-large-latest",
                  }[cfg.provider] || "model-name"} />
                </Field>
                {cfg.provider !== "ollama" && cfg.provider !== "echo" && cfg.provider !== "sampling" && (
                  <Field label="API Key" hint={cfg.api_key ? "" : (hasApiKey ? "API key saved on server (leave empty to keep current)" : "")}>
                    <TextInput value={cfg.api_key} onChange={v => update("api_key", v)} type="password" placeholder={hasApiKey ? "••••••••  (saved — leave empty to keep)" : "sk-..."} />
                  </Field>
                )}
                {cfg.provider === "openai_compatible" && (
                  <Field label="Base URL" hint="The /v1/chat/completions endpoint base">
                    <TextInput value={cfg.base_url} onChange={v => update("base_url", v)} placeholder="https://api.example.com/v1" />
                  </Field>
                )}
                {cfg.provider === "ollama" && (
                  <Field label="Base URL" hint="Ollama default: http://localhost:11434">
                    <TextInput value={cfg.base_url} onChange={v => update("base_url", v)} placeholder="http://localhost:11434" />
                  </Field>
                )}
                {cfg.provider === "ollama" && (
                  <>
                    <Field label="Context Window (num_ctx)" hint="Tokens the model can process at once">
                      <NumberInput value={cfg.num_ctx} onChange={v => update("num_ctx", v)} min={2048} max={131072} step={1024} />
                    </Field>
                    <Field label="Keep Alive" hint="How long Ollama keeps the model in memory">
                      <TextInput value={cfg.keep_alive} onChange={v => update("keep_alive", v)} placeholder="30m" />
                    </Field>
                  </>
                )}
                {cfg.provider === "sampling" && (
                  <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg px-4 py-3 text-xs text-blue-300">
                    Sampling mode uses the connected MCP client&apos;s LLM (e.g., VS Code Copilot, Claude Desktop). No API key or model needed.
                  </div>
                )}
                {cfg.provider !== "echo" && cfg.provider !== "sampling" && (
                  <TestBtn service="llm" testing={testing} result={testResult} onClick={() => testConnection("llm")} />
                )}
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
                <Field label="Max Tokens per Task" hint="Token budget across all turns">
                  <NumberInput value={cfg.max_tokens} onChange={v => update("max_tokens", v)} min={256} max={500000} step={1000} />
                </Field>
                <Toggle label="Smart Tool Routing" value={cfg.routing_enabled} onChange={v => update("routing_enabled", v)} />
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
                  <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg px-4 py-3 text-xs text-amber-300">
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
                  RAG settings are configured via environment variables at startup. Changes here show current defaults but require a server restart to take effect. Set <code className="bg-slate-800 px-1 rounded">RAGMCP_EMBEDDER</code> and <code className="bg-slate-800 px-1 rounded">RAGMCP_EMBED_MODEL</code> in your environment.
                </div>
                <Field label="Embedding Model" hint="Currently loaded at startup. Changing requires restart + collection recreation.">
                  <SelectInput value={cfg.rag_embedding_model} onChange={v => update("rag_embedding_model", v)} options={[
                    { value: "BAAI/bge-small-en-v1.5", label: "BGE Small EN (384 dims, 33M params, fast)" },
                    { value: "BAAI/bge-base-en-v1.5", label: "BGE Base EN (768 dims, 110M params, balanced)" },
                    { value: "BAAI/bge-large-en-v1.5", label: "BGE Large EN (1024 dims, 335M params, accurate)" },
                    { value: "sentence-transformers/all-MiniLM-L6-v2", label: "MiniLM L6 (384 dims, 22M params, lightweight)" },
                  ]} />
                </Field>
                <Field label="Chunk Size (tokens)" hint="Size of text chunks for indexing">
                  <NumberInput value={cfg.rag_chunk_size} onChange={v => update("rag_chunk_size", v)} min={128} max={2048} step={64} />
                </Field>
                <Field label="Chunk Overlap (tokens)" hint="Overlap between consecutive chunks">
                  <NumberInput value={cfg.rag_chunk_overlap} onChange={v => update("rag_chunk_overlap", v)} min={0} max={512} step={10} />
                </Field>
                <Field label="Top-K Results" hint="Number of chunks returned per search">
                  <NumberInput value={cfg.rag_top_k} onChange={v => update("rag_top_k", v)} min={1} max={20} />
                </Field>
                <TestBtn service="rag" testing={testing} result={testResult} onClick={() => testConnection("rag")} />
              </>
            )}

            {tab === "infra" && (
              <>
                <SectionHeader icon={HardDrive} color="text-slate-400" title="Infrastructure Backends" desc="Storage backends for each library. Changes require server restart." />
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-3 text-xs text-slate-400">
                  Configure where each library stores its data. Use <code className="bg-slate-800 px-1 rounded">memory</code> for development, <code className="bg-slate-800 px-1 rounded">sqlite</code> for single-server, <code className="bg-slate-800 px-1 rounded">redis</code>/<code className="bg-slate-800 px-1 rounded">qdrant</code> for production.
                  These can also be set via <code className="bg-slate-800 px-1 rounded">kernel_config.yaml</code>.
                </div>

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-2">Memory (memorymcp)</p>
                <Field label="Episodic / Working Store" hint="Where episodes and working memory are stored">
                  <SelectInput value={cfg.memory_backend} onChange={v => update("memory_backend", v)} options={[
                    { value: "memory", label: "In-Memory (dev, volatile)" },
                    { value: "sqlite", label: "SQLite (persistent, single-server)" },
                    { value: "redis", label: "Redis (persistent, multi-server)" },
                  ]} />
                </Field>
                <Field label="Semantic Store (Facts)" hint="Where stored facts persist. Must be persistent or facts are lost on restart.">
                  <SelectInput value={cfg.memory_semantic_backend} onChange={v => update("memory_semantic_backend", v)} options={[
                    { value: "memory", label: "In-Memory (volatile — facts lost on restart!)" },
                    { value: "chroma", label: "ChromaDB (persistent, local, recommended)" },
                    { value: "pgvector", label: "pgvector (PostgreSQL)" },
                  ]} />
                </Field>
                {cfg.memory_backend === "redis" && (
                  <>
                    <Field label="Redis URL" hint="Include password: redis://:password@host:6379/0">
                      <TextInput value={cfg.memory_redis_url} onChange={v => update("memory_redis_url", v)} placeholder="redis://:password@localhost:6379/0" />
                    </Field>
                    <TestBtn service="redis" testing={testing} result={testResult} onClick={() => testConnection("redis")} />
                  </>
                )}
                <Field label="Fact Graph Backend" hint="How fact relations are stored">
                  <SelectInput value={cfg.memory_neo4j_uri ? "neo4j" : "memory"} onChange={v => { if (v === "neo4j") update("memory_neo4j_uri", cfg.memory_neo4j_uri || "bolt://localhost:7687"); else update("memory_neo4j_uri", ""); }} options={[
                    { value: "memory", label: "In-Memory (dev)" },
                    { value: "neo4j", label: "Neo4j (production)" },
                  ]} />
                </Field>
                {cfg.memory_neo4j_uri && (
                  <>
                    <Field label="Neo4j URI" hint="Bolt connection URI">
                      <TextInput value={cfg.memory_neo4j_uri} onChange={v => update("memory_neo4j_uri", v)} placeholder="bolt://localhost:7687" />
                    </Field>
                    <Field label="Neo4j User">
                      <TextInput value={cfg.memory_neo4j_user} onChange={v => update("memory_neo4j_user", v)} placeholder="neo4j" />
                    </Field>
                    <Field label="Neo4j Password">
                      <TextInput value={cfg.memory_neo4j_password} onChange={v => update("memory_neo4j_password", v)} placeholder="password" type="password" />
                    </Field>
                    <TestBtn service="neo4j" testing={testing} result={testResult} onClick={() => testConnection("neo4j", { url: cfg.memory_neo4j_uri, user: cfg.memory_neo4j_user, password: cfg.memory_neo4j_password })} />
                  </>
                )}
                <Field label="Decay Mode" hint="How facts lose relevance over time">
                  <SelectInput value={cfg.memory_decay_mode} onChange={v => update("memory_decay_mode", v)} options={[
                    { value: "exponential", label: "Exponential (default, half-life 7d)" },
                    { value: "linear", label: "Linear (constant decay)" },
                    { value: "anchored", label: "Anchored (never decays)" },
                    { value: "adaptive", label: "Adaptive (slows with retrieval)" },
                  ]} />
                </Field>

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-4">Knowledge (ragmcp)</p>
                <Field label="Vector Store" hint="Where document embeddings are stored">
                  <SelectInput value={cfg.rag_vectorstore} onChange={v => update("rag_vectorstore", v)} options={[
                    { value: "memory", label: "In-Memory (dev, volatile)" },
                    { value: "qdrant", label: "Qdrant (production, recommended)" },
                    { value: "chroma", label: "ChromaDB (local, persistent)" },
                    { value: "pgvector", label: "PostgreSQL + pgvector" },
                    { value: "milvus", label: "Milvus (distributed)" },
                  ]} />
                </Field>
                {["qdrant", "milvus", "pgvector"].includes(cfg.rag_vectorstore) && (
                  <>
                    <Field label="Vector Store URL" hint="Connection URL for the vector database">
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
                <Field label="Graph Store" hint="Knowledge graph backend">
                  <SelectInput value={cfg.rag_graph_backend} onChange={v => update("rag_graph_backend", v)} options={[
                    { value: "networkx", label: "NetworkX (in-memory, dev)" },
                    { value: "neo4j", label: "Neo4j (production, persistent)" },
                  ]} />
                </Field>
                {cfg.rag_graph_backend === "neo4j" && (
                  <>
                    <Field label="Neo4j URI">
                      <TextInput value={cfg.rag_neo4j_uri} onChange={v => update("rag_neo4j_uri", v)} placeholder="bolt://localhost:7687" />
                    </Field>
                    <Field label="Neo4j User">
                      <TextInput value={cfg.rag_neo4j_user} onChange={v => update("rag_neo4j_user", v)} placeholder="neo4j" />
                    </Field>
                    <Field label="Neo4j Password">
                      <TextInput value={cfg.rag_neo4j_password} onChange={v => update("rag_neo4j_password", v)} placeholder="password" type="password" />
                    </Field>
                    <TestBtn service="neo4j" testing={testing} result={testResult} onClick={() => testConnection("neo4j", { url: cfg.rag_neo4j_uri, user: cfg.rag_neo4j_user, password: cfg.rag_neo4j_password })} />
                  </>
                )}

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-4">Workspace / Sandbox / Scheduler</p>
                <Field label="Workspace Audit" hint="Audit log storage">
                  <SelectInput value={cfg.workspace_audit_store} onChange={v => update("workspace_audit_store", v)} options={[
                    { value: "memory", label: "In-Memory" },
                    { value: "sqlite", label: "SQLite (persistent)" },
                  ]} />
                </Field>
                <Field label="Sandbox Vault" hint="Secret storage for code execution">
                  <SelectInput value={cfg.sandbox_vault} onChange={v => update("sandbox_vault", v)} options={[
                    { value: "memory", label: "In-Memory" },
                    { value: "env", label: "Environment Variables" },
                  ]} />
                </Field>
                <Field label="Scheduler Store" hint="Job persistence">
                  <SelectInput value={cfg.scheduler_store} onChange={v => update("scheduler_store", v)} options={[
                    { value: "memory", label: "In-Memory (volatile)" },
                    { value: "sqlite", label: "SQLite (persistent)" },
                  ]} />
                </Field>

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
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-5 py-2.5 text-sm font-medium text-white transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Settings
            </button>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-green-400">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, color, title, desc }: { icon: React.ComponentType<{ className?: string }>; color: string; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 pb-3 border-b border-slate-700/40 mb-2">
      <Icon className={`h-5 w-5 ${color}`} />
      <div>
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
    </div>
  );
}

function pickDefined(obj: Record<string, unknown>): Partial<FullConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<FullConfig>;
}
