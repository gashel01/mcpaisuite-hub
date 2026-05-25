'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Eye,
  Save,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  History,
  GitCompare,
  Check,
  FileText,
  Zap,
} from 'lucide-react';
import { DiffView } from './DiffView';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8007';

interface ConstitutionStudioProps {
  namespace: string;
}

interface Version {
  id: string;
  date: string;
  note: string;
  rules_preview: string;
  rules: string;
}

interface PreviewData {
  rendered: string;
  token_estimate: number;
  sections: Array<{ name: string; start: number; end: number }>;
}

interface DiffData {
  title_a: string;
  title_b: string;
  lines: Array<{ type: 'add' | 'remove' | 'same'; line: string }>;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

export function ConstitutionStudio({ namespace }: ConstitutionStudioProps) {
  const [mode, setMode] = useState<'editor' | 'preview'>('editor');
  const [rules, setRules] = useState('');
  const [savedRules, setSavedRules] = useState('');
  const [testGoal, setTestGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Preview
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Versions
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Diff
  const [diff, setDiff] = useState<DiffData | null>(null);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch current constitution
  const fetchConstitution = useCallback(async () => {
    try {
      const res = await fetch(`${API}/constitution?namespace=${namespace}`);
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || '');
        setSavedRules(data.rules || '');
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  // Fetch versions
  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/constitution/versions?namespace=${namespace}`);
      if (res.ok) {
        setVersions(await res.json());
      }
    } catch {
      // silent
    }
  }, [namespace]);

  useEffect(() => {
    fetchConstitution();
  }, [fetchConstitution]);

  useEffect(() => {
    if (versionsOpen) fetchVersions();
  }, [versionsOpen, fetchVersions]);

  // Save
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/constitution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, rules }),
      });
      if (res.ok) {
        setSavedRules(rules);
        setSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaved(false), 2500);
        if (versionsOpen) fetchVersions();
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  // Revert
  const handleRevert = () => {
    setRules(savedRules);
  };

  // Preview
  const fetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`${API}/constitution/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, rules, test_goal: testGoal }),
      });
      if (res.ok) {
        setPreview(await res.json());
      }
    } catch {
      // silent
    } finally {
      setPreviewLoading(false);
    }
  };

  // Rollback
  const handleRollback = async (versionId: string) => {
    try {
      const res = await fetch(`${API}/constitution/rollback/${versionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace }),
      });
      if (res.ok) {
        await fetchConstitution();
        fetchVersions();
      }
    } catch {
      // silent
    }
  };

  // Compare
  const handleCompare = async (versionId: string) => {
    try {
      const res = await fetch(
        `${API}/constitution/diff?a=${versionId}&b=current&namespace=${namespace}`
      );
      if (res.ok) {
        setDiff(await res.json());
      }
    } catch {
      // silent
    }
  };

  // Load version into editor
  const loadVersion = (version: Version) => {
    setRules(version.rules);
    setMode('editor');
  };

  const isDirty = rules !== savedRules;
  const charCount = rules.length;
  const tokenEstimate = estimateTokens(rules);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <BookOpen size={18} className="text-violet-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">Constitution Studio</h2>
        </div>
        <button
          onClick={() => {
            if (mode === 'editor') {
              fetchPreview();
              setMode('preview');
            } else {
              setMode('editor');
            }
          }}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            mode === 'preview'
              ? 'bg-violet-500/20 text-violet-300'
              : 'bg-white/5 text-[#8b8ba8] hover:text-white hover:bg-white/10'
          }`}
        >
          <Eye size={14} />
          Preview
        </button>
      </div>

      {/* Diff View */}
      <AnimatePresence>
        {diff && (
          <DiffView
            title_a={diff.title_a}
            title_b={diff.title_b}
            lines={diff.lines}
            onClose={() => setDiff(null)}
          />
        )}
      </AnimatePresence>

      {/* Editor Mode */}
      {mode === 'editor' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          {/* Textarea */}
          <div className="relative">
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Write your constitution rules here...&#10;&#10;Example:&#10;- Always prefer the cheapest tool that can accomplish the goal&#10;- Never call external APIs without user confirmation&#10;- Limit task loops to 5 iterations maximum"
              className="w-full h-64 p-4 rounded-xl bg-[#08080f] border border-white/5 focus:border-violet-500/30 focus:ring-1 focus:ring-violet-500/20 text-sm text-white font-mono resize-y transition-colors outline-none placeholder:text-[#8b8ba8]/40"
              spellCheck={false}
            />
            {isDirty && (
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-amber-400" />
            )}
          </div>

          {/* Stats bar */}
          <div className="flex items-center justify-between text-xs text-[#8b8ba8]">
            <div className="flex items-center gap-4">
              <span>{charCount.toLocaleString()} chars</span>
              <span className="flex items-center gap-1">
                <Zap size={10} className="text-violet-400" />
                ~{tokenEstimate.toLocaleString()} tokens
              </span>
            </div>
            {isDirty && (
              <span className="text-amber-400 text-xs">Unsaved changes</span>
            )}
          </div>

          {/* Test goal input */}
          <div className="relative">
            <input
              type="text"
              value={testGoal}
              onChange={(e) => setTestGoal(e.target.value)}
              placeholder="Test goal: enter a goal to preview tool selection..."
              className="w-full px-4 py-2.5 rounded-lg bg-[#14142a] border border-white/5 focus:border-violet-500/30 text-sm text-white outline-none transition-colors placeholder:text-[#8b8ba8]/50"
            />
            <FileText
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8b8ba8]/40"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {saved ? (
                <>
                  <Check size={14} />
                  Saved
                </>
              ) : (
                <>
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save'}
                </>
              )}
            </button>
            <button
              onClick={handleRevert}
              disabled={!isDirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-[#8b8ba8] hover:text-white text-sm transition-colors"
            >
              <RotateCcw size={14} />
              Revert
            </button>
          </div>
        </motion.div>
      )}

      {/* Preview Mode */}
      {mode === 'preview' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          {previewLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
            </div>
          ) : preview ? (
            <>
              {/* Token badge */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/10 text-violet-300 text-sm font-medium">
                  <Zap size={12} />
                  {preview.token_estimate.toLocaleString()} tokens
                </span>
              </div>

              {/* Rendered preview */}
              <div className="rounded-xl bg-[#08080f] border border-white/5 p-4 max-h-[400px] overflow-y-auto">
                <pre className="text-sm text-white/90 font-mono whitespace-pre-wrap leading-relaxed">
                  {preview.rendered.split('\n').map((line, idx) => {
                    const isConstitution = line.includes('[CONSTITUTION]');
                    const isMemory = line.includes('[MEMORY CONTEXT]');
                    const isRag = line.includes('[RAG CONTEXT]');
                    const highlight = isConstitution
                      ? 'text-violet-300 font-bold'
                      : isMemory
                      ? 'text-emerald-300 font-bold'
                      : isRag
                      ? 'text-amber-300 font-bold'
                      : '';
                    return (
                      <span key={idx} className={highlight}>
                        {line}
                        {'\n'}
                      </span>
                    );
                  })}
                </pre>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-[#8b8ba8] text-sm">
              No preview available. Save rules first.
            </div>
          )}
        </motion.div>
      )}

      {/* Version History */}
      <div className="border-t border-white/5 pt-3">
        <button
          onClick={() => setVersionsOpen(!versionsOpen)}
          className="flex items-center gap-2 text-sm text-[#8b8ba8] hover:text-white transition-colors w-full"
        >
          {versionsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={14} />
          Version History
          {versions.length > 0 && (
            <span className="text-xs text-[#8b8ba8]/60 ml-1">
              ({versions.length})
            </span>
          )}
        </button>

        <AnimatePresence>
          {versionsOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-1.5 max-h-[250px] overflow-y-auto">
                {versions.length === 0 ? (
                  <p className="text-xs text-[#8b8ba8] py-4 text-center">
                    No versions yet. Save to create the first version.
                  </p>
                ) : (
                  versions.map((v) => (
                    <div
                      key={v.id}
                      className="group p-3 rounded-lg bg-[#14142a]/60 border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#8b8ba8]">
                          {new Date(v.date).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleCompare(v.id)}
                            className="p-1 rounded hover:bg-white/10 text-[#8b8ba8] hover:text-violet-300 transition-colors"
                            title="Compare with current"
                          >
                            <GitCompare size={12} />
                          </button>
                          <button
                            onClick={() => handleRollback(v.id)}
                            className="p-1 rounded hover:bg-white/10 text-[#8b8ba8] hover:text-amber-300 transition-colors"
                            title="Rollback to this version"
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      </div>
                      {v.note && (
                        <p className="text-xs text-violet-300/70 mb-1">{v.note}</p>
                      )}
                      <p
                        onClick={() => loadVersion(v)}
                        className="text-xs text-[#8b8ba8]/70 font-mono truncate cursor-pointer hover:text-white/70 transition-colors"
                        title="Click to load into editor"
                      >
                        {v.rules_preview}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
