/**
 * Returns the active kernel API base URL.
 * Reads from localStorage to support the custom-Backend override (Settings → Backend),
 * which REPLACES the local backend for every page. This is distinct from the additive
 * Hub connector (connect_hub) that adds remote kernels as extra scopes without hiding local.
 * Falls back to NEXT_PUBLIC_API_URL / localhost:8007.
 */
export function getApiUrl(): string {
  if (typeof window !== "undefined") {
    try {
      const r = JSON.parse(localStorage.getItem("kernelmcp_remote") || "{}");
      if (r.enabled && r.url) return (r.url as string).replace(/\/$/, "");
    } catch {}
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";
}
