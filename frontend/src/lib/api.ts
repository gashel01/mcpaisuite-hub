/**
 * Centralized API client.
 *
 * Replaces the `getApiUrl() + raw fetch` pattern scattered across the app. Fixes three
 * recurring bugs in one place:
 *   1. Backend override — the base URL is resolved PER CALL (via getApiUrl), so switching
 *      backend in Settings takes effect without a full reload. (Module-scope `BASE_URL`
 *      constants captured the URL once at import and ignored later overrides.)
 *   2. `res.ok` is always checked — a non-2xx JSON error body is no longer silently treated
 *      as data (which surfaced as empty lists with no feedback).
 *   3. Tenant header — injected consistently as `X-Tenant-Id` (callers used to hand-roll it
 *      with drifting casing).
 */
import { getApiUrl } from "@/lib/api-url";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiOptions {
  method?: string;
  /** Auto-`JSON.stringify`'d (with Content-Type) unless it's a string or FormData. */
  body?: unknown;
  /** Injects `X-Tenant-Id`. */
  tenant?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Return the raw `Response` instead of parsing (for blobs / streaming). */
  raw?: boolean;
}

/** Build an absolute URL from a path, resolving the active backend at call time. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = getApiUrl();
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Fetch `path` against the active backend and return the parsed body as `T`.
 * Throws `ApiError` on non-2xx responses.
 */
export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.tenant) headers["X-Tenant-Id"] = opts.tenant;

  let body = opts.body as BodyInit | undefined;
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body != null && !isForm && typeof opts.body !== "string") {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(apiUrl(path), {
    method: opts.method ?? (opts.body != null ? "POST" : "GET"),
    headers,
    body,
    signal: opts.signal,
  });

  if (!res.ok) {
    let errBody: unknown;
    try { errBody = await res.json(); } catch { try { errBody = await res.text(); } catch { /* ignore */ } }
    throw new ApiError(res.status, `${res.status} ${res.statusText} — ${apiUrl(path)}`, errBody);
  }

  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}
