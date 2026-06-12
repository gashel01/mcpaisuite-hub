"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type DemoMode = "kernel" | "memory" | "rag" | "planning" | "sandbox" | "workspace" | "scheduler";

export const MODE_META: Record<DemoMode, { label: string; color: string; description: string }> = {
  kernel:    { label: "Kernel",    color: "violet",  description: "Full orchestrator — all tools" },
  memory:    { label: "Memory",    color: "sky",     description: "Facts, episodes, decay, graph" },
  rag:       { label: "RAG",       color: "emerald", description: "Documents, search, knowledge graph" },
  planning:  { label: "Planning",  color: "amber",   description: "Plans, steps, templates, diagrams" },
  sandbox:   { label: "Sandbox",   color: "rose",    description: "Code execution, web tools, host" },
  workspace: { label: "Workspace", color: "cyan",    description: "Files, checkpoints, DLP, audit" },
  scheduler: { label: "Scheduler", color: "orange",  description: "Jobs, cron, intervals, watches" },
};

/** Which nav pages are visible in each mode */
export const MODE_PAGES: Record<DemoMode, string[]> = {
  kernel:    ["/chat", "/agents", "/knowledge", "/workspace", "/scheduler", "/observability", "/security", "/settings"],
  memory:    ["/chat", "/knowledge", "/settings"],
  rag:       ["/chat", "/knowledge", "/settings"],
  planning:  ["/chat", "/settings"],
  sandbox:   ["/chat", "/settings"],
  workspace: ["/chat", "/workspace", "/settings"],
  scheduler: ["/chat", "/scheduler", "/settings"],
};

interface ModeCtx {
  mode: DemoMode;
  setMode: (m: DemoMode) => void;
  isPageVisible: (href: string) => boolean;
}

const ModeContext = createContext<ModeCtx>({
  mode: "kernel",
  setMode: () => {},
  isPageVisible: () => true,
});

export function ModeProvider({ children }: { children: ReactNode }) {
  // SSR-safe: default on the initial render, restore from localStorage after mount (below) so
  // the server and client first render match (avoids hydration mismatch).
  const [mode, setModeState] = useState<DemoMode>("kernel");
  useEffect(() => {
    const stored = localStorage.getItem("kernelmcp_mode") as DemoMode | null;
    if (stored && stored !== "kernel") setModeState(stored);
  }, []);

  const setMode = (m: DemoMode) => {
    setModeState(m);
    if (typeof window !== "undefined") {
      localStorage.setItem("kernelmcp_mode", m);
    }
  };

  const isPageVisible = (href: string) => MODE_PAGES[mode].includes(href);

  return (
    <ModeContext.Provider value={{ mode, setMode, isPageVisible }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
