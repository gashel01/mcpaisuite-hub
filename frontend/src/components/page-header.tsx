"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface Action {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  tooltip?: string;
}

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: Action[];
  children?: React.ReactNode;
}

export default function PageHeader({ icon: Icon, title, subtitle, actions, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <Icon className="h-4.5 w-4.5 text-violet-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-100 leading-tight">{title}</h1>
          <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{subtitle}</p>
        </div>
      </div>
      {(actions || children) && (
        <div className="flex items-center gap-1.5 shrink-0">
          {children}
          {actions?.map((a, i) => {
            const cls = a.variant === "primary"
              ? "bg-violet-600 hover:bg-violet-500 text-white shadow-sm shadow-violet-500/10"
              : a.variant === "danger"
              ? "bg-white/[0.03] hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-white/[0.06]"
              : "bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 border border-white/[0.06]";
            const inner = (
              <>
                {a.loading ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                ) : a.icon ? (
                  <a.icon className="h-3.5 w-3.5" />
                ) : null}
                <span className="text-xs font-medium">{a.label}</span>
              </>
            );
            if (a.href) {
              return (
                <Link key={i} href={a.href} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${cls}`} data-tooltip={a.tooltip}>
                  {inner}
                </Link>
              );
            }
            return (
              <button key={i} onClick={a.onClick} disabled={a.disabled || a.loading} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 ${cls}`} data-tooltip={a.tooltip}>
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
