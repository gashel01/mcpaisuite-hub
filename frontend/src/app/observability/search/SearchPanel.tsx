'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getApiUrl } from '@/lib/api-url';
import {
  Search, X, Clock, AlertCircle, Coins, Hash, Zap,
} from 'lucide-react';


// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchResult {
  task_id: string;
  goal: string;
  status: 'completed' | 'failed';
  total_cost: number;
  total_tokens: number;
  duration_ms: number;
  total_turns: number;
  turns: number;
  created_at: string;
}

interface SearchFilters {
  query?: string;
  status?: string[];
  cost_min?: number;
  latency_min_ms?: number;
  sort?: string;
  cursor?: string;
}

interface SearchPanelProps {
  onSelectTrace: (taskId: string) => void;
  namespace: string;
}

type QuickFilterId = 'failed' | 'expensive' | 'slow';

const QUICK_FILTERS: { id: QuickFilterId; label: string; color: string; activeColor: string; icon: React.ReactNode }[] = [
  { id: 'failed', label: 'Failed', color: 'border-rose-500/20 text-rose-400', activeColor: 'bg-rose-500/20 border-rose-500/40 text-rose-300', icon: <AlertCircle className="h-3 w-3" /> },
  { id: 'expensive', label: 'Expensive', color: 'border-emerald-500/20 text-emerald-400', activeColor: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300', icon: <Coins className="h-3 w-3" /> },
  { id: 'slow', label: 'Slow', color: 'border-amber-500/20 text-amber-400', activeColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300', icon: <Clock className="h-3 w-3" /> },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_expensive', label: 'Cost $$$' },
  { value: 'slowest', label: 'Slowest' },
];

// ── Main Component ────────────────────────────────────────────────────────────

export function SearchPanel({ onSelectTrace, namespace }: SearchPanelProps) {
  const API = getApiUrl();
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilterId>>(new Set());
  const [sort, setSort] = useState('newest');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const buildSearchParams = useCallback(
    (withCursor?: string): SearchFilters => {
      const filters: SearchFilters = { query: query || undefined, sort };
      if (activeFilters.has('failed')) filters.status = ['failed'];
      if (activeFilters.has('expensive')) filters.cost_min = 0.1;
      if (activeFilters.has('slow')) filters.latency_min_ms = 30000;
      if (withCursor) filters.cursor = withCursor;
      return filters;
    },
    [query, sort, activeFilters]
  );

  const fetchResults = useCallback(
    async (append = false) => {
      setLoading(true);
      try {
        const params = buildSearchParams(append && cursor ? cursor : undefined);
        const res = await fetch(`${API}/traces/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, namespace }),
        });
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        const items: SearchResult[] = data.results || data.traces || [];
        setResults(prev => append ? [...prev, ...items] : items);
        setTotalCount(data.total_count ?? data.total ?? items.length);
        setCursor(data.next_cursor || null);
        setHasMore(!!data.next_cursor);
      } catch {
        if (!append) { setResults([]); setTotalCount(0); }
      } finally {
        setLoading(false);
      }
    },
    [buildSearchParams, cursor, namespace]
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(false), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, sort, activeFilters]); // eslint-disable-line

  // Infinite scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasMore || loading) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) fetchResults(true);
  }, [hasMore, loading, fetchResults]);

  function toggleFilter(id: QuickFilterId) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-2 pt-2 pb-1.5 border-b border-white/[0.04] shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search traces..."
            className="w-full pl-7 pr-7 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-500 bg-white/[0.03] border border-white/[0.06] rounded-lg focus:outline-none focus:border-violet-500/40 transition-all"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Quick filters */}
        <div className="flex items-center gap-1 flex-wrap">
          {QUICK_FILTERS.map(qf => (
            <button
              key={qf.id}
              onClick={() => toggleFilter(qf.id)}
              className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
                activeFilters.has(qf.id) ? qf.activeColor : `${qf.color} bg-transparent`
              }`}
            >
              {qf.icon}
              {qf.label}
            </button>
          ))}
          {(activeFilters.size > 0 || query) && (
            <button onClick={() => { setActiveFilters(new Set()); setQuery(''); }} className="text-[8px] text-slate-500 hover:text-slate-300 ml-1">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.04] shrink-0">
        <span className="text-[9px] text-slate-500">
          {loading && results.length === 0 ? 'Searching...' : `${totalCount} results`}
        </span>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="text-[9px] text-slate-500 bg-transparent border-none focus:outline-none cursor-pointer"
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value} className="bg-[#14142a]">{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Results */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto min-h-0 p-1 space-y-0.5">
        {loading && results.length === 0 ? (
          <div className="flex justify-center py-8">
            <div className="h-4 w-4 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Search className="h-5 w-5 mx-auto text-slate-600 mb-1" />
            <p className="text-[10px]">No traces found</p>
          </div>
        ) : (
          results.map(r => (
            <button
              key={r.task_id}
              onClick={() => { setSelectedId(r.task_id); onSelectTrace(r.task_id); }}
              className={`w-full text-left rounded-lg border px-2 py-1.5 transition-all ${
                selectedId === r.task_id
                  ? 'bg-violet-500/5 border-violet-500/20'
                  : 'border-white/[0.04] hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${r.status === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <span className="text-[10px] text-slate-300 leading-tight line-clamp-2">{r.goal}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 ml-3 text-[8px] text-slate-500">
                <span>${(r.total_cost || 0).toFixed(3)}</span>
                <span># {((r.total_tokens || 0) / 1000).toFixed(1)}k</span>
                <span>{formatDuration(r.duration_ms || 0)}</span>
                <span>{r.total_turns || r.turns || 0}t</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!ms) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}
