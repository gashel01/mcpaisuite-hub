"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Plus, X, AlertTriangle } from "lucide-react";
import type { SecurityPosture } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8007";

interface NetworkControlProps {
  posture: SecurityPosture | null;
  tenantHeaders: Record<string, string>;
  onRefresh: () => void;
}

export default function NetworkControl({ posture, tenantHeaders, onRefresh }: NetworkControlProps) {
  const [newDomain, setNewDomain] = useState("");
  const [toggling, setToggling] = useState(false);

  const egress = posture?.egress;
  const enabled = egress?.enabled ?? false;
  const domains = egress?.allowed_domains ?? [];
  const pendingCount = egress?.pending_count ?? 0;

  async function handleToggle() {
    setToggling(true);
    try {
      await fetch(`${BASE}/egress/toggle`, {
        method: "POST",
        headers: { ...tenantHeaders },
      });
      onRefresh();
    } finally {
      setToggling(false);
    }
  }

  async function handleAddDomain() {
    const d = newDomain.trim();
    if (!d) return;
    await fetch(`${BASE}/egress/allow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tenantHeaders },
      body: JSON.stringify({ domain: d }),
    });
    setNewDomain("");
    onRefresh();
  }

  async function handleRemoveDomain(domain: string) {
    await fetch(`${BASE}/egress/allow?domain=${encodeURIComponent(domain)}`, {
      method: "DELETE",
      headers: { ...tenantHeaders },
    });
    onRefresh();
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 md:p-5 space-y-4 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-200">Network Egress Control</h3>
      </div>

      {/* Toggle Switch */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-slate-300">Outbound Network</p>
          <p className={`text-[11px] ${enabled ? "text-amber-400" : "text-green-400"}`}>
            {enabled
              ? `Whitelist mode: ${domains.length} domains allowed`
              : "All outbound traffic is blocked"}
          </p>
        </div>

        <button
          onClick={handleToggle}
          disabled={toggling}
          className="relative h-7 w-14 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          style={{ backgroundColor: enabled ? "rgb(34 197 94 / 0.4)" : "rgb(71 85 105 / 0.6)" }}
        >
          <motion.div
            className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md"
            animate={{ left: enabled ? "1.75rem" : "0.125rem" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      {/* Domain whitelist */}
      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 overflow-hidden"
          >
            {/* Add domain */}
            <div className="flex gap-2">
              <input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                placeholder="api.example.com"
                className="flex-1 bg-slate-900/80 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
              />
              <button
                onClick={handleAddDomain}
                className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Domain list */}
            <div className="space-y-1">
              {domains.map((d) => (
                <motion.div
                  key={d}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  className="flex items-center justify-between bg-slate-900/50 border border-slate-700/40 rounded-lg px-3 py-1.5"
                >
                  <code className="text-xs text-green-400 font-mono">{d}</code>
                  <button
                    onClick={() => handleRemoveDomain(d)}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))}
              {domains.length === 0 && (
                <p className="text-[11px] text-slate-600">No domains whitelisted yet</p>
              )}
            </div>

            {/* Pending requests */}
            {pendingCount > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2 flex items-center gap-2"
              >
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">
                  {pendingCount} pending egress request{pendingCount > 1 ? "s" : ""} awaiting approval
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
