"use client";

import { useEffect, useState } from "react";
import { Server, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { listServers, type ServerInfo } from "@/lib/api";

const FALLBACK_SERVERS: ServerInfo[] = [
  { name: "ragmcp", status: "disconnected", tool_count: 0 },
  { name: "memorymcp", status: "disconnected", tool_count: 0 },
  { name: "planningmcp", status: "disconnected", tool_count: 0 },
  { name: "workspacemcp", status: "disconnected", tool_count: 0 },
  { name: "sandboxmcp", status: "disconnected", tool_count: 0 },
];

const STATUS_META: Record<
  string,
  { icon: typeof Wifi; color: string; bg: string }
> = {
  connected: { icon: Wifi, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  disconnected: { icon: WifiOff, color: "text-[#9090a8]", bg: "bg-[#1e1e2a]" },
  error: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/20" },
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerInfo[]>(FALLBACK_SERVERS);

  useEffect(() => {
    listServers()
      .then(setServers)
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Connected Servers</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((srv) => {
          const meta = STATUS_META[srv.status] ?? STATUS_META.disconnected;
          const Icon = meta.icon;

          return (
            <div
              key={srv.name}
              className="rounded-xl border border-[#2a2a3a] bg-[#16161e] p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server size={18} className="text-violet-400" />
                  <span className="font-semibold">{srv.name}</span>
                </div>
                <span
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.color}`}
                >
                  <Icon size={12} />
                  {srv.status}
                </span>
              </div>

              <div className="text-sm text-[#9090a8]">
                {srv.tool_count} tool{srv.tool_count !== 1 ? "s" : ""} available
              </div>

              {srv.tools && srv.tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {srv.tools.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-[#1e1e2a] px-2 py-0.5 text-xs text-[#9090a8]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
