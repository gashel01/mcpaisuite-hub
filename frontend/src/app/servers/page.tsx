"use client";

import { useEffect, useState } from "react";
import { Server, Wifi, WifiOff, AlertTriangle, ChevronDown, ChevronRight, Wrench, RefreshCw } from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

interface ServerData {
  name: string;
  connected: boolean;
  tools: number;
  tool_list?: string[];
}

const DESCRIPTIONS: Record<string, string> = {
  memorymcp: "Persistent fact storage with semantic recall, importance scoring, and tag-based filtering",
  planningmcp: "Task planning, LTP compiler, step graphs, ON_FAIL strategies, FOREACH loops",
  workspacemcp: "Sandboxed file system with tenant isolation, checkpoints, search, and move operations",
  sandboxmcp: "Docker code execution, web search (SearXNG), browser fetch (Playwright), host commands",
  schedulermcp: "Job scheduling: once, cron, interval, and watch (event-driven with conditions)",
  ragmcp: "Document ingestion, chunking, embedding (FastEmbed), and semantic search",
  kernelmcp: "Orchestration kernel: routes tools across all servers, ReAct/LTP engine, sub-agents",
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/servers`);
      if (!r.ok) return;
      const data = await r.json();
      const list: ServerData[] = Object.entries(data.servers || {}).map(
        ([name, info]: [string, unknown]) => {
          const i = info as { connected: boolean; tools: number; tool_names?: string[] };
          return { name, connected: i.connected, tools: i.tools, tool_list: i.tool_names };
        }
      );
      setServers(list.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (_e) { }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalTools = servers.reduce((sum, s) => sum + s.tools, 0);
  const connected = servers.filter(s => s.connected).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <Server className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">MCP Servers</h1>
            <p className="text-xs text-slate-500">{connected}/{servers.length} connected &middot; {totalTools} tools total</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs border border-slate-700/60 transition-colors">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="space-y-3">
        {servers.map(srv => {
          const isOpen = expanded[srv.name] || false;
          return (
            <div key={srv.name} className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(prev => ({ ...prev, [srv.name]: !prev[srv.name] }))}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-800/60 transition-colors"
              >
                {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                <Server className="h-4 w-4 text-violet-400" />
                <span className="font-medium text-sm text-slate-200">{srv.name}</span>
                <div className="flex-1" />
                <span className="text-xs text-slate-500 mr-3">{srv.tools} tools</span>
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  srv.connected
                    ? "bg-green-900/30 text-green-400 border border-green-800/40"
                    : "bg-slate-700/40 text-slate-500 border border-slate-600/40"
                }`}>
                  {srv.connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {srv.connected ? "connected" : "offline"}
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-700/40">
                  <p className="text-xs text-slate-400 mt-3 mb-3">{DESCRIPTIONS[srv.name] || "MCP server"}</p>
                  {srv.tool_list && srv.tool_list.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {srv.tool_list.map(tool => (
                        <span key={tool} className="flex items-center gap-1 bg-violet-950/30 text-violet-400 text-[11px] px-2 py-0.5 rounded-md border border-violet-800/30 font-mono">
                          <Wrench className="h-2.5 w-2.5" />{tool}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 italic">Tool list not available &mdash; expand the /servers endpoint to include tool names</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {servers.length === 0 && !loading && (
        <div className="text-center py-16">
          <AlertTriangle className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No servers found. Check that kernelmcp is running.</p>
        </div>
      )}
    </div>
  );
}
