"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar, Clock, Tag, Globe, Settings2, History, Info } from "lucide-react";
import type { ScheduledJob } from "@/types/scheduler";
import StatusDot from "@/components/scheduler/StatusDot";
import SourceBadge from "@/components/scheduler/SourceBadge";
import NextRunCountdown from "@/components/scheduler/NextRunCountdown";
import HealthSection from "@/components/scheduler/HealthSection";
import RunHistoryTimeline from "@/components/scheduler/RunHistoryTimeline";
import QuickActions from "@/components/scheduler/QuickActions";

interface JobDetailPanelProps {
  job: ScheduledJob | null;
  onClose: () => void;
  onAction: (jobId: string, action: string) => Promise<void>;
}

const tabs = [
  { key: "overview", label: "Overview", icon: Info },
  { key: "history", label: "History", icon: History },
  { key: "config", label: "Config", icon: Settings2 },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function humanizeCron(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;
  const [min, hour, dayOfMonth, , dayOfWeek] = parts;
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    if (hour === "*") return `Every hour at :${min.padStart(2, "0")}`;
    return `Every day at ${hour}:${min.padStart(2, "0")}`;
  }
  if (dayOfWeek !== "*") return `Weekly (${dayOfWeek}) at ${hour}:${min.padStart(2, "0")}`;
  return cron;
}

function getScheduleDescription(job: ScheduledJob): string {
  switch (job.schedule_type) {
    case "cron":
      return job.cron ? humanizeCron(job.cron) : "Cron schedule";
    case "interval":
      return job.interval_seconds
        ? `Every ${job.interval_seconds}s`
        : "Interval schedule";
    case "once":
      return "One-time";
    case "watch":
      return job.watch_condition ? `When: ${job.watch_condition}` : "Watch trigger";
    default:
      return "Unknown";
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OverviewTab({ job }: { job: ScheduledJob }) {
  return (
    <div className="space-y-4">
      {/* Facts grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-slate-500 flex items-center gap-1">
            <Calendar className="h-2.5 w-2.5" /> Created
          </p>
          <p className="text-xs text-slate-300">{formatDate(job.created_at)}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" /> Last Run
          </p>
          <p className="text-xs text-slate-300">{formatDate(job.last_run)}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500">Run Count / Max</p>
          <p className="text-xs text-slate-300">
            {job.run_count} / {job.max_runs > 0 ? job.max_runs : "unlimited"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500">Schedule</p>
          <p className="text-xs text-slate-300">{getScheduleDescription(job)}</p>
        </div>
      </div>

      {/* Tags */}
      {job.tags.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 flex items-center gap-1 mb-1">
            <Tag className="h-2.5 w-2.5" /> Tags
          </p>
          <div className="flex flex-wrap gap-1">
            {job.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Source */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500">Source:</span>
        <SourceBadge source={job.source} workflowId={job.workflow_id} />
      </div>

      {/* Next run countdown */}
      {job.next_run && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
          <p className="text-[10px] text-slate-500 mb-2">Next Execution</p>
          <NextRunCountdown nextRun={job.next_run} />
        </div>
      )}

      {/* Health section */}
      <HealthSection job={job} />
    </div>
  );
}

function HistoryTab({ job }: { job: ScheduledJob }) {
  return <RunHistoryTimeline history={job.history} />;
}

function ConfigTab({ job }: { job: ScheduledJob }) {
  return (
    <div className="space-y-4">
      {/* Schedule Config */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 space-y-2">
        <h4 className="text-[11px] font-semibold text-slate-300">Schedule Config</h4>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-500">Type:</span>
            <span className="text-slate-300 ml-1">{job.schedule_type}</span>
          </div>
          {job.cron && (
            <div>
              <span className="text-slate-500">Cron:</span>
              <span className="text-slate-300 ml-1 font-mono">{job.cron}</span>
            </div>
          )}
          {job.interval_seconds && (
            <div>
              <span className="text-slate-500">Interval:</span>
              <span className="text-slate-300 ml-1">{job.interval_seconds}s</span>
            </div>
          )}
          {job.delay_seconds && (
            <div>
              <span className="text-slate-500">Delay:</span>
              <span className="text-slate-300 ml-1">{job.delay_seconds}s</span>
            </div>
          )}
          {job.watch_command && (
            <div className="col-span-2">
              <span className="text-slate-500">Watch cmd:</span>
              <span className="text-slate-300 ml-1 font-mono text-[10px]">
                {job.watch_command}
              </span>
            </div>
          )}
          {job.watch_condition && (
            <div className="col-span-2">
              <span className="text-slate-500">Condition:</span>
              <span className="text-slate-300 ml-1">{job.watch_condition}</span>
            </div>
          )}
        </div>
      </div>

      {/* Retry Config */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 space-y-2">
        <h4 className="text-[11px] font-semibold text-slate-300">Retry Config</h4>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-500">Max failures:</span>
            <span className="text-slate-300 ml-1">{job.max_failures}</span>
          </div>
          <div>
            <span className="text-slate-500">Max retries:</span>
            <span className="text-slate-300 ml-1">{job.max_retries}</span>
          </div>
        </div>
      </div>

      {/* Integration */}
      {job.webhook_url && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 space-y-1">
          <h4 className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
            <Globe className="h-3 w-3" /> Webhook
          </h4>
          <p className="text-[10px] font-mono text-slate-400 break-all">
            {job.webhook_url}
          </p>
        </div>
      )}

      {/* Metadata */}
      {Object.keys(job.metadata).length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 space-y-1">
          <h4 className="text-[11px] font-semibold text-slate-300">Metadata</h4>
          <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto max-h-40 overflow-y-auto">
            {JSON.stringify(job.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function JobDetailPanel({ job, onClose, onAction }: JobDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // ESC key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Reset tab when job changes
  useEffect(() => {
    setActiveTab("overview");
  }, [job?.id]);

  return (
    <AnimatePresence>
      {job && (
        <>
          {/* Scrim */}
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60  z-40"
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 inset-y-0 w-[480px] max-w-full z-50 bg-[#0c0c14] border-l border-white/[0.06] flex flex-col"
          >
            {/* Header */}
            <div className="shrink-0 px-5 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-100 leading-tight pr-4 line-clamp-2">
                  {job.goal}
                </h2>
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-white/[0.04] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot status={job.status} />
                <span className="text-[10px] font-medium text-slate-400 capitalize">
                  {job.status}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.06] bg-white/[0.02] text-slate-400 font-mono">
                  {job.schedule_type}
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="shrink-0 px-5 pt-3 flex items-center gap-1 border-b border-white/[0.06]">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                      isActive ? "text-slate-100" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="h-3 w-3" />
                      {tab.label}
                    </span>
                    {isActive && (
                      <motion.div
                        layoutId="detail-tab-indicator"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-full"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
              {activeTab === "overview" && <OverviewTab job={job} />}
              {activeTab === "history" && <HistoryTab job={job} />}
              {activeTab === "config" && <ConfigTab job={job} />}
            </div>

            {/* Bottom sticky actions */}
            <div className="shrink-0 px-5 py-3 border-t border-white/[0.06] bg-[#0c0c14]">
              <QuickActions job={job} onAction={onAction} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
