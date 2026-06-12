"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

// Canonical button recipes — lifted verbatim from the original PageHeader so adoption is
// pixel-identical. `ghost` is the default neutral action; `primary` the violet CTA.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-violet-600 hover:bg-violet-500 text-white shadow-sm shadow-violet-500/10",
  ghost: "bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 border border-white/[0.06]",
  danger: "bg-white/[0.03] hover:bg-red-500/10 text-slate-400 hover:text-red-400 border border-white/[0.06]",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-[11px]",
  md: "px-3 py-1.5 text-xs",
};
const BASE = "flex items-center gap-1.5 rounded-lg font-medium transition-all";

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (replaced by a spinner while `loading`). */
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Renders a Next.js `<Link>` instead of a `<button>`. */
  href?: string;
  tooltip?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  children?: React.ReactNode;
}

export function Button({
  variant = "ghost", size = "md", icon: Icon, loading, disabled,
  href, tooltip, onClick, type = "button", className = "", children,
}: ButtonProps) {
  const cls = `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`;
  const inner = (
    <>
      {loading ? <Spinner className="h-3.5 w-3.5" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </>
  );
  if (href) {
    return <Link href={href} className={cls} data-tooltip={tooltip}>{inner}</Link>;
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={`${cls} disabled:opacity-40`} data-tooltip={tooltip}>
      {inner}
    </button>
  );
}
