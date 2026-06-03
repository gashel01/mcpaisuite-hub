"use client";

import { useState } from "react";
import {
  PanelLeftOpen, PanelLeftClose, Save, CheckCircle2, XCircle,
  ChevronLeft, Calendar, Copy, Trash, FolderOpen, Clock,
  Loader2, PauseCircle, ArrowLeftRight,
} from "lucide-react";
import type { Workflow, WorkflowVersion, WorkflowRun, WorkflowSchedule } from "@/stores/workflow-store";
import type { CompareItem } from "./compare-view";

interface LibraryPanelProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  workflows: Workflow[];
  schedules: WorkflowSchedule[];
  activeWorkflowId?: string;
  activeVersionId?: string;
  activeRunId?: string;
  canSave: boolean;
  onSave: () => void;
  onLoadVersion: (workflow: Workflow, version: WorkflowVersion) => void;
  onViewRun: (workflow: Workflow, version: WorkflowVersion, run: WorkflowRun) => void;
  onForkVersion: (workflow: Workflow, version: WorkflowVersion) => void;
  onDeleteWorkflow: (id: string) => void;
  onDeleteSchedule: (id: string) => void;
  onActivateVersion?: (workflowId: string, versionId: string) => void;
  liveWorkflows?: Record<string, "live" | "paused">;
  compareItems?: CompareItem[];
  onAddToCompare?: (item: CompareItem) => void;
}

export default function LibraryPanel(props: LibraryPanelProps) {
  const { open, setOpen, workflows, schedules, activeWorkflowId, activeVersionId, activeRunId,
    canSave, onSave, onLoadVersion, onViewRun, onForkVersion, onDeleteWorkflow, onDeleteSchedule,
    onActivateVersion, liveWorkflows = {}, compareItems = [], onAddToCompare } = props;
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const selectedWorkflow = selectedWorkflowId ? workflows.find(w => w.id === selectedWorkflowId) : null;

  return (
    <div className="transition-all duration-300 ease-in-out shrink-0 flex flex-col relative"
      style={{ width: open ? 256 : 48 }}>
      {/* Collapsed bar — always rendered */}
      <div className={`absolute inset-0 w-12 flex flex-col items-center gap-2 py-3 rounded-xl border border-white/[0.06] bg-white/[0.015] text-slate-400 hover:text-slate-200 hover:border-violet-500/20 transition-all duration-300 ${open ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
          <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-2 w-full" data-tooltip="Open library">
            <PanelLeftOpen className="h-3.5 w-3.5" />
            <span className="text-[9px] font-medium [writing-mode:vertical-lr] rotate-180">Library</span>
          </button>
        </div>
      {/* Expanded panel — always rendered */}
        <div className={`w-64 rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col flex-1 min-h-0 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          {/* Header */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04] shrink-0">
            {selectedWorkflow ? (
              <button onClick={() => setSelectedWorkflowId(null)} className="p-1 text-slate-500 hover:text-slate-200 transition-colors">
                <ChevronLeft className="h-3 w-3" />
              </button>
            ) : null}
            <span className="text-[10px] font-semibold text-slate-300 flex-1 pl-1 truncate">
              {selectedWorkflow ? selectedWorkflow.name : "Library"}
            </span>
            <button onClick={onSave} disabled={!canSave} className="p-1 text-slate-500 hover:text-emerald-400 disabled:opacity-20 transition-colors" data-tooltip="Save workflow">
              <Save className="h-3 w-3" />
            </button>
            <button onClick={() => setOpen(false)} className="p-1 text-slate-500 hover:text-slate-200 transition-colors" data-tooltip="Collapse">
              <PanelLeftClose className="h-3 w-3" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* ── Workflow Detail View ── */}
            {selectedWorkflow ? (
              <>
                {/* Versions (newest first) */}
                {[...selectedWorkflow.versions].reverse().map(ver => {
                  const versionRuns = selectedWorkflow.runs.filter(r => r.versionId === ver.id);
                  const versionSchedules = schedules.filter(s => s.versionId === ver.id);
                  return (
                    <div key={ver.id} className={`rounded-lg border p-2.5 space-y-2 ${activeVersionId === ver.id ? "border-violet-500/30 bg-violet-500/[0.04]" : "border-white/[0.06] bg-white/[0.01]"}`}>
                      {/* Version header */}
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold ${activeVersionId === ver.id ? "text-violet-300" : "text-slate-200"}`}>v{ver.version}</span>
                        {selectedWorkflow.activeVersionId === ver.id && (
                          <span className="flex items-center gap-1 text-[8px] font-semibold text-violet-300 bg-violet-500/12 border border-violet-500/20 px-1.5 py-0.5 rounded-full" data-tooltip="Current version — Run & Deploy use this by default (not a live deployment)">
                            <span className="h-1 w-1 rounded-full bg-violet-400" /> Active
                          </span>
                        )}
                        <span className="text-[9px] text-slate-600 truncate">{ver.config.agents?.length || 0} agents · {ver.config.pattern}</span>
                        <div className="ml-auto flex items-center gap-1">
                          {onActivateVersion && selectedWorkflow.activeVersionId !== ver.id && (
                            <button onClick={() => onActivateVersion(selectedWorkflow.id, ver.id)}
                              className="px-2 py-0.5 text-[9px] text-slate-400 hover:text-violet-300 bg-white/[0.02] hover:bg-violet-500/10 border border-white/[0.04] rounded transition-all"
                              data-tooltip="Make this the current version (rollback)">
                              {ver.version < (selectedWorkflow.activeVersionId ? (selectedWorkflow.versions.find(v => v.id === selectedWorkflow.activeVersionId)?.version || 0) : 0) ? "Rollback" : "Set active"}
                            </button>
                          )}
                          <button onClick={() => onLoadVersion(selectedWorkflow, ver)} className="px-2 py-0.5 text-[9px] text-slate-400 hover:text-emerald-400 bg-white/[0.02] hover:bg-emerald-500/10 border border-white/[0.04] rounded transition-all">
                            Open
                          </button>
                        </div>
                      </div>
                      {ver.note && <p className="text-[8px] text-slate-600 italic">{ver.note}</p>}

                      {/* Schedules for this version */}
                      {versionSchedules.map(s => (
                        <div key={s.id} className="flex items-center gap-1.5 text-[8px] text-amber-400/70 bg-amber-500/[0.04] px-2 py-1 rounded">
                          <Calendar className="h-2.5 w-2.5" />
                          <span>{s.schedule.type}: {s.schedule.expression || `${s.schedule.seconds}s`}</span>
                          <button onClick={() => onDeleteSchedule(s.id)} className="ml-auto text-slate-600 hover:text-red-400"><Trash className="h-2 w-2" /></button>
                        </div>
                      ))}

                      {/* Runs for this version */}
                      {versionRuns.length > 0 ? (
                        <div className="space-y-1">
                          {versionRuns.map(run => (
                            <div key={run.id} className={`group/run flex items-center gap-2 px-2 py-1 rounded transition-all ${activeRunId === run.id ? "bg-violet-500/10 border border-violet-500/20" : "hover:bg-white/[0.03]"}`}>
                              <button onClick={() => onViewRun(selectedWorkflow, ver, run)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                                {run.status === "completed" ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                                  : run.status === "waiting" ? <PauseCircle className="h-2.5 w-2.5 text-yellow-400 animate-pulse shrink-0" />
                                  : run.status === "running" ? <Loader2 className="h-2.5 w-2.5 text-violet-400 animate-spin shrink-0" />
                                  : <XCircle className="h-2.5 w-2.5 text-red-400 shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  {run.note ? (
                                    <span className="text-[9px] text-slate-300 truncate block">{run.note}</span>
                                  ) : (
                                    <span className="text-[9px] text-slate-400 truncate block">
                                      {new Date(run.createdAt).toLocaleDateString()} {new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                  {run.tags && run.tags.length > 0 && (
                                    <div className="flex gap-0.5 mt-0.5">
                                      {run.tags.map(t => <span key={t} className="text-[7px] text-violet-400/60 bg-violet-500/8 px-1 rounded">{t}</span>)}
                                    </div>
                                  )}
                                </div>
                                {run.metrics && <span className="text-[8px] text-slate-600 shrink-0">{(run.metrics.duration / 1000).toFixed(1)}s</span>}
                              </button>
                              {onAddToCompare && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onAddToCompare({
                                    id: run.id,
                                    label: `${selectedWorkflow.name} / v${ver.version} / ${new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
                                    goal: ver.config?.goal || "",
                                    agents: (ver.config?.agents || []).map((a: any) => ({ type: a.type, role: a.role || a.name })),
                                    pattern: ver.config?.pattern || "graph",
                                    status: run.status,
                                    answer: run.answer,
                                    metrics: run.metrics,
                                  }); }}
                                  className={`p-0.5 transition-all ${compareItems.some(i => i.id === run.id) ? "text-violet-400" : "text-slate-700 hover:text-violet-400 opacity-0 group-hover/run:opacity-100"}`}
                                  data-tooltip="Add to compare"
                                >
                                  <ArrowLeftRight className="h-2.5 w-2.5" />
                                </button>
                              )}
                              <button onClick={() => onForkVersion(selectedWorkflow, ver)}
                                className="p-0.5 text-slate-700 hover:text-violet-400 opacity-0 group-hover/run:opacity-100 transition-all" data-tooltip="Fork & Edit">
                                <Copy className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[8px] text-slate-700">No runs yet</p>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              /* ── Workflows List ── */
              <>
                {workflows.length === 0 ? (
                  <div className="text-center py-6">
                    <FolderOpen className="h-8 w-8 text-slate-800 mx-auto mb-2" />
                    <p className="text-[10px] text-slate-600">No workflows yet</p>
                    <p className="text-[9px] text-slate-700 mt-1">Click Save to create one</p>
                  </div>
                ) : (
                  workflows.map(wf => {
                    const latestVer = wf.versions[wf.versions.length - 1];
                    const runCount = wf.runs?.length || 0;
                    const lastRun = wf.runs?.[wf.runs.length - 1];
                    return (
                      <div key={wf.id} className={`group rounded-lg border hover:bg-white/[0.03] transition-all cursor-pointer p-2.5 ${activeWorkflowId === wf.id ? "border-violet-500/25 bg-violet-500/[0.03]" : "border-white/[0.06] bg-white/[0.01]"}`}
                        onClick={() => setSelectedWorkflowId(wf.id)}>
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-3 w-3 text-violet-400 shrink-0" />
                          <span className="text-[10px] font-semibold text-slate-200 truncate flex-1">{wf.name}</span>
                          {liveWorkflows[wf.id] && (
                            <span className={`flex items-center gap-1 text-[8px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 border ${liveWorkflows[wf.id] === "paused" ? "text-amber-300 bg-amber-500/12 border-amber-500/20" : "text-emerald-300 bg-emerald-500/12 border-emerald-500/20"}`} data-tooltip={liveWorkflows[wf.id] === "paused" ? "Deployed but taken offline" : "Deployed — live API endpoint"}>
                              <span className={`h-1 w-1 rounded-full ${liveWorkflows[wf.id] === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} /> {liveWorkflows[wf.id] === "paused" ? "Offline" : "Live"}
                            </span>
                          )}
                          <button onClick={e => { e.stopPropagation(); onDeleteWorkflow(wf.id); }} className="p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash className="h-2.5 w-2.5" />
                          </button>
                        </div>
                        {latestVer && (
                          <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-600">
                            <span>v{latestVer.version}</span>
                            <span>·</span>
                            <span>{latestVer.config.agents?.length || 0} agents</span>
                            <span>·</span>
                            <span className="capitalize">{latestVer.config.pattern}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-600">
                          <span>{wf.versions.length} version{wf.versions.length > 1 ? "s" : ""}</span>
                          <span>·</span>
                          <span>{runCount} run{runCount !== 1 ? "s" : ""}</span>
                          {lastRun && (
                            <>
                              <span>·</span>
                              <Clock className="h-2.5 w-2.5" />
                              <span>{new Date(lastRun.createdAt).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Schedules section */}
                {schedules.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-white/[0.04]">
                    <span className="text-[9px] text-slate-500 font-medium uppercase tracking-wide">Scheduled</span>
                    {schedules.map(s => {
                      const wf = workflows.find(w => w.id === s.workflowId);
                      return (
                        <div key={s.id} className="group flex items-center gap-2 mt-1 p-2 rounded-lg border border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03]">
                          <Calendar className="h-3 w-3 text-amber-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[9px] text-slate-300 truncate">{wf?.name || "Unknown"}</div>
                            <div className="text-[8px] text-slate-600">{s.schedule.type}: {s.schedule.expression || `${s.schedule.seconds}s`}</div>
                          </div>
                          <span className={`text-[8px] ${s.active ? "text-emerald-400" : "text-slate-600"}`}>{s.active ? "on" : "off"}</span>
                          <button onClick={() => onDeleteSchedule(s.id)} className="p-1 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash className="h-2 w-2" /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
    </div>
  );
}
