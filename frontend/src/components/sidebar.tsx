"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  MessageSquare, Server, ShieldCheck, DollarSign,
  Settings, Bot, Activity, Menu, X, Database, FolderOpen, Users, Plus,
  ChevronDown, Brain, Search, ListChecks, Terminal, Clock, Layers,
} from "lucide-react";
import { useTenant } from "@/context/tenant";
import { useMode, MODE_META, type DemoMode } from "@/context/mode";

const NAV_MAIN = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/agents", label: "Agents", icon: Bot },
] as const;

const NAV_LIBS = [
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/knowledge", label: "Knowledge", icon: Database },
  { href: "/planning", label: "Planning", icon: ListChecks },
  { href: "/sandbox", label: "Sandbox", icon: Terminal },
  { href: "/workspace", label: "Workspace", icon: FolderOpen },
  { href: "/scheduler", label: "Scheduler", icon: Clock },
] as const;

const NAV_SYSTEM = [
  { href: "/audit", label: "Live Audit", icon: Activity },
  { href: "/servers", label: "Servers", icon: Server },
  { href: "/constitution", label: "Constitution", icon: ShieldCheck },
  { href: "/cost", label: "Cost", icon: DollarSign },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const MODES: DemoMode[] = ["kernel", "memory", "rag", "planning", "sandbox", "workspace", "scheduler"];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [newTenant, setNewTenant] = useState("");
  const { tenant, setTenant, tenants, createTenant } = useTenant();
  const { mode, setMode, isPageVisible } = useMode();
  const meta = MODE_META[mode];

  const handleCreateTenant = () => {
    if (newTenant.trim()) {
      createTenant(newTenant.trim());
      setNewTenant("");
      setTenantOpen(false);
    }
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const NavLink = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) => {
    if (!isPageVisible(href)) return null;
    return (
      <Link
        href={href}
        onClick={() => setOpen(false)}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
          isActive(href)
            ? "bg-violet-600/15 text-violet-400"
            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        }`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    );
  };

  const visibleLibs = NAV_LIBS.filter(item => isPageVisible(item.href));
  const visibleSystem = NAV_SYSTEM.filter(item => isPageVisible(item.href));

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-40 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-400 md:hidden backdrop-blur-sm"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#111118] border-r border-slate-800/80 transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 md:z-30`}
      >
        {/* Header: Brand */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
              <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-200">kernelmcp</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 md:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="px-3 pb-1.5">
          <div className="relative">
            <button
              onClick={() => setModeOpen(!modeOpen)}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-${meta.color}-500/10 border border-${meta.color}-500/20 hover:border-${meta.color}-500/40 transition-colors`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Layers className={`h-3.5 w-3.5 text-${meta.color}-400 shrink-0`} />
                <span className="text-xs text-slate-200 font-medium truncate">{meta.label}</span>
              </div>
              <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform ${modeOpen ? "rotate-180" : ""}`} />
            </button>

            {modeOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setModeOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[#111118] border border-slate-700/60 rounded-lg shadow-xl overflow-hidden">
                  {MODES.map(m => {
                    const mm = MODE_META[m];
                    return (
                      <button
                        key={m}
                        onClick={() => { setMode(m); setModeOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between ${
                          m === mode ? `bg-${mm.color}-500/15 text-${mm.color}-400` : "text-slate-300 hover:bg-slate-800/60"
                        }`}
                      >
                        <span className="font-medium">{mm.label}</span>
                        <span className="text-[10px] text-slate-500">{mm.description}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tenant Selector */}
        <div className="px-3 pb-2">
          <div className="relative">
            <button
              onClick={() => setTenantOpen(!tenantOpen)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40 hover:border-violet-500/30 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Users className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                <span className="text-xs text-slate-300 truncate">{tenant}</span>
              </div>
              <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform ${tenantOpen ? "rotate-180" : ""}`} />
            </button>

            {tenantOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setTenantOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[#111118] border border-slate-700/60 rounded-lg shadow-xl overflow-hidden">
                  <div className="max-h-40 overflow-y-auto">
                    {tenants.map(t => (
                      <button
                        key={t}
                        onClick={() => { setTenant(t); setTenantOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                          t === tenant ? "bg-violet-600/15 text-violet-400" : "text-slate-300 hover:bg-slate-800/60"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-slate-700/40 p-2">
                    <div className="flex gap-1.5">
                      <input
                        value={newTenant}
                        onChange={e => setNewTenant(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleCreateTenant()}
                        placeholder="New namespace..."
                        className="flex-1 bg-slate-900/80 border border-slate-700/40 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
                      />
                      <button onClick={handleCreateTenant} className="bg-violet-600 hover:bg-violet-500 text-white rounded px-2 py-1 transition-colors">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-1 space-y-4">
          {/* Main */}
          <div className="space-y-0.5">
            {NAV_MAIN.map(item => <NavLink key={item.href} {...item} />)}
          </div>

          {/* Libraries */}
          {visibleLibs.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">Libraries</p>
              <div className="space-y-0.5">
                {visibleLibs.map(item => <NavLink key={item.href} {...item} />)}
              </div>
            </div>
          )}

          {/* System */}
          {visibleSystem.length > 0 && (
            <div>
              <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">System</p>
              <div className="space-y-0.5">
                {visibleSystem.map(item => <NavLink key={item.href} {...item} />)}
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800/60 px-4 py-2.5 flex items-center justify-between">
          <span className="text-[10px] text-slate-600">kernelmcp v1.0</span>
          <span className="text-[10px] text-slate-700">6 servers</span>
        </div>
      </aside>
    </>
  );
}
