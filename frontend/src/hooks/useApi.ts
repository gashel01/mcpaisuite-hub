"use client";

import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export interface UseApiResult<T> {
  data: T | null;
  error: unknown;
  /** True on the initial load and on a manual `refresh()` — NOT on background polls. */
  loading: boolean;
  refresh: () => Promise<void>;
  /** Local override (e.g. optimistic update) of the cached data. */
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

export interface UseApiOptions<T> {
  /** Re-fetch (loud) whenever any of these change — e.g. `[tenant, filter]`. */
  deps?: DependencyList;
  /** Background refresh every N ms (silent, and paused while the tab is hidden). */
  poll?: number | null;
  /** Skip fetching while false. */
  enabled?: boolean;
  /** Seed value before the first fetch resolves (keeps `data` non-null). */
  initialData?: T | null;
  /**
   * Minimum time `loading` stays true on a manual `refresh()`, so a fast (localhost)
   * response still gives a visible spinner instead of an imperceptible flash. Only the
   * manual refresh is floored — the initial/deps load and background polls are not.
   */
  minRefreshMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * Data-fetching hook that collapses the repeated `useState(data)/useState(loading)/
 * useCallback(load)/useEffect` quadruplet. Pass a `fetcher` (usually wrapping `apiFetch`);
 * the latest closure is always used, so you don't need to memoize it.
 *
 * `loading` is "loud" only (initial + manual refresh), so a polling list doesn't flash its
 * spinner every interval. Out-of-order responses and post-unmount updates are guarded.
 */
export function useApi<T>(fetcher: () => Promise<T>, options: UseApiOptions<T> = {}): UseApiResult<T> {
  const { deps = [], poll = null, enabled = true, initialData = null, minRefreshMs = 500, onError } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const reqId = useRef(0);
  const alive = useRef(true);

  const run = useCallback(async (silent: boolean, minMs = 0) => {
    const id = ++reqId.current;
    const started = Date.now();
    if (!silent) setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (alive.current && id === reqId.current) { setData(result); setError(null); }
    } catch (err) {
      if (alive.current && id === reqId.current) { setError(err); onErrorRef.current?.(err); }
    } finally {
      if (!silent) {
        const wait = minMs - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (alive.current && id === reqId.current) setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(() => run(false, minRefreshMs), [run, minRefreshMs]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => {
      if (poll == null || timer) return;
      timer = setInterval(() => { if (!document.hidden) run(true); }, poll);
    };

    run(false); // loud initial / on deps change
    start();

    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      run(true);
      start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, poll, run, ...deps]);

  return { data, error, loading, refresh, setData };
}
