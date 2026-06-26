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

## Task 12: UI Dashboard — Read-Only Operator Workspace
- [ ] Task 12.1: Scaffold Vite + Vanilla TS boilerplate (`apps/web/`)
  - [ ] Run `bun create vite apps/web --template vanilla-ts`
  - [ ] Install `motion` (Motion One) — only dependency beyond Vite defaults
  - [ ] Add `tsconfig.json` with strict mode
  - [ ] Add `vite.config.ts` — zero plugins needed
  - [ ] Verify `bun dev` starts without errors
- [ ] Task 12.2: Build EventTarget state store (`apps/web/src/store.ts`)
  - [ ] `createStore<T>(initial)` returns `{ get, set, subscribe }` backed by `EventTarget`
  - [ ] Typed events: `"state:change"` with `CustomEvent<Partial<T>>`
  - [ ] Subscribe returns unsubscribe function
  - [ ] No external dependencies — uses native `EventTarget` and `CustomEvent`
- [ ] Task 12.3: Build CSS base + grid system (`apps/web/src/styles/`)
  - [ ] `base.css` — `#000` background, Inter font (monospace variant for transcript), CSS custom properties for colors
  - [ ] `grid.css` — 65/35 asymmetric CSS Grid with `@container` query for mobile collapse
  - [ ] `card.css` — `.magnetic-card` base styles, `::before` radar glow, `transform-style: preserve-3d`
  - [ ] Mobile: grid collapses to single column (transcript full width, sidebar below)
- [ ] Task 12.4: Build magnetic card component (`apps/web/src/components/magnetic-card.ts`)
  - [ ] `createMagneticCard(el)` — attaches mousemove/mouseleave listeners
  - [ ] Motion One `animate()` for rotateX/rotateY tilt (±12 degrees)
  - [ ] CSS custom properties `--cursor-x`, `--cursor-y` for radar glow tracking
  - [ ] `matchMedia("(hover: hover)")` guard — disabled on touch
  - [ ] `will-change: transform` during hover, removed on mouseleave
- [ ] Task 12.5: Build transcript pane (`apps/web/src/components/transcript-pane.ts`)
  - [ ] Connects to LiveKit room via WebSocket (client-side SDK or raw WS)
  - [ ] Appends text frames to scroll container (auto-scroll on new frame)
  - [ ] Speaker labels: left-aligned for customer (`#444` background), right-aligned for agent (`#111` background)
  - [ ] Sentiment: `border-left: 3px solid` color — green for positive, `#333` for neutral, `#600` for negative
  - [ ] Handles LiveKit disconnect: shows dimmed "transcript paused" state, auto-reconnects
- [ ] Task 12.6: Build metrics sidebar (`apps/web/src/components/metrics-sidebar.ts`)
  - [ ] Four magnetic cards (use `createMagneticCard`):
    - Circuit Breaker Sentinel — polls `GET /ready` every 60s, shows state (green/amber/red dot), last transition time
    - Cache Health — reads `crm.cache.hit_rate` from store, renders circular SVG percentage
    - Active Call — reads `crm.calls.active` and contact data from store, shows duration timer
    - Deals at Risk — reads stale deals count from store via Supabase Realtime, shows count + top deal name
  - [ ] Cards stack vertically, equal height, scrollable if overflow
- [ ] Task 12.7: Build contact context bar (`apps/web/src/components/contact-bar.ts`)
  - [ ] Bottom-fixed, 80px height, 100% width
  - [ ] During call: contact name, account, open deals count, last interaction date
  - [ ] Outside call: system status (healthy/degraded/down) from last `/ready` poll
  - [ ] Data from store (populated by Supabase Realtime subscription)
- [ ] Task 12.8: Build Supabase Realtime subscription (`apps/web/src/main.ts`)
  - [ ] Subscribe to `deals`, `contacts`, `calls` table changes via Supabase Realtime WebSocket
  - [ ] Push updates to store → components re-render via subscription
  - [ ] Handle disconnect/reconnect gracefully
- [ ] Task 12.9: Wire `/ready` polling + OTel metrics polling
  - [ ] Poll `GET http://localhost:8280/ready` every 60s
  - [ ] Push circuit breaker states to store
  - [ ] Poll OTel Prometheus endpoint every 10s for cache hit rate, active calls gauge
  - [ ] Push to store
- [ ] Task 12.10: Add `"dev:web"` and `"build:web"` scripts to package.json
  - [ ] `"dev:web": "cd apps/web && bun dev"`
  - [ ] `"build:web": "cd apps/web && bun run build"`
  - [ ] Verify `bun dev:web` serves dashboard on localhost:5173

## Task 13: Pre-Commit Validation Pipeline (SLA Gates)
- [ ] Task 13.1: Build golden dataset (`scripts/golden-dataset.json`)
  - [ ] 50 CRM conversation examples: 20 WhatsApp, 15 voice, 15 mixed intent
  - [ ] Each example: `{ query, expectedResponse, expectedContext, expectedEntities }`
  - [ ] Covers all CRM entity types: contacts, deals, tickets, pipeline, accounts
- [ ] Task 13.2: Update `scripts/eval-rag.ts` with DeepEval integration
  - [ ] Load golden dataset
  - [ ] Run each example through `orchestrator.processIntent()`
  - [ ] Compute Faithfulness, Answer Relevancy, Context Precision
  - [ ] Gate: all three >= thresholds from spec Section 5.1
  - [ ] Output: `scripts/eval-results.json`
- [ ] Task 13.3: Build P95 latency gate (`scripts/validate-latency.ts`)
  - [ ] Run 100 simulated requests against seed data (mix of WhatsApp and voice patterns)
  - [ ] Compute P95 for: full pipeline (cold), cache hit path, graph expansion, embedding API
  - [ ] Gate: all P95 thresholds from spec Section 5.2
  - [ ] Output: `scripts/validate-latency.json`
- [ ] Task 13.4: Build metric ceiling gate (`scripts/validate-metrics.ts`)
  - [ ] Read current active metric series count from OTel meter provider
  - [ ] Gate: active series < 2,000
  - [ ] Gate: metric collection interval = 60s (not 10s)
  - [ ] Gate: head-based sampling rate = 10% in production config
  - [ ] Output: `scripts/validate-metrics.json`
- [ ] Task 13.5: Build SLA gate runner (`scripts/validate-sla.ts`)
  - [ ] Simulate load and measure: cache hit rate, idempotency hit rate, circuit breaker states, DLQ depth
  - [ ] Gate: all SLA thresholds from spec Section 5.4
  - [ ] Output: `scripts/validate-sla.json`
- [ ] Task 13.6: Wire `pnpm run validate` script
  - [ ] Runs: `eval-rag.ts` → `validate-latency.ts` → `validate-metrics.ts` → `validate-sla.ts`
  - [ ] Aggregates results into `scripts/validate-results.json`
  - [ ] Exit 1 if any gate fails
  - [ ] Add `"validate": "bun run scripts/validate.ts"` to `package.json`
- [ ] Task 13.7: Add telemetry budget gauges to `scripts/otel-bootstrap.ts`
  - [ ] `crm.telemetry.metrics_active` gauge — current active metric series
  - [ ] `crm.telemetry.traces_bytes` counter — monthly trace data volume estimate
  - [ ] Both reported at 60s intervals (aligned with metric export interval)

## Task 14: AST Firewall — Final Verification
- [ ] Task 14.1: Update firewall scan paths
  - [ ] Add `packages/ai-core/src/features/**/*.ts` to scan targets
  - [ ] Add `packages/ai-core/src/adapters/**/*.ts` to scan targets
  - [ ] Add `packages/ai-core/src/agents/**/*.ts` to scan targets
  - [ ] Add `packages/ai-core/src/core/**/*.ts` to scan targets
- [ ] Task 14.2: Run full sweep
  - [ ] `bun check` → 0 violations across all packages
  - [ ] `bun check:chaos` → 47 violations (chaos tests unchanged)
- [ ] Task 14.3: Update `.knowledge/runbook.md`
  - [ ] Document hexagonal architecture: ports, adapters, features, orchestration
  - [ ] Document graceful degradation paths and circuit breaker states
  - [ ] Document PII encryption key management
  - [ ] Document health endpoints: `/health`, `/ready` on port 8280
  - [ ] Document DLQ recovery procedures
  - [ ] Document RBAC roles and audit log queries
  - [ ] Document UI dashboard: URL, data sources, component layout
  
## Task 15: UI Dashboard — Pre-Commit Validation
- [ ] Task 15.1: Add UI-specific checks to `bun run validate`
  - [ ] Bundle size check: `apps/web/dist/` total < 50 KB gzipped (Motion One is 3 KB, rest is vanilla TS + CSS)
  - [ ] Accessibility check: all interactive elements keyboard-navigable, all text meets WCAG AA contrast (>= 4.5:1 on `#000`)
  - [ ] No framework found in bundle: grep for `react`, `vue`, `angular`, `svelte` in dist — must return empty

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
Task 12 (UI Dashboard) ── depends on 8 (health endpoints), 5 (orchestrator for data flow). 12.1-12.4 parallelizable.
  ↓
Task 13 (SLA Gates) ── depends on 7 (agents), 9 (seed data), 10 (telemetry). 13.1-13.5 parallelizable.
  ↓
Task 14 (Firewall) ── depends on ALL above
  ↓
Task 15 (UI Pre-Commit) ── depends on 12 (UI built), 13 (validate script exists)
```

# Parallelizable
- Task 1.3, 1.4, 1.5, 1.6 can run in parallel (independent core modules)
- Task 2.1 (Supabase stores), 2.3 (Neo4j), 2.5 (AI), 2.6 (messaging) can run in parallel
- Task 3.1, 3.2, 3.3 (migrations) can run in parallel
- Task 4.1–4.6 (feature slices) can run in parallel
- Task 7.1–7.4 (agents) can run in parallel
- Task 8.1, 8.2, 8.3 can run in parallel
- Task 10.1 and 10.3 can run in parallel with 10.2
- Task 12.1–12.4 (UI scaffold + components) can run in parallel — independent files
- Task 12.5–12.9 (UI data connections) can run in parallel after 12.4
- Task 13.1–13.5 and 13.7 can run in parallel
