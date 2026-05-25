"use client";

import { useState, useRef, useCallback } from "react";
import { Brain, ArrowUp, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { BASE_URL } from "@/types";
import { useTenant, tenantHeaders } from "@/context/tenant";

type RagMode = "basic" | "self_rag" | "react";

interface AskBrainProps {
  onResult: (answer: string, sources: any[]) => void;
}

export function AskBrain({ onResult }: AskBrainProps) {
  const { tenant } = useTenant();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<RagMode>("basic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BASE_URL}/rag/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantHeaders(tenant) },
        body: JSON.stringify({ question: q, mode }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "Request failed");
        throw new Error(msg);
      }

      const data = await res.json();
      const answer = data.answer || data.result || "";
      const sources = data.sources || data.chunks || [];
      onResult(answer, sources);
    } catch (err: any) {
      setError(err.message || "Failed to query brain");
    } finally {
      setLoading(false);
    }
  }, [question, mode, loading, tenant, onResult]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      setQuestion("");
      setError(null);
      inputRef.current?.blur();
    }
  };

  const modes: { id: RagMode; label: string }[] = [
    { id: "basic", label: "Basic" },
    { id: "self_rag", label: "Self-RAG" },
    { id: "react", label: "ReAct" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-3"
    >
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mb-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] text-red-400 text-center"
        >
          {error}
        </motion.div>
      )}

      <div className="flex items-center gap-2 bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-3 py-2.5 shadow-2xl transition-all focus-within:border-violet-500/30">
        <Brain className="h-4 w-4 text-violet-400/60 shrink-0" />

        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the brain anything..."
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none min-w-0"
          disabled={loading}
        />

        {/* Mode selector */}
        <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5 shrink-0">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${
                mode === m.id
                  ? "bg-violet-500/25 text-violet-300"
                  : "text-slate-600 hover:text-slate-400"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Send */}
        <button
          onClick={submit}
          disabled={loading || !question.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-20 disabled:hover:bg-violet-600 text-white rounded-xl p-1.5 transition-all active:scale-90 shrink-0"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
