"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Wrench, Search, Plug } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { Field, TextInput, SelectInput, SectionHeader, AdvancedDisclosure } from "./_ui";

export default function ToolsPanel() {
  const [tools, setTools] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connectForm, setConnectForm] = useState<{name: string; transport: string; command: string; url: string} | null>(null);
  const [lcForm, setLcForm] = useState<{module: string; className: string} | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [browseCat, setBrowseCat] = useState<"all" | "built-in" | "mcp" | "langchain">("all");

  const loadTools = async () => {
    setLoading(true);
    try { setTools(await apiFetch<any>("/tools")); } catch {}
    setLoading(false);
  };

  useEffect(() => { loadTools(); }, []);

  const connectMCP = async () => {
    if (!connectForm) return;
    setActionLoading(true);
    try {
      await apiFetch("/tools/mcp/connect", { method: "POST", body: connectForm });
      setConnectForm(null);
      loadTools();
    } catch (e) { alert(String(e)); }
    setActionLoading(false);
  };

  const disconnectMCP = async (name: string) => {
    try { await apiFetch(`/tools/mcp/${encodeURIComponent(name)}`, { method: "DELETE" }); loadTools(); } catch {}
  };

  const registerLC = async () => {
    if (!lcForm) return;
    setActionLoading(true);
    try {
      await apiFetch("/tools/langchain/register", { method: "POST", body: { module: lcForm.module, "class": lcForm.className } });
      setLcForm(null);
      loadTools();
    } catch (e) { alert(String(e)); }
    setActionLoading(false);
  };

  const unregisterLC = async (name: string) => {
    try { await apiFetch(`/tools/langchain/${encodeURIComponent(name)}`, { method: "DELETE" }); loadTools(); } catch {}
  };

  if (loading) return <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="h-16 rounded-xl bg-slate-800/40 animate-pulse" />)}</div>;

  return (
    <>
      <SectionHeader icon={Wrench} color="text-violet-400" title="Tool Library" desc="Built-in, MCP servers, and LangChain community tools" />

      {/* Stats — clickable to filter the browser below */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { count: tools?.built_in?.count || 0, label: "Built-in", color: "text-violet-400", cat: "built-in" as const, ring: "border-violet-500/40" },
          { count: tools?.mcp_external?.count || 0, label: "MCP External", color: "text-cyan-400", cat: "mcp" as const, ring: "border-cyan-500/40" },
          { count: tools?.langchain?.count || 0, label: "LangChain", color: "text-amber-400", cat: "langchain" as const, ring: "border-amber-500/40" },
        ].map(stat => (
          <button key={stat.label} onClick={() => setBrowseCat(browseCat === stat.cat ? "all" : stat.cat)}
            className={`rounded-xl border bg-white/[0.015] p-3 text-center hover:bg-white/[0.03] transition-all ${browseCat === stat.cat ? stat.ring + " bg-white/[0.03]" : "border-white/[0.06]"}`}>
            <p className={`text-lg font-bold ${stat.color}`}>{stat.count}</p>
            <p className="text-[10px] text-slate-500">{stat.label}</p>
          </button>
        ))}
      </div>

      {/* Browse all tools — searchable catalog of what agents can actually use */}
      {(() => {
        const all: { name: string; description: string; category: string }[] = [];
        (tools?.built_in?.tools || []).forEach((t: any) => all.push({ ...t, category: "built-in" }));
        (tools?.mcp_external?.tools || []).forEach((t: any) => all.push({ ...t, category: "mcp" }));
        (tools?.langchain?.tools || []).forEach((t: any) => all.push({ ...t, category: "langchain" }));
        const q = toolQuery.trim().toLowerCase();
        const filtered = all.filter(t => (browseCat === "all" || t.category === browseCat) &&
          (!q || t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q)));
        const badge = (c: string) => c === "mcp" ? "text-cyan-300 bg-cyan-500/12" : c === "langchain" ? "text-amber-300 bg-amber-500/12" : "text-violet-300 bg-violet-500/12";
        return (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-300">Browse tools</h3>
              <span className="text-[9px] text-slate-600">{filtered.length} of {all.length}{browseCat !== "all" ? ` · ${browseCat}` : ""}</span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-600" />
              <input value={toolQuery} onChange={e => setToolQuery(e.target.value)} placeholder="Search 100+ tools by name or what they do…" className="w-full !pl-8 !py-1.5 !text-[11px] !bg-[#08080f] !border-white/[0.06]" />
              {browseCat !== "all" && <button onClick={() => setBrowseCat("all")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 hover:text-slate-300">clear filter</button>}
            </div>
            <div className="max-h-[280px] overflow-y-auto space-y-1 pr-1">
              {filtered.length === 0 ? (
                <p className="text-[10px] text-slate-600 text-center py-4">No tools match “{toolQuery}”.</p>
              ) : filtered.map(t => (
                <div key={t.name} className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-white/[0.01] px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono text-slate-200 truncate">{t.name}</span>
                      <span className={`text-[7px] px-1 py-0.5 rounded shrink-0 ${badge(t.category)}`}>{t.category === "built-in" ? "native" : t.category}</span>
                    </div>
                    {t.description && <div className="text-[9px] text-slate-500 leading-snug line-clamp-2 mt-0.5">{t.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Installed — MCP servers & LangChain tools you've added, with one-click remove */}
      {(Object.keys(tools?.mcp_servers || {}).length > 0 || (tools?.langchain?.tools || []).length > 0) && (
        <div className="mb-4">
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className="text-xs font-semibold text-slate-300">Installed</h3>
            <span className="text-[9px] text-slate-600">servers &amp; tools you&apos;ve added — remove to disconnect</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(tools?.mcp_servers || {}).map(([name, info]: [string, any]) => (
              <div key={name} className="flex items-center gap-2.5 p-3 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03]">
                <div className="p-1.5 rounded-md bg-emerald-500/10 shrink-0"><Plug className="h-3.5 w-3.5 text-emerald-400" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-medium text-slate-200 truncate">{name}</span><span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 shrink-0">MCP</span></div>
                  <p className="text-[10px] text-slate-500">{info.tools} tools</p>
                </div>
                <button onClick={() => disconnectMCP(name)} className="shrink-0 px-2 py-1 text-[9px] font-medium rounded-md border text-red-400/80 bg-red-500/5 border-red-500/15 hover:bg-red-500/10 transition-all">Remove</button>
              </div>
            ))}
            {(tools?.langchain?.tools || []).map((t: any) => (
              <div key={t.name} className="flex items-center gap-2.5 p-3 rounded-lg border border-amber-500/15 bg-amber-500/[0.03]">
                <div className="p-1.5 rounded-md bg-amber-500/10 shrink-0"><Wrench className="h-3.5 w-3.5 text-amber-400" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-medium text-amber-200 font-mono truncate">{t.name}</span><span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 shrink-0">LC</span></div>
                  <p className="text-[10px] text-slate-500 truncate">{t.description}</p>
                </div>
                <button onClick={() => unregisterLC(t.name)} className="shrink-0 px-2 py-1 text-[9px] font-medium rounded-md border text-red-400/80 bg-red-500/5 border-red-500/15 hover:bg-red-500/10 transition-all">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add tools — the marketplace is the primary, one-click path */}
      <MarketplaceSection
        onInstalled={loadTools}
        installedMcp={new Set(Object.keys(tools?.mcp_servers || {}))}
        installedLc={(tools?.langchain?.tools || []).map((t: any) => String(t.name || "").toLowerCase())}
      />

      {/* Manual / advanced add — niche (custom command or Python module), collapsed by default */}
      <div className="mt-5">
        <AdvancedDisclosure label="Add a custom server or tool" hint="manual MCP connect · LangChain import by module path">
          {/* MCP Servers — connect a custom one + manage connected */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-300">MCP Servers</h3>
              <button onClick={() => setConnectForm({ name: "", transport: "stdio", command: "", url: "" })} className="text-[10px] text-violet-400 hover:text-violet-300 bg-violet-500/8 border border-violet-500/15 px-2.5 py-1 rounded-lg transition-all hover:scale-[1.02]">
                + Connect
              </button>
            </div>

            {connectForm && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3 space-y-2 animate-fade-in">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Server Name"><TextInput value={connectForm.name} onChange={v => setConnectForm({...connectForm, name: v})} placeholder="github" /></Field>
                  <Field label="Transport">
                    <SelectInput value={connectForm.transport} onChange={v => setConnectForm({...connectForm, transport: v})} options={[{value:"stdio",label:"Stdio (command)"},{value:"sse",label:"SSE (URL)"}]} />
                  </Field>
                </div>
                {connectForm.transport === "stdio" ? (
                  <Field label="Command"><TextInput value={connectForm.command} onChange={v => setConnectForm({...connectForm, command: v})} placeholder="npx @modelcontextprotocol/server-github" /></Field>
                ) : (
                  <Field label="URL"><TextInput value={connectForm.url} onChange={v => setConnectForm({...connectForm, url: v})} placeholder="http://localhost:3001/sse" /></Field>
                )}
                <div className="flex gap-2">
                  <button onClick={connectMCP} disabled={actionLoading || !connectForm.name} className="text-[10px] font-medium text-violet-400 bg-violet-500/8 border border-violet-500/15 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-violet-500/15 transition-all">
                    {actionLoading ? "Connecting..." : "Connect"}
                  </button>
                  <button onClick={() => setConnectForm(null)} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* LangChain Tools — import a custom one + manage imported */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-300">LangChain Tools</h3>
              <button onClick={() => setLcForm({ module: "", className: "" })} className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/8 border border-amber-500/15 px-2.5 py-1 rounded-lg transition-all hover:scale-[1.02]">
                + Import
              </button>
            </div>

            {lcForm && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3 space-y-2 animate-fade-in">
                <Field label="Module Path"><TextInput value={lcForm.module} onChange={v => setLcForm({...lcForm, module: v})} placeholder="langchain_community.tools.wikipedia.tool" /></Field>
                <Field label="Class Name"><TextInput value={lcForm.className} onChange={v => setLcForm({...lcForm, className: v})} placeholder="WikipediaQueryRun" /></Field>
                <div className="flex gap-2">
                  <button onClick={registerLC} disabled={actionLoading || !lcForm.module || !lcForm.className} className="text-[10px] font-medium text-amber-400 bg-amber-500/8 border border-amber-500/15 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-amber-500/15 transition-all">
                    {actionLoading ? "Importing..." : "Import"}
                  </button>
                  <button onClick={() => setLcForm(null)} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </AdvancedDisclosure>
      </div>

      <div className="mt-4">
        <button onClick={loadTools} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">Refresh tool list</button>
      </div>
    </>
  );
}

// ── Marketplace ─────────────────────────────────────────────────────────────
// Browse + install MCP servers / LangChain tools. Rendered inside ToolsPanel; installed state is
// passed down from ToolsPanel's authoritative /tools list so cards reflect reality.
function MarketplaceSection({ onInstalled, installedMcp, installedLc }: { onInstalled?: () => void; installedMcp?: Set<string>; installedLc?: string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [results, setResults] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [featured, setFeatured] = useState<any>(null);
  const [installState, setInstallState] = useState<Record<string, "installing" | "done" | "error" | "needs-token">>({});
  const [installError, setInstallError] = useState<Record<string, string>>({});
  const [envKeys, setEnvKeys] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ key: string; vars: string[]; inputs: Record<string, string> } | null>(null);

  const itemKey = (item: any) => `${item.type}-${item.name}`;
  const requiredEnv = (item: any): string[] => (item.type === "mcp" ? (item.env || []) : []);
  // Already connected/registered on the backend (passed down from ToolsPanel's authoritative tool
  // list) → the card shows "Connected" even without a session action, and stays in sync on remove.
  const isInstalled = (item: any) =>
    item.type === "mcp"
      ? !!installedMcp?.has(item.name)
      : (installedLc || []).some(n => n.includes(String(item.name).toLowerCase()));

  // Connect/register for real. If, after connecting, the item still needs an env var that isn't
  // set, mark it "needs-token" (installed but won't actually work) rather than a green "done".
  const doConnect = async (item: any, keys: Set<string>) => {
    const key = itemKey(item);
    setInstallState(s => ({ ...s, [key]: "installing" }));
    try {
      if (item.type === "mcp") {
        await apiFetch("/tools/mcp/connect", { method: "POST", body: { name: item.name, transport: item.transport || "stdio", command: item.command || "", url: "" } });
      } else {
        await apiFetch("/tools/langchain/register", { method: "POST", body: { module: item.module, "class": item.class_name } });
      }
      const missing = requiredEnv(item).some(e => !keys.has(e));
      setInstallState(s => ({ ...s, [key]: missing ? "needs-token" : "done" }));
      setInstallError(s => { const n = { ...s }; delete n[key]; return n; });
      onInstalled?.();
    } catch (e: any) {
      setInstallState(s => ({ ...s, [key]: "error" }));
      const msg = e instanceof ApiError ? ((e.body as any)?.detail || `HTTP ${e.status}`) : String(e?.message || e);
      setInstallError(s => ({ ...s, [key]: msg.slice(0, 240) }));
    }
  };

  // Click "Install": if the server needs env vars that aren't set yet, invite the user to enter
  // them right here first; otherwise connect straight away.
  const install = (item: any) => {
    const missing = requiredEnv(item).filter(e => !envKeys.has(e));
    if (missing.length > 0) {
      setPending({ key: itemKey(item), vars: missing, inputs: Object.fromEntries(missing.map(e => [e, ""])) });
      return;
    }
    doConnect(item, envKeys);
  };

  // Save the entered token(s) to Settings → Environment (so the spawned server reads them), then connect.
  const saveEnvAndInstall = async (item: any) => {
    if (!pending) return;
    const next = new Set(envKeys);
    for (const v of pending.vars) {
      const val = (pending.inputs[v] || "").trim();
      if (!val) continue;
      try {
        await apiFetch("/env", { method: "POST", body: { key: v, value: val, secret: true } });
        next.add(v);
      } catch {}
    }
    setEnvKeys(next);
    setPending(null);
    doConnect(item, next);
  };

  // Load featured + existing env-var keys on mount
  useEffect(() => {
    apiFetch<any>("/marketplace/featured").then(setFeatured).catch(() => {});
    apiFetch<any>("/marketplace/categories").then(d => setCategories(d.categories || [])).catch(() => {});
    apiFetch<any>("/env").then(d => setEnvKeys(new Set((d.vars || []).map((v: any) => v.key)))).catch(() => {});
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, category });
      const data = await apiFetch<any>(`/marketplace/search?${params}`);
      setResults(data.results || []);
    } catch {}
    setLoading(false);
  }, [query, category]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(search, 300);
    return () => clearTimeout(t);
  }, [query, category]); // eslint-disable-line

  const showResults = query || category !== "all";
  const items = showResults ? results : [
    ...(featured?.mcp_servers || []),
    ...(featured?.langchain_tools || []),
  ];

  return (
    <div className="mt-6">
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
        <SectionHeader icon={Search} color="text-cyan-400" title="Marketplace" desc="Browse and install MCP servers and LangChain tools" />

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search servers and tools..."
            className="w-full pl-8 pr-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 bg-white/[0.03] border border-white/[0.06] rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap gap-1 mb-3">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-2 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
                category === cat.id
                  ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300"
                  : "border-white/[0.04] text-slate-500 hover:text-slate-300"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {items.map((item: any, i: number) => (
            <motion.div
              key={`${item.name}-${item.type}`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex flex-col p-3 rounded-lg border border-white/[0.06] bg-white/[0.015] hover:border-white/[0.12] transition-all group"
            >
              <div className="flex items-start gap-2.5">
                <div className={`p-1.5 rounded-md shrink-0 ${item.type === "mcp" ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                  {item.type === "mcp" ? (
                    <Plug className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-200">{item.title || item.name}</span>
                    <span className={`text-[8px] px-1 py-0.5 rounded ${
                      item.type === "mcp" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                    }`}>
                      {item.type === "mcp" ? "MCP" : "LC"}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
                  {requiredEnv(item).length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <span className="text-[8px] text-slate-600">Requires:</span>
                      {requiredEnv(item).map((e: string) => (
                        <span key={e} className={`text-[8px] px-1 rounded ${envKeys.has(e) ? "text-emerald-400/80 bg-emerald-500/5" : "text-amber-400/70 bg-amber-500/5"}`}>{envKeys.has(e) ? `${e} ✓` : e}</span>
                      ))}
                    </div>
                  )}
                </div>
                {(() => {
                  const st = installState[itemKey(item)] || (isInstalled(item) ? "done" : undefined);
                  const base = "shrink-0 px-2 py-1 text-[9px] font-medium rounded-md border transition-all";
                  if (st === "done") return <span className={`${base} text-emerald-400 bg-emerald-500/5 border-emerald-500/15`}>Connected ✓</span>;
                  if (st === "needs-token") return <span title={`Installed, but needs ${requiredEnv(item).join(", ")} to work`} className={`${base} text-amber-400 bg-amber-500/5 border-amber-500/20`}>Needs {requiredEnv(item).filter(e => !envKeys.has(e))[0] || "config"}</span>;
                  if (st === "installing") return <span className={`${base} text-slate-400 bg-white/[0.03] border-white/[0.08] flex items-center gap-1`}><Spinner className="h-2.5 w-2.5" /> Installing…</span>;
                  return (
                    <button onClick={() => install(item)} className={`${base} ${st === "error" ? "text-amber-400 bg-amber-500/5 border-amber-500/20" : "text-cyan-400 bg-cyan-500/5 border-cyan-500/15 hover:bg-cyan-500/10"}`}>
                      {st === "error" ? "Failed — retry" : "Install"}
                    </button>
                  );
                })()}
              </div>

              {/* Inline token prompt — invite the user to set the required var(s) now */}
              {pending?.key === itemKey(item) && (
                <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] space-y-2 animate-fade-in">
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    <span className="text-slate-200 font-medium">{item.title || item.name}</span> needs {pending.vars.join(", ")} to work. Enter it now (saved to <span className="text-slate-300">Environment</span>), or install anyway and set it later.
                  </p>
                  {pending.vars.map(v => (
                    <input
                      key={v}
                      value={pending.inputs[v]}
                      onChange={e => setPending(p => p ? { ...p, inputs: { ...p.inputs, [v]: e.target.value } } : p)}
                      placeholder={v}
                      type="password"
                      className="w-full !py-1.5 !px-2.5 !text-[11px] font-mono !bg-[#08080f] !border-white/[0.06]"
                    />
                  ))}
                  <div className="flex gap-2">
                    <button onClick={() => saveEnvAndInstall(item)} disabled={pending.vars.every(v => !(pending.inputs[v] || "").trim())} className="text-[10px] font-medium text-cyan-400 bg-cyan-500/8 border border-cyan-500/15 px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-cyan-500/15 transition-all">Save &amp; install</button>
                    <button onClick={() => { setPending(null); doConnect(item, envKeys); }} className="text-[10px] text-amber-400/80 hover:text-amber-300 transition-colors">Install anyway</button>
                    <button onClick={() => setPending(null)} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors ml-auto">Cancel</button>
                  </div>
                </div>
              )}

              {/* Real failure reason (server's own stderr), surfaced from the backend */}
              {installState[itemKey(item)] === "error" && installError[itemKey(item)] && (
                <p className="mt-2 pt-2 border-t border-white/[0.06] text-[9.5px] text-red-400/90 leading-relaxed break-words font-mono">
                  {installError[itemKey(item)]}
                </p>
              )}
            </motion.div>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-4">
            <Spinner className="h-4 w-4 text-slate-500" />
          </div>
        )}

        {!loading && items.length === 0 && query && (
          <div className="text-center py-6 text-[10px] text-slate-500">
            No results for &quot;{query}&quot;
          </div>
        )}
      </motion.div>
    </div>
  );
}
