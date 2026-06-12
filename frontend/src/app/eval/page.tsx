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
import { DatasetDetail, RunDetail, ComparisonView, CreateDatasetModal, SummaryCard, fmtMs } from "./detail-panels";

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
  const { isMobile, isMobileOrTablet } = useBreakpoint();

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const [tab, setTab] = useState<"datasets" | "runs">("datasets");
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  // Track the run-progress poll so it's always torn down (on unmount, or before a new run) —
  // previously the setInterval/setTimeout leaked and kept setState-ing after navigation away.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [dsRes, runRes, scorerRes] = await Promise.all([
      apiFetch<any>("/eval/datasets", { headers: th }).catch(() => ({ datasets: [] })),
      apiFetch<any>("/eval/runs", { headers: th }).catch(() => ({ runs: [] })),
      apiFetch<any>("/eval/scorers", { headers: th }).catch(() => ({ scorers: [] })),
    ]);
    setDatasets(dsRes.datasets || []);
    setRuns(runRes.runs || []);
    setScorers(scorerRes.scorers || []);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps  (eval is global — not tenant-scoped)

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  const fetchDatasetDetail = async (id: string) => {
    try {
      const ds = await apiFetch<any>(`/eval/datasets/${id}`, { headers: th });
      setSelectedDataset(ds);
      setRunDetail(null);
      setSelectedRun(null);
    } catch { /* ignore */ }
  };

  const fetchRunDetail = async (id: string) => {
    try {
      setRunDetail(await apiFetch<any>(`/eval/runs/${id}`, { headers: th }));
      setSelectedRun(id);
    } catch { /* ignore */ }
  };

  const deleteDataset = (id: string) => {
    setConfirmAction({
      title: "Delete Dataset",
      message: "This will permanently delete the dataset and all its test cases. This cannot be undone.",
      action: async () => {
        try {
          await apiFetch(`/eval/datasets/${id}`, { method: "DELETE", headers: th });
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
          await apiFetch(`/eval/runs/${id}`, { method: "DELETE", headers: th });
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
    stopPolling();
    try {
      const data = await apiFetch<any>("/eval/runs", {
        method: "POST", headers: th,
        body: {
          dataset_id: datasetId,
          scoring_functions: runScorers.map(s => ({ type: s })),
          namespace: tenant,
        },
      });
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

      // Poll for progress — tracked in refs so it's torn down on unmount / next run.
      pollRef.current = setInterval(async () => {
        try {
          const run = await apiFetch<any>(`/eval/runs/${runId}`, { headers: th });
          setRunDetail(run);
          setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: run.status, summary: run.summary || {} } : r));
          if (run.status !== "running") {
            stopPolling();
            setRunning(false);
            setStopping(false);
            const msg = run.status === "cancelled" ? "Eval stopped" : `Eval complete — ${run.summary?.pass_rate?.toFixed(0) || 0}% pass rate`;
            toastOk(msg);
          }
        } catch { /* transient — keep polling */ }
      }, 1500);
      toastOk("Evaluation started");
      pollTimeoutRef.current = setTimeout(() => { stopPolling(); setRunning(false); }, 300000);
    } catch {
      setRunning(false);
    }
  };

  const doCompare = async () => {
    if (compareIds.length !== 2) return;
    try {
      setComparison(await apiFetch<any>("/eval/compare", {
        method: "POST", headers: th,
        body: { run_id_a: compareIds[0], run_id_b: compareIds[1] },
      }));
    } catch { /* ignore */ }
  };

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
        {isMobileOrTablet && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0"
            aria-label="Toggle sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <FlaskConical className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Evaluation</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Test datasets, run evaluations, detect regressions</p>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left sidebar — desktop inline, mobile overlay */}
        {isMobileOrTablet && sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 mobile-overlay z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className={`${
          isMobileOrTablet
            ? `fixed left-0 top-0 bottom-0 z-50 w-[280px] bg-surface-1 border-r border-white/[0.06] transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`
            : "w-64 shrink-0 border-r border-white/[0.04]"
        } flex flex-col`}>
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
            {loading && <div className="flex justify-center py-8"><Spinner className="w-4 h-4 text-slate-500" /></div>}

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
                    onClick={() => { fetchDatasetDetail(ds.id); if (isMobileOrTablet) setSidebarOpen(false); }}
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
                      {run.status === "running" && <Spinner className="w-2.5 h-2.5 text-blue-400" />}
                      {run.status === "failed" && <XCircle className="w-2.5 h-2.5 text-red-400" />}
                      <span className="text-[10px] font-medium text-slate-300 truncate">{run.dataset_name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {run.namespace && (
                        <span className="text-[8px] px-1 rounded bg-violet-500/10 text-violet-300/80 font-medium" data-tooltip="Ran under tenant">{run.namespace}</span>
                      )}
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
        <div className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4">
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
                    await apiFetch(`/eval/runs/${runDetail.id}/stop`, { method: "POST", headers: th }).catch(() => {});
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
      {showCreate && (
        <CreateDatasetModal
          onClose={() => setShowCreate(false)}
          onCreate={(ds) => { setShowCreate(false); fetchAll(); fetchDatasetDetail(ds.id); toastOk("Dataset created"); }}
          tenantHeaders={th}
        />
      )}

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
