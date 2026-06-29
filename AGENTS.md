# AI CRM — Architecture Reference

## Stack
- **Runtime:** Bun 1.3+
- **Data:** Supabase (pgvector) + Neo4j AuraDB Free
- **AI:** Gemini (embedding), Mastra (agents), DeepSeek (fallback)
- **Voice:** LiveKit + Deepgram STT + Cartesia TTS
- **Messaging:** BullMQ (Redis), WhatsApp API
- **Telemetry:** OpenTelemetry → Grafana Cloud Free
- **Security:** AES-256-GCM field encryption, RBAC + RLS
- **Frontend:** Vite + Vanilla TS + Motion One (`apps/web/`)

## Architecture (Hybrid Hexagonal)
```
Transport (WhatsApp / Voice / Web Dashboard)
  → Orchestrator (depends ONLY on ports)
      → IContactStore       → Supabase
      → IDealStore          → Supabase
      → ICallStore          → Supabase
      → ITicketStore        → Supabase
      → IAccountStore       → Supabase
      → IGraphRetriever     → Neo4j      │ NoOp (degraded)
      → IEmbeddingProvider  → Gemini     │ Cached (degraded)
      → IAgentProvider      → Mastra     │ DeepSeek │ Ollama (degraded)
      → ICacheStore         → pgvector
      → IIdempotencyStore   → Redis      │ Supabase (fallback)
      → IDeadLetterQueue    → BullMQ
```

## Directory Layout
```
packages/ai-core/src/
├── features/      — CRM vertical slices (contacts, deals, accounts, tickets, calls, pipeline)
│   └── */         — types.ts + tools.ts per slice
├── core/          — ports.ts, orchestrator.ts, circuit-breaker.ts, errors.ts, logger.ts, sanitize.ts
│   └── __tests__/ — unit tests (bun test, zero deps)
├── adapters/      — supabase/, neo4j/, ai/, messaging/, encryption/
├── agents/        — crm-agent, call-summarizer, live-assist, pipeline-analyzer
├── config/        — startup-validator.ts, env-schema.ts, otel-bootstrap.ts
└── health/        — health-router.ts (:8280), health-checks.ts

apps/web/          — Vite + Vanilla TS dashboard (read-only)
scripts/           — worker.ts, voice-agent.ts, seed.ts, ingest.ts, eval-rag.ts, validate.ts
.knowledge/        — architecture.md, code-map.md (data flow traces)
```

## Agent Guidelines

- **Unknown fixes → search the internet first.** Use `WebSearch` before guessing. Cite sources when applying external solutions.
- **Use MCP codebase-memory tools whenever possible.** Before reading files or exploring the codebase, use `search_graph`, `query_graph`, `search_code`, `trace_path`, or `get_code_snippet` from the `mcp_codebase-memory-mcp` server. These tools understand the project's 734-node/1258-edge knowledge graph and can surface relationships that file-by-file reading would miss. Fall back to `Grep`/`Glob`/`Read` only when MCP tools don't cover the query shape.
- **Never modify `.vscode/mcp.json`** — user must handle MCP server config changes manually.
- **Prefer existing patterns.** Check `code-map.md` and `architecture.md` in `.knowledge/` before writing new code.

## Spec Environment (Speckit)

Features are organized in numbered directories under `specs/`. Each feature is self-contained with its own spec, plan, and tasks.

### Current Feature
`specs/001-ai-crm-core/` — AI CRM Core (WhatsApp + Voice + Dashboard + Degradation + Security)

| Artifact | Description |
|---|---|
| [spec.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/spec.md) | 5 user stories, 15 FRs, 10 SCs, 10 entities, edge cases |
| [plan.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/plan.md) | Architecture decisions, phases, constitution check |
| [tasks.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/tasks.md) | 51 tasks across 6 phases with dependency graph |
| [data-model.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/data-model.md) | 10 entities, constraints, RLS, state transitions |
| [research.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/research.md) | 11 architectural decisions documented |
| [contracts/interfaces.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/contracts/interfaces.md) | 11 port interfaces, Zod schemas, endpoint contracts |
| [quickstart.md](file:///i:/knowledge-graph-repo-master/specs/001-ai-crm-core/quickstart.md) | Setup, run, validation guide |

### Speckit Workflow (one feature at a time)

| Step | Command | Produces |
|---|---|---|
| 1 | `/speckit-constitution` | Project principles (`.specify/memory/constitution.md`) |
| 2 | `/speckit-specify` | `specs/NNN-name/spec.md` with FRs, SCs, entities |
| 3 | `/speckit-plan` | Architecture decisions, phases, trade-offs |
| 4 | `/speckit-checklist` | Requirements quality checklists |
| 5 | `/speckit-clarify` | Resolves ambiguities in spec |
| 6 | `/speckit-tasks` | Task list with dependency graph |
| 7 | `/speckit-analyze` | Cross-artifact consistency check |
| 8 | `/speckit-implement` | Executes the tasks |

### Constitution
`.specify/memory/constitution.md` — 5 core principles (Port-Adapter, Graceful Degradation, PII Security, AST Firewall, Observability), SLA gates, free tier budget ceilings, test discipline, governance. This is **non-negotiable** — all features must align.

### Adding New Features
- New capability = new directory (`specs/002-name/`)
- Run `/speckit-specify` to generate the spec
- Existing feature artifacts stay untouched
- Cross-cutting concerns go in the constitution, not a feature spec

**Agent rule:** Before implementing any feature, read the constitution first, then the feature's `spec.md` for contracts and `tasks.md` for the ordered execution plan.

## Key Facts
- **11 port interfaces** in `core/ports.ts` — orchestrator never imports concrete adapters
- **8-step pipeline** — session hydrate → cache → contact → graph → agent → sanitize → cache store → session append
- **4-tier fallback** — Gemini → DeepSeek → Ollama (local, conditional) → cached response
- **19-rule AST firewall** — `bun check` blocks build on violations. 7 domains (Zod, Error, Query, AI, Telemetry, Type, Architecture).
- **Health on :8280** — `/health` (liveness) + `/ready` (degradation status)
- **bun test** — unit + contract tests, `__tests__/` next to code, zero dependencies
- **bun run validate** — pre-commit pipeline (firewall + RAG triad + latency + SLA gates)
