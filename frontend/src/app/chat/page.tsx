"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Wrench, AlertCircle, CheckCircle2, Clock, Cpu, Zap } from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

interface Turn {
  role: string;
  content: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: string;
  tool_success?: boolean;
  model?: string;
  tokens?: number;
}

interface TaskResult {
  id: string;
  goal: string;
  status: string;
  turns: Turn[];
  total_tokens?: number;
  total_cost?: number;
  total_turns?: number;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant" | "system"; content: string; task?: TaskResult }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskResult | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTask]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const goal = input.trim();
    setInput("");
    setLoading(true);
    setCurrentTask(null);

    setMessages(prev => [...prev, { role: "user", content: goal }]);

    try {
      // Submit task
      const res = await fetch(`${BASE_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const created = await res.json();
      const taskId = created.id || created.task_id;

      if (!taskId) {
        setMessages(prev => [...prev, { role: "assistant", content: "Failed to create task." }]);
        setLoading(false);
        return;
      }

      // Poll for live updates with timeout
      let pollCount = 0;
      const maxPolls = 150; // 150 * 800ms = 2 minutes max
      pollRef.current = setInterval(async () => {
        pollCount++;
        try {
          const r = await fetch(`${BASE_URL}/tasks/${taskId}`);
          if (!r.ok) return;
          const task: TaskResult = await r.json();
          setCurrentTask(task);

          if (["completed", "failed", "cancelled"].includes(task.status) || pollCount >= maxPolls) {
            stopPolling();
            setLoading(false);

            const lastAssistant = [...(task.turns || [])].reverse().find(t => t.role === "assistant" && t.content);
            const summary = lastAssistant?.content || `Task ${task.status}. ${task.total_turns || 0} turns, ${task.total_tokens || 0} tokens, $${(task.total_cost || 0).toFixed(4)}`;

            setMessages(prev => [...prev, { role: "assistant", content: summary, task }]);
            setCurrentTask(null);
          }
        } catch {
          // ignore poll errors
        }
      }, 800);

    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e}` }]);
      setLoading(false);
    }
  };

  const renderTurn = (turn: Turn, i: number) => {
    if (turn.role === "tool_call" && turn.tool_name) {
      return (
        <div key={i} className="flex items-start gap-2 text-xs">
          <Wrench className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
          <div className="bg-violet-950/30 border border-violet-800/30 rounded-lg px-3 py-2 w-full">
            <span className="text-violet-300 font-mono font-medium">{turn.tool_name}</span>
            {turn.tool_args && (
              <pre className="text-violet-400/70 mt-1 text-[10px] max-h-20 overflow-auto">{JSON.stringify(turn.tool_args, null, 2)}</pre>
            )}
          </div>
        </div>
      );
    }
    if (turn.role === "tool_result") {
      const success = turn.tool_success !== false;
      return (
        <div key={i} className="flex items-start gap-2 text-xs ml-5">
          {success ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
          )}
          <pre className={`rounded-lg px-3 py-2 w-full max-h-32 overflow-auto text-[10px] ${success ? "bg-green-950/20 text-green-300/80" : "bg-red-950/20 text-red-300/80"}`}>
            {(turn.tool_result || turn.content || "").slice(0, 500)}
          </pre>
        </div>
      );
    }
    if (turn.role === "assistant" && turn.content) {
      return (
        <div key={i} className="flex items-start gap-2 text-xs">
          <Bot className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
          <p className="text-slate-300 text-sm">{turn.content.slice(0, 300)}</p>
        </div>
      );
    }
    if (turn.role === "system" && turn.content) {
      return (
        <div key={i} className="text-[10px] text-amber-500/70 italic ml-5">{turn.content.slice(0, 200)}</div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Cpu className="h-6 w-6 text-violet-500" />
        <div>
          <h1 className="text-xl font-bold text-slate-100">Kernel Chat</h1>
          <p className="text-xs text-slate-500">
            Autonomous agent — plans, remembers, writes files, executes code, searches docs
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="text-center py-16">
            <Cpu className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm mb-2">The kernel orchestrates all 5 libraries autonomously.</p>
            <p className="text-slate-600 text-xs">Try:</p>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {["Write a Python script that calculates fibonacci numbers", "Remember that I prefer TypeScript over JavaScript", "Create a plan to build a REST API", "What files are in my workspace?"].map((s, i) => (
                <button key={i} onClick={() => setInput(s)} className="text-xs bg-slate-800 hover:bg-violet-900/30 text-slate-400 hover:text-violet-300 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "user" && (
              <div className="flex gap-3 justify-end">
                <div className="max-w-[75%] bg-violet-900/40 border border-violet-800/50 rounded-xl px-4 py-3 text-sm text-violet-100">
                  {msg.content}
                </div>
                <User className="h-5 w-5 text-slate-500 mt-1 shrink-0" />
              </div>
            )}
            {msg.role === "assistant" && (
              <div className="flex gap-3">
                <Bot className="h-5 w-5 text-violet-500 mt-1 shrink-0" />
                <div className="max-w-[85%] space-y-2">
                  <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {/* Show ReAct turns for this task */}
                  {msg.task && msg.task.turns && msg.task.turns.length > 0 && (
                    <details className="bg-slate-800/50 border border-slate-700/50 rounded-lg">
                      <summary className="px-3 py-2 text-xs text-slate-500 cursor-pointer hover:text-slate-300">
                        <Zap className="h-3 w-3 inline mr-1" />
                        {msg.task.turns.length} turns · {msg.task.total_tokens || 0} tokens · ${(msg.task.total_cost || 0).toFixed(4)}
                      </summary>
                      <div className="px-3 pb-3 space-y-2">
                        {msg.task.turns.map((turn, j) => renderTurn(turn, j))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Live task progress */}
        {currentTask && (
          <div className="flex gap-3">
            <Bot className="h-5 w-5 text-violet-500 mt-1 shrink-0 animate-pulse" />
            <div className="bg-slate-800 border border-violet-800/30 rounded-xl px-4 py-3 w-full max-w-[85%] space-y-2">
              <div className="flex items-center gap-2 text-xs text-violet-400">
                <Clock className="h-3 w-3 animate-spin" />
                <span>{currentTask.status}...</span>
                <span className="text-slate-600">{currentTask.turns?.length || 0} turns</span>
              </div>
              {(currentTask.turns || []).slice(-6).map((turn, j) => renderTurn(turn, j))}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Tell the kernel what to do..."
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl px-4 py-3 transition-colors"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
