"use client";

import { useState, useEffect } from "react";
import { KeyRound, AlertTriangle, Check, Plus, Search, EyeOff, Eye, Copy, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { SectionHeader } from "./_ui";

interface EnvVar { key: string; secret: boolean; preview: string; updated_at?: number }

export default function EnvPanel() {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState("");
  const [form, setForm] = useState({ key: "", value: "", secret: true });
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    try { const d = await apiFetch<{ vars?: EnvVar[] }>("/env"); setVars(d.vars || []); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const reveal = async (key: string) => {
    if (revealed[key] !== undefined) { setRevealed(r => { const n = { ...r }; delete n[key]; return n; }); return; }
    try { const d = await apiFetch<{ value?: string }>(`/env/${encodeURIComponent(key)}`); setRevealed(r2 => ({ ...r2, [key]: d.value ?? "" })); } catch {}
  };
  const copy = (text: string, key: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };

  const save = async () => {
    const key = form.key.trim();
    if (!key) { setErr("Key is required"); return; }
    setSaving(true); setErr("");
    try {
      await apiFetch("/env", { method: "POST", body: { key, value: form.value, secret: form.secret } });
      setForm({ key: "", value: "", secret: true }); setEditing(null); load();
    } catch (e: any) {
      setErr(e instanceof ApiError ? ((e.body as any)?.detail || `Error ${e.status}`) : String(e?.message || e));
    }
    setSaving(false);
  };
  const startEdit = async (v: EnvVar) => {
    let val = "";
    try { val = (await apiFetch<{ value?: string }>(`/env/${encodeURIComponent(v.key)}`)).value ?? ""; } catch {}
    setForm({ key: v.key, value: val, secret: v.secret }); setEditing(v.key); setErr("");
  };
  const remove = async (key: string) => {
    try { await apiFetch(`/env/${encodeURIComponent(key)}`, { method: "DELETE" }); } catch {}
    load();
  };

  const filtered = vars.filter(v => !q.trim() || v.key.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <SectionHeader icon={KeyRound} color="text-lime-400" title="Environment Variables" desc="Secrets & config available to agents, tools and MCP servers as process env vars" />

      {/* Clarity note: how this differs from the Security Vault */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 mb-3 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-lime-400/80 shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-500 leading-relaxed">
          These are injected into the process environment (<code className="text-slate-400">os.environ</code>) and are readable by <span className="text-slate-300">everything</span> — tools, MCP servers, litellm. Use them for general config (API base URLs, feature flags) and integration tokens that tools expect as env vars.
          <br />
          For credentials that should stay <span className="text-slate-300">isolated to sandboxed code, scoped per tenant, and audited</span>, use the <Link href="/security?panel=dlp" className="text-amber-300 hover:text-amber-200 underline decoration-amber-400/30 underline-offset-2 font-medium">Security → Secret Detection → Vault</Link> instead — those are never put on <code className="text-slate-400">os.environ</code>.
        </p>
      </div>

      {/* Add / edit form */}
      <div className="rounded-xl border border-lime-500/15 bg-lime-500/[0.03] p-3 mb-4 space-y-2.5">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{editing ? `Edit ${editing}` : "New variable"}</div>
        <div className="flex gap-2">
          <input value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") }))} disabled={!!editing}
            placeholder="GITHUB_TOKEN" className="w-2/5 !py-2 !px-3 !text-[12px] font-mono disabled:opacity-50" />
          <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} type={form.secret ? "password" : "text"}
            placeholder="value" className="flex-1 !py-2 !px-3 !text-[12px] font-mono" />
        </div>
        <div className="flex items-center justify-between">
          <button onClick={() => setForm(f => ({ ...f, secret: !f.secret }))} className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-200">
            <span className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center ${form.secret ? "bg-lime-500/80 border-lime-500" : "border-white/[0.15]"}`}>{form.secret && <Check className="h-2.5 w-2.5 text-black" />}</span>
            Secret (masked)
          </button>
          <div className="flex items-center gap-2">
            {err && <span className="text-[10px] text-red-400">{err}</span>}
            {editing && <button onClick={() => { setEditing(null); setForm({ key: "", value: "", secret: true }); }} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>}
            <button onClick={save} disabled={saving || !form.key.trim()} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-medium text-black bg-lime-500/90 hover:bg-lime-400 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all">
              {saving ? <Spinner className="h-3 w-3" /> : editing ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {editing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      {vars.length > 4 && (
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter variables…" className="w-full !pl-8 !py-1.5 !text-[11px]" />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-slate-800/40 animate-pulse" />)}</div>
      ) : vars.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-white/[0.06] bg-white/[0.01]">
          <KeyRound className="h-8 w-8 text-slate-700 mx-auto mb-2" />
          <p className="text-[12px] text-slate-400">No environment variables yet</p>
          <p className="text-[10px] text-slate-600 mt-1">Add keys like <code className="text-slate-400">GITHUB_TOKEN</code> or <code className="text-slate-400">SLACK_BOT_TOKEN</code> — tools and MCP servers read them at runtime.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(v => {
            const shown = revealed[v.key] !== undefined;
            return (
              <div key={v.key} className="group flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 hover:border-white/[0.1] transition-all">
                <span className="text-[11px] font-mono font-medium text-slate-200 w-2/5 truncate">{v.key}</span>
                <span className="flex-1 text-[11px] font-mono text-slate-500 truncate">
                  {v.secret && !shown ? <span className="tracking-widest">••••••••••</span> : (shown ? revealed[v.key] : v.preview)}
                </span>
                {v.secret && <span className="text-[7px] text-lime-400/80 bg-lime-500/10 border border-lime-500/15 px-1.5 py-0.5 rounded-full shrink-0">secret</span>}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {v.secret && <button onClick={() => reveal(v.key)} className="p-1 text-slate-500 hover:text-slate-200" data-tooltip={shown ? "Hide" : "Reveal"}>{shown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}</button>}
                  <button onClick={() => copy(shown ? revealed[v.key] : v.preview, v.key)} className="p-1 text-slate-500 hover:text-slate-200" data-tooltip="Copy">{copied === v.key ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}</button>
                  <button onClick={() => startEdit(v)} className="p-1 text-slate-500 hover:text-violet-300" data-tooltip="Edit"><Settings className="h-3 w-3" /></button>
                  <button onClick={() => remove(v.key)} className="p-1 text-slate-500 hover:text-red-400" data-tooltip="Delete"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
