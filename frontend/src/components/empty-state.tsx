"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-600/12 to-violet-900/8 border border-violet-500/12 flex items-center justify-center mb-4">
        <Icon className="h-5 w-5 text-violet-400/70" />
      </div>
      <h3 className="text-sm font-semibold text-slate-300 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 text-center max-w-sm leading-relaxed mb-4">{description}</p>
      {action && (
        action.href ? (
          <Link href={action.href} className="text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 hover:bg-violet-500/15 border border-violet-500/15 px-4 py-2 rounded-lg transition-all">
            {action.label} &rarr;
          </Link>
        ) : (
          <button onClick={action.onClick} className="text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/8 hover:bg-violet-500/15 border border-violet-500/15 px-4 py-2 rounded-lg transition-all">
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
