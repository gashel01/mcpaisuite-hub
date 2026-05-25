"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, FileJson, FileSpreadsheet, Loader2, Trash2, Settings2,
  Calendar, AlertTriangle, X,
} from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

interface Props {
  open: boolean;
  onClose: () => void;
  namespace: string;
}

interface Retention {
  retain_days: number;
  retain_min_count: number;
  auto_cleanup: boolean;
  task_count: number;
  deletable: number;
}

export default function ExportRetentionDialog({ open, onClose, namespace }: Props) {
  const [tab, setTab] = useState<"export" | "retention">("export");

  // Export state
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);

  // Retention state
  const [retention, setRetention] = useState<Retention | null>(null);
  const [retainDays, setRetainDays] = useState(30);
  const [retainMin, setRetainMin] = useState(100);
  const [autoCleanup, setAutoCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<string>("");

  const th = { "X-Tenant-Id": namespace };

  // Load retention config
  useEffect(() => {
    if (!open) return;
    fetch(`${BASE}/retention`, { headers: th })
      .then(r => r.json())
      .then(data => {
        setRetention(data);
        setRetainDays(data.retain_days || 30);
        setRetainMin(data.retain_min_count || 100);
        setAutoCleanup(data.auto_cleanup || false);
      })
      .catch(() => {});
  }, [open]); // eslint-disable-line

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo).toISOString());

      const res = await fetch(`${BASE}/export/traces?${params}`, { headers: th });
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `traces-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent
    }
    setExporting(false);
  };

  const saveRetention = async () => {
    await fetch(`${BASE}/retention`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify({ retain_days: retainDays, retain_min_count: retainMin, auto_cleanup: autoCleanup }),
    });
    // Refresh
    const res = await fetch(`${BASE}/retention`, { headers: th });
    if (res.ok) setRetention(await res.json());
  };

  const runCleanup = async () => {
    setCleaning(true);
    setCleanResult("");
    try {
      const res = await fetch(`${BASE}/retention/cleanup`, { method: "POST", headers: th });
      if (res.ok) {
        const data = await res.json();
        setCleanResult(`Deleted ${data.deleted} tasks. ${data.remaining} remaining.`);
        // Refresh retention info
        const r2 = await fetch(`${BASE}/retention`, { headers: th });
        if (r2.ok) setRetention(await r2.json());
      }
    } catch {
      setCleanResult("Cleanup failed");
    }
    setCleaning(false);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95 }}
        className="bg-[#0f0f1c] border border-white/[0.08] rounded-xl w-[460px] max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">Export & Retention</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-4 py-2 border-b border-white/[0.04]">
          {(["export", "retention"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[10px] font-medium rounded-md transition-colors capitalize ${
                tab === t ? "bg-violet-500/10 text-violet-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "export" ? <Download className="w-3 h-3 inline mr-1" /> : <Settings2 className="w-3 h-3 inline mr-1" />}
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4">
          {tab === "export" && (
            <div className="space-y-4">
              {/* Format */}
              <div>
                <label className="text-[10px] text-slate-500 block mb-1.5">Format</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFormat("json")}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-md border text-[10px] transition-colors ${
                      format === "json"
                        ? "bg-violet-500/10 border-violet-500/20 text-violet-300"
                        : "border-white/[0.06] text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <FileJson className="w-3.5 h-3.5" />
                    JSON (with spans)
                  </button>
                  <button
                    onClick={() => setFormat("csv")}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-md border text-[10px] transition-colors ${
                      format === "csv"
                        ? "bg-violet-500/10 border-violet-500/20 text-violet-300"
                        : "border-white/[0.06] text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    CSV (summary)
                  </button>
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">
                    <Calendar className="w-2.5 h-2.5 inline mr-1" />From
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-[10px] text-slate-300 outline-none focus:border-violet-500/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">
                    <Calendar className="w-2.5 h-2.5 inline mr-1" />To
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-[10px] text-slate-300 outline-none focus:border-violet-500/30"
                  />
                </div>
              </div>

              <div className="text-[9px] text-slate-600">
                {format === "json" ? "Full export with turns, spans, and annotations" : "Summary table with task metrics"}
                {!dateFrom && !dateTo && " — all available traces"}
              </div>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-md text-xs font-medium transition-colors disabled:opacity-40"
              >
                {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                {exporting ? "Exporting..." : "Download Export"}
              </button>
            </div>
          )}

          {tab === "retention" && (
            <div className="space-y-4">
              {/* Current status */}
              {retention && (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[9px] text-slate-500">Stored tasks</div>
                    <div className="text-sm font-semibold text-slate-300">{retention.task_count}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">Eligible for deletion</div>
                    <div className="text-sm font-semibold text-amber-400">{retention.deletable}</div>
                  </div>
                </div>
              )}

              {/* Config */}
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Retain traces for (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={retainDays}
                    onChange={e => setRetainDays(parseInt(e.target.value) || 30)}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-slate-300 outline-none focus:border-violet-500/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Minimum traces to keep</label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={retainMin}
                    onChange={e => setRetainMin(parseInt(e.target.value) || 0)}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-xs text-slate-300 outline-none focus:border-violet-500/30"
                  />
                  <p className="text-[8px] text-slate-600 mt-0.5">Even if older than retention window</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCleanup}
                    onChange={e => setAutoCleanup(e.target.checked)}
                    className="rounded border-white/[0.1] bg-white/[0.03] accent-violet-500"
                  />
                  <span className="text-[10px] text-slate-400">Auto-cleanup on startup</span>
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={saveRetention}
                  className="flex-1 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-md text-xs font-medium transition-colors"
                >
                  Save Policy
                </button>
                <button
                  onClick={runCleanup}
                  disabled={cleaning || (retention?.deletable ?? 0) === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-md text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {cleaning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Cleanup Now
                </button>
              </div>

              {cleanResult && (
                <div className="text-[10px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 rounded-md px-3 py-2">
                  {cleanResult}
                </div>
              )}

              <div className="flex items-start gap-1.5 text-[9px] text-slate-600">
                <AlertTriangle className="w-3 h-3 text-amber-500/50 shrink-0 mt-0.5" />
                <span>Cleanup permanently deletes task files. Annotations are preserved.</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
