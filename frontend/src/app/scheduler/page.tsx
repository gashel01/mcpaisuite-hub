"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Clock, RefreshCw } from "lucide-react";
import PageHeader from "@/components/page-header";
import { useTenant, tenantHeaders } from "@/context/tenant";
import type { ScheduledJob, SchedulerStats } from "@/types/scheduler";

import SchedulerHero from "@/components/scheduler/SchedulerHero";
import SchedulerGrid from "@/components/scheduler/SchedulerGrid";
import JobDetailPanel from "@/components/scheduler/JobDetailPanel";


/* ── Page ──────────────────────────────────────────────────────── */

export default function SchedulerPage() {
  const BASE = getApiUrl();
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);

  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  /* ── Data fetching ───────────────────────────────────────────── */

  const fetchData = useCallback(async () => {
    try {
      const [schedulesRes, statsRes, taskforceRes] = await Promise.all([
        fetch(`${BASE}/schedules`, { headers: th }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/schedules/stats`, { headers: th }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/agents/taskforce/schedules`, { headers: th }).then((r) => r.ok ? r.json() : null).catch(() => null),
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

      setJobs([...schedulerJobs, ...taskforceJobs]);
      if (statsRes) setStats(statsRes);
    } catch {
      /* silent — keep previous state */
    } finally {
      setLoading(false);
    }
  }, [tenant]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  /* ── Actions ─────────────────────────────────────────────────── */

  const handleAction = useCallback(async (jobId: string, action: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    try {
      if (job.source === "taskforce" && action === "cancel") {
        await fetch(`${BASE}/agents/taskforce/schedules/${jobId}`, {
          method: "DELETE",
          headers: th,
        });
      } else {
        await fetch(`${BASE}/schedules/${jobId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify({ action }),
        });
      }
    } catch {
      /* silent */
    }

    // Refresh after action
    setTimeout(fetchData, 300);
  }, [jobs, th, fetchData]);

  /* ── Derived ─────────────────────────────────────────────────── */

  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null;

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden">
      <div className="px-4 pt-2 shrink-0">
        <PageHeader
          icon={Clock}
          title="Schedules"
          subtitle="Monitor and manage your scheduled agent tasks"
          actions={[
            {
              label: "Refresh",
              icon: RefreshCw,
              onClick: fetchData,
              loading: loading,
            },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        <SchedulerHero
          stats={stats}
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
    </div>
  );
}
