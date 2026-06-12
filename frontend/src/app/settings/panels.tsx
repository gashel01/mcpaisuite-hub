"use client";
import { apiFetch } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Settings, Save, Cpu, Brain, HardDrive, Shield, Database, Clock, Search,
  Check, ChevronRight, ChevronDown, Plug, CircleCheck, CircleX, Server, Wifi, WifiOff, Wrench, RefreshCw,
  KeyRound, Eye, EyeOff, Copy, Trash2, Plus,
  Sparkles, Undo2, AlertTriangle, Zap, Cloud, Monitor, X, ArrowRight, ArrowLeft, Rocket, Link2Off, Menu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
// PageHeader replaced by inline header for better mobile layout
import { useBreakpoint } from "@/hooks/useBreakpoint";
import ConnectionsManager from "@/components/connections-manager";
import Link from "next/link";
import { TestBtn, Field, Toggle, NumberInput, TextInput, SelectInput, SectionHeader, AdvancedDisclosure } from "./_ui";
import EnvPanel from "./EnvPanel";
import ToolsPanel from "./ToolsPanel";
import { DEFAULTS, PRESETS, TABS, TAB_FIELDS, HEALTH_SERVICES } from "./config";
import type { FullConfig, TabId } from "./config";

export function HealthBar({ health, onServiceClick, toolCount, toolsOpen, onToggleTools }: { health: Record<string, "ok" | "error" | "unknown">; onServiceClick: (tab: TabId) => void; toolCount?: number; toolsOpen?: boolean; onToggleTools?: () => void }) {
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
      {onToggleTools && (
        <button
          onClick={onToggleTools}
          title="Show each server's tools"
          className="flex items-center gap-1 text-[9px] font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-md px-2 py-1 transition-colors shrink-0"
        >
          <Server className="h-3 w-3 text-violet-400" />
          {toolCount ?? 0} tools
          <ChevronDown className={`h-3 w-3 transition-transform ${toolsOpen ? "rotate-180" : ""}`} />
        </button>
      )}
    </motion.div>
  );
}

// ── Preset Selector ──────────────────────────────────────────────────────

export function PresetSelector({ onApply }: { onApply: (values: Partial<FullConfig>) => void }) {
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

export function SetupWizard({ onComplete, onSkip }: { onComplete: (cfg: Partial<FullConfig>) => void; onSkip: () => void }) {
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
      const data = await apiFetch<any>("/test-connection", { method: "POST", body });
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
                  {testingLlm ? <Spinner className="h-8 w-8 text-violet-400" /> :
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

export function StickySaveBar({ dirtyCount, dirtyTabs, saving, onSave, onDiscard }: {
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
          {saving ? <Spinner className="h-3 w-3" /> : <Save className="h-3 w-3" />}
          Save
        </button>
      </div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
