"use client";

import { useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Spinner } from "./Spinner";

/**
 * Refresh button with consistent spin-on-click feedback: the icon spins while `onRefresh`
 * runs and for a short floor after (`minMs`) so a fast (localhost) response is still visible.
 * Bring your own `className` so it matches each header's existing style.
 */
export function RefreshButton({
  onRefresh,
  className = "",
  iconClassName = "h-3.5 w-3.5",
  title = "Refresh",
  label,
  minMs = 600,
}: {
  onRefresh: () => unknown | Promise<unknown>;
  className?: string;
  iconClassName?: string;
  title?: string;
  label?: string;
  minMs?: number;
}) {
  const [spinning, setSpinning] = useState(false);
  const handle = useCallback(async () => {
    if (spinning) return;
    setSpinning(true);
    try { await onRefresh(); } catch { /* errors are surfaced by the caller */ }
    setTimeout(() => setSpinning(false), minMs);
  }, [onRefresh, spinning, minMs]);

  return (
    <button onClick={handle} className={className} title={title} aria-label={title}>
      <Spinner icon={RefreshCw} spinning={spinning} className={iconClassName} />
      {label && <span className="text-xs font-medium">{label}</span>}
    </button>
  );
}
