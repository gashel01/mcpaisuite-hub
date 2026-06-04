"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Check, Trash, Pencil, Loader2, KeyRound, Cpu, Plug, CircleCheck, CircleX } from "lucide-react";
import { getApiUrl } from "@/lib/api-url";
import { useTenant, tenantHeaders } from "@/context/tenant";
import type { Connection } from "./connection-picker";

const BASE = getApiUrl();

export const PROVIDERS: { id: string; label: string; placeholder: string; needsKey: boolean; needsUrl?: boolean }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "claude-opus-4-8", needsKey: true },
  { id: "openai", label: "OpenAI", placeholder: "gpt-4o-mini", needsKey: true },
  { id: "groq", label: "Groq", placeholder: "llama-3.1-8b-instant", needsKey: true },
  { id: "gemini", label: "Gemini", placeholder: "gemini-2.0-flash", needsKey: true },
  { id: "cerebras", label: "Cerebras", placeholder: "llama-3.3-70b", needsKey: true },
  { id: "ollama", label: "Ollama (local)", placeholder: "mistral", needsKey: false, needsUrl: true },
  { id: "openai_compatible", label: "OpenAI-compatible", placeholder: "model-name", needsKey: true, needsUrl: true },
];

const emptyForm = { id: "", name: "", provider: "anthropic", model: "", api_key: "", base_url: "" };

/**
 * Reusable LLM-connections management surface: lists saved connections, lets the
 * user activate / add / edit / delete them. Self-contained (own data loading) so
 * it can be dropped into both the ConnectionPicker modal and the Settings page.
 * `onChanged` fires after any mutation so an outer picker can refresh its dropdown.
 */
export default function ConnectionsManager({ onChanged }: { onChanged?: () => void }) {
  const { tenant } = useTenant();
  const th = tenantHeaders(tenant);
  const [conns, setConns] = useState<Connection[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; detail: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/llm/connections`, { headers: th });
      const d = await r.json();
      setConns(d.connections || []);
    } catch { /* ignore */ }
  }, [th]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const notify = useCallback(() => { load(); onChanged?.(); }, [load, onChanged]);

  const activate = useCallback(async (id: string) => {
    setConns(cs => cs.map(c => ({ ...c, is_default: c.id === id })));
    try { await fetch(`${BASE}/llm/connections/${id}/default`, { method: "POST", headers: th }); } catch {}
    notify();
  }, [th, notify]);

  const remove = useCallback(async (id: string) => {
    try { await fetch(`${BASE}/llm/connections/${id}`, { method: "DELETE", headers: th }); } catch {}
    if (editingId === id) { setEditingId(null); setForm({ ...emptyForm }); }
    notify();
  }, [th, notify, editingId]);

  const testActive = useCallback(async () => {
    setTesting(true); setTestRes(null);
    try {
      // No overrides → backend tests the currently-active llm_config (the active connection)
      const r = await fetch(`${BASE}/test-connection`, { method: "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify({ service: "llm" }) });
      const d = await r.json();
      setTestRes({ ok: !!d.ok, detail: String(d.detail || "") });
    } catch (e: any) { setTestRes({ ok: false, detail: String(e?.message || e) }); }
    finally { setTesting(false); }
  }, [th]);

  const startEdit = (c: Connection) => {
    setForm({ id: c.id, name: c.name, provider: c.provider, model: c.model, api_key: "", base_url: c.base_url || "" });
    setEditingId(c.id); setErr("");
  };

  const save = useCallback(async () => {
    setSaving(true); setErr("");
    const body: any = { name: form.name, provider: form.provider, model: form.model, base_url: form.base_url };
    if (form.api_key) body.api_key = form.api_key;
    try {
      const url = editingId ? `${BASE}/llm/connections/${editingId}` : `${BASE}/llm/connections`;
      const r = await fetch(url, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...th }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); setErr(e.detail || `Error ${r.status}`); }
      else { setForm({ ...emptyForm }); setEditingId(null); notify(); }
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setSaving(false); }
  }, [form, editingId, th, notify]);

  const prov = PROVIDERS.find(p => p.id === form.provider) || PROVIDERS[0];

  return (
    <div className="space-y-4">
      {/* Existing list */}
      {conns.length > 0 && (
        <div className="space-y-1.5">
          {conns.map(c => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              {c.is_default ? <span className="text-[8px] font-semibold text-violet-300 bg-violet-500/12 border border-violet-500/20 px-1.5 py-0.5 rounded-full shrink-0">Active</span> : <button onClick={() => activate(c.id)} className="text-[8px] text-slate-500 hover:text-violet-300 border border-white/[0.06] px-1.5 py-0.5 rounded-full shrink-0">Activate</button>}
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

      {/* Test the active connection (hits the live llm_config) */}
      {conns.length > 0 && (
        <div className="flex items-center gap-3">
          <button onClick={testActive} disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.03] border border-white/[0.07] text-slate-300 hover:bg-white/[0.06] disabled:opacity-50 transition-all">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
            {testing ? "Testing…" : "Test active model"}
          </button>
          {testRes && (
            <span className={`flex items-center gap-1 text-[11px] ${testRes.ok ? "text-emerald-400" : "text-red-400"}`}>
              {testRes.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
              {testRes.detail.slice(0, 70)}
            </span>
          )}
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

      {conns.length === 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Cpu className="h-3 w-3 text-violet-400" /> No saved connections yet — add one above to switch models without re-entering keys.</p>
      )}
    </div>
  );
}
