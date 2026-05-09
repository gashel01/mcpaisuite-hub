"use client";

import { useRef } from "react";
import { Send, Square, Paperclip } from "lucide-react";
import { BASE_URL } from "@/types";

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  execMode: "react" | "ltp" | "hybrid";
  setExecMode: (m: "react" | "ltp" | "hybrid") => void;
  onSend: () => void;
  onStop: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploading: string | null;
}

export default function ChatInput({ input, setInput, loading, execMode, setExecMode, onSend, onStop, onFileSelect, uploading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="shrink-0 px-4 pb-3 pt-2 border-t border-slate-800/40">
      <div className="max-w-3xl mx-auto bg-slate-800/60 border border-slate-700/60 rounded-2xl px-3 py-2 backdrop-blur-sm">
        <div className="flex items-end gap-2">
          <input type="file" ref={fileInputRef} onChange={onFileSelect} accept=".pdf,.docx,.txt,.md,.html,.csv,.json" className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || !!uploading}
            className="text-slate-500 hover:text-violet-400 disabled:opacity-40 p-1.5 mb-0.5 transition-colors"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message KernelMCP..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none py-1.5 max-h-[200px] leading-relaxed"
            disabled={loading}
          />

          {loading ? (
            <button onClick={onStop} className="bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white rounded-xl p-2 mb-0.5 transition-all" title="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={onSend} disabled={!input.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl p-2 mb-0.5 transition-all">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <div className="flex items-center bg-slate-900/60 rounded-lg overflow-hidden border border-slate-700/40">
            {(["react", "ltp", "hybrid"] as const).map(m => (
              <button
                key={m}
                onClick={() => { setExecMode(m); fetch(`${BASE_URL}/mode?mode=${m}`, { method: "POST" }); }}
                className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-all ${execMode === m ? "bg-violet-600 text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-600">Shift+Enter for new line</span>
        </div>
      </div>
    </div>
  );
}
