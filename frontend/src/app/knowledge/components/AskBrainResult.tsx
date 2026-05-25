"use client";

import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AskBrainResultProps {
  answer: string;
  sources: Array<{ content: string; score: number }>;
  confidence: number;
  onClose: () => void;
  onSourceClick?: (content: string) => void;
}

function confidenceColor(c: number): { bar: string; text: string; label: string } {
  if (c < 0.3) return { bar: "bg-red-500", text: "text-red-400", label: "Low" };
  if (c < 0.7) return { bar: "bg-amber-500", text: "text-amber-400", label: "Medium" };
  return { bar: "bg-emerald-500", text: "text-emerald-400", label: "High" };
}

export function AskBrainResult({
  answer,
  sources,
  confidence,
  onClose,
  onSourceClick,
}: AskBrainResultProps) {
  const conf = confidenceColor(confidence);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-3"
      >
        <div className="bg-black/80 backdrop-blur-xl border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden">
          {/* Confidence bar */}
          <div className="h-1 bg-white/[0.04]">
            <div
              className={`h-full ${conf.bar} transition-all duration-500`}
              style={{ width: `${Math.max(confidence * 100, 4)}%` }}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-medium ${conf.text}`}>
                  Confidence: {Math.round(confidence * 100)}% ({conf.label})
                </span>
              </div>
              <button
                onClick={onClose}
                className="text-slate-600 hover:text-slate-300 p-1 rounded-lg hover:bg-white/[0.04] transition-all"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Answer */}
            <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap mb-3">
              {answer}
            </p>

            {/* Sources */}
            {sources.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[9px] font-medium text-slate-500 uppercase tracking-wider">
                  Sources ({sources.length})
                </span>
                {sources.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => onSourceClick?.(src.content)}
                    className="w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg border border-white/[0.04] bg-white/[0.02] hover:bg-violet-500/5 hover:border-violet-500/20 transition-all group"
                  >
                    <span className="text-[8px] text-slate-600 bg-white/[0.04] px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 group-hover:text-violet-400 transition-colors">
                      #{i + 1}
                    </span>
                    <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2 flex-1">
                      {src.content}
                    </p>
                    {src.score != null && (
                      <span
                        className={`text-[8px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                          src.score >= 0.7
                            ? "text-emerald-400 bg-emerald-500/10"
                            : src.score >= 0.4
                            ? "text-amber-400 bg-amber-500/10"
                            : "text-slate-500 bg-white/[0.04]"
                        }`}
                      >
                        {Math.round(src.score * 100)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
