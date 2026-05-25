"use client";

import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import type { SecurityPosture, SecurityAuditEvent } from "./types";

interface CodeValidationProps {
  posture: SecurityPosture | null;
  auditEvents: SecurityAuditEvent[];
}

interface DangerousPattern {
  name: string;
  description: string;
  severity: "critical" | "high" | "medium";
}

const dangerousPatterns: DangerousPattern[] = [
  { name: "os.system", description: "Direct OS command execution", severity: "critical" },
  { name: "eval", description: "Arbitrary code evaluation", severity: "critical" },
  { name: "exec", description: "Dynamic code execution", severity: "critical" },
  { name: "__import__", description: "Dynamic module import bypass", severity: "high" },
  { name: "subprocess shell=True", description: "Shell injection vector", severity: "critical" },
  { name: "/etc/passwd", description: "System file access attempt", severity: "high" },
  { name: "shutil.rmtree", description: "Recursive directory deletion", severity: "high" },
  { name: "raw socket", description: "Low-level network access", severity: "high" },
  { name: "ctypes", description: "C library foreign function interface", severity: "medium" },
  { name: "pickle.loads", description: "Arbitrary object deserialization", severity: "high" },
  { name: "hex obfuscation", description: "Encoded payload hiding", severity: "medium" },
  { name: "chr() concatenation", description: "Character-based obfuscation", severity: "medium" },
  { name: "compile()+exec()", description: "Dynamic bytecode execution", severity: "critical" },
  { name: "base64 decode+exec", description: "Encoded execution bypass", severity: "high" },
];

const severityColors = {
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

function getVerdictColor(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("reject") || lower.includes("blocked") || lower.includes("denied"))
    return "bg-red-500/20 text-red-300";
  if (lower.includes("fix") || lower.includes("sanitiz"))
    return "bg-amber-500/20 text-amber-300";
  return "bg-green-500/20 text-green-300";
}

function getVerdictLabel(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("reject") || lower.includes("blocked") || lower.includes("denied"))
    return "Rejected";
  if (lower.includes("fix") || lower.includes("sanitiz"))
    return "Fixed";
  return "Passed";
}

export default function CodeValidation({ posture, auditEvents }: CodeValidationProps) {
  const validator = posture?.validator;
  const rejectDangerous = validator?.reject_dangerous ?? true;
  const autoFix = validator?.auto_fix ?? false;

  // Filter relevant events
  const validationEvents = auditEvents.filter(
    (e) =>
      e.source === "validator" ||
      e.type.includes("code") ||
      e.type.includes("validated") ||
      e.type.includes("validation")
  );

  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 md:p-5 space-y-4 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-200">Code Validation</h3>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`rounded-lg border px-3 py-2.5 ${
            rejectDangerous
              ? "border-green-500/30 bg-green-950/20"
              : "border-red-500/30 bg-red-950/20"
          }`}
        >
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
            Reject Dangerous
          </p>
          <p className={`text-sm font-semibold ${rejectDangerous ? "text-green-400" : "text-red-400"}`}>
            {rejectDangerous ? "Enabled" : "Disabled"}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 }}
          className={`rounded-lg border px-3 py-2.5 ${
            autoFix
              ? "border-green-500/30 bg-green-950/20"
              : "border-amber-500/30 bg-amber-950/20"
          }`}
        >
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
            Auto-fix
          </p>
          <p className={`text-sm font-semibold ${autoFix ? "text-green-400" : "text-amber-400"}`}>
            {autoFix ? "Enabled" : "Disabled"}
          </p>
        </motion.div>
      </div>

      {/* Dangerous patterns */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-400">
          Dangerous Patterns ({dangerousPatterns.length})
        </p>
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {dangerousPatterns.map((pattern, i) => (
            <motion.div
              key={pattern.name}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-2 bg-slate-900/50 border border-slate-700/30 rounded-lg px-3 py-1.5"
            >
              <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <code className="text-[11px] text-slate-200 font-mono">{pattern.name}</code>
                <p className="text-[10px] text-slate-500 truncate">{pattern.description}</p>
              </div>
              <span
                className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${severityColors[pattern.severity]}`}
              >
                {pattern.severity}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Recent validation events */}
      {validationEvents.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-700/40">
          <p className="text-xs font-medium text-slate-400">Recent Events</p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {validationEvents.slice(0, 20).map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-slate-900/40 border border-slate-700/30 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] text-slate-600 font-mono">
                    {new Date(event.ts * 1000).toLocaleTimeString()}
                  </span>
                  <span
                    className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${getVerdictColor(event.detail)}`}
                  >
                    {getVerdictLabel(event.detail)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">{event.detail}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {validationEvents.length === 0 && (
        <p className="text-[11px] text-slate-600 pt-2 border-t border-slate-700/40">
          No validation events recorded yet
        </p>
      )}
    </div>
  );
}
