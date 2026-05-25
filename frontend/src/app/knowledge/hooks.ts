"use client";

import { useState, useCallback, useRef } from "react";
import { BASE_URL } from "@/types";
import type {
  KnowledgeFact, MemoryStats, SourceInfo, UploadEntry,
  SearchResult, SelfRagResult, DocChunk, IngestionStatus,
} from "./types";

export interface GraphStatus {
  has_graph: boolean;
  stale: boolean;
  new_chunks: number;
  removed_chunks: number;
  total_processed: number;
  total_in_store: number;
  last_build_ts: string | null;
  total_entities: number;
  total_relations: number;
}

// ── useKnowledgeData — loads stats, facts, sources, graph ──────────────

export function useKnowledgeData(hdr: Record<string, string>) {
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [allFacts, setAllFacts] = useState<KnowledgeFact[]>([]);
  const [entityNodes, setEntityNodes] = useState<{ id: string; name: string; type: string }[]>([]);
  const [entityEdges, setEntityEdges] = useState<{ source: string; target: string; type: string }[]>([]);
  const [graphExtracting, setGraphExtracting] = useState(false);
  const [loading, setLoading] = useState(false);

  // Prevent concurrent loads
  const loadingRef = useRef(false);

  const loadStats = useCallback(async () => {
    const [mem, src] = await Promise.all([
      fetch(`${BASE_URL}/rag/memory/stats`, { headers: hdr }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE_URL}/rag/sources`).then(r => r.json()).catch(() => ({ sources: [] })),
    ]);
    if (mem) {
      const s = mem.output || mem;
      setMemoryStats({
        total_facts: s.fact_count ?? s.total_facts ?? 0,
        total_episodes: s.procedure_count ?? 0,
        total_entities: s.anchored_count ?? 0,
        top_tags: s.top_tags || [],
        avg_decay: s.avg_decay_score,
      });
    }
    setSources(src.sources || []);
  }, [hdr]);

  const loadAllFacts = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Use dedicated /memory/facts endpoint (lists all, no semantic filter)
      const r = await fetch(`${BASE_URL}/rag/memory/facts`, { headers: hdr });
      const d = await r.json();
      const output = d.output || d;
      let facts: KnowledgeFact[] = [];
      if (Array.isArray(output)) {
        facts = output;
      } else if (output && typeof output === "object") {
        facts = output.facts || output.results || [];
      }
      setAllFacts(facts);
    } catch { /* ignore */ }
    loadingRef.current = false;
  }, [hdr]);

  const loadGraph = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/rag/graph/data`, { headers: hdr });
      const d = await r.json();
      setEntityNodes(d.nodes || []);
      setEntityEdges(d.edges || []);
    } catch { /* ignore */ }
  }, [hdr]);

  const [extractProgress, setExtractProgress] = useState<{ chunk: number; total: number } | null>(null);
  const [graphStatus, setGraphStatus] = useState<GraphStatus | null>(null);

  const checkGraphStatus = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/rag/graph/status`, { headers: hdr });
      if (r.ok) setGraphStatus(await r.json());
    } catch { /* ignore */ }
  }, [hdr]);

  const extractGraph = useCallback(async (force = false) => {
    setGraphExtracting(true);
    setExtractProgress(null);
    try {
      const url = `${BASE_URL}/rag/graph/extract-all${force ? "?force=true" : ""}`;
      const r = await fetch(url, { method: "POST", headers: hdr });
      if (!r.ok) {
        console.error("Graph extract failed:", r.status, await r.text().catch(() => ""));
        throw new Error("Extract failed");
      }

      const contentType = r.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && r.body) {
        // Handle SSE stream
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "progress") {
                  setExtractProgress({ chunk: ev.chunk, total: ev.total });
                } else if (ev.type === "done") {
                  setExtractProgress(null);
                }
              } catch { /* skip malformed */ }
            }
          }
        }
      } else {
        // Non-streaming response (JSON fallback)
        // Some responses might come as plain JSON (e.g., old backend)
        await r.json().catch(() => null);
      }
      // Reload graph and status after extraction
      await Promise.all([loadGraph(), checkGraphStatus()]);
    } catch (err) {
      console.error("extractGraph error:", err);
    }
    setGraphExtracting(false);
    setExtractProgress(null);
  }, [hdr, loadGraph, checkGraphStatus]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStats(), loadAllFacts(), loadGraph(), checkGraphStatus()]);
    setLoading(false);
  }, [loadStats, loadAllFacts, loadGraph, checkGraphStatus]);

  const deleteFact = useCallback(async (id: string) => {
    try {
      await fetch(`${BASE_URL}/rag/memory/facts/${encodeURIComponent(id)}`, { method: "DELETE", headers: hdr });
      setAllFacts(prev => prev.filter(f => f.id !== id));
    } catch { /* ignore */ }
  }, [hdr]);

  const deleteSource = useCallback(async (source: string, sourceId?: string) => {
    // Use source_id for deletion if available (Qdrant uses source_ids internally)
    const deleteKey = sourceId || source;
    try {
      await fetch(`${BASE_URL}/rag/source?source=${encodeURIComponent(deleteKey)}`, { method: "DELETE", headers: hdr });
      setSources(prev => prev.filter(s => s.source !== source));
      loadStats();
    } catch { /* ignore */ }
  }, [hdr, loadStats]);

  return {
    memoryStats, sources, allFacts, entityNodes, entityEdges,
    graphExtracting, extractProgress, graphStatus, loading,
    loadStats, loadAllFacts, loadGraph, extractGraph, checkGraphStatus, loadAll,
    deleteFact, deleteSource, setSources,
  };
}

// ── useSearch ───────────────────────────────────────────────────────────

export function useSearch(hdr: Record<string, string>) {
  const [searching, setSearching] = useState(false);
  const [searchFacts, setSearchFacts] = useState<KnowledgeFact[]>([]);
  const [docResults, setDocResults] = useState<SearchResult[]>([]);
  const [selfRagResult, setSelfRagResult] = useState<SelfRagResult | null>(null);

  // Abort controller for cancelling stale searches
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (query: string, scope: "all" | "facts" | "documents" | "self_rag" | "react") => {
    if (!query.trim()) return;

    // Cancel previous search
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setSearchFacts([]);
    setDocResults([]);
    setSelfRagResult(null);

    // Advanced RAG modes — use /rag/ask endpoint
    if (scope === "self_rag" || scope === "react") {
      try {
        const res = await fetch(`${BASE_URL}/rag/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...hdr },
          body: JSON.stringify({ question: query.trim(), mode: scope === "self_rag" ? "self_rag" : "react" }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.answer) {
          setSelfRagResult({
            answer: data.answer,
            iterations: data.iterations || 0,
            support_score: data.confidence || 0,
            completeness_score: 0,
            chunks_used: data.facts_used || (data.sources?.length ?? 0),
          });
        }
        if (data.sources?.length) {
          setDocResults(data.sources.map((s: any) => ({ content: s.content || s, score: s.score || 0, metadata: {} })));
        }
      } catch { /* aborted or error */ }
      if (!controller.signal.aborted) setSearching(false);
      return;
    }

    // Standard modes: all / facts / documents
    const promises: Promise<void>[] = [];

    if (scope !== "documents") {
      promises.push(
        fetch(`${BASE_URL}/rag/memory/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...hdr },
          body: JSON.stringify({ topic: query.trim(), top_k: 10 }),
          signal: controller.signal,
        })
          .then(r => r.json())
          .then(d => {
            const o = d.output || d;
            setSearchFacts(Array.isArray(o) ? o : o.facts || []);
          })
          .catch(() => {})
      );
    }

    if (scope !== "facts") {
      promises.push(
        fetch(`${BASE_URL}/rag/search/advanced`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...hdr },
          body: JSON.stringify({ query: query.trim(), top_k: 10, mode: "self_rag" }),
          signal: controller.signal,
        })
          .then(r => r.json())
          .then(data => {
            if (data.output) {
              const out = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
              if (out.answer) setSelfRagResult(out);
              else setDocResults(Array.isArray(out) ? out : []);
            } else {
              setDocResults(data.results || []);
            }
          })
          .catch(() => {})
      );
    }

    await Promise.all(promises);
    if (!controller.signal.aborted) setSearching(false);
  }, [hdr]);

  const clearResults = useCallback(() => {
    setSearchFacts([]);
    setDocResults([]);
    setSelfRagResult(null);
  }, []);

  return { searching, searchFacts, docResults, selfRagResult, search, clearResults };
}

// ── useUpload — with pipeline progress ──────────────────────────────────

let uploadCounter = 0;

export function useUpload(hdr: Record<string, string>, onComplete: () => void) {
  const [uploads, setUploads] = useState<UploadEntry[]>([]);

  const uploadFile = useCallback(async (file: File) => {
    const id = `upload_${++uploadCounter}_${Date.now()}`;
    const entry: UploadEntry = { id, name: file.name, size: file.size, status: "parsing", ts: Date.now() };
    setUploads(prev => [entry, ...prev]);

    const updateStatus = (status: IngestionStatus) => {
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status } : u));
    };

    // Start actual upload immediately
    const uploadPromise = (async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_URL}/rag/upload`, { method: "POST", body: form, headers: hdr });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    })();

    // Simulate intermediate steps with timing
    const stepTimers = [
      setTimeout(() => updateStatus("chunking"), 600),
      setTimeout(() => updateStatus("embedding"), 1400),
      setTimeout(() => updateStatus("indexing"), 2200),
    ];

    try {
      await uploadPromise;
      stepTimers.forEach(clearTimeout);
      updateStatus("done");
      // Remove from list after 5s
      setTimeout(() => setUploads(prev => prev.filter(u => u.id !== id)), 5000);
      onComplete();
    } catch (err) {
      stepTimers.forEach(clearTimeout);
      setUploads(prev => prev.map(u => u.id === id ? { ...u, status: "error", error: String(err).slice(0, 80) } : u));
    }
  }, [hdr, onComplete]);

  const clearUploads = useCallback(() => {
    setUploads(prev => prev.filter(u => u.status !== "done" && u.status !== "error"));
  }, []);

  return { uploads, uploadFile, clearUploads };
}

// ── useChunks — lazy-loads chunks per source ────────────────────────────

export function useChunks(hdr: Record<string, string>) {
  const [sourceChunks, setSourceChunks] = useState<Record<string, DocChunk[]>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  // Use a ref to avoid stale closure on sourceChunks
  const chunksRef = useRef(sourceChunks);
  chunksRef.current = sourceChunks;

  const loadChunks = useCallback(async (source: string, sourceId?: string) => {
    // Use ref to check if already loaded (avoids stale closure)
    if (chunksRef.current[source] || loadingRef.current.has(source)) return;
    loadingRef.current.add(source);
    try {
      // Build query params — prefer source_id for exact match, fallback to source name
      const params = new URLSearchParams({ limit: "30" });
      if (sourceId) params.set("source_id", sourceId);
      else params.set("source", source);

      const r = await fetch(`${BASE_URL}/rag/chunks?${params}`, { headers: hdr });
      const d = await r.json();
      setSourceChunks(prev => ({ ...prev, [source]: d.chunks || [] }));
    } catch {
      setSourceChunks(prev => ({ ...prev, [source]: [] }));
    }
    loadingRef.current.delete(source);
  }, [hdr]);

  return { sourceChunks, loadChunks };
}
