"use client";

import { useState } from "react";
import { BASE_URL } from "./constants";

// Inline approve / deny / request-revision / edit-output controls shown under a paused
// human-gate node in the run output. Posts the human's decision to the gate endpoint.
export default function HumanGateActions({ taskId, nodeId, tenant, currentOutput, hasFeedback }: { taskId: string; nodeId: string; tenant: string; currentOutput?: string; hasFeedback?: boolean }) {
  const [editText, setEditText] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const send = (action: string, modifiedOutput?: string) => {
    const body: any = { action };
    if (modifiedOutput) body.modified_output = modifiedOutput;
    fetch(`${BASE_URL}/tasks/${taskId}/human-gate/${nodeId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(tenant ? { "x-tenant-id": tenant } : {}) },
      body: JSON.stringify(body),
    }).catch(() => {});
    setSubmitted(true);
  };

  if (submitted) return null;

  return (
    <div className="mt-2 ml-6 space-y-2">
      {currentOutput && (
        <div className="px-2.5 py-1.5 bg-slate-800/30 border border-white/[0.06] rounded-lg max-h-32 overflow-y-auto">
          <div className="text-[9px] text-slate-500 mb-1">Output from previous agent:</div>
          <pre className="text-[10px] text-slate-400 whitespace-pre-wrap font-mono">{currentOutput}</pre>
        </div>
      )}
      {showEdit && (
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          placeholder={hasFeedback ? "Write feedback for the agent to revise..." : "Edit the output that will be passed to the next agent..."}
          className="w-full px-2.5 py-1.5 bg-slate-800/50 border border-white/[0.08] rounded-lg text-[11px] text-slate-300 placeholder:text-slate-600 resize-none focus:outline-none focus:border-violet-500/30"
          rows={3}
          autoFocus
        />
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => send("approve", editText.trim() || undefined)} className="px-3 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-md text-[10px] font-medium transition-all">
          {showEdit && editText.trim() ? "Continue with edit" : "Approve"}
        </button>
        {hasFeedback && (
          <button onClick={() => showEdit ? send("feedback", editText.trim() || "Please revise.") : setShowEdit(true)} className="px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-300 rounded-md text-[10px] font-medium transition-all">
            {showEdit && editText.trim() ? "Send feedback" : "Request revision"}
          </button>
        )}
        <button onClick={() => send("deny")} className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-300 rounded-md text-[10px] font-medium transition-all">
          Deny
        </button>
        {!showEdit && (
          <button onClick={() => setShowEdit(true)} className="px-3 py-1 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] text-slate-400 rounded-md text-[10px] font-medium transition-all">
            Edit output
          </button>
        )}
      </div>
    </div>
  );
}
