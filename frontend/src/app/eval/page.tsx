"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState, useEffect, useCallback, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical, Plus, Play, Trash2, ChevronRight, CheckCircle2,
  XCircle, Clock, BarChart3, GitCompare, Loader2, Upload, Download,
  FileText, AlertCircle,
} from "lucide-react";
import PageHeader from "@/components/page-header";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { useToast } from "@/components/ui/toast";
import ConfirmDialog from "@/components/ui/confirm";


// ── Types ──────────────────────────────────────────────────────────────────

interface Dataset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  case_count: number;
  cases?: EvalCase[];
  created_at: string;
  updated_at: string;
}

interface EvalCase {
  id: string;
  input: string;
  expected_output: string;
  tags: string[];
}

interface EvalRun {
  id: string;
  dataset_id: string;
  dataset_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: RunSummary;
}

interface RunSummary {
  total_cases: number;
  avg_score: number;
  pass_rate: number;
  total_duration_ms: number;
  scores_by_scorer?: Record<string, { avg: number; count: number }>;
}

interface RunResult {
  case_id: string;
  input: string;
  expected: string;
  output: string;
  scores: { scorer: string; score: number; passed: boolean; detail: string }[];
  error: string;
  duration_ms: number;
}

interface Scorer {
  type: string;
  description: string;
}

// ── Page ───────────────────────────────────────────────────────────────────

const BASE = getApiUrl();

export default function EvalPage() {
  return (
    <Suspense>
      <EvalInner />
    </Suspense>
  );
}

function EvalInner() {
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);
  const { success: toastOk, error: toastErr } = useToast();

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const [tab, setTab] = useState<"datasets" | "runs">("datasets");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [scorers, setScorers] = useState<Scorer[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail views
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<any>(null);

  // Create dataset modal
  const [showCreate, setShowCreate] = useState(false);

  // Run config
  const [runScorers, setRunScorers] = useState<string[]>(["contains"]);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [dsRes, runRes, scorerRes] = await Promise.all([
      fetch(`${BASE}/eval/datasets`, { headers: th }).then(r => r.json()).catch(() => ({ datasets: [] })),
      fetch(`${BASE}/eval/runs`, { headers: th }).then(r => r.json()).catch(() => ({ runs: [] })),
      fetch(`${BASE}/eval/scorers`, { headers: th }).then(r => r.json()).catch(() => ({ scorers: [] })),
    ]);
    setDatasets(dsRes.datasets || []);
    setRuns(runRes.runs || []);
    setScorers(scorerRes.scorers || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  const fetchDatasetDetail = async (id: string) => {
    const res = await fetch(`${BASE}/eval/datasets/${id}`, { headers: th });
    if (res.ok) {
      const ds = await res.json();
      setSelectedDataset(ds);
      setRunDetail(null);
      setSelectedRun(null);
    }
  };

  const fetchRunDetail = async (id: string) => {
    const res = await fetch(`${BASE}/eval/runs/${id}`, { headers: th });
    if (res.ok) {
      setRunDetail(await res.json());
      setSelectedRun(id);
    }
  };

  const deleteDataset = (id: string) => {
    setConfirmAction({
      title: "Delete Dataset",
      message: "This will permanently delete the dataset and all its test cases. This cannot be undone.",
      action: async () => {
        try {
          const res = await fetch(`${BASE}/eval/datasets/${id}`, { method: "DELETE", headers: th });
          if (!res.ok) throw new Error("Delete failed");
          setSelectedDataset(null);
          fetchAll();
          toastOk("Dataset deleted");
        } catch { toastErr("Failed to delete dataset"); }
      },
    });
  };

  const deleteRun = (id: string) => {
    setConfirmAction({
      title: "Delete Run",
      message: "This will permanently delete this evaluation run and its results.",
      action: async () => {
        try {
          const res = await fetch(`${BASE}/eval/runs/${id}`, { method: "DELETE", headers: th });
          if (!res.ok) throw new Error("Delete failed");
          setSelectedRun(null);
          setRunDetail(null);
          fetchAll();
          toastOk("Run deleted");
        } catch { toastErr("Failed to delete run"); }
      },
    });
  };

  const startRun = async (datasetId: string) => {
    setRunning(true);
    try {
      const res = await fetch(`${BASE}/eval/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({
          dataset_id: datasetId,
          scoring_functions: runScorers.map(s => ({ type: s })),
          namespace: tenant,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const runId = data.run_id;

        // Switch to run view immediately
        setSelectedDataset(null);
        setSelectedRun(runId);
        setTab("runs");

        // Add placeholder to sidebar (avoid duplicates from fetchAll)
        setRuns(prev => {
          if (prev.some(r => r.id === runId)) return prev;
          return [{
            id: runId, dataset_id: datasetId, dataset_name: selectedDataset?.name || "",
            status: "running", started_at: new Date().toISOString(), completed_at: null,
            summary: {} as RunSummary,
          }, ...prev];
        });

        // Poll for progress
        const pollId = setInterval(async () => {
          const r = await fetch(`${BASE}/eval/runs/${runId}`, { headers: th });
          if (r.ok) {
            const run = await r.json();
            setRunDetail(run);
            // Update sidebar entry
            setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: run.status, summary: run.summary || {} } : r));
            if (run.status !== "running") {
              clearInterval(pollId);
              setRunning(false);
              setStopping(false);
              const msg = run.status === "cancelled" ? "Eval stopped" : `Eval complete — ${run.summary?.pass_rate?.toFixed(0) || 0}% pass rate`;
              toastOk(msg);
            }
          }
        }, 1500);
        toastOk("Evaluation started");
        setTimeout(() => { clearInterval(pollId); setRunning(false); }, 300000);
      }
    } catch {
      setRunning(false);
    }
  };

  const doCompare = async () => {
    if (compareIds.length !== 2) return;
    const res = await fetch(`${BASE}/eval/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify({ run_id_a: compareIds[0], run_id_b: compareIds[1] }),
    });
    if (res.ok) setComparison(await res.json());
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader
        title="Evaluation"
        subtitle="Test datasets, run evaluations, detect regressions"
        icon={FlaskConical}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-64 shrink-0 border-r border-white/[0.04] flex flex-col">
          {/* Tab selector */}
          <div className="flex items-center gap-0.5 p-2 border-b border-white/[0.04]">
            {(["datasets", "runs"] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedDataset(null); setSelectedRun(null); setComparison(null); }}
                className={`flex-1 px-3 py-1.5 text-[10px] font-medium rounded-md transition-all capitalize ${
                  tab === t ? "bg-violet-500/10 text-violet-300 border border-violet-500/20" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t === "datasets" ? <FileText className="w-3 h-3 inline mr-1" /> : <BarChart3 className="w-3 h-3 inline mr-1" />}
                {t}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading && <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-slate-500" /></div>}

            {tab === "datasets" && (
              <>
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-violet-400 hover:bg-violet-500/5 rounded-md transition-colors border border-dashed border-violet-500/20"
                >
                  <Plus className="w-3 h-3" /> New Dataset
                </button>
                {datasets.map(ds => (
                  <button
                    key={ds.id}
                    onClick={() => fetchDatasetDetail(ds.id)}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                      selectedDataset?.id === ds.id ? "bg-violet-500/10 border border-violet-500/20" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="text-[10px] font-medium text-slate-300 truncate">{ds.name}</div>
                    <div className="text-[9px] text-slate-500">{ds.case_count} cases</div>
                  </button>
                ))}
                {!loading && datasets.length === 0 && (
                  <div className="text-center py-6 text-[10px] text-slate-500">No datasets yet</div>
                )}
              </>
            )}

            {tab === "runs" && (
              <>
                {compareMode && (
                  <div className="px-2 py-1.5 bg-blue-500/5 border border-blue-500/20 rounded-md text-[9px] text-blue-300 mb-1">
                    Select 2 runs to compare ({compareIds.length}/2)
                    <button onClick={() => { setCompareMode(false); setCompareIds([]); }} className="ml-2 text-blue-400 hover:text-blue-300">Cancel</button>
                    {compareIds.length === 2 && (
                      <button onClick={doCompare} className="ml-2 text-emerald-400 hover:text-emerald-300 font-medium">Compare</button>
                    )}
                  </div>
                )}
                {!compareMode && runs.length >= 2 && (
                  <button
                    onClick={() => setCompareMode(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-blue-400 hover:bg-blue-500/5 rounded-md transition-colors border border-dashed border-blue-500/20"
                  >
                    <GitCompare className="w-3 h-3" /> Compare Runs
                  </button>
                )}
                {runs.map(run => (
                  <button
                    key={run.id}
                    onClick={() => {
                      if (compareMode) {
                        setCompareIds(prev =>
                          prev.includes(run.id)
                            ? prev.filter(id => id !== run.id)
                            : prev.length < 2 ? [...prev, run.id] : prev
                        );
                      } else {
                        fetchRunDetail(run.id);
                      }
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                      (selectedRun === run.id || compareIds.includes(run.id))
                        ? "bg-violet-500/10 border border-violet-500/20"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {run.status === "completed" && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />}
                      {run.status === "running" && <Loader2 className="w-2.5 h-2.5 text-blue-400 animate-spin" />}
                      {run.status === "failed" && <XCircle className="w-2.5 h-2.5 text-red-400" />}
                      <span className="text-[10px] font-medium text-slate-300 truncate">{run.dataset_name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {run.summary?.avg_score != null && (
                        <span className="text-[9px] text-slate-500">Score: {(run.summary.avg_score * 100).toFixed(0)}%</span>
                      )}
                      {run.summary?.pass_rate != null && (
                        <span className="text-[9px] text-slate-500">Pass: {run.summary.pass_rate.toFixed(0)}%</span>
                      )}
                    </div>
                    <div className="text-[8px] text-slate-600 mt-0.5">
                      {new Date(run.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </button>
                ))}
                {!loading && runs.length === 0 && (
                  <div className="text-center py-6 text-[10px] text-slate-500">No eval runs yet</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          <AnimatePresence mode="wait">
            {/* Dataset detail (hidden when viewing a run) */}
            {selectedDataset && !runDetail && (
              <motion.div key="dataset" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <DatasetDetail
                  dataset={selectedDataset}
                  scorers={scorers}
                  runScorers={runScorers}
                  setRunScorers={setRunScorers}
                  onRun={() => startRun(selectedDataset.id)}
                  onDelete={() => deleteDataset(selectedDataset.id)}
                  onUpdate={(ds) => { setSelectedDataset(ds); fetchAll(); }}
                  running={running}
                  tenantHeaders={th}
                />
              </motion.div>
            )}

            {/* Run detail */}
            {runDetail && !comparison && (
              <motion.div key="run" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <RunDetail
                  run={runDetail}
                  onDelete={() => deleteRun(runDetail.id)}
                  onBackToDataset={() => {
                    const dsId = runDetail.dataset_id;
                    setRunDetail(null);
                    setSelectedRun(null);
                    if (dsId) { fetchDatasetDetail(dsId); setTab("datasets"); }
                  }}
                  stopping={stopping}
                  onStop={async () => {
                    setStopping(true);
                    await fetch(`${BASE}/eval/runs/${runDetail.id}/stop`, { method: "POST", headers: th });
                    // Polling will detect the status change and update UI
                  }}
                />
              </motion.div>
            )}

            {/* Comparison */}
            {comparison && (
              <motion.div key="compare" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <ComparisonView data={comparison} onClose={() => { setComparison(null); setCompareMode(false); setCompareIds([]); }} />
              </motion.div>
            )}

            {/* Empty state */}
            {!selectedDataset && !runDetail && !comparison && !loading && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full text-slate-500">
                <FlaskConical className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-sm font-medium text-slate-400">Evaluation Framework</p>
                <div className="mt-4 space-y-2 text-[10px] text-slate-500">
                  <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center text-[9px] font-bold">1</span> Create a dataset with test cases</div>
                  <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center text-[9px] font-bold">2</span> Select scoring functions and run an eval</div>
                  <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center text-[9px] font-bold">3</span> Compare runs to detect regressions</div>
                </div>
                <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-md text-xs font-medium transition-colors">
                  <Plus className="w-3 h-3" /> Create Your First Dataset
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Create dataset modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateDatasetModal
            onClose={() => setShowCreate(false)}
            onCreate={(ds) => { setShowCreate(false); fetchAll(); fetchDatasetDetail(ds.id); toastOk("Dataset created"); }}
            tenantHeaders={th}
          />
        )}
      </AnimatePresence>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || ""}
        message={confirmAction?.message || ""}
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null); }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}


// ── Dataset Detail ─────────────────────────────────────────────────────────

function DatasetDetail({ dataset, scorers, runScorers, setRunScorers, onRun, onDelete, onUpdate, running, tenantHeaders: th }: {
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
    const res = await fetch(`${BASE}/eval/datasets/${dataset.id}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify({ cases: [newCase] }),
    });
    if (res.ok) {
      const ds = await res.json();
      onUpdate(ds);
      setNewCase({ input: "", expected_output: "" });
      setShowAddCase(false);
    }
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
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
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

function RunDetail({ run, onDelete, onStop, stopping, onBackToDataset }: { run: any; onDelete: () => void; onStop?: () => void; stopping?: boolean; onBackToDataset?: () => void }) {
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
                <Loader2 className="w-3 h-3 animate-spin" />
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
            {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
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
              <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
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
                  <Loader2 className="w-3 h-3 text-violet-400 animate-spin shrink-0" />
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

function ComparisonView({ data, onClose }: { data: any; onClose: () => void }) {
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

function CreateDatasetModal({ onClose, onCreate, tenantHeaders: th }: {
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
    const res = await fetch(`${BASE}/eval/datasets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...th },
      body: JSON.stringify({ name, description, cases }),
    });
    if (res.ok) onCreate(await res.json());
  };

  const importJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const res = await fetch(`${BASE}/eval/datasets/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify(data),
      });
      if (res.ok) onCreate(await res.json());
    } catch {
      // Invalid JSON
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 "
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95 }}
        className="bg-[#0f0f1c] border border-white/[0.08] rounded-xl p-5 w-[500px] max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
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
      </motion.div>
    </motion.div>
  );
}


// ── Shared sub-components ──────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0f0f1c] border border-white/[0.06] rounded-lg p-2.5 text-center">
      <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
