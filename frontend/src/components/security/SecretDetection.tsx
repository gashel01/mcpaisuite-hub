"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Eye, Key, GitBranch, CreditCard, Mail, Phone, Lock, FileKey,
  KeyRound, Database, Globe, Hash, Server, Fingerprint, ChevronDown,
} from "lucide-react";
import type { SecurityPosture, SecurityAuditEvent } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

interface SecretDetectionProps {
  posture: SecurityPosture | null;
  auditEvents: SecurityAuditEvent[];
}

// ── DLP Pattern definitions ─────────────────────────────────────────────────

const DLP_PATTERNS = [
  { name: "AWS Keys", description: "AWS access key IDs and secrets", icon: Key },
  { name: "API Tokens", description: "Generic API keys and tokens", icon: Key },
  { name: "GitHub Tokens", description: "GitHub PATs and OAuth tokens", icon: GitBranch },
  { name: "Credit Cards", description: "Card numbers (PCI-DSS)", icon: CreditCard },
  { name: "Email Addresses", description: "PII email detection", icon: Mail },
  { name: "Phone Numbers", description: "International phone formats", icon: Phone },
  { name: "Passwords", description: "Hardcoded password strings", icon: Lock },
  { name: "Private Keys", description: "RSA/EC/SSH private keys", icon: FileKey },
  { name: "Connection Strings", description: "Database URIs with creds", icon: Database },
  { name: "JWT Tokens", description: "JSON Web Token detection", icon: Hash },
  { name: "OAuth Secrets", description: "OAuth client secrets", icon: Fingerprint },
  { name: "Webhook URLs", description: "Slack/Discord webhook URLs", icon: Globe },
  { name: "SSL Certificates", description: "Private cert material", icon: Server },
  { name: "Encryption Keys", description: "AES/symmetric key material", icon: KeyRound },
];

// ── Component ───────────────────────────────────────────────────────────────

export default function SecretDetection({ posture, auditEvents }: SecretDetectionProps) {
  const [showDetections, setShowDetections] = useState(true);

  const dlpEvents = auditEvents.filter(
    (e) => e.type.includes("secret") || e.type.includes("dlp")
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Eye className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-200">Secret Detection & DLP</h2>
        <span className="ml-auto text-[10px] text-slate-500">
          {posture?.dlp?.patterns_count ?? 14} patterns active
        </span>
      </div>

      {/* DLP Patterns Grid */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {DLP_PATTERNS.map((pattern, i) => {
          const Icon = pattern.icon;
          return (
            <motion.div
              key={pattern.name}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.02 * i }}
              className="flex items-center gap-2 p-2 rounded-lg border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
            >
              <Icon className="h-3 w-3 text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium text-slate-300 truncate">{pattern.name}</p>
                <p className="text-[9px] text-slate-600 truncate">{pattern.description}</p>
              </div>
              <span className="text-[8px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                Active
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Vault Section */}
      {posture?.vault && posture.vault.secret_count > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-300">
              {posture.vault.secret_count} secrets managed
            </span>
          </div>
        </div>
      )}

      {/* Recent DLP Detections */}
      {dlpEvents.length > 0 && (
        <div>
          <button
            onClick={() => setShowDetections(!showDetections)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors mb-2"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showDetections ? "" : "-rotate-90"}`} />
            Recent Detections ({dlpEvents.length})
          </button>
          {showDetections && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {dlpEvents.slice(-10).reverse().map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-center gap-2 p-2 rounded-lg border border-white/[0.04] bg-white/[0.01] text-[10px]"
                >
                  <Eye className="h-3 w-3 text-amber-400 shrink-0" />
                  <span className="text-slate-400 shrink-0">
                    {new Date(evt.ts * 1000).toLocaleTimeString()}
                  </span>
                  <span className="text-slate-300 truncate flex-1">{evt.detail}</span>
                  <span className="text-[9px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                    detected
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
