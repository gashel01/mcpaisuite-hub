import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useAgentSessionStore } from "@/stores/agent-sessions";
import { newId } from "./constants";

export function useWorkflowBuild({ activeId, th, store }: {
  activeId: string | null;
  th: Record<string, string>;
  store: ReturnType<typeof useAgentSessionStore.getState>;
}) {
  const [building, setBuilding] = useState(false);
  const [buildChat, setBuildChat] = useState<{ role: "user" | "architect"; text: string }[]>([]);
  const [buildInput, setBuildInput] = useState("");
  const [buildSuggestions, setBuildSuggestions] = useState<string[]>([]);
  const [buildMissing, setBuildMissing] = useState<string[]>([]);

  const handleArchitect = useCallback(async (message: string) => {
    const msg = message.trim();
    if (!msg || !activeId || building) return;
    const aid = activeId;
    setBuilding(true);
    setBuildSuggestions([]);
    setBuildMissing([]);
    // Snapshot the conversation history (before adding this turn) for the backend.
    const history = buildChat.map(m => ({ role: m.role === "architect" ? "assistant" : "user", content: m.text }));
    setBuildChat(c => [...c, { role: "user", text: msg }, { role: "architect", text: "" }]);
    const archIdx = buildChat.length + 1; // index of the architect message we'll stream into

    // Current workflow snapshot for refinement context (agents + trigger + workspace + gates).
    const curCfg = useAgentSessionStore.getState().sessions.find(s => s.id === aid)?.config;
    const curAgents = curCfg?.agents || [];

    try {
      const res = await apiFetch<Response>(`/agents/architect`, {
        method: "POST", headers: { "Content-Type": "application/json", ...th }, raw: true,
        body: JSON.stringify({
          message: msg, history,
          current: {
            pattern: curCfg?.pattern || "sequential",
            agents: curAgents.map(a => ({ type: a.type, role: a.role, instructions: a.instructions, max_turns: a.max_turns, tools: a.tools })),
            trigger: { type: curCfg?.triggerType || "manual", cron: curCfg?.cronExpression, interval_seconds: curCfg?.intervalSeconds, webhook_path: curCfg?.webhookPath },
            human_gates: curCfg?.humanGates || [],
            workspace: { enabled: !!curCfg?.workspaceEnabled, name: curCfg?.workspaceName, mode: curCfg?.workspaceMode },
          },
        }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === "narration") {
            setBuildChat(c => c.map((m, i) => i === archIdx ? { ...m, text: m.text + ev.text } : m));
          } else if (ev.type === "team") {
            // Diff onto canvas: keep ids of agents whose role is unchanged so they don't flash.
            const existing = (useAgentSessionStore.getState().sessions.find(s => s.id === aid)?.config.agents) || [];
            const used = new Set<string>();
            const next = (ev.agents || []).map((a: any) => {
              const match = existing.find(e => e.role && e.role === a.role && !used.has(e.id));
              if (match) used.add(match.id);
              const base = {
                id: match?.id || newId(), name: match?.name || "", description: "",
                type: a.type || "custom", role: a.role || "", max_turns: a.max_turns || 5,
                instructions: a.instructions || "", tools: Array.isArray(a.tools) ? a.tools : [],
              };
              // Deterministic step (no LLM): the architect can emit kind="tool"/"code".
              if (a.kind === "tool" || a.kind === "code") {
                return {
                  ...base, kind: a.kind, tool: a.tool || "",
                  args: typeof a.args === "string" ? a.args : JSON.stringify(a.args || {}),
                  code: a.code || "",
                };
              }
              // Dynamic fan-out (map-reduce): the architect can emit kind="map".
              if (a.kind === "map") {
                const b = a.body || {};
                return {
                  ...base, kind: "map",
                  over: a.over || "${input}", reducer: a.reducer || "append",
                  into: a.into || "", max_fanout: a.max_fanout || 50,
                  body: {
                    kind: b.kind || "tool", tool: b.tool || "",
                    args: typeof b.args === "string" ? b.args : JSON.stringify(b.args || {}),
                    code: b.code || "", agentType: b.agentType || "", instructions: b.instructions || "",
                  },
                };
              }
              return base;
            });
            // Trigger (manual / cron / interval / scheduled / watch / webhook).
            const tr = ev.trigger || { type: "manual" };
            const trigCfg: any = { triggerType: tr.type || "manual" };
            if (tr.cron) trigCfg.cronExpression = tr.cron;
            if (tr.interval_seconds) trigCfg.intervalSeconds = tr.interval_seconds;
            if (tr.webhook_path) trigCfg.webhookPath = tr.webhook_path;
            if (tr.schedule_date) trigCfg.scheduleDate = tr.schedule_date;
            if (tr.schedule_time) trigCfg.scheduleTime = tr.schedule_time;
            if (tr.watch_command) trigCfg.watchCommand = tr.watch_command;
            if (tr.watch_condition) trigCfg.watchCondition = tr.watch_condition;
            // Workspace + human gates.
            const ws = ev.workspace || {};
            const wsCfg: any = ws.enabled
              ? { workspaceEnabled: true, workspaceName: ws.name || "", workspaceMode: ws.mode || "persistent" }
              : { workspaceEnabled: false };
            const humanGates = Array.isArray(ev.human_gates) ? ev.human_gates.filter((x: any) => typeof x === "number") : [];
            store.updateConfig(aid, { pattern: ev.pattern || "sequential", agents: next, ...trigCfg, ...wsCfg, humanGates });
            setBuildSuggestions(Array.isArray(ev.suggestions) ? ev.suggestions.filter((s: any) => typeof s === "string").slice(0, 4) : []);
            setBuildMissing(Array.isArray(ev.missing) ? ev.missing.filter((s: any) => typeof s === "string") : []);
          } else if (ev.type === "error") {
            setBuildChat(c => c.map((m, i) => i === archIdx ? { ...m, text: (m.text || "") + "⚠ " + (ev.message || "failed") } : m));
          }
        }
      }
    } catch (e: any) {
      setBuildChat(c => c.map((m, i) => i === archIdx ? { ...m, text: (m.text || "") + "⚠ " + (e?.message || "failed") } : m));
    } finally {
      setBuilding(false);
    }
  }, [activeId, building, buildChat, th]);

  return {
    building, setBuilding, buildChat, setBuildChat, buildInput, setBuildInput,
    buildSuggestions, setBuildSuggestions, buildMissing, setBuildMissing, handleArchitect,
  };
}
