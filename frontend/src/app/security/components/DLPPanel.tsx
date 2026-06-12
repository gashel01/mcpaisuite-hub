"use client";

import { useState } from "react";
import { KeyRound, AlertTriangle, Lock, Plus } from "lucide-react";
import Link from "next/link";
import type { SecurityPosture as SecurityPostureData, SecurityAuditEvent } from "@/components/security/types";

export function DLPPanel({ posture, events, onTogglePattern, vaultKeys, onAddSecret, onDeleteSecret }: { posture: SecurityPostureData | null; events: SecurityAuditEvent[]; onTogglePattern: (name: string, disable: boolean) => void; vaultKeys: string[]; onAddSecret: (key: string, value: string) => void; onDeleteSecret: (key: string) => void }) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const disabledPatterns = new Set<string>(posture?.dlp?.disabled_patterns || []);
  const allPatterns = [
    { name: "AWS Access Keys", icon: "🔑" }, { name: "API Tokens", icon: "🎫" }, { name: "GitHub Tokens", icon: "🐙" },
    { name: "Credit Cards", icon: "💳" }, { name: "Email Addresses", icon: "📧" }, { name: "Phone Numbers", icon: "📱" },
    { name: "Private Keys", icon: "🔐" }, { name: "JWT Tokens", icon: "🪙" }, { name: "Connection Strings", icon: "🔗" },
    { name: "OAuth Secrets", icon: "🛡" }, { name: "SSL Certificates", icon: "📜" }, { name: "Passwords", icon: "••" },
    { name: "Webhooks", icon: "🪝" }, { name: "Encryption Keys", icon: "🗝" },
  ];
  const activeCount = allPatterns.filter(p => !disabledPatterns.has(p.name)).length;
  const secretEvents = events.filter(e => /secret|dlp|redact/i.test(e.type) || /secret|dlp/i.test(e.source)).slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">Vault</span>
            <span className="text-xs text-amber-300">{vaultKeys.length} secrets</span>
          </div>
        </div>
        <div className="px-4 pb-3 space-y-2">
          {/* Clarity note: how the Vault differs from Settings → Environment Variables */}
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400/80 shrink-0 mt-0.5" />
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Vault secrets are <span className="text-slate-200">isolated to sandboxed code</span>, scoped per tenant, and audited — they are <span className="text-slate-200">never</span> exposed on <code className="text-slate-300">os.environ</code>. Use this for credentials the agents&apos; code should hold securely.
              <br />
              For general config or tokens that tools / MCP servers read as plain environment variables, use <Link href="/settings?tab=env" className="text-lime-300 hover:text-lime-200 underline decoration-lime-400/30 underline-offset-2 font-medium">Settings → Environment</Link> instead.
            </p>
          </div>
          {/* Add secret */}
          <div className="flex gap-2">
            <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key (e.g. OPENAI_API_KEY)"
              className="flex-1 px-3 py-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-slate-300 placeholder:text-slate-700 font-mono focus:outline-none focus:border-amber-500/30" />
            <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value" type="password"
              className="flex-1 px-3 py-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg text-xs text-slate-300 placeholder:text-slate-700 font-mono focus:outline-none focus:border-amber-500/30"
              onKeyDown={e => { if (e.key === "Enter" && newKey.trim() && newValue) { onAddSecret(newKey.trim(), newValue); setNewKey(""); setNewValue(""); }}} />
            <button onClick={() => { if (newKey.trim() && newValue) { onAddSecret(newKey.trim(), newValue); setNewKey(""); setNewValue(""); }}}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium transition-colors">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Secret list */}
          {vaultKeys.length === 0 && <p className="text-xs text-slate-600 py-2 text-center">No secrets stored. Add API keys, tokens, or credentials above.</p>}
          {vaultKeys.map(k => (
            <div key={k} className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/[0.03] border border-amber-500/10 group">
              <div className="flex items-center gap-2.5">
                <Lock className="h-3.5 w-3.5 text-amber-400/60" />
                <span className="text-xs text-slate-300 font-mono">{k}</span>
                <span className="text-[10px] text-slate-700">••••••••</span>
              </div>
              <button onClick={() => onDeleteSecret(k)} className="opacity-0 group-hover:opacity-100 text-xs text-slate-600 hover:text-red-400 transition-all">Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs text-slate-500 font-medium">DLP Patterns ({activeCount}/{allPatterns.length} active)</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {allPatterns.map(p => {
            const disabled = disabledPatterns.has(p.name);
            return (
              <button key={p.name} onClick={() => onTogglePattern(p.name, !disabled)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all text-left touch-target ${disabled ? "bg-white/[0.01] border-white/[0.03] opacity-40" : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"}`}>
                <span className="text-sm">{p.icon}</span>
                <span className={`text-xs flex-1 ${disabled ? "text-slate-600 line-through" : "text-slate-300"}`}>{p.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${disabled ? "bg-white/[0.02] text-slate-700" : "bg-emerald-500/10 text-emerald-400"}`}>{disabled ? "Off" : "Active"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {secretEvents.length > 0 && (
        <div>
          <span className="text-[11px] text-slate-600 font-medium">Recent Detections</span>
          <div className="mt-2 space-y-1">
            {secretEvents.map((e, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-amber-500/[0.04] border border-amber-500/10">
                <KeyRound className="h-3 w-3 text-amber-400" />
                <span className="text-xs text-slate-400 truncate">{e.detail || e.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
