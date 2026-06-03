"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu, ChevronDown, Plus, Check, Trash, Pencil, X, Loader2, KeyRound,
} from "lucide-react";
import { getApiUrl } from "@/lib/api-url";
import { useTenant, tenantHeaders } from "@/context/tenant";

const BASE = getApiUrl();

export interface Connection {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url?: string;
  has_api_key: boolean;
  is_default: boolean;
  created_at?: number;
}

const PROVIDERS: { id: string; label: string; placeholder: string; needsKey: boolean; needsUrl?: boolean }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "claude-opus-4-8", needsKey: true },
  { id: "openai", label: "OpenAI", placeholder: "gpt-4o-mini", needsKey: true },
  { id: "groq", label: "Groq", placeholder: "llama-3.1-8b-instant", needsKey: true },
  { id: "gemini", label: "Gemini", placeholder: "gemini-2.0-flash", needsKey: true },
  { id: "cerebras", label: "Cerebras", placeholder: "llama-3.3-70b", needsKey: true },
  { id: "ollama", label: "Ollama (local)", placeholder: "mistral", needsKey: false, needsUrl: true },
  { id: "openai_compatible", label: "OpenAI-compatible", placeholder: "model-name", needsKey: true, needsUrl: true },
];

const emptyForm = { id: "", name: "", provider: "anthropic", model: "", api_key: "", base_url: "" };

export default function ConnectionPicker({ compact }: { compact?: boolean }) {
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/llm/connections`, { headers: th });
      const d = await r.json();
      setConns(d.connections || []);
    } catch { /* ignore */ }
  }, [th]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const active = conns.find(c => c.is_default) || conns[0];

  const activate = useCallback(async (id: string) => {
    setConns(cs => cs.map(c => ({ ...c, is_default: c.id === id })));
    setOpen(false);
    try { await fetch(`${BASE}/llm/connections/${id}/default`, { method: "POST", headers: th }); } catch {}
    load();
  }, [th, load]);

  const remove = useCallback(async (id: string) => {
    try { await fetch(`${BASE}/llm/connections/${id}`, { method: "DELETE", headers: th }); } catch {}
    load();
  }, [th, load]);

  const startAdd = () => { setForm({ ...emptyForm }); setEditingId(null); setErr(""); setManaging(true); };
  const startEdit = (c: Connection) => {
    setForm({ id: c.id, name: c.name, provider: c.provider, model: c.model, api_key: "", base_url: c.base_url || "" });
    setEditingId(c.id); setErr(""); setManaging(true);
  };

  const save = useCallback(async () => {
    setSaving(true); setErr("");
    const body: any = { name: form.name, provider: form.provider, model: form.model, base_url: form.base_url };
    if (form.api_key) body.api_key = form.api_key;
    try {
      const url = editingId ? `${BASE}/llm/connections/${editingId}` : `${BASE}/llm/connections`;
      const r = await fetch(url, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); setErr(e.detail || `Error ${r.status}`); }
      else { setForm({ ...emptyForm }); setEditingId(null); load(); if (conns.length === 0) setManaging(false); }
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setSaving(false); }
  }, [form, editingId, th, load, conns.length]);

  const prov = PROVIDERS.find(p => p.id === form.provider) || PROVIDERS[0];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 transition-all ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}
        data-tooltip="Active model — click to switch">
        <Cpu className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <span className={`font-medium truncate ${compact ? "text-[11px] max-w-[110px]" : "text-xs max-w-[160px]"}`}>{active ? active.name : "Default"}</span>
        <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 animate-scale-in p-1">
          <div className="px-2.5 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Model connection</div>
          {conns.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-500">No connections yet.</p>
          ) : conns.map(c => (
            <button key={c.id} onClick={() => activate(c.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all ${c.is_default ? "bg-violet-500/12" : "hover:bg-white/[0.04]"}`}>
              <span className="h-4 w-4 shrink-0 flex items-center justify-center">{c.is_default ? <Check className="h-3.5 w-3.5 text-violet-400" /> : null}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-slate-200 truncate">{c.name}</div>
                <div className="text-[9px] text-slate-500 truncate">{c.provider} · {c.model}</div>
              </div>
            </button>
          ))}
          <div className="h-px bg-white/[0.06] my-1" />
          <button onClick={() => { setOpen(false); startAdd(); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-violet-300 hover:bg-violet-500/10 transition-all">
            <Plus className="h-3.5 w-3.5" /> Add connection
          </button>
          {conns.length > 0 && (
            <button onClick={() => { setOpen(false); setManaging(true); setEditingId(null); setForm({ ...emptyForm }); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-slate-400 hover:bg-white/[0.04] transition-all">
              <Pencil className="h-3.5 w-3.5" /> Manage connections
            </button>
          )}
        </div>
      )}

      {/* Manage modal */}
      {managing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setManaging(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121c] shadow-2xl shadow-black/50 animate-scale-in flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-violet-400" /><h3 className="text-sm font-semibold text-slate-200">LLM connections</h3></div>
              <button onClick={() => setManaging(false)}><X className="h-4 w-4 text-slate-500 hover:text-slate-300" /></button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {/* Existing list */}
              {conns.length > 0 && (
                <div className="space-y-1.5">
                  {conns.map(c => (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      {c.is_default ? <span className="text-[8px] font-semibold text-violet-300 bg-violet-500/12 border border-violet-500/20 px-1.5 py-0.5 rounded-full">Active</span> : <button onClick={() => activate(c.id)} className="text-[8px] text-slate-500 hover:text-violet-300 border border-white/[0.06] px-1.5 py-0.5 rounded-full">Activate</button>}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-slate-200 truncate">{c.name}</div>
                        <div className="text-[9px] text-slate-500 truncate">{c.provider} · {c.model} {c.has_api_key ? "· 🔑" : ""}</div>
                      </div>
                      <button onClick={() => startEdit(c)} className="text-slate-500 hover:text-slate-200"><Pencil className="h-3 w-3" /></button>
                      <button onClick={() => remove(c.id)} className="text-slate-500 hover:text-red-400"><Trash className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add / edit form */}
              <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.03] p-3 space-y-2.5">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{editingId ? "Edit connection" : "New connection"}</div>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Name (e.g. Opus, Groq fast)" className="w-full !py-2 !px-3 !text-[12px]" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} className="!py-2 !px-2.5 !text-[12px]">
                    {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder={prov.placeholder} className="!py-2 !px-3 !text-[12px]" />
                </div>
                {prov.needsKey && (
                  <div className="relative">
                    <KeyRound className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
                    <input value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} type="password" placeholder={editingId ? "API key (leave blank to keep)" : "API key"} className="w-full !pl-8 !py-2 !text-[12px]" />
                  </div>
                )}
                {prov.needsUrl && (
                  <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="Base URL (e.g. http://localhost:11434)" className="w-full !py-2 !px-3 !text-[12px]" />
                )}
                {err && <p className="text-[10px] text-red-400">{err}</p>}
                <div className="flex gap-2">
                  <button onClick={save} disabled={saving || !form.model.trim()} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg transition-all">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {editingId ? "Save" : "Add"}
                  </button>
                  {editingId && <button onClick={() => { setEditingId(null); setForm({ ...emptyForm }); }} className="px-3 py-2 text-[12px] text-slate-400 hover:text-slate-200 rounded-lg">Cancel</button>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
