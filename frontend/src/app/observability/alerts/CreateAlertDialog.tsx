"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertCircle } from "lucide-react";
import { getApiUrl } from '@/lib/api-url';


// ── Types ────────────────────────────────────────────────────────────────────

interface CreateAlertDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// ── Metric options ───────────────────────────────────────────────────────────

const METRIC_OPTIONS = [
  { value: "failure_rate", label: "Failure Rate (%)", hint: "Percentage of failed tasks in the given window" },
  { value: "daily_cost", label: "Total Cost ($)", hint: "Accumulated cost of LLM calls" },
  { value: "p95_latency", label: "P95 Latency (ms)", hint: "95th percentile response time in milliseconds" },
  { value: "throughput", label: "Throughput (tasks)", hint: "Number of tasks processed in the window" },
  { value: "circuit_open", label: "Circuit Breaker Open", hint: "Triggers when a circuit breaker trips" },
  { value: "injection_detected", label: "Prompt Injection", hint: "Triggers on detected prompt injection attempts" },
] as const;

const OPERATORS = [">", "<", ">=", "<=", "=="] as const;
const WINDOWS = ["1h", "6h", "24h"] as const;
const CHANNELS = [
  { value: "in_app", label: "In-app" },
  { value: "webhook", label: "Webhook" },
  { value: "slack", label: "Slack" },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function CreateAlertDialog({ open, onClose, onCreated }: CreateAlertDialogProps) {
  const API = getApiUrl();
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("failure_rate");
  const [operator, setOperator] = useState<string>(">");
  const [threshold, setThreshold] = useState<string>("");
  const [window, setWindow] = useState<string>("1h");
  const [channels, setChannels] = useState<string[]>(["in_app"]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [cooldown, setCooldown] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setMetric("failure_rate");
    setOperator(">");
    setThreshold("");
    setWindow("1h");
    setChannels(["in_app"]);
    setWebhookUrl("");
    setSlackWebhook("");
    setCooldown("60");
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!threshold || isNaN(Number(threshold))) {
      setError("A valid threshold is required");
      return;
    }

    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        metric,
        operator,
        threshold: Number(threshold),
        window,
        channels,
        cooldown_minutes: Number(cooldown) || 60,
      };
      if (channels.includes("webhook") && webhookUrl.trim()) {
        body.webhook_url = webhookUrl.trim();
      }
      if (channels.includes("slack") && slackWebhook.trim()) {
        body.slack_webhook = slackWebhook.trim();
      }

      const res = await fetch(`${API}/alerts/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || `Request failed: ${res.status}`);
      }

      resetForm();
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedMetric = METRIC_OPTIONS.find((m) => m.value === metric);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 "
            onClick={handleClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-md bg-[#0f0f1c] border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
              <h2 className="text-sm font-semibold text-slate-200">Create Alert Rule</h2>
              <button
                onClick={handleClose}
                className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="High failure rate"
                  className="w-full px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
                />
              </div>

              {/* Metric */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Metric
                </label>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="w-full px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all appearance-none cursor-pointer"
                >
                  {METRIC_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#14142a] text-slate-200">
                      {opt.label}
                    </option>
                  ))}
                </select>
                {selectedMetric && (
                  <p className="mt-1 text-[9px] text-slate-600">{selectedMetric.hint}</p>
                )}
              </div>

              {/* Condition */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Condition
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                    className="px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all appearance-none cursor-pointer w-20"
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op} className="bg-[#14142a] text-slate-200">
                        {op}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder="Threshold"
                    step="any"
                    className="flex-1 px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
                  />
                </div>
              </div>

              {/* Window */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Window
                </label>
                <div className="flex items-center gap-1 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
                  {WINDOWS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setWindow(w)}
                      className={`flex-1 px-3 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                        window === w
                          ? "bg-violet-500/15 text-violet-300 shadow-sm"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              {/* Channels */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Channels
                </label>
                <div className="flex items-center gap-3">
                  {CHANNELS.map((ch) => (
                    <label
                      key={ch.value}
                      className="flex items-center gap-1.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={channels.includes(ch.value)}
                        onChange={() => toggleChannel(ch.value)}
                        className="h-3.5 w-3.5 rounded border-white/[0.15] bg-white/[0.03] text-violet-500 focus:ring-violet-500/30 focus:ring-offset-0"
                      />
                      <span className="text-[10px] text-slate-400">{ch.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Webhook URL (conditional) */}
              {channels.includes("webhook") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                    Webhook URL
                  </label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-endpoint.com/webhook"
                    className="w-full px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
                  />
                </motion.div>
              )}

              {/* Slack Webhook (conditional) */}
              {channels.includes("slack") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                    Slack Webhook
                  </label>
                  <input
                    type="url"
                    value={slackWebhook}
                    onChange={(e) => setSlackWebhook(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    className="w-full px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
                  />
                </motion.div>
              )}

              {/* Cooldown */}
              <div>
                <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1.5">
                  Cooldown (minutes)
                </label>
                <input
                  type="number"
                  value={cooldown}
                  onChange={(e) => setCooldown(e.target.value)}
                  min={1}
                  className="w-24 px-3 py-2 text-[11px] text-slate-200 bg-white/[0.03] border border-white/[0.08] rounded-lg focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
                />
                <p className="mt-1 text-[9px] text-slate-600">Minimum time between repeated alerts for this rule</p>
              </div>

              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg"
                >
                  <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  <p className="text-[10px] text-red-300">{error}</p>
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 text-[11px] font-medium text-slate-400 bg-white/[0.03] border border-white/[0.06] rounded-lg hover:bg-white/[0.05] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed border border-violet-500/50 rounded-lg transition-all shadow-sm shadow-violet-500/20"
                >
                  {submitting ? "Creating..." : "Create Rule"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
