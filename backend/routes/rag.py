"""RAG + Knowledge Graph + Advanced RAG endpoints."""
from __future__ import annotations
import os
import re as _re
import uuid as _uuid
from fastapi import APIRouter, HTTPException, Query, Header, UploadFile, File
from pydantic import BaseModel

from config import ns
from stores import audit_collector

router = APIRouter(prefix="/rag")
kernel = None  # set by server.py
_graph_stores: dict[str, object] = {}  # per-tenant graph stores


def _get_rag():
    if kernel and kernel._engine._orchestrator.rag:
        return kernel._engine._orchestrator.rag
    return None


def _get_vs():
    rag = _get_rag()
    if not rag: return None
    return getattr(rag, "_vectorstore", None) or getattr(rag, "vectorstore", None)


def _get_graph(tenant_id: str = "default"):
    """Get or create a per-tenant graph store."""
    if tenant_id not in _graph_stores:
        try:
            from ragmcp.graph.networkx_store import NetworkXGraphStore
            _graph_stores[tenant_id] = NetworkXGraphStore()
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
            return {"sources": await vs.get_source_stats()}
        if hasattr(vs, "list_sources"):
            return {"sources": [{"source": s, "chunks": 0} for s in await vs.list_sources()]}
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
async def list_chunks(source: str = Query(default=""), limit: int = Query(default=50)):
    rag = _get_rag()
    if not rag: raise HTTPException(503, "RAG not available")
    vs = _get_vs()
    if not vs: return {"chunks": [], "total": 0}
    try:
        chunks = []
        if hasattr(vs, "get_all_chunks"):
            all_chunks = await vs.get_all_chunks()
            if source:
                all_chunks = [c for c in all_chunks if source in (getattr(getattr(c, "metadata", None), "source", "") if hasattr(c, "metadata") else "")]
            all_chunks = all_chunks[:limit]
            chunks = [{"id": getattr(c, "id", ""), "content": getattr(c, "content", "")[:200], "source": getattr(getattr(c, "metadata", None), "source", "") if hasattr(c, "metadata") else ""} for c in all_chunks]
        total = await vs.count_chunks() if hasattr(vs, "count_chunks") else len(chunks)
        return {"chunks": chunks, "total": total}
    except Exception as exc: raise HTTPException(500, str(exc))


# ── Knowledge Graph ──────────────────────────────────────────────────────────

@router.post("/graph/extract-all")
async def graph_extract_all(x_tenant_id: str = Header(default="")):
    rag = _get_rag()
    tid = ns(x_tenant_id) or "default"
    gs = _get_graph(tid)
    if not rag or not gs: raise HTTPException(503, "RAG or graph not available")
    vs = _get_vs()
    if not vs or not hasattr(vs, "get_all_chunks"): raise HTTPException(501, "Not supported")
    from ragmcp.core.models import Entity, Relation
    tid = ns(x_tenant_id) or "default"
    all_chunks = await vs.get_all_chunks()
    total_e = total_r = 0
    for chunk in all_chunks:
        text = getattr(chunk, "content", "")
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
        for i in range(len(keys) - 1):
            for j in range(i + 1, min(i + 3, len(keys))):
                relations.append(Relation(id=_uuid.uuid4().hex[:8], source_id=seen[keys[i]], target_id=seen[keys[j]], type="co_occurs"))
        if entities: await gs.upsert_entities(entities, tenant_id=tid)
        if relations: await gs.upsert_relations(relations, tenant_id=tid)
        total_e += len(entities); total_r += len(relations)
    return {"entities": total_e, "relations": total_r, "chunks_processed": len(all_chunks)}


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
    if not kernel:
        raise HTTPException(503, "Kernel not available")
    tid = ns(x_tenant_id) or "default"
    result = await kernel._engine._orchestrator.execute_tool("query_memory", {"topic": "", "top_k": 100}, tid)
    return result
