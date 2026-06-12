"use client";
import { apiFetch } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical, Plus, Play, Trash2, ChevronRight, CheckCircle2,
  XCircle, Clock, BarChart3, GitCompare, Upload, Download,
  FileText, AlertCircle, Menu, PanelLeftOpen,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useToast } from "@/components/ui/toast";
import ConfirmDialog from "@/components/ui/confirm";
import { Modal } from "@/components/ui/Modal";
import type { Dataset, EvalCase, EvalRun, RunSummary, RunResult, Scorer } from "./types";

export function DatasetDetail({ dataset, scorers, runScorers, setRunScorers, onRun, onDelete, onUpdate, running, tenantHeaders: th }: {
  dataset: Dataset;
  scorers: Scorer[];
  runScorers: string[];
  setRunScorers: (s: string[]) => void;
  onRun: () => void;
  onDelete: () => void;
  onUpdate: (ds: Dataset) => void;
  running: boolean;
  tenantHeaders: Record<string, string>;
}) {
  const [editingCase, setEditingCase] = useState<string | null>(null);
  const [newCase, setNewCase] = useState({ input: "", expected_output: "" });
  const [showAddCase, setShowAddCase] = useState(false);

  const cases = dataset.cases || [];

  const addCase = async () => {
    if (!newCase.input.trim()) return;
    try {
      const ds = await apiFetch<any>(`/eval/datasets/${dataset.id}/cases`, {
        method: "POST", headers: th, body: { cases: [newCase] },
      });
      onUpdate(ds);
      setNewCase({ input: "", expected_output: "" });
      setShowAddCase(false);
    } catch { /* ignore */ }
  };

  const exportDataset = () => {
    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset.name.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{dataset.name}</h2>
          {dataset.description && <p className="text-[10px] text-slate-500 mt-0.5">{dataset.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportDataset} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors" title="Export">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 text-red-400/50 hover:text-red-400 transition-colors" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Run config */}
      <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3">
        <div className="text-[10px] font-medium text-slate-400 mb-2">Scoring Functions</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {scorers.map(s => (
            <button
              key={s.type}
              onClick={() => setRunScorers(
                runScorers.includes(s.type) ? runScorers.filter(x => x !== s.type) : [...runScorers, s.type]
              )}
              className={`px-2 py-1 text-[9px] rounded-md border transition-colors ${
                runScorers.includes(s.type)
                  ? "bg-violet-500/10 border-violet-500/30 text-violet-300"
                  : "border-white/[0.06] text-slate-500 hover:text-slate-300"
              }`}
              title={s.description}
            >
              {s.type}
            </button>
          ))}
        </div>
        <button
          onClick={onRun}
          disabled={running || cases.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? <Spinner className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {running ? "Running..." : `Run Eval (${cases.length} cases)`}
        </button>
      </div>

      {/* Cases list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium text-slate-400">Test Cases ({cases.length})</h3>
          <button
            onClick={() => setShowAddCase(true)}
            className="flex items-center gap-1 px-2 py-1 text-[9px] text-violet-400 hover:bg-violet-500/5 rounded transition-colors"
          >
            <Plus className="w-2.5 h-2.5" /> Add Case
          </button>
        </div>

        {showAddCase && (
          <div className="bg-[#0f0f1c] border border-violet-500/20 rounded-lg p-3 space-y-2">
            <input
              value={newCase.input}
              onChange={e => setNewCase(p => ({ ...p, input: e.target.value }))}
              placeholder="Input (question/prompt)..."
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5 text-[10px] text-slate-300 placeholder:text-slate-600 outline-none focus:border-violet-500/30"
            />
            <input
              value={newCase.expected_output}
              onChange={e => setNewCase(p => ({ ...p, expected_output: e.target.value }))}
              placeholder="Expected output (for scoring)..."
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded px-2.5 py-1.5 text-[10px] text-slate-300 placeholder:text-slate-600 outline-none focus:border-violet-500/30"
            />
            <div className="flex gap-2">
              <button onClick={addCase} className="px-3 py-1 text-[9px] bg-violet-500/20 text-violet-300 rounded hover:bg-violet-500/30 transition-colors">Add</button>
              <button onClick={() => setShowAddCase(false)} className="px-3 py-1 text-[9px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {cases.map((c, i) => (
          <div key={c.id} className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-2.5 hover:border-white/[0.1] transition-colors">
            <div className="flex items-start gap-2">
              <span className="text-[8px] text-slate-600 font-mono mt-0.5 shrink-0">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-300">{c.input}</div>
                {c.expected_output && (
                  <div className="text-[9px] text-slate-500 mt-0.5 flex items-center gap-1">
                    <ChevronRight className="w-2 h-2" />
                    <span className="truncate">{c.expected_output}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {cases.length === 0 && (
          <div className="text-center py-6 text-[10px] text-slate-500">
            No test cases yet. Add some to start evaluating.
          </div>
        )}
      </div>
    </div>
  );
}


// ── Run Detail ─────────────────────────────────────────────────────────────

export function RunDetail({ run, onDelete, onStop, stopping, onBackToDataset }: { run: any; onDelete: () => void; onStop?: () => void; stopping?: boolean; onBackToDataset?: () => void }) {
  const summary = run.summary || {};
  const results: RunResult[] = run.results || [];
  const isRunning = run.status === "running";
  const isCancelled = run.status === "cancelled";
  const totalCases = run.total_cases || summary.total_cases || results.length;
  const completedCases = run.completed_cases || results.length;

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      {onBackToDataset && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <button onClick={onBackToDataset} className="text-violet-400 hover:text-violet-300 transition-colors">
            {run.dataset_name}
          </button>
          <ChevronRight className="w-3 h-3 text-slate-600" />
          <span className="text-slate-400">Run {new Date(run.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{run.dataset_name}</h2>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
            <span>{new Date(run.started_at).toLocaleString()}</span>
            {isRunning ? (
              <span className="flex items-center gap-1 text-violet-400">
                <Spinner className="w-3 h-3" />
                Running {completedCases}/{totalCases}
              </span>
            ) : isCancelled ? (
              <span className="text-amber-400">Stopped ({completedCases}/{totalCases} completed)</span>
            ) : (
              <span className="text-emerald-400">Completed</span>
            )}
          </div>
        </div>
        {isRunning ? (
          <button
            onClick={onStop}
            disabled={stopping}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium transition-colors ${
              stopping ? "bg-amber-500/10 text-amber-300" : "bg-red-500/10 hover:bg-red-500/20 text-red-300"
            }`}
          >
            {stopping ? <Spinner className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {stopping ? "Stopping..." : "Stop"}
          </button>
        ) : (
          <button onClick={onDelete} className="p-1.5 text-red-400/50 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Progress bar (during run) */}
      {isRunning && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-400">Progress</span>
            <span className="text-violet-300 font-mono">{completedCases} / {totalCases}</span>
          </div>
          <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500/60 rounded-full transition-all duration-500"
              style={{ width: `${totalCases > 0 ? (completedCases / totalCases) * 100 : 0}%` }}
            />
          </div>
          {run.current_case && (
            <div className="text-[10px] text-slate-500 truncate">
              <Spinner className="w-3 h-3 inline mr-1" />
              {run.current_case}
            </div>
          )}
        </div>
      )}

      {/* Summary cards (show even during run with partial data) */}
      <div className="grid grid-cols-4 gap-2">
        {isRunning ? (
          <>
            <SummaryCard label="Completed" value={`${completedCases}/${totalCases}`} color="#8b5cf6" />
            <SummaryCard label="Passed" value={String(results.filter(r => r.scores?.every(s => s.passed)).length)} color="#10b981" />
            <SummaryCard label="Failed" value={String(results.filter(r => r.scores?.some(s => !s.passed)).length)} color="#ef4444" />
            <SummaryCard label="Errors" value={String(results.filter(r => r.error).length)} color="#f59e0b" />
          </>
        ) : (
          <>
            <SummaryCard label="Avg Score" value={`${((summary.avg_score || 0) * 100).toFixed(0)}%`} color={(summary.avg_score || 0) >= 0.7 ? "#10b981" : (summary.avg_score || 0) >= 0.4 ? "#f59e0b" : "#ef4444"} />
            <SummaryCard label="Pass Rate" value={`${summary.pass_rate?.toFixed(0) ?? 0}%`} color="#8b5cf6" />
            <SummaryCard label="Cases" value={String(totalCases)} color="#3b82f6" />
            <SummaryCard label="Duration" value={fmtMs(summary.total_duration_ms || 0)} color="#ec4899" />
          </>
        )}
      </div>

      {/* Scorer breakdown */}
      {summary.scores_by_scorer && Object.keys(summary.scores_by_scorer).length > 0 && (
        <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-3">
          <h4 className="text-[10px] font-medium text-slate-400 mb-2">By Scorer</h4>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(summary.scores_by_scorer).map(([name, data]: [string, any]) => (
              <div key={name} className="text-center">
                <div className="text-[9px] text-slate-500">{name}</div>
                <div className="text-sm font-semibold text-slate-300">{(data.avg * 100).toFixed(0)}%</div>
                <div className="text-[8px] text-slate-600">{data.count} scores</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-case results */}
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-medium text-slate-400">
          Results ({results.length}{isRunning ? ` / ${totalCases}` : ""})
        </h3>
        {results.map((r, i) => {
          const allPassed = r.scores?.length > 0 ? r.scores.every(s => s.passed) : false;
          const isCurrent = isRunning && i === results.length - 1 && !r.scores?.length;
          return (
            <div key={r.case_id} className={`bg-[#0f0f1c] border rounded-lg p-2.5 ${
              isCurrent ? "border-violet-500/30 bg-violet-500/5" : "border-white/[0.06]"
            }`}>
              <div className="flex items-center gap-2 mb-1">
                {isCurrent ? (
                  <Spinner className="w-3 h-3 text-violet-400 shrink-0" />
                ) : allPassed ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : r.error ? (
                  <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                )}
                <span className="text-[10px] text-slate-300 truncate flex-1">{r.input}</span>
                <span className="text-[9px] font-mono text-slate-500">{r.duration_ms ? fmtMs(r.duration_ms) : ""}</span>
              </div>
              {r.output && (
                <div className="text-[9px] text-slate-400 bg-white/[0.02] rounded p-1.5 mb-1 max-h-16 overflow-y-auto">
                  {r.output}
                </div>
              )}
              {r.error && (
                <div className="text-[9px] text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-2.5 h-2.5" /> {r.error}
                </div>
              )}
              <div className="flex gap-2 mt-1">
                {r.scores.map((s, j) => (
                  <span
                    key={j}
                    className={`text-[8px] px-1.5 py-0.5 rounded ${
                      s.passed ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                    }`}
                    title={s.detail}
                  >
                    {s.scorer}: {(s.score * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Comparison View ────────────────────────────────────────────────────────

export function ComparisonView({ data, onClose }: { data: any; onClose: () => void }) {
  const diffs = data.diffs || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Run Comparison</h2>
        </div>
        <button onClick={onClose} className="text-[10px] text-slate-500 hover:text-slate-300">Close</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Improved" value={String(data.improved)} color="#10b981" />
        <SummaryCard label="Regressed" value={String(data.regressed)} color="#ef4444" />
        <SummaryCard label="Unchanged" value={String(data.unchanged)} color="#64748b" />
      </div>

      {/* Diffs */}
      <div className="space-y-1.5">
        {diffs.map((d: any) => (
          <div key={d.case_id} className={`bg-[#0f0f1c] border rounded-lg p-2.5 ${
            d.status === "improved" ? "border-emerald-500/20" : d.status === "regressed" ? "border-red-500/20" : "border-white/[0.06]"
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-medium ${
                d.status === "improved" ? "bg-emerald-500/10 text-emerald-400" :
                d.status === "regressed" ? "bg-red-500/10 text-red-400" :
                "bg-slate-500/10 text-slate-400"
              }`}>
                {d.status}
              </span>
              <span className="text-[10px] text-slate-300 truncate flex-1">{d.input}</span>
              <span className="text-[9px] font-mono text-slate-500">
                {d.delta > 0 ? "+" : ""}{(d.delta * 100).toFixed(0)}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[9px]">
              <div>
                <span className="text-slate-500">Run A: </span>
                <span className="text-slate-400">{d.score_a != null ? `${(d.score_a * 100).toFixed(0)}%` : "—"}</span>
              </div>
              <div>
                <span className="text-slate-500">Run B: </span>
                <span className="text-slate-400">{d.score_b != null ? `${(d.score_b * 100).toFixed(0)}%` : "—"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Create Dataset Modal ───────────────────────────────────────────────────

export function CreateDatasetModal({ onClose, onCreate, tenantHeaders: th }: {
  onClose: () => void;
  onCreate: (ds: any) => void;
  tenantHeaders: Record<string, string>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [casesText, setCasesText] = useState("");
  const [importMode, setImportMode] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    // Parse cases from text (one per line: input | expected)
    const cases = casesText.split("\n").filter(l => l.trim()).map(line => {
      const [input, expected] = line.split("|").map(s => s.trim());
      return { input: input || "", expected_output: expected || "" };
    });
    try {
      onCreate(await apiFetch<any>("/eval/datasets", {
        method: "POST", headers: th, body: { name, description, cases },
      }));
    } catch { /* ignore */ }
  };

  const importJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      onCreate(await apiFetch<any>("/eval/datasets/import", { method: "POST", headers: th, body: data }));
    } catch {
      // Invalid JSON
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      backdropClassName="z-50 bg-black/50"
      className="bg-[#0f0f1c] border border-white/[0.08] rounded-xl p-5 w-[500px] max-h-[80vh] overflow-y-auto"
    >
        <h3 className="text-sm font-semibold text-white mb-4">Create Evaluation Dataset</h3>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Weather Queries, Code Tasks..."
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 outline-none focus:border-violet-500/30"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 outline-none focus:border-violet-500/30"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-slate-500">Test Cases</label>
              <label className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-violet-300 cursor-pointer">
                <Upload className="w-2.5 h-2.5" />
                Import JSON
                <input type="file" accept=".json" className="hidden" onChange={importJson} />
              </label>
            </div>
            <textarea
              value={casesText}
              onChange={e => setCasesText(e.target.value)}
              placeholder={"One per line: input | expected output\n\nExamples:\nWhat is 2+2? | 4\nCapital of France? | Paris\nList 3 colors | red, blue, green"}
              rows={6}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 outline-none focus:border-violet-500/30 font-mono resize-y"
            />
            <p className="text-[8px] text-slate-600 mt-0.5">Format: input | expected_output (one per line)</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
          <button
            onClick={create}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-[10px] bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-md font-medium transition-colors disabled:opacity-40"
          >
            Create
          </button>
        </div>
    </Modal>
  );
}


// ── Shared sub-components ──────────────────────────────────────────────────

export function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-2.5 text-center">
      <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
