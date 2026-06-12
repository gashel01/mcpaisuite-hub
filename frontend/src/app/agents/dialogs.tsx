"use client";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Settings, X, Play, Rocket, CheckCircle2, Globe, Copy, CheckCheck, KeyRound, Terminal, Trash, Save } from "lucide-react";
import type { TeamAgent, AgentSession } from "@/stores/agent-sessions";

type PublishResult = { id: string; name: string; endpoint: string; token: string };
type Deployment = { id: string; name: string; endpoint: string; runs: number; created_at: number; release_notes?: string; workflowId?: string; status?: string };
type LogEntry = { phase: string; text: string };

// ── Run parameters modal — fill {placeholders} + preview before running ──
export function RunParamsModal({ runParamsOpen, setRunParamsOpen, runParamValues, setRunParamValues, handleRun, goal }: {
  runParamsOpen: boolean;
  setRunParamsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  runParamValues: Record<string, string>;
  setRunParamValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleRun: (paramsOverride?: Record<string, string>) => void;
  goal: string;
}) {
  return (
      <Modal
        open={runParamsOpen}
        onClose={() => setRunParamsOpen(false)}
        backdropClassName="z-50 bg-black/60 backdrop-blur-sm"
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50"
      >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
              <div className="flex items-center gap-2"><Settings className="h-4 w-4 text-violet-400" /><h3 className="text-sm font-semibold text-slate-200">Run parameters</h3></div>
              <button onClick={() => setRunParamsOpen(false)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <p className="text-[11px] text-slate-500">This workflow uses placeholders — fill them in and they're substituted everywhere they appear.</p>
              {Object.keys(runParamValues).map((k, i) => (
                <div key={k}>
                  <label className="text-[10px] font-medium text-violet-300 block mb-1">{k}</label>
                  <input
                    autoFocus={i === 0}
                    value={runParamValues[k]}
                    onChange={e => setRunParamValues(p => ({ ...p, [k]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" && !Object.values(runParamValues).some(v => !v.trim())) { setRunParamsOpen(false); handleRun(runParamValues); } }}
                    placeholder={`Enter ${k}…`}
                    className="w-full !py-2 !px-3 text-sm"
                  />
                </div>
              ))}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="text-[10px] text-slate-500 mb-1">Preview — goal</div>
                <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                  {String(goal).split(/(\{[a-zA-Z0-9_]+\})/g).map((part, idx) => {
                    const m = part.match(/^\{([a-zA-Z0-9_]+)\}$/);
                    if (m) return <span key={idx} className="px-1 rounded bg-violet-500/20 text-violet-200 font-medium">{runParamValues[m[1]]?.trim() || m[1]}</span>;
                    return <span key={idx}>{part}</span>;
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
              <button onClick={() => setRunParamsOpen(false)} className="px-3.5 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors">Cancel</button>
              <button
                disabled={Object.values(runParamValues).some(v => !v.trim())}
                onClick={() => { setRunParamsOpen(false); handleRun(runParamValues); }}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all"
              >
                <Play className="h-3.5 w-3.5" /> Run
              </button>
            </div>
      </Modal>
  );
}

// ── Publish → deploy modal (workflow as a callable API) ──
export function PublishModal({ publishOpen, setPublishOpen, publishing, publishResult, setPublishResult, publishLog, setPublishLog, publishName, setPublishName, publishNotes, setPublishNotes, apiOrigin, copyToClipboard, copied, curlExample, agents, flowGraphRef, pattern, deployments, deleteDeployment, doPublish }: {
  publishOpen: boolean;
  setPublishOpen: React.Dispatch<React.SetStateAction<boolean>>;
  publishing: boolean;
  publishResult: PublishResult | null;
  setPublishResult: React.Dispatch<React.SetStateAction<PublishResult | null>>;
  publishLog: LogEntry[];
  setPublishLog: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  publishName: string;
  setPublishName: React.Dispatch<React.SetStateAction<string>>;
  publishNotes: string;
  setPublishNotes: React.Dispatch<React.SetStateAction<string>>;
  apiOrigin: string;
  copyToClipboard: (text: string, key: string) => void;
  copied: string;
  curlExample: string;
  agents: TeamAgent[];
  flowGraphRef: React.MutableRefObject<{ nodes: any[]; edges: any[] }>;
  pattern: string;
  deployments: Deployment[];
  deleteDeployment: (id: string) => void;
  doPublish: () => void;
}) {
  return (
      <Modal
        open={publishOpen}
        onClose={() => !publishing && setPublishOpen(false)}
        backdropClassName="z-50 bg-black/60 backdrop-blur-sm"
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 max-h-[88vh] flex flex-col"
      >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-200">{publishResult ? "Deployment is live" : "Ready to go live"}</h3>
              </div>
              <button onClick={() => !publishing && setPublishOpen(false)} disabled={publishing}><X className="h-4 w-4 text-slate-500 hover:text-slate-300 disabled:opacity-30" /></button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {/* Success card */}
              {publishResult ? (
                <div className="space-y-3 animate-fade-in">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-[12px] font-semibold text-emerald-300">{publishResult.name} is deployed</span>
                    </div>
                    <p className="text-[10.5px] text-slate-400">Your workflow is now a public, token-authed API. Any <code className="text-slate-300">{`{placeholder}`}</code> becomes a per-call input.</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1"><Globe className="h-3 w-3 text-sky-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Endpoint</span></div>
                    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2">
                      <code className="flex-1 text-[11px] text-sky-300 break-all">POST {apiOrigin}{publishResult.endpoint}</code>
                      <button onClick={() => copyToClipboard(`${apiOrigin}${publishResult.endpoint}`, "ep")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "ep" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1"><KeyRound className="h-3 w-3 text-amber-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Bearer token</span><span className="text-[9px] text-amber-400/80">— shown once, copy it now</span></div>
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/15 bg-[#08080f] px-3 py-2">
                      <code className="flex-1 text-[11px] text-amber-300 break-all">{publishResult.token}</code>
                      <button onClick={() => copyToClipboard(publishResult.token, "tok")} className="text-slate-500 hover:text-slate-200 shrink-0">{copied === "tok" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1"><Terminal className="h-3 w-3 text-slate-400" /><span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Call it</span></div>
                    <div className="relative rounded-lg border border-white/[0.06] bg-[#08080f] px-3 py-2.5">
                      <button onClick={() => copyToClipboard(curlExample, "curl")} className="absolute top-2 right-2 text-slate-500 hover:text-slate-200">{copied === "curl" ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                      <pre className="text-[10.5px] text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">{curlExample}</pre>
                    </div>
                  </div>
                </div>
              ) : publishing || publishLog.length ? (
                /* Deploy pipeline log */
                <div className="space-y-2">
                  {publishLog.map((s, i) => (
                    <div key={i} className="flex items-center gap-2.5 animate-fade-in">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${s.phase === "Error" ? "bg-red-400" : i === publishLog.length - 1 && publishing ? "bg-sky-400 animate-pulse" : "bg-emerald-400"}`} />
                      <span className={`text-[10px] font-semibold uppercase tracking-wide w-24 shrink-0 ${s.phase === "Error" ? "text-red-400" : "text-slate-400"}`}>{s.phase}</span>
                      <span className="text-[11px] text-slate-300">{s.text}</span>
                    </div>
                  ))}
                  {publishing && <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1"><Spinner className="h-3 w-3" /> Deploying…</div>}
                </div>
              ) : (
                /* Publish form */
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Automation name</label>
                    <input value={publishName} onChange={e => setPublishName(e.target.value)} placeholder="My automation" className="w-full !py-2 !px-3 text-sm" autoFocus />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Release notes <span className="text-slate-600 normal-case">(optional)</span></label>
                    <textarea value={publishNotes} onChange={e => setPublishNotes(e.target.value)} rows={2} placeholder="What's in this version…" className="w-full !text-[12px] !bg-[#08080f] !border-white/[0.06]" />
                  </div>
                  <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.04] px-3 py-2.5 text-[10.5px] text-slate-400 leading-relaxed">
                    Packages <span className="text-slate-200 font-medium">{agents.length} agent(s)</span> · pattern <span className="text-slate-200 font-medium">{(flowGraphRef.current?.nodes?.length || 0) > 0 ? "graph" : pattern}</span> into a token-authed API endpoint. Placeholders stay as runtime inputs.
                  </div>
                </div>
              )}

              {/* Live deployments console */}
              {deployments.length > 0 && (
                <div className="pt-1 border-t border-white/[0.06]">
                  <div className="flex items-center gap-1.5 mb-2 mt-3"><Globe className="h-3 w-3 text-slate-500" /><span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Live deployments ({deployments.length})</span></div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {deployments.map(d => (
                      <div key={d.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-200 font-medium truncate">{d.name}</div>
                          <div className="text-[9.5px] text-slate-500 truncate">{d.runs} run(s) · <code className="text-slate-400">{d.endpoint}</code></div>
                        </div>
                        <button onClick={() => copyToClipboard(`${apiOrigin}${d.endpoint}`, `dep-${d.id}`)} className="text-slate-500 hover:text-sky-300 shrink-0" data-tooltip="Copy endpoint">{copied === `dep-${d.id}` ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}</button>
                        <button onClick={() => deleteDeployment(d.id)} className="text-slate-500 hover:text-red-400 shrink-0" data-tooltip="Delete deployment"><Trash className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06] shrink-0">
              {publishResult ? (
                <button onClick={() => { setPublishResult(null); setPublishLog([]); }} className="px-3.5 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors">Publish another</button>
              ) : (
                <button onClick={() => setPublishOpen(false)} disabled={publishing} className="px-3.5 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg transition-colors disabled:opacity-30">Close</button>
              )}
              {!publishResult && (
                <button onClick={doPublish} disabled={publishing || !publishName.trim()} className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all">
                  {publishing ? <Spinner className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />} {publishing ? "Deploying…" : "Deploy"}
                </button>
              )}
            </div>
      </Modal>
  );
}

// ── Save dialog (workflow save / new version) ──
export function SaveDialog({ showSaveDialog, setShowSaveDialog, savingName, setSavingName, saveNotes, setSaveNotes, saveWorkflow, session }: {
  showSaveDialog: boolean;
  setShowSaveDialog: React.Dispatch<React.SetStateAction<boolean>>;
  savingName: string;
  setSavingName: React.Dispatch<React.SetStateAction<string>>;
  saveNotes: string;
  setSaveNotes: React.Dispatch<React.SetStateAction<string>>;
  saveWorkflow: (name: string) => void;
  session: AgentSession | null;
}) {
  return (
      <Modal
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        backdropClassName="z-50 bg-black/40"
        className="bg-[#0c0c14] border border-white/[0.08] rounded-2xl p-5 w-80 shadow-2xl shadow-black/40"
      >
            <div className="flex items-center gap-2 mb-3">
              <Save className="h-4 w-4 text-violet-400" />
              <span className="text-sm font-semibold text-slate-200">Save Workflow</span>
            </div>
            <input value={savingName} onChange={e => setSavingName(e.target.value)} onKeyDown={e => e.key === "Enter" && savingName.trim() && saveWorkflow(savingName)}
              placeholder="Workflow name..." className="w-full !py-2.5 !px-3 !text-sm mb-2" autoFocus />
            <textarea value={saveNotes} onChange={e => setSaveNotes(e.target.value)} rows={2}
              placeholder="Release notes (optional) — what changed in this version…"
              className="w-full !text-[12px] !bg-[#08080f] !border-white/[0.06] mb-1" />
            {session?.workflowId && <p className="text-[9px] text-slate-600 mb-3">Saving creates a new version and makes it the active one.</p>}
            <div className="flex gap-2">
              <button onClick={() => saveWorkflow(savingName)} disabled={!savingName.trim()}
                className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-all">Save</button>
              <button onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 text-xs font-medium rounded-lg border border-white/[0.06] transition-all">Cancel</button>
            </div>
      </Modal>
  );
}
