"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  MessageSquare,
  Settings, Bot, Activity, Menu, X, Database, FolderOpen, Users, Plus,
  ChevronDown, Clock, Shield, FlaskConical, Radio,
} from "lucide-react";
import { useTenant } from "@/context/tenant";

const NAV_MAIN = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/agents", label: "Agents", icon: Bot },
] as const;

const NAV_LIBS = [
  { href: "/knowledge", label: "Knowledge", icon: Database },
  { href: "/workspace", label: "Workspace", icon: FolderOpen },
  { href: "/scheduler", label: "Scheduled Tasks", icon: Clock },
] as const;

const NAV_DEVTOOLS = [
  { href: "/eval", label: "Eval", icon: FlaskConical },
] as const;

const NAV_SYSTEM = [
  { href: "/observability", label: "Observability", icon: Activity },
  { href: "/security", label: "Security", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Keyboard shortcut: Ctrl+/ to toggle sidebar on mobile
  useEffect(() => {
    const handler = () => setOpen(prev => !prev);
    window.addEventListener("kernelmcp:toggle-sidebar", handler);
    return () => window.removeEventListener("kernelmcp:toggle-sidebar", handler);
  }, []);
  const [tenantOpen, setTenantOpen] = useState(false);
  const [newTenant, setNewTenant] = useState("");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      const r = JSON.parse(localStorage.getItem("kernelmcp_remote") || "{}");
      if (r.enabled && r.url) setRemoteUrl(r.url);
    } catch {}
  }, []);
  const { tenant, setTenant, tenants, createTenant } = useTenant();

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
    const active = isActive(href);
    return (
      <Link
        href={href}
        onClick={() => setOpen(false)}
        className={`group flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-all duration-150 ${
          active
            ? "bg-violet-600/12 text-violet-400 shadow-sm shadow-violet-500/5"
            : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
        }`}
      >
        <Icon className={`h-4 w-4 transition-colors ${active ? "text-violet-400" : "text-slate-500 group-hover:text-slate-400"}`} />
        {label}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="fixed top-3 left-3 z-40 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900/90 border border-slate-700/50 text-slate-400 md:hidden  hover:text-slate-200 hover:border-slate-600/60 active:scale-95 transition-all"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70  md:hidden transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-[#0c0c14] border-r border-white/[0.06] transition-transform duration-250 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 md:z-30`}
      >
        {/* Header: Brand */}
        <div className="flex items-center gap-2.5 px-3.5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600/30 to-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
              <div className="h-2 w-2 rounded-full bg-violet-400 shadow-sm shadow-violet-400/50" />
            </div>
            <span className="text-[13px] font-bold tracking-tight text-slate-100">kernelmcp</span>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-300 md:hidden transition-colors" aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tenant Selector */}
        <div className="px-3 pb-2.5">
          <div className="relative">
            <button
              onClick={() => setTenantOpen(!tenantOpen)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-[6px] rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/25 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Users className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <span className="text-xs text-slate-300 truncate">{tenant}</span>
              </div>
              <ChevronDown className={`h-3 w-3 text-slate-600 transition-transform duration-200 ${tenantOpen ? "rotate-180" : ""}`} />
            </button>

            {tenantOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setTenantOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-xl shadow-black/40 overflow-hidden">
                  <div className="max-h-40 overflow-y-auto">
                    {tenants.map(t => (
                      <button
                        key={t}
                        onClick={() => { setTenant(t); setTenantOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                          t === tenant ? "bg-violet-600/12 text-violet-400 font-medium" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-white/[0.06] p-2">
                    <div className="flex gap-1.5">
                      <input
                        value={newTenant}
                        onChange={e => setNewTenant(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleCreateTenant()}
                        placeholder="New namespace..."
                        className="flex-1 !bg-white/[0.03] !border-white/[0.06] rounded-md !px-2 !py-1 !text-[11px] text-slate-200 placeholder-slate-600 focus:!border-violet-500 focus:outline-none"
                      />
                      <button onClick={handleCreateTenant} className="bg-violet-600 hover:bg-violet-500 text-white rounded-md px-2 py-1 transition-colors active:scale-95">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-3 border-t border-white/[0.04] mb-2" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-0.5 space-y-5">
          {/* Main */}
          <div className="space-y-0.5">
            {NAV_MAIN.map(item => <NavLink key={item.href} {...item} />)}
          </div>

          {/* Libraries */}
          <div>
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">Libraries</p>
            <div className="space-y-0.5">
              {NAV_LIBS.map(item => <NavLink key={item.href} {...item} />)}
            </div>
          </div>

          {/* Dev Tools */}
          <div>
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">Dev Tools</p>
            <div className="space-y-0.5">
              {NAV_DEVTOOLS.map(item => <NavLink key={item.href} {...item} />)}
            </div>
          </div>

          {/* System */}
          <div>
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600">System</p>
            <div className="space-y-0.5">
              {NAV_SYSTEM.map(item => <NavLink key={item.href} {...item} />)}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.04] px-3 py-2.5 space-y-1.5">
          {remoteUrl && (
            <Link href="/settings" onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 w-full px-2 py-1 rounded-md bg-teal-500/10 border border-teal-500/20 hover:bg-teal-500/15 transition-colors group"
              title={`Listening to: ${remoteUrl}`}
            >
              <Radio className="h-3 w-3 text-teal-400 shrink-0" />
              <span className="text-[10px] text-teal-300 font-medium truncate flex-1">{remoteUrl.replace(/^https?:\/\//, "")}</span>
            </Link>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={`h-1.5 w-1.5 rounded-full ${remoteUrl ? "bg-teal-400" : "bg-emerald-400"}`} />
              <span className="text-[10px] text-slate-500 font-medium">v1.0</span>
            </div>
            <span className="text-[10px] text-slate-600">MCP AI Suite</span>
          </div>
        </div>
      </aside>
    </>
  );
}
