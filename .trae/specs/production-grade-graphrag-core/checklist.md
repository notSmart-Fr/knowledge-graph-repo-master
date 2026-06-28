# Checklist — Production-Grade AI CRM

> Organized by the 9 quality domains from `spec.md §I`. Checkpoints map to both spec requirements and tasks in `tasks.md`.
> **Universal domains (always verify):** Domain 1–3 | **Operational domains (verify when relevant):** Domain 4–9

---

## Domain 1: API & Contract (Universal)

### Port Interfaces
- [ ] `core/ports.ts` defines all 11 interfaces (`IContactStore`, `IDealStore`, ..., `IDeadLetterQueue`)
- [ ] Orchestrator depends ONLY on ports — no direct adapter imports
- [ ] `createOrchestrator(config)` factory accepts all ports via injection
- [ ] Adding a new embedding provider requires only implementing `IEmbeddingProvider` — no orchestrator changes
- [ ] All Mastra tools have `inputSchema`, `id` slug, `description` >= 20 chars (firewall Rule 11)
- [ ] All agents have `maxSteps` <= 10 (firewall Rule 12)

### Directory Layout
- [ ] `features/` contains vertical slices (contacts, deals, calls, accounts, tickets, pipeline)
- [ ] `core/` contains orchestrator, ports, errors, logger, sanitize
- [ ] `adapters/` contains supabase/, neo4j/, ai/, messaging/, encryption/
- [ ] `agents/` contains all 4 Mastra agents
- [ ] `apps/web/` is isolated — never imports `packages/ai-core/`

### Orchestrator Pipeline
- [ ] `processIntent()` executes 9 steps in order: session hydrate → cache check → contact lookup → graph expansion → agent generation → sanitization → cache store → session append → audit log
- [ ] Each external adapter step is wrapped in a circuit breaker
- [ ] Every step is wrapped in `tracer.startActiveSpan()`
- [ ] Zod validation at pipeline input and output boundaries

### AST Firewall
- [ ] `bun check` scans `features/`, `adapters/`, `core/`, `agents/` directories
- [ ] All AST firewall rules pass with 0 violations
- [ ] Rule 3 (Boundary Zod Wrap): two-tier check, sibling-parse fallback works

---

## Domain 2: Data & Storage (Universal)

### PII Encryption
- [ ] `FieldEncryption.encrypt()` returns `{ ciphertext, keyId, algorithm: "AES-256-GCM" }`
- [ ] `FieldEncryption.decrypt()` recovers plaintext from ciphertext + keyId
- [ ] HKDF key derivation: `HKDF(masterKey, salt=rowId, info=entityType)`
- [ ] `ENCRYPTION_MASTER_KEY` is required at startup (32-byte hex)
- [ ] `contacts.phone` and `contacts.email` stored encrypted in Supabase
- [ ] `calls.transcript_json` stored encrypted in Supabase
- [ ] `user_sessions.messages` stored encrypted in Supabase
- [ ] PII decrypted only in-memory at read time, never persisted plaintext
- [ ] `rotateKey(record, newMasterKey)` re-encrypts with new key on read (lazy)

### Webhook Idempotency
- [ ] `RedisIdempotencyStore` returns `true` on first call, `false` on duplicates within TTL
- [ ] `SupabaseIdempotencyStore` fallback works when Redis is down
- [ ] Idempotency fallback chain: Redis → Supabase → at-least-once (if both down)
- [ ] `crm.webhooks.duplicate` counter tracks idempotency hits

### Semantic Cache (pgvector)
- [ ] `PgVectorCache` implements `ICacheStore`
- [ ] `check(embedding)` uses `<=>` operator with threshold 0.05 (Rule 9 compliant)
- [ ] `store(embedding, response)` inserts with Zod-validated response shape; hashes as `prompt_hash`
- [ ] Cache eviction: LRU, entries older than 30 days soft-deleted on read (`accessed_at` timestamp)
- [ ] Cache bypass logic: "urgent", "emergency" tokens skip cache
- [ ] Cache hit rate >= 30% under simulated load

### Data Retention
- [ ] `audit_logs` immutable — INSERT only, no UPDATE/DELETE
- [ ] `idempotency_keys` TTL cleanup (300s)
- [ ] `calls.transcript_json` and `user_sessions.messages` retention respected (90 days)

### Supabase Schema
- [ ] All CRM tables created: contacts, accounts, deals, pipeline_stages, calls, support_tickets, user_sessions
- [ ] `ai_cache.cache_embeddings` created with ivfflat index on `embedding` vector(768)
- [ ] Operational tables: `idempotency_keys`, `audit_logs`, `health_checks`

---

## Domain 3: Error Handling (Universal)

### Circuit Breakers
- [ ] Circuit breaker implemented per adapter (3 failures → 30s cooldown → half-open probe)
- [ ] `NoOpGraphRetriever` fallback returns empty context when Neo4j circuit is open
- [ ] `CachedEmbeddingProvider` returns stale embeddings when Gemini circuit is open
- [ ] `DeepSeekFallbackProvider` activates when primary AI generation circuit is open
- [ ] `OllamaLocalProvider` activates when both Gemini AND DeepSeek circuits are open (only if `LOCAL_LLM_URL` set)
- [ ] Fallback chain: Gemini → DeepSeek → Ollama (conditional) → cached response
- [ ] `crm.circuit_breaker.state` gauge reflects each adapter state
- [ ] `circuit-breaker.test.ts` — 3 failures → open, cooldown → half-open, success → closed

### Error Hierarchy
- [ ] `core/errors.ts` defines: BaseError, IntegrationError, DatabaseDomainError, GraphTraversalError, CacheError, CircuitBreakerOpenError
- [ ] `IntegrationError` constructor auto-strips PII keys (`phone`, `email`, `transcript`, `token`) from meta
- [ ] All catch blocks use `: unknown` + `instanceof Error` guard (firewall Rule 4)
- [ ] `errors.test.ts` — IntegrationError meta strips PII keys

### Retry Policy
- [ ] WhatsApp outbound: 3 retries, exponential backoff (1s, 2s, 4s), max ~7s → DLQ
- [ ] Gemini generation: 1 immediate retry → DeepSeek fallback
- [ ] Supabase queries: 2 retries, 100ms linear → error thrown
- [ ] Neo4j traversal: 2 retries, 100ms linear → circuit breaker
- [ ] Gemini embedding: 1 immediate retry → CachedEmbeddingProvider

### Dead Letter Queue
- [ ] `BullMQDeadLetterQueue` implements `IDeadLetterQueue`
- [ ] WhatsApp outbound failure → 3 retries → DLQ with metadata
- [ ] Post-call summarization failure → DLQ with transcript reference
- [ ] Neo4j ingestion batch failure → DLQ with batch metadata
- [ ] Pipeline analyzer job failure → DLQ with metadata
- [ ] `crm.dlq.enqueued` counter increments per queue

### Graceful Degradation
- [ ] When `IGraphRetriever` circuit is open → inject `NoOpGraphRetriever`, set `response.metadata.degraded = true`
- [ ] When `IEmbeddingProvider` circuit is open → inject `CachedEmbeddingProvider`
- [ ] When `IAgentProvider` (primary) circuit is open → inject `DeepSeekFallbackProvider`
- [ ] When both AI providers fail → return cached response if available, else error
- [ ] Degradation path logged at WARN level; user-facing response never says "degraded"

---

## Domain 4: Security (Operational)

### RBAC
- [ ] `admin` role: full CRUD on all tables, telemetry access, DLQ replay
- [ ] `agent` role: scoped to own contacts/deals/calls/tickets via RLS
- [ ] `viewer` role: SELECT-only on assigned entities
- [ ] `service_role`: backend bypass, never exposed to clients
- [ ] Supabase custom roles defined: admin, agent, viewer

### RLS Policies
- [ ] `contacts`, `deals`, `calls`, `tickets`: `agent_id = auth.uid()` → SELECT/INSERT/UPDATE
- [ ] `accounts`: authenticated users → SELECT only
- [ ] `pipeline_stages`: authenticated users → SELECT only
- [ ] `ai_cache.cache_embeddings`: authenticated → SELECT; service_role → INSERT
- [ ] `audit_logs`: admin → SELECT; service_role → INSERT; no UPDATE/DELETE
- [ ] `idempotency_keys`: service_role → INSERT/SELECT; no user access

### Secrets & Sanitization
- [ ] All API keys absent from logs, error metadata, and span attributes
- [ ] `parseEnv()` crashes on missing required env vars
- [ ] `validateAndFilterOutput()` strips profanity, PII, prompt injection (firewall Rule 10)
- [ ] `sanitize.test.ts` — phone numbers + emails in output → "[REDACTED]"

---

## Domain 5: Observability (Operational)

### Telemetry & Metrics
- [ ] OTel metric counters: `crm.cache.hits`, `crm.cache.requests`, `crm.errors.total`, `crm.dlq.enqueued`, `crm.webhooks.duplicate`
- [ ] OTel histograms: `crm.graph.traversal.duration_ms`, `crm.ai.generation.duration_ms`, `crm.calls.duration_sec`
- [ ] OTel gauges: `crm.circuit_breaker.state`, `crm.telemetry.metrics_active`, `crm.telemetry.traces_bytes`
- [ ] Metric collection interval = 60s (not 10s)
- [ ] Trace sampling = 10% in production config
- [ ] Budget alerts: `crm.telemetry.metrics_active` at 80% → WARN, 95% → ERROR
- [ ] Active metric series < 2,000 under validation
- [ ] Grafana Cloud free tier configured

### Health Endpoints
- [ ] `GET /health` on port 8280 returns `200 { status: "ok" }` (liveness)
- [ ] `GET /ready` on port 8280 returns `200` if all adapters healthy
- [ ] `GET /ready` returns `503 { failures: [...] }` if any adapter is down
- [ ] Health checks cached appropriately (Neo4j 10s, Redis 5s, Gemini 60s)
- [ ] Circuit breaker states included in readiness check
- [ ] `health_checks` table records per-adapter health results
- [ ] `health.test.ts` — GET /health 200, GET /ready 503 when degraded
- [ ] GET /ready P95 latency < 500ms

### SLA Gates
- [ ] Cache hit rate >= 30% under simulated load
- [ ] Idempotency hit rate <= 5% under simulated load
- [ ] No circuit breaker open for > 60s during validation run
- [ ] DLQ queue depth < 50 during validation run
- [ ] AI generation failure rate < 5% under simulated load

### RAG Triad Quality
- [ ] Golden dataset exists at `scripts/golden-dataset.json` (50 examples: 20 WhatsApp, 15 voice, 15 mixed)
- [ ] DeepEval Faithfulness >= 0.90 on golden dataset
- [ ] DeepEval Answer Relevancy >= 0.85 on golden dataset
- [ ] DeepEval Context Precision >= 0.85 on golden dataset

### Pre-Commit Pipeline
- [ ] `bun run validate` aggregates RAG triad + latency + metrics + SLA gates
- [ ] `bun run validate` exits 1 if any gate fails
- [ ] `bun check` passes with 0 violations

---

## Domain 6: Deployment (Operational)

### Startup Validator
- [ ] `startup-validator.ts` checks all 6 dependencies (env → Supabase → Neo4j → Redis → Gemini → BullMQ)
- [ ] Any startup check failure → `process.exit(1)` with structured JSON error
- [ ] All startup checks pass → `report()` logs JSON success summary

### CI/CD (Planned)
- [ ] GitHub Actions workflow defined
- [ ] Pipeline: bun install → bun check → bun test → bun run validate → deploy
- [ ] Environment promotion: staging → manual approval → production

---

## Domain 7: Disaster Recovery (Operational)

- [ ] DLQ preserves failure context for replay
- [ ] Supabase `pg_dump` export configured (daily)
- [ ] Neo4j graph reconstructable from Supabase via `scripts/ingest.ts`
- [ ] Key rotation: lazy re-encrypt on read when `ENCRYPTION_MASTER_KEY` changes
- [ ] Runbook documents recovery procedures: `.knowledge/runbook.md`

---

## Domain 8: Developer Experience (Operational)

### Unit Test Discipline
- [ ] `bun test` completes with 0 failures (all `__tests__/` under `packages/ai-core/src/`)
- [ ] `sanitize.test.ts` — phone numbers + emails → "[REDACTED]"
- [ ] `errors.test.ts` — IntegrationError strips PII keys
- [ ] `logger.test.ts` — JSON output valid, PII excluded
- [ ] `circuit-breaker.test.ts` — 3 failures → open, cooldown → half-open, success → closed
- [ ] `field-encryption.test.ts` — encrypt → decrypt roundtrip matches original
- [ ] `orchestrator.test.ts` — mock all 11 ports, pipeline steps called in order
- [ ] `store-contracts.test.ts` — all 5 Supabase adapters implement interfaces + return Zod-valid types
- [ ] `retriever-contracts.test.ts` — both Neo4j retrievers implement IGraphRetriever
- [ ] `provider-contracts.test.ts` — all 4 AI providers implement their interfaces
- [ ] `messaging-contracts.test.ts` — idempotency store + DLQ implement interfaces
- [ ] `health.test.ts` — GET /health 200, GET /ready 503 when degraded
- [ ] No `bun test` file exceeds 40 lines
- [ ] No test imports external mock frameworks — only `bun` built-in mock
- [ ] Test suite completes in < 5 seconds with no external dependencies

### UI Dashboard
- [ ] `apps/web/` exists with Vite + Vanilla TS + Motion One (no React/Vue/Angular/Svelte)
- [ ] `bun dev:web` starts dashboard on localhost:5173 without errors
- [ ] EventTarget-based state store (`store.ts`) returns `{ get, set, subscribe }`
- [ ] No external state management libraries (no Redux, Zustand, signals)
- [ ] CSS Grid renders 65/35 asymmetric layout on desktop
- [ ] Mobile: grid collapses to single column (transcript full width, sidebar below)
- [ ] Pure black `#000` background on all surfaces
- [ ] Inter font loaded (monospace variant for transcript), `#999` body, `#fff` headings
- [ ] Magnetic card cursor tracking: hover → Motion One `animate(rotateX, rotateY)` ±12 degrees
- [ ] Magnetic card cursor tracking: disabled on touch devices via `matchMedia("(hover: hover)")`
- [ ] Magnetic card cursor tracking: `will-change: transform` on hover, removed on mouseleave
- [ ] Radar border glow: `::before` pseudo-element with `radial-gradient` at `--cursor-x`/`--cursor-y`
- [ ] Radar border glow: `pointer-events: none` — never blocks card interaction
- [ ] Radar border glow: `rgba(255,255,255,0.06)` — data readability unaffected
- [ ] Transcript pane: connects to LiveKit WebSocket, appends text frames with auto-scroll
- [ ] Transcript pane: customer left-aligned (`#444` background), agent right-aligned (`#111` background)
- [ ] Transcript pane: sentiment left-border color (green/`#333`/`#600`)
- [ ] Transcript pane: handles disconnect with dimmed "transcript paused" state + auto-reconnect
- [ ] Metrics sidebar: Circuit Breaker Sentinel card (green/amber/red, last transition time)
- [ ] Metrics sidebar: Cache Health card (circular SVG percentage)
- [ ] Metrics sidebar: Active Call card (duration timer, sentiment sparkline)
- [ ] Metrics sidebar: Deals at Risk card (stalled count, top deal name)
- [ ] Contact context bar: fixed bottom, 80px, shows contact/account/deals during call, system status otherwise
- [ ] Supabase Realtime subscription: pushes `deals`, `contacts`, `calls` changes to store
- [ ] `/ready` polling: every 60s, pushes circuit breaker states to store
- [ ] OTel Prometheus polling: every 10s, pushes cache hit rate + active calls gauge to store
- [ ] Bundle size: `apps/web/dist/` total < 50 KB gzipped
- [ ] Accessibility: all interactive elements keyboard-navigable
- [ ] Accessibility: all text meets WCAG AA contrast (>= 4.5:1 on `#000` background)
- [ ] No framework detected in bundle: grep for react/vue/angular/svelte in dist returns empty

---

## Domain 9: Legal/Compliance (Operational)

- [ ] `audit_logs` table exists, immutable (INSERT only, no UPDATE/DELETE)
- [ ] Audit log retained for 90 days
- [ ] PII encrypted at rest (Domain 2)
- [ ] PII encrypted in transit (HTTPS/TLS on all external APIs)
- [ ] RBAC enforced (Domain 4)
- [ ] Key rotation path documented
