"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { Database, Upload, Search, FileText, Loader2, CheckCircle2, AlertCircle, Trash2, RefreshCw, Hash, HardDrive, Network, ChevronDown, ChevronRight, X, Zap, Brain, FlaskConical, BarChart3 } from "lucide-react";
import { useTenant, tenantHeaders } from "@/context/tenant";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

type SearchMode = "basic" | "self_rag" | "react";

interface SearchResult {
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface UploadEntry {
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

interface SourceInfo {
  source: string;
  chunks?: number;
  chunk_count?: number;
}

interface RAGStats {
  available: boolean;
  embedder?: string;
  vectorstore?: string;
  embedding_model?: string;
  total_chunks?: number;
  sources?: string[];
  source_stats?: SourceInfo[];
  graph_available?: boolean;
}

interface ChunkInfo {
  id: string;
  content: string;
  source: string;
}

export default function KnowledgePage() {
  const { tenant } = useTenant();
  const hdr = useMemo(() => tenantHeaders(tenant), [tenant]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("basic");
  const [selfRagResult, setSelfRagResult] = useState<{ answer: string; iterations: number; support_score: number; completeness_score: number; chunks_used: number } | null>(null);
  const [reactResult, setReactResult] = useState<{ answer: string; steps: { action: string; input: string; observation: string }[]; total_searches: number } | null>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [stats, setStats] = useState<RAGStats | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [showChunks, setShowChunks] = useState(false);
  const [chunkSource, setChunkSource] = useState("");
  const [activeTab, setActiveTab] = useState<"search" | "sources" | "chunks" | "graph" | "eval">("search");
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResults, setEvalResults] = useState<{ context_relevancy: number; context_precision: number; answer_relevancy: number; faithfulness: number; answer_correctness: number; samples: number } | null>(null);
  const [evalQuery, setEvalQuery] = useState("");
  const [evalAnswer, setEvalAnswer] = useState("");
  const [graphNodes, setGraphNodes] = useState<{ id: string; name: string; type: string }[]>([]);
  const [graphEdges, setGraphEdges] = useState<{ source: string; target: string; type: string }[]>([]);
  const [graphExtracting, setGraphExtracting] = useState(false);
  const [graphQuery, setGraphQuery] = useState("");
  const [graphQueryResults, setGraphQueryResults] = useState<{ entities: { id: string; name: string; type: string }[]; relations: { source: string; target: string; type: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load stats + sources — stable: only re-runs when tenant changes
  const tenantRef = useRef(tenant);
  tenantRef.current = tenant;

  const loadAll = useCallback(async () => {
    try {
      const [statsR, sourcesR] = await Promise.all([
        fetch(`${BASE_URL}/rag/stats`).then(r => r.json()).catch(() => null),
        fetch(`${BASE_URL}/rag/sources`).then(r => r.json()).catch(() => ({ sources: [] })),
      ]);
      if (statsR) setStats(statsR);
      setSources(sourcesR.sources || []);
    } catch (_e) { }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const uploadFile = useCallback(async (file: File) => {
    const entry: UploadEntry = { name: file.name, size: file.size, status: "uploading" };
    setUploads(prev => [entry, ...prev]);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE_URL}/rag/upload`, { method: "POST", body: form, headers: hdr });
      if (!res.ok) throw new Error(await res.text());
      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, status: "done" } : u));
      loadAll();
    } catch (err) {
      const errStr = String(err);
      let msg = errStr;
      if (errStr.includes("dimension error") || errStr.includes("expected dim")) {
        msg = "Vector dimension mismatch - change the embedding model in Settings or recreate the Qdrant collection.";
      }
      setUploads(prev => prev.map(u => u.name === file.name ? { ...u, status: "error", error: msg } : u));
    }
  }, [loadAll]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(uploadFile);
  }, [uploadFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach(uploadFile);
    if (fileRef.current) fileRef.current.value = "";
  }, [uploadFile]);

  const searchDocs = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSelfRagResult(null);
    setReactResult(null);
    try {
      const res = await fetch(`${BASE_URL}/rag/search/advanced`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdr },
        body: JSON.stringify({ query, top_k: 10, mode: searchMode }),
      });
      const data = await res.json();
      if (searchMode === "self_rag" && data.output) {
        const out = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
        setSelfRagResult(out);
        setResults([]);
      } else if (searchMode === "react" && data.output) {
        const out = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
        setReactResult(out);
        setResults([]);
      } else if (data.output) {
        const out = typeof data.output === "string" ? JSON.parse(data.output) : data.output;
        setResults(Array.isArray(out) ? out : data.results || []);
      } else {
        setResults(data.results || []);
      }
    } catch (_e) { setResults([]); }
    setSearching(false);
  };

  const runEval = async () => {
    if (evalRunning) return;
    setEvalRunning(true);
    try {
      const samples = evalQuery.trim()
        ? [{ query: evalQuery, answer: evalAnswer }]
        : [{ query: "What is this about?", answer: "" }];
      const res = await fetch(`${BASE_URL}/rag/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdr },
        body: JSON.stringify({ samples, top_k: 5 }),
      });
      const data = await res.json();
      const out = data.output ? (typeof data.output === "string" ? JSON.parse(data.output) : data.output) : data;
      setEvalResults(out);
    } catch (_e) { setEvalResults(null); }
    setEvalRunning(false);
  };

  const deleteSource = async (source: string) => {
    try {
      await fetch(`${BASE_URL}/rag/source?source=${encodeURIComponent(source)}`, { method: "DELETE", headers: hdr });
      setSources(prev => prev.filter(s => s.source !== source));
      loadAll();
    } catch (_e) { }
  };

  const loadChunks = async (source?: string) => {
    try {
      const q = source ? `?source=${encodeURIComponent(source)}&limit=50` : "?limit=50";
      const res = await fetch(`${BASE_URL}/rag/chunks${q}`, { headers: hdr });
      const data = await res.json();
      setChunks(data.chunks || []);
      setChunksTotal(data.total || 0);
      setChunkSource(source || "");
      setShowChunks(true);
      setActiveTab("chunks");
    } catch (_e) { }
  };

  const loadGraph = async () => {
    try {
      const res = await fetch(`${BASE_URL}/rag/graph/data`, { headers: hdr });
      const data = await res.json();
      setGraphNodes(data.nodes || []);
      setGraphEdges(data.edges || []);
    } catch (_e) { }
  };

  const extractGraph = async () => {
    setGraphExtracting(true);
    try {
      const res = await fetch(`${BASE_URL}/rag/graph/extract-all`, { method: "POST", headers: hdr });
      if (res.ok) await loadGraph();
    } catch (_e) { }
    setGraphExtracting(false);
  };

  const queryGraph = async () => {
    if (!graphQuery.trim()) return;
    try {
      const res = await fetch(`${BASE_URL}/rag/graph/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdr },
        body: JSON.stringify({ query: graphQuery, depth: 2 }),
      });
      if (res.ok) setGraphQueryResults(await res.json());
    } catch (_e) { }
  };

  const clearGraph = async () => {
    try {
      await fetch(`${BASE_URL}/rag/graph/clear`, { method: "DELETE", headers: hdr });
      setGraphNodes([]);
      setGraphEdges([]);
      setGraphQueryResults(null);
    } catch (_e) { }
  };

  const totalChunks = stats?.total_chunks ?? sources.reduce((sum, s) => sum + (s.chunks || s.chunk_count || 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
            <Database className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Knowledge Base</h1>
            <p className="text-xs text-slate-500">
              {stats?.available
                ? `${stats.embedding_model || stats.embedder} · ${stats.vectorstore}`
                : "RAG not connected"}
            </p>
          </div>
        </div>
        <button onClick={loadAll} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg text-xs border border-slate-700/60 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Stats cards */}
      {stats?.available && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Hash} label="Chunks" value={totalChunks != null ? String(totalChunks) : "--"} color="text-violet-400" />
          <StatCard icon={HardDrive} label="Sources" value={String(sources.length)} color="text-green-400" />
          <StatCard icon={Database} label="Embedder" value={stats.embedding_model?.split("/").pop() || stats.embedder || "--"} color="text-blue-400" />
          <StatCard icon={Network} label="Graph" value={graphNodes.length > 0 ? `${graphNodes.length} entities` : "Not built"} color={graphNodes.length > 0 ? "text-amber-400" : "text-slate-600"} />
        </div>
      )}

      {/* Infrastructure badges */}
      {stats?.available && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          <BackendBadge label="Vectorstore" active={stats.vectorstore?.replace("Store", "") || ""} options={["Qdrant", "Chroma", "PgVector", "Milvus", "Memory"]} />
          <BackendBadge label="Embedder" active={stats.embedder?.replace("Embedder", "") || ""} options={["FastEmbed", "LiteLLM", "Ollama", "SentenceTransformers"]} />
          <BackendBadge label="Graph" active={graphNodes.length > 0 ? "NetworkX" : ""} options={["NetworkX", "Neo4j"]} />
          <BackendBadge label="Cache" active="" options={["Memory", "Redis"]} />
          <BackendBadge label="Reranker" active="" options={["CrossEncoder", "Cohere", "Feedback"]} />
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${dragOver ? "border-violet-500 bg-violet-950/30" : "border-slate-700/50 hover:border-violet-700 hover:bg-slate-800/30"}`}
      >
        <Upload className={`h-6 w-6 mx-auto mb-2 ${dragOver ? "text-violet-400" : "text-slate-600"}`} />
        <p className="text-sm text-slate-400">Drop files or <span className="text-violet-400 underline">browse</span></p>
        <p className="text-[11px] text-slate-600 mt-0.5">PDF, DOCX, TXT, MD, HTML, CSV, JSON</p>
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.html,.csv,.json" onChange={handleFileSelect} className="hidden" />
      </div>

      {/* Upload history */}
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.map((u, i) => (
            <div key={i}>
              <div className="flex items-center gap-3 bg-slate-800/40 border border-slate-700/50 rounded-lg px-3 py-2">
                <FileText className="h-4 w-4 text-slate-500 shrink-0" />
                <span className="text-xs text-slate-300 flex-1 truncate">{u.name}</span>
                <span className="text-[10px] text-slate-600">{(u.size / 1024).toFixed(0)} KB</span>
                {u.status === "uploading" && <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />}
                {u.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                {u.status === "error" && <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
              </div>
              {u.status === "error" && u.error && (
                <p className="text-[11px] text-red-400/80 px-3 pt-1">{u.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700/50">
        {(["search", "sources", "chunks", "graph", "eval"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab === "chunks" && chunks.length === 0) loadChunks();
              if (tab === "graph" && graphNodes.length === 0) loadGraph();
            }}
            className={`px-4 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? "border-violet-500 text-violet-400" : "border-transparent text-slate-500 hover:text-slate-300"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Search tab ──────────────────────────────────────────────────── */}
      {activeTab === "search" && (
        <div className="space-y-4">
          {/* Search mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Mode:</span>
            {([
              { id: "basic" as SearchMode, label: "Basic", icon: Search, desc: "Vector similarity" },
              { id: "self_rag" as SearchMode, label: "Self-RAG", icon: Brain, desc: "Auto-critique + re-retrieve" },
              { id: "react" as SearchMode, label: "ReAct", icon: Zap, desc: "Multi-step reasoning" },
            ]).map(m => (
              <button
                key={m.id}
                onClick={() => setSearchMode(m.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  searchMode === m.id
                    ? "bg-violet-600/20 text-violet-300 border border-violet-600/40"
                    : "bg-slate-800/40 text-slate-500 border border-slate-700/30 hover:text-slate-300"
                }`}
                title={m.desc}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchDocs()}
              placeholder={searchMode === "react" ? "Ask a complex question..." : searchMode === "self_rag" ? "Ask a factual question..." : "Search your documents..."}
              className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
            <button onClick={searchDocs} disabled={searching || !query.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 transition-colors">
              {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            </button>
          </div>

          {/* Self-RAG result */}
          {selfRagResult && (
            <div className="bg-emerald-950/30 border border-emerald-700/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-medium text-emerald-300">Self-RAG Answer</span>
                <span className="text-[10px] text-slate-500 ml-auto">{selfRagResult.iterations} iteration(s) · {selfRagResult.chunks_used} chunks</span>
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{selfRagResult.answer}</p>
              <div className="flex gap-4">
                <div className="text-[10px]">
                  <span className="text-slate-500">Support: </span>
                  <span className={selfRagResult.support_score >= 7 ? "text-green-400" : selfRagResult.support_score >= 4 ? "text-amber-400" : "text-red-400"}>
                    {selfRagResult.support_score}/10
                  </span>
                </div>
                <div className="text-[10px]">
                  <span className="text-slate-500">Completeness: </span>
                  <span className={selfRagResult.completeness_score >= 7 ? "text-green-400" : selfRagResult.completeness_score >= 4 ? "text-amber-400" : "text-red-400"}>
                    {selfRagResult.completeness_score}/10
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ReAct result */}
          {reactResult && (
            <div className="bg-amber-950/30 border border-amber-700/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-medium text-amber-300">ReAct Answer</span>
                <span className="text-[10px] text-slate-500 ml-auto">{reactResult.total_searches} searches · {reactResult.steps.length} steps</span>
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{reactResult.answer}</p>
              <details className="text-[11px]">
                <summary className="text-slate-500 cursor-pointer hover:text-slate-300">Reasoning steps</summary>
                <div className="mt-2 space-y-1.5 pl-2 border-l border-slate-700/50">
                  {reactResult.steps.map((s, i) => (
                    <div key={i}>
                      <span className="text-violet-400">{s.action}</span>
                      <span className="text-slate-500"> → </span>
                      <span className="text-slate-400">{s.input}</span>
                      {s.observation && <p className="text-slate-600 pl-4 truncate">{s.observation}</p>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* Basic results */}
          {results.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">{results.length} results</p>
              {results.map((r, i) => (
                <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[11px] text-slate-500 font-mono truncate">
                      {r.metadata?.source ? String(r.metadata.source).split(/[/\\]/).pop() : `Result ${i + 1}`}
                    </span>
                    {r.score > 0 && (
                      <span className="text-[10px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded shrink-0">
                        {(r.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{r.content}</p>
                </div>
              ))}
            </div>
          )}
          {results.length === 0 && !selfRagResult && !reactResult && query && !searching && (
            <p className="text-sm text-slate-600 text-center py-8">No results found</p>
          )}
        </div>
      )}

      {/* ── Sources tab ─────────────────────────────────────────────────── */}
      {activeTab === "sources" && (
        <div className="space-y-2">
          {sources.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">No sources ingested yet</p>
          ) : (
            sources.map((s, i) => {
              const name = (s.source || "").split(/[/\\]/).pop() || s.source;
              const chunkCount = s.chunks || s.chunk_count || 0;
              return (
                <div key={i} className="flex items-center gap-3 bg-slate-800/40 border border-slate-700/50 rounded-xl px-4 py-3 group">
                  <FileText className="h-4 w-4 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{s.source}</p>
                  </div>
                  {chunkCount > 0 && (
                    <button onClick={() => loadChunks(s.source)} className="text-[10px] bg-slate-700/60 text-slate-400 hover:text-violet-400 px-2 py-0.5 rounded transition-colors">
                      {chunkCount} chunks
                    </button>
                  )}
                  <button
                    onClick={() => deleteSource(s.source)}
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-1 transition-all"
                    title="Delete source"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Chunks tab ──────────────────────────────────────────────────── */}
      {activeTab === "chunks" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {chunkSource ? `Chunks from: ${chunkSource.split(/[/\\]/).pop()}` : "All chunks"}
              {chunksTotal > 0 && ` (${chunksTotal} total)`}
            </p>
            {chunkSource && (
              <button onClick={() => loadChunks()} className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
                Show all
              </button>
            )}
          </div>
          {chunks.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">No chunks found</p>
          ) : (
            chunks.map((c, i) => (
              <div key={i} className="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-slate-600 font-mono">{c.id?.slice(0, 12)}...</span>
                  <span className="text-[10px] text-slate-500">{c.source?.split(/[/\\]/).pop()}</span>
                </div>
                <p className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed break-all overflow-hidden">{c.content}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Eval tab ────────────────────────────────────────────────────── */}
      {activeTab === "eval" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-slate-200">RAG Evaluation (RAGAS)</span>
          </div>
          <p className="text-xs text-slate-500">Evaluate retrieval quality with RAGAS metrics. Provide a test query and expected answer, or run with defaults.</p>

          <div className="space-y-2">
            <input
              value={evalQuery} onChange={e => setEvalQuery(e.target.value)}
              placeholder="Test query (e.g. 'What is the refund policy?')"
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
            <input
              value={evalAnswer} onChange={e => setEvalAnswer(e.target.value)}
              placeholder="Expected answer (optional)"
              className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
            <button
              onClick={runEval} disabled={evalRunning}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
            >
              {evalRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
              {evalRunning ? "Evaluating..." : "Run Evaluation"}
            </button>
          </div>

          {evalResults && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
              {[
                { label: "Context Relevancy", value: evalResults.context_relevancy, color: "violet" },
                { label: "Context Precision", value: evalResults.context_precision, color: "blue" },
                { label: "Answer Relevancy", value: evalResults.answer_relevancy, color: "emerald" },
                { label: "Faithfulness", value: evalResults.faithfulness, color: "amber" },
                { label: "Answer Correctness", value: evalResults.answer_correctness, color: "rose" },
              ].map(m => (
                <div key={m.label} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{m.label}</p>
                  <p className={`text-lg font-bold text-${m.color}-400`}>
                    {(m.value * 100).toFixed(0)}%
                  </p>
                  <div className="mt-1.5 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                    <div className={`h-full bg-${m.color}-500 rounded-full transition-all`} style={{ width: `${m.value * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!evalResults && !evalRunning && (
            <div className="text-center py-8">
              <FlaskConical className="h-8 w-8 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Run an evaluation to see retrieval quality metrics</p>
              <p className="text-xs text-slate-600 mt-1">Measures context relevancy, precision, faithfulness, and answer correctness</p>
            </div>
          )}
        </div>
      )}

      {/* ── Graph tab ───────────────────────────────────────────────────── */}
      {activeTab === "graph" && (
        <GraphTab
          nodes={graphNodes}
          edges={graphEdges}
          extracting={graphExtracting}
          onExtract={extractGraph}
          onClear={clearGraph}
          graphQuery={graphQuery}
          setGraphQuery={setGraphQuery}
          onQueryGraph={queryGraph}
          queryResults={graphQueryResults}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }) {
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

function BackendBadge({ label, active, options }: { label: string; active: string; options: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-600 uppercase tracking-wide">{label}:</span>
      <div className="flex gap-1">
        {options.map(opt => {
          const isActive = active.toLowerCase() === opt.toLowerCase();
          return (
            <span
              key={opt}
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                isActive
                  ? "bg-violet-600/30 text-violet-300 border border-violet-700/40"
                  : "bg-slate-800/30 text-slate-600 border border-slate-700/20"
              }`}
            >
              {opt}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Color palette for entity types ─────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Person: "#8b5cf6",
  Organization: "#3b82f6",
  Location: "#10b981",
  Event: "#f59e0b",
  Technology: "#06b6d4",
  Concept: "#a78bfa",
  Product: "#ec4899",
  Date: "#64748b",
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || "#a78bfa";
}

// ── Graph tab component ────────────────────────────────────────────────────

function GraphTab({
  nodes, edges, extracting, onExtract, onClear,
  graphQuery, setGraphQuery, onQueryGraph, queryResults,
}: {
  nodes: { id: string; name: string; type: string }[];
  edges: { source: string; target: string; type: string }[];
  extracting: boolean;
  onExtract: () => void;
  onClear: () => void;
  graphQuery: string;
  setGraphQuery: (v: string) => void;
  onQueryGraph: () => void;
  queryResults: { entities: { id: string; name: string; type: string }[]; relations: { source: string; target: string; type: string }[] } | null;
}) {
  const graphData = useMemo(() => ({
    nodes: nodes.map(n => ({ ...n, color: getTypeColor(n.type), val: 1 })),
    links: edges.map(e => ({ source: e.source, target: e.target, type: e.type })),
  }), [nodes, edges]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect;
      setDimensions({ width, height: Math.max(400, Math.min(600, width * 0.6)) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Collect unique types for legend
  const types = useMemo(() => {
    const set = new Set(nodes.map(n => n.type));
    return Array.from(set).sort();
  }, [nodes]);

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onExtract}
          disabled={extracting}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        >
          {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
          {extracting ? "Extracting..." : "Build Graph"}
        </button>
        {nodes.length > 0 && (
          <button onClick={onClear} className="text-xs text-slate-500 hover:text-red-400 px-2 py-1.5 transition-colors">
            Clear
          </button>
        )}
        <span className="text-[11px] text-slate-500 ml-auto">
          {nodes.length} entities &middot; {edges.length} relations
        </span>
      </div>

      {/* 3D Graph visualization */}
      {nodes.length > 0 && (
        <div ref={containerRef} className="bg-[#080810] border border-slate-700/50 rounded-xl overflow-hidden">
          <ForceGraph3D
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeLabel={(n: any) => `${n.name} (${n.type})`}
            nodeColor={(n: any) => n.color || "#a78bfa"}
            nodeRelSize={5}
            nodeOpacity={0.9}
            linkColor={() => "rgba(139, 92, 246, 0.3)"}
            linkWidth={1}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            linkLabel={(l: any) => l.type}
            backgroundColor="#080810"
            showNavInfo={false}
          />
          {/* Legend */}
          {types.length > 1 && (
            <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-slate-800/60">
              {types.map(t => (
                <span key={t} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getTypeColor(t) }} />
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Graph query */}
      <div className="flex gap-2">
        <input
          value={graphQuery} onChange={e => setGraphQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onQueryGraph()}
          placeholder="Query the knowledge graph..."
          className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
        />
        <button onClick={onQueryGraph} disabled={!graphQuery.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 transition-colors">
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Query results */}
      {queryResults && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-2">
          <p className="text-xs text-slate-400">{queryResults.entities.length} entities, {queryResults.relations.length} relations</p>
          {queryResults.entities.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getTypeColor(e.type) }} />
              <span className="text-[10px] text-slate-500">{e.type}</span>
              <span className="text-sm text-slate-200">{e.name}</span>
            </div>
          ))}
          {queryResults.relations.map((r, i) => {
            const srcName = queryResults.entities.find(e => e.id === r.source)?.name || r.source;
            const tgtName = queryResults.entities.find(e => e.id === r.target)?.name || r.target;
            return (
              <div key={i} className="text-xs text-slate-400 pl-4">
                {srcName} <span className="text-violet-500">--[{r.type}]--&gt;</span> {tgtName}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && !extracting && (
        <div className="text-center py-12">
          <Network className="h-8 w-8 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No graph data yet</p>
          <p className="text-xs text-slate-600 mt-1">Click &quot;Build Graph&quot; to extract entities from your ingested documents</p>
        </div>
      )}
    </div>
  );
}
