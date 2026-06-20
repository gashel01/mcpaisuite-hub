"use client";
import { type Node } from "@xyflow/react";
import { Plus, Trash2, Layout, User, Settings, Sparkles, X, ChevronDown, AlertCircle, Download, Upload, Undo2, Redo2, Copy, Clipboard, Zap, Search, Check, Cpu } from "lucide-react";
import type { TriggerNodeData, AgentNodeData, ConditionNodeData, HumanNodeData, WorkspaceNodeData, WorkflowNodeData, ToolNodeData } from "./flow-types";
import { AGENT_COLORS } from "./flow-nodes";
import type { TeamAgent } from "@/stores/agent-sessions";

export function NodeInspector({ selectedNode, updateNodeData, availableTools, connections, nodes, setSelectedNodeId, deleteSelected, locked, agentOutputs, completedAgents, savedWorkflows, toolsOpen, setToolsOpen, toolCat, setToolCat, toolSearch, setToolSearch }: {
  selectedNode: Node | null | undefined;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  availableTools: { name: string; description: string; category: string }[];
  connections: { id: string; name: string; provider: string; model: string }[];
  nodes: Node[];
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  deleteSelected: () => void;
  locked: boolean;
  agentOutputs: Record<number, string>;
  completedAgents: number[];
  savedWorkflows: { id: string; name: string; config: { agents: TeamAgent[]; pattern: string } }[];
  toolsOpen: boolean;
  setToolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toolCat: "all" | "built-in" | "mcp" | "langchain";
  setToolCat: React.Dispatch<React.SetStateAction<"all" | "built-in" | "mcp" | "langchain">>;
  toolSearch: string;
  setToolSearch: React.Dispatch<React.SetStateAction<string>>;
}) {
  if (!selectedNode || selectedNode.type === "end") return null;
  return (
          <div className={`w-60 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-3 overflow-y-auto animate-slide-in-right h-full ${locked ? "[&_input]:pointer-events-none [&_input]:opacity-60 [&_select]:pointer-events-none [&_select]:opacity-60 [&_textarea]:pointer-events-none [&_textarea]:opacity-60 [&_button:not([data-close])]:pointer-events-none [&_button:not([data-close])]:opacity-40" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-200 capitalize">{selectedNode.type}</span>
              {locked && <span className="text-[8px] text-amber-400/70 bg-amber-500/10 border border-amber-500/15 px-1.5 py-0.5 rounded">locked</span>}
              <button data-close onClick={() => setSelectedNodeId(null)} className="text-slate-600 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
            </div>

            {/* Trigger */}
            {selectedNode.type === "trigger" && (() => {
              const td = selectedNode.data as TriggerNodeData & Record<string, any>;
              const tt = td.triggerType || "manual";
              return (
              <>
                <div>
                  <label className="text-[9px] text-slate-500 block mb-1">Trigger Type</label>
                  <select value={tt} onChange={e => updateNodeData(selectedNode.id, { triggerType: e.target.value, label: e.target.value === "manual" ? "Manual Run" : e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]">
                    <option value="manual">👆 Manual</option>
                    <option value="scheduled">⏰ Scheduled</option>
                    <option value="cron">🔄 Cron</option>
                    <option value="interval">⏱ Interval</option>
                    <option value="watch">👁 Watch</option>
                    <option value="webhook">🔗 Webhook</option>
                  </select>
                </div>
                {tt === "cron" && (
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Cron expression</label>
                    <input value={td.cronExpression || ""} onChange={e => updateNodeData(selectedNode.id, { cronExpression: e.target.value })} placeholder="0 * * * *  (every hour)" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {[["Hourly","0 * * * *"],["Daily 9am","0 9 * * *"],["Every 15m","*/15 * * * *"],["Mon 8am","0 8 * * 1"]].map(([lbl,expr]) => (
                        <button key={expr} onClick={() => updateNodeData(selectedNode.id, { cronExpression: expr })} className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/8 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15">{lbl}</button>
                      ))}
                    </div>
                  </div>
                )}
                {tt === "interval" && (
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Every (seconds)</label>
                    <input type="number" min={5} value={td.intervalSeconds || 3600} onChange={e => updateNodeData(selectedNode.id, { intervalSeconds: Number(e.target.value) })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                    <div className="flex flex-wrap gap-1 mt-1">
                      {[["1m",60],["5m",300],["15m",900],["1h",3600],["1d",86400]].map(([lbl,s]) => (
                        <button key={s} onClick={() => updateNodeData(selectedNode.id, { intervalSeconds: s })} className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/8 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/15">{lbl}</button>
                      ))}
                    </div>
                  </div>
                )}
                {tt === "scheduled" && (
                  <div className="flex gap-1.5">
                    <div className="flex-1"><label className="text-[9px] text-slate-500 block mb-1">Date</label>
                      <input type="date" value={td.scheduleDate || ""} onChange={e => updateNodeData(selectedNode.id, { scheduleDate: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" /></div>
                    <div className="flex-1"><label className="text-[9px] text-slate-500 block mb-1">Time</label>
                      <input type="time" value={td.scheduleTime || ""} onChange={e => updateNodeData(selectedNode.id, { scheduleTime: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" /></div>
                  </div>
                )}
                {tt === "webhook" && (
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Webhook path</label>
                    <input value={td.webhookPath || ""} onChange={e => updateNodeData(selectedNode.id, { webhookPath: e.target.value })} placeholder="/hooks/my-trigger" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                  </div>
                )}
                {tt === "watch" && (
                  <>
                    <div><label className="text-[9px] text-slate-500 block mb-1">Watch command</label>
                      <input value={td.watchCommand || ""} onChange={e => updateNodeData(selectedNode.id, { watchCommand: e.target.value })} placeholder="curl -s https://… | grep …" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" /></div>
                    <div><label className="text-[9px] text-slate-500 block mb-1">Re-run when</label>
                      <input value={td.watchCondition || ""} onChange={e => updateNodeData(selectedNode.id, { watchCondition: e.target.value })} placeholder="output changed / non-empty" className="w-full !py-1.5 !px-2 !text-[11px]" /></div>
                  </>
                )}
              </>
              );
            })()}

            {/* Agent */}
            {selectedNode.type === "agent" && (() => {
              const d = selectedNode.data as AgentNodeData;
              const agentNodes = nodes.filter(n => n.type === "agent");
              const agentIdx = agentNodes.findIndex(n => n.id === selectedNode.id);
              const output = agentOutputs[agentIdx];
              const isDoneAgent = completedAgents.includes(agentIdx);

              return (
                <>
                  {/* Params (always shown, locked when running/done) */}
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Name</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} placeholder="e.g. CodeReviewer" className="w-full !py-1.5 !px-2 !text-[11px] font-medium" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Type</label>
                    <select value={d.agentType || "code"} onChange={e => updateNodeData(selectedNode.id, { agentType: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px] capitalize">
                      {["code","research","file","memory","plan","rag","ltp","custom"].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1 flex items-center gap-1"><Cpu className="h-2.5 w-2.5 text-violet-400" /> Model</label>
                    <select value={(d as any).connectionId || ""} onChange={e => { const c = connections.find(x => x.id === e.target.value); updateNodeData(selectedNode.id, { connectionId: e.target.value, connectionName: c ? c.name : "" }); }} className="w-full !py-1.5 !px-2 !text-[11px]">
                      <option value="">Default (global model)</option>
                      {connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}
                    </select>
                    {connections.length === 0 && <p className="text-[8px] text-slate-600 mt-1">No saved connections — add some in Settings → LLM to run nodes on different models.</p>}
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Role</label>
                    <input value={d.role || ""} onChange={e => updateNodeData(selectedNode.id, { role: e.target.value })} placeholder="Role description" className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Max Turns</label>
                    <input type="number" value={d.maxTurns || 5} onChange={e => updateNodeData(selectedNode.id, { maxTurns: Number(e.target.value) })} min={1} max={20} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Instructions</label>
                    <textarea value={d.instructions || ""} onChange={e => updateNodeData(selectedNode.id, { instructions: e.target.value })} rows={3} placeholder="Custom instructions..." className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  {/* Extra tools */}
                  {availableTools.length > 0 && (
                    <div>
                      <button onClick={() => setToolsOpen(!toolsOpen)} className="flex items-center gap-1.5 text-[9px] text-slate-500 hover:text-slate-300 transition-colors mb-1">
                        <Settings className="h-2.5 w-2.5" />
                        Tools ({(d as any).tools?.[0] === "__none__" ? "none" : ((d as any).tools || []).length || (d.agentType === "custom" ? "all" : "default")})
                        <span className="text-[8px] text-slate-600 ml-auto">{(d as any).tools?.[0] === "__none__" ? "no tools" : d.agentType === "custom" && (d as any).tools?.length ? "only selected" : d.agentType === "custom" ? "all tools" : "base + selected"}</span>
                      </button>
                      {toolsOpen && (() => {
                        const sel: string[] = ((d as any).tools || []).filter((n: string) => n !== "__none__");
                        const noneSel = (d as any).tools?.[0] === "__none__";
                        const catColor = (c: string) => c === "mcp" ? "text-sky-300 bg-sky-500/12" : c === "langchain" ? "text-amber-300 bg-amber-500/12" : "text-violet-300 bg-violet-500/12";
                        const catCount = (c: string) => c === "all" ? availableTools.length : availableTools.filter(t => t.category === c).length;
                        const q = toolSearch.trim().toLowerCase();
                        const filtered = availableTools.filter(t =>
                          (toolCat === "all" || t.category === toolCat) &&
                          (!q || t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q)));
                        const toggle = (name: string) => {
                          const current: string[] = ((d as any).tools || []).filter((n: string) => n !== "__none__");
                          const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];
                          updateNodeData(selectedNode.id, { tools: next });
                        };
                        const cats: ("all" | "built-in" | "mcp" | "langchain")[] = ["all", "built-in", "mcp", "langchain"];
                        return (
                        <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-1.5 space-y-1.5">
                          {/* Search */}
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-600" />
                            <input value={toolSearch} onChange={e => setToolSearch(e.target.value)} placeholder="Search tools…" className="w-full !pl-6 !py-1 !text-[10px] !bg-[#08080f] !border-white/[0.06]" />
                          </div>
                          {/* Category chips */}
                          <div className="flex items-center gap-1 flex-wrap">
                            {cats.map(c => catCount(c) > 0 || c === "all" ? (
                              <button key={c} onClick={() => setToolCat(c)}
                                className={`px-1.5 py-0.5 text-[8px] font-medium rounded-full capitalize transition-all ${toolCat === c ? "bg-violet-500/20 text-violet-200" : "text-slate-500 hover:text-slate-300 bg-white/[0.03]"}`}>
                                {c === "all" ? "All" : c} {catCount(c)}
                              </button>
                            ) : null)}
                          </div>
                          {/* Selection actions */}
                          <div className="flex items-center gap-2 px-0.5">
                            <span className="text-[8px] text-slate-500">{noneSel ? "none (text only)" : `${sel.length} selected`}</span>
                            <div className="ml-auto flex items-center gap-1.5">
                              {filtered.length > 0 && <button onClick={() => { const names = filtered.map(t => t.name); updateNodeData(selectedNode.id, { tools: Array.from(new Set([...sel, ...names])) }); }} className="text-[8px] text-violet-400 hover:text-violet-300">Select shown</button>}
                              {sel.length > 0 && <button onClick={() => updateNodeData(selectedNode.id, { tools: [] })} className="text-[8px] text-slate-500 hover:text-slate-300">Clear</button>}
                            </div>
                          </div>
                          {/* No-tools toggle */}
                          <button onClick={() => updateNodeData(selectedNode.id, { tools: noneSel ? [] : ["__none__"] })}
                            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all ${noneSel ? "bg-red-500/10 border border-red-500/20" : "hover:bg-white/[0.03] border border-transparent"}`}>
                            <div className={`h-2.5 w-2.5 rounded-sm border flex items-center justify-center ${noneSel ? "bg-red-500 border-red-500" : "border-white/[0.15]"}`} />
                            <span className="text-[9px] font-medium text-red-400">No tools</span>
                            <span className="text-[8px] text-slate-600 ml-auto">Text only — no actions</span>
                          </button>
                          {/* Tool list */}
                          <div className="max-h-[230px] overflow-y-auto space-y-0.5 pr-0.5">
                            {filtered.length === 0 ? (
                              <p className="text-[9px] text-slate-600 px-2 py-2 text-center">No tools match.</p>
                            ) : filtered.map(t => {
                              const selected = sel.includes(t.name);
                              return (
                                <button key={t.name} onClick={() => toggle(t.name)}
                                  className={`w-full flex items-start gap-1.5 px-2 py-1.5 rounded text-left transition-all ${selected ? "bg-violet-500/10 border border-violet-500/20" : "hover:bg-white/[0.03] border border-transparent"}`}>
                                  <div className={`h-2.5 w-2.5 mt-0.5 rounded-sm border shrink-0 flex items-center justify-center ${selected ? "bg-violet-500 border-violet-500" : "border-white/[0.15]"}`}>
                                    {selected && <Check className="h-2 w-2 text-white" />}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9.5px] font-medium text-slate-200 truncate">{t.name}</span>
                                      <span className={`text-[7px] px-1 py-0.5 rounded shrink-0 ${catColor(t.category)}`}>{t.category === "built-in" ? "native" : t.category}</span>
                                    </div>
                                    {t.description && <div className="text-[8px] text-slate-500 leading-snug line-clamp-2 mt-0.5">{t.description}</div>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        );
                      })()}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Condition */}
            {selectedNode.type === "condition" && (() => {
              const d = selectedNode.data as ConditionNodeData;
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Label</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Expression</label>
                    <input value={d.expression || ""} onChange={e => updateNodeData(selectedNode.id, { expression: e.target.value })} placeholder="output.length > 100" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                  </div>
                </>
              );
            })()}

            {/* Tool / Code — deterministic node (no LLM) */}
            {(selectedNode.type === "tool" || selectedNode.type === "code") && (() => {
              const d = selectedNode.data as ToolNodeData;
              const isCode = selectedNode.type === "code";
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Label</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  {isCode ? (
                    <div>
                      <label className="text-[9px] text-slate-500 block mb-1">Python (runs in the sandbox, no LLM)</label>
                      <textarea value={d.code || ""} onChange={e => updateNodeData(selectedNode.id, { code: e.target.value })} rows={5} placeholder="# deterministic python" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="text-[9px] text-slate-500 block mb-1">Tool (governed, no LLM)</label>
                        {availableTools.length > 0 ? (() => {
                          const catColor = (c: string) => c === "mcp" ? "text-sky-300 bg-sky-500/12" : c === "langchain" ? "text-amber-300 bg-amber-500/12" : "text-violet-300 bg-violet-500/12";
                          const cats: ("all" | "built-in" | "mcp" | "langchain")[] = ["all", "built-in", "mcp", "langchain"];
                          const catCount = (c: string) => c === "all" ? availableTools.length : availableTools.filter(t => t.category === c).length;
                          const q = toolSearch.trim().toLowerCase();
                          const filtered = availableTools.filter(t =>
                            (toolCat === "all" || t.category === toolCat) &&
                            (!q || t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q)));
                          return (
                            <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-1.5 space-y-1.5">
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-600" />
                                <input value={toolSearch} onChange={e => setToolSearch(e.target.value)} placeholder="Search installed tools / MCP…" className="w-full !pl-6 !py-1 !text-[10px] !bg-[#08080f] !border-white/[0.06]" />
                              </div>
                              <div className="flex items-center gap-1 flex-wrap">
                                {cats.map(c => catCount(c) > 0 || c === "all" ? (
                                  <button key={c} onClick={() => setToolCat(c)} className={`px-1.5 py-0.5 text-[8px] font-medium rounded-full capitalize transition-all ${toolCat === c ? "bg-sky-500/20 text-sky-200" : "text-slate-500 hover:text-slate-300 bg-white/[0.03]"}`}>{c === "all" ? "All" : c} {catCount(c)}</button>
                                ) : null)}
                              </div>
                              <div className="max-h-44 overflow-y-auto space-y-0.5">
                                {filtered.map(t => (
                                  <button key={t.name} onClick={() => updateNodeData(selectedNode.id, { tool: t.name })}
                                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-all ${d.tool === t.name ? "bg-sky-500/15 border border-sky-500/30" : "hover:bg-white/[0.03] border border-transparent"}`}>
                                    <span className="font-mono text-[10px] text-slate-200 truncate">{t.name}</span>
                                    <span className={`ml-auto shrink-0 px-1 py-[0.5px] rounded text-[7px] ${catColor(t.category)}`}>{t.category}</span>
                                  </button>
                                ))}
                                {filtered.length === 0 && <div className="text-[9px] text-slate-600 px-2 py-1">No matching tool.</div>}
                              </div>
                              {d.tool && <div className="text-[9px] text-sky-300 px-0.5">selected: <span className="font-mono">{d.tool}</span></div>}
                            </div>
                          );
                        })() : (
                          <input value={d.tool || ""} onChange={e => updateNodeData(selectedNode.id, { tool: e.target.value })} placeholder="web_search" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                        )}
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 block mb-1">Args (JSON; use ${"{input}"} for the upstream output)</label>
                        <textarea value={d.args || ""} onChange={e => updateNodeData(selectedNode.id, { args: e.target.value })} rows={3} placeholder='{"query": "${input}"}' className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            {/* Human */}
            {selectedNode.type === "human" && (() => {
              const d = selectedNode.data as HumanNodeData;
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Gate Label</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Reviewer Instructions</label>
                    <textarea value={d.instructions || ""} onChange={e => updateNodeData(selectedNode.id, { instructions: e.target.value })} rows={3} placeholder="What to check..." className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>
                  <div className="bg-blue-500/[0.06] border border-blue-500/15 rounded-lg px-2.5 py-2 text-[9px] text-blue-300">
                    Execution pauses here for human review.
                  </div>
                </>
              );
            })()}

            {/* Workspace */}
            {selectedNode.type === "workspace" && (() => {
              const d = selectedNode.data as WorkspaceNodeData;
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Workspace Name</label>
                    <input value={d.workspaceName || ""} onChange={e => updateNodeData(selectedNode.id, { workspaceName: e.target.value, label: e.target.value })} placeholder="output-folder" className="w-full !py-1.5 !px-2 !text-[11px] font-mono" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Mode</label>
                    <select value={d.workspaceMode || "isolated"} onChange={e => updateNodeData(selectedNode.id, { workspaceMode: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px]">
                      <option value="isolated">🔒 Isolated</option>
                      <option value="persistent">💾 Persistent</option>
                      <option value="user">👤 User workspace</option>
                    </select>
                  </div>
                </>
              );
            })()}

            {/* Workflow (sub-agent) */}
            {selectedNode.type === "workflow" && (() => {
              const d = selectedNode.data as WorkflowNodeData;
              const template = savedWorkflows.find(w => w.id === d.templateId);
              return (
                <>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Workflow Name</label>
                    <input value={d.label || ""} onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })} className="w-full !py-1.5 !px-2 !text-[11px] font-medium" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block mb-1">Description</label>
                    <input value={d.description || ""} onChange={e => updateNodeData(selectedNode.id, { description: e.target.value })} placeholder="What this workflow does" className="w-full !py-1.5 !px-2 !text-[11px]" />
                  </div>

                  {/* Internal flow preview */}
                  <div className="rounded-lg bg-pink-500/[0.04] border border-pink-500/15 p-2.5 space-y-2">
                    <div className="text-[10px] text-pink-300 font-medium flex items-center gap-1.5">📦 {d.templateName} <span className="text-slate-600">· {d.pattern}</span></div>

                    {/* Agent chain preview */}
                    {template && template.config.agents.length > 0 && (
                      <div className="space-y-1">
                        {template.config.agents.map((a, i) => {
                          const color = AGENT_COLORS[a.type] || "#6366f1";
                          return (
                            <div key={i} className="flex items-center gap-2">
                              {i > 0 && <div className="w-3 flex justify-center"><div className="h-3 w-px bg-white/[0.1]" /></div>}
                              {i > 0 && null}
                              <div className="flex items-center gap-1.5 flex-1 rounded-md bg-white/[0.03] border border-white/[0.06] px-2 py-1">
                                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                <span className="text-[9px] text-slate-300 truncate">{a.name || a.role || a.type}</span>
                                <span className="text-[8px] text-slate-600 ml-auto">{a.type}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!template && (
                      <div className="text-[9px] text-slate-500">{d.agentCount} agents · template not found locally</div>
                    )}
                  </div>

                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-2 text-[9px] text-slate-400">
                    Runs as a single step. Input flows in, the internal agents execute, output flows out to the next node.
                  </div>
                </>
              );
            })()}

            {/* Delete */}
            {/* Output preview (below params, when agent completed) */}
            {selectedNode.type === "agent" && (() => {
              const agentNodes = nodes.filter(n => n.type === "agent");
              const idx = agentNodes.findIndex(n => n.id === selectedNode.id);
              const out = agentOutputs[idx];
              if (!out || !completedAgents.includes(idx)) return null;
              return (
                <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-2.5 animate-fade-in">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <svg className="h-3 w-3 text-emerald-400 shrink-0" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span className="text-[9px] font-semibold text-emerald-400">Output</span>
                  </div>
                  <div className="text-[10px] text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">{out}</div>
                </div>
              );
            })()}

            {!locked && selectedNode.type !== "trigger" && (
              <button onClick={() => { deleteSelected(); setSelectedNodeId(null); }} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/8 border border-red-500/15 rounded-lg transition-all">
                <Trash2 className="h-3 w-3" /> Delete Node
              </button>
            )}
          </div>
  );
}
