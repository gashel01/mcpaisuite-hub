import { apiFetch } from "@/lib/api";
import { create } from "zustand";

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
  taskId?: string;
  createdAt: number;
  completedAt?: number;
  // Self-contained snapshot — lets a run reopen in the builder even if its workflow is gone
  graph?: { nodes: any[]; edges: any[] } | null;
  workflowName?: string;
  workflowExists?: boolean; // set by GET /runs/{id}: is the live editable version still there?
}

export interface Workflow {
  id: string;
  name: string;
  versions: WorkflowVersion[];
  runs: WorkflowRun[];
  activeVersionId?: string;
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
  addVersion: (workflowId: string, version: Omit<WorkflowVersion, "id" | "workflowId" | "version" | "createdAt"> & { activate?: boolean }, headers?: Record<string, string>) => Promise<WorkflowVersion | null>;
  activateVersion: (workflowId: string, versionId: string, headers?: Record<string, string>) => Promise<void>;
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
      const data = await apiFetch<any>("/workflows", { headers });
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
      const data = await apiFetch<any>("/workflows", {
        method: "POST", headers,
        body: { name, version: versionData },
      });
      if (data.workflow) {
        set(s => ({ workflows: [...s.workflows, data.workflow] }));
        return data.workflow;
      }
      return null;
    } catch { return null; }
  },

  addVersion: async (workflowId, versionData, headers) => {
    try {
      const data = await apiFetch<any>(`/workflows/${workflowId}/versions`, {
        method: "POST", headers,
        body: versionData,
      });
      if (data.version) {
        set(s => ({
          workflows: s.workflows.map(w => w.id === workflowId
            ? { ...w, versions: [...w.versions, data.version], updatedAt: Date.now(),
                ...(data.activeVersionId ? { activeVersionId: data.activeVersionId } : {}) }
            : w),
        }));
        return data.version;
      }
      return null;
    } catch { return null; }
  },

  activateVersion: async (workflowId, versionId, headers) => {
    try {
      await apiFetch(`/workflows/${workflowId}/activate/${versionId}`, { method: "POST", headers });
      set(s => ({
        workflows: s.workflows.map(w => w.id === workflowId ? { ...w, activeVersionId: versionId } : w),
      }));
    } catch {}
  },

  addRun: async (workflowId, versionId, run, headers) => {
    try {
      const data = await apiFetch<any>(`/workflows/${workflowId}/versions/${versionId}/runs`, {
        method: "POST", headers,
        body: run,
      });
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
      await apiFetch(`/runs/${runId}`, {
        method: "PUT", headers,
        body: update,
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
      await apiFetch(`/workflows/${id}`, { method: "DELETE", headers });
      set(s => ({ workflows: s.workflows.filter(w => w.id !== id) }));
    } catch {}
  },

  loadSchedules: async (headers) => {
    try {
      const data = await apiFetch<any>("/agents/taskforce/schedules", { headers });
      set({ schedules: data.schedules || [] });
    } catch {}
  },
}));
