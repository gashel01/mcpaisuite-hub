"use client";

import { useState, useEffect } from "react";
import { ScrollText, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { SecurityPosture as SecurityPostureData } from "@/components/security/types";

export const RULE_TEMPLATES = [
  { id: "safety", label: "Safety First", icon: "🛡", desc: "Prevent destructive actions", rules: "- Never execute destructive commands (rm -rf, drop database, format) without explicit user confirmation\n- Always create a backup/checkpoint before modifying important files\n- If unsure about a command's impact, ask the user first" },
  { id: "privacy", label: "Privacy & Data", icon: "🔒", desc: "Protect sensitive information", rules: "- Never include API keys, passwords, or tokens in output\n- Redact credit card numbers, SSNs, and personal identifiers\n- Do not send sensitive data to external services without user approval" },
  { id: "quality", label: "Code Quality", icon: "✨", desc: "Enforce coding standards", rules: "- Always add error handling to generated code\n- Include type hints in Python code\n- Write docstrings for functions with more than 3 parameters\n- Prefer async/await over threading for I/O operations" },
  { id: "web", label: "Web Safety", icon: "🌐", desc: "Safe web interactions", rules: "- Always verify URLs before fetching — reject suspicious domains\n- Prefer official documentation and trusted sources\n- Never follow redirect chains longer than 3 hops\n- Do not submit forms or POST data without user approval" },
  { id: "language", label: "French Output", icon: "🇫🇷", desc: "Respond in French", rules: "- Always respond in French\n- Use formal language (vouvoiement) unless asked otherwise\n- Keep technical terms in English when no French equivalent exists" },
  { id: "concise", label: "Concise Mode", icon: "⚡", desc: "Short, direct answers", rules: "- Keep responses under 3 paragraphs unless the task requires more\n- Lead with the answer, not the reasoning\n- No filler phrases or unnecessary preamble\n- Use bullet points for lists of 3+ items" },
  { id: "planning", label: "Always Plan", icon: "📋", desc: "Plan before executing", rules: "- For any task with 3+ steps, create a plan first and show it to the user\n- Wait for user approval before executing multi-step plans\n- After each major step, report progress" },
  { id: "workspace", label: "Workspace Hygiene", icon: "📁", desc: "Keep workspace organized", rules: "- Organize files in logical folders (src/, docs/, tests/)\n- Never leave temporary files behind\n- Add a README.md to new projects\n- Use meaningful file names, not temp_1.py" },
];

export function GovernancePanel({ posture, onSave }: { posture: SecurityPostureData | null; onSave: (rules: string) => void }) {
  const [activeTemplates, setActiveTemplates] = useState<Set<string>>(() => new Set(posture?.constitution?.active_templates || []));
  const [customRules, setCustomRules] = useState("");
  const [editingCustom, setEditingCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  // Extract custom rules (non-template part) from saved rules
  useEffect(() => {
    if (!posture?.constitution?.rules) return;
    setActiveTemplates(new Set(posture.constitution.active_templates || []));
    // Custom rules = everything that's not from templates
    let custom = posture.constitution.rules;
    for (const tpl of RULE_TEMPLATES) {
      custom = custom.replace(`## ${tpl.label}\n${tpl.rules}`, "").trim();
    }
    // Clean up extra newlines
    custom = custom.replace(/\n{3,}/g, "\n\n").trim();
    setCustomRules(custom);
  }, [posture?.constitution?.rules]);

  const toggleTemplate = (id: string) => {
    setActiveTemplates(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // Auto-save when toggling
      const combined = buildRules(next, customRules);
      onSave(combined);
      return next;
    });
  };

  const buildRules = (templates: Set<string>, custom: string): string => {
    const parts: string[] = [];
    for (const tpl of RULE_TEMPLATES) {
      if (templates.has(tpl.id)) {
        parts.push(`## ${tpl.label}\n${tpl.rules}`);
      }
    }
    if (custom.trim()) parts.push(`## Custom Rules\n${custom.trim()}`);
    return parts.join("\n\n");
  };

  const saveCustom = async () => {
    setSaving(true);
    await onSave(buildRules(activeTemplates, customRules));
    setSaving(false);
    setEditingCustom(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-pink-400" />
        <span className="text-sm font-semibold text-white">Constitution</span>
        <span className="text-xs text-slate-500">Toggle rules injected into every agent prompt</span>
      </div>

      {/* Template toggles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {RULE_TEMPLATES.map(tpl => {
          const active = activeTemplates.has(tpl.id);
          return (
            <button key={tpl.id} onClick={() => toggleTemplate(tpl.id)} data-tooltip={tpl.rules.replace(/\n/g, " | ")}
              className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${active ? "border-pink-500/30 bg-pink-500/[0.05]" : "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.1]"}`}>
              <span className="text-lg mt-0.5">{tpl.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${active ? "text-pink-300" : "text-slate-300"}`}>{tpl.label}</span>
                  {active ? <ToggleRight className="h-4 w-4 text-pink-400 ml-auto shrink-0" /> : <ToggleLeft className="h-4 w-4 text-slate-700 ml-auto shrink-0" />}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{tpl.desc}</p>
                {active && <p className="text-[10px] text-slate-600 mt-1 line-clamp-2 font-mono">{tpl.rules.split("\n")[0]}</p>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom rules */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04]">
          <span className="text-xs font-semibold text-slate-300">Custom Rules</span>
          <button onClick={() => editingCustom ? saveCustom() : setEditingCustom(true)}
            className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${editingCustom ? "bg-pink-600 hover:bg-pink-500 text-white" : "bg-white/[0.04] text-slate-500 hover:text-white border border-white/[0.06]"}`}>
            {saving ? <Spinner icon={RefreshCw} className="h-3 w-3" /> : editingCustom ? "Save" : "Edit"}
          </button>
        </div>
        {editingCustom ? (
          <textarea value={customRules} onChange={e => setCustomRules(e.target.value)} rows={6}
            placeholder="Add your own rules here..."
            className="w-full px-4 py-3 bg-transparent text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none font-mono resize-none leading-relaxed" />
        ) : (
          <div className="px-4 py-3 min-h-[60px]">
            {customRules ? (
              <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono leading-relaxed">{customRules}</pre>
            ) : (
              <p className="text-xs text-slate-700 text-center py-2">No custom rules. Click Edit to add your own.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
