"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Play, Square, Terminal, Clock, Loader2, AlertTriangle } from "lucide-react";
import CodeEditor from "@/components/code-editor";
import { useTenant } from "@/context/tenant";
import { BASE_URL } from "@/types";

export default function SandboxPage() {
  const { tenant } = useTenant();
  const th = useMemo(() => ({ "X-Tenant-Id": tenant }), [tenant]);

  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
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

  const runCode = async () => {
    if (!code.trim() || running) return;

    setRunning(true);
    setOutput("");
    setStderr("");
    setArtifacts([]);

    const convId = "sandbox";
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

      // Stream task updates via SSE
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
            // Capture tool results from code execution turns
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
            // Track any file artifacts
            if (turn.tool_name === "write_file" && turn.tool_args?.path) {
              foundArtifacts.push(turn.tool_args.path as string);
              setArtifacts([...foundArtifacts]);
            }
          }

          if (msg.type === "done") {
            closeStream();
            setRunning(false);
            // If we got an answer but no tool output, show the answer
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
          // Fallback: SSE failed, try fetching final state
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
    <div className="flex flex-col h-[calc(100vh-3rem)] md:h-[calc(100vh)] -m-4 -mb-4 md:-m-6 md:-mb-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-slate-800/40 bg-slate-900/30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-emerald-600/20 flex items-center justify-center">
            <Terminal className="h-4 w-4 text-emerald-400" />
          </div>
          <h1 className="text-base font-semibold text-slate-100">Sandbox</h1>
        </div>

        <div className="flex-1" />

        {/* Timeout */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="h-3.5 w-3.5" />
          <input
            type="number"
            min={5}
            max={300}
            value={timeout}
            onChange={(e) => setTimeout_(Number(e.target.value))}
            className="w-14 bg-slate-800 border border-slate-700/60 text-slate-300 rounded-md px-2 py-1 text-xs text-center outline-none focus:border-emerald-600"
          />
          <span>s</span>
        </div>

        {/* Run / Stop */}
        {running ? (
          <button
            onClick={stopRun}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={runCode}
            disabled={!code.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            Run
          </button>
        )}
      </div>

      {/* Main panels */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left: Code Editor */}
        <div className="flex-1 min-h-0 flex flex-col p-3 overflow-auto">
          <CodeEditor
            code={code}
            onChange={setCode}
            language={language}
            onLanguageChange={setLanguage}
          />
        </div>

        {/* Right: Output */}
        <div className="flex-1 min-h-0 flex flex-col border-t md:border-t-0 md:border-l border-slate-800/40 overflow-hidden">
          {/* Stdout */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/40 shrink-0">
              <Terminal className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs font-medium text-slate-400">stdout</span>
              {running && <Loader2 className="h-3 w-3 text-emerald-400 animate-spin ml-auto" />}
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-sm text-slate-300 bg-slate-950 whitespace-pre-wrap">
              {output || (
                <span className="text-slate-600 italic">Output will appear here...</span>
              )}
            </pre>
          </div>

          {/* Stderr */}
          {stderr && (
            <div className="shrink-0 max-h-[30%] flex flex-col overflow-hidden border-t border-red-900/40">
              <div className="flex items-center gap-2 px-4 py-2 bg-red-950/20 shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-xs font-medium text-red-400">stderr</span>
              </div>
              <pre className="flex-1 overflow-auto p-4 font-mono text-sm text-red-300 bg-red-950/10 whitespace-pre-wrap">
                {stderr}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Artifacts */}
      {artifacts.length > 0 && (
        <div className="shrink-0 border-t border-slate-800/40 px-4 py-2 bg-slate-900/30">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span className="font-medium">Artifacts</span>
            <span className="text-slate-600">({artifacts.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {artifacts.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/60 border border-slate-700/40 text-xs text-slate-300 font-mono"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
