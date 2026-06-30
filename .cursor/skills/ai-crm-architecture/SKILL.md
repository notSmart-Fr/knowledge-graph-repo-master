---
name: ai-crm-architecture
description: >-
  Guides the agent on the project's hybrid hexagonal architecture: vertical CRM
  feature slices under features/, port interfaces in core/ports.ts, adapter
  implementations in adapters/, and the orchestrator pipeline in
  core/orchestrator.ts. Use when building new features, adapters, or modifying
  the orchestrator to ensure dependency inversion and port-based injection.
---

# AI CRM Architecture

## Directory Layout

```
packages/ai-core/src/
├── features/          # Vertical CRM slices (contacts, deals, accounts, tickets, calls, pipeline)
│   ├── contacts/
│   │   ├── contact.types.ts    # Contact type + Zod schema
│   │   └── contact.tools.ts    # Mastra createTool({...}) definitions
│   ├── deals/
│   ├── accounts/
│   ├── tickets/
│   ├── calls/
│   └── pipeline/
├── core/              # Shared kernel — NEVER depends on adapters
│   ├── orchestrator.ts    # Depends ONLY on ports from ports.ts
│   ├── ports.ts           # All TypeScript interfaces
│   ├── errors.ts          # IntegrationError, DatabaseDomainError, etc.
│   ├── logger.ts          # Structured JSON logger with trace_id
│   └── sanitize.ts        # validateAndFilterOutput()
├── adapters/          # Concrete implementations of ports
│   ├── supabase/      # SupabaseContactStore, PgVectorCache
│   ├── neo4j/         # Neo4jGraphRetriever, NoOpGraphRetriever (fallback)
│   ├── ai/            # GeminiEmbeddingProvider, DeepSeekFallbackProvider, MastraAgentProvider
│   ├── messaging/     # RedisIdempotencyStore, SupabaseIdempotencyStore (fallback), BullMQDeadLetterQueue
│   └── encryption/    # FieldEncryption (AES-256-GCM)
├── agents/            # Mastra agent definitions (depend on tools from features/)
│   ├── crm-agent.ts
│   ├── call-summarizer.ts
│   ├── live-assist.ts
│   └── pipeline-analyzer.ts
├── config/
│   ├── startup-validator.ts   # Boot-time checks
│   └── env-schema.ts          # Zod schema for all env vars
├── health/
│   ├── health-router.ts       # /health and /ready endpoints
│   └── health-checks.ts       # Per-adapter health check functions
└── index.ts                   # Barrel export
```

## Port/Interface Contract

Every external boundary has a TypeScript interface in `core/ports.ts`. Orchestrator NEVER imports concrete adapters.

**Current interfaces:**
- `IContactStore` — `getByPhone`, `getById`, `search`
- `IDealStore` — `getByContact`, `getById`, `update`
- `ICallStore` — `create`, `appendTranscript`, `finalize`
- `ITicketStore` — `getByContact`, `create`
- `IAccountStore` — `getById`, `getHealthScore`
- `IGraphRetriever` — `expandFromContact`, `expandFromDeal`, `getStaleDeals`
- `IEmbeddingProvider` — `embed`, `embedBatch`
- `IAgentProvider` — `generate`, `generateStream`
- `ICacheStore` — `check`, `store`
- `IIdempotencyStore` — `checkAndSet`
- `IDeadLetterQueue` — `enqueue`

## Orchestrator Pipeline (8 steps)

1. Session hydration
2. Cache check (via `ICacheStore` + circuit breaker)
3. Contact lookup (via `IContactStore`)
4. Graph expansion (via `IGraphRetriever` + circuit breaker → NoOp fallback if open)
5. Agent generation (via `IAgentProvider` + circuit breaker → DeepSeek fallback if open)
6. Output sanitization (via `sanitize.ts`)
7. Cache store (via `ICacheStore`)
8. Session append

Every step MUST be wrapped in `tracer.startActiveSpan()`.

## Adding a New Adapter

1. Define interface in `core/ports.ts`
2. Create primary adapter in `adapters/{category}/`
3. Create fallback adapter (if applicable)
4. Wire circuit breaker in orchestrator config
5. Add health check in `health/health-checks.ts`
6. Update startup validator if boot-critical
