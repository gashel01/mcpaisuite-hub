"use client";
import { apiFetch } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Settings, Save, Cpu, Brain, HardDrive, Shield, Database, Clock, Search,
  Check, ChevronRight, ChevronDown, Plug, CircleCheck, CircleX, Server, Wifi, WifiOff, Wrench, RefreshCw,
  KeyRound, Eye, EyeOff, Copy, Trash2, Plus,
  Sparkles, Undo2, AlertTriangle, Zap, Cloud, Monitor, X, ArrowRight, ArrowLeft, Rocket, Link2Off, Menu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
// PageHeader replaced by inline header for better mobile layout
import { useBreakpoint } from "@/hooks/useBreakpoint";
import ConnectionsManager from "@/components/connections-manager";
import Link from "next/link";
import { TestBtn, Field, Toggle, NumberInput, TextInput, SelectInput, SectionHeader, AdvancedDisclosure } from "./_ui";
import EnvPanel from "./EnvPanel";
import ToolsPanel from "./ToolsPanel";

import { DEFAULTS, PRESETS, TABS, TAB_FIELDS, HEALTH_SERVICES, pickDefined } from "./config";
import type { FullConfig, TabId } from "./config";
import { HealthBar, PresetSelector, SetupWizard, StickySaveBar } from "./panels";
import { SettingsTabs } from "./tabs";

export default function SettingsPage() {
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const [cfg, setCfg] = useState<FullConfig>(DEFAULTS);
  const [savedCfg, setSavedCfg] = useState<FullConfig>(DEFAULTS);
  const [tab, setTab] = useState<TabId>("llm");
  const [navOpen, setNavOpen] = useState(false);
  // Deep-link: ?tab=<id> opens a specific settings tab (e.g. from the Security Vault note)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p && TABS.some(t => t.id === p)) setTab(p as TabId);
  }, []);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ service: string; ok: boolean; detail: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [health, setHealth] = useState<Record<string, "ok" | "error" | "unknown">>({});
  const [prevTab, setPrevTab] = useState<TabId>("llm");
  const [animDir, setAnimDir] = useState<"left" | "right">("right");
  const contentRef = useRef<HTMLDivElement>(null);

  // Custom-backend override state (Settings → Backend): replaces the local backend.
  // Distinct from connect_hub (additive remote-kernel scopes in Observability).
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteTesting, setRemoteTesting] = useState(false);
  const [remoteTestResult, setRemoteTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem("kernelmcp_remote") || "{}");
      if (r.enabled && r.url) { setRemoteEnabled(true); setRemoteUrl(r.url); }
    } catch {}
  }, []);

  const saveRemote = () => {
    const url = remoteUrl.trim().replace(/\/$/, "");
    if (!url) return;
    localStorage.setItem("kernelmcp_remote", JSON.stringify({ enabled: true, url }));
    window.location.reload();
  };

  const clearRemote = () => {
    localStorage.removeItem("kernelmcp_remote");
    window.location.reload();
  };

  const testRemote = async () => {
    const url = remoteUrl.trim().replace(/\/$/, "");
    if (!url) return;
    setRemoteTesting(true);
    setRemoteTestResult(null);
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      setRemoteTestResult({ ok: r.ok, detail: data.status || `HTTP ${r.status}` });
    } catch (e) {
      setRemoteTestResult({ ok: false, detail: String(e).slice(0, 100) });
    }
    setRemoteTesting(false);
  };

  // Constitution state
  const [constitution, setConstitution] = useState("");
  const [constitutionSaved, setConstitutionSaved] = useState(false);
  const [savingConstitution, setSavingConstitution] = useState(false);

  // Servers state
  interface ServerData { name: string; connected: boolean; tools: number; tool_list?: string[] }
  const [servers, setServers] = useState<ServerData[]>([]);
  const [serverExpanded, setServerExpanded] = useState<Record<string, boolean>>({});
  const [serversLoading, setServersLoading] = useState(false);
  const [serversOpen, setServersOpen] = useState(false); // tool-detail panel under the HealthBar
  const totalTools = servers.reduce((s, srv) => s + srv.tools, 0);

  const SERVER_DESCRIPTIONS: Record<string, string> = {
    memorymcp: "Persistent fact storage with semantic recall, importance scoring, and tag-based filtering",
    planningmcp: "Task planning, LTP compiler, step graphs, ON_FAIL strategies, FOREACH loops",
    workspacemcp: "Sandboxed file system with tenant isolation, checkpoints, search, and move operations",
    sandboxmcp: "Docker code execution, web search (SearXNG), browser fetch (Playwright), host commands",
    schedulermcp: "Job scheduling: once, cron, interval, and watch (event-driven with conditions)",
    ragmcp: "Document ingestion, chunking, embedding (FastEmbed), and semantic search",
  };

  // ── Dirty tracking ────────────────────────────────────────────────────

  const dirtyFields = useMemo(() => {
    const fields: (keyof FullConfig)[] = [];
    for (const key of Object.keys(cfg) as (keyof FullConfig)[]) {
      if (cfg[key] !== savedCfg[key]) fields.push(key);
    }
    return fields;
  }, [cfg, savedCfg]);

  const dirtyTabs = useMemo(() => {
    const tabs: TabId[] = [];
    for (const [tabId, fields] of Object.entries(TAB_FIELDS)) {
      if (fields.some(f => dirtyFields.includes(f))) tabs.push(tabId as TabId);
    }
    return tabs;
  }, [dirtyFields]);

  // ── Health check ──────────────────────────────────────────────────────

  const checkHealth = useCallback(async () => {
    const results: Record<string, "ok" | "error" | "unknown"> = {};
    try {
      const promises = HEALTH_SERVICES.map(async svc => {
        try {
          const data = await apiFetch<any>("/test-connection", { method: "POST", body: { service: svc.id } });
          results[svc.id] = data.ok ? "ok" : "error";
        } catch { results[svc.id] = "unknown"; }
      });
      await Promise.all(promises);
    } catch { /* ignore */ }
    setHealth(results);
  }, []);

  // ── Tab animation ─────────────────────────────────────────────────────

  const switchTab = (newTab: TabId) => {
    const oldIdx = TABS.findIndex(t => t.id === tab);
    const newIdx = TABS.findIndex(t => t.id === newTab);
    setAnimDir(newIdx > oldIdx ? "right" : "left");
    setPrevTab(tab);
    setTab(newTab);
  };

  // ── Loaders ───────────────────────────────────────────────────────────

  const loadServers = async () => {
    setServersLoading(true);
    try {
      const data = await apiFetch<any>("/servers");
      const list: ServerData[] = Object.entries(data.servers || {}).map(([name, info]: [string, unknown]) => {
        const i = info as { connected: boolean; tools: number; tool_names?: string[] };
        return { name, connected: i.connected, tools: i.tools, tool_list: i.tool_names };
      });
      setServers(list.sort((a, b) => a.name.localeCompare(b.name)));
    } catch { /* ignore */ }
    setServersLoading(false);
  };

  const saveConstitutionHandler = async () => {
    setSavingConstitution(true);
    setConstitutionSaved(false);
    try {
      const c = await apiFetch<any>("/constitution", { method: "POST", body: { rules: constitution } });
      setConstitution(c.rules);
      setConstitutionSaved(true);
      setTimeout(() => setConstitutionSaved(false), 3000);
    } catch { /* ignore */ }
    setSavingConstitution(false);
  };

  const testConnection = async (service: string, params: Record<string, string> = {}) => {
    setTesting(service);
    setTestResult(null);
    try {
      const body: Record<string, string> = { service, ...params };
      if (service === "llm") {
        body.model = cfg.model; body.provider = cfg.provider;
        if (cfg.api_key) body.api_key = cfg.api_key;
        if (cfg.base_url) body.url = cfg.base_url;
      } else if (service === "redis") { body.url = cfg.memory_redis_url; }
      else if (service === "neo4j") {
        body.url = params.url || cfg.memory_neo4j_uri || cfg.rag_neo4j_uri;
        body.user = params.user || cfg.memory_neo4j_user || cfg.rag_neo4j_user;
        body.password = params.password || cfg.memory_neo4j_password || cfg.rag_neo4j_password;
      } else if (service === "qdrant") {
        body.url = cfg.rag_vectorstore_url;
        if (cfg.rag_vectorstore_api_key) body.api_key = cfg.rag_vectorstore_api_key;
      } else if (service === "pgvector" || service === "milvus") { body.url = cfg.rag_vectorstore_url; }
      const data = await apiFetch<any>("/test-connection", { method: "POST", body });
      setTestResult({ service, ok: data.ok, detail: data.detail });
    } catch (e) { setTestResult({ service, ok: false, detail: String(e) }); }
    setTesting(null);
  };

  useEffect(() => {
    apiFetch<any>("/settings").then(data => {
      const merged = { ...DEFAULTS, ...pickDefined(data) };
      setCfg(merged);
      setSavedCfg(merged);
      if (data.has_api_key) setHasApiKey(true);
      // Show wizard if config looks like defaults (first launch)
      if (!data.provider && !data.model && !data.has_api_key) setShowWizard(true);
    }).catch(() => {});
    apiFetch<any>("/constitution").then(c => setConstitution(c.rules || "")).catch(() => {});
    loadServers();
    checkHealth();
    // Poll health every 30s
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const update = <K extends keyof FullConfig>(key: K, val: FullConfig[K]) =>
    setCfg(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // The LLM (provider/model/api_key/base_url) is owned by saved connections —
      // activating one writes llm_config. Stripping these from the settings save
      // prevents stale cfg values here from clobbering the active connection.
      const payload: Record<string, unknown> = { ...cfg };
      delete payload.provider; delete payload.model; delete payload.api_key; delete payload.base_url;
      await apiFetch("/settings", { method: "POST", body: payload });
      setSavedCfg({ ...cfg });
      checkHealth();
    } catch (_e) { }
    setSaving(false);
  };

  const handleDiscard = () => setCfg({ ...savedCfg });

  const applyPreset = (values: Partial<FullConfig>) => setCfg(prev => ({ ...prev, ...values }));

  const handleWizardComplete = (wizCfg: Partial<FullConfig>) => {
    setCfg(prev => ({ ...prev, ...wizCfg }));
    setShowWizard(false);
  };

  const currentTabObj = TABS.find(t => t.id === tab);

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] overflow-hidden">
      {/* Setup Wizard */}
      {showWizard && <SetupWizard onComplete={handleWizardComplete} onSkip={() => setShowWizard(false)} />}

      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 shrink-0 border-b border-white/[0.04]">
        {/* Nav menu (mobile) */}
        <button
          onClick={() => {
            const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
            if (btn) btn.click();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <Settings className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight truncate">Settings</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Configure LLM, engine, storage & servers</p>
        </div>
        <PresetSelector onApply={applyPreset} />
      </div>

      {/* Health Overview */}
      <div className="px-3 sm:px-4 shrink-0">
        <HealthBar
          health={health}
          onServiceClick={(t) => { switchTab(t); setNavOpen(false); }}
          toolCount={totalTools}
          toolsOpen={serversOpen}
          onToggleTools={() => setServersOpen(o => !o)}
        />
        {/* Tool-detail panel — the per-server tools, surfaced from the status bar (replaces the
            redundant "Servers & MCP" tab). The bar already shows health; this adds the details. */}
        {serversOpen && (
          <div className="-mt-1 mb-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-slate-500">
                {servers.filter(s => s.connected).length}/{servers.length} servers connected &middot; {totalTools} tools available
              </span>
              <button onClick={loadServers} disabled={serversLoading} className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-white/[0.03] border border-white/[0.06] rounded-lg transition-all disabled:opacity-50">
                <Spinner icon={RefreshCw} spinning={serversLoading} className="h-3 w-3" /> Refresh
              </button>
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {servers.map(srv => {
                const isOpen = serverExpanded[srv.name] || false;
                return (
                  <div key={srv.name} className={`rounded-xl border overflow-hidden transition-all duration-200 ${srv.connected ? "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.1]" : "border-red-500/10 bg-red-500/[0.02]"}`}>
                    <button
                      onClick={() => setServerExpanded(prev => ({ ...prev, [srv.name]: !prev[srv.name] }))}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                      <Server className={`h-3.5 w-3.5 ${srv.connected ? "text-violet-400" : "text-slate-600"}`} />
                      <span className="font-medium text-[13px] text-slate-200">{srv.name}</span>
                      <div className="flex-1" />
                      <span className="text-[10px] text-slate-500 mr-2">{srv.tools} tools</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${srv.connected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15" : "bg-red-500/10 text-red-400 border border-red-500/15"}`}>
                        {srv.connected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                        {srv.connected ? "online" : "offline"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 border-t border-white/[0.04] animate-fade-in">
                        <p className="text-[11px] text-slate-500 mt-2.5 mb-2.5">{SERVER_DESCRIPTIONS[srv.name] || "MCP server"}</p>
                        {srv.tool_list && srv.tool_list.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {srv.tool_list.map(tool => (
                              <span key={tool} className="flex items-center gap-1 bg-violet-500/8 text-violet-400 text-[10px] px-2 py-0.5 rounded-md border border-violet-500/15 font-mono">
                                <Wrench className="h-2.5 w-2.5" />{tool}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-slate-600 italic">Tool list not available</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {servers.length === 0 && !serversLoading && (
                <p className="text-[11px] text-slate-600 text-center py-8">No servers found. Check that the backend is running.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile tab selector */}
      {isMobileOrTablet && (
        <div className="px-3 pb-1.5 shrink-0 flex items-center gap-2">
          <button
            onClick={() => setNavOpen(!navOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs font-medium text-slate-300 hover:bg-white/[0.05] transition-all touch-target flex-1"
          >
            {currentTabObj && <currentTabObj.icon className={`h-3.5 w-3.5 ${currentTabObj.color}`} />}
            <span>{currentTabObj?.label || "Select"}</span>
            <ChevronDown className={`h-3 w-3 ml-auto text-slate-500 transition-transform ${navOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}

      {/* Mobile nav dropdown */}
      <AnimatePresence>
        {isMobileOrTablet && navOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-3 pb-2 shrink-0 overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-1.5 rounded-xl border border-white/[0.06] bg-white/[0.015]">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                const isDirty = dirtyTabs.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => { switchTab(t.id); setNavOpen(false); }}
                    className={`relative flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-[11px] font-medium transition-colors touch-target ${
                      active ? "bg-violet-500/10 text-violet-300 border border-violet-500/20" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] border border-transparent"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? t.color : ""}`} />
                    <span className="truncate">{t.label}</span>
                    {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 px-3 sm:px-4 pb-2 flex gap-3">
        {/* Tab navigation — persistent left sidebar (desktop only) */}
        {!isMobileOrTablet && (
        <nav className="w-48 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.015] flex flex-col p-1.5 overflow-y-auto">
          {TABS.map((t, i) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const isDirty = dirtyTabs.includes(t.id);
            return (
              <motion.button
                key={t.id}
                onClick={() => switchTab(t.id)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`relative flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                  active ? "text-violet-300" : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="settings-tab-bg"
                    className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-lg -z-10"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon className={`h-3.5 w-3.5 transition-colors ${active ? t.color : ""}`} />
                <span>{t.label}</span>
                {isDirty && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                  />
                )}
              </motion.button>
            );
          })}
        </nav>
        )}

        {/* Tab content */}
        <div className="flex-1 min-w-0 min-h-0 rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-y-auto">
          <AnimatePresence mode="wait">
          <motion.div
            ref={contentRef}
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="p-4 md:p-5 space-y-4"
          >

            <SettingsTabs tab={tab} cfg={cfg} update={update} testing={testing} testResult={testResult} testConnection={testConnection} remoteUrl={remoteUrl} setRemoteUrl={setRemoteUrl} saveRemote={saveRemote} testRemote={testRemote} remoteEnabled={remoteEnabled} remoteTesting={remoteTesting} remoteTestResult={remoteTestResult} clearRemote={clearRemote} />
          </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Sticky Save Bar */}
      <StickySaveBar
        dirtyCount={dirtyFields.length}
        dirtyTabs={dirtyTabs}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  );
}

// ── Tools Panel ───────────────────────────────────────────────────────────

// ToolsPanel + MarketplaceSection extracted to ./ToolsPanel.tsx

// ── Environment Variables ───────────────────────────────────────────────────

// EnvPanel extracted to ./EnvPanel.tsx

// ── Marketplace Section ─────────────────────────────────────────────────────

// MarketplaceSection extracted to ./ToolsPanel.tsx

// ── Helpers ─────────────────────────────────────────────────────────────────
