"""Workspace file-management endpoints."""
from __future__ import annotations
import os
import json
import asyncio
import time

from fastapi import APIRouter, HTTPException, Query, Header, UploadFile, File, Body
from fastapi.responses import StreamingResponse
from kernelmcp.events import kernel_event_bus, KernelEvent, KernelEventType

from config import ns, llm_config, settings, litellm_kwargs, save_json, load_json, \
    LLM_CONFIG_PATH, SETTINGS_PATH, EGRESS_CONFIG_PATH, DATA_DIR, DEFAULT_SETTINGS, is_docker
from task_store import save_task as _persist_task, load_all_tasks as _load_persisted_tasks
from pydantic import BaseModel
from models import LLMConfigIn, ConstitutionBody, WebhookBody, SpawnAgentRequest, SettingsIn
from stores import audit_collector

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


# ── Workspace ────────────────────────────────────────────────────────────────

def _get_ws(x_tenant_id: str = ""):
    k = _require()
    ws = k._engine._orchestrator.workspace
    if not ws: raise HTTPException(503, "Workspace not available")
    return ws, ns(x_tenant_id)


@router.get("/workspace/files")
async def list_files(path: str = Query(""), recursive: bool = Query(False), include_agent: bool = Query(False), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entries = await ws.list_files(path, recursive=recursive, namespace=n)
    files = [{"path": e.path, "size": e.size, "is_dir": e.is_dir, "modified": e.modified.isoformat() if e.modified else None, "namespace": n} for e in entries]
    # Optionally include files from persistent workspace namespaces
    if include_agent and hasattr(ws, 'list_tenants'):
        try:
            all_ns = ws.list_tenants() if callable(ws.list_tenants) else []
            for sub_ns in all_ns:
                if sub_ns.startswith(f"{n}__ws_") and sub_ns != n:
                    sub_entries = await ws.list_files(path, recursive=recursive, namespace=sub_ns)
                    ws_label = sub_ns.replace(f"{n}__ws_", "")
                    for e in sub_entries:
                        files.append({"path": e.path, "size": e.size, "is_dir": e.is_dir, "modified": e.modified.isoformat() if e.modified else None, "namespace": sub_ns, "workspace": ws_label})
        except Exception:
            pass
    return {"files": files}


@router.get("/workspace/file")
async def read_file(path: str = Query(...), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    try:
        entry = await ws.read_file(path, namespace=n)
        return {"path": entry.path, "content": entry.content, "size": entry.size}
    except FileNotFoundError: raise HTTPException(404, "File not found")


@router.post("/workspace/file")
async def write_file(body: dict, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entry = await ws.write_file(body["path"], body["content"], namespace=n)
    return {"path": entry.path, "size": entry.size}


@router.delete("/workspace/file")
async def delete_file(path: str = Query(...), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    await ws.delete_file(path, namespace=n)
    return {"deleted": path}


@router.get("/workspace/download-folder")
async def download_folder(path: str = Query(...), x_tenant_id: str = Header(default="")):
    """Download a workspace folder as a ZIP file."""
    from fastapi.responses import StreamingResponse
    import zipfile, io, os as _os
    ws, n = _get_ws(x_tenant_id)
    entries = await ws.list_files(path, recursive=True, namespace=n)
    if not entries:
        raise HTTPException(404, "Folder not found or empty")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for e in entries:
            if e.is_dir:
                continue
            try:
                file_data = await ws.read_file(e.path, namespace=n)
                # Use path relative to the requested folder
                arcname = e.path[len(path):].lstrip("/") if e.path.startswith(path) else e.path
                zf.writestr(arcname, file_data.content or "")
            except Exception:
                continue
    buf.seek(0)
    folder_name = path.rstrip("/").split("/")[-1] or "workspace"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{folder_name}.zip"'},
    )


@router.post("/workspace/move")
async def move_file(body: dict, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    entry = await ws.move_file(body["src"], body["dest"], namespace=n)
    return {"src": body["src"], "dest": entry.path}


@router.post("/workspace/folder")
async def create_folder(body: dict, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    name = body.get("name", "").strip()
    if not name: raise HTTPException(400, "Folder name required")
    await ws.write_file(f"{name}/.gitkeep", "", namespace=n)
    return {"created": name}


@router.post("/workspace/upload")
async def upload_file(file: UploadFile = File(...), x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    content = await file.read()
    entry = await ws.write_file(file.filename, content.decode("utf-8", errors="replace"), namespace=n)
    return {"path": entry.path, "size": entry.size}


@router.get("/workspace/stats")
async def workspace_stats(x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    try:
        s = await ws.get_workspace_stats(namespace=n)
        return {"available": True, "total_files": s.total_files, "total_size": s.total_size_bytes, "languages": s.languages}
    except Exception:
        files = await ws.list_files("", recursive=True, namespace=n)
        return {"available": True, "total_files": len(files), "total_size": sum(f.size for f in files)}


@router.get("/workspace/checkpoints")
async def list_checkpoints(x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    cps = await ws.list_checkpoints(namespace=n)
    return {"checkpoints": [{"id": c.id, "label": c.label, "workspace_id": c.workspace_id, "status": c.status.value if hasattr(c.status, "value") else str(c.status), "created_at": c.created_at.isoformat()} for c in cps]}


@router.post("/workspace/checkpoints/{checkpoint_id}/restore")
async def restore_checkpoint(checkpoint_id: str, x_tenant_id: str = Header(default="")):
    ws, n = _get_ws(x_tenant_id)
    cp = await ws.restore_checkpoint(checkpoint_id, namespace=n)
    return {"restored": checkpoint_id, "label": cp.label, "files": len(cp.file_contents)}


@router.get("/workspace/tenants")
async def list_tenants():
    k = _require()
    ws = k._engine._orchestrator.workspace
    if not ws: return {"tenants": []}
    return {"tenants": ws.list_tenants() if hasattr(ws, "list_tenants") else ["default"]}
