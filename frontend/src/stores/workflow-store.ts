import { getApiUrl } from "@/lib/api-url";
import { create } from "zustand";

const BASE_URL = getApiUrl();

// ── Data Model ────────────────────────────────────────────────────────────

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  parentVersionId?: string;
  config: any; // Same shape as AgentSession["config"]
  graph: { nodes: any[]; edges: any[] } | null;
  note?: string;
  createdAt: number;
}

export interface WorkflowRun {
  id: string;
  versionId: string;
  workflowId: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  answer: string | null;
  metrics: { tokens: number; cost: number; turns: number; duration: number } | null;
  feedback: { rating: "good" | "bad" | null; comment: string } | null;
  liveEvents: any[];
  note?: string;
  tags?: string[];
  createdAt: number;
  completedAt?: number;
}

export interface Workflow {
  id: string;
  name: string;
  versions: WorkflowVersion[];
  runs: WorkflowRun[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowSchedule {
  id: string;
  workflowId: string;
  versionId: string;
  schedule: { type: string; expression?: string; seconds?: number };
  active: boolean;
  createdAt: number;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface WorkflowStore {
  workflows: Workflow[];
  schedules: WorkflowSchedule[];
  loaded: boolean;

  load: (headers?: Record<string, string>) => Promise<void>;
  getWorkflow: (id: string) => Workflow | undefined;
  getVersion: (workflowId: string, versionId: string) => WorkflowVersion | undefined;
  getLatestVersion: (workflowId: string) => WorkflowVersion | undefined;

  createWorkflow: (name: string, version: Omit<WorkflowVersion, "id" | "workflowId" | "version" | "createdAt">, headers?: Record<string, string>) => Promise<Workflow | null>;
  addVersion: (workflowId: string, version: Omit<WorkflowVersion, "id" | "workflowId" | "version" | "createdAt">, headers?: Record<string, string>) => Promise<WorkflowVersion | null>;
  addRun: (workflowId: string, versionId: string, run: Partial<WorkflowRun>, headers?: Record<string, string>) => Promise<WorkflowRun | null>;
  updateRun: (workflowId: string, runId: string, update: Partial<WorkflowRun>, headers?: Record<string, string>) => Promise<void>;
  deleteWorkflow: (id: string, headers?: Record<string, string>) => Promise<void>;

  loadSchedules: (headers?: Record<string, string>) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  schedules: [],
  loaded: false,

  load: async (headers) => {
    try {
      const res = await fetch(`${BASE_URL}/workflows`, { headers });
      const data = await res.json();
      set({ workflows: data.workflows || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  getWorkflow: (id) => get().workflows.find(w => w.id === id),
  getVersion: (wid, vid) => get().workflows.find(w => w.id === wid)?.versions.find(v => v.id === vid),
  getLatestVersion: (wid) => {
    const wf = get().workflows.find(w => w.id === wid);
    return wf?.versions[wf.versions.length - 1];
  },

  createWorkflow: async (name, versionData, headers) => {
    try {
      const res = await fetch(`${BASE_URL}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name, version: versionData }),
      });
      const data = await res.json();
      if (data.workflow) {
        set(s => ({ workflows: [...s.workflows, data.workflow] }));
        return data.workflow;
      }
      return null;
    } catch { return null; }
  },

  addVersion: async (workflowId, versionData, headers) => {
    try {
      const res = await fetch(`${BASE_URL}/workflows/${workflowId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(versionData),
      });
      const data = await res.json();
      if (data.version) {
        set(s => ({
          workflows: s.workflows.map(w => w.id === workflowId
            ? { ...w, versions: [...w.versions, data.version], updatedAt: Date.now() }
            : w),
        }));
        return data.version;
      }
      return null;
    } catch { return null; }
  },

  addRun: async (workflowId, versionId, run, headers) => {
    try {
      const res = await fetch(`${BASE_URL}/workflows/${workflowId}/versions/${versionId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(run),
      });
      const data = await res.json();
      if (data.run) {
        set(s => ({
          workflows: s.workflows.map(w => w.id === workflowId
            ? { ...w, runs: [...w.runs, data.run] }
            : w),
        }));
        return data.run;
      }
      return null;
    } catch { return null; }
  },

  updateRun: async (workflowId, runId, update, headers) => {
    try {
      await fetch(`${BASE_URL}/runs/${runId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(update),
      });
      set(s => ({
        workflows: s.workflows.map(w => w.id === workflowId
          ? { ...w, runs: w.runs.map(r => r.id === runId ? { ...r, ...update } : r) }
          : w),
      }));
    } catch {}
  },

  deleteWorkflow: async (id, headers) => {
    try {
      await fetch(`${BASE_URL}/workflows/${id}`, { method: "DELETE", headers });
      set(s => ({ workflows: s.workflows.filter(w => w.id !== id) }));
    } catch {}
  },

  loadSchedules: async (headers) => {
    try {
      const res = await fetch(`${BASE_URL}/agents/taskforce/schedules`, { headers });
      const data = await res.json();
      set({ schedules: data.schedules || [] });
    } catch {}
  },
}));
