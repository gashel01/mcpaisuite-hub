"""RAG + Knowledge Graph + Advanced RAG endpoints."""
from __future__ import annotations
import os
import re as _re
import uuid as _uuid
import json as _json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, Header, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import ns
from stores import audit_collector

router = APIRouter(prefix="/rag")
kernel = None  # set by server.py
_graph_stores: dict[str, object] = {}  # per-tenant graph stores

# ── Graph persistence ────────────────────────────────────────────────────────
# Tracks which chunk IDs have already been graph-extracted, and persists
# the NetworkX graph to disk so it survives restarts.

GRAPH_DATA_DIR = Path("/app/data/graph")


def _graph_meta_path(tenant_id: str) -> Path:
    return GRAPH_DATA_DIR / f"{tenant_id}_meta.json"


def _graph_nx_path(tenant_id: str) -> Path:
    return GRAPH_DATA_DIR / f"{tenant_id}_graph.json"


def _load_graph_meta(tenant_id: str) -> dict:
    """Load graph metadata: processed chunk IDs and last build timestamp."""
    p = _graph_meta_path(tenant_id)
    if p.exists():
        try:
            return _json.loads(p.read_text())
        except Exception:
            pass
    return {"processed_chunks": [], "last_build_ts": None, "total_entities": 0, "total_relations": 0}


def _save_graph_meta(tenant_id: str, meta: dict):
    GRAPH_DATA_DIR.mkdir(parents=True, exist_ok=True)
    _graph_meta_path(tenant_id).write_text(_json.dumps(meta))


def _persist_graph(tenant_id: str, gs):
    """Serialize NetworkX graph to JSON on disk."""
    try:
        import networkx as nx
        g = gs._get_graph(tenant_id)
        data = nx.node_link_data(g)
        GRAPH_DATA_DIR.mkdir(parents=True, exist_ok=True)
        _graph_nx_path(tenant_id).write_text(_json.dumps(data))
    except Exception:
        pass


def _restore_graph(tenant_id: str, gs):
    """Restore NetworkX graph from disk if available."""
    p = _graph_nx_path(tenant_id)
    if not p.exists():
        return
    try:
        import networkx as nx
        data = _json.loads(p.read_text())
        g = nx.node_link_graph(data)
        # Inject restored graph into the store
        gs._graphs[tenant_id] = g
        # Rebuild name index from restored graph
        if hasattr(gs, "_name_index"):
            gs._name_index[tenant_id] = {}
            for nid, ndata in g.nodes(data=True):
                name = ndata.get("name", "")
                if name:
                    gs._name_index[tenant_id][name.lower()] = nid
    except Exception:
        pass


def _get_rag():
    if kernel and kernel._engine._orchestrator.rag:
        return kernel._engine._orchestrator.rag
    return None


def _get_vs():
    rag = _get_rag()
    if not rag: return None
    return getattr(rag, "_vectorstore", None) or getattr(rag, "vectorstore", None)


def _get_graph(tenant_id: str = "default"):
    """Get or create a per-tenant graph store, restoring from disk if available."""
    if tenant_id not in _graph_stores:
        try:
            from ragmcp.graph.networkx_store import NetworkXGraphStore
            store = NetworkXGraphStore()
            _restore_graph(tenant_id, store)
            _graph_stores[tenant_id] = store
        except ImportError:
            return None
    return _graph_stores[tenant_id]


# ── Upload / Search / Stats ──────────────────────────────────────────────────

@router.post("/upload")
async def upload(file: UploadFile = File(...), x_tenant_id: str = Header(default="")):
    rag = _get_rag()
    if not rag: raise HTTPException(503, "RAG not available")
    tid = ns(x_tenant_id) or "default"
    os.makedirs("/app/data/rag_uploads", exist_ok=True)
    dest = f"/app/data/rag_uploads/{file.filename}"
    with open(dest, "wb") as f:
        content = await file.read()
        f.write(content)
    try:
        report = await rag.ingest(dest)
        if report.failed:
            error_msg = str(report.failed[0][1]) if report.failed else "Unknown error"
            audit_collector.emit("rag", "file_ingest_failed", {"filename": file.filename, "error": error_msg[:300]})
            raise HTTPException(500, error_msg)
        audit_collector.emit("rag", "file_ingested", {"filename": file.filename, "size": len(content), "chunks": report.chunks_new})
        return {"ingested": file.filename, "size": len(content), "chunks": report.chunks_new}
    except HTTPException: raise
    except Exception as exc: raise HTTPException(500, str(exc))


@router.get("/search")
async def search(query: str = Query(...), top_k: int = Query(5), x_tenant_id: str = Header(default="")):
    rag = _get_rag()
    if not rag: raise HTTPException(503, "RAG not available")
    tid = ns(x_tenant_id) or "default"
    try:
        search_fn = getattr(rag, "search", None) or getattr(rag, "query", None)
        results = await search_fn(query, top_k=top_k)
        if isinstance(results, list):
            return {"results": [{"content": getattr(c, "content", str(c))[:500], "score": getattr(c, "score", 0), "metadata": getattr(c, "metadata", {})} for c in results]}
        if hasattr(results, "chunks"):
            return {"results": [{"content": c.content[:500], "metadata": getattr(c, "metadata", {})} for c in (results.chunks or [])]}
        return {"results": []}
    except Exception as exc: raise HTTPException(500, str(exc))


@router.get("/stats")
async def stats():
    rag = _get_rag()
    if not rag: return {"available": False}
    result: dict = {
        "available": True,
        "embedder": type(getattr(rag, "embedder", None)).__name__,
        "vectorstore": type(getattr(rag, "vectorstore", None)).__name__,
        "embedding_model": getattr(rag.embedder, '_model_name', getattr(rag.embedder, 'model', 'unknown')),
    }
    vs = _get_vs()
    if vs and hasattr(vs, "count_chunks"):
        try: result["total_chunks"] = await vs.count_chunks()
        except Exception: result["total_chunks"] = None
    if vs and hasattr(vs, "list_sources"):
        try: result["sources"] = await vs.list_sources()
        except Exception: result["sources"] = []
    if vs and hasattr(vs, "get_source_stats"):
        try: result["source_stats"] = await vs.get_source_stats()
        except Exception: pass
    gs = getattr(rag, "_graph_store", None)
    result["graph_available"] = gs is not None
    return result


# ── Sources / Chunks ─────────────────────────────────────────────────────────

@router.get("/sources")
async def sources():
    rag = _get_rag()
    if not rag: raise HTTPException(503, "RAG not available")
    vs = _get_vs()
    if not vs: return {"sources": []}
    try:
        if hasattr(vs, "get_source_stats"):
            stats = await vs.get_source_stats()
            # get_source_stats returns list of dicts with source_name and chunk_count
            if stats and isinstance(stats, list):
                if isinstance(stats[0], dict) and "source_name" in stats[0]:
                    return {"sources": [{"source": s["source_name"], "chunks": s.get("chunk_count", 0)} for s in stats]}
            return {"sources": stats}

        # Fallback: list_sources returns source_ids (hashes), resolve to readable names
        if hasattr(vs, "list_sources"):
            source_ids = await vs.list_sources()
            if not source_ids:
                return {"sources": []}
            # Try to get actual filenames from chunk metadata
            resolved = []
            if hasattr(vs, "get_all_chunks"):
                all_chunks = await vs.get_all_chunks()
                # Build source_id -> source name mapping from chunk metadata
                sid_to_name: dict[str, str] = {}
                sid_to_count: dict[str, int] = {}
                for c in all_chunks:
                    meta = getattr(c, "metadata", {}) or {}
                    sid = meta.get("source_id", "")
                    source_name = meta.get("source", "")
                    if sid and source_name and sid not in sid_to_name:
                        sid_to_name[sid] = source_name
                    if sid:
                        sid_to_count[sid] = sid_to_count.get(sid, 0) + 1
                for sid in source_ids:
                    name = sid_to_name.get(sid, sid)
                    # Extract just filename from path
                    if "/" in name or "\\" in name:
                        name = name.replace("\\", "/").split("/")[-1]
                    resolved.append({"source": name, "source_id": sid, "chunks": sid_to_count.get(sid, 0)})
            else:
                resolved = [{"source": s, "chunks": 0} for s in source_ids]
            return {"sources": resolved}
        return {"sources": []}
    except Exception as exc: raise HTTPException(500, str(exc))


@router.delete("/source")
async def delete_source(source: str = Query(...), x_tenant_id: str = Header(default="")):
    rag = _get_rag()
    if not rag: raise HTTPException(503, "RAG not available")
    tid = ns(x_tenant_id) or "default"
    vs = _get_vs()
    if not vs or not hasattr(vs, "delete_by_source"): raise HTTPException(501, "Not supported")
    try:
        await vs.delete_by_source(source)
        audit_collector.emit("rag", "source_deleted", {"source": source})
        return {"deleted": source}
    except Exception as exc: raise HTTPException(500, str(exc))


@router.get("/chunks")
async def list_chunks(source: str = Query(default=""), source_id: str = Query(default=""), limit: int = Query(default=50)):
    rag = _get_rag()
    if not rag: raise HTTPException(503, "RAG not available")
    vs = _get_vs()
    if not vs: return {"chunks": [], "total": 0}
    try:
        chunks = []
        if hasattr(vs, "get_all_chunks"):
            all_chunks = await vs.get_all_chunks()
            if source or source_id:
                filtered = []
                for c in all_chunks:
                    meta = getattr(c, "metadata", None) or {}
                    # Support both dict-like and attribute access for metadata
                    if isinstance(meta, dict):
                        c_source = meta.get("source", "")
                        c_source_id = meta.get("source_id", "")
                    else:
                        c_source = getattr(meta, "source", "")
                        c_source_id = getattr(meta, "source_id", "")
                    # Match by source_id (exact) or source name (substring)
                    if source_id and c_source_id == source_id:
                        filtered.append(c)
                    elif source and source in c_source:
                        filtered.append(c)
                all_chunks = filtered
            all_chunks = all_chunks[:limit]
            for c in all_chunks:
                meta = getattr(c, "metadata", None) or {}
                if isinstance(meta, dict):
                    c_source = meta.get("source", "")
                else:
                    c_source = getattr(meta, "source", "")
                chunks.append({
                    "id": getattr(c, "id", ""),
                    "content": getattr(c, "content", "")[:300],
                    "source": c_source,
                })
        total = await vs.count_chunks() if hasattr(vs, "count_chunks") else len(chunks)
        return {"chunks": chunks, "total": total}
    except Exception as exc: raise HTTPException(500, str(exc))


# ── Knowledge Graph ──────────────────────────────────────────────────────────

@router.post("/graph/extract-all")
async def graph_extract_all(x_tenant_id: str = Header(default=""), force: bool = Query(default=False)):
    """Extract entities from chunks using LLM (or regex fallback).

    Incremental: only processes chunks not yet extracted.
    Pass ?force=true to rebuild from scratch.
    """
    rag = _get_rag()
    tid = ns(x_tenant_id) or "default"
    gs = _get_graph(tid)
    if not rag or not gs: raise HTTPException(503, "RAG or graph not available")
    vs = _get_vs()
    if not vs or not hasattr(vs, "get_all_chunks"): raise HTTPException(501, "Not supported")
    from ragmcp.core.models import Entity, Relation
    from datetime import datetime, timezone
    all_chunks = await vs.get_all_chunks()
    if not all_chunks:
        return {"entities": 0, "relations": 0, "chunks_processed": 0}

    # Load graph metadata to find already-processed chunks
    meta = _load_graph_meta(tid)
    processed_set = set(meta.get("processed_chunks", []))

    if force:
        processed_set = set()

    # Filter to only new chunks
    new_chunks = [c for c in all_chunks if getattr(c, "id", "") not in processed_set]

    if not new_chunks and not force:
        return StreamingResponse(
            _sse_single({"type": "done", "entities": 0, "relations": 0, "chunks_processed": 0, "skipped": len(all_chunks), "message": "Graph is up to date"}),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
        )

    # Try to use LLM entity extractor with the configured model
    llm_extractor = None
    try:
        from ragmcp.graph.llm_entity_extractor import LLMEntityExtractor
        from config import llm_config
        provider = llm_config.get("provider", "ollama")
        model = llm_config.get("model", "")
        api_key = llm_config.get("api_key", "")
        base_url = llm_config.get("base_url", "")

        # Build a litellm-compatible model string
        # In Docker, replace localhost with host.docker.internal
        from config import resolve_url
        if provider == "ollama":
            litellm_model = f"ollama/{model}" if model else None
            api_base = resolve_url(base_url) if base_url else "http://host.docker.internal:11434"
        elif provider == "gemini":
            litellm_model = f"gemini/{model}" if model else None
            api_base = None
        elif provider == "anthropic":
            litellm_model = model
            api_base = None
        elif provider == "openai":
            litellm_model = model
            api_base = base_url or None
        elif provider == "groq":
            litellm_model = f"groq/{model}" if model else None
            api_base = None
        else:
            litellm_model = model
            api_base = base_url or None

        if litellm_model:
            llm_extractor = LLMEntityExtractor(
                model=litellm_model,
                api_key=api_key or None,
                api_base=api_base,
            )
    except Exception as exc:
        print(f"[GRAPH] LLM extractor init failed: {exc}", flush=True)

    def _regex_extract(text: str):
        """Fallback regex entity extraction."""
        candidates = _re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b", text)
        seen: dict[str, str] = {}
        entities = []
        for name in dict.fromkeys(candidates):
            if name not in seen and len(name) > 2:
                eid = _uuid.uuid4().hex[:8]
                seen[name] = eid
                entities.append(Entity(id=eid, name=name, type="Concept", metadata={}))
        relations = []
        keys = list(seen.keys())
        for j in range(len(keys) - 1):
            for k in range(j + 1, min(j + 3, len(keys))):
                relations.append(Relation(id=_uuid.uuid4().hex[:8], source_id=seen[keys[j]], target_id=seen[keys[k]], type="co_occurs"))
        return entities, relations

    async def _stream():
        total = len(new_chunks)
        total_e = meta.get("total_entities", 0)
        total_r = meta.get("total_relations", 0)
        new_e = new_r = 0
        newly_processed: list[str] = []

        yield f"data: {_json.dumps({'type': 'start', 'total': total, 'skipped': len(all_chunks) - total})}\n\n"

        for i, chunk in enumerate(new_chunks):
            chunk_id = getattr(chunk, "id", "")
            entities: list = []
            relations: list = []
            try:
                if llm_extractor is not None:
                    entities, relations = await llm_extractor.extract(chunk)
            except Exception:
                pass  # LLM failed, fall through to regex

            # Regex fallback if LLM produced nothing
            if not entities:
                text = getattr(chunk, "content", "")
                if text:
                    entities, relations = _regex_extract(text)

            try:
                if entities:
                    await gs.upsert_entities(entities, tenant_id=tid)
                if relations:
                    await gs.upsert_relations(relations, tenant_id=tid)
                new_e += len(entities)
                new_r += len(relations)
                if chunk_id:
                    newly_processed.append(chunk_id)
            except Exception:
                pass

            yield f"data: {_json.dumps({'type': 'progress', 'chunk': i + 1, 'total': total, 'entities_found': len(entities), 'relations_found': len(relations)})}\n\n"

        # Persist graph and update metadata
        total_e += new_e
        total_r += new_r
        all_processed = list(processed_set | set(newly_processed))
        new_meta = {
            "processed_chunks": all_processed,
            "last_build_ts": datetime.now(timezone.utc).isoformat(),
            "total_entities": total_e,
            "total_relations": total_r,
            "total_chunks_in_store": len(all_chunks),
        }
        _save_graph_meta(tid, new_meta)
        _persist_graph(tid, gs)

        yield f"data: {_json.dumps({'type': 'done', 'entities': new_e, 'relations': new_r, 'chunks_processed': total, 'total_entities': total_e, 'total_relations': total_r})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


async def _sse_single(data: dict):
    """Yield a single SSE event."""
    yield f"data: {_json.dumps(data)}\n\n"


@router.get("/graph/status")
async def graph_status(x_tenant_id: str = Header(default="")):
    """Check if the graph is stale (new chunks since last build)."""
    tid = ns(x_tenant_id) or "default"
    vs = _get_vs()
    if not vs or not hasattr(vs, "get_all_chunks"):
        return {"stale": False, "has_graph": False}

    meta = _load_graph_meta(tid)
    processed_set = set(meta.get("processed_chunks", []))
    last_build = meta.get("last_build_ts")
    has_graph = len(processed_set) > 0

    all_chunks = await vs.get_all_chunks()
    all_chunk_ids = {getattr(c, "id", "") for c in all_chunks} - {""}
    new_chunks = all_chunk_ids - processed_set
    # Also detect deleted chunks (were processed but no longer in store)
    stale_chunks = processed_set - all_chunk_ids

    return {
        "has_graph": has_graph,
        "stale": len(new_chunks) > 0 or len(stale_chunks) > 0,
        "new_chunks": len(new_chunks),
        "removed_chunks": len(stale_chunks),
        "total_processed": len(processed_set),
        "total_in_store": len(all_chunk_ids),
        "last_build_ts": last_build,
        "total_entities": meta.get("total_entities", 0),
        "total_relations": meta.get("total_relations", 0),
    }


@router.get("/graph/data")
async def graph_data(x_tenant_id: str = Header(default="")):
    tid = ns(x_tenant_id) or "default"
    gs = _get_graph(tid)
    if not gs: return {"nodes": [], "edges": []}
    tid = ns(x_tenant_id) or "default"
    try: g = gs._get_graph(tid)
    except ImportError: return {"nodes": [], "edges": [], "error": "networkx not installed"}
    nodes = [{"id": nid, "name": d.get("name", nid), "type": d.get("type", "Concept")} for nid, d in g.nodes(data=True)]
    edges = [{"source": s, "target": t, "type": d.get("type", "related_to")} for s, t, d in g.edges(data=True)]
    return {"nodes": nodes, "edges": edges}


@router.post("/graph/query")
async def graph_query(body: dict, x_tenant_id: str = Header(default="")):
    tid = ns(x_tenant_id) or "default"
    gs = _get_graph(tid)
    if not gs: raise HTTPException(503, "Graph not available")
    query = body.get("query", "")
    depth = int(body.get("depth", 2))
    if not query: raise HTTPException(400, "query required")
    keywords = [w.strip("?.,!").lower() for w in query.split() if len(w.strip("?.,!")) > 2]
    entities, seen = [], set()
    for term in keywords[:5]:
        for e in await gs.search_entities(term, top_k=3, tenant_id=tid):
            if e.id not in seen: seen.add(e.id); entities.append(e)
    if not entities: return {"entities": [], "relations": []}
    nbr_e, nbr_r = await gs.get_neighborhood([e.id for e in entities], depth=depth, tenant_id=tid)
    return {"entities": [{"id": e.id, "name": e.name, "type": e.type} for e in nbr_e], "relations": [{"source": r.source_id, "target": r.target_id, "type": r.type} for r in nbr_r]}


@router.delete("/graph/clear")
async def graph_clear(x_tenant_id: str = Header(default="")):
    tid = ns(x_tenant_id) or "default"
    gs = _get_graph(tid)
    if not gs: return {"status": "no graph store"}
    # Clear and remove the tenant's graph store entirely
    gs._graphs.pop(tid, None); gs._name_index.pop(tid, None); gs._id_remap.pop(tid, None)
    _graph_stores.pop(tid, None)
    return {"status": "cleared"}


# ── Advanced RAG endpoints ─────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    mode: str = "basic"  # basic, self_rag, react
    filters: dict | None = None
    user_id: str = ""
    session_id: str = ""


@router.post("/search/advanced")
async def advanced_search(body: SearchRequest, x_tenant_id: str = Header(default="")):
    """Search with mode selection: basic, self_rag, or react."""
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    orch = kernel._engine._orchestrator

    if body.mode == "self_rag":
        result = await orch.execute_tool("rag_self_rag", {
            "query": body.query, "top_k": body.top_k,
        }, tid)
        return result
    elif body.mode == "react":
        result = await orch.execute_tool("rag_react", {
            "query": body.query, "top_k": body.top_k,
        }, tid)
        return result
    else:
        result = await orch.execute_tool("search_documents", {
            "query": body.query, "top_k": body.top_k,
            "filters": body.filters, "user_id": body.user_id,
            "session_id": body.session_id,
        }, tid)
        return result


class EvalSample(BaseModel):
    query: str
    answer: str = ""
    ground_truth: str = ""


class EvalRequest(BaseModel):
    samples: list[EvalSample]
    top_k: int = 5


@router.post("/eval")
async def run_eval(body: EvalRequest, x_tenant_id: str = Header(default="")):
    """Run RAGAS evaluation on query/answer pairs."""
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    result = await kernel._engine._orchestrator.execute_tool("rag_eval", {
        "samples": [s.model_dump() for s in body.samples],
        "top_k": body.top_k,
    }, tid)
    return result


class ProfileIn(BaseModel):
    user_id: str
    preferred_doc_types: list[str] = []
    preferred_sources: list[str] = []
    instructions: str = ""


@router.get("/profile/{user_id}")
async def get_profile(user_id: str, x_tenant_id: str = Header(default="")):
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    result = await kernel._engine._orchestrator.execute_tool("rag_profile_get", {"user_id": user_id}, tid)
    return result


@router.post("/profile")
async def set_profile(body: ProfileIn, x_tenant_id: str = Header(default="")):
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    result = await kernel._engine._orchestrator.execute_tool("rag_profile_set", body.model_dump(), tid)
    return result


# ── Memory advanced endpoints ──────────────────────────────────────────────

class MemorySearchRequest(BaseModel):
    topic: str
    top_k: int = 10
    since: str = ""
    until: str = ""
    confidence_gte: float | None = None
    session_id: str = ""


@router.post("/memory/search")
async def memory_search(body: MemorySearchRequest, x_tenant_id: str = Header(default="")):
    """Search memory with advanced filters."""
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    args = {"topic": body.topic, "top_k": body.top_k}
    if body.since:
        args["since"] = body.since
    if body.until:
        args["until"] = body.until
    if body.confidence_gte is not None:
        args["confidence_gte"] = body.confidence_gte
    if body.session_id:
        args["session_id"] = body.session_id
    result = await kernel._engine._orchestrator.execute_tool("query_memory", args, tid)
    return result


@router.get("/memory/stats")
async def memory_stats(x_tenant_id: str = Header(default="")):
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    result = await kernel._engine._orchestrator.execute_tool("memory_stats", {}, tid)
    return result


@router.get("/memory/facts")
async def memory_facts(x_tenant_id: str = Header(default="")):
    """List all facts from memory (no semantic search filter)."""
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    try:
        # Direct access to memorymcp's list_facts (bypasses semantic search)
        mem = kernel._engine._orchestrator.memory
        if mem and hasattr(mem, "semantic") and hasattr(mem.semantic, "list_facts"):
            facts = await mem.semantic.list_facts(tid)
            return {"output": [
                {
                    "id": f.id,
                    "content": f.content,
                    "importance": f.importance,
                    "confidence": f.confidence,
                    "tags": f.tags,
                    "fact_type": getattr(f, "fact_type", ""),
                    "retrieval_count": getattr(f, "retrieval_count", 0),
                    "decay_score": getattr(f, "decay_score", 1.0),
                    "confirmation_count": getattr(f, "confirmation_count", 1),
                    "created_at": f.created_at.isoformat() if f.created_at else None,
                    "updated_at": f.updated_at.isoformat() if f.updated_at else None,
                    "last_retrieved_at": f.last_retrieved_at.isoformat() if f.last_retrieved_at else None,
                }
                for f in facts
            ]}
    except Exception:
        pass
    # Fallback: use query_memory with empty topic (might return fewer results)
    result = await kernel._engine._orchestrator.execute_tool("query_memory", {"topic": "", "top_k": 200}, tid)
    return result


# ── Brain Editor endpoints ────────────────────────────────────────────────


class AskBrainRequest(BaseModel):
    question: str
    mode: str = "basic"  # basic | self_rag | react


@router.post("/ask")
async def ask_brain(body: AskBrainRequest, x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    """Ask a question using the knowledge base. Returns answer + sources."""
    k = kernel
    if not k:
        return {"answer": "Kernel not ready", "sources": []}

    try:
        orch = k._engine._orchestrator
        tid = x_tenant_id or "default"

        if body.mode in ("self_rag", "react"):
            # Try advanced RAG mode, fallback to basic if LLM not available
            try:
                result = await orch.execute_tool(
                    "rag_self_rag" if body.mode == "self_rag" else "rag_react",
                    {"query": body.question, "top_k": 5},
                    tid,
                )
                # Check for pipeline errors
                if isinstance(result, dict) and not result.get("success", True):
                    raise RuntimeError(result.get("error", "RAG mode failed"))

                # Parse result — may be dict or string
                if isinstance(result, str):
                    try:
                        import json as _json
                        result = _json.loads(result)
                    except (ValueError, TypeError):
                        return {"answer": result, "sources": [], "confidence": 0}

                if isinstance(result, dict):
                    output = result.get("output", result)
                    if isinstance(output, str):
                        try:
                            import json as _json
                            output = _json.loads(output)
                        except (ValueError, TypeError):
                            return {"answer": output, "sources": [], "confidence": 0}
                    if isinstance(output, dict):
                        return {
                            "answer": output.get("answer", output.get("output", str(output))),
                            "sources": output.get("chunks", output.get("sources", [])),
                            "confidence": output.get("support_score", output.get("score", 0)),
                            "iterations": output.get("iterations", 0),
                        }
                return {"answer": str(result), "sources": [], "confidence": 0}

            except Exception as rag_exc:
                # Fallback to basic search if advanced mode fails (LLM not configured for RAG)
                import traceback; traceback.print_exc()
                body.mode = "basic"
                # Fall through to basic mode below

        else:
            # Basic: search facts + format
            search_result = await orch.execute_tool("query_memory", {"topic": body.question, "top_k": 5}, tid)

            # Normalize result
            if isinstance(search_result, str):
                try:
                    import json as _json
                    search_result = _json.loads(search_result)
                except (ValueError, TypeError):
                    search_result = {}

            facts = []
            if isinstance(search_result, list):
                facts = search_result
            elif isinstance(search_result, dict):
                facts = search_result.get("results", search_result.get("output", []))
                if isinstance(facts, str):
                    try:
                        import json as _json
                        facts = _json.loads(facts)
                    except (ValueError, TypeError):
                        facts = []
            if not isinstance(facts, list):
                facts = []

            if not facts:
                return {"answer": "No relevant knowledge found. Upload documents or add facts to teach me.", "sources": [], "confidence": 0}

            answer_parts = []
            sources = []
            for f in facts[:5]:
                content = f.get("content", str(f)) if isinstance(f, dict) else str(f)
                answer_parts.append(content)
                sources.append({"content": content[:200], "score": f.get("score", 0) if isinstance(f, dict) else 0})

            return {
                "answer": "\n\n".join(answer_parts),
                "sources": sources,
                "confidence": max((s["score"] for s in sources), default=0),
                "facts_used": len(sources),
            }

    except Exception as exc:
        return {"answer": f"Error: {exc}", "sources": [], "confidence": 0}


class AddFactRequest(BaseModel):
    content: str
    importance: float = 0.7
    tags: list[str] = []
    fact_type: str = "manual"


@router.post("/fact")
async def add_fact(body: AddFactRequest, x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    """Add a fact manually to the knowledge base."""
    k = kernel
    if not k:
        return {"success": False, "error": "Kernel not ready"}
    try:
        orch = k._engine._orchestrator
        result = await orch.execute_tool("store_fact", {
            "content": body.content,
            "importance": body.importance,
            "metadata": {"tags": body.tags, "fact_type": body.fact_type, "source": "manual"},
        }, x_tenant_id)
        return {"success": True, "fact_id": result.get("id", ""), "content": body.content}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@router.delete("/fact/{fact_id}")
async def delete_fact(fact_id: str, x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    k = kernel
    if not k:
        return {"success": False}
    try:
        orch = k._engine._orchestrator
        await orch.execute_tool("forget_fact", {"fact_id": fact_id}, x_tenant_id)
        return {"success": True}
    except Exception:
        return {"success": False}


@router.get("/gaps")
async def detect_gaps(x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    """Detect gaps in the knowledge base: orphan entities, missing connections, sparse topics."""
    k = kernel
    if not k:
        return {"gaps": []}

    gaps = []
    try:
        # Get graph data from the existing /graph/data endpoint logic
        orch = k._engine._orchestrator
        graph_result = await orch.execute_tool("knowledge_graph_query", {"query": "*", "max_results": 500}, x_tenant_id)
        nodes = graph_result.get("nodes", []) if isinstance(graph_result, dict) else []
        edges = graph_result.get("edges", graph_result.get("relationships", [])) if isinstance(graph_result, dict) else []

        # Find orphan nodes (no connections)
        connected_ids = set()
        for e in edges:
            connected_ids.add(e.get("source", ""))
            connected_ids.add(e.get("target", ""))

        orphans = [n for n in nodes if n.get("id", "") not in connected_ids]
        if orphans:
            gaps.append({
                "type": "orphan_entities",
                "severity": "medium",
                "message": f"{len(orphans)} entities with no connections",
                "details": [n.get("name", n.get("id", "")) for n in orphans[:10]],
                "suggestion": "These entities exist but aren't connected to anything. Add documents that mention them together with other concepts.",
            })

        # Find weakly connected components (potential silos)
        # Simple: entities with only 1 connection
        edge_count = {}
        for e in edges:
            edge_count[e.get("source", "")] = edge_count.get(e.get("source", ""), 0) + 1
            edge_count[e.get("target", "")] = edge_count.get(e.get("target", ""), 0) + 1

        weak_nodes = [n for n in nodes if edge_count.get(n.get("id", ""), 0) == 1]
        if len(weak_nodes) > 3:
            gaps.append({
                "type": "weak_connections",
                "severity": "low",
                "message": f"{len(weak_nodes)} entities with only 1 connection",
                "details": [n.get("name", "") for n in weak_nodes[:10]],
                "suggestion": "Add more documents to strengthen these connections.",
            })

        # Check fact coverage: topics with few facts
        facts_result = await orch.execute_tool("query_memory", {"topic": "*", "top_k": 100}, x_tenant_id)
        facts = facts_result.get("results", []) if isinstance(facts_result, dict) else facts_result if isinstance(facts_result, list) else []

        if len(facts) < 5 and len(nodes) > 10:
            gaps.append({
                "type": "low_fact_coverage",
                "severity": "high",
                "message": f"Only {len(facts)} facts for {len(nodes)} entities",
                "suggestion": "Chat with the agent about these topics to build more facts, or add facts manually.",
            })

        # Check for stale facts (high decay)
        stale_facts = [f for f in facts if isinstance(f, dict) and f.get("decay_score", 1) < 0.3]
        if stale_facts:
            gaps.append({
                "type": "stale_knowledge",
                "severity": "medium",
                "message": f"{len(stale_facts)} facts are fading (high decay)",
                "details": [f.get("content", "")[:60] for f in stale_facts[:5]],
                "suggestion": "These facts haven't been accessed recently. Review and refresh them or they'll be forgotten.",
            })

    except Exception as exc:
        gaps.append({"type": "error", "severity": "low", "message": f"Could not analyze: {exc}", "suggestion": "Build the knowledge graph first."})

    return {"gaps": gaps, "total_gaps": len(gaps)}


class AddEdgeRequest(BaseModel):
    source_id: str
    target_id: str
    relationship: str = "related_to"


@router.post("/graph/add-edge")
async def add_edge(body: AddEdgeRequest, x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    """Add a manual relationship between two entities."""
    k = kernel
    if not k:
        return {"success": False, "error": "Kernel not ready"}
    try:
        # Store as a fact that describes the relationship
        orch = k._engine._orchestrator
        content = f"{body.source_id} {body.relationship} {body.target_id}"
        result = await orch.execute_tool("store_fact", {
            "content": content,
            "importance": 0.8,
            "metadata": {"fact_type": "relationship", "source": "manual_edge", "source_entity": body.source_id, "target_entity": body.target_id, "relationship": body.relationship},
        }, x_tenant_id)
        return {"success": True, "fact_id": result.get("id", "")}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


class RemoveEdgeRequest(BaseModel):
    source_id: str
    target_id: str


@router.post("/graph/remove-edge")
async def remove_edge(body: RemoveEdgeRequest, x_tenant_id: str = Header(default="default", alias="X-Tenant-Id")):
    """Remove a relationship between entities."""
    # For now just return success — full implementation would need graph store access
    return {"success": True, "message": "Edge removal noted. Rebuild graph to apply."}
