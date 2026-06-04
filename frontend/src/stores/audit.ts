/**
 * Global audit event store — SSE connection shared across tabs.
 * Uses Web Locks API: only ONE tab holds the SSE connection.
 * Other tabs receive events via BroadcastChannel.
 */
import { create } from "zustand";

function getBase(): string {
  if (typeof window !== "undefined") {
    try {
      const r = JSON.parse(localStorage.getItem("kernelmcp_remote") || "{}");
      if (r.enabled && r.url) return (r.url as string).replace(/\/$/, "");
    } catch {}
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";
}

export interface AuditEvent {
  id: number | string;
  ts: number;
  source: string;
  type: string;
  detail: string;
  data: Record<string, unknown>;
}

interface AuditStore {
  events: AuditEvent[];
  connected: boolean;
  taskChangeCounter: number;
  addEvent: (evt: AuditEvent) => void;
  setEvents: (evts: AuditEvent[]) => void;
  setConnected: (c: boolean) => void;
}

// Substring-matched against the event type. Must include taskforce/crew — builder &
// deployment runs are taskforce tasks (events "taskforce.*", legacy "crew.*"), and
// without these the observability auto-refresh never fired for a workflow run.
const TASK_CHANGE_TYPES = ["task_started", "task_completed", "task_failed", "task_complete", "task.started", "task.completed", "task.failed", "taskforce", "crew."];

export const useAuditStore = create<AuditStore>((set) => ({
  events: [],
  connected: false,
  taskChangeCounter: 0,
  addEvent: (evt) =>
    set((s) => ({
      events: s.events.length >= 200 ? [...s.events.slice(-199), evt] : [...s.events, evt],
      taskChangeCounter: TASK_CHANGE_TYPES.some(t => evt.type.includes(t))
        ? s.taskChangeCounter + 1
        : s.taskChangeCounter,
    })),
  setEvents: (evts) => set({ events: evts }),
  setConnected: (c) => set({ connected: c }),
}));

// ── Shared SSE via Web Locks + BroadcastChannel ─────────────────────────────

let _started = false;

function parseEvent(raw: any): AuditEvent {
  return {
    id: raw.id || Date.now() + Math.random(),
    ts: raw.ts || Date.now() / 1000,
    source: raw.source || "unknown",
    type: raw.type || "",
    detail: raw.detail || raw.message || "",
    data: raw.data || raw,
  };
}

export function startAuditStream() {
  if (_started) return;
  _started = true;

  // Load initial events
  fetch(`${getBase()}/audit/events?limit=100`)
    .then((r) => r.json())
    .then((data) => {
      const evts = (data.events || []).map((raw: any) => parseEvent(raw));
      if (evts.length > 0) useAuditStore.getState().setEvents(evts);
    })
    .catch(() => {});

  // BroadcastChannel: receive events from the leader tab
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel("kernelmcp_audit");
    bc.onmessage = (e) => {
      if (e.data?.type === "audit_event") {
        useAuditStore.getState().addEvent(e.data.event);
      }
    };
  } catch { /* not supported */ }

  // Web Locks: only one tab runs the SSE connection
  // When this tab closes, the lock releases and another tab takes over
  if (navigator.locks) {
    navigator.locks.request("kernelmcp_audit_sse", async () => {
      // We are the leader — connect SSE
      const runSSE = () => {
        const es = new EventSource(`${getBase()}/audit/stream`);
        useAuditStore.getState().setConnected(true);

        es.onmessage = (e) => {
          try {
            const raw = JSON.parse(e.data);
            if (raw.type === "ping" || raw.type === "connected") return;
            const evt = parseEvent(raw);
            useAuditStore.getState().addEvent(evt);
            // Broadcast to follower tabs
            try { bc?.postMessage({ type: "audit_event", event: evt }); } catch {}
          } catch {}
        };

        es.onerror = () => {
          es.close();
          useAuditStore.getState().setConnected(false);
          // Reconnect after 5s (we still hold the lock)
          setTimeout(runSSE, 5000);
        };
      };

      runSSE();
      // Hold the lock forever (until tab closes)
      await new Promise(() => {});
    });
  } else {
    // Fallback: no Web Locks — just connect (old behavior)
    const es = new EventSource(`${getBase()}/audit/stream`);
    useAuditStore.getState().setConnected(true);
    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        if (raw.type === "ping" || raw.type === "connected") return;
        useAuditStore.getState().addEvent(parseEvent(raw));
      } catch {}
    };
    es.onerror = () => { es.close(); setTimeout(() => startAuditStream(), 5000); };
  }
}
