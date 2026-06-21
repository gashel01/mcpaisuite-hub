"use client";

import { useEffect, useState } from "react";
import { GitCompare, ListTree, RefreshCw, X, RotateCcw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch } from "@/lib/api";

type Step = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  output_var: string | null;
  goto: string | null;
  parallel_group: string;
  is_foreach: boolean;
  condition: string | null;
};

type PlanResp = { task_id: string; has_plan: boolean; goal?: string; steps?: Step[]; mode?: string };
type PlanListItem = { task_id: string; goal: string; steps: number; status: string };
type DiffResp = {
  diff: {
    added: string[];
    removed: string[];
    changed: { id: string; fields: string[] }[];
    reordered: boolean;
    identical: boolean;
    summary: { a_steps: number; b_steps: number; added: number; removed: number; changed: number };
  };
  a: { steps: Step[] };
  b: { steps: Step[] };
};

function StepRow({ s, tone, onClick }: { s: Step; tone: "neutral" | "added" | "removed" | "changed"; onClick?: () => void }) {
  const cls = {
    neutral: "border-white/[0.06] bg-white/[0.015] text-slate-300 hover:border-white/[0.14]",
    added: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200 hover:border-emerald-500/50",
    removed: "border-red-500/30 bg-red-500/[0.06] text-red-200 line-through opacity-70 hover:border-red-500/50",
    changed: "border-amber-500/30 bg-amber-500/[0.06] text-amber-200 hover:border-amber-500/50",
  }[tone];
  const mark = { neutral: "", added: "+", removed: "−", changed: "~" }[tone];
  const argStr = Object.keys(s.args || {}).length ? JSON.stringify(s.args) : "";
  return (
    <button onClick={onClick} className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-[11px] font-mono transition-colors cursor-pointer ${cls}`}>
      <div className="flex items-center gap-1.5">
        {mark && <span className="font-semibold">{mark}</span>}
        <span className="text-slate-500">{s.id}</span>
        <span className="font-semibold">{s.tool}</span>
        {s.output_var && <span className="text-slate-500">→ {s.output_var}</span>}
        {s.parallel_group && <span className="ml-auto text-[9px] text-indigo-300/70">∥ {s.parallel_group}</span>}
        {s.is_foreach && <span className="ml-auto text-[9px] text-indigo-300/70">foreach</span>}
      </div>
      {argStr && <div className="mt-0.5 text-[10px] text-slate-500 truncate">{argStr}</div>}
    </button>
  );
}

function StepModal({ step, onClose }: { step: Step; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Step", step.id],
    ["Tool", step.tool],
    ...(step.output_var ? [["Output var", step.output_var] as [string, string]] : []),
    ...(step.goto ? [["Goto", step.goto] as [string, string]] : []),
    ...(step.parallel_group ? [["Parallel group", step.parallel_group] as [string, string]] : []),
    ...(step.is_foreach ? [["Foreach", "yes"] as [string, string]] : []),
    ...(step.condition ? [["Condition", step.condition] as [string, string]] : []),
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border border-white/[0.08] bg-[#0e0e12] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] sticky top-0 bg-[#0e0e12]">
          <span className="text-sm font-semibold text-slate-200 font-mono">{step.id} · {step.tool}</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-slate-200 font-mono break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Arguments</div>
            <pre className="text-[11px] text-slate-300 bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
{Object.keys(step.args || {}).length ? JSON.stringify(step.args, null, 2) : "(none)"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlanDiffPanel({ taskId, namespace }: { taskId: string; namespace?: string }) {
  const [plan, setPlan] = useState<PlanResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<PlanListItem[]>([]);
  const [otherId, setOtherId] = useState("");
  const [diff, setDiff] = useState<DiffResp | null>(null);
  const [diffing, setDiffing] = useState(false);
  const [err, setErr] = useState("");
  const [modalStep, setModalStep] = useState<Step | null>(null);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true); setDiff(null); setOtherId(""); setErr("");
    apiFetch<PlanResp>(`/tasks/${taskId}/plan`, { tenant: namespace })
      .then(setPlan).catch(e => setErr(e?.message || "Failed to load plan"))
      .finally(() => setLoading(false));
    apiFetch<{ plans: PlanListItem[] }>(`/ltp/plans`, { tenant: namespace })
      .then(r => setOptions((r.plans || []).filter(p => p.task_id !== taskId)))
      .catch(() => setOptions([]));
  }, [taskId, namespace]);

  const runDiff = async (other: string) => {
    setOtherId(other);
    if (!other) { setDiff(null); return; }
    setDiffing(true); setErr("");
    try {
      const r = await apiFetch<DiffResp>(`/ltp/diff`, {
        method: "POST", body: { a_task_id: taskId, b_task_id: other },
      });
      setDiff(r);
    } catch (e: any) {
      setErr(e?.message || "Diff failed");
    }
    setDiffing(false);
  };

  if (!taskId) return <div className="p-4 text-xs text-slate-600">Select a run to view its plan.</div>;
  if (loading) return <div className="p-4 flex items-center gap-2 text-xs text-slate-500"><Spinner icon={RefreshCw} className="h-3 w-3" /> Loading plan…</div>;

  if (plan && !plan.has_plan) {
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-400"><ListTree className="h-4 w-4 text-slate-600" /> No compiled plan</div>
        <p className="text-[11px] text-slate-600 leading-relaxed">
          This run executed in <span className="text-slate-400">{plan.mode || "ReAct"}</span> mode — it reasons step-by-step
          with no compile-once plan. Plans appear for <span className="text-slate-400">LTP</span> and
          <span className="text-slate-400"> Hybrid</span> runs (set the execution mode in Settings).
        </p>
      </div>
    );
  }

  // Build tone maps when a diff is active.
  const addedSet = new Set(diff?.diff.added || []);
  const removedSet = new Set(diff?.diff.removed || []);
  const changedSet = new Set((diff?.diff.changed || []).map(c => c.id));
  const toneFor = (id: string, side: "a" | "b"): "neutral" | "added" | "removed" | "changed" => {
    if (changedSet.has(id)) return "changed";
    if (side === "a" && removedSet.has(id)) return "removed";
    if (side === "b" && addedSet.has(id)) return "added";
    return "neutral";
  };

  const leftSteps = diff ? diff.a.steps : (plan?.steps || []);

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* Compare picker */}
      <div className="flex items-center gap-2">
        <GitCompare className="h-4 w-4 text-indigo-400 shrink-0" />
        <select
          value={otherId}
          onChange={e => runDiff(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500/40"
        >
          <option value="">Compare with another LTP run…</option>
          {options.map(o => (
            <option key={o.task_id} value={o.task_id}>{o.goal} ({o.steps} steps)</option>
          ))}
        </select>
        {diffing && <Spinner icon={RefreshCw} className="h-3 w-3 text-slate-500" />}
        {diff && !diffing && (
          <button onClick={() => runDiff("")} data-tooltip="Reset comparison"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] shrink-0">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        )}
      </div>

      {err && <p className="text-[11px] text-red-400">{err}</p>}

      {/* Diff summary */}
      {diff && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
          {diff.diff.identical ? (
            <span className="text-emerald-300">Plans are identical</span>
          ) : (
            <>
              <span className="text-emerald-300">+{diff.diff.summary.added} added</span>
              <span className="text-red-300">−{diff.diff.summary.removed} removed</span>
              <span className="text-amber-300">~{diff.diff.summary.changed} changed</span>
              {diff.diff.reordered && <span className="text-indigo-300">⇅ reordered</span>}
            </>
          )}
        </div>
      )}

      {/* Steps — single plan, or side-by-side when diffing */}
      {!diff ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{plan?.goal?.slice(0, 60) || "Plan"} · {leftSteps.length} steps</div>
          {leftSteps.map(s => <StepRow key={s.id} s={s} tone="neutral" onClick={() => setModalStep(s)} />)}
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">This run (A)</div>
            {diff.a.steps.map(s => <StepRow key={s.id} s={s} tone={toneFor(s.id, "a")} onClick={() => setModalStep(s)} />)}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Compared (B)</div>
            {diff.b.steps.map(s => <StepRow key={s.id} s={s} tone={toneFor(s.id, "b")} onClick={() => setModalStep(s)} />)}
          </div>
        </div>
      )}

      {modalStep && <StepModal step={modalStep} onClose={() => setModalStep(null)} />}
    </div>
  );
}
