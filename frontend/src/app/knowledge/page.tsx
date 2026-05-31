"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Upload, Brain, Network, Sparkles, Loader2, MessageSquare,
  PanelRightOpen, PanelRightClose, Activity, FileText, Lightbulb,
} from "lucide-react";
import Link from "next/link";
import { useTenant, tenantHeaders } from "@/context/tenant";
import { BASE_URL } from "@/types";
import type { SearchMode, GraphMode, SideTab, UnifiedNode, GraphData, GraphNode, GraphLink } from "./types";
import { getTypeColor } from "./types";
import { useKnowledgeData, useSearch, useUpload, useChunks } from "./hooks";
import { TopLeftHUD, TopRightHUD, FocusModeIndicator, GraphBuildProgress, NodeDetail, SearchResults, FactPanel, DocumentPanel, IngestionStepper, AddFactDialog, GapDetector, CoverageHeatmap } from "./components";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function KnowledgePage() {
  const { tenant } = useTenant();
  const hdr = useMemo(() => tenantHeaders(tenant), [tenant]);

  // ── Data hooks ────────────────────────────────────────────────────────

  const data = useKnowledgeData(hdr);
  const searchHook = useSearch(hdr);
  const uploadHook = useUpload(hdr, () => { data.loadStats(); data.loadAllFacts(); data.checkGraphStatus(); });
  const chunksHook = useChunks(hdr);

  // ── UI state ──────────────────────────────────────────────────────────

  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchMode>("all");
  const [showSearchResults, setShowSearchResults] = useState(false);

  const [graphMode, setGraphMode] = useState<GraphMode>("2d");
  const [graphSearch, setGraphSearch] = useState("");
  const [graphFilter, setGraphFilter] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(true);
  const [showDocs, setShowDocs] = useState(true);
  const [showEntities, setShowEntities] = useState(true);

  const [selectedNode, setSelectedNode] = useState<UnifiedNode | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [focusDepth, setFocusDepth] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<any>(null);

  // Brain editor state
  const [showAddFact, setShowAddFact] = useState(false);
  const [coverageEnabled, setCoverageEnabled] = useState(false);

  const [sideTab, setSideTab] = useState<SideTab>("activity");
  const [sideOpen, setSideOpen] = useState(true);

  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [graphDim, setGraphDim] = useState({ width: 800, height: 600 });

  // ── Init ──────────────────────────────────────────────────────────────

  useEffect(() => { data.loadAll(); }, []); // eslint-disable-line

  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setGraphDim({ width: Math.floor(width), height: Math.floor(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [sideOpen]);

  // ── Search handler ────────────────────────────────────────────────────

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    setShowSearchResults(true);
    searchHook.search(query, searchScope);
  }, [query, searchScope, searchHook]);

  // ── Drag & drop ───────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(uploadHook.uploadFile);
  }, [uploadHook]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach(uploadHook.uploadFile);
    if (fileRef.current) fileRef.current.value = "";
  }, [uploadHook]);

  // ── Focus mode ────────────────────────────────────────────────────────

  const handleNodeFocus = useCallback((node: any) => {
    setFocusedNode(prev => prev === node.id ? null : node.id);
    if (graphRef.current && node.x !== undefined) {
      if (graphMode === "2d") {
        graphRef.current.centerAt(node.x, node.y, 600);
        graphRef.current.zoom(3, 600);
      } else if (graphRef.current.cameraPosition) {
        graphRef.current.cameraPosition({ x: node.x, y: node.y, z: 200 }, node, 600);
      }
    }
  }, [graphMode]);

  // ── Insights ──────────────────────────────────────────────────────────

  const insights = useMemo(() => {
    const msgs: string[] = [];
    const { allFacts, entityNodes } = data;
    if (allFacts.length > 0 && entityNodes.length === 0) msgs.push("Build graph to find connections");
    if (data.memoryStats?.avg_decay && data.memoryStats.avg_decay < 0.3) msgs.push("Knowledge aging — add fresh data");
    const typeCounts: Record<string, number> = {};
    entityNodes.forEach(n => { typeCounts[n.type] = (typeCounts[n.type] || 0) + 1; });
    const sorted = Object.entries(typeCounts).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) msgs.push(`Strongest: ${sorted[0][0]} (${sorted[0][1]})`);
    const orphanCount = allFacts.filter(f => {
      const words = f.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      return !entityNodes.some(e => words.some(w => e.name.toLowerCase().includes(w)));
    }).length;
    if (orphanCount > 3) msgs.push(`${orphanCount} isolated facts`);
    return msgs;
  }, [data.allFacts, data.entityNodes, data.memoryStats]);

  // ── Unified graph data ────────────────────────────────────────────────

  const { unifiedData, allTypes } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const searchLower = graphSearch.toLowerCase();
    const { allFacts, entityNodes, entityEdges, sources } = data;

    if (showEntities) {
      for (const n of entityNodes) {
        if (graphFilter && n.type !== graphFilter) continue;
        nodes.push({ ...n, category: "entity", color: getTypeColor(n.type), val: 2, __opacity: 1, __selected: false, __category: "entity" });
      }
      for (const e of entityEdges) {
        if (nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target)) links.push({ ...e });
      }
    }

    if (showFacts && allFacts.length > 0) {
      for (const fact of allFacts) {
        const factId = `fact_${fact.id}`;
        if (graphFilter && graphFilter !== "Fact") continue;
        nodes.push({
          id: factId, name: fact.content.slice(0, 35) + (fact.content.length > 35 ? "..." : ""),
          type: "Fact", category: "fact", content: fact.content, importance: fact.importance,
          tags: fact.tags, factType: fact.fact_type,
          color: "#f472b6", val: 0.8 + (fact.importance || 0.5) * 1.2,
          __opacity: 1, __selected: false, __category: "fact",
        });
        const words = fact.content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        for (const entity of entityNodes) {
          const ew = entity.name.toLowerCase().split(/\W+/);
          if (words.some(w => ew.some(e => e.includes(w) || w.includes(e)))) {
            links.push({ source: factId, target: entity.id, type: "mentions" });
          }
        }
      }
    }

    if (showDocs && sources.length > 0) {
      for (const src of sources) {
        const docId = `doc_${src.source}`;
        if (graphFilter && graphFilter !== "Document") continue;
        const name = (src.source || "").split(/[/\\]/).pop() || src.source;
        nodes.push({
          id: docId, name, type: "Document", category: "document",
          color: "#34d399", val: Math.min(3, 1.5 + (src.chunks || src.chunk_count || 0) * 0.05),
          __opacity: 1, __selected: false, __category: "document",
        });
        // Link docs to entities — only to entities whose name appears in the source name (not ALL entities)
        const srcLower = (src.source || "").toLowerCase();
        for (const entity of entityNodes) {
          const eName = entity.name.toLowerCase();
          if (eName.length > 3 && srcLower.includes(eName)) {
            links.push({ source: docId, target: entity.id, type: "contains" });
          }
        }
        // If no specific matches, link to max 3 closest entities (by name similarity)
        const docLinks = links.filter(l => l.source === docId);
        if (docLinks.length === 0 && entityNodes.length > 0) {
          const sample = entityNodes.slice(0, Math.min(3, entityNodes.length));
          for (const entity of sample) {
            links.push({ source: docId, target: entity.id, type: "contains" });
          }
        }
      }
    }

    // Apply visibility: focus > search > selection
    for (const n of nodes) {
      const cc = links.filter(l => l.source === n.id || l.target === n.id).length;
      n.val = Math.min(5, n.val + Math.min(cc * 0.15, 2));
    }

    return { unifiedData: { nodes, links } as GraphData, allTypes: [...new Set(nodes.map(n => n.type))].sort() };
  }, [data.entityNodes, data.entityEdges, data.allFacts, data.sources, showFacts, showDocs, showEntities, graphFilter, graphSearch]);

  // ── Focus visibility (computed separately to avoid graph re-render) ────
  const focusSet = useMemo(() => {
    if (!focusedNode || !unifiedData.links.length) return null;
    const depthMap = new Map<string, number>();
    depthMap.set(focusedNode, 0);
    let frontier = new Set([focusedNode]);
    for (let depth = 1; depth <= focusDepth; depth++) {
      const next = new Set<string>();
      for (const nodeId of frontier) {
        for (const l of unifiedData.links) {
          const src = typeof l.source === "string" ? l.source : (l.source as any)?.id;
          const tgt = typeof l.target === "string" ? l.target : (l.target as any)?.id;
          if (src === nodeId && !depthMap.has(tgt)) { depthMap.set(tgt, depth); next.add(tgt); }
          if (tgt === nodeId && !depthMap.has(src)) { depthMap.set(src, depth); next.add(src); }
        }
      }
      frontier = next;
    }
    return depthMap;
  }, [focusedNode, focusDepth, unifiedData.links]);

  // Compute node opacity dynamically (used in render callbacks, NOT in graphData)
  const getNodeOpacity = useCallback((node: any): number => {
    const id = node.id;
    if (focusedNode) {
      if (id === focusedNode) return 1;
      const depth = focusSet?.get(id);
      if (depth !== undefined) return Math.max(0.3, 1 - depth * 0.25);
      return 0.03;
    }
    const searchLower = graphSearch.toLowerCase();
    if (searchLower) {
      const matches = node.name?.toLowerCase().includes(searchLower) || (node.content || "").toLowerCase().includes(searchLower);
      if (!matches) return 0.05;
    }
    if (selectedNode && id !== selectedNode.id) {
      const isNeighbor = unifiedData.links.some(l => {
        const src = typeof l.source === "string" ? l.source : (l.source as any)?.id;
        const tgt = typeof l.target === "string" ? l.target : (l.target as any)?.id;
        return (src === selectedNode.id && tgt === id) || (tgt === selectedNode.id && src === id);
      });
      if (!isNeighbor) return 0.08;
    }
    return 1;
  }, [focusedNode, focusSet, graphSearch, selectedNode, unifiedData.links]);

  const getLinkOpacity = useCallback((link: any): number => {
    if (!focusedNode) return 1;
    const src = typeof link.source === "string" ? link.source : link.source?.id;
    const tgt = typeof link.target === "string" ? link.target : link.target?.id;
    const srcIn = focusSet?.has(src);
    const tgtIn = focusSet?.has(tgt);
    if (srcIn && tgtIn) return 0.6;
    return 0.02;
  }, [focusedNode, focusSet]);

  // ── Node interactions ─────────────────────────────────────────────────

  const handleNodeClick = useCallback((node: any) => {
    // Click toggles focus mode on the node (isolate + connections)
    setSelectedNode({
      id: node.id, name: node.name, type: node.type,
      category: node.category || node.__category,
      content: node.content, importance: node.importance,
      tags: node.tags, factType: node.factType,
    });
    // Toggle focus: click same node again to unfocus
    setFocusedNode(prev => prev === node.id ? null : node.id);
    if (graphRef.current && node.x !== undefined && focusedNode !== node.id) {
      if (graphMode === "2d") {
        graphRef.current.centerAt(node.x, node.y, 600);
        graphRef.current.zoom(3, 600);
      } else if (graphRef.current.cameraPosition) {
        graphRef.current.cameraPosition({ x: node.x, y: node.y, z: 200 }, node, 600);
      }
    }
  }, [focusedNode, graphMode]);

  const handleNodeRightClick = useCallback((node: any) => {
    // Right-click unfocuses (exits focus mode)
    setFocusedNode(null);
    setSelectedNode(null);
  }, []);

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node || null);
  }, []);

  const handleSidebarSelect = useCallback((node: UnifiedNode) => {
    setSelectedNode(node);
    setFocusedNode(node.id);
    // Find the actual graph node to get x/y for centering
    const graphNode = unifiedData.nodes.find((n: any) => n.id === node.id);
    if (graphRef.current && graphNode && (graphNode as any).x !== undefined) {
      if (graphMode === "2d") {
        graphRef.current.centerAt((graphNode as any).x, (graphNode as any).y, 600);
        graphRef.current.zoom(3, 600);
      } else if (graphRef.current.cameraPosition) {
        graphRef.current.cameraPosition({ x: (graphNode as any).x, y: (graphNode as any).y, z: 200 }, graphNode, 600);
      }
    }
  }, [unifiedData.nodes, graphMode]);

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return unifiedData.links.filter(l =>
      l.source === selectedNode.id || l.target === selectedNode.id ||
      (l.source as any)?.id === selectedNode.id || (l.target as any)?.id === selectedNode.id
    );
  }, [selectedNode, unifiedData.links]);

  // ── Derived state ─────────────────────────────────────────────────────

  const totalFacts = data.memoryStats?.total_facts ?? data.allFacts.length;
  const totalSources = data.sources.length;
  const totalNodes = unifiedData.nodes.length;
  const isEmpty = totalFacts === 0 && totalSources === 0 && data.entityNodes.length === 0;
  const activeUploads = uploadHook.uploads.filter(u => u.status !== "done" && u.status !== "error");

  // Activity feed
  const activityFeed = useMemo(() => {
    const items: { type: string; label: string; detail: string; time: number; color: string }[] = [];
    for (const u of uploadHook.uploads.slice(0, 8)) {
      items.push({ type: "upload", label: u.name, detail: u.status === "done" ? "ingested" : u.status === "error" ? u.error || "failed" : `${u.status}...`, time: u.ts, color: u.status === "done" ? "#34d399" : u.status === "error" ? "#f87171" : "#a78bfa" });
    }
    for (const f of data.allFacts.slice(0, 12)) {
      items.push({ type: "fact", label: f.content.slice(0, 60), detail: `${f.fact_type || "fact"}${f.retrieval_count ? ` · ${f.retrieval_count} hits` : ""}`, time: 0, color: "#f472b6" });
    }
    return items;
  }, [uploadHook.uploads, data.allFacts]);

  // Contextual suggestion (uses graph staleness)
  const contextualSuggestion = useMemo(() => {
    if (isEmpty) return null;
    const gs = data.graphStatus;
    if (gs && gs.stale && gs.has_graph) {
      const newCount = gs.new_chunks;
      return { text: `Graph is stale — ${newCount} new chunk${newCount > 1 ? "s" : ""} since last build.`, action: "Update Graph" };
    }
    if (data.sources.length > 0 && data.entityNodes.length === 0) return { text: "Documents ingested! Build the graph to discover connections.", action: "Build Graph" };
    if (data.allFacts.length > 5 && data.sources.length === 0) return { text: "Facts building up. Upload docs to create richer connections.", action: "Upload" };
    return null;
  }, [isEmpty, data.sources.length, data.entityNodes.length, data.allFacts.length, data.graphStatus]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col relative -m-4 md:-m-5"
      style={{ height: "calc(100vh - 1rem)" }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.html,.csv,.json" onChange={handleFileSelect} className="hidden" />

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-violet-950/60  flex items-center justify-center animate-fade-in">
          <div className="text-center">
            <div className="h-20 w-20 rounded-3xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center mx-auto mb-4 animate-bounce">
              <Upload className="h-8 w-8 text-violet-400" />
            </div>
            <p className="text-lg font-medium text-violet-300">Drop files to feed the brain</p>
            <p className="text-xs text-slate-500 mt-1">PDF, DOCX, TXT, MD, HTML, CSV, JSON</p>
          </div>
        </div>
      )}

      {/* ── Main layout ──────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex">

        {/* ── Graph area ────────────────────────────────────────────── */}
        <div ref={graphContainerRef} className="flex-1 min-h-0 min-w-0 bg-[#040410] relative overflow-hidden">
          {/* Ambient grid */}
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: "radial-gradient(circle, #8b5cf6 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

          {/* Graph build progress */}
          {data.extractProgress && <GraphBuildProgress progress={data.extractProgress} />}

          {/* HUD: Top left */}
          <TopLeftHUD
            query={query} setQuery={setQuery}
            searchScope={searchScope} setSearchScope={setSearchScope}
            searching={searchHook.searching} onSearch={handleSearch}
            totalFacts={totalFacts} totalSources={totalSources} totalNodes={totalNodes}
            showEntities={showEntities} showFacts={showFacts} showDocs={showDocs}
            onToggleEntities={() => setShowEntities(v => !v)}
            onToggleFacts={() => setShowFacts(v => !v)}
            onToggleDocs={() => setShowDocs(v => !v)}
            stats={data.memoryStats} entityCount={data.entityNodes.length} insights={insights}
            activeUploads={activeUploads}
          />

          {/* HUD: Top right */}
          <TopRightHUD
            graphSearch={graphSearch} setGraphSearch={setGraphSearch}
            graphMode={graphMode} setGraphMode={setGraphMode}
            graphExtracting={data.graphExtracting} extractProgress={data.extractProgress}
            graphStatus={data.graphStatus}
            onExtractGraph={() => data.extractGraph(false)}
            onUploadClick={() => fileRef.current?.click()} onRefresh={data.loadAll}
            sideOpen={sideOpen}
          />

          {/* Focus indicator */}
          {focusedNode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-black/70  border border-violet-500/30 rounded-2xl">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-[10px] text-violet-300 font-medium">Focus Mode</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500">Depth</span>
                <input
                  type="range" min={1} max={5} value={focusDepth}
                  onChange={e => setFocusDepth(parseInt(e.target.value))}
                  className="w-16 h-1 accent-violet-500 cursor-pointer"
                />
                <span className="text-[10px] text-violet-300 font-bold w-3">{focusDepth}</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <span className="text-[8px] text-slate-600">Click node to focus · Right-click to exit</span>
              <button onClick={() => { setFocusedNode(null); setSelectedNode(null); }} className="text-slate-500 hover:text-white transition-colors ml-1">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          )}

          {/* Hover tooltip */}
          {hoveredNode && !focusedNode && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 bg-black/80  border border-white/[0.1] rounded-xl shadow-2xl max-w-md pointer-events-none">
              <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: hoveredNode.color || "#a78bfa" }} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-white font-semibold truncate">{hoveredNode.name}</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-slate-400 shrink-0">{hoveredNode.type}</span>
                </div>
                {hoveredNode.content && (
                  <p className="text-[9px] text-slate-500 mt-0.5 line-clamp-2">{hoveredNode.content.slice(0, 150)}</p>
                )}
              </div>
              <span className="text-[9px] text-slate-600 shrink-0">Click to focus</span>
            </div>
          )}

          {/* Coverage heatmap toggle */}
          <CoverageHeatmap enabled={coverageEnabled} onToggle={() => setCoverageEnabled(!coverageEnabled)} />

          {/* Add Fact dialog */}
          <AddFactDialog open={showAddFact} onClose={() => setShowAddFact(false)} onAdded={() => { setShowAddFact(false); data.loadAll(); }} />

          {/* Type legend */}
          {allTypes.length > 1 && (
            <div className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-1 bg-black/50  border border-white/[0.08] rounded-xl px-2 py-1.5 max-w-80">
              <button onClick={() => setGraphFilter(null)} className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${!graphFilter ? "bg-white/[0.08] text-slate-300" : "text-slate-600 hover:text-slate-400"}`}>All</button>
              {allTypes.map(t => (
                <button key={t} onClick={() => setGraphFilter(graphFilter === t ? null : t)} className={`flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${graphFilter === t ? "bg-white/[0.08] text-slate-300" : "text-slate-600 hover:text-slate-400"}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getTypeColor(t) }} />{t}
                </button>
              ))}
            </div>
          )}

          {/* Contextual suggestion */}
          {contextualSuggestion && !selectedNode && (
            <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 px-3 py-2 bg-black/60  border border-amber-500/20 rounded-xl max-w-xs animate-fade-in" style={{ right: sideOpen ? "calc(340px + 12px)" : "12px" }}>
              <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-[10px] text-amber-200/80">{contextualSuggestion.text}</span>
              <button
                onClick={() => {
                  if (contextualSuggestion.action === "Upload") fileRef.current?.click();
                  else if (contextualSuggestion.action === "Update Graph") data.extractGraph(false); // incremental
                  else data.extractGraph(false); // Build Graph — also incremental (first time builds all)
                }}
                className="shrink-0 text-[9px] font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 px-2 py-1 rounded-lg transition-all"
              >
                {contextualSuggestion.action}
              </button>
            </div>
          )}

          {/* Selected node detail */}
          {selectedNode && (
            <NodeDetail
              node={selectedNode}
              edges={selectedNodeEdges}
              allNodes={unifiedData.nodes}
              onClose={() => setSelectedNode(null)}
              onSearch={(q) => { setQuery(q); handleSearch(); }}
              onFocus={() => handleNodeFocus({ id: selectedNode.id, x: 0, y: 0 })}
              onNodeClick={handleNodeClick}
            />
          )}

          {/* Graph renderer */}
          {totalNodes > 0 ? (
            graphMode === "2d" ? (
              <ForceGraph2D
                ref={graphRef} width={graphDim.width} height={graphDim.height}
                graphData={unifiedData}
                nodeLabel={() => ""}
                nodeRelSize={2}
                nodeCanvasObjectMode={() => "replace"}
                nodeCanvasObject={(node: any, ctx: any, gs: number) => {
                  const op = getNodeOpacity(node);
                  if (op < 0.04) return; // Skip invisible nodes entirely
                  const r = Math.sqrt(node.val || 1) * 2;
                  const isFocusTarget = node.id === focusedNode;
                  const isSel = node.id === selectedNode?.id;

                  // Draw node circle
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                  ctx.globalAlpha = op;
                  ctx.fillStyle = node.color || "#a78bfa";
                  ctx.fill();

                  // Glow ring for focused/selected nodes
                  if (isFocusTarget || isSel) {
                    ctx.strokeStyle = node.color || "#a78bfa";
                    ctx.lineWidth = 0.8 / gs;
                    ctx.shadowColor = node.color;
                    ctx.shadowBlur = 12;
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                  }

                  // Label — only when zoomed in or for important nodes
                  const fontSize = Math.max(10 / gs, 1.5);
                  const isImportant = isFocusTarget || isSel || node.val > 3;
                  if (op > 0.2 && (isImportant || gs > 0.8) && !(gs < 1.5 && fontSize < 2.5 && !isImportant)) {
                    ctx.font = `${isImportant ? "bold " : ""}${fontSize}px Inter, system-ui, sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.globalAlpha = isImportant ? op : Math.min(op, 0.6);
                    ctx.fillStyle = isImportant ? "#fff" : `rgba(226,232,240,${op * 0.7})`;
                    const label = node.name.length > 24 ? node.name.slice(0, 22) + "…" : node.name;
                    ctx.fillText(label, node.x, node.y + r + fontSize * 0.6);
                  }
                  ctx.globalAlpha = 1;
                }}
                linkColor={(l: any) => {
                  const op = getLinkOpacity(l);
                  if (op < 0.05) return "rgba(0,0,0,0)";
                  const base = l.type === "mentions" ? [244,114,182] : l.type === "contains" ? [52,211,153] : [139,92,246];
                  return `rgba(${base.join(",")},${(op * 0.15).toFixed(2)})`;
                }}
                linkWidth={(l: any) => getLinkOpacity(l) < 0.05 ? 0 : 0.5}
                backgroundColor="rgba(0,0,0,0)"
                onNodeClick={handleNodeClick}
                onNodeRightClick={handleNodeRightClick}
                onNodeHover={handleNodeHover}
                cooldownTicks={150}
                d3AlphaDecay={0.035}
                d3VelocityDecay={0.4}
                warmupTicks={80}
                enableNodeDrag={true}
                minZoom={0.3}
                maxZoom={8}
              />
            ) : (
              <ForceGraph3D
                ref={graphRef} width={graphDim.width} height={graphDim.height}
                graphData={unifiedData}
                nodeLabel={(n: any) => {
                  const op = getNodeOpacity(n);
                  if (op < 0.1) return "";
                  return n.content ? `${n.name}\n${n.content.slice(0, 80)}` : `${n.name} (${n.type})`;
                }}
                nodeColor={(n: any) => {
                  const op = getNodeOpacity(n);
                  const hex = n.color || "#a78bfa";
                  // Convert hex to rgba with opacity
                  const r = parseInt(hex.slice(1, 3), 16);
                  const g = parseInt(hex.slice(3, 5), 16);
                  const b = parseInt(hex.slice(5, 7), 16);
                  return `rgba(${r},${g},${b},${op})`;
                }}
                nodeRelSize={2}
                nodeOpacity={1}
                nodeVisibility={(n: any) => getNodeOpacity(n) > 0.03}
                linkColor={(l: any) => {
                  const op = getLinkOpacity(l);
                  if (op < 0.05) return "rgba(0,0,0,0)";
                  const base = l.type === "mentions" ? [244,114,182] : l.type === "contains" ? [52,211,153] : [139,92,246];
                  return `rgba(${base.join(",")},${(op * 0.15).toFixed(2)})`;
                }}
                linkWidth={(l: any) => getLinkOpacity(l) < 0.05 ? 0 : 0.3}
                linkVisibility={(l: any) => getLinkOpacity(l) > 0.03}
                backgroundColor="#040410"
                showNavInfo={false}
                onNodeClick={handleNodeClick}
                onNodeRightClick={handleNodeRightClick}
                onNodeHover={handleNodeHover}
                cooldownTicks={150}
                warmupTicks={80}
              />
            )
          ) : isEmpty ? (
            /* Empty state */
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-6 max-w-md">
                <div className="relative w-40 h-40 mx-auto">
                  {[0, 4, 8, 12].map((inset, i) => (
                    <div key={i} className="absolute rounded-full border animate-pulse" style={{ inset: `${inset * 4}px`, borderColor: `rgba(139,92,246,${0.06 + i * 0.04})`, animationDelay: `${i * 0.4}s`, animationDuration: "3s" }} />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center"><Brain className="h-14 w-14 text-violet-500/20" /></div>
                  <div className="absolute top-4 right-6 h-2 w-2 rounded-full bg-violet-500/40 animate-ping" style={{ animationDuration: "3s" }} />
                  <div className="absolute bottom-6 left-4 h-1.5 w-1.5 rounded-full bg-pink-500/40 animate-ping" style={{ animationDuration: "4s", animationDelay: "1s" }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-200">The brain is empty</h2>
                  <p className="text-xs text-slate-500 mt-2">Upload documents or chat to start building knowledge.</p>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl text-xs font-medium transition-all shadow-xl shadow-violet-500/25 active:scale-95">
                    <Upload className="h-4 w-4" /> Upload
                  </button>
                  <Link href="/chat" className="flex items-center gap-2 px-5 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-slate-300 rounded-2xl text-xs font-medium transition-all">
                    <MessageSquare className="h-4 w-4" /> Chat
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            /* Has data but no graph yet */
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4">
                <Network className="h-10 w-10 text-slate-800 mx-auto" />
                <p className="text-xs text-slate-500">Click &ldquo;Build&rdquo; to extract entities &amp; discover connections</p>
                <button onClick={() => data.extractGraph(false)} disabled={data.graphExtracting} className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-2xl text-xs font-medium shadow-xl shadow-violet-500/25 active:scale-95 transition-all">
                  {data.graphExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Build Graph
                </button>
              </div>
            </div>
          )}

          {/* Sidebar toggle (when closed) */}
          {!sideOpen && (
            <button onClick={() => setSideOpen(true)} className="absolute top-3 right-3 z-20 p-2 bg-black/50  border border-white/[0.08] rounded-xl text-slate-500 hover:text-slate-300 transition-all">
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────── */}
        {sideOpen && (
          <div className="w-[340px] shrink-0 bg-[#08080f] border-l border-white/[0.04] flex flex-col min-h-0">
            {/* Tabs */}
            <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04]">
              {([
                { id: "activity" as SideTab, icon: Activity, label: "Activity" },
                { id: "facts" as SideTab, icon: Brain, label: `Facts (${data.allFacts.length})` },
                { id: "documents" as SideTab, icon: FileText, label: `Docs (${totalSources})` },
                { id: "health" as SideTab, icon: Sparkles, label: "Health" },
              ]).map(t => (
                <button key={t.id} onClick={() => setSideTab(t.id)}
                  className={`flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded-lg transition-all ${sideTab === t.id ? "bg-violet-500/15 text-violet-300" : "text-slate-600 hover:text-slate-400"}`}>
                  <t.icon className="h-2.5 w-2.5" />{t.label}
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={() => setSideOpen(false)} className="text-slate-700 hover:text-slate-400 transition-colors p-0.5">
                <PanelRightClose className="h-3 w-3" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {/* Search results (overlay) */}
              {showSearchResults && (
                <SearchResults
                  query={query}
                  searching={searchHook.searching}
                  facts={searchHook.searchFacts}
                  docResults={searchHook.docResults}
                  selfRagResult={searchHook.selfRagResult}
                  onClose={() => setShowSearchResults(false)}
                  onSelectFact={(node) => setSelectedNode(node)}
                />
              )}

              {/* Activity */}
              {sideTab === "activity" && (
                <div className="p-3 space-y-1 flex-1">
                  {activeUploads.length > 0 && (
                    <div className="mb-3 space-y-2">
                      <p className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Processing</p>
                      {activeUploads.map(u => <IngestionStepper key={u.id} entry={u} />)}
                    </div>
                  )}
                  {activityFeed.length === 0 && <p className="text-[10px] text-slate-600 text-center py-8">No activity yet.</p>}
                  {activityFeed.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 py-1.5 border-b border-white/[0.02] last:border-0 hover:bg-white/[0.01] rounded-lg px-1 transition-colors">
                      <div className="h-5 w-5 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: item.color + "15" }}>
                        {item.type === "upload" ? <FileText className="h-2.5 w-2.5" style={{ color: item.color }} /> : <Brain className="h-2.5 w-2.5" style={{ color: item.color }} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-slate-300 truncate">{item.label}</p>
                        <p className="text-[8px] text-slate-600">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Facts */}
              {sideTab === "facts" && (
                <FactPanel
                  facts={data.allFacts}
                  onDelete={data.deleteFact}
                  onSelect={handleSidebarSelect}
                />
              )}

              {/* Documents */}
              {sideTab === "documents" && (
                <DocumentPanel
                  sources={data.sources}
                  sourceChunks={chunksHook.sourceChunks}
                  onUploadClick={() => fileRef.current?.click()}
                  onLoadChunks={(source, sourceId) => chunksHook.loadChunks(source, sourceId)}
                  onDeleteSource={data.deleteSource}
                  onSelectNode={handleSidebarSelect}
                />
              )}

              {sideTab === "health" && (
                <div className="flex flex-col h-full">
                  <GapDetector onNavigateToNode={(nodeId) => {
                    const node = unifiedData.nodes.find((n: any) => n.name === nodeId || n.id === nodeId);
                    if (node) handleSidebarSelect(node);
                  }} />
                  <div className="shrink-0 p-3 border-t border-white/[0.04]">
                    <button
                      onClick={() => setShowAddFact(true)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-[10px] font-medium transition-all active:scale-95"
                    >
                      <Brain className="h-3 w-3" /> Add Fact Manually
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
