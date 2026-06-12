"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, Code2, ChevronRight, ToggleLeft, ToggleRight } from "lucide-react";
import type { SecurityPosture as SecurityPostureData, SecurityAuditEvent } from "@/components/security/types";

export function CodePanel({ posture, events, onToggle, onTogglePattern }: { posture: SecurityPostureData | null; events: SecurityAuditEvent[]; onToggle: (key: string) => void; onTogglePattern: (name: string, disable: boolean) => void }) {
  const disabledPatterns = new Set<string>(posture?.validator?.disabled_patterns || []);
  const allPatterns = [
    { name: "os.system()", severity: "critical", why: "Executes shell commands with no sandboxing — allows arbitrary code execution on the host" },
    { name: "eval()", severity: "critical", why: "Evaluates arbitrary Python expressions — can execute injected malicious code" },
    { name: "exec()", severity: "critical", why: "Executes arbitrary Python code blocks — same risks as eval but for statements" },
    { name: "subprocess shell=True", severity: "high", why: "Runs shell commands via subprocess with shell expansion — vulnerable to command injection" },
    { name: "__import__()", severity: "high", why: "Dynamic module import — can load arbitrary modules to bypass restrictions" },
    { name: "pickle.loads()", severity: "high", why: "Deserializes Python objects — untrusted pickle data can execute arbitrary code" },
    { name: "shutil.rmtree()", severity: "medium", why: "Recursively deletes entire directory trees — accidental data loss risk" },
    { name: "ctypes", severity: "medium", why: "Foreign function interface — can call native C code and bypass Python safety" },
    { name: "socket.socket()", severity: "medium", why: "Creates raw network sockets — can open unauthorized network connections" },
  ];
  const patterns = allPatterns.filter(p => !disabledPatterns.has(p.name));
  const codeEvents = events.filter(e => e.source === "validator" || e.source === "sandbox").slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${posture?.validator?.reject_dangerous ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-red-500/30 bg-red-500/[0.05]"}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${posture?.validator?.reject_dangerous ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
              {posture?.validator?.reject_dangerous ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <ShieldAlert className="h-4 w-4 text-red-400" />}
            </div>
            <div className="flex-1">
              <span className="text-sm font-semibold text-white">Reject Dangerous</span>
              <p className="text-xs text-slate-400 mt-0.5">{posture?.validator?.reject_dangerous ? "Dangerous code is blocked before execution" : "Warning only — dangerous code can still run"}</p>
            </div>
            <button onClick={() => onToggle("reject_dangerous")} className="p-1 hover:bg-white/[0.05] rounded-lg transition-colors">
              {posture?.validator?.reject_dangerous ? <ToggleRight className="h-7 w-7 text-emerald-400" /> : <ToggleLeft className="h-7 w-7 text-red-400" />}
            </button>
          </div>
        </div>
        <div className={`p-4 rounded-xl border-2 transition-all ${posture?.validator?.auto_fix ? "border-cyan-500/30 bg-cyan-500/[0.05]" : "border-white/[0.08] bg-white/[0.02]"}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${posture?.validator?.auto_fix ? "bg-cyan-500/15" : "bg-white/[0.05]"}`}>
              <Code2 className={`h-4 w-4 ${posture?.validator?.auto_fix ? "text-cyan-400" : "text-slate-500"}`} />
            </div>
            <div className="flex-1">
              <span className="text-sm font-semibold text-white">Auto-Fix</span>
              <p className="text-xs text-slate-400 mt-0.5">{posture?.validator?.auto_fix ? "Missing imports and issues fixed automatically" : "No auto-correction applied"}</p>
            </div>
            <button onClick={() => onToggle("auto_fix")} className="p-1 hover:bg-white/[0.05] rounded-lg transition-colors">
              {posture?.validator?.auto_fix ? <ToggleRight className="h-7 w-7 text-cyan-400" /> : <ToggleLeft className="h-7 w-7 text-slate-600" />}
            </button>
          </div>
        </div>
      </div>

      <div>
        <span className="text-xs text-slate-500 font-medium">Blocked Patterns ({patterns.length}/{allPatterns.length} active)</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {allPatterns.map(p => {
            const disabled = disabledPatterns.has(p.name);
            return (
              <button key={p.name} onClick={() => onTogglePattern(p.name, !disabled)} data-tooltip={p.why}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-left group touch-target ${disabled ? "bg-white/[0.01] border-white/[0.03] opacity-40" : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"}`}>
                <div className={`h-2 w-2 rounded-full shrink-0 ${disabled ? "bg-slate-600" : p.severity === "critical" ? "bg-red-400" : p.severity === "high" ? "bg-amber-400" : "bg-blue-400"}`} />
                <span className={`text-xs font-mono truncate flex-1 ${disabled ? "text-slate-600 line-through" : "text-slate-300"}`}>{p.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${disabled ? "bg-white/[0.02] text-slate-700" : p.severity === "critical" ? "bg-red-500/10 text-red-400" : p.severity === "high" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}>{disabled ? "off" : p.severity}</span>
              </button>
            );
          })}
        </div>
      </div>

      {codeEvents.length > 0 && (
        <div>
          <span className="text-xs text-slate-500 font-medium">Recent Validations ({codeEvents.length})</span>
          <div className="mt-2 space-y-1">
            {codeEvents.map((e, i) => <ValidationEvent key={i} event={e} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationEvent({ event }: { event: SecurityAuditEvent }) {
  const [open, setOpen] = useState(false);
  const isFailed = /reject|block|fail/i.test(event.type) || /reject|block|fail/i.test(event.detail);
  const isFixed = /fix|auto/i.test(event.type) || /fix/i.test(event.detail);
  const dot = isFailed ? "bg-red-400" : isFixed ? "bg-amber-400" : "bg-emerald-400";
  const ts = event.ts ? new Date(event.ts * 1000) : null;

  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors">
        <div className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-xs text-slate-300 flex-1 truncate">{event.detail || event.type.replace(/_/g, " ")}</span>
        {ts && <span className="text-[10px] text-slate-700 shrink-0">{ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
        <ChevronRight className={`h-3 w-3 text-slate-700 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 ml-[18px] space-y-1 animate-fade-in border-t border-white/[0.03]">
          <div className="flex items-center gap-3 text-[10px] text-slate-600">
            <span>Type: <span className="text-slate-400">{event.type}</span></span>
            <span>Source: <span className="text-slate-400">{event.source}</span></span>
            {ts && <span>{ts.toLocaleDateString()} {ts.toLocaleTimeString()}</span>}
          </div>
          {event.detail && <p className="text-[11px] text-slate-400">{event.detail}</p>}
          {event.data && Object.keys(event.data).length > 0 && (
            <pre className="text-[10px] text-slate-600 font-mono whitespace-pre-wrap bg-black/20 rounded p-2 max-h-24 overflow-y-auto border border-white/[0.03]">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
