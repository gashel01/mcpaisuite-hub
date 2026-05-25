/**
 * Global audit event store — persists across page navigations.
 * SSE connection managed at layout level so events stream continuously.
 */
import { create } from "zustand";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

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
  taskChangeCounter: number;  // increments on task_completed/task_failed — triggers reactive refresh
  // Actions
  addEvent: (evt: AuditEvent) => void;
  setEvents: (evts: AuditEvent[]) => void;
  setConnected: (c: boolean) => void;
}

const TASK_CHANGE_TYPES = ["task_started", "task_completed", "task_failed", "task_complete", "task.started", "task.completed", "task.failed"];

export const useAuditStore = create<AuditStore>((set) => ({
  events: [],
  connected: false,
  taskChangeCounter: 0,
  addEvent: (evt) =>
    set((s) => {
      const isTaskChange = TASK_CHANGE_TYPES.some(t => evt.type.includes(t));
      return {
        events: s.events.length >= 500
          ? [...s.events.slice(-499), evt]
          : [...s.events, evt],
        taskChangeCounter: isTaskChange ? s.taskChangeCounter + 1 : s.taskChangeCounter,
      };
    }),
  setEvents: (evts) => set({ events: evts }),
  setConnected: (c) => set({ connected: c }),
}));

// ── SSE manager (singleton, runs at layout level) ──────────────────────────

let _es: EventSource | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _started = false;

export function startAuditStream() {
  if (_started) return;
  _started = true;

  // Load initial events
  fetch(`${BASE}/audit/events?limit=500`)
    .then((r) => r.json())
    .then((data) => {
      const evts = (data.events || []).map((raw: any) => ({
        id: raw.id || Date.now() + Math.random(),
        ts: raw.ts || 0,
        source: raw.source || "unknown",
        type: raw.type || "",
        detail: raw.detail || "",
        data: raw.data || {},
      }));
      if (evts.length > 0) useAuditStore.getState().setEvents(evts);
    })
    .catch(() => {});

  connect();

  // Reconnect on tab focus + reload events to fill gaps
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      disconnect();
    } else {
      connect();
      // Reload to fill any gap while hidden
      fetch(`${BASE}/audit/events?limit=200`)
        .then((r) => r.json())
        .then((data) => {
          const store = useAuditStore.getState();
          const existing = new Set(store.events.map((e) => e.id));
          const newEvts = (data.events || [])
            .map((raw: any) => ({
              id: raw.id || Date.now() + Math.random(),
              ts: raw.ts || 0,
              source: raw.source || "unknown",
              type: raw.type || "",
              detail: raw.detail || "",
              data: raw.data || {},
            }))
            .filter((e: AuditEvent) => !existing.has(e.id));
          if (newEvts.length > 0) {
            useAuditStore.getState().setEvents([...store.events, ...newEvts].slice(-500));
          }
        })
        .catch(() => {});
    }
  });
}

function connect() {
  if (_es) return;
  try {
    _es = new EventSource(`${BASE}/audit/stream`);
    useAuditStore.getState().setConnected(true);

    _es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        if (raw.type === "ping" || raw.type === "connected") return;
        useAuditStore.getState().addEvent({
          id: Date.now() + Math.random(),
          ts: raw.ts || Date.now() / 1000,
          source: raw.source || "unknown",
          type: raw.type || "",
          detail: raw.detail || raw.message || "",
          data: raw.data || raw,
        });
      } catch { /* malformed */ }
    };

    _es.onerror = () => {
      disconnect();
      _reconnectTimer = setTimeout(connect, 3000);
    };
  } catch {
    useAuditStore.getState().setConnected(false);
  }
}

function disconnect() {
  if (_es) {
    _es.close();
    _es = null;
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  useAuditStore.getState().setConnected(false);
}
