"""Tool management: LangChain tools and MCP servers."""
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
from routes.settings import _load_list, _save_list, _LC_TOOLS_PATH, _MCP_SERVERS_PATH

router = APIRouter()
kernel = None  # set by server.py


def _require():
    if kernel is None:
        raise HTTPException(status_code=503, detail="Kernel not initialized")
    return kernel


# ── Tool Management ─────────────────────────────────────────────────────────

@router.get("/tools")
async def list_tools():
    """List all available tools (built-in + external MCP + LangChain)."""
    k = _require()
    orch = k._engine._orchestrator
    tools = orch.get_tool_registry()

    # Categorize tools
    built_in = []
    mcp_external = []
    langchain = []

    for t in tools:
        name = t.get("name", "")
        if "__" in name and name.split("__")[0] not in ("query", "store", "get", "set", "list", "create", "delete", "search"):
            prefix = name.split("__")[0]
            if prefix.startswith("lc"):
                langchain.append(t)
            else:
                mcp_external.append(t)
        else:
            built_in.append(t)

    # Get connected MCP servers. The connection manager is `_mcp_clients` (plural) — reading the
    # old singular `_mcp_client` left this empty, so connected servers never showed as installed.
    mcp_servers = {}
    _mgr = getattr(orch, "_mcp_clients", None) or getattr(orch, "_mcp_client", None)
    _conns = getattr(_mgr, "_connections", None) if _mgr is not None else None
    if _conns:
        for name in _conns:
            mcp_servers[name] = {"connected": True, "tools": len([t for t in mcp_external if t["name"].startswith(name + "__")])}

    return {
        "built_in": {"count": len(built_in), "tools": [{"name": t["name"], "description": t.get("description", "")[:100]} for t in built_in]},
        "mcp_servers": mcp_servers,
        "mcp_external": {"count": len(mcp_external), "tools": [{"name": t["name"], "description": t.get("description", "")[:100]} for t in mcp_external]},
        "langchain": {"count": len(langchain), "tools": [{"name": t["name"], "description": t.get("description", "")[:100]} for t in langchain]},
        "total": len(tools),
    }


@router.post("/tools/mcp/connect")
async def connect_mcp_server(body: dict):
    """Connect to an external MCP server."""
    k = _require()
    orch = k._engine._orchestrator
    name = body.get("name", "")
    transport = body.get("transport", "stdio")  # "stdio" or "sse"
    command = body.get("command", "")
    url = body.get("url", "")
    env = body.get("env", {})

    if not name:
        raise HTTPException(400, "name is required")

    try:
        if transport == "stdio" and command:
            # Merge the backend's own environment so env vars set in Settings -> Environment
            # (os.environ) reach the spawned server. The MCP SDK passes ONLY the explicit env to
            # the subprocess, so without this a server's required token (e.g. SLACK_TOKEN) — and
            # even PATH — never arrives. We persist the small `env` below, not the merged one.
            spawn_env = {**os.environ, **(env or {})}
            # The catalog stores a full command line ("npx -y @scope/server arg"); split it into
            # executable + args[] — StdioServerParameters needs them separate, otherwise it tries
            # to exec a file literally named "npx -y @scope/server" and the server never starts.
            import shlex
            parts = shlex.split(command)
            cmd, cmd_args = (parts[0], parts[1:]) if parts else (command, [])
            # npx needs -y to AUTO-INSTALL the package without an interactive "Ok to proceed?"
            # prompt — a spawned server has no TTY, so without it npx hangs and the connection
            # closes immediately. (Same for `npm exec`.)
            if cmd in ("npx", "npx.cmd", "pnpm", "pnpm.cmd") and not any(a in ("-y", "--yes") for a in cmd_args):
                cmd_args = ["-y"] + cmd_args
            # On Windows, npx/npm/pnpm are .cmd shims — the bare name isn't directly spawnable.
            import sys as _sys
            if _sys.platform == "win32" and cmd in ("npx", "npm", "pnpm", "yarn"):
                cmd = cmd + ".cmd"
            result = await orch.connect_mcp_server(name, transport="stdio", command=cmd, args=cmd_args, env=spawn_env)
        elif transport == "sse" and url:
            result = await orch.connect_mcp_server(name, transport="sse", url=url)
        else:
            raise HTTPException(400, "For stdio: provide command. For sse: provide url.")

        # The orchestrator returns {success, error} instead of raising — surface a real failure
        # (e.g. npx/node missing, bad command, server crashed) instead of a misleading "connected".
        if not result.get("success"):
            detail = result.get("error", "unknown error")
            if transport == "stdio":
                # The SDK error is generic ("Connection closed"). Re-run the command to capture the
                # server's OWN stderr — that's where the real reason lives (missing env var like
                # SLACK_BOT_TOKEN/SLACK_TEAM_ID, a 404 package, a crash on startup…).
                try:
                    import subprocess
                    proc = subprocess.run([cmd, *cmd_args], env=spawn_env, capture_output=True, text=True, timeout=20)
                    captured = (proc.stderr or proc.stdout or "")
                    lines = [ln for ln in captured.splitlines() if ln.strip() and "warn deprecated" not in ln and not ln.startswith("npm notice")]
                    if lines:
                        detail = " ".join(lines[-4:])[:600]
                except Exception:
                    pass
            raise HTTPException(502, f"Could not start '{name}': {detail}")

        # Persist so it's reconnected on restart (upsert by name)
        servers = [s for s in _load_list(_MCP_SERVERS_PATH) if s.get("name") != name]
        servers.append({"name": name, "transport": transport, "command": command, "url": url, "env": env})
        _save_list(_MCP_SERVERS_PATH, servers)
        # Get tools from the new server
        tools = [t for t in orch.get_tool_registry() if t["name"].startswith(name + "__")]
        return {"connected": True, "name": name, "tools_count": len(tools), "tools": [t["name"] for t in tools]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Failed to connect: {exc}")


@router.delete("/tools/mcp/{server_name}")
async def disconnect_mcp_server(server_name: str):
    """Disconnect from an external MCP server."""
    k = _require()
    orch = k._engine._orchestrator
    try:
        await orch.disconnect_mcp_server(server_name)
        _save_list(_MCP_SERVERS_PATH, [s for s in _load_list(_MCP_SERVERS_PATH) if s.get("name") != server_name])
        return {"disconnected": True, "name": server_name}
    except Exception as exc:
        raise HTTPException(500, f"Failed to disconnect: {exc}")


@router.post("/tools/langchain/register")
async def register_langchain_tool(body: dict):
    """Register a LangChain community tool by module path and class name."""
    k = _require()
    orch = k._engine._orchestrator
    module_path = body.get("module", "")  # e.g. "langchain_community.tools.wikipedia.tool"
    class_name = body.get("class", "")    # e.g. "WikipediaQueryRun"

    if not module_path or not class_name:
        raise HTTPException(400, "module and class are required")

    try:
        import importlib, subprocess, sys, re

        def _pip_install(packages: list[str]):
            for pkg in packages:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])
            importlib.invalidate_caches()

        def _try_load():
            mod = importlib.import_module(module_path)
            tool_cls = getattr(mod, class_name)
            return tool_cls()

        # Attempt 1: try directly
        try:
            importlib.invalidate_caches()
            tool_instance = _try_load()
        except ImportError as exc:
            # Extract missing package name from error message
            err_msg = str(exc)
            # Try to find "pip install <pkg>" in error message
            pip_match = re.search(r'pip install[- ]+(?:U )?(\S+)', err_msg)
            missing_pkg = pip_match.group(1).strip('`"\'.') if pip_match else None

            # Build install list: caller-specified deps + auto-detected + top-level package
            pkg_name = module_path.split(".")[0].replace("_", "-")
            to_install = list(dict.fromkeys(body.get("pip", [pkg_name]) + ([missing_pkg] if missing_pkg else [])))
            _pip_install(to_install)

            # Attempt 2: retry after install
            try:
                tool_instance = _try_load()
            except ImportError as exc2:
                # One more round — extract again in case there's a second missing dep
                err2 = str(exc2)
                pip_match2 = re.search(r'pip install[- ]+(?:U )?(\S+)', err2)
                if pip_match2:
                    _pip_install([pip_match2.group(1).strip('`"\'.') ])
                    tool_instance = _try_load()
                else:
                    raise

        orch.register_langchain_tool(tool_instance)
        reg_name = f"lc__{tool_instance.name}"
        # Persist so it's re-registered on restart (upsert by module+class)
        tools = [t for t in _load_list(_LC_TOOLS_PATH) if not (t.get("module") == module_path and t.get("class") == class_name)]
        tools.append({"module": module_path, "class": class_name, "pip": body.get("pip", []), "name": reg_name})
        _save_list(_LC_TOOLS_PATH, tools)
        return {"registered": True, "name": reg_name, "description": tool_instance.description[:200]}
    except ImportError as exc:
        raise HTTPException(400, f"Module not found: {module_path}. Install it with pip. Error: {exc}")
    except Exception as exc:
        raise HTTPException(500, f"Failed to register: {exc}")


@router.delete("/tools/langchain/{tool_name}")
async def unregister_langchain_tool(tool_name: str):
    """Unregister a LangChain tool."""
    k = _require()
    orch = k._engine._orchestrator
    try:
        orch.unregister_langchain_tool(tool_name)
        _save_list(_LC_TOOLS_PATH, [t for t in _load_list(_LC_TOOLS_PATH) if t.get("name") != tool_name])
        return {"unregistered": True, "name": tool_name}
    except Exception as exc:
        raise HTTPException(500, f"Failed to unregister: {exc}")
