"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Guards the custom-backend override (Settings → Backend, localStorage "kernelmcp_remote").
 *
 * When a custom backend is active, EVERY page talks to it (see lib/api-url.ts). If that
 * backend is unreachable, the whole app silently bricks — empty screens, all requests
 * failing with 0 B transferred. This gate health-checks the custom backend once on load;
 * if it's truly unreachable it disables the override (preserving the URL), flags the
 * reason, and reloads onto the healthy local backend — then shows a dismissible banner.
 *
 * Only a network failure / timeout triggers the fallback. Any HTTP response (even non-2xx)
 * counts as "reachable", so a backend that's merely lacking /health is left alone.
 */
const KEY = "kernelmcp_remote";
const FALLBACK_FLAG = "kernelmcp_backend_fallback"; // sessionStorage: the URL we fell back from

export default function BackendHealthGate() {
  const [fellBackFrom, setFellBackFrom] = useState<string | null>(null);

  useEffect(() => {
    // Show the banner if a previous load already fell back (flag survives the reload).
    try {
      const f = sessionStorage.getItem(FALLBACK_FLAG);
      if (f) setFellBackFrom(f);
    } catch {}

    let cancelled = false;
    (async () => {
      let cfg: { enabled?: boolean; url?: string } = {};
      try { cfg = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
      if (!cfg.enabled || !cfg.url) return; // using local — nothing to check
      const url = String(cfg.url).replace(/\/$/, "");
      try {
        // Any response means the backend is reachable — leave the override active.
        await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        // Reachable now: clear a stale fallback note so the banner doesn't linger.
        try { sessionStorage.removeItem(FALLBACK_FLAG); } catch {}
        if (!cancelled) setFellBackFrom(null);
      } catch {
        if (cancelled) return;
        // Truly unreachable (network error / timeout) → fall back to local.
        try {
          localStorage.setItem(KEY, JSON.stringify({ ...cfg, enabled: false, url }));
          sessionStorage.setItem(FALLBACK_FLAG, url);
        } catch {}
        location.reload();
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    try { sessionStorage.removeItem(FALLBACK_FLAG); } catch {}
    setFellBackFrom(null);
  };

  if (!fellBackFrom) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2.5 max-w-[92vw] px-3.5 py-2 rounded-xl bg-amber-500/12 border border-amber-500/30 shadow-lg shadow-black/30 backdrop-blur">
      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
      <p className="text-[11.5px] text-amber-100/90 leading-snug">
        Custom backend <code className="text-amber-300">{fellBackFrom.replace(/^https?:\/\//, "")}</code> was unreachable — using the local backend.{" "}
        <a href="/settings?tab=remote" className="underline hover:text-amber-200">Reconfigure</a>
      </p>
      <button onClick={dismiss} title="Dismiss" className="text-amber-400/70 hover:text-amber-200 shrink-0">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
