"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, ShieldAlert, CheckCircle, Eye, AlertTriangle, ChevronDown,
} from "lucide-react";
import type { SecurityAuditEvent } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

interface AuditStats {
  total: number;
  blocked: number;
  approved: number;
  secrets_detected: number;
}

interface SecurityAuditLogProps {
  events: SecurityAuditEvent[];
  stats: AuditStats;
}

type FilterType = "all" | "blocked" | "approved" | "secrets";

// ── Helpers ─────────────────────────────────────────────────────────────────

function getEventCategory(type: string): FilterType {
  if (type.includes("block") || type.includes("denied") || type.includes("reject")) return "blocked";
  if (type.includes("approved") || type.includes("granted") || type.includes("allow")) return "approved";
  if (type.includes("secret") || type.includes("dlp")) return "secrets";
  return "all";
}

function getBorderColor(type: string): string {
  const cat = getEventCategory(type);
  if (cat === "blocked") return "border-l-red-500";
  if (cat === "approved") return "border-l-emerald-500";
  if (cat === "secrets") return "border-l-amber-500";
  return "border-l-slate-600";
}

function getIcon(type: string) {
  const cat = getEventCategory(type);
  if (cat === "blocked") return <ShieldAlert className="h-3.5 w-3.5 text-red-400" />;
  if (cat === "approved") return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
  if (cat === "secrets") return <Eye className="h-3.5 w-3.5 text-amber-400" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-slate-400" />;
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SecurityAuditLog({ events, stats }: SecurityAuditLogProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = events.filter((e) => {
    if (filter === "all") return true;
    return getEventCategory(e.type) === filter;
  });

  const filters: { key: FilterType; label: string; color: string; count?: number }[] = [
    { key: "all", label: "All", color: "text-slate-300 bg-white/[0.04] border-white/[0.08]" },
    { key: "blocked", label: "Blocked", color: "text-red-400 bg-red-500/10 border-red-500/20", count: stats.blocked },
    { key: "approved", label: "Approved", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", count: stats.approved },
    { key: "secrets", label: "Secrets", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", count: stats.secrets_detected },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="h-7 w-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Shield className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-200">Security Events</h2>
        <div className="flex items-center gap-1.5 ml-auto">
          {stats.blocked > 0 && (
            <span className="text-[9px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full">
              {stats.blocked} blocked
            </span>
          )}
          {stats.approved > 0 && (
            <span className="text-[9px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
              {stats.approved} approved
            </span>
          )}
          {stats.secrets_detected > 0 && (
            <span className="text-[9px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
              {stats.secrets_detected} secrets
            </span>
          )}
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-1.5 mb-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-all ${
              filter === f.key
                ? f.color
                : "text-slate-500 bg-white/[0.02] border-white/[0.04] hover:text-slate-300"
            }`}
          >
            {f.label}
            {f.count !== undefined && f.count > 0 && ` (${f.count})`}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filtered.length > 0 ? (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {filtered.slice().reverse().map((evt, i) => (
            <motion.div
              key={evt.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.3) }}
              className={`border-l-2 ${getBorderColor(evt.type)} rounded-lg border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.025] transition-colors`}
            >
              <div
                className="flex items-center gap-2 p-2.5 cursor-pointer"
                onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
              >
                {getIcon(evt.type)}
                <span className="text-[9px] font-medium text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">
                  {evt.source}
                </span>
                <span className="text-[10px] font-medium text-slate-300 truncate">{evt.type}</span>
                <span className="text-[10px] text-slate-500 truncate flex-1">{evt.detail}</span>
                <span className="text-[9px] text-slate-600 shrink-0">{relativeTime(evt.ts)}</span>
                <ChevronDown className={`h-3 w-3 text-slate-600 shrink-0 transition-transform ${expandedId === evt.id ? "rotate-180" : ""}`} />
              </div>

              <AnimatePresence>
                {expandedId === evt.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-2.5 pt-0">
                      <pre className="text-[9px] text-slate-500 font-mono bg-[#080812] rounded-lg p-2 overflow-x-auto">
                        {JSON.stringify(evt.data, null, 2)}
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Shield className="h-8 w-8 text-slate-700 mx-auto mb-2" />
          <p className="text-xs font-medium text-slate-400">No security events yet</p>
          <p className="text-[10px] text-slate-600 mt-1">
            This is good — it means no actions were blocked or flagged.
          </p>
        </div>
      )}
    </motion.div>
  );
}
