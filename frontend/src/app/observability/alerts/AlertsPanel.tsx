"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Shield,
  Clock,
  Trash2,
  Check,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Plus,
  AlertTriangle,
  X,
  Globe,
  MessageSquare,
  Monitor,
} from "lucide-react";
import CreateAlertDialog from "./CreateAlertDialog";
import { getApiUrl } from '@/lib/api-url';


// ── Types ────────────────────────────────────────────────────────────────────

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  window: string;
  channels: string[];
  enabled: boolean;
  cooldown_minutes: number;
  last_fired?: string | null;
  webhook_url?: string;
  slack_webhook?: string;
}

interface AlertHistoryEntry {
  id: string;
  rule_id: string;
  rule_name: string;
  metric: string;
  value: number;
  threshold: number;
  operator: string;
  fired_at: string;
  acknowledged: boolean;
  acknowledged_at?: string | null;
}

interface AlertsPanelProps {
  onClose?: () => void;
}

// ── Metric styling ───────────────────────────────────────────────────────────

const METRIC_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  failure_rate:       { color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", label: "Failure Rate" },
  error_rate:         { color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", label: "Error Rate" },
  daily_cost:         { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Daily Cost" },
  p95_latency:        { color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", label: "P95 Latency" },
  throughput:         { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", label: "Throughput" },
  circuit_open:       { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", label: "Circuit Open" },
  injection_detected: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", label: "Injection" },
  budget_used_pct:    { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", label: "Budget" },
};

const DEFAULT_METRIC_STYLE = { color: "text-slate-400", bg: "bg-white/[0.03] border-white/[0.06]", label: "Unknown" };

function getMetricStyle(metric: string) {
  return METRIC_STYLES[metric] || DEFAULT_METRIC_STYLE;
}

// ── Channel icon mapping ─────────────────────────────────────────────────────

function ChannelIcon({ channel }: { channel: string }) {
  switch (channel) {
    case "in_app":
    case "in-app":
      return <Monitor className="h-3 w-3 text-slate-400" />;
    case "webhook":
      return <Globe className="h-3 w-3 text-slate-400" />;
    case "slack":
      return <MessageSquare className="h-3 w-3 text-slate-400" />;
    default:
      return <Bell className="h-3 w-3 text-slate-400" />;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function relativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function AlertsPanel({ onClose }: AlertsPanelProps) {
  const API = getApiUrl();
  const [tab, setTab] = useState<"rules" | "history">("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // ── Fetch data ───────────────────────────────────────────────────────────

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`${API}/alerts/rules`);
      if (!res.ok) throw new Error(`Failed to fetch rules: ${res.status}`);
      const data = await res.json();
      setRules(Array.isArray(data) ? data : data.rules || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch rules");
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API}/alerts/history`);
      if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : data.history || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchRules(), fetchHistory()]).finally(() => setLoading(false));
  }, [fetchRules, fetchHistory]);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function toggleRule(ruleId: string, enabled: boolean) {
    try {
      const res = await fetch(`${API}/alerts/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Toggle failed");
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
    } catch {
      // Revert optimistic update on failure
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled: !enabled } : r)));
    }
  }

  async function deleteRule(ruleId: string) {
    const prev = rules;
    setRules((r) => r.filter((rule) => rule.id !== ruleId));
    try {
      const res = await fetch(`${API}/alerts/rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setRules(prev);
    }
  }

  async function acknowledgeAlert(alertId: string) {
    try {
      const res = await fetch(`${API}/alerts/history/${alertId}/acknowledge`, { method: "POST" });
      if (!res.ok) throw new Error("Acknowledge failed");
      setHistory((prev) =>
        prev.map((h) =>
          h.id === alertId ? { ...h, acknowledged: true, acknowledged_at: new Date().toISOString() } : h
        )
      );
    } catch {
      // Silently fail
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col bg-[#0c0c14] rounded-xl border border-white/[0.06] overflow-hidden h-full min-h-0">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-violet-400" />
              <h3 className="text-xs font-semibold text-slate-200">Alerts</h3>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded text-slate-600 hover:text-slate-400 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Tab toggle */}
          <div className="flex items-center gap-1 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
            <button
              onClick={() => setTab("rules")}
              className={`flex-1 px-3 py-1 text-[10px] font-medium rounded-md transition-all ${
                tab === "rules"
                  ? "bg-violet-500/15 text-violet-300 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Rules
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 px-3 py-1 text-[10px] font-medium rounded-md transition-all ${
                tab === "history"
                  ? "bg-violet-500/15 text-violet-300 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              History
              {history.filter((h) => !h.acknowledged).length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[14px] h-3.5 px-1 text-[8px] font-bold text-white bg-amber-500 rounded-full">
                  {history.filter((h) => !h.acknowledged).length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-5 w-5 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
              <p className="text-[10px] text-slate-600 mt-2">Loading alerts...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <AlertTriangle className="h-5 w-5 text-amber-400 mb-2" />
              <p className="text-[10px] text-slate-400 text-center">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  Promise.all([fetchRules(), fetchHistory()]).finally(() => setLoading(false));
                }}
                className="mt-2 text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : tab === "rules" ? (
            <RulesTab rules={rules} onToggle={toggleRule} onDelete={deleteRule} />
          ) : (
            <HistoryTab history={history} onAcknowledge={acknowledgeAlert} />
          )}
        </div>

        {/* Footer */}
        {tab === "rules" && !loading && !error && (
          <div className="px-3 py-2 border-t border-white/[0.04] shrink-0">
            <button
              onClick={() => setCreateOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-violet-300 bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 rounded-lg transition-all"
            >
              <Plus className="h-3 w-3" />
              Create Rule
            </button>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <CreateAlertDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          fetchRules();
        }}
      />
    </>
  );
}

// ── Rules Tab ────────────────────────────────────────────────────────────────

function RulesTab({
  rules,
  onToggle,
  onDelete,
}: {
  rules: AlertRule[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Shield className="h-6 w-6 text-slate-700 mb-2" />
        <p className="text-[11px] text-slate-500">No alert rules configured</p>
        <p className="text-[10px] text-slate-600 mt-1">Create one to start monitoring your metrics</p>
      </div>
    );
  }

  return (
    <div className="p-1.5 space-y-0.5">
      <AnimatePresence mode="popLayout">
        {rules.map((rule) => (
          <motion.div
            key={rule.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <RuleCard rule={rule} onToggle={onToggle} onDelete={onDelete} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: AlertRule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const metricStyle = getMetricStyle(rule.metric);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 transition-all ${
        rule.enabled
          ? "bg-white/[0.02] border-white/[0.06]"
          : "bg-white/[0.01] border-white/[0.03] opacity-60"
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Toggle */}
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          className="shrink-0"
          aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
        >
          {rule.enabled ? (
            <ToggleRight className="h-4 w-4 text-violet-400" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-slate-600" />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-slate-200 truncate">{rule.name}</span>
            <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${metricStyle.bg} ${metricStyle.color}`}>
              {metricStyle.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-slate-500">
              {rule.operator} {rule.threshold}
            </span>
            <span className="text-[9px] text-slate-600">|</span>
            <span className="text-[9px] text-slate-500 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {rule.window}
            </span>
            <span className="text-[9px] text-slate-600">|</span>
            <span className="flex items-center gap-0.5">
              {rule.channels.map((ch) => (
                <ChannelIcon key={ch} channel={ch} />
              ))}
            </span>
          </div>
        </div>

        {/* Last fired */}
        {rule.last_fired && (
          <span className="text-[8px] text-slate-600 shrink-0">{relativeTime(rule.last_fired)}</span>
        )}

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onDelete(rule.id)}
              className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors"
              aria-label="Confirm delete"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="Cancel delete"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1 rounded text-slate-700 hover:text-red-400 transition-colors shrink-0"
            aria-label="Delete rule"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({
  history,
  onAcknowledge,
}: {
  history: AlertHistoryEntry[];
  onAcknowledge: (id: string) => void;
}) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <CheckCircle2 className="h-6 w-6 text-slate-700 mb-2" />
        <p className="text-[11px] text-slate-500">No alerts fired yet</p>
        <p className="text-[10px] text-slate-600 mt-1">When rules trigger, they will appear here</p>
      </div>
    );
  }

  // Sort newest first
  const sorted = [...history].sort(
    (a, b) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime()
  );

  return (
    <div className="p-1.5 space-y-0.5">
      <AnimatePresence mode="popLayout">
        {sorted.map((entry) => (
          <motion.div
            key={entry.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HistoryCard entry={entry} onAcknowledge={onAcknowledge} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function HistoryCard({
  entry,
  onAcknowledge,
}: {
  entry: AlertHistoryEntry;
  onAcknowledge: (id: string) => void;
}) {
  const metricStyle = getMetricStyle(entry.metric);
  const isUnack = !entry.acknowledged;

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 transition-all ${
        isUnack
          ? "bg-amber-500/[0.03] border-l-2 border-l-amber-400 border-t-white/[0.06] border-r-white/[0.06] border-b-white/[0.06]"
          : "bg-white/[0.01] border-white/[0.04] opacity-70"
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Icon */}
        {isUnack ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-slate-600 shrink-0" />
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-medium truncate ${isUnack ? "text-slate-200" : "text-slate-500"}`}>
              {entry.rule_name}
            </span>
            <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${metricStyle.bg} ${metricStyle.color}`}>
              {metricStyle.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[9px] font-mono ${isUnack ? "text-slate-400" : "text-slate-600"}`}>
              {entry.value} {entry.operator} {entry.threshold}
            </span>
            <span className="text-[9px] text-slate-600">-</span>
            <span className="text-[9px] text-slate-600">{formatTime(entry.fired_at)}</span>
          </div>
        </div>

        {/* Acknowledge button */}
        {isUnack && (
          <button
            onClick={() => onAcknowledge(entry.id)}
            className="shrink-0 flex items-center gap-1 px-2 py-1 text-[9px] font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded-md transition-all"
          >
            <Check className="h-2.5 w-2.5" />
            Ack
          </button>
        )}
      </div>
    </div>
  );
}
