"use client";
import { getApiUrl } from "@/lib/api-url";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Settings, Save, Loader2, Cpu, Brain, HardDrive, Shield, Database, Clock, Search,
  Check, ChevronRight, ChevronDown, Plug, CircleCheck, CircleX, Server, Wifi, WifiOff, Wrench, RefreshCw,
  Sparkles, Undo2, AlertTriangle, Zap, Cloud, Monitor, X, ArrowRight, ArrowLeft, Rocket, Radio, Link2, Link2Off, Menu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
// PageHeader replaced by inline header for better mobile layout
import { useBreakpoint } from "@/hooks/useBreakpoint";


// ── Types ──────────────────────────────────────────────────────────────────

interface FullConfig {
  provider: string; model: string; api_key: string; base_url: string;
  max_turns: number; max_tokens: number; max_cost: number; execution_mode: string; routing_enabled: boolean;
  num_ctx: number; keep_alive: string;
  workspace_root: string; tenant_isolation: boolean; max_file_size_mb: number; checkpoint_enabled: boolean;
  host_exec_enabled: boolean; auto_approve: boolean; sandbox_timeout: number; max_output_chars: number;
  memory_importance_threshold: number; memory_max_results: number; memory_default_tags: string;
  scheduler_tick_interval: number; scheduler_max_concurrent: number; scheduler_enabled: boolean;
  rag_chunk_size: number; rag_chunk_overlap: number; rag_top_k: number; rag_embedding_model: string;
  memory_backend: string; memory_semantic_backend: string; memory_redis_url: string; memory_decay_mode: string;
  memory_neo4j_uri: string; memory_neo4j_user: string; memory_neo4j_password: string;
  rag_vectorstore: string; rag_vectorstore_url: string; rag_vectorstore_api_key: string;
  rag_graph_backend: string; rag_neo4j_uri: string; rag_neo4j_user: string; rag_neo4j_password: string;
  workspace_checkpoint_store: string; workspace_audit_store: string;
  sandbox_audit_store: string; sandbox_vault: string; scheduler_store: string;
}

const DEFAULTS: FullConfig = {
  provider: "ollama", model: "qwen3.5:9b", api_key: "", base_url: "",
  max_turns: 10, max_tokens: 50000, max_cost: 1.0, execution_mode: "hybrid", routing_enabled: true,
  num_ctx: 16384, keep_alive: "30m",
  workspace_root: "~/.kernelmcp/workspace", tenant_isolation: true,
  max_file_size_mb: 50, checkpoint_enabled: true,
  host_exec_enabled: true, auto_approve: false, sandbox_timeout: 30, max_output_chars: 5000,
  memory_importance_threshold: 0.5, memory_max_results: 10, memory_default_tags: "",
  scheduler_tick_interval: 15, scheduler_max_concurrent: 5, scheduler_enabled: true,
  rag_chunk_size: 512, rag_chunk_overlap: 50, rag_top_k: 5, rag_embedding_model: "BAAI/bge-small-en-v1.5",
  memory_backend: "sqlite", memory_semantic_backend: "chroma", memory_redis_url: "", memory_decay_mode: "exponential",
  memory_neo4j_uri: "", memory_neo4j_user: "neo4j", memory_neo4j_password: "",
  rag_vectorstore: "qdrant", rag_vectorstore_url: "", rag_vectorstore_api_key: "",
  rag_graph_backend: "networkx",
  rag_neo4j_uri: "", rag_neo4j_user: "neo4j", rag_neo4j_password: "",
  workspace_checkpoint_store: "sqlite", workspace_audit_store: "sqlite",
  sandbox_audit_store: "sqlite", sandbox_vault: "memory", scheduler_store: "sqlite",
};

// ── Presets ────────────────────────────────────────────────────────────────

const PRESETS: Record<string, { label: string; icon: React.ComponentType<{className?: string}>; desc: string; values: Partial<FullConfig> }> = {
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

const TABS = [
  { id: "llm", label: "LLM Provider", icon: Brain, color: "text-violet-400", bg: "bg-violet-400" },
  { id: "engine", label: "Engine", icon: Cpu, color: "text-blue-400", bg: "bg-blue-400" },
  { id: "workspace", label: "Workspace", icon: HardDrive, color: "text-green-400", bg: "bg-green-400" },
  { id: "sandbox", label: "Sandbox & Host", icon: Shield, color: "text-amber-400", bg: "bg-amber-400" },
  { id: "memory", label: "Memory", icon: Database, color: "text-pink-400", bg: "bg-pink-400" },
  { id: "scheduler", label: "Scheduler", icon: Clock, color: "text-cyan-400", bg: "bg-cyan-400" },
  { id: "rag", label: "Knowledge / RAG", icon: Search, color: "text-orange-400", bg: "bg-orange-400" },
  { id: "servers", label: "Servers & MCP", icon: Plug, color: "text-emerald-400", bg: "bg-emerald-400" },
  { id: "tools", label: "Tools", icon: Wrench, color: "text-violet-400", bg: "bg-violet-400" },
  { id: "infra", label: "Infrastructure", icon: HardDrive, color: "text-slate-400", bg: "bg-slate-400" },
  { id: "remote", label: "Remote Kernel", icon: Radio, color: "text-teal-400", bg: "bg-teal-400" },
] as const;

type TabId = typeof TABS[number]["id"];

// Map fields to tabs for dirty tracking
const TAB_FIELDS: Record<TabId, (keyof FullConfig)[]> = {
  llm: ["provider", "model", "api_key", "base_url", "num_ctx", "keep_alive"],
  engine: ["max_turns", "max_tokens", "max_cost", "execution_mode", "routing_enabled"],
  workspace: ["workspace_root", "tenant_isolation", "max_file_size_mb", "checkpoint_enabled"],
  sandbox: ["host_exec_enabled", "auto_approve", "sandbox_timeout", "max_output_chars"],
  memory: ["memory_importance_threshold", "memory_max_results", "memory_default_tags"],
  scheduler: ["scheduler_tick_interval", "scheduler_max_concurrent", "scheduler_enabled"],
  rag: ["rag_chunk_size", "rag_chunk_overlap", "rag_top_k", "rag_embedding_model"],
  tools: [],
  servers: [],
  infra: ["memory_backend", "memory_semantic_backend", "memory_redis_url", "memory_decay_mode", "memory_neo4j_uri", "memory_neo4j_user", "memory_neo4j_password", "rag_vectorstore", "rag_vectorstore_url", "rag_vectorstore_api_key", "rag_graph_backend", "rag_neo4j_uri", "rag_neo4j_user", "rag_neo4j_password", "workspace_checkpoint_store", "workspace_audit_store", "sandbox_audit_store", "sandbox_vault", "scheduler_store"],
  remote: [],
};

// ── Health service definitions ─────────────────────────────────────────────

const HEALTH_SERVICES = [
  { id: "llm", label: "LLM", tab: "llm" as TabId, color: "bg-violet-400" },
  { id: "memory", label: "Memory", tab: "memory" as TabId, color: "bg-pink-400" },
  { id: "rag", label: "RAG", tab: "rag" as TabId, color: "bg-orange-400" },
  { id: "workspace", label: "Workspace", tab: "workspace" as TabId, color: "bg-green-400" },
  { id: "sandbox", label: "Sandbox", tab: "sandbox" as TabId, color: "bg-amber-400" },
  { id: "scheduler", label: "Scheduler", tab: "scheduler" as TabId, color: "bg-cyan-400" },
];

// ── Components ─────────────────────────────────────────────────────────────

const BASE_URL = getApiUrl();

function TestBtn({ service, testing, result, onClick }: { service: string; testing: string | null; result: { service: string; ok: boolean; detail: string } | null; onClick: () => void }) {
  const isThis = testing === service;
  const hasResult = result && result.service === service;
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={!!testing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-slate-800 hover:bg-slate-700 hover:scale-[1.02] active:scale-[0.98] text-slate-300 border border-slate-700/60 disabled:opacity-50"
      >
        {isThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
        {isThis ? "Testing..." : `Test ${service}`}
      </button>
      {hasResult && (
        <span className={`flex items-center gap-1 text-xs animate-fade-in ${result.ok ? "text-green-400" : "text-red-400"}`}>
          {result.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
          {result.detail.slice(0, 80)}
        </span>
      )}
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-400">{label}</label>
      {hint && <p className="text-[10px] text-slate-600 -mt-0.5">{hint}</p>}
      {children}
      {error && <p className="text-[10px] text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{error}</p>}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-slate-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-all duration-200 ${value ? "bg-violet-600 shadow-[0_0_6px_rgba(139,92,246,0.3)]" : "bg-white/[0.06]"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${value ? "translate-x-4" : ""}`} />
      </button>
    </div>
  );
}

function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number" value={value} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all placeholder:text-slate-600"
    />
  );
}

function TextInput({ value, onChange, placeholder, type }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type || "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all placeholder:text-slate-600"
    />
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all"
    >
      {options.map(o => <option key={o.value} value={o.value} className="bg-[#14142a]">{o.label}</option>)}
    </select>
  );
}

function SectionHeader({ icon: Icon, color, title, desc }: { icon: React.ComponentType<{ className?: string }>; color: string; title: string; desc: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2.5 pb-3 border-b border-white/[0.04] mb-2"
    >
      <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <p className="text-[10px] text-slate-500">{desc}</p>
      </div>
    </motion.div>
  );
}

// ── Health Overview Bar ───────────────────────────────────────────────────

function HealthBar({ health, onServiceClick }: { health: Record<string, "ok" | "error" | "unknown">; onServiceClick: (tab: TabId) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.015] border border-white/[0.06] mb-3"
    >
      <Zap className="h-3.5 w-3.5 text-slate-600 shrink-0" />
      <div className="flex items-center gap-1.5 flex-wrap flex-1">
        {HEALTH_SERVICES.map((svc, i) => {
          const status = health[svc.id] || "unknown";
          const dot = status === "ok" ? "bg-emerald-400" : status === "error" ? "bg-red-400 animate-pulse" : "bg-slate-600";
          return (
            <motion.button
              key={svc.id}
              onClick={() => onServiceClick(svc.tab)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 + i * 0.04 }}
              className="group flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.03] transition-all"
              title={`${svc.label}: ${status}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full transition-all ${dot}`} />
              <span className="text-[9px] text-slate-500 group-hover:text-slate-300 transition-colors">{svc.label}</span>
            </motion.button>
          );
        })}
      </div>
      {Object.values(health).filter(v => v === "ok").length === HEALTH_SERVICES.length && (
        <span className="flex items-center gap-1 text-[9px] text-emerald-400 shrink-0">
          <CircleCheck className="h-3 w-3" /> All OK
        </span>
      )}
    </motion.div>
  );
}

// ── Preset Selector ──────────────────────────────────────────────────────

function PresetSelector({ onApply }: { onApply: (values: Partial<FullConfig>) => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-300 bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 hover:border-slate-600/60 transition-all"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        Quick Presets
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-2xl border border-slate-700/60 bg-slate-900/95  shadow-2xl shadow-black/40 p-3 space-y-2 animate-scale-in">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider px-1 mb-2">Apply a configuration preset</p>
          {Object.entries(PRESETS).map(([key, preset]) => {
            const Icon = preset.icon;
            if (confirming === key) {
              return (
                <div key={key} className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3 space-y-2 animate-fade-in">
                  <p className="text-xs text-amber-300">Apply &quot;{preset.label}&quot; preset? This will overwrite current values.</p>
                  <div className="flex gap-2">
                    <button onClick={() => { onApply(preset.values); setConfirming(null); setOpen(false); }} className="text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg hover:bg-amber-500/20 transition-all">
                      Confirm
                    </button>
                    <button onClick={() => setConfirming(null)} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={key}
                onClick={() => setConfirming(key)}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800/80 border border-transparent hover:border-slate-700/50 transition-all text-left group"
              >
                <div className="p-2 rounded-lg bg-slate-800 border border-slate-700/40 group-hover:scale-110 transition-transform">
                  <Icon className="h-4 w-4 text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">{preset.label}</p>
                  <p className="text-[10px] text-slate-500">{preset.desc}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Setup Wizard ─────────────────────────────────────────────────────────

function SetupWizard({ onComplete, onSkip }: { onComplete: (cfg: Partial<FullConfig>) => void; onSkip: () => void }) {
  const [step, setStep] = useState(0);
  const [wizCfg, setWizCfg] = useState<Partial<FullConfig>>({ provider: "ollama", model: "qwen3.5:9b" });
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmOk, setLlmOk] = useState<boolean | null>(null);

  const steps = [
    { title: "LLM Provider", desc: "Choose your AI model" },
    { title: "Test Connection", desc: "Verify it works" },
    { title: "Infrastructure", desc: "Storage backends" },
  ];

  const testLlm = async () => {
    setTestingLlm(true);
    setLlmOk(null);
    try {
      const body: Record<string, string> = { service: "llm", provider: wizCfg.provider || "ollama", model: wizCfg.model || "" };
      if (wizCfg.api_key) body.api_key = wizCfg.api_key;
      if (wizCfg.base_url) body.url = wizCfg.base_url;
      const res = await fetch(`${BASE_URL}/test-connection`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      setLlmOk(data.ok);
    } catch { setLlmOk(false); }
    setTestingLlm(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60  animate-fade-in">
      <div className="w-full max-w-lg mx-4 rounded-3xl border border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Progress */}
        <div className="h-1 bg-slate-800">
          <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>

        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                <Rocket className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-100">Quick Setup</h2>
                <p className="text-xs text-slate-500">Step {step + 1} of {steps.length} — {steps[step].title}</p>
              </div>
            </div>
            <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Skip</button>
          </div>

          {/* Step indicators */}
          <div className="flex gap-2 mb-6">
            {steps.map((s, i) => (
              <div key={i} className={`flex-1 h-1 rounded-full transition-all ${i <= step ? "bg-violet-500" : "bg-slate-700"}`} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 pt-2 min-h-[240px]">
          {step === 0 && (
            <div className="space-y-4 animate-slide-in">
              <Field label="Provider">
                <SelectInput value={wizCfg.provider || "ollama"} onChange={v => setWizCfg({ ...wizCfg, provider: v })} options={[
                  { value: "ollama", label: "Ollama (local, free)" },
                  { value: "openai", label: "OpenAI" },
                  { value: "anthropic", label: "Anthropic" },
                  { value: "groq", label: "Groq (fast, free tier)" },
                  { value: "gemini", label: "Google Gemini" },
                ]} />
              </Field>
              <Field label="Model">
                <TextInput value={wizCfg.model || ""} onChange={v => setWizCfg({ ...wizCfg, model: v })} placeholder="qwen3.5:9b" />
              </Field>
              {wizCfg.provider !== "ollama" && (
                <Field label="API Key">
                  <TextInput value={wizCfg.api_key || ""} onChange={v => setWizCfg({ ...wizCfg, api_key: v })} type="password" placeholder="sk-..." />
                </Field>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 animate-slide-in">
              <div className="text-center py-4">
                <div className={`inline-flex p-4 rounded-2xl mb-4 ${llmOk === true ? "bg-emerald-500/10" : llmOk === false ? "bg-red-500/10" : "bg-slate-800"}`}>
                  {testingLlm ? <Loader2 className="h-8 w-8 text-violet-400 animate-spin" /> :
                   llmOk === true ? <CircleCheck className="h-8 w-8 text-emerald-400" /> :
                   llmOk === false ? <CircleX className="h-8 w-8 text-red-400" /> :
                   <Brain className="h-8 w-8 text-slate-400" />}
                </div>
                <p className="text-sm text-slate-300">
                  {testingLlm ? "Testing connection..." :
                   llmOk === true ? "Connection successful!" :
                   llmOk === false ? "Connection failed. Check your settings." :
                   "Click below to test your LLM connection"}
                </p>
              </div>
              <button onClick={testLlm} disabled={testingLlm} className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-violet-500/20">
                {testingLlm ? "Testing..." : "Test Connection"}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-slide-in">
              <p className="text-xs text-slate-400 mb-3">Choose a profile that matches your setup:</p>
              {Object.entries(PRESETS).map(([key, preset]) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setWizCfg({ ...wizCfg, ...preset.values })}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      wizCfg.memory_backend === preset.values.memory_backend && wizCfg.rag_vectorstore === preset.values.rag_vectorstore
                        ? "border-violet-500/40 bg-violet-500/[0.05]"
                        : "border-slate-700/50 hover:border-slate-600/60 hover:bg-slate-800/40"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-slate-300" />
                    <div>
                      <p className="text-sm font-medium text-slate-200">{preset.label}</p>
                      <p className="text-[10px] text-slate-500">{preset.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex items-center justify-between">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-violet-500/20"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => onComplete(wizCfg)}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-violet-500/20"
            >
              <Rocket className="h-3.5 w-3.5" /> Launch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sticky Save Bar ──────────────────────────────────────────────────────

function StickySaveBar({ dirtyCount, dirtyTabs, saving, onSave, onDiscard }: {
  dirtyCount: number; dirtyTabs: TabId[]; saving: boolean; onSave: () => void; onDiscard: () => void;
}) {
  return (
    <AnimatePresence>
    {dirtyCount > 0 && (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#0f0f1c]/95  border border-violet-500/20 shadow-2xl shadow-violet-500/10">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-400">{dirtyCount}</span>
        <span className="text-[10px] text-slate-300">unsaved</span>
        <div className="flex items-center gap-0.5">
          {dirtyTabs.map(tabId => {
            const t = TABS.find(x => x.id === tabId);
            if (!t) return null;
            return <span key={tabId} className={`h-1.5 w-1.5 rounded-full ${t.bg} opacity-80`} title={t.label} />;
          })}
        </div>
        <div className="h-3 w-px bg-white/[0.06]" />
        <button onClick={onDiscard} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-all">
          <Undo2 className="h-3 w-3" /> Discard
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-[10px] font-medium text-violet-300 transition-all"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </button>
      </div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [cfg, setCfg] = useState<FullConfig>(DEFAULTS);
  const [savedCfg, setSavedCfg] = useState<FullConfig>(DEFAULTS);
  const [tab, setTab] = useState<TabId>("llm");
  const [navOpen, setNavOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ service: string; ok: boolean; detail: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [health, setHealth] = useState<Record<string, "ok" | "error" | "unknown">>({});
  const [prevTab, setPrevTab] = useState<TabId>("llm");
  const [animDir, setAnimDir] = useState<"left" | "right">("right");
  const contentRef = useRef<HTMLDivElement>(null);

  // Remote Kernel state
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteTesting, setRemoteTesting] = useState(false);
  const [remoteTestResult, setRemoteTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem("kernelmcp_remote") || "{}");
      if (r.enabled && r.url) { setRemoteEnabled(true); setRemoteUrl(r.url); }
    } catch {}
  }, []);

  const saveRemote = () => {
    const url = remoteUrl.trim().replace(/\/$/, "");
    if (!url) return;
    localStorage.setItem("kernelmcp_remote", JSON.stringify({ enabled: true, url }));
    window.location.reload();
  };

  const clearRemote = () => {
    localStorage.removeItem("kernelmcp_remote");
    window.location.reload();
  };

  const testRemote = async () => {
    const url = remoteUrl.trim().replace(/\/$/, "");
    if (!url) return;
    setRemoteTesting(true);
    setRemoteTestResult(null);
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      setRemoteTestResult({ ok: r.ok, detail: data.status || `HTTP ${r.status}` });
    } catch (e) {
      setRemoteTestResult({ ok: false, detail: String(e).slice(0, 100) });
    }
    setRemoteTesting(false);
  };

  // Constitution state
  const [constitution, setConstitution] = useState("");
  const [constitutionSaved, setConstitutionSaved] = useState(false);
  const [savingConstitution, setSavingConstitution] = useState(false);

  // Servers state
  interface ServerData { name: string; connected: boolean; tools: number; tool_list?: string[] }
  const [servers, setServers] = useState<ServerData[]>([]);
  const [serverExpanded, setServerExpanded] = useState<Record<string, boolean>>({});
  const [serversLoading, setServersLoading] = useState(false);

  const SERVER_DESCRIPTIONS: Record<string, string> = {
    memorymcp: "Persistent fact storage with semantic recall, importance scoring, and tag-based filtering",
    planningmcp: "Task planning, LTP compiler, step graphs, ON_FAIL strategies, FOREACH loops",
    workspacemcp: "Sandboxed file system with tenant isolation, checkpoints, search, and move operations",
    sandboxmcp: "Docker code execution, web search (SearXNG), browser fetch (Playwright), host commands",
    schedulermcp: "Job scheduling: once, cron, interval, and watch (event-driven with conditions)",
    ragmcp: "Document ingestion, chunking, embedding (FastEmbed), and semantic search",
  };

  // ── Dirty tracking ────────────────────────────────────────────────────

  const dirtyFields = useMemo(() => {
    const fields: (keyof FullConfig)[] = [];
    for (const key of Object.keys(cfg) as (keyof FullConfig)[]) {
      if (cfg[key] !== savedCfg[key]) fields.push(key);
    }
    return fields;
  }, [cfg, savedCfg]);

  const dirtyTabs = useMemo(() => {
    const tabs: TabId[] = [];
    for (const [tabId, fields] of Object.entries(TAB_FIELDS)) {
      if (fields.some(f => dirtyFields.includes(f))) tabs.push(tabId as TabId);
    }
    return tabs;
  }, [dirtyFields]);

  // ── Health check ──────────────────────────────────────────────────────

  const checkHealth = useCallback(async () => {
    const results: Record<string, "ok" | "error" | "unknown"> = {};
    try {
      const promises = HEALTH_SERVICES.map(async svc => {
        try {
          const r = await fetch(`${BASE_URL}/test-connection`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ service: svc.id }),
          });
          const data = await r.json();
          results[svc.id] = data.ok ? "ok" : "error";
        } catch { results[svc.id] = "unknown"; }
      });
      await Promise.all(promises);
    } catch { /* ignore */ }
    setHealth(results);
  }, []);

  // ── Tab animation ─────────────────────────────────────────────────────

  const switchTab = (newTab: TabId) => {
    const oldIdx = TABS.findIndex(t => t.id === tab);
    const newIdx = TABS.findIndex(t => t.id === newTab);
    setAnimDir(newIdx > oldIdx ? "right" : "left");
    setPrevTab(tab);
    setTab(newTab);
  };

  // ── Loaders ───────────────────────────────────────────────────────────

  const loadServers = async () => {
    setServersLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/servers`);
      if (r.ok) {
        const data = await r.json();
        const list: ServerData[] = Object.entries(data.servers || {}).map(([name, info]: [string, unknown]) => {
          const i = info as { connected: boolean; tools: number; tool_names?: string[] };
          return { name, connected: i.connected, tools: i.tools, tool_list: i.tool_names };
        });
        setServers(list.sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch { /* ignore */ }
    setServersLoading(false);
  };

  const saveConstitutionHandler = async () => {
    setSavingConstitution(true);
    setConstitutionSaved(false);
    try {
      const r = await fetch(`${BASE_URL}/constitution`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: constitution }),
      });
      const c = await r.json();
      setConstitution(c.rules);
      setConstitutionSaved(true);
      setTimeout(() => setConstitutionSaved(false), 3000);
    } catch { /* ignore */ }
    setSavingConstitution(false);
  };

  const testConnection = async (service: string, params: Record<string, string> = {}) => {
    setTesting(service);
    setTestResult(null);
    try {
      const body: Record<string, string> = { service, ...params };
      if (service === "llm") {
        body.model = cfg.model; body.provider = cfg.provider;
        if (cfg.api_key) body.api_key = cfg.api_key;
        if (cfg.base_url) body.url = cfg.base_url;
      } else if (service === "redis") { body.url = cfg.memory_redis_url; }
      else if (service === "neo4j") {
        body.url = params.url || cfg.memory_neo4j_uri || cfg.rag_neo4j_uri;
        body.user = params.user || cfg.memory_neo4j_user || cfg.rag_neo4j_user;
        body.password = params.password || cfg.memory_neo4j_password || cfg.rag_neo4j_password;
      } else if (service === "qdrant") {
        body.url = cfg.rag_vectorstore_url;
        if (cfg.rag_vectorstore_api_key) body.api_key = cfg.rag_vectorstore_api_key;
      } else if (service === "pgvector" || service === "milvus") { body.url = cfg.rag_vectorstore_url; }
      const res = await fetch(`${BASE_URL}/test-connection`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestResult({ service, ok: data.ok, detail: data.detail });
    } catch (e) { setTestResult({ service, ok: false, detail: String(e) }); }
    setTesting(null);
  };

  useEffect(() => {
    fetch(`${BASE_URL}/settings`).then(r => r.json()).then(data => {
      const merged = { ...DEFAULTS, ...pickDefined(data) };
      setCfg(merged);
      setSavedCfg(merged);
      if (data.has_api_key) setHasApiKey(true);
      // Show wizard if config looks like defaults (first launch)
      if (!data.provider && !data.model && !data.has_api_key) setShowWizard(true);
    }).catch(() => {});
    fetch(`${BASE_URL}/constitution`).then(r => r.json()).then(c => setConstitution(c.rules || "")).catch(() => {});
    loadServers();
    checkHealth();
    // Poll health every 30s
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const update = <K extends keyof FullConfig>(key: K, val: FullConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...cfg };
      if (!payload.api_key) payload.api_key = undefined;
      const res = await fetch(`${BASE_URL}/settings`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedCfg({ ...cfg });
      checkHealth();
    } catch (_e) { }
    setSaving(false);
  };

  const handleDiscard = () => setCfg({ ...savedCfg });

  const applyPreset = (values: Partial<FullConfig>) => setCfg(prev => ({ ...prev, ...values }));

  const handleWizardComplete = (wizCfg: Partial<FullConfig>) => {
    setCfg(prev => ({ ...prev, ...wizCfg }));
    setShowWizard(false);
  };

  const currentTabObj = TABS.find(t => t.id === tab);

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden">
      {/* Setup Wizard */}
      {showWizard && <SetupWizard onComplete={handleWizardComplete} onSkip={() => setShowWizard(false)} />}

      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 shrink-0 border-b border-white/[0.04]">
        {/* Nav menu (mobile) */}
        <button
          onClick={() => {
            const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
            if (btn) btn.click();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <Settings className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight truncate">Settings</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Configure LLM, engine, storage & servers</p>
        </div>
        <PresetSelector onApply={applyPreset} />
      </div>

      {/* Health Overview */}
      <div className="px-3 sm:px-4 shrink-0">
        <HealthBar health={health} onServiceClick={(t) => { switchTab(t); setNavOpen(false); }} />
      </div>

      {/* Mobile tab selector */}
      {isMobileOrTablet && (
        <div className="px-3 pb-1.5 shrink-0 flex items-center gap-2">
          <button
            onClick={() => setNavOpen(!navOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs font-medium text-slate-300 hover:bg-white/[0.05] transition-all touch-target flex-1"
          >
            {currentTabObj && <currentTabObj.icon className={`h-3.5 w-3.5 ${currentTabObj.color}`} />}
            <span>{currentTabObj?.label || "Select"}</span>
            <ChevronDown className={`h-3 w-3 ml-auto text-slate-500 transition-transform ${navOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}

      {/* Mobile nav dropdown */}
      <AnimatePresence>
        {isMobileOrTablet && navOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-3 pb-2 shrink-0 overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1.5 rounded-xl border border-white/[0.06] bg-white/[0.015]">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                const isDirty = dirtyTabs.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => { switchTab(t.id); setNavOpen(false); }}
                    className={`relative flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-[11px] font-medium transition-colors touch-target ${
                      active ? "bg-violet-500/10 text-violet-300 border border-violet-500/20" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] border border-transparent"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? t.color : ""}`} />
                    <span className="truncate">{t.label}</span>
                    {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 px-3 sm:px-4 pb-2 flex gap-3">
        {/* Tab navigation — persistent left sidebar (desktop only) */}
        {!isMobileOrTablet && (
        <nav className="w-48 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col p-1.5 overflow-y-auto">
          {TABS.map((t, i) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const isDirty = dirtyTabs.includes(t.id);
            return (
              <motion.button
                key={t.id}
                onClick={() => switchTab(t.id)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`relative flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                  active ? "text-violet-300" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="settings-tab-bg"
                    className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-lg -z-10"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon className={`h-3.5 w-3.5 transition-colors ${active ? t.color : ""}`} />
                <span>{t.label}</span>
                {isDirty && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                  />
                )}
              </motion.button>
            );
          })}
        </nav>
        )}

        {/* Tab content */}
        <div className="flex-1 min-w-0 min-h-0 rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-y-auto">
          <AnimatePresence mode="wait">
          <motion.div
            ref={contentRef}
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="p-4 md:p-5 space-y-4"
          >

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
                    ollama: "qwen3.5:9b", openai: "gpt-4o-mini", anthropic: "claude-sonnet-4-20250514",
                    groq: "llama-3.3-70b-versatile", cerebras: "llama-3.3-70b", gemini: "gemini-2.0-flash",
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
                  <>
                    <Field label="Base URL" hint="Ollama default: http://localhost:11434">
                      <TextInput value={cfg.base_url} onChange={v => update("base_url", v)} placeholder="http://localhost:11434" />
                    </Field>
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
                <Field label="Max Cost per Task ($)" hint="Task stops when cost exceeds this amount">
                  <NumberInput value={cfg.max_cost} onChange={v => update("max_cost", v)} min={0.01} max={100} step={0.1} />
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
                <Field label="Top-K Results" hint="Number of chunks returned per search">
                  <NumberInput value={cfg.rag_top_k} onChange={v => update("rag_top_k", v)} min={1} max={20} />
                </Field>
                <TestBtn service="rag" testing={testing} result={testResult} onClick={() => testConnection("rag")} />
              </>
            )}

            {/* ── Servers ────────────────────────────────────────────────── */}
            {tab === "servers" && (
              <>
                <SectionHeader icon={Server} color="text-emerald-400" title="MCP Servers" desc="Connected servers, tool count, and health status" />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] text-slate-500">
                    {servers.filter(s => s.connected).length}/{servers.length} servers connected &middot; {servers.reduce((s, srv) => s + srv.tools, 0)} tools available
                  </span>
                  <button onClick={loadServers} disabled={serversLoading} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] border border-white/[0.06] rounded-lg transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]">
                    <RefreshCw className={`h-3 w-3 ${serversLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
                <div className="space-y-2">
                  {servers.map(srv => {
                    const isOpen = serverExpanded[srv.name] || false;
                    return (
                      <div key={srv.name} className={`rounded-xl border overflow-hidden transition-all duration-200 ${srv.connected ? "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.1]" : "border-red-500/10 bg-red-500/[0.02]"}`}>
                        <button
                          onClick={() => setServerExpanded(prev => ({ ...prev, [srv.name]: !prev[srv.name] }))}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                          <Server className={`h-3.5 w-3.5 ${srv.connected ? "text-violet-400" : "text-slate-600"}`} />
                          <span className="font-medium text-[13px] text-slate-200">{srv.name}</span>
                          <div className="flex-1" />
                          <span className="text-[10px] text-slate-500 mr-2">{srv.tools} tools</span>
                          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            srv.connected
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15"
                              : "bg-red-500/10 text-red-400 border border-red-500/15"
                          }`}>
                            {srv.connected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                            {srv.connected ? "online" : "offline"}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-3 border-t border-white/[0.04] animate-fade-in">
                            <p className="text-[11px] text-slate-500 mt-2.5 mb-2.5">{SERVER_DESCRIPTIONS[srv.name] || "MCP server"}</p>
                            {srv.tool_list && srv.tool_list.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {srv.tool_list.map(tool => (
                                  <span key={tool} className="flex items-center gap-1 bg-violet-500/8 text-violet-400 text-[10px] px-2 py-0.5 rounded-md border border-violet-500/15 font-mono">
                                    <Wrench className="h-2.5 w-2.5" />{tool}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-600 italic">Tool list not available</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {servers.length === 0 && !serversLoading && (
                    <p className="text-[11px] text-slate-600 text-center py-8">No servers found. Check that the backend is running.</p>
                  )}
                </div>

                {/* Marketplace */}
                <MarketplaceSection />
              </>
            )}

            {/* ── Tools ──────────────────────────────────────────────── */}
            {tab === "tools" && <ToolsPanel />}

            {/* ── Infrastructure ─────────────────────────────────────────── */}
            {tab === "infra" && (
              <>
                <SectionHeader icon={HardDrive} color="text-slate-400" title="Infrastructure Backends" desc="Storage backends for each library. Changes require server restart." />
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-3 text-xs text-slate-400">
                  Configure where each library stores its data. Use <code className="bg-slate-800 px-1 rounded">memory</code> for development, <code className="bg-slate-800 px-1 rounded">sqlite</code> for single-server, <code className="bg-slate-800 px-1 rounded">redis</code>/<code className="bg-slate-800 px-1 rounded">qdrant</code> for production.
                </div>

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-2">Memory (memorymcp)</p>
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
                <Field label="Fact Graph Backend">
                  <SelectInput value={cfg.memory_neo4j_uri ? "neo4j" : "memory"} onChange={v => { if (v === "neo4j") update("memory_neo4j_uri", cfg.memory_neo4j_uri || "bolt://localhost:7687"); else update("memory_neo4j_uri", ""); }} options={[
                    { value: "memory", label: "In-Memory (dev)" },
                    { value: "neo4j", label: "Neo4j (production)" },
                  ]} />
                </Field>
                {cfg.memory_neo4j_uri && (
                  <>
                    <Field label="Neo4j URI"><TextInput value={cfg.memory_neo4j_uri} onChange={v => update("memory_neo4j_uri", v)} placeholder="bolt://localhost:7687" /></Field>
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

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-4">Knowledge (ragmcp)</p>
                <Field label="Vector Store">
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
                    <Field label="Vector Store URL">
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
                <Field label="Graph Store">
                  <SelectInput value={cfg.rag_graph_backend} onChange={v => update("rag_graph_backend", v)} options={[
                    { value: "networkx", label: "NetworkX (in-memory)" },
                    { value: "neo4j", label: "Neo4j (persistent)" },
                  ]} />
                </Field>
                {cfg.rag_graph_backend === "neo4j" && (
                  <>
                    <Field label="Neo4j URI"><TextInput value={cfg.rag_neo4j_uri} onChange={v => update("rag_neo4j_uri", v)} placeholder="bolt://localhost:7687" /></Field>
                    <Field label="Neo4j User"><TextInput value={cfg.rag_neo4j_user} onChange={v => update("rag_neo4j_user", v)} placeholder="neo4j" /></Field>
                    <Field label="Neo4j Password"><TextInput value={cfg.rag_neo4j_password} onChange={v => update("rag_neo4j_password", v)} placeholder="password" type="password" /></Field>
                    <TestBtn service="neo4j" testing={testing} result={testResult} onClick={() => testConnection("neo4j", { url: cfg.rag_neo4j_uri, user: cfg.rag_neo4j_user, password: cfg.rag_neo4j_password })} />
                  </>
                )}

                <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-4">Workspace / Sandbox / Scheduler</p>
                <Field label="Workspace Audit">
                  <SelectInput value={cfg.workspace_audit_store} onChange={v => update("workspace_audit_store", v)} options={[
                    { value: "memory", label: "In-Memory" }, { value: "sqlite", label: "SQLite" },
                  ]} />
                </Field>
                <Field label="Sandbox Vault">
                  <SelectInput value={cfg.sandbox_vault} onChange={v => update("sandbox_vault", v)} options={[
                    { value: "memory", label: "In-Memory" }, { value: "env", label: "Environment Variables" },
                  ]} />
                </Field>
                <Field label="Scheduler Store">
                  <SelectInput value={cfg.scheduler_store} onChange={v => update("scheduler_store", v)} options={[
                    { value: "memory", label: "In-Memory" }, { value: "sqlite", label: "SQLite" },
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

            {/* ── Remote Kernel ─────────────────────────────────────────────── */}
            {tab === "remote" && (
              <>
                <SectionHeader icon={Radio} color="text-teal-400" title="Remote Kernel" desc="Connect this dashboard to an external kernelmcp instance" />

                {/* Current state banner */}
                {remoteEnabled ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-500/10 border border-teal-500/20">
                    <Radio className="h-4 w-4 text-teal-400 animate-pulse shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-teal-300">Listening to remote kernel</p>
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
                    <p className="text-xs text-slate-400">Using local kernel (default)</p>
                  </div>
                )}

                <div className="space-y-4 pt-2">
                  <Field label="Remote Kernel URL" hint="Base URL of the kernelmcp API you want to observe (e.g. http://my-server:8000)">
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
                        {remoteTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
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
                    <Link2 className="h-4 w-4" />
                    {remoteEnabled ? "Reconnect to new URL" : "Connect & Reload"}
                  </button>

                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 space-y-2">
                    <p className="text-xs font-medium text-slate-300">How it works</p>
                    <ul className="space-y-1.5 text-[11px] text-slate-500">
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>All API calls (audit, memory, traces, security, scheduler…) are forwarded to the remote URL</li>
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>The remote kernel must have CORS enabled for this dashboard&apos;s origin</li>
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>LLM config and settings changes will apply to the remote kernel</li>
                      <li className="flex items-start gap-2"><span className="text-teal-500 mt-0.5">•</span>Disconnect to return to the local kernel</li>
                    </ul>
                  </div>
                </div>
              </>
            )}
          </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Sticky Save Bar */}
      <StickySaveBar
        dirtyCount={dirtyFields.length}
        dirtyTabs={dirtyTabs}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  );
}

// ── Tools Panel ───────────────────────────────────────────────────────────

function ToolsPanel() {
  const [tools, setTools] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connectForm, setConnectForm] = useState<{name: string; transport: string; command: string; url: string} | null>(null);
  const [lcForm, setLcForm] = useState<{module: string; className: string} | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadTools = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/tools`);
      if (r.ok) setTools(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadTools(); }, []);

  const connectMCP = async () => {
    if (!connectForm) return;
    setActionLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/tools/mcp/connect`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connectForm),
      });
      if (!r.ok) throw new Error(await r.text());
      setConnectForm(null);
      loadTools();
    } catch (e) { alert(String(e)); }
    setActionLoading(false);
  };

  const disconnectMCP = async (name: string) => {
    try { await fetch(`${BASE_URL}/tools/mcp/${encodeURIComponent(name)}`, { method: "DELETE" }); loadTools(); } catch {}
  };

  const registerLC = async () => {
    if (!lcForm) return;
    setActionLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/tools/langchain/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: lcForm.module, "class": lcForm.className }),
      });
      if (!r.ok) throw new Error(await r.text());
      setLcForm(null);
      loadTools();
    } catch (e) { alert(String(e)); }
    setActionLoading(false);
  };

  const unregisterLC = async (name: string) => {
    try { await fetch(`${BASE_URL}/tools/langchain/${encodeURIComponent(name)}`, { method: "DELETE" }); loadTools(); } catch {}
  };

  const MCP_CATALOG = [
    { name: "github", command: "npx @modelcontextprotocol/server-github", desc: "Issues, PRs, code search", env: "GITHUB_TOKEN" },
    { name: "slack", command: "npx @modelcontextprotocol/server-slack", desc: "Messages, channels", env: "SLACK_TOKEN" },
    { name: "postgres", command: "npx @modelcontextprotocol/server-postgres", desc: "SQL queries", env: "DATABASE_URL" },
    { name: "brave-search", command: "npx @modelcontextprotocol/server-brave-search", desc: "Web search via Brave", env: "BRAVE_API_KEY" },
    { name: "puppeteer", command: "npx @modelcontextprotocol/server-puppeteer", desc: "Browser automation", env: "" },
    { name: "filesystem", command: "npx @modelcontextprotocol/server-filesystem", desc: "Local file access", env: "" },
    { name: "google-drive", command: "npx @anthropic/server-google-drive", desc: "Google Drive files", env: "GOOGLE_CREDENTIALS" },
    { name: "notion", command: "npx @anthropic/server-notion", desc: "Notion pages & databases", env: "NOTION_TOKEN" },
  ];

  const LC_CATALOG = [
    { name: "Wikipedia", module: "langchain_community.tools.wikipedia.tool", className: "WikipediaQueryRun" },
    { name: "Arxiv", module: "langchain_community.tools.arxiv.tool", className: "ArxivQueryRun" },
    { name: "DuckDuckGo", module: "langchain_community.tools.ddg_search.tool", className: "DuckDuckGoSearchRun" },
    { name: "YouTube Transcript", module: "langchain_community.tools.youtube.search", className: "YouTubeSearchTool" },
  ];

  if (loading) return <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="h-16 rounded-xl bg-slate-800/40 animate-pulse" />)}</div>;

  return (
    <>
      <SectionHeader icon={Wrench} color="text-violet-400" title="Tool Library" desc="Built-in, MCP servers, and LangChain community tools" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { count: tools?.built_in?.count || 0, label: "Built-in", color: "text-violet-400" },
          { count: tools?.mcp_external?.count || 0, label: "MCP External", color: "text-cyan-400" },
          { count: tools?.langchain?.count || 0, label: "LangChain", color: "text-amber-400" },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3 text-center hover:bg-white/[0.03] transition-colors">
            <p className={`text-lg font-bold ${stat.color}`}>{stat.count}</p>
            <p className="text-[10px] text-slate-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Connected MCP Servers */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300">MCP Servers</h3>
          <button onClick={() => setConnectForm({ name: "", transport: "stdio", command: "", url: "" })} className="text-[10px] text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-2.5 py-1 rounded-lg transition-all hover:scale-[1.02]">
            + Connect
          </button>
        </div>

        {Object.entries(tools?.mcp_servers || {}).map(([name, info]: [string, any]) => (
          <div key={name} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 hover:border-white/[0.1] transition-all">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-slate-200">{name}</span>
            <span className="text-[9px] text-slate-500">{info.tools} tools</span>
            <button onClick={() => disconnectMCP(name)} className="text-[10px] text-slate-600 hover:text-red-400 ml-auto transition-colors">Disconnect</button>
          </div>
        ))}

        {connectForm && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3 space-y-2 animate-fade-in">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Server Name"><TextInput value={connectForm.name} onChange={v => setConnectForm({...connectForm, name: v})} placeholder="github" /></Field>
              <Field label="Transport">
                <SelectInput value={connectForm.transport} onChange={v => setConnectForm({...connectForm, transport: v})} options={[{value:"stdio",label:"Stdio (command)"},{value:"sse",label:"SSE (URL)"}]} />
              </Field>
            </div>
            {connectForm.transport === "stdio" ? (
              <Field label="Command"><TextInput value={connectForm.command} onChange={v => setConnectForm({...connectForm, command: v})} placeholder="npx @modelcontextprotocol/server-github" /></Field>
            ) : (
              <Field label="URL"><TextInput value={connectForm.url} onChange={v => setConnectForm({...connectForm, url: v})} placeholder="http://localhost:3001/sse" /></Field>
            )}
            <div className="flex gap-2">
              <button onClick={connectMCP} disabled={actionLoading || !connectForm.name} className="text-[10px] font-medium text-violet-400 bg-violet-500/8 border border-violet-500/15 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-violet-500/15 transition-all">
                {actionLoading ? "Connecting..." : "Connect"}
              </button>
              <button onClick={() => setConnectForm(null)} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* LangChain Tools */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300">LangChain Tools</h3>
          <button onClick={() => setLcForm({ module: "", className: "" })} className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/8 border border-amber-500/15 px-2.5 py-1 rounded-lg transition-all hover:scale-[1.02]">
            + Import
          </button>
        </div>

        {(tools?.langchain?.tools || []).map((t: any) => (
          <div key={t.name} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 hover:border-white/[0.1] transition-all">
            <span className="text-[11px] font-mono text-amber-300">{t.name}</span>
            <span className="text-[9px] text-slate-500 truncate flex-1">{t.description}</span>
            <button onClick={() => unregisterLC(t.name)} className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">Remove</button>
          </div>
        ))}

        {lcForm && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3 space-y-2 animate-fade-in">
            <Field label="Module Path"><TextInput value={lcForm.module} onChange={v => setLcForm({...lcForm, module: v})} placeholder="langchain_community.tools.wikipedia.tool" /></Field>
            <Field label="Class Name"><TextInput value={lcForm.className} onChange={v => setLcForm({...lcForm, className: v})} placeholder="WikipediaQueryRun" /></Field>
            <div className="flex gap-2">
              <button onClick={registerLC} disabled={actionLoading || !lcForm.module || !lcForm.className} className="text-[10px] font-medium text-amber-400 bg-amber-500/8 border border-amber-500/15 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-amber-500/15 transition-all">
                {actionLoading ? "Importing..." : "Import"}
              </button>
              <button onClick={() => setLcForm(null)} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Catalog */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-300">Popular Tools</h3>

        <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-2 mb-1">MCP Servers</p>
        <div className="grid grid-cols-1 gap-1.5">
          {MCP_CATALOG.map(srv => {
            const isConnected = Object.keys(tools?.mcp_servers || {}).includes(srv.name);
            return (
              <div key={srv.name} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 hover:border-white/[0.1] transition-all">
                <span className="text-[11px] font-medium text-slate-200 w-24">{srv.name}</span>
                <span className="text-[9px] text-slate-500 flex-1">{srv.desc}</span>
                {srv.env && <span className="text-[8px] text-slate-600 font-mono">{srv.env}</span>}
                {isConnected ? (
                  <span className="text-[9px] text-emerald-400">Connected</span>
                ) : (
                  <button onClick={() => setConnectForm({ name: srv.name, transport: "stdio", command: srv.command, url: "" })} className="text-[9px] text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-2 py-0.5 rounded transition-all hover:scale-[1.05]">
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-3 mb-1">LangChain Community</p>
        <div className="grid grid-cols-1 gap-1.5">
          {LC_CATALOG.map(lc => {
            const isRegistered = (tools?.langchain?.tools || []).some((t: any) => t.name.includes(lc.name.toLowerCase()));
            return (
              <div key={lc.name} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 hover:border-white/[0.1] transition-all">
                <span className="text-[11px] font-medium text-slate-200 w-24">{lc.name}</span>
                <span className="text-[9px] text-slate-500 font-mono flex-1 truncate">{lc.module}</span>
                {isRegistered ? (
                  <span className="text-[9px] text-emerald-400">Imported</span>
                ) : (
                  <button onClick={() => setLcForm({ module: lc.module, className: lc.className })} className="text-[9px] text-amber-400 hover:text-amber-300 bg-amber-500/8 border border-amber-500/15 px-2 py-0.5 rounded transition-all hover:scale-[1.05]">
                    Import
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <button onClick={loadTools} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Refresh tool list</button>
      </div>
    </>
  );
}

// ── Marketplace Section ─────────────────────────────────────────────────────

function MarketplaceSection() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [results, setResults] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [featured, setFeatured] = useState<any>(null);

  // Load featured on mount
  useEffect(() => {
    fetch(`${BASE_URL}/marketplace/featured`).then(r => r.json()).then(setFeatured).catch(() => {});
    fetch(`${BASE_URL}/marketplace/categories`).then(r => r.json()).then(d => setCategories(d.categories || [])).catch(() => {});
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, category });
      const res = await fetch(`${BASE_URL}/marketplace/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {}
    setLoading(false);
  }, [query, category]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(search, 300);
    return () => clearTimeout(t);
  }, [query, category]); // eslint-disable-line

  const showResults = query || category !== "all";
  const items = showResults ? results : [
    ...(featured?.mcp_servers || []),
    ...(featured?.langchain_tools || []),
  ];

  return (
    <div className="mt-6">
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
        <SectionHeader icon={Search} color="text-cyan-400" title="Marketplace" desc="Browse and install MCP servers and LangChain tools" />

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search servers and tools..."
            className="w-full pl-8 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 bg-white/[0.03] border border-white/[0.06] rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap gap-1 mb-3">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-2 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
                category === cat.id
                  ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300"
                  : "border-white/[0.04] text-slate-500 hover:text-slate-300"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {items.map((item: any, i: number) => (
            <motion.div
              key={`${item.name}-${item.type}`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-start gap-2.5 p-3 rounded-lg border border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] transition-all group"
            >
              <div className={`p-1.5 rounded-md shrink-0 ${item.type === "mcp" ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                {item.type === "mcp" ? (
                  <Plug className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Wrench className="h-3.5 w-3.5 text-amber-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-200">{item.title || item.name}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded ${
                    item.type === "mcp" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {item.type === "mcp" ? "MCP" : "LC"}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
                {item.env && item.env.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[8px] text-slate-600">Requires:</span>
                    {item.env.map((e: string) => (
                      <span key={e} className="text-[8px] text-amber-400/70 bg-amber-500/5 px-1 rounded">{e}</span>
                    ))}
                  </div>
                )}
              </div>
              <button className="shrink-0 px-2 py-1 text-[9px] font-medium text-cyan-400 bg-cyan-500/5 border border-cyan-500/15 rounded-md opacity-0 group-hover:opacity-100 transition-all hover:bg-cyan-500/10">
                Install
              </button>
            </motion.div>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          </div>
        )}

        {!loading && items.length === 0 && query && (
          <div className="text-center py-6 text-[10px] text-slate-500">
            No results for &quot;{query}&quot;
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pickDefined(obj: Record<string, unknown>): Partial<FullConfig> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as Partial<FullConfig>;
}
