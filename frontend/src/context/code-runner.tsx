"use client";
import { apiFetch, apiUrl } from "@/lib/api";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";


interface RunResult {
  blockId: string;
  stdout: string;
  stderr: string;
  running: boolean;
  duration?: number;
  artifacts?: string[];
}

interface CodeRunnerCtx {
  results: Record<string, RunResult>;
  runCode: (blockId: string, code: string, language: string, tenant: string) => void;
  openEditor: (code: string, language: string) => void;
  runInEditor: (code: string, language: string) => void;
  editorRequest: { code: string; language: string; autoRun?: boolean } | null;
  clearEditorRequest: () => void;
}

const CodeRunnerContext = createContext<CodeRunnerCtx>({
  results: {},
  runCode: () => {},
  openEditor: () => {},
  runInEditor: () => {},
  editorRequest: null,
  clearEditorRequest: () => {},
});

export function CodeRunnerProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [editorRequest, setEditorRequest] = useState<{ code: string; language: string; autoRun?: boolean } | null>(null);
  const esRefs = useRef<Record<string, EventSource>>({});

  const runCode = useCallback((blockId: string, code: string, language: string, tenant: string) => {
    // Set running state
    setResults(prev => ({ ...prev, [blockId]: { blockId, stdout: "", stderr: "", running: true } }));

    const convId = `run-${Date.now().toString(36)}`;
    const message = `Run this code:\n\`\`\`${language}\n${code}\n\`\`\``;

    // Close previous stream for this block
    if (esRefs.current[blockId]) {
      esRefs.current[blockId].close();
      delete esRefs.current[blockId];
    }

    apiFetch<any>("/chat", {
      method: "POST", tenant,
      body: { message, conversation_id: convId, execution_mode: "react" },
    })
      .then(data => {
        const taskId = data.task_id;
        if (!taskId) {
          setResults(prev => ({ ...prev, [blockId]: { blockId, stdout: "", stderr: "Failed to create task", running: false } }));
          return;
        }

        let stdout = "";
        let stderr = "";
        const artifacts: string[] = [];
        const startTime = Date.now();

        const es = new EventSource(apiUrl(`/chat/${encodeURIComponent(convId)}/stream/${encodeURIComponent(taskId)}`));
        esRefs.current[blockId] = es;

        es.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "turn") {
              const turn = msg.turn;
              if (turn.tool_name && turn.tool_result) {
                if (turn.tool_success === false) {
                  stderr += turn.tool_result + "\n";
                } else {
                  stdout += turn.tool_result + "\n";
                }
                setResults(prev => ({ ...prev, [blockId]: { blockId, stdout, stderr, running: true, artifacts: [...artifacts] } }));
              }
              if (turn.tool_name === "write_file" && turn.tool_args?.path) {
                artifacts.push(turn.tool_args.path as string);
              }
            }

            if (msg.type === "done") {
              es.close();
              delete esRefs.current[blockId];
              const duration = Date.now() - startTime;
              if (!stdout && !stderr && msg.answer) stdout = msg.answer;
              setResults(prev => ({ ...prev, [blockId]: { blockId, stdout, stderr, running: false, duration, artifacts: [...artifacts] } }));
            }

            if (msg.type === "error") {
              es.close();
              delete esRefs.current[blockId];
              setResults(prev => ({ ...prev, [blockId]: { blockId, stdout, stderr: stderr || msg.message || "Error", running: false } }));
            }
          } catch { /* ignore */ }
        };

        es.onerror = () => {
          es.close();
          delete esRefs.current[blockId];
          setResults(prev => ({ ...prev, [blockId]: { ...prev[blockId], running: false, stderr: prev[blockId]?.stderr || "Connection lost" } }));
        };
      })
      .catch(err => {
        setResults(prev => ({ ...prev, [blockId]: { blockId, stdout: "", stderr: String(err), running: false } }));
      });
  }, []);

  const openEditor = useCallback((code: string, language: string) => {
    setEditorRequest({ code, language });
  }, []);

  const runInEditor = useCallback((code: string, language: string) => {
    setEditorRequest({ code, language, autoRun: true });
  }, []);

  const clearEditorRequest = useCallback(() => {
    setEditorRequest(null);
  }, []);

  return (
    <CodeRunnerContext.Provider value={{ results, runCode, openEditor, runInEditor, editorRequest, clearEditorRequest }}>
      {children}
    </CodeRunnerContext.Provider>
  );
}

export function useCodeRunner() {
  return useContext(CodeRunnerContext);
}
