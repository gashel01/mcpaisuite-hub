import { useCallback, type MutableRefObject } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAgentSessionStore, type TeamAgent, type AgentSession } from "@/stores/agent-sessions";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useTenant } from "@/context/tenant";
import { sseRefs, newId } from "./constants";

export function useWorkflowRun({ canRun, activeId, isRunning, goal, agents, pattern, teamConstitution, th, tenant, store, wfStore, isMobile, runParamValues, sessions, session, workspaceEnabled, setRunParamsOpen, setRunParamValues, setMobileTab, flowGraphRef, dryRun }: {
  canRun: string | boolean;
  activeId: string | null;
  isRunning: boolean;
  goal: string;
  agents: TeamAgent[];
  pattern: string;
  teamConstitution: string;
  th: Record<string, string>;
  tenant: ReturnType<typeof useTenant>["tenant"];
  store: ReturnType<typeof useAgentSessionStore.getState>;
  wfStore: ReturnType<typeof useWorkflowStore.getState>;
  isMobile: boolean;
  runParamValues: Record<string, string>;
  sessions: AgentSession[];
  session: AgentSession | null;
  workspaceEnabled: boolean;
  setRunParamsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRunParamValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMobileTab: React.Dispatch<React.SetStateAction<"build" | "output">>;
  flowGraphRef: MutableRefObject<{ nodes: any[]; edges: any[] }>;
  dryRun: boolean;
}) {
  const handleRun = useCallback(async (paramsOverride?: Record<string, string>) => {
    if (!canRun || !activeId || isRunning) return;

    // ── Run parameters: if the workflow has {placeholders}, collect them first ──
    const _nodeInstr = (flowGraphRef.current?.nodes || []).map((n: any) => String((n.data as any)?.instructions || ""));
    const _vars = Array.from(new Set(
      [goal, ...agents.map(a => a.instructions || ""), ..._nodeInstr]
        .flatMap(t => [...String(t).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]))
    ));
    const _params = paramsOverride || runParamValues;
    if (_vars.length && _vars.some(v => !(_params[v]?.trim()))) {
      setRunParamValues(prev => { const next = { ...prev }; _vars.forEach(v => { if (!(v in next)) next[v] = ""; }); return next; });
      setRunParamsOpen(true);
      return;
    }
    const subst = (t: string) => String(t || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => _params[k] ?? m);

    // On mobile, surface the live output as soon as the run starts
    if (isMobile) setMobileTab("output");

    const sessionId = activeId;
    // Close any stale SSE connection from a previous run
    const oldEs = sseRefs[sessionId];
    if (oldEs) { oldEs.close(); delete sseRefs[sessionId]; }

    const sess = useAgentSessionStore.getState().sessions?.find(s => s.id === sessionId);

    // Snapshot the current graph layout
    const { nodes: snapNodes, edges: snapEdges } = flowGraphRef.current;
    const graphSnapshot = snapNodes.length > 0 ? {
      nodes: snapNodes.map((n: any) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
      edges: snapEdges.map((e: any) => ({ id: e.id, source: e.source, target: e.target, label: e.label, style: e.style, type: e.type })),
    } : null;

    // ── Scratchpad mode: only persist if already linked to a workflow ──
    let currentWorkflowId = sess?.workflowId;
    let currentVersionId = sess?.versionId;
    let currentWorkflowName = sess?.workflowName;

    // If linked to a workflow and config/graph changed, auto-create new version
    if (currentWorkflowId && currentVersionId && sess) {
      const sourceVersion = wfStore.getVersion(currentWorkflowId, currentVersionId);
      if (sourceVersion) {
        const configChanged = JSON.stringify(sess.config) !== JSON.stringify(sourceVersion.config);
        const graphChanged = JSON.stringify(graphSnapshot) !== JSON.stringify(sourceVersion.graph);
        if (configChanged || graphChanged) {
          const newVer = await wfStore.addVersion(currentWorkflowId, {
            parentVersionId: currentVersionId,
            config: { ...sess.config },
            graph: graphSnapshot,
            note: "Auto-created from modified run",
          }, th);
          if (newVer) {
            currentVersionId = newVer.id;
          }
        }
      }
    }

    // Create run in workflow store (only if linked to a workflow)
    let currentRunId: string | undefined;
    if (currentWorkflowId && currentVersionId) {
      const run = await wfStore.addRun(currentWorkflowId, currentVersionId, {
        status: "running",
        graph: graphSnapshot || undefined,
        workflowName: currentWorkflowName || undefined,
      }, th);
      if (run) currentRunId = run.id;
    }

    // Set running status + link to workflow/version/run
    useAgentSessionStore.setState((s) => ({
      sessions: s.sessions.map(sess2 => sess2.id === sessionId ? {
        ...sess2,
        status: "running" as const,
        graph: graphSnapshot || sess2.graph,
        workflowId: currentWorkflowId || sess2.workflowId,
        versionId: currentVersionId || sess2.versionId,
        workflowName: currentWorkflowName || sess2.workflowName,
        runId: currentRunId,
        liveEvents: [],
        completedAgents: [],
        activeAgentIndex: -1,
        activeAgentIndices: [],
        answer: null,
        metrics: null,
      } : sess2),
    }));

    const currentAgents = useAgentSessionStore.getState().sessions?.find(s => s.id === sessionId)?.config.agents || agents;
    const currentGoal = useAgentSessionStore.getState().sessions?.find(s => s.id === sessionId)?.config.goal || goal;
    const currentPattern = useAgentSessionStore.getState().sessions?.find(s => s.id === sessionId)?.config.pattern || pattern;
    const currentConstitution = useAgentSessionStore.getState().sessions?.find(s => s.id === sessionId)?.config.constitution || teamConstitution;

    const startTime = Date.now();
    const { nodes: checkNodes } = flowGraphRef.current;
    const hasGraphNodes = checkNodes.length > 0;
    const isTeam = currentAgents.length > 1 || hasGraphNodes; // Always use taskforce when graph exists

    // Merge constitution INTO the goal so agents treat it as the actual topic/context.
    // Run-parameter {placeholders} are substituted into the goal here.
    const substGoal = subst(currentGoal);
    const effectiveGoal = currentConstitution
      ? `${substGoal}\n\nContext & requirements: ${subst(currentConstitution)}`
      : substGoal;

    try {
      if (isTeam) {
        // ── Multi-agent: use /agents/taskforce with SSE streaming ──
        // The flow graph is always the source of truth for execution topology
        const { nodes: flowNodes, edges: flowEdges } = flowGraphRef.current;
        const hasGraph = flowNodes.length > 0;

        const config: Record<string, any> = {
          goal: effectiveGoal,
          pattern: hasGraph ? "graph" : currentPattern,
          constitution: currentConstitution || undefined,
          agents: currentAgents.map(a => ({
            type: a.type, role: a.role, max_turns: a.max_turns,
            ...(a.instructions ? { instructions: subst(a.instructions) } : {}),
            ...(a.tools?.length ? { tools: a.tools } : {}),
          })),
        };
        if (dryRun) config.dry_run = true;  // simulate: no tool executes, record intended calls
        // Link the run to its saved workflow/version (when any) so Observability can
        // offer "Open in agent view" against the exact saved version.
        if (currentWorkflowId) config.workflow_id = currentWorkflowId;
        if (currentVersionId) config.version_id = currentVersionId;

        // Always send the graph — it's the source of truth (substitute placeholders in node instructions)
        if (hasGraph) {
          config.graph = {
            nodes: flowNodes.map(n => ({ id: n.id, type: n.type, data: (n.data as any)?.instructions ? { ...n.data, instructions: subst((n.data as any).instructions) } : n.data, position: n.position })),
            edges: flowEdges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, style: e.style })),
          };
        }

        // Workspace isolation
        if (workspaceEnabled) {
          config.workspace = {
            name: session?.config.workspaceName || "output",
            mode: session?.config.workspaceMode || "isolated",
          };
        }

        // Launch taskforce (async — returns task_id immediately)
        const res = await apiFetch<any>(`/agents/taskforce`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify(config),
        });
        const launch = res;

        if (!launch.task_id) {
          // Fallback: blocking response (old format)
          const data = launch;
          const duration = Date.now() - startTime;
          const answer = data.final_output || data.output || JSON.stringify(data, null, 2);
          store.setResult(sessionId, answer, { tokens: data.total_tokens || 0, cost: data.total_cost || 0, turns: data.total_turns || 0, duration: data.duration_ms || duration });
        } else {
          // SSE streaming mode — save to history immediately so it appears in Runs
          const taskId = launch.task_id;
          store.setTaskId(sessionId, taskId);
          store.saveToHistory(sessionId);
          // Persist the task id on the run record right away so its executions row links
          // to the full trace (View full trace) even if the run is interrupted before it
          // finalizes — not only on completion.
          if (currentWorkflowId && currentRunId) {
            wfStore.updateRun(currentWorkflowId, currentRunId, { taskId }, th);
          }

          const es = new EventSource(apiUrl(`/api/stream/${taskId}?tenant=${encodeURIComponent(tenant)}`));
          (es as any)._currentAgentIdx = 0; // Track active agent locally in closure
          sseRefs[sessionId] = es;

          es.onmessage = (ev) => {
            try {
              const event = JSON.parse(ev.data);
              const eventData = event.data || {};

              // Live token stream (typewriter) — high frequency, handle and skip the rest.
              if (event.type === "llm.delta") {
                store.appendStreamToken(sessionId, event.message || "");
                return;
              }
              // New turn / agent → clear the previous turn's streamed text.
              if (event.type === "turn.started" || event.message === "agent.started" || event.message === "wave.started") {
                store.resetStreamToken(sessionId);
              }

              // Wave marker (parallel group indicator)
              if (event.message === "wave.started") {
                const waveNum = eventData.wave || 1;
                const isParallel = eventData.parallel;
                const waveAgents = (eventData.agents || []) as { role: string; self_refine: boolean; round: number }[];
                const labels = waveAgents.map((a: any) => `${a.self_refine ? "🔄 " : ""}${a.role}${a.round > 1 ? ` r${a.round}` : ""}`).join(", ");
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `${isParallel ? "⚡ Parallel" : "→ Sequential"} wave ${waveNum}: ${labels}`,
                  timestamp: Date.now(),
                });
              }

              // Condition evaluated
              if (event.message === "condition.evaluated") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "condition",
                  content: `◆ ${eventData.label || "Condition"}: ${eventData.expression || "?"} → ${eventData.result ? "YES" : "NO"}`,
                  timestamp: Date.now(),
                });
              }

              // Node skipped (branch not taken)
              if (event.message === "node.skipped") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "skipped",
                  content: `⊘ ${eventData.label || "Node"} (${eventData.type}) — branch not taken`,
                  timestamp: Date.now(),
                });
              }

              // Workspace aggregated
              if (event.message === "workspace.aggregated") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `📁 ${eventData.name || "Workspace"} — aggregated from: ${(eventData.sources || []).join(", ")} (${eventData.size || 0} chars)`,
                  timestamp: Date.now(),
                });
              }

              // Sub-workflow events
              if (event.message === "workflow.started") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `📦 Sub-workflow started: ${eventData.template || "workflow"} (${eventData.agents || 0} agents)`,
                  timestamp: Date.now(),
                });
              }
              if (event.message === "workflow.completed") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "thinking",
                  content: `📦 Sub-workflow completed: ${eventData.template || "workflow"} — ${eventData.success ? "success" : "failed"} (${eventData.tokens || 0} tokens)`,
                  timestamp: Date.now(),
                });
              }
              if (event.message === "workflow.failed") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "error",
                  content: `📦 Sub-workflow failed: ${eventData.template || "workflow"} — ${eventData.error || "unknown error"}`,
                  timestamp: Date.now(),
                });
              }

              // Human gate
              if (event.message === "human.review_required") {
                const currentOutput = eventData.current_output || "";
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `⏸ Human review required: ${eventData.instructions || "Review and approve"}${currentOutput ? `\n---\n${currentOutput}` : ""}`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                  hasFeedback: eventData.has_feedback || false,
                });
                store.setStatus(sessionId, "waiting");
              }
              if (event.message === "human.approved") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `✅ Human approved${eventData.modified ? " (output edited)" : ""}`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                });
                store.setStatus(sessionId, "running");
              }
              if (event.message === "human.denied") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `🛑 Human denied — workflow stopped`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                });
                store.setStatus(sessionId, "running");
              }
              if (event.message === "human.feedback") {
                store.addLiveEvent(sessionId, {
                  agentIndex: -1, agentType: "system", agentRole: "",
                  type: "human_gate",
                  content: `🔄 Revision requested: ${(eventData.feedback || "").slice(0, 100)}`,
                  timestamp: Date.now(),
                  nodeId: eventData.node_id,
                });
                store.setStatus(sessionId, "running");
              }

              // Agent-level events from patterns
              if (event.message === "agent.started" && eventData.agent_index != null) {
                store.setActiveAgent(sessionId, eventData.agent_index);
                (es as any)._currentAgentIdx = eventData.agent_index;
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "thinking",
                  content: `${eventData.agent_role || eventData.agent_type} started...`,
                  timestamp: Date.now(),
                });
              } else if (event.message?.startsWith("agent.self_refine_") && eventData.agent_index != null) {
                const roundNum = event.message.split("_").pop() || "2";
                store.setActiveAgent(sessionId, eventData.agent_index);
                (es as any)._currentAgentIdx = eventData.agent_index;
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "thinking",
                  content: `🔄 Self-refine (round ${roundNum}): ${eventData.agent_role || eventData.agent_type}`,
                  timestamp: Date.now(),
                });
              } else if (event.message?.startsWith("agent.round_") && eventData.agent_index != null) {
                const roundNum = event.message.split("_")[1] || "2";
                store.setActiveAgent(sessionId, eventData.agent_index);
                (es as any)._currentAgentIdx = eventData.agent_index;
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "thinking",
                  content: `Round ${roundNum}: ${eventData.agent_role || eventData.agent_type} refining...`,
                  timestamp: Date.now(),
                });
              } else if (event.message === "agent.input" && eventData.agent_index != null) {
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: "input",
                  content: eventData.output || "",
                  timestamp: Date.now(),
                });
              } else if ((event.message === "agent.completed" || event.message === "agent.failed") && eventData.agent_index != null) {
                store.addLiveEvent(sessionId, {
                  agentIndex: eventData.agent_index,
                  agentType: eventData.agent_type || "",
                  agentRole: eventData.agent_role || "",
                  type: eventData.success === false ? "error" : "message",
                  content: eventData.output || "Done",
                  timestamp: Date.now(),
                });
                store.completeAgent(sessionId, eventData.agent_index);
              }

              // Tool & turn events — resolve agent index from role or fallback to tracked index
              const evType = event.type || "";
              const toolName = eventData.tool_name || eventData.tool || "";

              // Track current agent index locally (closure-safe, not from store)
              if (event.message === "agent.started" && eventData.agent_index != null) {
                (es as any)._currentAgentIdx = eventData.agent_index;
              }

              // Resolve agent index: prefer matching by role (works during parallel execution)
              let localIdx: number = (es as any)._currentAgentIdx ?? 0;
              if (eventData.role) {
                const matchIdx = currentAgents.findIndex(a => a.role === eventData.role);
                if (matchIdx >= 0) localIdx = matchIdx;
              }
              const localAgent = currentAgents[localIdx];

              if (evType === "tool.called" && toolName && !toolName.startsWith("spawn_agent")) {
                // Format arguments as readable string
                const args = eventData.arguments || {};
                const argStr = Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(", ");
                store.addLiveEvent(sessionId, {
                  agentIndex: localIdx,
                  agentType: localAgent?.type || eventData.agent || "", agentRole: localAgent?.role || "",
                  type: "tool_call",
                  content: argStr ? `(${argStr})` : "",
                  toolName,
                  timestamp: Date.now(),
                });
              } else if (evType === "tool.succeeded" && toolName && !toolName.startsWith("spawn_agent")) {
                const output = eventData.output || "";
                if (output) {
                  store.addLiveEvent(sessionId, {
                    agentIndex: localIdx,
                    agentType: localAgent?.type || eventData.agent || "", agentRole: localAgent?.role || "",
                    type: "tool_result",
                    content: output,
                    toolName,
                    timestamp: Date.now(),
                  });
                }
              } else if (evType === "tool.failed" && toolName) {
                store.addLiveEvent(sessionId, {
                  agentIndex: localIdx,
                  agentType: localAgent?.type || eventData.agent || "", agentRole: localAgent?.role || "",
                  type: "error",
                  content: `${toolName} failed: ${eventData.output || "unknown error"}`,
                  toolName,
                  timestamp: Date.now(),
                });
              }

              if (evType === "turn.started" || evType === "turn.completed") {
                store.addLiveEvent(sessionId, {
                  agentIndex: localIdx,
                  agentType: localAgent?.type || "", agentRole: localAgent?.role || "",
                  type: "thinking",
                  content: eventData.content?.slice(0, 200) || event.message || "Thinking...",
                  timestamp: Date.now(),
                });
              }

              // Terminal events. Taskforce terminals are emitted as "taskforce.*"
              // (legacy "crew.*" kept for older backends/persisted runs).
              if (event.type === "task_complete" || event.type === "task.completed" || event.type === "task.failed"
                || event.type === "taskforce.completed" || event.type === "taskforce.failed"
                || event.type === "crew.completed" || event.type === "crew.failed") {
                es.close();
                delete sseRefs[sessionId];

                // Fetch final result (small delay to let backend store metadata after event emit)
                const fetchResult = (retries = 3) => {
                  apiFetch<any>(`/agents/taskforce/${taskId}`, { headers: th })
                                        .then(resp => {
                      const data = resp.result || {};
                      const duration = Date.now() - startTime;
                      const answer = data.final_output || data.error || "";

                      // If result is empty and retries left, the backend hasn't written metadata yet
                      if (!answer && retries > 0) {
                        setTimeout(() => fetchResult(retries - 1), 500);
                        return;
                      }

                      const metrics = {
                        tokens: data.total_tokens || 0,
                        cost: data.total_cost || 0,
                        turns: data.total_turns || 0,
                        duration: data.duration_ms || duration,
                      };
                      const failed = data.success === false;
                      // Resolve a non-empty answer. A gracefully-failed run can return an empty
                      // final_output with no error text; persist a clear message so reopening it
                      // later isn't blank (previously stored `answer || null` → blank on reopen,
                      // even though the live view showed "Failed").
                      let resolved = answer || (failed ? "Run failed — no output was produced." : "Completed");
                      if (resp.dry_run) {
                        // Show only the planned calls — the LLM answer is dropped (no real
                        // results means it's unreliable). The plan is the honest output.
                        const calls: any[] = resp.dry_run_calls || [];
                        const lines = calls.map((c, i) => `${i + 1}. ${c.tool}(${JSON.stringify(c.arguments)})`).join("\n");
                        resolved = `🔍 Dry run — ${calls.length} tool call(s) would have run (nothing executed):\n${lines || "(none)"}`;
                      }
                      if (failed) store.setStatus(sessionId, "failed");
                      store.setResult(sessionId, resolved, metrics);
                      // Update run in workflow hierarchy — persist the SAME resolved answer.
                      const sess = useAgentSessionStore.getState().sessions.find(s => s.id === sessionId);
                      if (sess?.workflowId && sess?.runId) {
                        wfStore.updateRun(sess.workflowId, sess.runId, {
                          status: failed ? "failed" : "completed",
                          answer: resolved, metrics,
                          liveEvents: sess.liveEvents.slice(-30),
                          ...(sess.taskId ? { taskId: sess.taskId } : {}),
                        }, th);
                      }
                    })
                    .catch(() => {
                      if (retries > 0) { setTimeout(() => fetchResult(retries - 1), 500); return; }
                      store.setStatus(sessionId, "failed");
                      store.setResult(sessionId, "Failed to fetch result", { tokens: 0, cost: 0, turns: 0, duration: Date.now() - startTime });
                    });
                };
                setTimeout(() => fetchResult(), 300);
              }
            } catch { /* ignore parse errors */ }
          };

          es.onerror = () => {
            es.close();
            delete sseRefs[sessionId];
            // Check if we already got a result
            const sess = useAgentSessionStore.getState().sessions.find(s => s.id === sessionId);
            if (sess && sess.status === "running") {
              // SSE dropped — try fetching result
              apiFetch<any>(`/agents/taskforce/${taskId}`, { headers: th })
                                .then(resp => {
                  const data = resp.result;
                  if (data) {
                    const answer = data.final_output || "Completed";
                    store.setResult(sessionId, answer, { tokens: data.total_tokens || 0, cost: data.total_cost || 0, turns: data.total_turns || 0, duration: data.duration_ms || Date.now() - startTime });
                  }
                })
                .catch(() => {});
            }
          };

          return; // Don't fall through — SSE handles completion
        }

      } else {
        // ── Single agent: use /agents/spawn (direct execution) ──
        const agent = currentAgents[0];

        // Execute agent directly
        const res = await apiFetch<any>(`/agents/spawn`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...th },
          body: JSON.stringify({
            agent_type: agent.type,
            task: effectiveGoal,
            max_turns: agent.max_turns,
            constitution: agent.instructions || "",
            ...(agent.tools?.length ? { tools: agent.tools } : {}),
          }),
        });
        const data = res;
        const duration = Date.now() - startTime;

        // Store task_id if returned by spawn
        if (data.task_id) store.setTaskId(sessionId, data.task_id);

        store.addLiveEvent(sessionId, {
          agentIndex: 0, agentType: agent.type, agentRole: agent.role,
          type: "message", content: data.output?.slice(0, 300) || "Completed", timestamp: Date.now(),
        });
        store.completeAgent(sessionId, 0);

        if (data.success !== false) {
          store.setResult(sessionId, data.output || "Agent completed.", {
            tokens: data.tokens_used || 0, cost: data.cost || 0,
            turns: data.turns_used || 0, duration,
          });
        } else {
          store.setStatus(sessionId, "failed");
          store.setResult(sessionId, data.error || data.output || "Agent failed.", {
            tokens: data.tokens_used || 0, cost: data.cost || 0,
            turns: data.turns_used || 0, duration,
          });
        }
      }
    } catch (e) {
      store.setStatus(sessionId, "failed");
      store.setResult(sessionId, String(e), { tokens: 0, cost: 0, turns: 0, duration: Date.now() - startTime });
    }
  }, [canRun, activeId, isRunning, goal, agents, pattern, teamConstitution, th, store, wfStore, isMobile, runParamValues]);

  const handleStop = useCallback(() => {
    if (!activeId) return;
    const es = sseRefs[activeId];
    if (es) { es.close(); delete sseRefs[activeId]; }
    const sess = sessions.find(s => s.id === activeId);
    if (sess?.taskId) apiFetch<any>(`/tasks/${sess.taskId}`, { method: "DELETE", headers: th }).catch(() => {});
    store.setStatus(activeId, "failed");
    store.setResult(activeId, "Cancelled.", { tokens: 0, cost: 0, turns: 0, duration: 0 });
    // Update the run in workflow store
    if (sess?.workflowId && (sess as any)?.runId) {
      wfStore.updateRun(sess.workflowId, (sess as any).runId, { status: "cancelled" }, th);
    }
  }, [activeId, sessions, th, store, wfStore]);

  return { handleRun, handleStop };
}
