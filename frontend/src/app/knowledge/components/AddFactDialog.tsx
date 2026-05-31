"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, Plus, Check, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BASE_URL } from "@/types";
import { useTenant, tenantHeaders } from "@/context/tenant";

interface AddFactDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  prefillContent?: string;
}

const FACT_TYPES = ["fact", "rule", "preference", "observation"] as const;
type FactType = (typeof FACT_TYPES)[number];

const IMPORTANCE_LABELS: Record<string, string> = {
  "0": "Low",
  "0.33": "Medium",
  "0.66": "High",
  "1": "Critical",
};

function importanceLabel(v: number): string {
  if (v <= 0.15) return "Low";
  if (v <= 0.5) return "Medium";
  if (v <= 0.8) return "High";
  return "Critical";
}

function importanceColor(v: number): string {
  if (v <= 0.15) return "text-blue-400";
  if (v <= 0.5) return "text-amber-400";
  if (v <= 0.8) return "text-orange-400";
  return "text-red-400";
}

export function AddFactDialog({ open, onClose, onAdded, prefillContent }: AddFactDialogProps) {
  const { tenant } = useTenant();
  const [content, setContent] = useState(prefillContent || "");
  const [importance, setImportance] = useState(0.5);
  const [factType, setFactType] = useState<FactType>("fact");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setContent(prefillContent || "");
      setImportance(0.5);
      setFactType("fact");
      setTags([]);
      setTagInput("");
      setError(null);
      setSuccess(false);
      setTimeout(() => contentRef.current?.focus(), 100);
    }
  }, [open, prefillContent]);

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput("");
  }, [tagInput, tags]);

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const submit = async () => {
    const c = content.trim();
    if (!c) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BASE_URL}/rag/fact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantHeaders(tenant) },
        body: JSON.stringify({
          content: c,
          importance,
          fact_type: factType,
          tags: tags.length > 0 ? tags : undefined,
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "Failed to add fact");
        throw new Error(msg);
      }

      setSuccess(true);
      setTimeout(() => {
        onAdded();
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err.message || "Failed to add fact");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 " />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-md mx-4 bg-[#0f0f1c] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Success overlay */}
            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-[#0f0f1c]/90"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Check className="h-10 w-10 text-emerald-400" />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-slate-200">Add to Brain</h3>
              <button
                onClick={onClose}
                className="text-slate-600 hover:text-slate-300 p-1 rounded-lg hover:bg-white/[0.04] transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-4">
              {/* Content */}
              <div>
                <label className="text-[10px] text-slate-500 font-medium mb-1 block">Content</label>
                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter a fact, piece of knowledge, or observation..."
                  rows={3}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/30 resize-none transition-colors"
                />
              </div>

              {/* Importance */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-slate-500 font-medium">Importance</label>
                  <span className={`text-[10px] font-medium ${importanceColor(importance)}`}>
                    {importanceLabel(importance)} ({Math.round(importance * 100)}%)
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={importance}
                  onChange={(e) => setImportance(parseFloat(e.target.value))}
                  className="w-full h-1.5 appearance-none bg-white/[0.06] rounded-full outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
                />
              </div>

              {/* Type */}
              <div>
                <label className="text-[10px] text-slate-500 font-medium mb-1.5 block">Type</label>
                <div className="flex items-center gap-1">
                  {FACT_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setFactType(t)}
                      className={`px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-all capitalize ${
                        factType === t
                          ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
                          : "border-white/[0.06] text-slate-600 hover:text-slate-400 hover:border-white/[0.1]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-[10px] text-slate-500 font-medium mb-1.5 block">Tags</label>
                <div className="flex items-center flex-wrap gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-xl px-2.5 py-2 min-h-[36px] focus-within:border-violet-500/30 transition-colors">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 border border-violet-500/20 rounded-lg text-[10px] text-violet-300"
                    >
                      {t}
                      <button
                        onClick={() => removeTag(t)}
                        className="text-violet-400 hover:text-white transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={addTag}
                    placeholder={tags.length === 0 ? "Add tags..." : ""}
                    className="flex-1 min-w-[60px] bg-transparent text-[10px] text-slate-300 placeholder:text-slate-700 focus:outline-none"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                onClick={submit}
                disabled={loading || !content.trim() || success}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 text-white text-xs font-medium rounded-xl transition-all active:scale-[0.98]"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add to Brain
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
