"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Clock, Play, Pause, XCircle, RefreshCw, Plus,
  Calendar, Timer, Eye, Zap,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { BASE_URL } from "@/types";

const BASE = BASE_URL;

/* ── Types ─────────────────────────────────────────────────────── */

interface Job {
  id: string;
  goal: string;
  schedule_type: "once" | "cron" | "interval" | "watch";
  status: "active" | "paused" | "completed" | "cancelled";
  next_run: string | null;
  run_count: number;
  namespace: string;
  schedule?: string;
}

type ScheduleType = Job["schedule_type"];

/* ── Badge helpers ─────────────────────────────────────────────── */

const STATUS_STYLE: Record<Job["status"], string> = {
  active:    "bg-green-900/40 text-green-400 border-green-700/50",
  paused:    "bg-amber-900/40 text-amber-400 border-amber-700/50",
  completed: "bg-slate-700/40 text-slate-400 border-slate-600/50",
  cancelled: "bg-red-900/40 text-red-400 border-red-700/50",
};

const TYPE_STYLE: Record<ScheduleType, { cls: string; icon: typeof Clock }> = {
  once:     { cls: "bg-slate-700/40 text-slate-300 border-slate-600/50",   icon: Zap },
  cron:     { cls: "bg-violet-900/40 text-violet-400 border-violet-700/50", icon: Calendar },
  interval: { cls: "bg-sky-900/40 text-sky-400 border-sky-700/50",         icon: Timer },
  watch:    { cls: "bg-amber-900/40 text-amber-400 border-amber-700/50",   icon: Eye },
};

/* ── KPI Card ──────────────────────────────────────────────────── */

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`text-2xl font-bold ${accent}`}>{value}</span>
    </div>
  );
}

/* ── Badge ─────────────────────────────────────────────────────── */

function Badge({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${cls}`}>
      {text}
    </span>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function SchedulerPage() {
  const { tenant } = useTenant();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  // Form state
  const [goal, setGoal] = useState("");
  const [type, setType] = useState<ScheduleType>("once");
  const [delaySeconds, setDelaySeconds] = useState("60");
  const [cronExpr, setCronExpr] = useState("0 9 * * *");
  const [intervalSeconds, setIntervalSeconds] = useState("300");
  const [watchCommand, setWatchCommand] = useState("");
  const [watchCondition, setWatchCondition] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ── Fetch jobs ──────────────────────────────────────────────── */

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE}/schedules`, {
        headers: tenantHeaders(tenant),
      });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh every 10s
  useEffect(() => {
    const id = setInterval(fetchJobs, 10_000);
    return () => clearInterval(id);
  }, [fetchJobs]);

  /* ── Computed KPIs ───────────────────────────────────────────── */

  const total     = jobs.length;
  const active    = jobs.filter((j) => j.status === "active").length;
  const paused    = jobs.filter((j) => j.status === "paused").length;
  const completed = jobs.filter((j) => j.status === "completed").length;

  /* ── Actions via POST /chat ──────────────────────────────────── */

  const sendChat = async (message: string) => {
    await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tenantHeaders(tenant) },
      body: JSON.stringify({ message }),
    });
    // Refresh after action
    setTimeout(fetchJobs, 500);
  };

  const handlePauseResume = (job: Job) => {
    if (job.status === "active") {
      sendChat(`pause_schedule job_id=${job.id}`);
    } else if (job.status === "paused") {
      sendChat(`resume_schedule job_id=${job.id}`);
    }
  };

  const handleCancel = (job: Job) => {
    sendChat(`cancel_schedule job_id=${job.id}`);
  };

  /* ── Submit new job ──────────────────────────────────────────── */

  const handleSubmit = async () => {
    if (!goal.trim()) return;
    setSubmitting(true);

    let msg = `schedule_task goal="${goal}" job_type=${type}`;
    switch (type) {
      case "once":
        msg += ` delay_seconds=${delaySeconds}`;
        break;
      case "cron":
        msg += ` cron=${cronExpr}`;
        break;
      case "interval":
        msg += ` interval_seconds=${intervalSeconds}`;
        break;
      case "watch":
        msg += ` watch_command="${watchCommand}" watch_condition="${watchCondition}"`;
        break;
    }

    try {
      await sendChat(msg);
      setGoal("");
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Format next_run ─────────────────────────────────────────── */

  const fmtNextRun = (nr: string | null) => {
    if (!nr) return "\u2014";
    try {
      const d = new Date(nr);
      return d.toLocaleString("en-US", {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
    } catch {
      return nr;
    }
  };

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <Clock className="h-6 w-6 text-violet-400" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-100">Scheduler</h1>
          <p className="text-xs text-slate-500">
            Schedule and manage automated jobs
          </p>
        </div>
        <button
          onClick={fetchJobs}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <KpiCard label="Total Jobs" value={total} accent="text-slate-100" />
        <KpiCard label="Active"     value={active} accent="text-green-400" />
        <KpiCard label="Paused"     value={paused} accent="text-amber-400" />
        <KpiCard label="Completed"  value={completed} accent="text-slate-400" />
      </div>

      {/* Schedule Job form */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 shrink-0 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Plus className="h-4 w-4 text-violet-400" />
          Schedule Job
        </h2>

        {/* Goal */}
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What should the agent do?"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />

        {/* Type selector */}
        <div className="flex gap-2">
          {(["once", "cron", "interval", "watch"] as ScheduleType[]).map((t) => {
            const ts = TYPE_STYLE[t];
            const Icon = ts.icon;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  type === t
                    ? ts.cls + " font-semibold ring-1 ring-white/10"
                    : "bg-slate-900 text-slate-500 border-slate-700 hover:bg-slate-800"
                }`}
              >
                <Icon className="h-3 w-3" />
                {t}
              </button>
            );
          })}
        </div>

        {/* Conditional fields */}
        <div className="space-y-2">
          {type === "once" && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Delay (seconds)</label>
              <input
                type="number"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500 mt-1"
              />
            </div>
          )}

          {type === "cron" && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Cron Expression</label>
              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500 mt-1"
              />
              <p className="text-[10px] text-slate-600 mt-1">
                Examples: <code className="text-violet-400">0 9 * * *</code> (daily 9am)
                {" "}<code className="text-violet-400">*/15 * * * *</code> (every 15min)
                {" "}<code className="text-violet-400">0 0 * * 1</code> (Mondays midnight)
              </p>
            </div>
          )}

          {type === "interval" && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Interval (seconds)</label>
              <input
                type="number"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500 mt-1"
              />
            </div>
          )}

          {type === "watch" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Watch Command</label>
                <input
                  value={watchCommand}
                  onChange={(e) => setWatchCommand(e.target.value)}
                  placeholder="e.g. curl -s https://api.example.com/status"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500 mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Watch Condition</label>
                <input
                  value={watchCondition}
                  onChange={(e) => setWatchCondition(e.target.value)}
                  placeholder='e.g. status != "ok"'
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500 mt-1"
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !goal.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" />
          {submitting ? "Scheduling..." : "Schedule"}
        </button>
      </div>

      {/* Jobs table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {jobs.length === 0 ? (
          <div className="text-center py-16">
            <Clock className="h-10 w-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No scheduled jobs yet.</p>
          </div>
        ) : (
          <div className="border border-slate-700/50 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/80 text-left">
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Goal</th>
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Type</th>
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Status</th>
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Schedule</th>
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold text-right">Runs</th>
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Next Run</th>
                  <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {jobs.map((job) => {
                  const ts = TYPE_STYLE[job.schedule_type] ?? TYPE_STYLE.once;
                  const TIcon = ts.icon;
                  const canToggle = job.status === "active" || job.status === "paused";
                  const canCancel = job.status === "active" || job.status === "paused";

                  return (
                    <tr key={job.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Goal */}
                      <td className="px-3 py-2 text-slate-200 max-w-[200px] truncate" title={job.goal}>
                        {job.goal}
                      </td>
                      {/* Type */}
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${ts.cls}`}>
                          <TIcon className="h-2.5 w-2.5" />
                          {job.schedule_type}
                        </span>
                      </td>
                      {/* Status */}
                      <td className="px-3 py-2">
                        <Badge text={job.status} cls={STATUS_STYLE[job.status]} />
                      </td>
                      {/* Schedule info */}
                      <td className="px-3 py-2 text-xs text-slate-400 font-mono">
                        {job.schedule ?? "\u2014"}
                      </td>
                      {/* Run count */}
                      <td className="px-3 py-2 text-xs text-slate-300 text-right font-mono">
                        {job.run_count}
                      </td>
                      {/* Next run */}
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {fmtNextRun(job.next_run)}
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canToggle && (
                            <button
                              onClick={() => handlePauseResume(job)}
                              className={`p-1 rounded transition-colors ${
                                job.status === "active"
                                  ? "text-amber-400 hover:bg-amber-900/30"
                                  : "text-green-400 hover:bg-green-900/30"
                              }`}
                              title={job.status === "active" ? "Pause" : "Resume"}
                            >
                              {job.status === "active" ? (
                                <Pause className="h-3.5 w-3.5" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                          {canCancel && (
                            <button
                              onClick={() => handleCancel(job)}
                              className="p-1 rounded text-red-400 hover:bg-red-900/30 transition-colors"
                              title="Cancel"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
