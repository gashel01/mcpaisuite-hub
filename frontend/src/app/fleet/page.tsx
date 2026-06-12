"use client";
import { apiFetch } from "@/lib/api";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Gauge, Rocket, RefreshCw, Plus, Loader2, Activity, DollarSign,
  Repeat, Power, History, ArrowUpRight,
} from "lucide-react";
import { ChevronLeft } from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { Spinner } from "@/components/ui/Spinner";
import DeploymentDetail, { type Deployment } from "@/components/deployment-detail";
import ExecutionsFeed from "@/components/executions-feed";
import ConnectedKernels from "@/components/connected-kernels";
import { Server } from "lucide-react";

interface CPDeployment { id: string; name: string; status: string; runs: number; triggers: number; version: number; workflowId?: string; tenant?: string; endpoint: string; }
interface Stats { live: number; paused: number; deployments: number; triggers: number; running: number; runs_today: number; cost_today: number; tokens_today: number; }
interface ControlPlaneResponse { deployments: CPDeployment[]; stats: Stats | null; }

function Tile({ icon, label, value, pulse, index = 0 }: { icon: React.ReactNode; label: string; value: string; pulse?: boolean; index?: number }) {
  return (
    <div
      className="animate-stagger flex-1 min-w-[92px] sm:min-w-[120px] rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 sm:px-3.5 py-2 sm:py-2.5 transition-colors hover:border-white/[0.12]"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">{icon}<span className="text-[8.5px] sm:text-[9px] text-slate-500 uppercase tracking-wide truncate">{label}</span>{pulse && <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse ml-auto" />}</div>
      <div className="text-[15px] sm:text-[17px] font-bold text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}

export default function FleetPage() {
  const { isMobile } = useBreakpoint();

  const [deployments, setDeployments] = useState<CPDeployment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"deployment" | "activity" | "kernels">("activity");
  const [activityFilter, setActivityFilter] = useState("");
  // Mobile uses push-navigation: the list and the panel are separate screens.
  const [mobileScreen, setMobileScreen] = useState<"list" | "panel">("list");

  // Fleet is the GLOBAL ops view (all tenants) — deliberately not tenant-scoped. Each row
  // carries its owner tenant as a badge. Per-tenant "my deployments" lives in Agents.
  const load = useCallback(async () => {
    try {
      const d = await apiFetch<ControlPlaneResponse>("/control-plane");
      setDeployments(d.deployments || []);
      setStats(d.stats || null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Manual refresh: spin while fetching, then keep spinning 600ms more so a fast
  // (localhost) response still gives visible feedback instead of an imperceptible flash.
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await load();
    setTimeout(() => setRefreshing(false), 600);
  }, [load, refreshing]);

  useEffect(() => {
    // Deep-link from the old /executions route
    const p = new URLSearchParams(window.location.search).get("view");
    if (p === "activity") setView("activity");
  }, []);

  // Initial load + 15s refresh. Global view — does not depend on the selected tenant.
  usePolling(load, 15000, []);

  // Clear the open deployment selection only if it's no longer in the (reloaded) list — e.g.
  // after switching tenant or deleting it. "Reset only if not found", not on every switch.
  useEffect(() => {
    if (selectedId && !deployments.some(d => d.id === selectedId)) {
      setSelectedId(null);
      if (view === "deployment") { setView("activity"); setMobileScreen("list"); }
    }
  }, [deployments, selectedId, view]);

  const selected = deployments.find(d => d.id === selectedId) || null;
  const selectedDep: Deployment | null = selected
    ? { id: selected.id, name: selected.name, status: selected.status, endpoint: selected.endpoint, runs: selected.runs, version: selected.version, tenant: selected.tenant, created_at: 0 }
    : null;

  const pickDeployment = (id: string) => { setSelectedId(id); setView("deployment"); setMobileScreen("panel"); };
  const showActivity = (filter = "") => { setActivityFilter(filter); setView("activity"); setSelectedId(null); setMobileScreen("panel"); };
  const showKernels = () => { setView("kernels"); setSelectedId(null); setMobileScreen("panel"); };

  const showList = !isMobile || mobileScreen === "list";
  const showPanel = !isMobile || mobileScreen === "panel";

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] shrink-0">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center">
          <Gauge className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Fleet</h1>
          <p className="text-[11px] text-slate-500">Deployments, their runs, and live fleet health — one place</p>
        </div>
        <button onClick={handleRefresh} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 border border-white/[0.06] transition-all">
          <Spinner icon={RefreshCw} spinning={loading || refreshing} className="h-3.5 w-3.5" /> Refresh
        </button>
        <Link href="/agents" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600/90 hover:bg-violet-500 text-white transition-all">
          <Plus className="h-3.5 w-3.5" /> Deploy a workflow
        </Link>
      </div>

      {/* Stats overview (was the Control Plane) — hidden on the mobile detail screen */}
      <div className={`${isMobile && mobileScreen === "panel" ? "hidden" : "flex"} flex-wrap gap-2 px-4 py-2.5 border-b border-white/[0.04] shrink-0`}>
        <Tile index={0} icon={<Rocket className="h-3 w-3 text-emerald-400" />} label="Live" value={String(stats?.live ?? 0)} />
        <Tile index={1} icon={<Power className="h-3 w-3 text-amber-400" />} label="Paused" value={String(stats?.paused ?? 0)} />
        <Tile index={2} icon={<Loader2 className="h-3 w-3 text-sky-400" />} label="Running" value={String(stats?.running ?? 0)} pulse={(stats?.running ?? 0) > 0} />
        <Tile index={3} icon={<Repeat className="h-3 w-3 text-violet-400" />} label="Triggers" value={String(stats?.triggers ?? 0)} />
        <Tile index={4} icon={<Activity className="h-3 w-3 text-slate-300" />} label="Runs today" value={String(stats?.runs_today ?? 0)} />
        <Tile index={5} icon={<DollarSign className="h-3 w-3 text-emerald-400" />} label="Cost today" value={`$${(stats?.cost_today ?? 0).toFixed(3)}`} />
      </div>

      {/* Master-detail (desktop) / push-navigation (mobile) */}
      <div className="flex-1 min-h-0 flex">
        {/* Left rail — deployments registry + activity */}
        <div className={`${showList ? "flex" : "hidden"} ${isMobile ? "w-full" : "w-64 shrink-0 border-r border-white/[0.06]"} flex-col min-h-0`}>
          <button onClick={() => showActivity("")}
            className={`flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium border-b border-white/[0.05] transition-colors ${view === "activity" ? "bg-violet-500/10 text-violet-200" : "text-slate-400 hover:bg-white/[0.03]"}`}>
            <History className="h-3.5 w-3.5" /> All activity
            <ArrowUpRight className="h-3 w-3 ml-auto opacity-50" />
          </button>
          <button onClick={showKernels}
            className={`flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium border-b border-white/[0.05] transition-colors ${view === "kernels" ? "bg-violet-500/10 text-violet-200" : "text-slate-400 hover:bg-white/[0.03]"}`}>
            <Server className="h-3.5 w-3.5" /> Connected kernels
            <ArrowUpRight className="h-3 w-3 ml-auto opacity-50" />
          </button>
          <div className="px-4 py-2 flex items-center justify-between shrink-0">
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Deployments</span>
            <span className="text-[9px] text-slate-600">{deployments.length}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1">
            {loading && deployments.length === 0 ? (
              <div className="flex items-center gap-2 text-slate-600 text-[11px] px-2 py-3"><Spinner className="h-3.5 w-3.5" /> Loading…</div>
            ) : deployments.length === 0 ? (
              <div className="px-2 py-6 text-center">
                <Rocket className="h-7 w-7 text-slate-700 mx-auto mb-2" />
                <p className="text-[11px] text-slate-500">Nothing deployed yet.</p>
                <Link href="/agents" className="inline-flex items-center gap-1 mt-2 text-[10px] text-violet-400 hover:text-violet-300">Build & deploy <ArrowUpRight className="h-2.5 w-2.5" /></Link>
              </div>
            ) : deployments.map((d, i) => (
              <button key={d.id} onClick={() => pickDeployment(d.id)}
                style={{ animationDelay: `${i * 30}ms` }}
                className={`animate-stagger w-full text-left rounded-lg px-2.5 py-2 transition-all active:scale-[0.99] ${view === "deployment" && selectedId === d.id ? "bg-violet-500/12 border border-violet-500/20" : "hover:bg-white/[0.03] border border-transparent"}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${d.status === "paused" ? "bg-amber-400" : "bg-emerald-400"}`} />
                  <span className="text-[12px] text-slate-200 truncate flex-1">{d.name}</span>
                  {d.triggers > 0 && <span className="text-[9px] text-violet-400 shrink-0 flex items-center gap-0.5"><Repeat className="h-2.5 w-2.5" />{d.triggers}</span>}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-slate-600">
                  {d.tenant && <span className="px-1 rounded bg-violet-500/10 text-violet-300/80 font-medium" data-tooltip="Owner tenant">{d.tenant}</span>}
                  <span>{d.status === "paused" ? "offline" : "live"}</span>
                  <span>· {d.runs} runs</span>
                  <span>· v{d.version}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel — detail or activity */}
        <div className={`${showPanel ? "flex" : "hidden"} flex-1 min-w-0 min-h-0 flex-col`}>
          {isMobile && (
            <button onClick={() => setMobileScreen("list")} className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium text-slate-300 border-b border-white/[0.06] hover:bg-white/[0.03] transition-colors shrink-0">
              <ChevronLeft className="h-3.5 w-3.5" /> Fleet
            </button>
          )}
          <div className="flex-1 min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={view === "deployment" ? `dep-${selectedId}` : view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="h-full min-h-0"
            >
              {view === "deployment" && selectedDep ? (
                <DeploymentDetail
                  key={selectedDep.id}
                  dep={selectedDep}
                  onChanged={(patch) => setDeployments(list => list.map(d => d.id === patch.id ? { ...d, status: (patch as any).status ?? d.status } : d))}
                  onDeleted={(id) => { setDeployments(list => list.filter(d => d.id !== id)); setSelectedId(null); setView("activity"); setMobileScreen("list"); load(); }}
                  onViewRuns={(name) => showActivity(name)}
                />
              ) : view === "kernels" ? (
                <ConnectedKernels />
              ) : (
                <ExecutionsFeed initialQuery={activityFilter} />
              )}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
