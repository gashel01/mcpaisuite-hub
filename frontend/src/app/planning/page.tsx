"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ListChecks, Plus, Loader2, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, Play, Trash2, Rocket,
  ArrowRightLeft, ShieldCheck, Search, RefreshCw,
} from "lucide-react";
import { useTenant } from "@/context/tenant";
import { BASE_URL } from "@/types";

// ── Types ───────────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
}

interface Plan {
  id: string;
  goal: string;
  context?: string;
  status: "draft" | "running" | "completed" | "failed";
  steps: PlanStep[];
  createdAt: number;
  taskId?: string;
  rawResponse?: string;
}

// ── Templates ───────────────────────────────────────────────────────────────

const TEMPLATES = [
  { label: "Deploy", icon: Rocket, goal: "Deploy application to production", context: "Check health, run tests, deploy, verify." },
  { label: "Migrate", icon: ArrowRightLeft, goal: "Migrate database schema", context: "Backup, apply migrations, validate data integrity." },
  { label: "Audit", icon: ShieldCheck, goal: "Security audit of the codebase", context: "Check dependencies, scan for vulnerabilities, review permissions." },
  { label: "Analyze", icon: Search, goal: "Analyze system performance", context: "Collect metrics, identify bottlenecks, suggest optimizations." },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseStepsFromResponse(text: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const lines = text.split("\n");
  let stepIdx = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Match numbered steps: "1. ...", "1) ...", "Step 1: ..."
    const match = trimmed.match(/^(?:\d+[\.\)]\s*|Step\s+\d+[:\s]+)(.+)/i);
    if (match) {
      steps.push({
        id: `step-${stepIdx++}`,
        description: match[1].trim(),
        status: "pending",
      });
    }
  }
  return steps;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  draft:     { bg: "bg-slate-800 border-slate-700", text: "text-slate-400", icon: Clock },
  running:   { bg: "bg-amber-900/20 border-amber-700/40", text: "text-amber-400", icon: Loader2 },
  completed: { bg: "bg-green-900/20 border-green-700/40", text: "text-green-400", icon: CheckCircle2 },
  failed:    { bg: "bg-red-900/20 border-red-700/40", text: "text-red-400", icon: XCircle },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PlanningPage() {
  const { tenant } = useTenant();
  const th = useMemo(() => ({ "Content-Type": "application/json", "X-Tenant-Id": tenant }), [tenant]);

  // State
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  // Load plans from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`kernelmcp_plans_${tenant}`);
      if (saved) setPlans(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [tenant]);

  // Persist plans
  const savePlans = useCallback((updated: Plan[]) => {
    setPlans(updated);
    try {
      localStorage.setItem(`kernelmcp_plans_${tenant}`, JSON.stringify(updated));
    } catch { /* ignore */ }
  }, [tenant]);

  // Poll running tasks for completion
  useEffect(() => {
    const running = plans.filter(p => p.status === "running" && p.taskId);
    if (running.length === 0) return;

    const interval = setInterval(async () => {
      let changed = false;
      const updated = [...plans];

      for (const plan of running) {
        try {
          const r = await fetch(`${BASE_URL}/tasks/${plan.taskId}`, {
            headers: { "X-Tenant-Id": tenant },
          });
          if (!r.ok) continue;
          const task = await r.json();

          const idx = updated.findIndex(p => p.id === plan.id);
          if (idx === -1) continue;

          if (task.status === "completed") {
            const answer = task.answer || task.result || "";
            const steps = parseStepsFromResponse(answer);
            updated[idx] = {
              ...updated[idx],
              status: "completed",
              steps: steps.length > 0 ? steps : updated[idx].steps,
              rawResponse: answer,
            };
            changed = true;
          } else if (task.status === "failed" || task.status === "cancelled") {
            updated[idx] = {
              ...updated[idx],
              status: "failed",
              rawResponse: task.error || task.answer || "Task failed",
            };
            changed = true;
          }
        } catch { /* ignore */ }
      }

      if (changed) savePlans(updated);
    }, 2000);

    return () => clearInterval(interval);
  }, [plans, tenant, savePlans]);

  // Create plan via POST /chat
  const createPlan = async () => {
    if (!goal.trim()) return;
    setCreating(true);

    const planId = `plan-${Date.now().toString(36)}`;
    const message = `Create a detailed step-by-step plan for: ${goal.trim()}${context.trim() ? `\n\nContext: ${context.trim()}` : ""}\n\nProvide numbered steps (1. 2. 3. etc.) with clear, actionable descriptions.`;

    // Add plan in draft status
    const newPlan: Plan = {
      id: planId,
      goal: goal.trim(),
      context: context.trim() || undefined,
      status: "running",
      steps: [],
      createdAt: Date.now(),
    };

    const updatedPlans = [newPlan, ...plans];
    savePlans(updatedPlans);
    setExpandedPlan(planId);
    setShowCreate(false);
    setGoal("");
    setContext("");

    try {
      const res = await fetch(`${BASE_URL}/chat`, {
        method: "POST",
        headers: th,
        body: JSON.stringify({
          message,
          conversation_id: `planning-${planId}`,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Check if async task or direct response
      if (data.task_id) {
        // Async — store task ID, polling will handle completion
        const idx = updatedPlans.findIndex(p => p.id === planId);
        if (idx !== -1) {
          updatedPlans[idx] = { ...updatedPlans[idx], taskId: data.task_id };
          savePlans([...updatedPlans]);
        }
      } else {
        // Direct response
        const answer = data.response || data.answer || data.content || "";
        const steps = parseStepsFromResponse(answer);
        const idx = updatedPlans.findIndex(p => p.id === planId);
        if (idx !== -1) {
          updatedPlans[idx] = {
            ...updatedPlans[idx],
            status: steps.length > 0 ? "completed" : "failed",
            steps,
            rawResponse: answer,
          };
          savePlans([...updatedPlans]);
        }
      }
    } catch (err) {
      const idx = updatedPlans.findIndex(p => p.id === planId);
      if (idx !== -1) {
        updatedPlans[idx] = {
          ...updatedPlans[idx],
          status: "failed",
          rawResponse: String(err),
        };
        savePlans([...updatedPlans]);
      }
    } finally {
      setCreating(false);
    }
  };

  const deletePlan = (id: string) => {
    savePlans(plans.filter(p => p.id !== id));
    if (expandedPlan === id) setExpandedPlan(null);
  };

  const applyTemplate = (t: typeof TEMPLATES[number]) => {
    setGoal(t.goal);
    setContext(t.context);
    setShowCreate(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListChecks className="h-6 w-6 text-violet-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Planning</h1>
            <p className="text-slate-400 text-sm">
              Create and manage step-by-step plans via the orchestrator
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Plan
        </button>
      </div>

      {/* Create Plan Modal / Panel */}
      {showCreate && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-slate-200">New Plan</h2>

          {/* Quick templates */}
          <div>
            <label className="text-xs text-slate-500 block mb-2">Quick start templates</label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    onClick={() => applyTemplate(t)}
                    className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-700 border border-slate-700 hover:border-violet-600/50 text-slate-300 px-3 py-1.5 rounded-lg text-xs transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5 text-violet-400" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Goal input */}
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Goal</label>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && createPlan()}
              placeholder="What do you want to accomplish?"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              disabled={creating}
            />
          </div>

          {/* Context textarea */}
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Context (optional)</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Additional context, constraints, or preferences..."
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
              disabled={creating}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={createPlan}
              disabled={creating || !goal.trim()}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {creating ? "Creating..." : "Create Plan"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setGoal(""); setContext(""); }}
              className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Plans List */}
      <div className="space-y-3">
        {plans.length === 0 && !showCreate && (
          <div className="text-center py-16">
            <ListChecks className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm mb-4">No plans yet. Create one to get started.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    onClick={() => applyTemplate(t)}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 px-3 py-2 rounded-lg text-xs transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5 text-violet-400" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {plans.map((plan) => {
          const style = STATUS_STYLES[plan.status] || STATUS_STYLES.draft;
          const StatusIcon = style.icon;
          const isExpanded = expandedPlan === plan.id;
          const completedSteps = plan.steps.filter(s => s.status === "completed").length;

          return (
            <div
              key={plan.id}
              className={`rounded-xl border ${style.bg} transition-all ${isExpanded ? "ring-1 ring-violet-500/30" : ""}`}
            >
              {/* Plan header */}
              <button
                onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {isExpanded
                  ? <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
                }
                <StatusIcon className={`h-4 w-4 shrink-0 ${style.text} ${plan.status === "running" ? "animate-spin" : ""}`} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{plan.goal}</p>
                  {plan.context && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{plan.context}</p>
                  )}
                </div>

                {/* Step progress */}
                {plan.steps.length > 0 && (
                  <span className="text-xs text-slate-500 shrink-0">
                    {completedSteps}/{plan.steps.length} steps
                  </span>
                )}

                {/* Status badge */}
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${style.text} bg-black/20`}>
                  {plan.status}
                </span>

                {/* Time */}
                <span className="text-[10px] text-slate-600 shrink-0">
                  {formatTime(plan.createdAt)}
                </span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
                  {/* Steps */}
                  {plan.steps.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-500 font-semibold">Steps</label>
                      {plan.steps.map((step, i) => {
                        const stepStyle = STATUS_STYLES[step.status] || STATUS_STYLES.draft;
                        const StepIcon = stepStyle.icon;
                        return (
                          <div
                            key={step.id}
                            className="flex items-start gap-2 py-1.5 px-3 rounded-lg bg-black/20"
                          >
                            <span className="text-xs text-slate-600 font-mono w-5 shrink-0 pt-0.5">
                              {i + 1}.
                            </span>
                            <StepIcon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${stepStyle.text} ${step.status === "running" ? "animate-spin" : ""}`} />
                            <span className="text-sm text-slate-300 flex-1">{step.description}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Raw response */}
                  {plan.rawResponse && (
                    <div>
                      <label className="text-xs text-slate-500 font-semibold block mb-1.5">Response</label>
                      <pre className="text-xs text-slate-400 bg-slate-950/50 rounded-lg p-3 max-h-60 overflow-auto whitespace-pre-wrap font-mono">
                        {plan.rawResponse}
                      </pre>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePlan(plan.id); }}
                      className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                    {plan.status === "running" && (
                      <span className="flex items-center gap-1.5 text-xs text-amber-400 ml-auto">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Waiting for orchestrator...
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stats bar */}
      {plans.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-2 bg-slate-800/50 rounded-lg text-[10px] text-slate-500">
          <span>Total: {plans.length}</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            Completed: {plans.filter(p => p.status === "completed").length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Running: {plans.filter(p => p.status === "running").length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            Failed: {plans.filter(p => p.status === "failed").length}
          </span>
        </div>
      )}
    </div>
  );
}
