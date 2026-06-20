"use client";
import { apiFetch } from "@/lib/api";

import { useState, useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { Clock, RefreshCw, Menu } from "lucide-react";
import { useTenant } from "@/context/tenant";
import { useApi } from "@/hooks/useApi";
import { Spinner } from "@/components/ui/Spinner";
import type { ScheduledJob, SchedulerStats } from "@/types/scheduler";

import SchedulerHero from "@/components/scheduler/SchedulerHero";
import SchedulerGrid from "@/components/scheduler/SchedulerGrid";
// Lazy-loaded: the detail panel (with its run-history timeline + live countdown) is not visible
// on initial load, so keep it out of the first mount/bundle.
const JobDetailPanel = dynamic(() => import("@/components/scheduler/JobDetailPanel"), { ssr: false });


/* ── Page ──────────────────────────────────────────────────────── */

export default function SchedulerPage() {
  const { tenant } = useTenant();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{ goal: string; calls: { tool: string; arguments: unknown }[] } | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);

  /* ── Data fetching ───────────────────────────────────────────── */

  const { data, loading, refresh } = useApi<ScheduledJob[]>(
    async () => {
      const [schedulesRes, taskforceRes] = await Promise.all([
        apiFetch<{ jobs?: ScheduledJob[] }>("/schedules", { tenant }).catch(() => null),
        apiFetch<{ schedules?: any[] }>("/agents/taskforce/schedules", { tenant }).catch(() => null),
      ]);

      // Merge scheduler jobs
      const schedulerJobs: ScheduledJob[] = (schedulesRes?.jobs ?? []).map((j: ScheduledJob) => ({
        ...j,
        source: j.source ?? "scheduler",
      }));

      // Map TaskForce schedules into unified format
      const taskforceJobs: ScheduledJob[] = (taskforceRes?.schedules ?? []).map((s: any) => ({
        id: s.id,
        goal: s.config?.goal ?? s.name ?? "TaskForce schedule",
        schedule_type: s.type ?? "interval",
        status: s.active ? "active" : "paused",
        next_run: s.next_run ?? null,
        last_run: s.last_run ?? null,
        created_at: s.created_at ?? null,
        run_count: s.run_count ?? 0,
        namespace: s.namespace ?? "taskforce",
        enabled: s.active ?? false,
        cron: s.cron ?? null,
        interval_seconds: s.interval_seconds ?? null,
        delay_seconds: null,
        watch_command: null,
        watch_condition: null,
        watch_interval: null,
        watch_last_value: null,
        consecutive_failures: 0,
        max_failures: s.max_failures ?? 3,
        retry_count: 0,
        max_retries: 0,
        next_retry_at: null,
        max_runs: s.max_runs ?? 0,
        tags: s.tags ?? [],
        metadata: s.metadata ?? {},
        webhook_url: null,
        last_result: null,
        history: [],
        source: "taskforce" as const,
        workflow_id: s.workflow_id ?? s.id,
      }));

      return [...schedulerJobs, ...taskforceJobs];
    },
    { deps: [tenant], poll: 30_000, initialData: [] }
  );
  const jobs = data ?? [];

  /* ── Actions ─────────────────────────────────────────────────── */

  const handleAction = useCallback(async (jobId: string, action: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    // Dry-run test: run this job's goal once in simulation (no tool executes),
    // reusing the /tasks dry-run endpoint, then show what it would have called.
    if (action === "dry_run_test") {
      setDryRunBusy(true);
      setDryRunResult({ goal: job.goal, calls: [] });
      try {
        const res = await apiFetch<{ id: string }>("/tasks", { method: "POST", tenant, body: { goal: job.goal, dry_run: true } });
        const tid = res.id;
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 700));
          const t = await apiFetch<{ status: string; dry_run_calls?: { tool: string; arguments: unknown }[] }>(`/tasks/${tid}`, { tenant }).catch(() => null);
          if (t && ["completed", "failed", "cancelled"].includes(t.status)) {
            setDryRunResult({ goal: job.goal, calls: t.dry_run_calls ?? [] });
            break;
          }
        }
      } catch {
        /* silent */
      } finally {
        setDryRunBusy(false);
      }
      return;
    }

    try {
      if (job.source === "taskforce" && action === "cancel") {
        await apiFetch(`/agents/taskforce/schedules/${jobId}`, { method: "DELETE", tenant });
      } else {
        await apiFetch(`/schedules/${jobId}/action`, { method: "POST", tenant, body: { action } });
      }
    } catch {
      /* silent */
    }

    refresh();
  }, [jobs, tenant, refresh]);

  /* ── Derived ─────────────────────────────────────────────────── */

  // Derive stats from the merged jobs list (scheduler + taskforce) so the
  // hero counters always match exactly what the grid renders. The server-side
  // /schedules/stats endpoint only knows about scheduler jobs, which left the
  // cards out of sync with the cards shown below.
  //
  // Total Jobs / Active / Paused are job-status counts; Total Runs / Completed
  // / Failures are run-outcome counts derived from each job's run history, so
  // that Total Runs === Completed + Failures.
  const derivedStats: SchedulerStats = useMemo(() => {
    const byStatus = (status: ScheduledJob["status"]) =>
      jobs.filter((j) => j.status === status).length;

    let totalRuns = 0;
    let succeededRuns = 0;
    let failedRuns = 0;
    for (const j of jobs) {
      for (const r of j.history ?? []) {
        totalRuns++;
        if (r.success) succeededRuns++;
        else failedRuns++;
      }
    }

    return {
      total_jobs: jobs.length,
      active_jobs: byStatus("active"),
      paused_jobs: byStatus("paused"),
      completed_jobs: succeededRuns,
      total_runs: totalRuns,
      total_failures: failedRuns,
    };
  }, [jobs]);

  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null;

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="animate-page-in obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 shrink-0 border-b border-white/[0.04]">
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
          <Clock className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Scheduled Tasks</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Monitor and manage your scheduled agent tasks</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 border border-white/[0.06] transition-all touch-target shrink-0 disabled:opacity-40"
        >
          <Spinner icon={RefreshCw} spinning={loading} className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 pt-3 sm:pt-4 pb-3 sm:pb-4 space-y-3 sm:space-y-4">
        <SchedulerHero
          stats={derivedStats}
          loading={loading}
          activeFilter={activeFilter}
          onFilterClick={setActiveFilter}
        />

        <SchedulerGrid
          jobs={jobs}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />
      </div>

      <AnimatePresence>
        {selectedJob && (
          <JobDetailPanel
            job={selectedJob}
            onClose={() => setSelectedJobId(null)}
            onAction={handleAction}
          />
        )}
      </AnimatePresence>

      {dryRunResult && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => !dryRunBusy && setDryRunResult(null)}>
          <div className="w-full max-w-lg bg-[#0c0c14] border border-white/[0.08] rounded-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-amber-300">Dry run — simulation</h3>
              <button onClick={() => setDryRunResult(null)} disabled={dryRunBusy} className="text-slate-500 hover:text-slate-300 disabled:opacity-40">✕</button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3 line-clamp-2">{dryRunResult.goal}</p>
            {dryRunBusy ? (
              <p className="text-xs text-slate-400">Simulating… nothing is being executed.</p>
            ) : (
              <>
                <p className="text-xs text-slate-300 mb-2">{dryRunResult.calls.length} tool call(s) would have run (nothing executed):</p>
                <ol className="text-[11px] text-slate-400 space-y-1 max-h-72 overflow-y-auto list-decimal pl-5">
                  {dryRunResult.calls.map((c, i) => (
                    <li key={i}><span className="text-slate-200 font-mono">{c.tool}</span>(<span className="font-mono">{JSON.stringify(c.arguments)}</span>)</li>
                  ))}
                  {dryRunResult.calls.length === 0 && <li className="list-none text-slate-500">No tool calls.</li>}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
