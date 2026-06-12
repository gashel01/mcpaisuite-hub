"use client";

import { useEffect, useState } from "react";
import { FolderOpen, ChevronDown, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Ws {
  namespace: string;
  kind: "run" | "isolated" | "persistent" | string;
  label: string;
}

const KIND_LABEL: Record<string, string> = {
  run: "Run",
  isolated: "Isolated",
  persistent: "Named",
};

/**
 * Contextual "View workspace" entry for a run's trace (Observability).
 *
 * A TaskForce/deployment run can write to isolated/named workspace namespaces
 * (`{run_ns}__ws_*`, `{base}__ws_*`) that are deliberately kept OUT of the global tenant
 * dropdown to avoid clutter. This button is the door to them: it asks the backend which
 * workspaces this run produced and opens the chosen one in a NEW TAB at `/workspace?ns=…`.
 * A new tab (not setTenant + navigate) keeps the Observability context intact and avoids
 * mutating the shared `kernelmcp_tenant` localStorage — so the run's isolated workspace is
 * viewed in its own tab without disturbing the user's selected tenant anywhere.
 * Renders nothing when the run produced no such workspaces (the common chat case).
 */
export default function RunWorkspacesButton({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Ws[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setItems([]);
    setOpen(false);
    if (!taskId) return;
    let cancelled = false;
    apiFetch<any>(`/tasks/${encodeURIComponent(taskId)}/workspaces`)
      .then((d) => { if (!cancelled && Array.isArray(d?.workspaces)) setItems(d.workspaces); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taskId]);

  if (!taskId || items.length === 0) return null;

  const openWs = (ns: string) => {
    setOpen(false);
    window.open(`/workspace?ns=${encodeURIComponent(ns)}`, "_blank", "noopener");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Open a workspace this run produced"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/15 transition-colors"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Workspace{items.length > 1 ? `s · ${items.length}` : ""}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-xl shadow-black/40 overflow-hidden py-1">
            <p className="px-3 py-1.5 text-[9px] uppercase tracking-wide text-slate-600">Workspaces from this run · opens in new tab</p>
            {items.map((w) => (
              <button
                key={w.namespace}
                onClick={() => openWs(w.namespace)}
                className="group w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-200 font-medium truncate flex-1">{w.label}</span>
                  <span className="text-[8.5px] uppercase tracking-wide text-violet-300/70 bg-violet-500/10 px-1.5 py-0.5 rounded shrink-0">
                    {KIND_LABEL[w.kind] || w.kind}
                  </span>
                  <ExternalLink className="h-3 w-3 text-slate-600 group-hover:text-violet-400 shrink-0" />
                </div>
                <div className="text-[9px] text-slate-600 truncate mt-0.5">{w.namespace}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
