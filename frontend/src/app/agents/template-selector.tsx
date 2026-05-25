"use client";

import { useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import type { Template } from "./constants";

export default function TemplateSelector({ templates, onSelect }: { templates: Template[]; onSelect: (t: Template) => void }) {
  const [open, setOpen] = useState(false);

  const simple = templates.filter(t => t.complexity === "simple");
  const medium = templates.filter(t => t.complexity === "medium");
  const advanced = templates.filter(t => t.complexity === "advanced");
  const extreme = templates.filter(t => t.complexity === "extreme");

  const COMPLEXITY_META = {
    simple: { label: "Simple", color: "text-emerald-400", dot: "bg-emerald-400" },
    medium: { label: "Medium", color: "text-amber-400", dot: "bg-amber-400" },
    advanced: { label: "Advanced", color: "text-rose-400", dot: "bg-rose-400" },
    extreme: { label: "Extreme", color: "text-red-400", dot: "bg-red-500" },
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-slate-400 hover:text-violet-300 bg-white/[0.02] hover:bg-violet-500/8 border border-white/[0.05] hover:border-violet-500/20 rounded-lg transition-all">
        <Sparkles className="h-2.5 w-2.5" />
        Templates
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-fade-in max-h-[70vh] overflow-y-auto">
            {[
              { key: "simple" as const, items: simple },
              { key: "medium" as const, items: medium },
              { key: "advanced" as const, items: advanced },
              { key: "extreme" as const, items: extreme },
            ].map(({ key, items }) => {
              const meta = COMPLEXITY_META[key];
              return (
                <div key={key}>
                  <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-white/[0.04] bg-white/[0.01] sticky top-0">
                    <div className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    <span className={`text-[9px] font-semibold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                    <span className="text-[9px] text-slate-600 ml-auto">{items.length}</span>
                  </div>
                  {items.map(tpl => {
                    const TIcon = tpl.icon;
                    return (
                      <button key={tpl.label} onClick={() => { onSelect(tpl); setOpen(false); }}
                        className="w-full text-left flex items-start gap-2.5 px-3 py-2 hover:bg-white/[0.03] transition-colors">
                        <TIcon className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-medium text-slate-200">{tpl.label}</span>
                            <span className="text-[9px] text-slate-600">{tpl.agents.length} agent{tpl.agents.length > 1 ? "s" : ""} · {tpl.pattern}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 truncate">{tpl.goal}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
