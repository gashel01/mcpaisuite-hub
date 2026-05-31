"use client";
import { getApiUrl } from "@/lib/api-url";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal,
  ShieldAlert,
  CheckCircle,
  Plus,
  X,
} from "lucide-react";
import type { SecurityPosture } from "./types";


interface HostAccessControlProps {
  posture: SecurityPosture | null;
  tenantHeaders: Record<string, string>;
  onRefresh: () => void;
}

type TabKey = "approved" | "pending" | "blocked" | "safe";

const tabs: { key: TabKey; label: string }[] = [
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Pending" },
  { key: "blocked", label: "Blocked" },
  { key: "safe", label: "Safe" },
];

const blockedDescriptions: Record<string, string> = {
  "rm -rf": "Recursive force delete - can destroy entire file systems",
  "sudo": "Privilege escalation - unrestricted root access",
  "chmod 777": "Open permissions - removes all access control",
  "dd": "Disk destroyer - raw disk writes can corrupt data",
  "mkfs": "Format filesystem - erases all data on partition",
  "reboot": "System reboot - causes service downtime",
  "shutdown": "System shutdown - causes total service outage",
  "kill -9": "Force kill - bypasses graceful shutdown",
  "iptables": "Firewall manipulation - can lock out access",
  ":(){ :|:& };:": "Fork bomb - exhausts system resources",
};

const safeDescriptions: Record<string, string> = {
  "docker ps": "List running containers",
  "ls": "List directory contents",
  "cat": "Display file contents",
  "git": "Version control operations",
  "pip list": "List installed Python packages",
  "npm list": "List installed Node packages",
};

export default function HostAccessControl({ posture, tenantHeaders, onRefresh }: HostAccessControlProps) {
  const BASE = getApiUrl();
  const [activeTab, setActiveTab] = useState<TabKey>("approved");
  const [newPattern, setNewPattern] = useState("");

  const host = posture?.host;
  const approvedPatterns = host?.approved_patterns ?? [];
  const blockedPatterns = host?.blocked_patterns ?? [];
  const safePatterns = host?.safe_patterns ?? [];
  const pendingCount = host?.pending_count ?? 0;

  async function handleApprove(pattern: string) {
    await fetch(`${BASE}/host/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tenantHeaders },
      body: JSON.stringify({ pattern }),
    });
    onRefresh();
  }

  async function handleDeny(pattern: string) {
    await fetch(`${BASE}/host/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tenantHeaders },
      body: JSON.stringify({ pattern }),
    });
    onRefresh();
  }

  async function handleRevoke(pattern: string) {
    await fetch(`${BASE}/host/approve?pattern=${encodeURIComponent(pattern)}`, {
      method: "DELETE",
      headers: { ...tenantHeaders },
    });
    onRefresh();
  }

  async function handleAddPattern() {
    const p = newPattern.trim();
    if (!p) return;
    await fetch(`${BASE}/host/approve?pattern=${encodeURIComponent(p)}`, {
      method: "POST",
      headers: { ...tenantHeaders },
    });
    setNewPattern("");
    onRefresh();
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 md:p-5 space-y-4 ">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Terminal className="h-5 w-5 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-200">Host Access Control</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-900/60 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.key ? "text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {activeTab === tab.key && (
              <motion.div
                layoutId="host-tab-indicator"
                className="absolute inset-0 bg-violet-600/30 border border-violet-500/30 rounded-md"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">
              {tab.label}
              {tab.key === "pending" && pendingCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-[9px] text-white font-bold">
                  {pendingCount}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === "approved" && (
          <motion.div
            key="approved"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-2"
          >
            {approvedPatterns.map((p) => (
              <div
                key={p}
                className="flex items-center justify-between bg-slate-900/50 border border-slate-700/40 rounded-lg px-3 py-2"
              >
                <code className="text-xs text-violet-400 font-mono">{p}</code>
                <button
                  onClick={() => handleRevoke(p)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {approvedPatterns.length === 0 && (
              <p className="text-[11px] text-slate-600 py-2">No custom approved patterns</p>
            )}

            {/* Add pattern */}
            <div className="flex gap-2 pt-2 border-t border-slate-700/40">
              <input
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPattern()}
                placeholder="docker restart *"
                className="flex-1 bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50 font-mono"
              />
              <button
                onClick={handleAddPattern}
                className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}

        {activeTab === "pending" && (
          <motion.div
            key="pending"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-2"
          >
            {pendingCount === 0 && (
              <p className="text-[11px] text-slate-600 py-2">No pending requests</p>
            )}
            {/* Pending patterns would be fetched from the API; placeholder for dynamic content */}
            {pendingCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-amber-400">
                  {pendingCount} pattern{pendingCount > 1 ? "s" : ""} awaiting review
                </p>
                {/* In real usage, pending patterns come from a separate endpoint */}
                <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  <code className="text-xs text-amber-300 flex-1 font-mono">pending pattern</code>
                  <button
                    onClick={() => handleApprove("pending pattern")}
                    className="bg-green-600 hover:bg-green-500 text-white px-2.5 py-1 rounded text-xs font-medium"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDeny("pending pattern")}
                    className="bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded text-xs font-medium"
                  >
                    Deny
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "blocked" && (
          <motion.div
            key="blocked"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-1.5 max-h-64 overflow-y-auto"
          >
            {blockedPatterns.map((p) => (
              <div
                key={p}
                className="flex items-center gap-2 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2"
              >
                <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <code className="text-xs text-red-300 font-mono">{p}</code>
                  {blockedDescriptions[p] && (
                    <p className="text-[10px] text-slate-500 mt-0.5">{blockedDescriptions[p]}</p>
                  )}
                </div>
              </div>
            ))}
            {blockedPatterns.length === 0 && (
              <p className="text-[11px] text-slate-600 py-2">No blocked patterns configured</p>
            )}
          </motion.div>
        )}

        {activeTab === "safe" && (
          <motion.div
            key="safe"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-1.5 max-h-64 overflow-y-auto"
          >
            {safePatterns.map((p) => (
              <div
                key={p}
                className="flex items-center gap-2 bg-green-950/20 border border-green-900/30 rounded-lg px-3 py-2"
              >
                <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <code className="text-xs text-green-300 font-mono">{p}</code>
                  {safeDescriptions[p] && (
                    <p className="text-[10px] text-slate-500 mt-0.5">{safeDescriptions[p]}</p>
                  )}
                </div>
              </div>
            ))}
            {safePatterns.length === 0 && (
              <p className="text-[11px] text-slate-600 py-2">No safe patterns configured</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
