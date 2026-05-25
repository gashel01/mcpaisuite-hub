export type SearchMode = "all" | "facts" | "documents" | "self_rag" | "react";
export type GraphMode = "2d" | "3d";
export type SideTab = "activity" | "facts" | "documents" | "health";
export type FactSort = "importance" | "retrievals" | "type" | "recent" | "decay";

export interface MemoryStats {
  total_facts: number;
  total_episodes: number;
  total_entities: number;
  top_tags: [string, number][];
  avg_decay?: number;
}

export interface SearchResult {
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SelfRagResult {
  answer: string;
  iterations: number;
  support_score: number;
  completeness_score: number;
  chunks_used: number;
}

export type IngestionStatus = "parsing" | "chunking" | "embedding" | "indexing" | "done" | "error";

export interface UploadEntry {
  id: string;
  name: string;
  size: number;
  status: IngestionStatus;
  error?: string;
  ts: number;
}

export interface SourceInfo {
  source: string;
  source_id?: string;
  chunks?: number;
  chunk_count?: number;
}

export interface UnifiedNode {
  id: string;
  name: string;
  type: string;
  category: "entity" | "fact" | "document";
  content?: string;
  importance?: number;
  tags?: string[];
  factType?: string;
}

export interface DocChunk {
  id?: string;
  content: string;
  source: string;
  score?: number;
}

export interface GraphNode extends UnifiedNode {
  color: string;
  val: number;
  x?: number;
  y?: number;
  __opacity: number;
  __selected: boolean;
  __focused?: boolean;
  __category: string;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// Extended Fact with full memory fields
export interface KnowledgeFact {
  id: string;
  content: string;
  importance: number;
  confidence: number;
  tags: string[];
  score?: number;
  fact_type?: string;
  retrieval_count?: number;
  decay_score?: number;
  confirmation_count?: number;
  created_at?: string;
  updated_at?: string;
  last_retrieved_at?: string;
  namespace?: string;
}

export interface ActivityItem {
  type: "upload" | "fact" | "graph";
  label: string;
  detail: string;
  time: number;
  color: string;
}

export const TYPE_COLORS: Record<string, string> = {
  Person: "#8b5cf6",
  Organization: "#3b82f6",
  Location: "#10b981",
  Event: "#f59e0b",
  Technology: "#06b6d4",
  Concept: "#a78bfa",
  Product: "#ec4899",
  Date: "#64748b",
  Fact: "#f472b6",
  Document: "#34d399",
};

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || "#a78bfa";
}
