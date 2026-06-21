"use client";

import { useState, useEffect } from "react";
import { ScrollText, RefreshCw, ToggleLeft, ToggleRight, GitCompare, Play, Trophy } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch } from "@/lib/api";
import type { SecurityPosture as SecurityPostureData } from "@/components/security/types";

type ABSide = {
  runs: number; success_rate: number; avg_tokens: number; avg_cost: number;
  avg_turns: number; avg_score: number | null; scored_runs: number;
};
type ABResult = {
  label_a: string; label_b: string; a: ABSide; b: ABSide;
  delta: { success_rate: number; avg_tokens: number; avg_cost: number; avg_turns: number; avg_score?: number };
  winner: string; goals: string[]; reps: number; judged: boolean; judge_note?: string;
};

export const RULE_TEMPLATES = [
  { id: "safety", label: "Safety First", icon: "🛡", desc: "Prevent destructive actions", rules: "- Never execute destructive commands (rm -rf, drop database, format) without explicit user confirmation\n- Always create a backup/checkpoint before modifying important files\n- If unsure about a command's impact, ask the user first" },
  { id: "privacy", label: "Privacy & Data", icon: "🔒", desc: "Protect sensitive information", rules: "- Never include API keys, passwords, or tokens in output\n- Redact credit card numbers, SSNs, and personal identifiers\n- Do not send sensitive data to external services without user approval" },
  { id: "quality", label: "Code Quality", icon: "✨", desc: "Enforce coding standards", rules: "- Always add error handling to generated code\n- Include type hints in Python code\n- Write docstrings for functions with more than 3 parameters\n- Prefer async/await over threading for I/O operations" },
  { id: "web", label: "Web Safety", icon: "🌐", desc: "Safe web interactions", rules: "- Always verify URLs before fetching — reject suspicious domains\n- Prefer official documentation and trusted sources\n- Never follow redirect chains longer than 3 hops\n- Do not submit forms or POST data without user approval" },
  { id: "concise", label: "Concise Mode", icon: "⚡", desc: "Short, direct answers", rules: "- Keep responses under 3 paragraphs unless the task requires more\n- Lead with the answer, not the reasoning\n- No filler phrases or unnecessary preamble\n- Use bullet points for lists of 3+ items" },
  { id: "planning", label: "Always Plan", icon: "📋", desc: "Plan before executing", rules: "- For any task with 3+ steps, create a plan first and show it to the user\n- Wait for user approval before executing multi-step plans\n- After each major step, report progress" },
  { id: "workspace", label: "Workspace Hygiene", icon: "📁", desc: "Keep workspace organized", rules: "- Organize files in logical folders (src/, docs/, tests/)\n- Never leave temporary files behind\n- Add a README.md to new projects\n- Use meaningful file names, not temp_1.py" },
];

export function GovernancePanel({ posture, onSave }: { posture: SecurityPostureData | null; onSave: (rules: string) => void }) {
  const [activeTemplates, setActiveTemplates] = useState<Set<string>>(() => new Set(posture?.constitution?.active_templates || []));
  const [customRules, setCustomRules] = useState("");
  const [editingCustom, setEditingCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  // A/B test: compare the live constitution (A) against a proposed alternative (B)
  const [abOpen, setAbOpen] = useState(false);
  const [abAlt, setAbAlt] = useState("");
  const [abGoal, setAbGoal] = useState("");
  const [abReps, setAbReps] = useState(1);
  const [abJudge, setAbJudge] = useState(false);
  const [abExpected, setAbExpected] = useState("");
  const [abRunning, setAbRunning] = useState(false);
  const [abResult, setAbResult] = useState<ABResult | null>(null);
  const [abError, setAbError] = useState("");

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

  const currentRules = posture?.constitution?.rules || "";

  const runAB = async () => {
    if (!abGoal.trim() || !abAlt.trim() || abRunning) return;
    setAbRunning(true);
    setAbError("");
    setAbResult(null);
    try {
      const res = await apiFetch<ABResult>("/constitution/ab", {
        method: "POST",
        body: {
          goal: abGoal,
          rules_a: currentRules,
          rules_b: abAlt,
          reps: Math.max(1, abReps),
          judge: abJudge,
          expected_output: abExpected,
          label_a: "Current",
          label_b: "Proposed",
        },
      });
      setAbResult(res);
    } catch (e: any) {
      setAbError(e?.message || "A/B run failed");
    }
    setAbRunning(false);
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

      {/* A/B test: current constitution vs a proposed alternative */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        <button onClick={() => setAbOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] text-left hover:bg-white/[0.02]">
          <GitCompare className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-300">A/B test a constitution change</span>
          <span className="text-[10px] text-slate-500 ml-auto">{abOpen ? "Hide" : "Compare current vs. a proposal"}</span>
        </button>

        {abOpen && (
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Runs the same goal under your <span className="text-slate-300">current</span> constitution and a
              <span className="text-slate-300"> proposed</span> one, then reports the metric deltas + a winner.
              The live constitution is restored after each run — nothing is changed permanently.
            </p>

            <div>
              <label className="text-[10px] uppercase tracking-wide text-slate-500">Goal to run</label>
              <input value={abGoal} onChange={e => setAbGoal(e.target.value)}
                placeholder="e.g. Summarize the attached log and flag any errors"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs text-slate-200 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/40" />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wide text-slate-500">Proposed constitution (B)</label>
              <textarea value={abAlt} onChange={e => setAbAlt(e.target.value)} rows={5}
                placeholder="Paste the alternative rules to test against the current one…"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/40 font-mono resize-none leading-relaxed" />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                Repetitions
                <input type="number" min={1} max={10} value={abReps}
                  onChange={e => setAbReps(parseInt(e.target.value || "1", 10))}
                  className="w-16 px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs text-slate-200 focus:outline-none focus:border-indigo-500/40" />
              </label>
              <button onClick={() => setAbJudge(j => !j)}
                className={`flex items-center gap-1.5 text-[11px] font-medium ${abJudge ? "text-indigo-300" : "text-slate-500"}`}
                data-tooltip="Score answer quality with an LLM judge (evalmcp), graded against the expected answer.">
                {abJudge ? <ToggleRight className="h-4 w-4 text-indigo-400" /> : <ToggleLeft className="h-4 w-4 text-slate-700" />}
                Judge quality (evalmcp)
              </button>
              <button onClick={runAB} disabled={abRunning || !abGoal.trim() || !abAlt.trim()}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white">
                {abRunning ? <Spinner icon={RefreshCw} className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {abRunning ? "Running…" : "Run A/B"}
              </button>
            </div>

            {abJudge && (
              <div>
                <label className="text-[10px] uppercase tracking-wide text-slate-500">Expected answer (for the judge)</label>
                <textarea value={abExpected} onChange={e => setAbExpected(e.target.value)} rows={2}
                  placeholder="Reference answer the judge grades each output against…"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/40 resize-none" />
              </div>
            )}

            {abError && <p className="text-[11px] text-red-400">{abError}</p>}

            {abResult && <ABResultView r={abResult} />}
          </div>
        )}
      </div>
    </div>
  );
}

function _fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function _delta(n: number | undefined, digits = 2, lowerIsBetter = false): { text: string; cls: string } {
  if (n === undefined || !Number.isFinite(n) || Math.abs(n) < 1e-9) return { text: "±0", cls: "text-slate-500" };
  const good = lowerIsBetter ? n < 0 : n > 0;
  const sign = n > 0 ? "+" : "";
  return { text: `${sign}${n.toFixed(digits)}`, cls: good ? "text-emerald-400" : "text-red-400" };
}

function ABResultView({ r }: { r: ABResult }) {
  const aWins = r.winner === r.label_a;
  const tie = r.winner === "tie";
  const Side = ({ label, s, win }: { label: string; s: ABSide; win: boolean }) => (
    <div className={`flex-1 rounded-lg border p-3 ${win ? "border-amber-500/40 bg-amber-500/[0.05]" : "border-white/[0.06] bg-white/[0.015]"}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {win && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
        <span className={`text-xs font-semibold ${win ? "text-amber-300" : "text-slate-300"}`}>{label}</span>
        <span className="text-[10px] text-slate-600 ml-auto">{s.runs} run{s.runs !== 1 ? "s" : ""}</span>
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-[11px]">
        <dt className="text-slate-500">Success</dt><dd className="text-right text-slate-200">{_fmt(s.success_rate * 100, 0)}%</dd>
        <dt className="text-slate-500">Avg cost</dt><dd className="text-right text-slate-200">${_fmt(s.avg_cost, 4)}</dd>
        <dt className="text-slate-500">Avg tokens</dt><dd className="text-right text-slate-200">{_fmt(s.avg_tokens, 0)}</dd>
        <dt className="text-slate-500">Avg turns</dt><dd className="text-right text-slate-200">{_fmt(s.avg_turns, 1)}</dd>
        {s.avg_score !== null && (<><dt className="text-slate-500">Quality</dt><dd className="text-right text-indigo-300">{_fmt(s.avg_score, 2)}</dd></>)}
      </dl>
    </div>
  );

  const dSucc = _delta(r.delta.success_rate * 100, 0);
  const dCost = _delta(r.delta.avg_cost, 4, true);
  const dTok = _delta(r.delta.avg_tokens, 0, true);
  const dScore = r.delta.avg_score !== undefined ? _delta(r.delta.avg_score, 2) : null;

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-center gap-2">
        <Trophy className="h-4 w-4 text-amber-400" />
        <span className="text-xs text-slate-400">Winner:</span>
        <span className="text-sm font-semibold text-amber-300">{tie ? "Tie" : r.winner}</span>
        {r.judged && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">judged</span>}
      </div>
      <div className="flex gap-3">
        <Side label={r.label_a} s={r.a} win={aWins} />
        <Side label={r.label_b} s={r.b} win={!aWins && !tie} />
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px]">
        <span className="text-slate-500">Δ (B−A):</span>
        <span>success <span className={dSucc.cls}>{dSucc.text}%</span></span>
        <span>cost <span className={dCost.cls}>{dCost.text}</span></span>
        <span>tokens <span className={dTok.cls}>{dTok.text}</span></span>
        {dScore && <span>quality <span className={dScore.cls}>{dScore.text}</span></span>}
      </div>
      {r.judge_note && <p className="text-[10px] text-amber-400/80 text-center">{r.judge_note}</p>}
    </div>
  );
}
