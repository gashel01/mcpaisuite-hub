"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollText, Edit3, Save, X, ChevronDown, Info, RefreshCw } from "lucide-react";
import type { SecurityPosture } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

// ── Types ───────────────────────────────────────────────────────────────────

interface ConstitutionEditorProps {
  posture: SecurityPosture | null;
  tenantHeaders: Record<string, string>;
  onRefresh: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ConstitutionEditor({ posture, tenantHeaders, onRefresh }: ConstitutionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showEffective, setShowEffective] = useState(false);

  const rules = posture?.constitution?.rules ?? "";
  const effective = posture?.constitution?.effective ?? "";
  const ruleCount = posture?.constitution?.rules_count ?? (rules ? rules.split("\n").filter(Boolean).length : 0);

  useEffect(() => {
    if (rules) setDraft(rules);
  }, [rules]);

  const handleEdit = () => {
    setDraft(rules);
    setEditing(true);
  };

  const handleCancel = () => {
    setDraft(rules);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${BASE}/constitution`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantHeaders },
        body: JSON.stringify({ rules: draft }),
      });
      setEditing(false);
      onRefresh();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-7 w-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
          <ScrollText className="h-3.5 w-3.5 text-purple-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-200">Constitution & Policies</h2>
        {ruleCount > 0 && (
          <span className="text-[9px] font-medium text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
            {ruleCount} rules defined
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!editing && (
            <button
              onClick={handleEdit}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg transition-all"
            >
              <Edit3 className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Editor / Viewer */}
      <AnimatePresence mode="wait">
        {editing ? (
          <motion.div
            key="editor"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full h-48 p-3 rounded-lg border border-violet-500/20 bg-[#0a0a18] text-[11px] text-slate-200 font-mono leading-relaxed resize-none focus:outline-none focus:border-violet-500/40 transition-colors"
              placeholder="Enter constitution rules (one per line)..."
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] border border-white/[0.06] rounded-lg transition-all"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
            </div>
          </motion.div>
        ) : rules ? (
          <motion.div
            key="viewer"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <div className="rounded-lg border border-white/[0.04] bg-[#0a0a18] p-3 max-h-48 overflow-y-auto">
              <pre className="text-[11px] text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">
                {rules.split("\n").map((line, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-slate-600 select-none w-5 text-right shrink-0">{i + 1}</span>
                    <span>{line}</span>
                  </div>
                ))}
              </pre>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-6 text-center"
          >
            <Info className="h-6 w-6 text-slate-700 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-400 mb-1">Using default constitution</p>
            <p className="text-[10px] text-slate-600 max-w-sm mx-auto">
              The agent operates under the built-in safety rules. Add custom rules to restrict behavior,
              enforce compliance, or define organizational policies.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Effective Rules (collapsible) */}
      {effective && (
        <div className="mt-4">
          <button
            onClick={() => setShowEffective(!showEffective)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showEffective ? "" : "-rotate-90"}`} />
            Effective rules (rendered)
          </button>
          <AnimatePresence>
            {showEffective && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 rounded-lg border border-white/[0.04] bg-[#080812] p-3 max-h-40 overflow-y-auto">
                  <pre className="text-[10px] text-slate-500 font-mono leading-relaxed whitespace-pre-wrap">
                    {effective}
                  </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
