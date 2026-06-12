"use client";

import { Loader2, type LucideIcon } from "lucide-react";

/**
 * Unified spinner / loading icon.
 *
 * - Pure loading indicator: `<Spinner className="h-4 w-4" />` (defaults to a spinning Loader2).
 * - Refresh button: `<Spinner icon={RefreshCw} spinning={loading} className="h-3.5 w-3.5" />`
 *   — shown static when idle, spinning while `loading`.
 *
 * The `key` forces a remount whenever `spinning` flips true, so the CSS animation always
 * replays — browsers do NOT restart `animate-spin` when it's merely re-added to the same
 * DOM node, which is why a fast (localhost) refresh otherwise looked frozen.
 */
export function Spinner({
  className = "h-4 w-4",
  icon: Icon = Loader2,
  spinning = true,
}: {
  className?: string;
  icon?: LucideIcon;
  spinning?: boolean;
}) {
  return <Icon key={spinning ? "spin" : "idle"} className={`${spinning ? "animate-spin " : ""}${className}`} />;
}
