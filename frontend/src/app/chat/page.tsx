"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Cpu, Trash2, FileDown, ShieldAlert,
  FileText, Loader2, ArrowDown, Bot, PanelLeft, Search, X, Menu,
} from "lucide-react";
import { useTenant } from "@/context/tenant";
import { BASE_URL } from "@/types";
import type { ChatMsg, Turn, TaskInfo, ConvInfo, ScheduledJob } from "@/types";

import ChatMessage from "@/components/chat-message";
import ChatInput from "@/components/chat-input";
import ChatHistory from "@/components/chat-history";
import CodePanel from "@/components/code-panel";
import TaskModal from "@/components/task-modal";
import { useCodeRunner } from "@/context/code-runner";
import EgressPanel from "@/components/egress-panel";
import HostPanel from "@/components/host-panel";
import { TurnItem } from "@/components/turns";

// ── Main chat page ─────────────────────────────────────────────────────────

export default function ChatPage() {
  const { tenant } = useTenant();
  const th = useMemo(() => ({ "X-Tenant-Id": tenant }), [tenant]);

  // Core state
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [convId, setConvId] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      // Priority: URL param > last used conv > default
      return params.get("conv") || localStorage.getItem("kernelmcp_last_conv") || "default";
    }
    return "default";
  });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [liveTurns, setLiveTurns] = useState<Turn[]>([]);
  const [streamingText, setStreamingText] = useState(""); // live assistant text (typewriter)

  // Scroll
  const [showScrollDown, setShowScrollDown] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Panels
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [showEgress, setShowEgress] = useState(false);
  const [execMode, setExecMode] = useState<"react" | "ltp" | "hybrid">("react");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [showHostAccess, setShowHostAccess] = useState(false);
  const [hostApproved, setHostApproved] = useState<string[]>([]);
  const [hostPending, setHostPending] = useState<{ namespace: string; pattern: string }[]>([]);
  const [newHostPattern, setNewHostPattern] = useState("");

  // Search in conversation
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);

  // History — open inline by default on desktop, closed (drawer) on mobile
  const [showHistory, setShowHistory] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 768
  );
  const [conversations, setConversations] = useState<ConvInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [schedules, setSchedules] = useState<ScheduledJob[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null);
  const [elicitation, setElicitation] = useState<{ taskId: string; question: string } | null>(null);
  const [elicitResponse, setElicitResponse] = useState("");
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const { editorRequest, clearEditorRequest } = useCodeRunner();

  // Open code panel when "Edit" is clicked on a code block
  useEffect(() => {
    if (editorRequest) {
      setShowCodeEditor(true);
    }
  }, [editorRequest]);


  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userScrolledUp.current) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTurns]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      userScrolledUp.current = dist > 80;
      setShowScrollDown(dist > 200);
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────

  // Refresh sidebar data (conversations, tasks, schedules)
  const refreshSidebar = () => {
    const h = { headers: th };
    fetch(`${BASE_URL}/conversations`, h).then(r => r.json()).then(d => setConversations(d.conversations || [])).catch(() => {});
  };

  useEffect(() => {
    refreshSidebar(); // Load on mount
    // Poll conversations every 15s while running, otherwise every 60s
    const interval = setInterval(() => {
      refreshSidebar();
    }, loading ? 15000 : 60000);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    fetch(`${BASE_URL}/egress`, { headers: th }).then(r => r.json()).then(d => { setNetworkEnabled(d.enabled || false); setAllowedDomains(d.allowed_domains || []); }).catch(() => {});
    fetch(`${BASE_URL}/mode`).then(r => r.json()).then(d => { if (d.mode) setExecMode(d.mode); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/host`, { headers: th }).then(r => r.json()).then(d => { setHostApproved(d.approved || []); setHostPending(d.pending || []); }).catch(() => {});
  }, []);

  // ── SSE stream management ────────────────────────────────────────────────

  const eventSourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => { return () => closeStream(); }, [closeStream]);

  // Reconnect to a running task's SSE stream
  const reconnectToTask = useCallback((tid: string) => {
    closeStream();
    setLoading(true);
    setTaskId(tid);
    setLiveTurns([]); setStreamingText("");
    const turns: Turn[] = [];
    let taskDone = false;
    const es = new EventSource(`${BASE_URL}/chat/${encodeURIComponent(convId)}/stream/${encodeURIComponent(tid)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "delta") {
          setStreamingText(prev => prev + (msg.text || ""));
        }
        if (msg.type === "turn") {
          turns.push(msg.turn);
          setLiveTurns([...turns]);
          setStreamingText(""); // completed turn supersedes the streamed text
        }
        if (msg.type === "elicitation") {
          setElicitation({ taskId: msg.task_id, question: msg.question });
        }
        if (msg.type === "done") {
          taskDone = true;
          closeStream();
          setLoading(false);
          setMessages(prev => [...prev, {
            role: "assistant",
            content: msg.answer || `Task ${msg.status}. ${msg.total_tokens || 0} tokens.`,
            turns: msg.turns || turns,
            tokens: msg.total_tokens, cost: msg.total_cost, taskId: tid,
            bootstrapSources: msg.bootstrap_sources || [],
            timestamp: Date.now(),
          }]);
          setLiveTurns([]); setStreamingText("");
          setStreamingText("");
          setTaskId(null);
          refreshSidebar();
        }
        if (msg.type === "error") {
          taskDone = true;
          closeStream();
          setLoading(false);
          setMessages(prev => [...prev, { role: "assistant", content: msg.message || "Task failed" }]);
          setLiveTurns([]); setStreamingText("");
          setTaskId(null);
          refreshSidebar();
        }
      } catch (_e) {}
    };

    es.onerror = () => {
      closeStream();
      if (taskDone) return;
      // Fallback: fetch final state
      fetch(`${BASE_URL}/chat/${convId}/task/${tid}`, { headers: th }).then(r => r.json()).then(task => {
        setLoading(false);
        if (["completed", "failed", "cancelled"].includes(task.status)) {
          setMessages(prev => [...prev, { role: "assistant", content: task.answer || `Task ${task.status}.`, turns: task.turns, tokens: task.total_tokens, cost: task.total_cost, taskId: tid }]);
        }
        setLiveTurns([]); setStreamingText(""); setTaskId(null); refreshSidebar();
      }).catch(() => { setLoading(false); setLiveTurns([]); setStreamingText(""); setTaskId(null); });
    };
  }, [convId, closeStream, th]);

  // Load conversation messages — always sync from server
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlConv = params.get("conv");
      if (urlConv && urlConv !== convId) setConvId(urlConv);
    }
    setLoadingConv(true);
    fetch(`${BASE_URL}/chat/${encodeURIComponent(convId)}`, { headers: th }).then(r => r.json()).then(data => {
      const serverMsgs: ChatMsg[] = (data.messages || []).map((m: any) => ({
        role: m.role as "user" | "assistant", content: m.content,
        turns: m.turns, tokens: m.tokens, cost: m.cost, taskId: m.task_id,
        bootstrapSources: m.bootstrap_sources,
        timestamp: m.timestamp || undefined,
      }));
      setMessages(serverMsgs);
      setLoadingConv(false);

      // Check if there's a running task for this conversation
      const runningTaskId = data.running_task_id;
      if (runningTaskId && !eventSourceRef.current) {
        // Reconnect to the running task's stream
        reconnectToTask(runningTaskId);
      } else if (!eventSourceRef.current) {
        setLoading(false);
        setLiveTurns([]); setStreamingText("");
        setTaskId(null);
      }
    }).catch(() => {
      setLoadingConv(false);
      if (!eventSourceRef.current) {
        setLoading(false);
      }
    });
  }, [convId]);

  // Sync conversation on window focus + navigation return
  useEffect(() => {
    const syncFromServer = async () => {
      try {
        const r = await fetch(`${BASE_URL}/chat/${encodeURIComponent(convId)}`, { headers: th });
        if (!r.ok) return;
        const data = await r.json();
        const serverMsgs: any[] = data.messages || [];
        if (serverMsgs.length > messages.length) {
          setMessages(serverMsgs.map(m => ({
            role: m.role as "user" | "assistant", content: m.content,
            turns: m.turns, tokens: m.tokens, cost: m.cost, taskId: m.task_id,
            bootstrapSources: m.bootstrap_sources, timestamp: m.timestamp,
          })));
          setLoading(false);
          setLiveTurns([]); setStreamingText("");
        }
      } catch (_e) {}
    };
    window.addEventListener("focus", syncFromServer);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncFromServer(); });
    return () => {
      window.removeEventListener("focus", syncFromServer);
    };
  }, [convId, messages.length]);


  // ── Actions ──────────────────────────────────────────────────────────────

  const toggleNetwork = async () => { const next = !networkEnabled; await fetch(`${BASE_URL}/egress/toggle?enabled=${next}`, { method: "POST", headers: th }); setNetworkEnabled(next); };
  const addDomain = async () => { if (!newDomain.trim()) return; await fetch(`${BASE_URL}/egress/allow?domain=${encodeURIComponent(newDomain.trim())}`, { method: "POST", headers: th }); setAllowedDomains(prev => [...prev, newDomain.trim()]); setNewDomain(""); };
  const removeDomain = async (d: string) => { await fetch(`${BASE_URL}/egress/allow?domain=${encodeURIComponent(d)}`, { method: "DELETE", headers: th }); setAllowedDomains(prev => prev.filter(x => x !== d)); };

  const approveHost = async (p: string, guardNs?: string) => { await fetch(`${BASE_URL}/host/approve?pattern=${encodeURIComponent(p)}${guardNs ? `&guard_ns=${encodeURIComponent(guardNs)}` : ""}`, { method: "POST", headers: th }); setHostPending(prev => prev.filter(x => x.pattern !== p)); setHostApproved(prev => [...prev, p]); };
  const denyHost = async (p: string) => { await fetch(`${BASE_URL}/host/deny?pattern=${encodeURIComponent(p)}`, { method: "POST", headers: th }); setHostPending(prev => prev.filter(x => x.pattern !== p)); };
  const addHost = async () => { if (!newHostPattern.trim()) return; await fetch(`${BASE_URL}/host/approve?pattern=${encodeURIComponent(newHostPattern.trim())}`, { method: "POST", headers: th }); setHostApproved(prev => [...prev, newHostPattern.trim()]); setNewHostPattern(""); };
  const revokeHost = async (p: string) => { await fetch(`${BASE_URL}/host/approve?pattern=${encodeURIComponent(p)}`, { method: "DELETE", headers: th }); setHostApproved(prev => prev.filter(x => x !== p)); };

  const uploadAndAsk = async (file: File) => {
    setUploading(file.name);
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`${BASE_URL}/rag/upload`, { method: "POST", body: form, headers: th });
      if (!res.ok) throw new Error(await res.text());
      setUploading(null);
      setInput(`I just uploaded "${file.name}" to the knowledge base. Please search for its content and give me a summary.`);
    } catch (err) {
      setUploading(null);
      const errStr = String(err);
      let userMsg = `Failed to upload ${file.name}.`;
      if (errStr.includes("dimension error") || errStr.includes("expected dim")) userMsg += "\n\n**Vector dimension mismatch** — go to Settings > Knowledge / RAG to check your embedding model.";
      else userMsg += `\n\n\`${errStr.length > 200 ? errStr.slice(0, 200) + "..." : errStr}\``;
      setMessages(prev => [...prev, { role: "assistant", content: userMsg }]);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); if (files.length > 0) uploadAndAsk(files[0]); };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const files = Array.from(e.target.files || []); if (files.length > 0) uploadAndAsk(files[0]); };
  const clearChat = async () => { await fetch(`${BASE_URL}/chat/${convId}`, { method: "DELETE", headers: th }); setMessages([]); setLiveTurns([]); setStreamingText(""); };

  const stopTask = async () => {
    if (taskId) try { await fetch(`${BASE_URL}/tasks/${taskId}`, { method: "DELETE", headers: th }); } catch (_e) {}
    closeStream(); setLoading(false);
    // Keep the turns that were already executed — don't clear them
    setMessages(prev => [...prev, {
      role: "assistant",
      content: "Task stopped by user.",
      turns: liveTurns.length > 0 ? liveTurns : undefined,
      tokens: liveTurns.reduce((s: number, t: any) => s + (t.tokens_used || 0), 0) || undefined,
    } as any]);
    setLiveTurns([]); setStreamingText("");
  };

  const switchConv = (id: string) => {
    // Close any running stream and reset loading state
    closeStream();
    setLoading(false);
    setLoadingConv(true);
    setLiveTurns([]); setStreamingText("");
    setTaskId(null);
    setElicitation(null);
    setMessages([]);
    setSearchOpen(false);
    setSearchQuery("");
    userScrolledUp.current = false;
    setConvId(id);
    window.history.replaceState(null, "", `/chat?conv=${encodeURIComponent(id)}`);
    // Persist last conv for re-open
    if (typeof window !== "undefined") localStorage.setItem("kernelmcp_last_conv", id);
    // On mobile the history is a drawer — close it after picking a conversation
    if (typeof window !== "undefined" && window.innerWidth < 768) setShowHistory(false);
  };
  const newChat = () => switchConv("chat-" + Date.now().toString(36));
  const deleteConv = async (id: string) => {
    try { await fetch(`${BASE_URL}/chat/${encodeURIComponent(id)}`, { method: "DELETE", headers: th }); setConversations(prev => prev.filter(c => c.id !== id)); if (id === convId) newChat(); } catch (_e) {}
  };

  const selectTask = async (id: string) => {
    try { const r = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(id)}`, { headers: th }); if (r.ok) setSelectedTask(await r.json()); } catch (_e) {}
  };

  // ── Send ─────────────────────────────────────────────────────────────────

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput(""); setLoading(true); setLiveTurns([]); setStreamingText("");
    userScrolledUp.current = false;
    setMessages(prev => [...prev, { role: "user", content: msg, timestamp: Date.now() }]);

    try {
      const res = await fetch(`${BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...th },
        body: JSON.stringify({ message: msg, conversation_id: convId, enable_network: networkEnabled, allowed_domains: allowedDomains, execution_mode: execMode }),
      });
      const data = await res.json();
      const tid = data.task_id;
      setTaskId(tid);
      if (typeof window !== "undefined") localStorage.setItem("kernelmcp_last_conv", convId);
      refreshSidebar(); // Refresh after sending message (new conversation)
      if (!tid) { setMessages(prev => [...prev, { role: "assistant", content: "Failed to create task." }]); setLoading(false); return; }

      // Stream task updates via SSE
      closeStream();
      const turns: Turn[] = [];
      let taskDone = false;

      // Poll host access requests every 5s while running (agent may block on request_host_access)
      const hostPoll = setInterval(() => {
        fetch(`${BASE_URL}/host`, { headers: th }).then(r => r.json()).then(d => setHostPending(d.pending || [])).catch(() => {});
      }, 5000);

      const es = new EventSource(`${BASE_URL}/chat/${encodeURIComponent(convId)}/stream/${encodeURIComponent(tid)}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "delta") {
            setStreamingText(prev => prev + (msg.text || ""));
          }

          if (msg.type === "turn") {
            turns.push(msg.turn);
            setLiveTurns([...turns]);
            setStreamingText(""); // completed turn supersedes the streamed text
          }

          if (msg.type === "elicitation") {
            setElicitation({ taskId: msg.task_id, question: msg.question });
          }

          if (msg.type === "done") {
            taskDone = true;
            closeStream();
            clearInterval(hostPoll);
            setLoading(false);
            setHostPending([]);
            setMessages(prev => [...prev, {
              role: "assistant",
              content: msg.answer || `Task ${msg.status}. ${msg.total_tokens || 0} tokens.`,
              turns: msg.turns || turns,
              tokens: msg.total_tokens,
              cost: msg.total_cost,
              taskId: tid,
              bootstrapSources: msg.bootstrap_sources || [],
            }]);
            setLiveTurns([]); setStreamingText("");
            setStreamingText("");
            setTaskId(null);
            refreshSidebar(); // Refresh conversations/tasks after task completes
          }

          if (msg.type === "error") {
            taskDone = true;
            closeStream();
            clearInterval(hostPoll);
            setLoading(false);
            setHostPending([]);
            setMessages(prev => [...prev, { role: "assistant", content: msg.message || "Task failed" }]);
          }
        } catch (_e) {}
      };

      es.onerror = () => {
        closeStream();
        clearInterval(hostPoll);
        if (taskDone) return;
        // Fallback: SSE failed, fetch final state once
        fetch(`${BASE_URL}/chat/${convId}/task/${tid}`, { headers: th }).then(r => r.json()).then(task => {
          setLoading(false);
          if (["completed", "failed", "cancelled"].includes(task.status)) {
            setMessages(prev => [...prev, { role: "assistant", content: task.answer || `Task ${task.status}.`, turns: task.turns, tokens: task.total_tokens, cost: task.total_cost, taskId: tid }]);
          }
          setLiveTurns([]); setStreamingText(""); setTaskId(null);
          refreshSidebar();
        }).catch(() => { setLoading(false); setLiveTurns([]); setStreamingText(""); setTaskId(null); });
      };

    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e}` }]);
      setLoading(false);
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const exportPDF = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const msgsHtml = messages.map(m => {
      if (m.role === "user") return `<div class="msg"><div class="bubble user">${m.content}</div></div>`;
      if (m.role === "assistant") return `<div class="msg"><div class="bubble bot">${m.content.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</div></div>`;
      return "";
    }).join("");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>KernelMCP Export</title><style>body{font-family:system-ui;background:#0f0f17;color:#e4e4ef;max-width:800px;margin:0 auto;padding:40px}.msg{margin:16px 0}.bubble{padding:12px 16px;border-radius:12px;font-size:14px;line-height:1.6;white-space:pre-wrap}.user{background:#1e293b;max-width:80%}.bot{background:#1e1e2e;border:1px solid #2a2a3a}strong{color:#f1f5f9}@media print{body{background:#fff;color:#111}.user{background:#f1f5f9}.bot{background:#fafafa;border-color:#e2e8f0}}</style></head><body><h1 style="color:#a78bfa">KernelMCP Chat Export</h1>${msgsHtml}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  // ── Suggestions ──────────────────────────────────────────────────────────

  const suggestions = [
    "What is the weather in Paris?",
    "Write a fibonacci script and run it",
    "Remember that I prefer dark mode",
    "Search my knowledge base for recent notes",
    "Schedule a reminder in 5 minutes",
    "What files are in my workspace?",
  ];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="obs-page flex -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)]">
      {/* History sidebar */}
      <ChatHistory
        conversations={conversations} convId={convId}
        runningConvId={loading ? convId : null}
        open={showHistory}
        onSwitchConv={switchConv} onNewChat={newChat} onDeleteConv={deleteConv}
        onClose={() => setShowHistory(false)}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 relative" onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleFileDrop}>
        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-50 bg-violet-950/80 border-2 border-dashed border-violet-500 rounded-xl flex items-center justify-center ">
            <div className="text-center">
              <FileText className="h-10 w-10 text-violet-400 mx-auto mb-2" />
              <p className="text-violet-300 font-medium">Drop file to add to knowledge base</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 shrink-0 border-b border-white/[0.04]">
          {/* Nav menu (mobile) */}
          <button
            onClick={() => {
              const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
              if (btn) btn.click();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
            aria-label="Navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          {/* Chat history toggle (mobile) */}
          <button
            onClick={() => setShowHistory(true)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
            aria-label="Chat history"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          {!showHistory && (
            <button onClick={() => setShowHistory(true)} className="text-slate-600 hover:text-violet-400 p-1.5 transition-colors hidden md:block" data-tooltip="Show history">
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
            <Cpu className="h-4 w-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-100 leading-tight">Kernel Chat</h1>
            <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Full orchestrator &middot; 97 tools</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }} className={`p-1.5 rounded-lg transition-colors touch-target ${searchOpen ? "text-violet-400" : "text-slate-600 hover:text-violet-400"}`} data-tooltip="Search">
              <Search className="h-3.5 w-3.5" />
            </button>
            <button onClick={exportPDF} disabled={messages.length === 0} className="text-slate-600 hover:text-violet-400 disabled:opacity-20 disabled:cursor-not-allowed p-1.5 rounded-lg transition-colors touch-target hidden sm:block" data-tooltip="Export">
              <FileDown className="h-3.5 w-3.5" />
            </button>
            <button onClick={clearChat} className="text-slate-600 hover:text-red-400 p-1.5 rounded-lg transition-colors touch-target" data-tooltip="Clear chat">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Security panels removed — managed in /security page */}

        {/* Search bar */}
        {searchOpen && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/[0.04] bg-white/[0.01] animate-fade-in">
            <Search className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search in conversation..."
              className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none" autoFocus />
            {searchQuery && <span className="text-[10px] text-slate-500">{messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase())).length} found</span>}
            <button onClick={() => { setSearchOpen(false); setSearchQuery(""); }} className="text-slate-600 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 scroll-smooth px-4">
          {/* Loading skeleton when switching conversations */}
          {loadingConv && messages.length === 0 && (
            <div className="space-y-5 py-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`flex gap-2.5 ${i % 2 === 0 ? "justify-end" : ""} animate-stagger`} style={{ animationDelay: `${i * 100}ms` }}>
                  {i % 2 !== 0 && <div className="h-7 w-7 rounded-lg bg-white/[0.03] shrink-0" />}
                  <div className={`${i % 2 === 0 ? "w-48" : "w-64"} rounded-2xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2`}>
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-3/4" />
                    {i % 2 !== 0 && <div className="skeleton h-3 w-1/2" />}
                  </div>
                </div>
              ))}
            </div>
          )}

          {messages.length === 0 && !loading && !loadingConv && (
            <div className="flex flex-col items-center justify-center flex-1 py-20 px-4 animate-fade-in">
              <div className="relative mb-6">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-600/15 to-violet-900/10 border border-violet-500/15 flex items-center justify-center animate-glow">
                  <Cpu className="h-7 w-7 text-violet-400" />
                </div>
                <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 border-2 border-[#0a0a10] animate-pulse" />
              </div>
              <h2 className="text-xl font-bold text-slate-100 mb-2 animate-stagger" style={{ animationDelay: "100ms" }}>What can I help with?</h2>
              <p className="text-sm text-slate-500 mb-8 text-center max-w-md leading-relaxed animate-stagger" style={{ animationDelay: "200ms" }}>Search the web, execute code, manage files, query your knowledge base, schedule tasks, and more.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => setInput(s)} className="group text-left text-[13px] bg-white/[0.02] hover:bg-violet-500/[0.06] text-slate-400 hover:text-violet-300 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-violet-500/20 transition-all duration-200 hover:scale-[1.02] animate-stagger" style={{ animationDelay: `${i * 80}ms` }}>
                    <span className="text-slate-600 group-hover:text-violet-500 mr-1.5 transition-colors">&rarr;</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-5 py-4 min-h-min">
            {messages.map((msg, i) => {
              const matchesSearch = !searchQuery || msg.content.toLowerCase().includes(searchQuery.toLowerCase());
              if (searchQuery && !matchesSearch) return <div key={i} className="opacity-20 transition-opacity duration-300"><ChatMessage msg={msg} /></div>;
              return (
                <div key={i}>
                  <ChatMessage msg={msg} />
                </div>
              );
            })}

            {/* Live progress */}
            {loading && (liveTurns.length > 0 || streamingText) && (
              <div className="flex gap-2.5 animate-msg-assistant">
                <div className="h-7 w-7 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0 mt-0.5 animate-glow">
                  <Bot className="h-4 w-4 text-violet-400" />
                </div>
                <div className="bg-slate-800/40 border border-violet-800/20 rounded-2xl px-4 py-3 w-full md:max-w-[85%] space-y-2">
                  <div className="flex items-center gap-2 text-xs text-violet-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> <span className="animate-thinking">Working...</span>
                    {liveTurns.length > 0 && <span className="text-slate-600">{liveTurns.length} steps</span>}
                  </div>
                  {liveTurns.length > 0 && <div className="space-y-2">{liveTurns.map((t, j) => <TurnItem key={j} turn={t} />)}</div>}
                  {streamingText && (
                    <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
                      {streamingText}
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-violet-400 align-middle animate-pulse" />
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Inline host approval */}
            {hostPending.length > 0 && hostPending.map(p => (
              <div key={p.pattern} className="flex gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-amber-600/20 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                </div>
                <div className="bg-amber-950/20 border border-amber-700/40 rounded-2xl px-4 py-3 w-full md:max-w-[85%]">
                  <p className="text-sm text-amber-300 font-medium mb-1">Permission requested</p>
                  <code className="block bg-slate-900/80 text-amber-400 px-3 py-2 rounded-lg text-sm font-mono mb-3">{p.pattern}</code>
                  <div className="flex gap-2">
                    <button onClick={() => approveHost(p.pattern, p.namespace)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors">Approve</button>
                    <button onClick={() => denyHost(p.pattern)} className="bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors">Deny</button>
                  </div>
                </div>
              </div>
            ))}

            {/* Elicitation — kernel asking user a question */}
            {elicitation && (
              <div className="flex gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-4 w-4 text-blue-400" />
                </div>
                <div className="bg-blue-950/20 border border-blue-700/40 rounded-2xl px-4 py-3 w-full md:max-w-[85%]">
                  <p className="text-sm text-blue-300 font-medium mb-2">{elicitation.question}</p>
                  <div className="flex gap-2">
                    <input
                      value={elicitResponse}
                      onChange={e => setElicitResponse(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && elicitResponse.trim()) {
                          fetch(`${BASE_URL}/chat/elicit/${elicitation.taskId}`, {
                            method: "POST", headers: { "Content-Type": "application/json", ...th },
                            body: JSON.stringify({ response: elicitResponse }),
                          });
                          setElicitation(null);
                          setElicitResponse("");
                        }
                      }}
                      placeholder="Type your answer..."
                      className="flex-1 bg-slate-900/80 text-white px-3 py-1.5 rounded-lg text-sm border border-slate-700/50 focus:border-blue-500 outline-none"
                    />
                    <button
                      onClick={() => {
                        if (elicitResponse.trim()) {
                          fetch(`${BASE_URL}/chat/elicit/${elicitation.taskId}`, {
                            method: "POST", headers: { "Content-Type": "application/json", ...th },
                            body: JSON.stringify({ response: elicitResponse }),
                          });
                          setElicitation(null);
                          setElicitResponse("");
                        }
                      }}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >Reply</button>
                  </div>
                </div>
              </div>
            )}

            {/* Thinking */}
            {loading && liveTurns.length === 0 && !streamingText && hostPending.length === 0 && !elicitation && (
              <div className="flex gap-2.5 animate-msg-assistant">
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600/20 to-violet-800/10 border border-violet-500/15 flex items-center justify-center shrink-0 mt-0.5 animate-glow">
                  <Bot className="h-4 w-4 text-violet-400" />
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl px-4 py-3 animate-glow">
                  <div className="flex items-center gap-2.5">
                    <div className="flex gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="h-2 w-2 rounded-full bg-violet-400/80 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="h-2 w-2 rounded-full bg-violet-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs text-slate-500 font-medium animate-thinking">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div ref={endRef} />
        </div>

        {/* Scroll to bottom */}
        {showScrollDown && (
          <button onClick={() => { userScrolledUp.current = false; endRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-violet-600/90 hover:bg-violet-500 hover:scale-110 text-white rounded-full p-2.5 shadow-lg shadow-violet-500/25 transition-all z-10 animate-scale-in ">
            <ArrowDown className="h-4 w-4" />
          </button>
        )}

        {/* Upload indicator */}
        {uploading && (
          <div className="flex items-center gap-2 px-3 py-2 bg-violet-950/30 border border-violet-800/30 rounded-lg mx-4 mb-2 shrink-0">
            <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />
            <span className="text-xs text-violet-300">Uploading {uploading}...</span>
          </div>
        )}

        {/* Input */}
        <ChatInput input={input} setInput={setInput} loading={loading} execMode={execMode} setExecMode={setExecMode} onSend={send} onStop={stopTask} onFileSelect={handleFileSelect} uploading={uploading} />
      </div>

      {/* Code editor panel */}
      {showCodeEditor && <CodePanel onClose={() => setShowCodeEditor(false)} tenant={tenant} />}

      {/* Task modal */}
      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
