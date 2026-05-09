"use client";

import { useRef, useEffect, useCallback, KeyboardEvent } from "react";

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  language: string;
  onLanguageChange: (lang: string) => void;
}

const LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "node", label: "Node" },
  { id: "shell", label: "Shell" },
];

export default function CodeEditor({ code, onChange, language, onLanguageChange }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const lineCount = code.split("\n").length;

  // Auto-resize textarea
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [code, resize]);

  // Sync scroll between line numbers and textarea
  const syncScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Handle Tab key to insert spaces
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const spaces = "    ";
      const newCode = code.substring(0, start) + spaces + code.substring(end);
      onChange(newCode);
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 4;
      });
    }
  };

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden border border-slate-800/60">
      {/* Language tabs */}
      <div className="flex items-center gap-0 bg-slate-900 border-b border-slate-800/60 px-1 shrink-0">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.id}
            onClick={() => onLanguageChange(lang.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              language === lang.id
                ? "text-violet-400 bg-slate-950 border-b-2 border-violet-500"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>

      {/* Editor body */}
      <div className="flex flex-1 min-h-0 bg-slate-950 overflow-auto">
        {/* Line numbers */}
        <div
          ref={lineNumbersRef}
          className="shrink-0 select-none overflow-hidden bg-slate-950 border-r border-slate-800/40 py-3 px-2 text-right font-mono text-xs leading-[1.625rem] text-slate-600"
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i + 1}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          spellCheck={false}
          className="flex-1 bg-transparent text-slate-200 font-mono text-sm leading-[1.625rem] py-3 px-4 resize-none outline-none min-h-[200px] placeholder:text-slate-700"
          placeholder={
            language === "python"
              ? "# Write your Python code here..."
              : language === "node"
              ? "// Write your Node.js code here..."
              : "# Write your shell commands here..."
          }
        />
      </div>
    </div>
  );
}
