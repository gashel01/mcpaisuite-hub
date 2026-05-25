"use client";

import { useEffect, useRef } from "react";
import { useExecutionStore, type StreamEvent } from "@/stores/execution";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

/** Normalize backend event types (dot-separated) to our internal format (underscore).
 *  For agent_message events, we use the `message` field to determine the real sub-type. */
function normalizeType(raw: string, message?: string): string {
  // Map backend types to our store types
  const map: Record<string, string> = {
    "task.started": "task_started",
    "task.completed": "task_complete",
    "task.failed": "error",
    "task.cancelled": "task_complete",
    "turn.started": "turn_started",
    "turn.completed": "turn_complete",
    "tool.called": "tool_call",
    "tool.succeeded": "tool_result",
    "tool.failed": "tool_result",
    "llm.called": "token",
    "llm.response": "token",
    "context.bootstrapped": "context_bootstrapped",
    "plan.enforced": "plan_enforced",
    "agent.handoff": "agent_handoff",
    "taskforce.started": "task_started",
    "taskforce.completed": "task_complete",
    "taskforce.failed": "error",
    // Already underscore format (from older backends)
    "task_started": "task_started",
    "task_completed": "task_complete",
    "task_complete": "task_complete",
    "task_failed": "error",
    "turn_started": "turn_started",
    "turn_complete": "turn_complete",
    "turn_completed": "turn_complete",
    "tool_call": "tool_call",
    "tool_called": "tool_call",
    "tool_result": "tool_result",
    "tool_succeeded": "tool_result",
    "tool_failed": "tool_result",
    "context_bootstrapped": "context_bootstrapped",
  };

  // agent_message events carry sub-type in the `message` field
  if (raw === "agent_message" || raw === "agent.message") {
    const msg = message || "";
    if (msg === "agent.started" || msg.startsWith("agent.round_") || msg.startsWith("agent.self_refine")) return "agent_started";
    if (msg === "agent.completed") return "agent_completed";
    if (msg === "agent.failed") return "error";
    if (msg === "wave.started") return "turn_started";
    if (msg === "condition.evaluated") return "tool_result";
    if (msg === "human.review_required") return "agent_handoff";
    if (msg === "human.approved" || msg === "human.feedback") return "agent_completed";
    if (msg === "human.denied") return "error";
    if (msg === "node.skipped") return "token";
    if (msg === "workspace.aggregated") return "tool_result";
    return "agent_started";
  }

  return map[raw] || raw.replace(/\./g, "_");
}

/** Check if this event type means the task is done */
function isTerminalEvent(rawType: string): boolean {
  const terminals = [
    "task.completed", "task.failed", "task.cancelled",
    "task_completed", "task_complete", "task_failed",
    "taskforce.completed", "taskforce.failed",
    "taskforce_completed", "taskforce_failed",
  ];
  return terminals.includes(rawType);
}

export function useTaskStream(taskId: string | null, tenant: string = "demo") {
  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const status = useExecutionStore((s) => s.status);

  // Use refs for taskId/tenant to avoid effect re-firing
  const taskIdRef = useRef(taskId);
  const tenantRef = useRef(tenant);
  taskIdRef.current = taskId;
  tenantRef.current = tenant;

  useEffect(() => {
    if (!taskId) return;

    // Cleanup previous connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const store = useExecutionStore.getState();
    store.startStream(taskId);

    const url = `${BASE}/api/stream/${taskId}?tenant=${encodeURIComponent(tenant)}`;
    console.log("[useTaskStream] Connecting to:", url);

    const es = new EventSource(url);
    esRef.current = es;

    // Elapsed timer
    timerRef.current = setInterval(() => {
      useExecutionStore.getState().tick();
    }, 100);

    es.onopen = () => {
      console.log("[useTaskStream] SSE connected");
      useExecutionStore.getState().setStatus("streaming");
    };

    let receivedTerminal = false;

    es.onmessage = (msg) => {
      try {
        const raw = JSON.parse(msg.data);

        // Skip keepalive/ping
        if (raw.type === "ping" || raw.type === "keepalive") return;

        const normalized = normalizeType(raw.type, raw.message);
        console.log("[useTaskStream] Event:", raw.type, "→", normalized, raw.message || "");

        const event: StreamEvent = {
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: normalized,
          message: raw.message || "",
          data: raw.data || {},
          timestamp: raw.timestamp || new Date().toISOString(),
        };

        useExecutionStore.getState().addEvent(event);

        // Close on terminal events
        if (isTerminalEvent(raw.type)) {
          console.log("[useTaskStream] Terminal event, closing");
          receivedTerminal = true;
          es.close();
          useExecutionStore.getState().setStatus("completed");
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      } catch (err) {
        // Ignore parse errors (SSE comments like ": keepalive\n\n")
      }
    };

    es.onerror = () => {
      // If we already received terminal event, this is just the server closing — not an error
      if (receivedTerminal) {
        console.log("[useTaskStream] Connection closed after completion (normal)");
        return;
      }
      // Check if store already has events or completed status — task may have finished
      const store = useExecutionStore.getState();
      if (store.events.length > 0 || store.status === "completed") {
        console.log("[useTaskStream] SSE closed but events were received — treating as normal completion");
        store.setStatus("completed");
      } else {
        // Genuine connection failure — try polling for result
        console.warn("[useTaskStream] SSE connection failed, falling back to polling");
        fetch(`${BASE}/agents/taskforce/${taskIdRef.current}`, {
          headers: { "X-Tenant-ID": tenantRef.current },
        })
          .then(r => r.json())
          .then(resp => {
            const data = resp.result || {};
            if (data.final_output || data.success !== undefined) {
              store.addEvent({
                id: `evt-fallback-${Date.now()}`,
                type: "task_complete",
                message: "taskforce.completed",
                data: {
                  tokens: data.total_tokens || 0,
                  cost: data.total_cost || 0,
                  turns: data.total_turns || 0,
                  success: data.success,
                },
                timestamp: new Date().toISOString(),
              });
              store.setStatus("completed");
            } else {
              store.setStatus("error");
            }
          })
          .catch(() => store.setStatus("error"));
      }
      es.close();
      esRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    return () => {
      console.log("[useTaskStream] Cleanup");
      es.close();
      esRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [taskId, tenant]);

  const disconnect = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  return { status, disconnect };
}
