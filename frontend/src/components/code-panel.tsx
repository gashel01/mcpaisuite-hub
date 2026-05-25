"use client";

import { useState, useRef, useCallback, useMemo, useEffect, type MutableRefObject } from "react";
import { Play, Square, Clock, Loader2, AlertTriangle, Terminal, X } from "lucide-react";
import CodeEditor from "@/components/code-editor";
import { useCodeRunner } from "@/context/code-runner";
import { BASE_URL } from "@/types";

interface CodePanelProps {
  onClose: () => void;
  tenant: string;
}

export default function CodePanel({ onClose, tenant }: CodePanelProps) {
  const th = useMemo(() => ({ "X-Tenant-Id": tenant }), [tenant]);
  const { editorRequest, clearEditorRequest } = useCodeRunner();

  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");

  const autoRunPending = useRef(false);

  // Pre-fill code from editor request (when user clicks "Edit" or "Run" on a code block)
  useEffect(() => {
    if (editorRequest) {
      setCode(editorRequest.code);
      setLanguage(editorRequest.language);
      if (editorRequest.autoRun) {
        autoRunPending.current = true;
      }
      clearEditorRequest();
    }
  }, [editorRequest, clearEditorRequest]);

  // Auto-run after code is set (needs separate effect to ensure state is updated)
  useEffect(() => {
    if (autoRunPending.current && code && !running) {
      autoRunPending.current = false;
      // Small delay to let the UI render the code first
      setTimeout(() => runCodeFn(), 100);
    }
  }, [code]);
  const [output, setOutput] = useState("");
  const [stderr, setStderr] = useState("");
  const [running, setRunning] = useState(false);
  const [timeout, setTimeout_] = useState(60);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const runCodeFn = async () => {
    if (!code.trim() || running) return;

    setRunning(true);
    setOutput("");
    setStderr("");
    setArtifacts([]);

    const convId = `sandbox-${Date.now()}`;
    const message = `Run this code:\n\`\`\`${language}\n${code}\n\`\`\``;

    try {
      const res = await fetch(`${BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({
          message,
          conversation_id: convId,
          execution_mode: "react",
        }),
      });

      const data = await res.json();
      const taskId = data.task_id;

      if (!taskId) {
        setStderr("Failed to create task.");
        setRunning(false);
        return;
      }

      closeStream();
      const es = new EventSource(
        `${BASE_URL}/chat/${encodeURIComponent(convId)}/stream/${encodeURIComponent(taskId)}`
      );
      eventSourceRef.current = es;

      let stdout = "";
      let errout = "";
      const foundArtifacts: string[] = [];

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "turn") {
            const turn = msg.turn;
            if (turn.tool_name && turn.tool_result) {
              const result = turn.tool_result;
              if (turn.tool_success === false) {
                errout += result + "\n";
                setStderr(errout);
              } else {
                stdout += result + "\n";
                setOutput(stdout);
              }
            }
            if (turn.tool_name === "write_file" && turn.tool_args?.path) {
              foundArtifacts.push(turn.tool_args.path as string);
              setArtifacts([...foundArtifacts]);
            }
          }

          if (msg.type === "done") {
            closeStream();
            setRunning(false);
            if (!stdout && !errout && msg.answer) {
              setOutput(msg.answer);
            }
          }

          if (msg.type === "error") {
            closeStream();
            setRunning(false);
            setStderr(msg.message || "Task failed");
          }
        } catch (_e) {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        closeStream();
        if (running) {
          fetch(`${BASE_URL}/chat/${convId}/task/${taskId}`)
            .then((r) => r.json())
            .then((task) => {
              setRunning(false);
              if (task.answer) setOutput(task.answer);
              if (task.status === "failed") setStderr("Task failed");
            })
            .catch(() => {
              setRunning(false);
              setStderr("Connection lost");
            });
        }
      };
    } catch (e) {
      setStderr(`Error: ${e}`);
      setRunning(false);
    }
  };

  const stopRun = async () => {
    closeStream();
    setRunning(false);
    setStderr((prev) => prev + "\n--- Cancelled ---");
  };

  return (
    <div className="w-[450px] shrink-0 flex flex-col h-full bg-[#0c0c14] border-l border-white/[0.06] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0">
        <Terminal className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-xs font-semibold text-slate-200">Code Editor</span>
        <div className="flex-1" />

        {/* Timeout */}
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          <input
            type="number"
            min={5}
            max={300}
            value={timeout}
            onChange={(e) => setTimeout_(Number(e.target.value))}
            className="w-10 bg-slate-800 border border-slate-700/60 text-slate-300 rounded px-1 py-0.5 text-[10px] text-center outline-none focus:border-violet-600"
          />
          <span className="text-[10px]">s</span>
        </div>

        {/* Run / Stop */}
        {running ? (
          <button
            onClick={stopRun}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        ) : (
          <button
            onClick={runCodeFn}
            disabled={!code.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 p-1 transition-colors"
          data-tooltip="Close code editor"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 p-2 overflow-auto">
          <CodeEditor
            code={code}
            onChange={setCode}
            language={language}
            onLanguageChange={setLanguage}
          />
        </div>

        {/* Output area */}
        <div className="shrink-0 max-h-[40%] flex flex-col border-t border-white/[0.06] overflow-hidden">
          {/* stdout */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04] shrink-0">
              <Terminal className="h-3 w-3 text-slate-500" />
              <span className="text-[10px] font-medium text-slate-400">stdout</span>
              {running && <Loader2 className="h-3 w-3 text-emerald-400 animate-spin ml-auto" />}
            </div>
            <pre className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] text-slate-300 bg-slate-950 whitespace-pre-wrap min-h-[60px]">
              {output || (
                <span className="text-slate-600 italic">Output will appear here...</span>
              )}
            </pre>
          </div>

          {/* stderr */}
          {stderr && (
            <div className="shrink-0 max-h-[120px] flex flex-col overflow-hidden border-t border-red-900/40">
              <div className="flex items-center gap-2 px-3 py-1 bg-red-950/20 shrink-0">
                <AlertTriangle className="h-3 w-3 text-red-400" />
                <span className="text-[10px] font-medium text-red-400">stderr</span>
              </div>
              <pre className="flex-1 overflow-auto px-3 py-2 font-mono text-[11px] text-red-300 bg-red-950/10 whitespace-pre-wrap">
                {stderr}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <div className="shrink-0 border-t border-white/[0.06] px-3 py-2 bg-slate-900/30">
          <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1">
            <span className="font-medium">Artifacts</span>
            <span className="text-slate-600">({artifacts.length})</span>
            <a href="/workspace" className="ml-auto text-[10px] text-violet-400 hover:text-violet-300 transition-colors">View in Workspace &rarr;</a>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {artifacts.map((a, i) => (
              <a
                key={i}
                href="/workspace"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] text-slate-300 font-mono hover:text-violet-300 hover:border-violet-500/20 transition-all"
              >
                {a}
                <span className="text-[10px] text-slate-600">&rarr;</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
