"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";

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
          {actions?.map((a, i) => (
            <Button
              key={i}
              variant={a.variant}
              icon={a.icon}
              loading={a.loading}
              disabled={a.disabled}
              href={a.href}
              onClick={a.onClick}
              tooltip={a.tooltip}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
