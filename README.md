# kernelmcp Demo

Full-stack demo for the `kernelmcp` orchestrator. Connects all six MCP libraries (memory, planning, workspace, sandbox, scheduler, RAG) through a single FastAPI backend with a Next.js 14 frontend.

## Stack

- **Backend**: FastAPI + kernelmcp orchestrator + LiteLLM
- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Search**: SearXNG (meta search engine for web search tools)
- **Packaging**: Docker Compose

---

## Start

### Docker (recommended)

```bash
cd kernelmcp-demo
docker-compose up --build
```

Opens at:
- Frontend: http://localhost:3007
- Backend API: http://localhost:8007
- API docs (Swagger): http://localhost:8007/docs
- SearXNG: http://localhost:9999

### Local

**Backend**

```bash
cd backend
pip install -r requirements.txt
pip install kernelmcp memorymcp ragmcp planningmcp workspacemcp sandboxmcp schedulermcp
uvicorn server:app --reload --port 8000
```

**Frontend** (new terminal)

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Open http://localhost:3000.

---

## Pages

| Page | Path | Description |
|------|------|-------------|
| Chat | `/chat` | Multi-turn chat with streaming, ReAct/LTP/hybrid mode selection |
| Agents | `/agents` | Spawn and monitor sub-agents / TaskForce (code, research, file, memory, plan, rag, ltp, custom) |
| Knowledge | `/knowledge` | RAG file upload, vector search, knowledge graph explorer |
| Workspace | `/workspace` | File manager with checkpoints, DLP, approval gates |
| Scheduler | `/scheduler` | Cron, one-shot, interval and watch jobs with execution history |
| Security | `/security` | Network egress control, host-access gates, constitution editor |
| Observability | `/observability` | Traces, token/cost/latency analytics |
| Monitor | `/monitor` | Live execution event stream and tool-dispatch logs |
| Deployments | `/deployments` | Deploy agents as token-authed callable APIs |
| Fleet | `/fleet` | Multi-agent fleet management |
| Control | `/control` | Remote control plane for connected kernels |
| Eval | `/eval` | Evaluation suites and regression tracking |
| Executions | `/executions` | Execution and run history |
| Observatory | `/observatory` | Aggregate system overview |
| Settings | `/settings` | LLM provider, model, execution mode, service connections |

---

## API Reference

200+ endpoints across many categories. All endpoints accept `X-Tenant-ID` header for multi-tenant isolation. The most-used endpoints are listed below by category (not exhaustive — see `/docs` for the full OpenAPI spec).

### Health / Config (7 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with namespace info |
| GET | `/config` | Kernel and LLM configuration |
| GET | `/stats` | Task/token/cost statistics |
| GET | `/servers` | Connected MCP servers and tool counts |
| GET | `/mode` | Current execution mode |
| POST | `/mode` | Set execution mode (react/ltp/hybrid) |
| POST | `/test-connection` | Test connectivity to backend services |

### LLM / Settings (4 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/llm/config` | Current LLM provider/model |
| POST | `/llm/config` | Update LLM provider/model/key |
| GET | `/settings` | All settings |
| POST | `/settings` | Update settings (LLM, engine, sandbox, scheduler, RAG) |

### Tasks (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tasks` | Create and run a task |
| GET | `/tasks` | List tasks |
| GET | `/tasks/{id}` | Task detail with turns |
| DELETE | `/tasks/{id}` | Cancel a task |
| GET | `/tasks/{id}/turns` | Get task turn history |

### Chat / Conversations (7 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Send message (creates task, returns task_id) |
| GET | `/chat/{conv}/task/{id}` | Poll chat task status |
| GET | `/chat/{conv}/stream/{id}` | SSE stream of task progress |
| GET | `/chat/{conv}` | Get conversation history |
| DELETE | `/chat/{conv}` | Clear conversation |
| GET | `/conversations` | List all conversations |
| GET | `/schedules` | List scheduled jobs |

### Workspace (10 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/files` | List files (optional recursive) |
| GET | `/workspace/file` | Read file content |
| POST | `/workspace/file` | Write file |
| DELETE | `/workspace/file` | Delete file |
| POST | `/workspace/move` | Move/rename file |
| POST | `/workspace/folder` | Create folder |
| POST | `/workspace/upload` | Upload file |
| GET | `/workspace/stats` | File count, size, languages |
| GET | `/workspace/checkpoints` | List checkpoints |
| POST | `/workspace/checkpoints/{id}/restore` | Restore checkpoint |
| GET | `/workspace/tenants` | List workspace tenants |

### RAG / Knowledge (11 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/rag/upload` | Ingest file into vector store |
| GET | `/rag/search` | Vector similarity search |
| POST | `/rag/search/advanced` | Search with mode (basic/self_rag/react) |
| GET | `/rag/stats` | Embedder, store, chunk counts |
| GET | `/rag/sources` | List ingested sources |
| DELETE | `/rag/source` | Delete source and its chunks |
| GET | `/rag/chunks` | List chunks (optional source filter) |
| POST | `/rag/graph/extract-all` | Extract knowledge graph from chunks |
| GET | `/rag/graph/data` | Get graph nodes and edges |
| POST | `/rag/graph/query` | Query graph by keyword |
| DELETE | `/rag/graph/clear` | Clear knowledge graph |

### RAG Profiles / Eval (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rag/profile/{user_id}` | Get user search profile |
| POST | `/rag/profile` | Set user search profile |
| POST | `/rag/eval` | Run RAGAS evaluation |

### Memory (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/rag/memory/search` | Search memory with filters |
| GET | `/rag/memory/stats` | Memory statistics |
| GET | `/rag/memory/facts` | List all facts |

### Agents (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents` | List available agent types |
| POST | `/agents/spawn` | Spawn a sub-agent |
| GET | `/agents/classify` | Classify task to agent type |

### Audit (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit/events` | Recent audit events (filterable) |
| DELETE | `/audit/events` | Clear audit log |
| GET | `/audit/stream` | SSE real-time event stream |

### Security (8 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/constitution` | Get safety rules |
| POST | `/constitution` | Update safety rules |
| GET | `/egress` | Network egress policy |
| POST | `/egress/toggle` | Enable/disable egress |
| POST | `/egress/allow` | Allow domain |
| DELETE | `/egress/allow` | Remove allowed domain |
| GET | `/host` | Host access approvals/pending |
| POST | `/host/approve` | Approve host access pattern |
| DELETE | `/host/approve` | Revoke host access |
| POST | `/host/deny` | Deny host access request |

### Webhooks (1 endpoint)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook` | Trigger webhook event |

---

## SearXNG

The bundled SearXNG instance provides web search capabilities to the kernel's tools. It runs on port 9999 and is configured via `searxng/settings.yml`. The backend connects to it internally at `http://searxng:8080`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KERNELMCP_NAMESPACE` | `demo` | Default tenant namespace |
| `KERNELMCP_MODEL` | `claude-sonnet-4-6` | Primary LLM model |
| `KERNELMCP_LOCAL_MODEL` | `ollama/mistral` | Local/fallback model |
| `KERNELMCP_ROUTING` | `true` | Enable smart model routing |
| `KERNELMCP_MAX_TURNS` | `20` | Max ReAct turns per task |
| `KERNELMCP_MAX_TOKENS` | `50000` | Max tokens per task |
| `KERNELMCP_MAX_COST` | `1.0` | Max cost per task (USD) |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `SEARXNG_URL` | `http://searxng:8080` | SearXNG URL |
| `RAGMCP_VECTORSTORE` | `qdrant` | Vector store backend |
| `RAGMCP_VECTORSTORE_URL` | `http://host.docker.internal:6333` | Qdrant URL |
| `RAGMCP_EMBEDDER` | `fastembed` | Embedding backend |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8007` | API URL for frontend |

---

## License

AGPL-3.0 — see [LICENSE](LICENSE).

Open source for individuals and open-source projects. For commercial use in closed-source products, a commercial license is available — contact [gaeldev@gmail.com](mailto:gaeldev@gmail.com).
