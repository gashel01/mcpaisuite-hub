"""MCP Server & Tool Marketplace — search, browse, install."""
from __future__ import annotations

import json
import time
from typing import Optional
from fastapi import APIRouter, Header, Query

router = APIRouter(prefix="/marketplace", tags=["marketplace"])

# ── Curated catalog (always available, no network needed) ────────────────────

MCP_CATALOG = [
    # Official / well-known
    {"name": "github", "title": "GitHub", "description": "Repository management, issues, PRs, file operations", "command": "npx @modelcontextprotocol/server-github", "transport": "stdio", "env": ["GITHUB_PERSONAL_ACCESS_TOKEN"], "category": "dev", "popularity": 95},
    {"name": "slack", "title": "Slack", "description": "Channel management, messaging, search", "command": "npx @modelcontextprotocol/server-slack", "transport": "stdio", "env": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"], "category": "communication", "popularity": 90},
    {"name": "postgres", "title": "PostgreSQL", "description": "Read-only database access with schema inspection", "command": "npx @modelcontextprotocol/server-postgres", "transport": "stdio", "env": ["DATABASE_URL"], "category": "database", "popularity": 85},
    {"name": "filesystem", "title": "Filesystem", "description": "Secure file operations with configurable access", "command": "npx @modelcontextprotocol/server-filesystem", "transport": "stdio", "env": [], "category": "system", "popularity": 80},
    {"name": "git", "title": "Git", "description": "Read, search, and manipulate Git repositories", "command": "npx @modelcontextprotocol/server-git", "transport": "stdio", "env": [], "category": "dev", "popularity": 88},
    {"name": "memory-mcp", "title": "Memory (MCP official)", "description": "Knowledge graph-based persistent memory", "command": "npx @modelcontextprotocol/server-memory", "transport": "stdio", "env": [], "category": "ai", "popularity": 75},
    {"name": "fetch", "title": "Fetch", "description": "Web content fetching and conversion for LLMs", "command": "npx @modelcontextprotocol/server-fetch", "transport": "stdio", "env": [], "category": "web", "popularity": 82},
    {"name": "sequential-thinking", "title": "Sequential Thinking", "description": "Dynamic problem-solving through thought sequences", "command": "npx @modelcontextprotocol/server-sequentialthinking", "transport": "stdio", "env": [], "category": "ai", "popularity": 70},
    {"name": "brave-search", "title": "Brave Search", "description": "Web and local search via Brave Search API", "command": "npx @anthropic/brave-search-mcp", "transport": "stdio", "env": ["BRAVE_API_KEY"], "category": "web", "popularity": 85},
    {"name": "puppeteer", "title": "Puppeteer", "description": "Browser automation and web scraping", "command": "npx @modelcontextprotocol/server-puppeteer", "transport": "stdio", "env": [], "category": "web", "popularity": 78},
    {"name": "google-drive", "title": "Google Drive", "description": "File access and search for Google Drive", "command": "npx @anthropic/server-google-drive", "transport": "stdio", "env": ["GOOGLE_CREDENTIALS"], "category": "productivity", "popularity": 72},
    {"name": "notion", "title": "Notion", "description": "Read and search Notion pages and databases", "command": "npx @anthropic/server-notion", "transport": "stdio", "env": ["NOTION_TOKEN"], "category": "productivity", "popularity": 75},
    {"name": "sqlite", "title": "SQLite", "description": "Database interaction and business intelligence", "command": "npx @modelcontextprotocol/server-sqlite", "transport": "stdio", "env": [], "category": "database", "popularity": 70},
    {"name": "redis", "title": "Redis", "description": "Interact with Redis key-value stores", "command": "npx @modelcontextprotocol/server-redis", "transport": "stdio", "env": ["REDIS_URL"], "category": "database", "popularity": 65},
    {"name": "sentry", "title": "Sentry", "description": "Retrieve and analyze issues from Sentry.io", "command": "npx @modelcontextprotocol/server-sentry", "transport": "stdio", "env": ["SENTRY_AUTH_TOKEN"], "category": "dev", "popularity": 68},
    {"name": "time", "title": "Time", "description": "Time and timezone conversion", "command": "npx @modelcontextprotocol/server-time", "transport": "stdio", "env": [], "category": "utility", "popularity": 50},
    # Community popular
    {"name": "docker", "title": "Docker", "description": "Manage Docker containers, images, volumes", "command": "npx @mcp/docker-server", "transport": "stdio", "env": [], "category": "dev", "popularity": 80},
    {"name": "linear", "title": "Linear", "description": "Issue tracking and project management", "command": "npx @mcp/linear-server", "transport": "stdio", "env": ["LINEAR_API_KEY"], "category": "productivity", "popularity": 72},
    {"name": "jira", "title": "Jira", "description": "Atlassian Jira issue and project management", "command": "npx @mcp/jira-server", "transport": "stdio", "env": ["JIRA_URL", "JIRA_TOKEN"], "category": "productivity", "popularity": 70},
    {"name": "google-maps", "title": "Google Maps", "description": "Location services, directions, place details", "command": "npx @modelcontextprotocol/server-google-maps", "transport": "stdio", "env": ["GOOGLE_MAPS_API_KEY"], "category": "utility", "popularity": 65},
]

LC_CATALOG = [
    {"name": "wikipedia", "title": "Wikipedia", "description": "Search and retrieve Wikipedia articles", "module": "langchain_community.tools.wikipedia", "class_name": "WikipediaQueryRun", "category": "knowledge", "popularity": 90},
    {"name": "arxiv", "title": "Arxiv", "description": "Search academic papers on arXiv", "module": "langchain_community.tools.arxiv", "class_name": "ArxivQueryRun", "category": "knowledge", "popularity": 80},
    {"name": "duckduckgo", "title": "DuckDuckGo", "description": "Web search via DuckDuckGo", "module": "langchain_community.tools.ddg_search", "class_name": "DuckDuckGoSearchRun", "category": "web", "popularity": 85},
    {"name": "youtube-transcript", "title": "YouTube Transcript", "description": "Fetch video transcripts from YouTube", "module": "langchain_community.tools.youtube", "class_name": "YouTubeTranscriptTool", "category": "knowledge", "popularity": 70},
    {"name": "requests", "title": "HTTP Requests", "description": "Make HTTP GET/POST requests", "module": "langchain_community.tools.requests", "class_name": "RequestsGetTool", "category": "web", "popularity": 75},
    {"name": "pubmed", "title": "PubMed", "description": "Search biomedical literature", "module": "langchain_community.tools.pubmed", "class_name": "PubmedQueryRun", "category": "knowledge", "popularity": 60},
]

CATEGORIES = [
    {"id": "all", "label": "All", "icon": "grid"},
    {"id": "dev", "label": "Development", "icon": "code"},
    {"id": "web", "label": "Web & Search", "icon": "globe"},
    {"id": "database", "label": "Databases", "icon": "database"},
    {"id": "productivity", "label": "Productivity", "icon": "briefcase"},
    {"id": "communication", "label": "Communication", "icon": "message"},
    {"id": "ai", "label": "AI & ML", "icon": "brain"},
    {"id": "knowledge", "label": "Knowledge", "icon": "book"},
    {"id": "utility", "label": "Utilities", "icon": "wrench"},
    {"id": "system", "label": "System", "icon": "terminal"},
]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/search")
async def search_marketplace(
    q: str = Query("", description="Search query"),
    category: str = Query("all"),
    type: str = Query("all", description="mcp, langchain, or all"),
):
    """Search the marketplace catalog."""
    results = []

    if type in ("mcp", "all"):
        for item in MCP_CATALOG:
            if category != "all" and item["category"] != category:
                continue
            if q and q.lower() not in f"{item['name']} {item['title']} {item['description']}".lower():
                continue
            results.append({**item, "type": "mcp"})

    if type in ("langchain", "all"):
        for item in LC_CATALOG:
            if category != "all" and item["category"] != category:
                continue
            if q and q.lower() not in f"{item['name']} {item['title']} {item['description']}".lower():
                continue
            results.append({**item, "type": "langchain"})

    # Sort by relevance (exact name match first, then popularity)
    def score(item):
        s = item.get("popularity", 50)
        if q and q.lower() in item["name"].lower():
            s += 100
        if q and q.lower() in item["title"].lower():
            s += 50
        return -s
    results.sort(key=score)

    return {"results": results, "total": len(results)}


@router.get("/categories")
async def list_categories():
    return {"categories": CATEGORIES}


@router.get("/featured")
async def featured():
    """Return featured/popular servers."""
    top_mcp = sorted(MCP_CATALOG, key=lambda x: -x["popularity"])[:6]
    top_lc = sorted(LC_CATALOG, key=lambda x: -x["popularity"])[:4]
    return {
        "mcp_servers": [{**s, "type": "mcp"} for s in top_mcp],
        "langchain_tools": [{**s, "type": "langchain"} for s in top_lc],
    }


@router.get("/registry")
async def query_registry(q: str = Query("", description="Search the official MCP registry")):
    """Query the official MCP registry (requires network)."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://registry.modelcontextprotocol.io/v0/servers")
            if resp.status_code == 200:
                data = resp.json()
                servers = data.get("servers", [])
                results = []
                for entry in servers:
                    sv = entry.get("server", {})
                    name = sv.get("name", "")
                    desc = sv.get("description", "")
                    if q and q.lower() not in f"{name} {desc}".lower():
                        continue
                    results.append({
                        "name": name,
                        "title": sv.get("title", name),
                        "description": desc[:200],
                        "version": sv.get("version", ""),
                        "remotes": sv.get("remotes", []),
                        "packages": sv.get("packages", []),
                        "type": "mcp_registry",
                    })
                return {"results": results[:20], "total": len(results), "source": "registry.modelcontextprotocol.io"}
    except Exception as exc:
        return {"results": [], "total": 0, "error": str(exc)[:100], "source": "registry.modelcontextprotocol.io"}
