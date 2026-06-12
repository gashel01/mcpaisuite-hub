"use client";

import { useEffect, useRef, type DependencyList } from "react";

/**
 * Run `fn` once on mount, then every `intervalMs`. Pauses while the tab is hidden
 * (and fires immediately again when it becomes visible) to avoid background polling
 * storms across tabs. Cleans up the interval and listener on unmount.
 *
 * Pass `intervalMs = null` to call `fn` once on mount without polling.
 * Changing any value in `deps` re-runs immediately (e.g. tenant switch).
 *
 * The callback is held in a ref, so you don't need to memoize `fn`.
 */
export function usePolling(fn: () => void, intervalMs: number | null, deps: DependencyList = []) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
      if (intervalMs == null || timer) return;
      timer = setInterval(() => { if (!document.hidden) saved.current(); }, intervalMs);
    };

    saved.current(); // immediate
    start();

    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      saved.current();
      start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
