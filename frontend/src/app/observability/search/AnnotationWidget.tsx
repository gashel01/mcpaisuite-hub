'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, ThumbsUp, ThumbsDown, Minus, X, Check, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/api-url';


// ── Types ─────────────────────────────────────────────────────────────────────

interface Annotation {
  rating?: number;
  feedback?: 'good' | 'bad' | 'neutral';
  note?: string;
  tags?: string[];
}

interface AnnotationWidgetProps {
  taskId: string;
  onUpdate?: () => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AnnotationWidget({ taskId, onUpdate }: AnnotationWidgetProps) {
  const API = getApiUrl();
  const [annotation, setAnnotation] = useState<Annotation>({});
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loading, setLoading] = useState(true);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch existing annotation ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function fetchAnnotation() {
      try {
        const res = await fetch(`${API}/traces/${taskId}/annotations`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAnnotation({
              rating: data.rating,
              feedback: data.feedback,
              note: data.note || '',
              tags: data.tags || [],
            });
          }
        }
      } catch {
        // No existing annotation, start fresh
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAnnotation();
    return () => { cancelled = true; };
  }, [taskId]);

  // ── Fetch tag suggestions ─────────────────────────────────────────────────

  useEffect(() => {
    async function fetchTags() {
      try {
        const res = await fetch(`${API}/traces/tags`);
        if (res.ok) {
          const data = await res.json();
          setTagSuggestions(Array.isArray(data) ? data : data.tags || []);
        }
      } catch {
        // No suggestions available
      }
    }
    fetchTags();
  }, []);

  // ── Auto-save with debounce ───────────────────────────────────────────────

  const saveAnnotation = useCallback(
    async (data: Annotation) => {
      setSaveState('saving');
      try {
        const res = await fetch(`${API}/traces/${taskId}/annotate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveState('saved');
        onUpdate?.();
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = setTimeout(() => setSaveState('idle'), 2000);
      } catch {
        setSaveState('idle');
      }
    },
    [taskId, onUpdate]
  );

  const debouncedSave = useCallback(
    (data: Annotation) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => saveAnnotation(data), 500);
    },
    [saveAnnotation]
  );

  // ── Update helpers (trigger auto-save) ────────────────────────────────────

  function updateAnnotation(partial: Partial<Annotation>) {
    const updated = { ...annotation, ...partial };
    setAnnotation(updated);
    debouncedSave(updated);
  }

  function setRating(value: number) {
    const newRating = annotation.rating === value ? undefined : value;
    updateAnnotation({ rating: newRating });
  }

  function setFeedback(value: 'good' | 'bad' | 'neutral') {
    const newFeedback = annotation.feedback === value ? undefined : value;
    updateAnnotation({ feedback: newFeedback });
  }

  function addTag(tag: string) {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || annotation.tags?.includes(trimmed)) return;
    updateAnnotation({ tags: [...(annotation.tags || []), trimmed] });
    setTagInput('');
    setShowSuggestions(false);
  }

  function removeTag(tag: string) {
    updateAnnotation({ tags: (annotation.tags || []).filter((t) => t !== tag) });
  }

  // ── Filter suggestions ────────────────────────────────────────────────────

  const filteredSuggestions = tagSuggestions.filter(
    (s) =>
      s.toLowerCase().includes(tagInput.toLowerCase()) &&
      !annotation.tags?.includes(s)
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="h-4 w-4 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 bg-[#0c0c14] rounded-xl border border-white/[0.06]">
      {/* Header + save indicator */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">Annotation</span>
        <AnimatePresence mode="wait">
          {saveState === 'saving' && (
            <motion.span
              key="saving"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1 text-[9px] text-[#8b8ba8]"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Saving...
            </motion.span>
          )}
          {saveState === 'saved' && (
            <motion.span
              key="saved"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1 text-[9px] text-emerald-400"
            >
              <Check className="h-2.5 w-2.5" />
              Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Star rating */}
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => setRating(star)}
            className="p-0.5 transition-transform hover:scale-110 active:scale-95"
            aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
          >
            <Star
              className={`h-4 w-4 transition-colors ${
                (annotation.rating || 0) >= star
                  ? 'text-amber-400 fill-amber-400'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            />
          </button>
        ))}
        {annotation.rating && (
          <span className="text-[9px] text-[#8b8ba8] ml-1">{annotation.rating}/5</span>
        )}
      </div>

      {/* Feedback buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setFeedback('good')}
          className={`flex items-center gap-1 px-2.5 py-1 text-[9px] font-medium rounded-lg border transition-all ${
            annotation.feedback === 'good'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-white/[0.02] border-white/[0.06] text-[#8b8ba8] hover:border-emerald-500/20 hover:text-emerald-400'
          }`}
          aria-label="Good feedback"
          aria-pressed={annotation.feedback === 'good'}
        >
          <ThumbsUp className="h-3 w-3" />
          Good
        </button>
        <button
          onClick={() => setFeedback('bad')}
          className={`flex items-center gap-1 px-2.5 py-1 text-[9px] font-medium rounded-lg border transition-all ${
            annotation.feedback === 'bad'
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              : 'bg-white/[0.02] border-white/[0.06] text-[#8b8ba8] hover:border-rose-500/20 hover:text-rose-400'
          }`}
          aria-label="Bad feedback"
          aria-pressed={annotation.feedback === 'bad'}
        >
          <ThumbsDown className="h-3 w-3" />
          Bad
        </button>
        <button
          onClick={() => setFeedback('neutral')}
          className={`flex items-center gap-1 px-2.5 py-1 text-[9px] font-medium rounded-lg border transition-all ${
            annotation.feedback === 'neutral'
              ? 'bg-slate-500/15 border-slate-500/30 text-slate-300'
              : 'bg-white/[0.02] border-white/[0.06] text-[#8b8ba8] hover:border-slate-500/20 hover:text-slate-400'
          }`}
          aria-label="Neutral feedback"
          aria-pressed={annotation.feedback === 'neutral'}
        >
          <Minus className="h-3 w-3" />
          Neutral
        </button>
      </div>

      {/* Note field */}
      <textarea
        value={annotation.note || ''}
        onChange={(e) => setAnnotation({ ...annotation, note: e.target.value })}
        onBlur={() => debouncedSave(annotation)}
        placeholder="Add a note about this trace..."
        rows={2}
        className="w-full text-[10px] text-slate-200 placeholder:text-slate-600 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-2 resize-y focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 transition-all"
        aria-label="Annotation note"
      />

      {/* Tags */}
      <div className="space-y-1.5">
        {/* Existing tags */}
        {annotation.tags && annotation.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {annotation.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[9px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-full"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="ml-0.5 text-violet-400 hover:text-violet-200 transition-colors"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Tag input with autocomplete */}
        <div className="relative">
          <input
            ref={tagInputRef}
            type="text"
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              setShowSuggestions(e.target.value.length > 0);
            }}
            onFocus={() => {
              if (tagInput.length > 0) setShowSuggestions(true);
            }}
            onBlur={() => {
              // Delay hiding so clicks on suggestions register
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            placeholder="Add tag..."
            className="w-full text-[9px] text-slate-300 placeholder:text-slate-600 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-violet-500/40 transition-all"
            aria-label="Add tag"
          />

          {/* Autocomplete dropdown */}
          <AnimatePresence>
            {showSuggestions && filteredSuggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute z-10 top-full mt-1 w-full bg-[#14142a] border border-white/[0.08] rounded-lg shadow-xl overflow-hidden"
              >
                {filteredSuggestions.slice(0, 6).map((suggestion) => (
                  <button
                    key={suggestion}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(suggestion);
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-[9px] text-slate-300 hover:bg-violet-500/10 hover:text-violet-300 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
