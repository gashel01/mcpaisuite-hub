"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Brain, Search, Loader2, RefreshCw, Hash, Layers, Sparkles,
  BarChart3, Network, MessageSquare, Plus, Trash2, AlertCircle,
} from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { BASE_URL } from "@/types";
import FactCard from "@/components/fact-card";
import type { Fact } from "@/components/fact-card";

interface MemoryStats {
  total_facts: number;
  total_episodes: number;
  total_entities: number;
  top_tags: [string, number][];
}

export default function MemoryPage() {
  const { tenant } = useTenant();
  const router = useRouter();

  // State
  const [activeTab, setActiveTab] = useState<"facts" | "analytics" | "graph">("facts");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch memory stats ────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/memory/stats`, {
        headers: { ...tenantHeaders(tenant) },
      });
      if (res.ok) {
        setStats(await res.json());
      }
    } catch (_e) {
      // Stats endpoint may not exist yet
    }
    setStatsLoading(false);
  }, [tenant]);

  // ── Search facts ──────────────────────────────────────────────────────
  const searchFacts = useCallback(async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/memory/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...tenantHeaders(tenant),
        },
        body: JSON.stringify({ query: query.trim(), top_k: 20 }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setFacts(data.facts || data.results || []);
    } catch (e) {
      setError(String(e));
      setFacts([]);
    }
    setSearching(false);
  }, [query, searching, tenant]);

  // ── Load all facts ────────────────────────────────────────────────────
  const loadAllFacts = useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/memory/facts`, {
        headers: { ...tenantHeaders(tenant) },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setFacts(data.facts || data || []);
    } catch (e) {
      setError(String(e));
      setFacts([]);
    }
    setSearching(false);
  }, [tenant]);

  // ── Delete fact ───────────────────────────────────────────────────────
  const deleteFact = useCallback(async (id: string) => {
    try {
      await fetch(`${BASE_URL}/memory/facts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { ...tenantHeaders(tenant) },
      });
      setFacts((prev) => prev.filter((f) => f.id !== id));
    } catch (_e) {
      // silent
    }
  }, [tenant]);

  // ── Navigate to chat with pre-filled message ─────────────────────────
  const goToChat = (prefill: string) => {
    router.push(`/chat?prefill=${encodeURIComponent(prefill)}`);
  };

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <Brain className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Memory</h1>
            <p className="text-xs text-slate-500">
              Semantic fact store with importance scoring
            </p>
          </div>
        </div>
        <button
          onClick={() => { loadStats(); loadAllFacts(); }}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg text-xs border border-slate-700/60 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Hash}
          label="Facts"
          value={stats ? String(stats.total_facts) : "--"}
          color="text-violet-400"
        />
        <StatCard
          icon={Layers}
          label="Episodes"
          value={stats ? String(stats.total_episodes) : "--"}
          color="text-blue-400"
        />
        <StatCard
          icon={Network}
          label="Entities"
          value={stats ? String(stats.total_entities) : "--"}
          color="text-green-400"
        />
        <StatCard
          icon={Sparkles}
          label="Top Tag"
          value={stats?.top_tags?.[0]?.[0] || "--"}
          color="text-amber-400"
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <QuickAction
          label="Store a fact"
          icon={Plus}
          onClick={() => goToChat("Remember this fact: ")}
        />
        <QuickAction
          label="Query memory"
          icon={Search}
          onClick={() => goToChat("What do you remember about ")}
        />
        <QuickAction
          label="Memory summary"
          icon={BarChart3}
          onClick={() => goToChat("Give me a summary of everything in your memory")}
        />
        <QuickAction
          label="Open chat"
          icon={MessageSquare}
          onClick={() => router.push("/chat")}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700/50">
        {(["facts", "analytics", "graph"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab === "facts" && facts.length === 0) loadAllFacts();
            }}
            className={`px-4 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-violet-500 text-violet-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Facts tab ──────────────────────────────────────────────────── */}
      {activeTab === "facts" && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchFacts()}
              placeholder="Search facts by semantic query..."
              className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
            <button
              onClick={searchFacts}
              disabled={searching || !query.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 transition-colors"
            >
              {searching ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>
            <button
              onClick={loadAllFacts}
              disabled={searching}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-xl px-3 py-2.5 text-xs border border-slate-700/60 transition-colors"
              title="Load all facts"
            >
              All
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Results */}
          {facts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">{facts.length} facts</p>
              {facts.map((fact) => (
                <FactCard key={fact.id} fact={fact} onDelete={deleteFact} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {facts.length === 0 && !searching && !error && (
            <div className="text-center py-12">
              <Brain className="h-8 w-8 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No facts loaded</p>
              <p className="text-xs text-slate-600 mt-1">
                Search for facts or click &quot;All&quot; to load everything
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Analytics tab ──────────────────────────────────────────────── */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          {stats ? (
            <>
              {/* Tag distribution */}
              {stats.top_tags && stats.top_tags.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-sm font-medium text-slate-200 mb-3">Tag Distribution</h3>
                  <div className="space-y-2">
                    {stats.top_tags.map(([tag, count]) => {
                      const maxCount = stats.top_tags[0]?.[1] || 1;
                      const pct = Math.round((count / maxCount) * 100);
                      return (
                        <div key={tag} className="flex items-center gap-3">
                          <span className="text-xs text-slate-400 w-28 truncate">{tag}</span>
                          <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-violet-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-600 w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Summary stats */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                <h3 className="text-sm font-medium text-slate-200 mb-3">Summary</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-slate-500">Total facts:</span>{" "}
                    <span className="text-slate-200">{stats.total_facts}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Episodes:</span>{" "}
                    <span className="text-slate-200">{stats.total_episodes}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Entities:</span>{" "}
                    <span className="text-slate-200">{stats.total_entities}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Tags used:</span>{" "}
                    <span className="text-slate-200">{stats.top_tags?.length || 0}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <BarChart3 className="h-8 w-8 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                {statsLoading ? "Loading stats..." : "No analytics data available"}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Store some facts via the chat to see analytics
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Graph tab ──────────────────────────────────────────────────── */}
      {activeTab === "graph" && (
        <div className="text-center py-16">
          <Network className="h-10 w-10 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Knowledge Graph</p>
          <p className="text-xs text-slate-600 mt-1">
            Entity-relation graph visualization coming soon.
          </p>
          <p className="text-xs text-slate-600 mt-0.5">
            Use the{" "}
            <button
              onClick={() => goToChat("Show me the entities and relations in my memory")}
              className="text-violet-400 hover:text-violet-300 underline transition-colors"
            >
              chat interface
            </button>{" "}
            to explore memory relationships.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Reusable sub-components ───────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl px-3 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-semibold text-slate-200 truncate">{value}</p>
    </div>
  );
}

function QuickAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 hover:text-slate-100 border border-slate-700/40 hover:border-violet-600/30 px-3 py-1.5 rounded-lg text-xs transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
