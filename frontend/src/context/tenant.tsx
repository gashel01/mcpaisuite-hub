"use client";
import { getApiUrl } from "@/lib/api-url";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";


interface TenantCtx {
  tenant: string;
  setTenant: (t: string) => void;
  tenants: string[];
  refreshTenants: () => void;
  createTenant: (name: string) => void;
}

const TenantContext = createContext<TenantCtx>({
  tenant: "demo",
  setTenant: () => {},
  tenants: ["demo"],
  refreshTenants: () => {},
  createTenant: () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const BASE = getApiUrl();
  const [tenant, setTenantState] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("kernelmcp_tenant") || "demo";
    }
    return "demo";
  });
  const [tenants, setTenants] = useState<string[]>(["demo"]);

  const setTenant = (t: string) => {
    setTenantState(t);
    if (typeof window !== "undefined") {
      localStorage.setItem("kernelmcp_tenant", t);
    }
  };

  const refreshTenants = () => {
    fetch(`${BASE}/workspace/tenants`)
      .then((r) => r.json())
      .then((d) => {
        const list: string[] = (d.tenants as string[]) || ["demo"];
        if (!list.includes(tenant)) list.push(tenant);
        if (!list.includes("demo")) list.unshift("demo");
        setTenants([...new Set(list)].sort() as string[]);
      })
      .catch(() => {});
  };

  const createTenant = (name: string) => {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!clean) return;
    if (!tenants.includes(clean)) {
      setTenants((prev) => [...prev, clean].sort());
    }
    setTenant(clean);
  };

  useEffect(() => {
    refreshTenants();
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, setTenant, tenants, refreshTenants, createTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}

/**
 * Get headers with the current tenant. Use in all API calls.
 */
export function tenantHeaders(tenant: string): Record<string, string> {
  return { "X-Tenant-Id": tenant };
}
