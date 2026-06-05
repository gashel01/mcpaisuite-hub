"use client";

// Shared, presentational form primitives for the Settings page and its panels.
// Extracted from page.tsx to keep that file focused on the page itself.

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plug, CircleCheck, CircleX, AlertTriangle, ChevronDown, Wrench } from "lucide-react";

export function TestBtn({ service, testing, result, onClick }: { service: string; testing: string | null; result: { service: string; ok: boolean; detail: string } | null; onClick: () => void }) {
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

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-400">{label}</label>
      {hint && <p className="text-[10px] text-slate-600 -mt-0.5">{hint}</p>}
      {children}
      {error && <p className="text-[10px] text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{error}</p>}
    </div>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
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

export function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number" value={value} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all placeholder:text-slate-600"
    />
  );
}

export function TextInput({ value, onChange, placeholder, type }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type || "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all placeholder:text-slate-600"
    />
  );
}

export function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all"
    >
      {options.map(o => <option key={o.value} value={o.value} className="bg-[#14142a]">{o.label}</option>)}
    </select>
  );
}

export function SectionHeader({ icon: Icon, color, title, desc }: { icon: React.ComponentType<{ className?: string }>; color: string; title: string; desc: string }) {
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

// Collapsible "Advanced" group — progressive disclosure for the pointy knobs in a section.
// Keeps essentials visible and tucks rarely-touched fields out of the way. Purely visual:
// the fields inside still read/write the same config, so collapsing changes nothing on save.
export function AdvancedDisclosure({ label = "Advanced", hint, defaultOpen = false, children }: { label?: string; hint?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        <Wrench className="h-3 w-3 text-slate-500 shrink-0" />
        <span>{label}</span>
        {hint && <span className="text-[10px] text-slate-600 truncate font-normal">· {hint}</span>}
      </button>
      {open && <div className="px-3 pb-3.5 pt-1 space-y-4 border-t border-white/[0.04]">{children}</div>}
    </div>
  );
}
