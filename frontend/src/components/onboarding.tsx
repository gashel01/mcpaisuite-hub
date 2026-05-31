"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Database, Bot, Tv2, X, ArrowRight } from "lucide-react";
import Link from "next/link";

const STORAGE_KEY = "kernelmcp_onboarded";

export default function Onboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show on first visit
    if (typeof window !== "undefined" && !localStorage.getItem(STORAGE_KEY)) {
      // Small delay for smoother appearance
      const t = setTimeout(() => setShow(true), 500);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, "true");
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 " onClick={dismiss} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[#0c0c14] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-slide-up">
        {/* Gradient header */}
        <div className="relative px-6 pt-8 pb-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 to-transparent" />
          <div className="absolute top-0 right-0 w-40 h-40 bg-violet-500/5 rounded-full blur-3xl" />

          <button onClick={dismiss} className="absolute top-4 right-4 text-slate-600 hover:text-slate-300 transition-colors z-10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>

          <div className="relative z-10">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600/20 to-violet-800/10 border border-violet-500/20 flex items-center justify-center mb-4">
              <div className="h-3 w-3 rounded-full bg-violet-400 shadow-sm shadow-violet-400/50" />
            </div>
            <h2 className="text-lg font-bold text-slate-100 mb-1">Welcome to kernelmcp</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              The orchestration dashboard for the MCP AI Suite. Your agent has access to 80+ tools across 7 servers.
            </p>
          </div>
        </div>

        {/* Quick start items */}
        <div className="px-6 pb-2 space-y-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Quick start</p>

          <Link href="/chat" onClick={dismiss} className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/20 hover:bg-violet-500/[0.04] transition-all">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
              <MessageSquare className="h-4 w-4 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200">Chat</p>
              <p className="text-[10px] text-slate-500">Send a message — the agent plans and executes using all available tools</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-violet-400 transition-colors shrink-0" />
          </Link>

          <Link href="/knowledge" onClick={dismiss} className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/20 hover:bg-violet-500/[0.04] transition-all">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
              <Database className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200">Knowledge</p>
              <p className="text-[10px] text-slate-500">Upload documents for RAG search — PDF, DOCX, TXT, and more</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-violet-400 transition-colors shrink-0" />
          </Link>

          <Link href="/agents" onClick={dismiss} className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/20 hover:bg-violet-500/[0.04] transition-all">
            <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/15 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200">Agents</p>
              <p className="text-[10px] text-slate-500">Spawn specialized sub-agents for code, research, files, or custom tasks</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-violet-400 transition-colors shrink-0" />
          </Link>

          <Link href="/monitor" onClick={dismiss} className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-500/20 hover:bg-violet-500/[0.04] transition-all">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0">
              <Tv2 className="h-4 w-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200">Live Execution</p>
              <p className="text-[10px] text-slate-500">Real-time execution graph and system event stream</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-violet-400 transition-colors shrink-0" />
          </Link>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-between">
          <span className="text-[10px] text-slate-600">Part of the MCP AI Suite</span>
          <button onClick={dismiss} className="text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-4 py-2 rounded-lg transition-all">
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
