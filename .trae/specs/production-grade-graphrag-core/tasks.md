# Tasks

## Task 0: Environment Setup (Partial)
- [ ] Task 0.1: Install and run Supabase local (`supabase start` requires Docker)
- [ ] Task 0.2: Create Supabase remote project (free tier) and link
- [ ] Task 0.3: Create Neo4j AuraDB free instance
- [ ] Task 0.4: Create Upstash Redis free instance (for idempotency + BullMQ)
- [ ] Task 0.5: Populate `.env` from `.env.template` with all credentials

## Task 1: Core Kernel — Contracts, Errors, Shared Code
- [ ] Task 1.1: Scaffold `packages/ai-core/` monorepo package
  - [ ] Create `packages/ai-core/package.json` (`"name": "@dtc/ai-core"`)
  - [ ] Create `packages/ai-core/tsconfig.json`
  - [ ] Run `bun install` to link workspace
- [ ] Task 1.2: Define all port interfaces (`core/ports.ts`)
  - [ ] `IContactStore`, `IDealStore`, `ICallStore`, `ITicketStore`, `IAccountStore`
  - [ ] `IGraphRetriever`, `IEmbeddingProvider`, `IAgentProvider`
  - [ ] `ICacheStore`, `IIdempotencyStore`, `IDeadLetterQueue`
  - [ ] Domain types used by interfaces: `Contact`, `Deal`, `Call`, `Account`, `Ticket`, `PipelineStage`, `CRMGraphContext`, `CachedResponse`, `OrchestratorResponse`
- [ ] Task 1.3: Build structured error hierarchy (`core/errors.ts`)
  - [ ] `IntegrationError(code, message, meta?)` — for external API failures
  - [ ] `DatabaseDomainError(code, message, meta?)` — for constraint violations
  - [ ] `GraphTraversalError` — for Neo4j failures
  - [ ] `CacheError` — for pgvector failures
  - [ ] `CircuitBreakerOpenError` — thrown when calling an open circuit
  - [ ] Meta keys exclude PII per firewall Rule 5
- [ ] Task 1.4: Build structured logger (`core/logger.ts`)
  - [ ] `createLogger(module)` → `{ info, warn, error, debug }`
  - [ ] JSON log lines with `trace_id`, `span_id`, `module`, `timestamp`
  - [ ] PII-free keys per firewall Rule 5
- [ ] Task 1.5: Build content sanitizer (`core/sanitize.ts`)
  - [ ] `validateAndFilterOutput(raw)` strips profanity, PII, prompt injection
  - [ ] Firewall Rule 10 enforces usage after every AI generation
- [ ] Task 1.6: Build env schema validator (`config/env-schema.ts`)
  - [ ] Zod schema for all env vars in `.env.template`
  - [ ] `parseEnv()` validates at import time, crashes on missing required keys
- [ ] Task 1.7: Create barrel export (`index.ts`)
  - [ ] Re-export ports, errors, logger, sanitize, env schema

## Task 2: Adapters — Supabase + Neo4j + AI + Messaging
- [ ] Task 2.1: Build Supabase CRM adapters (`adapters/supabase/`)
  - [ ] `SupabaseContactStore` implements `IContactStore`
  - [ ] `SupabaseDealStore` implements `IDealStore`
  - [ ] `SupabaseCallStore` implements `ICallStore`
  - [ ] `SupabaseTicketStore` implements `ITicketStore`
  - [ ] `SupabaseAccountStore` implements `IAccountStore`
  - [ ] All return types validated with Zod
  - [ ] All Supabase calls behind auth context (service_role for backend)
- [ ] Task 2.2: Build pgvector cache adapter (`adapters/supabase/pgvector-cache.ts`)
  - [ ] `PgVectorCache` implements `ICacheStore`
  - [ ] `check(embedding)` uses `<=>` operator with threshold 0.05
  - [ ] `store(embedding, response)` inserts with Zod-validated response shape
  - [ ] Cache bypass logic: "urgent", "emergency" tokens
- [ ] Task 2.3: Build Neo4j graph retriever (`adapters/neo4j/`)
  - [ ] `Neo4jGraphRetriever` implements `IGraphRetriever`
  - [ ] `expandFromContact(contactId)` — 2-hop traversal: contact → account → deals → tickets → calls
  - [ ] `expandFromDeal(dealId)` — expands deal context
  - [ ] `getStaleDeals(days)` — returns deals not updated within threshold
  - [ ] All Cypher queries parameterized (firewall Rule 7 enforced)
  - [ ] Neo4j responses validated with Zod
- [ ] Task 2.4: Build NoOp fallback graph retriever (`adapters/neo4j/noop-retriever.ts`)
  - [ ] `NoOpGraphRetriever` implements `IGraphRetriever`
  - [ ] All methods return empty `CRMGraphContext` — used when Neo4j circuit is open
- [ ] Task 2.5: Build AI adapters (`adapters/ai/`)
  - [ ] `GeminiEmbeddingProvider` implements `IEmbeddingProvider`
    - [ ] `embed(text)` → 768-dim float32[]
    - [ ] `embedBatch(texts[])` → float32[][]
    - [ ] Zod validation on API response
    - [ ] Retry with exponential backoff on 429/5xx
  - [ ] `CachedEmbeddingProvider` implements `IEmbeddingProvider`
    - [ ] Returns last-known embedding from local cache when Gemini is down
    - [ ] Uses `ENCRYPTION_MASTER_KEY` for cache encryption at rest
  - [ ] `MastraAgentProvider` implements `IAgentProvider`
    - [ ] `generate(context, tools)` → calls Mastra agent
    - [ ] `generateStream(context, tools)` → streaming variant for voice
    - [ ] Falls back to DeepSeek if Gemini generation fails
  - [ ] `DeepSeekFallbackProvider` implements `IAgentProvider`
    - [ ] Wraps DeepSeek as secondary AI provider
    - [ ] Used when Geminis circuit breaker is open
- [ ] Task 2.6: Build messaging adapters (`adapters/messaging/`)
  - [ ] `RedisIdempotencyStore` implements `IIdempotencyStore`
    - [ ] `checkAndSet(key, ttl)` using `SET NX EX`
  - [ ] `SupabaseIdempotencyStore` implements `IIdempotencyStore`
    - [ ] Fallback when Redis is unreachable
    - [ ] Uses `idempotency_keys` table with TTL cleanup
  - [ ] `BullMQDeadLetterQueue` implements `IDeadLetterQueue`
    - [ ] `enqueue(queue, job, errorMeta)` → moves failed job to `dlq:{queue}:*` with metadata

## Task 3: Database Schema — Supabase Migrations + RLS
- [ ] Task 3.1: Write migration for CRM tables
  - [ ] `contacts` — id, name, phone (encrypted), email (encrypted), account_id, role, tags[jsonb], agent_id (for RLS), created_at
  - [ ] `accounts` — id, name, industry, size, health_score, created_at
  - [ ] `deals` — id, name, amount, stage, contact_id, account_id, probability, expected_close, agent_id, created_at
  - [ ] `pipeline_stages` — id, name, sort_order, probability
  - [ ] `calls` — id, contact_id, agent_id, direction, transcript_json (encrypted), summary, sentiment, action_items[jsonb], duration_sec, created_at
  - [ ] `support_tickets` — id, contact_id, subject, status, priority, agent_id, created_at
  - [ ] `user_sessions` — id, user_id, platform_user_id, channel, messages (encrypted) [jsonb], context[jsonb], created_at, updated_at
- [ ] Task 3.2: Write migration for AI cache
  - [ ] `ai_cache.cache_embeddings` — id, embedding vector(768), prompt_hash, response[jsonb], intent_tags[jsonb], model, created_at
  - [ ] Index: `ivfflat` on `embedding` with `vector_cosine_ops`
- [ ] Task 3.3: Write migration for operational tables
  - [ ] `idempotency_keys` — key text PRIMARY KEY, created_at timestamptz DEFAULT now(), TTL cleanup via `pg_cron`
  - [ ] `audit_logs` — id, actor_id, actor_role, action, entity_type, entity_id, timestamp, ip_address
  - [ ] `health_checks` — adapter_name, status, last_checked_at, latency_ms
- [ ] Task 3.4: Write RLS policies
  - [ ] `contacts`, `deals`, `calls`, `tickets`: `agent_id = auth.uid()` → SELECT/INSERT/UPDATE
  - [ ] `accounts`: authenticated users → SELECT only (read-only for agents)
  - [ ] `pipeline_stages`: authenticated users → SELECT only
  - [ ] `ai_cache.cache_embeddings`: authenticated → SELECT; service_role → INSERT
  - [ ] `audit_logs`: admin → SELECT; service_role → INSERT; no UPDATE/DELETE
  - [ ] `idempotency_keys`: service_role → INSERT/SELECT; no user access
- [ ] Task 3.5: Write RBAC role definitions
  - [ ] Create Supabase custom roles: `admin`, `agent`, `viewer`
  - [ ] `admin`: bypass RLS on all tables + telemetry access
  - [ ] `agent`: scoped RLS as defined above
  - [ ] `viewer`: SELECT-only on `contacts`, `accounts`, `deals` where assigned

## Task 4: Feature Slices — CRM Domain Logic
- [ ] Task 4.1: Build contacts feature (`features/contacts/`)
  - [ ] `contact.types.ts` — Contact type + Zod schema
  - [ ] `contact.tools.ts` — `lookupContact(phone)` Mastra tool (id slug, description >= 20, inputSchema per firewall Rule 11)
- [ ] Task 4.2: Build deals feature (`features/deals/`)
  - [ ] `deal.types.ts` — Deal type + pipeline stage enum + Zod schema
  - [ ] `deal.tools.ts` — `getDeals(contactId)`, `updateDeal(dealId, fields)` Mastra tools
- [ ] Task 4.3: Build accounts feature (`features/accounts/`)
  - [ ] `account.types.ts` — Account type + health_score computation + Zod schema
- [ ] Task 4.4: Build tickets feature (`features/tickets/`)
  - [ ] `ticket.types.ts` — Ticket type + status/priority enums + Zod schema
  - [ ] `ticket.tools.ts` — `getTickets(contactId)`, `createTicket(contactId, subject, priority)` Mastra tools
- [ ] Task 4.5: Build calls feature (`features/calls/`)
  - [ ] `call.types.ts` — Call type + transcript JSON schema + sentiment enum + Zod schema
  - [ ] `call.transcriber.ts` — Deepgram STT adapter (streaming text from audio frames)
  - [ ] `call.summarizer.ts` — orchestrator helper that triggers summarizer agent post-call
- [ ] Task 4.6: Build pipeline feature (`features/pipeline/`)
  - [ ] `pipeline.types.ts` — PipelineStage type + ordered stage list + Zod schema
  - [ ] `pipeline.analyzer.ts` — helper that triggers pipeline analyzer agent

## Task 5: Orchestrator — Port-Based Dependency Injection
- [ ] Task 5.1: Build orchestrator config type
  - [ ] `OrchestratorConfig` interface with all port slots + circuit breaker config
  - [ ] Factory function `createOrchestrator(config)` returns `OrchestratorService`
- [ ] Task 5.2: Build circuit breaker wrapper (`core/circuit-breaker.ts`)
  - [ ] `createCircuitBreaker(name, maxFailures=3, cooldownMs=30000)` returns wrapped function
  - [ ] Tracks: closed → open (on threshold) → half-open (after cooldown) → closed (on success) or open (on failure)
  - [ ] Exposes `state: "closed" | "open" | "half-open"` for health endpoint
  - [ ] OTel metric: `crm.circuit_breaker.state` gauge per adapter
- [ ] Task 5.3: Build orchestrator (`core/orchestrator.ts`)
  - [ ] `processIntent(sessionId, channel, userId, message): Promise<OrchestratorResponse>`
  - [ ] Pipeline:
    1. Session hydration (from `ICallStore`)
    2. Cache check (from `ICacheStore` via circuit breaker)
    3. Contact lookup (from `IContactStore`)
    4. Graph expansion (from `IGraphRetriever` via circuit breaker → NoOp fallback if open)
    5. Agent generation (from `IAgentProvider` via circuit breaker → DeepSeek fallback if open)
    6. Output sanitization (from `sanitize.ts`)
    7. Cache store (from `ICacheStore`)
    8. Session append (to `ICallStore`)
  - [ ] `processIntentStream()` — AsyncIterable variant for voice channel
  - [ ] Every step wrapped in `tracer.startActiveSpan()`
  - [ ] Zod validation at pipeline input and output boundaries
- [ ] Task 5.4: Build graceful degradation logic
  - [ ] When `IGraphRetriever` circuit is open → inject `NoOpGraphRetriever`, set `response.metadata.degraded = true`
  - [ ] When `IEmbeddingProvider` circuit is open → inject `CachedEmbeddingProvider`
  - [ ] When `IAgentProvider` (primary) circuit is open → inject `DeepSeekFallbackProvider`
  - [ ] When both AI providers fail → return cached response if available, else error
  - [ ] Degradation path logged at WARN level; user-facing response never says "degraded"

## Task 6: PII Field Encryption
- [ ] Task 6.1: Build encryption module (`adapters/encryption/field-encryption.ts`)
  - [ ] `encrypt(plaintext, rowId, entityType)` → `{ ciphertext, keyId, algorithm: "AES-256-GCM" }`
  - [ ] `decrypt(ciphertext, keyId, rowId, entityType)` → plaintext
  - [ ] HKDF key derivation: `HKDF(masterKey, salt=rowId, info=entityType)`
  - [ ] Master key from `ENCRYPTION_MASTER_KEY` env var (32-byte hex)
  - [ ] `rotateKey(record, newMasterKey)` → re-encrypt with new key
- [ ] Task 6.2: Integrate encryption into Supabase adapters
  - [ ] `SupabaseContactStore`: encrypt/decrypt `phone`, `email` on write/read
  - [ ] `SupabaseCallStore`: encrypt/decrypt `transcript_json` on write/read
  - [ ] `SupabaseSessionStore` (new): encrypt/decrypt `messages` on write/read
  - [ ] Encryption is transparent to the caller — stores expose same interface

## Task 7: AI CRM Agents (Mastra)
- [ ] Task 7.1: Build CRM agent (`agents/crm-agent.ts`)
  - [ ] System prompt: CRM persona + tool descriptions
  - [ ] Tools: `lookupContact`, `getDeals`, `getTickets`, `updateDeal`, `createTicket`
  - [ ] `maxSteps: 8` (firewall Rule 12)
  - [ ] Output validated with Zod schema
- [ ] Task 7.2: Build call summarizer agent (`agents/call-summarizer.ts`)
  - [ ] Post-call: transcript → `{ summary, actionItems[], sentiment, suggestedCRMUpdates[] }`
  - [ ] Output format validated with Zod
  - [ ] `maxSteps: 5`
- [ ] Task 7.3: Build live assist agent (`agents/live-assist.ts`)
  - [ ] During call: contact graph context → real-time rep prompts
  - [ ] Output: `{ prompt, confidence, sourceEntity }`
  - [ ] `maxSteps: 4`
- [ ] Task 7.4: Build pipeline analyzer agent (`agents/pipeline-analyzer.ts`)
  - [ ] Scheduled: `getStaleDeals()` → risk report
  - [ ] Output: `{ atRiskDeals[], stalledDeals[], accountHealthSummary[] }`
  - [ ] `maxSteps: 6`

## Task 8: Startup Validation + Health Endpoints
- [ ] Task 8.1: Build startup validator (`config/startup-validator.ts`)
  - [ ] Sequential checks: env vars → Supabase → Neo4j → Redis → Gemini → BullMQ
  - [ ] Each check has 3 retries with 1s backoff
  - [ ] Any failure → `process.exit(1)` with structured JSON error log
  - [ ] All pass → `report()` logs structured JSON success summary
  - [ ] Called at module load time before HTTP server starts
- [ ] Task 8.2: Build health router (`health/health-router.ts`)
  - [ ] `GET /health` → `200 { status: "ok" }` (liveness)
  - [ ] `GET /ready` → `200` all healthy or `503 { failures: ["neo4j", ...] }` degraded
  - [ ] Runs on dedicated port 8280 (Bun.serve)
- [ ] Task 8.3: Build per-adapter health checks (`health/health-checks.ts`)
  - [ ] `checkSupabase()` — `SELECT 1` with timeout 2s
  - [ ] `checkNeo4j()` — `CALL db.ping()` with timeout 2s, cached 10s
  - [ ] `checkRedis()` — `PING` with timeout 1s, cached 5s
  - [ ] `checkGemini()` — cached from startup, re-validated every 60s
  - [ ] `checkCircuitBreakers()` — all closed or half-open → healthy; any open → degraded
  - [ ] Each check writes result to `health_checks` table in Supabase

## Task 9: Seed Data + Neo4j Ingestion
- [ ] Task 9.1: Build Supabase seed script (`scripts/seed.ts`)
  - [ ] Insert 20-30 contacts across 5 accounts (with encrypted PII fields)
  - [ ] Insert 10-15 deals across pipeline stages
  - [ ] Insert pipeline stage definitions
  - [ ] Insert 5-8 sample calls with encrypted transcripts
  - [ ] Insert 3-5 support tickets
  - [ ] Zod validation on every row before insert
  - [ ] Audit log entries for seed operations
- [ ] Task 9.2: Build Neo4j ingestion pipeline (`scripts/ingest.ts`)
  - [ ] Read seed data from Supabase (PII decrypted for Neo4j — graph is internal)
  - [ ] Create `(:Contact)`, `(:Account)`, `(:Deal)`, `(:PipelineStage)`, `(:Call)`, `(:Ticket)` nodes
  - [ ] Create edges: `[:WORKS_AT]`, `[:DECISION_MAKER_FOR]`, `[:REPORTED_TO]`, `[:IN_STAGE]`, `[:WITH]`, `[:ABOUT]`, `[:RAISED_BY]`
  - [ ] All Cypher batch queries parameterized (firewall Rule 7)
  - [ ] Zod validation on every entity before Neo4j insert
  - [ ] Failed batches go to DLQ via `IDeadLetterQueue`
- [ ] Task 9.3: Verify graph traversal on seed data
  - [ ] `Neo4jGraphRetriever.expandFromContact("contact-1")` → account + deals + tickets + calls
  - [ ] `Neo4jGraphRetriever.getStaleDeals(14)` → at least 1 stale deal
  - [ ] Verify fallback: `NoOpGraphRetriever.expandFromContact(...)` → empty context
  - [ ] Verify circuit breaker opens after 3 consecutive Neo4j failures

## Task 10: Telemetry & Grafana
- [ ] Task 10.1: Extend `scripts/otel-bootstrap.ts` with CRM metrics
  - [ ] Counters: `crm.cache.requests`, `crm.cache.hits`
  - [ ] Gauge: `crm.cache.hit_rate`, `crm.calls.active`, `crm.circuit_breaker.state` (per adapter)
  - [ ] Histograms: `crm.graph.traversal.duration_ms`, `crm.ai.generation.duration_ms`, `crm.calls.duration_sec`, `crm.ingestion.batch.duration_ms`
  - [ ] Counter: `crm.errors.total` with `domain` attribute
  - [ ] Counter: `crm.dlq.enqueued` with `queue` attribute
  - [ ] Counter: `crm.webhooks.duplicate` (idempotency hits)
- [ ] Task 10.2: Instrument code with metrics
  - [ ] Cache metrics in orchestrator cache step
  - [ ] Graph traversal histogram in Neo4j adapter
  - [ ] AI generation histogram in Mastra adapter
  - [ ] Circuit breaker gauge in circuit-breaker.ts
  - [ ] DLQ counter in BullMQDeadLetterQueue
  - [ ] Idempotency hits in worker.ts
- [ ] Task 10.3: Set up Grafana Cloud free tier
  - [ ] Create free Grafana Cloud account
  - [ ] Point `OTEL_EXPORTER_OTLP_ENDPOINT` to Grafana Cloud Tempo
  - [ ] Write `scripts/grafana-dashboard.json` with panels:
    - Cache hit rate (gauge)
    - Graph traversal latency P50/P95/P99
    - AI latency by agent and model
    - Active calls (gauge)
    - Circuit breaker states
    - DLQ queue depth
    - Idempotency hit rate
    - Error rate by domain

## Task 11: Transport Reconnect
- [ ] Task 11.1: Update `scripts/worker.ts` (WhatsApp)
  - [ ] Import `OrchestratorService` from `@dtc/ai-core`
  - [ ] Wire `IIdempotencyStore` for duplicate webhook detection
  - [ ] Wire `IDeadLetterQueue` for failed outbound messages
  - [ ] Wire `ICircuitBreaker` for WhatsApp API calls
- [ ] Task 11.2: Update `scripts/voice-agent.ts` (LiveKit)
  - [ ] Import `OrchestratorService` from `@dtc/ai-core`
  - [ ] Wire Deepgram STT streaming adapter
  - [ ] Wire TTS output adapter
  - [ ] Wire interruption handling (cancel TTS on new speech)
  - [ ] Wire call lifecycle hooks (start → transcribe → end → summarize)

## Task 12: AST Firewall — Final Verification
- [ ] Task 12.1: Update firewall scan paths
  - [ ] Add `packages/ai-core/src/features/**/*.ts` to scan targets
  - [ ] Add `packages/ai-core/src/adapters/**/*.ts` to scan targets
  - [ ] Add `packages/ai-core/src/agents/**/*.ts` to scan targets
  - [ ] Add `packages/ai-core/src/core/**/*.ts` to scan targets
- [ ] Task 12.2: Run full sweep
  - [ ] `bun check` → 0 violations across all packages
  - [ ] `bun check:chaos` → 47 violations (chaos tests unchanged)
- [ ] Task 12.3: Update `.knowledge/runbook.md`
  - [ ] Document hexagonal architecture: ports, adapters, features, orchestration
  - [ ] Document graceful degradation paths and circuit breaker states
  - [ ] Document PII encryption key management
  - [ ] Document health endpoints: `/health`, `/ready` on port 8280
  - [ ] Document DLQ recovery procedures
  - [ ] Document RBAC roles and audit log queries

# Task Dependencies
```
Task 0 (Environment) ── no deps
  ↓
Task 1 (Core Kernel) ── depends on 0.5 (.env)
  ↓
Task 2 (Adapters) ── depends on 1.2 (ports), 1.3 (errors)
  ↓
Task 3 (DB Schema) ── depends on 0.1 (local Supabase)
  ↓
Task 4 (Features) ── depends on 1.2 (ports), 1.6 (env schema)
  ↓
Task 5 (Orchestrator) ── depends on 1.2 (ports), 2 (adapters), 4 (features)
  ↓
Task 6 (PII Encryption) ── depends on 1.6 (env schema)
  ↓
Task 7 (Agents) ── depends on 4 (features/tools), 5 (orchestrator)
  ↓
Task 8 (Startup + Health) ── depends on 1.6 (env schema), 2 (adapters), 5.2 (circuit breaker)
  ↓
Task 9 (Seed + Ingestion) ── depends on 3 (schema), 2.3 (Neo4j adapter), 6 (encryption)
  ↓
Task 10 (Telemetry) ── depends on 5 (orchestrator), 2 (adapters)
  ↓
Task 11 (Transport) ── depends on 5 (orchestrator), 7 (agents), 2.6 (idempotency/DLQ)
  ↓
Task 12 (Firewall) ── depends on ALL above
```

# Parallelizable
- Task 1.3, 1.4, 1.5, 1.6 can run in parallel (independent core modules)
- Task 2.1 (Supabase stores), 2.3 (Neo4j), 2.5 (AI), 2.6 (messaging) can run in parallel
- Task 3.1, 3.2, 3.3 (migrations) can run in parallel
- Task 4.1–4.6 (feature slices) can run in parallel
- Task 7.1–7.4 (agents) can run in parallel
- Task 8.1, 8.2, 8.3 can run in parallel
- Task 10.1 and 10.3 can run in parallel with 10.2
