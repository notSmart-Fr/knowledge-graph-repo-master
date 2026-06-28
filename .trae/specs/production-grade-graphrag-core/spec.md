# Production-Grade AI CRM — Hybrid Hexagonal + Free Tier

## Why
Rebuild the codebase as an **AI-powered CRM** converging **WhatsApp** (webhook), **realtime voice** (LiveKit), and a **lightweight read-only web dashboard** (Vite + Vanilla TS + Motion One in `apps/web/`) into one AI orchestrator. The previous `production-grade-graphrag-core` spec was monolithic (orchestrator directly instantiates all dependencies) and had critical gaps in operational resilience, security, and deployment readiness.

## Architecture Decision
**Hybrid Feature-Driven Hexagonal.** Vertical slices under `features/` for CRM domain cohesion. Core orchestration depends on TypeScript **interfaces (ports)**, not concrete adapters. Adapters live in `adapters/` and implement those ports. Every external boundary (Neo4j, Gemini, Cartesia, Supabase) has a **fallback adapter** for graceful degradation.

```
Transport (WhatsApp / Voice / Web)
  → Orchestrator (depends on ports)
      → IContactStore →    Supabase adapter  │  Mock adapter (tests)
      → IGraphRetriever →   Neo4j adapter    │  NoOp adapter (degraded)
      → IEmbeddingProvider → Gemini adapter   │  Cached adapter (degraded)
      → IAgentProvider →     Mastra adapter   │  Mock adapter (tests)
      → IIdempotencyStore → Redis adapter     │  Supabase adapter
      → IDeadLetterQueue →  BullMQ adapter
```

---

## I. QUALITY DOMAINS — Evaluation Framework

This spec is organized around the **9 industry-standard domains** (ISO/IEC 25010 + Google SRE). Every requirement and checklist item maps to exactly one domain.

### How to Use This Framework
1. **Implementing a feature:** The 3 universal domains below are structural guarantees — architecture enforces them. Focus implementation effort on the relevant operational domains.
2. **Reviewing a feature branch:** Run against `checklist.md` — every checkpoint is domain-tagged. A feature is not complete until all relevant domain checkpoints pass.
3. **Iterating:** Operational domains grow just-in-time. Adding voice? Grow Observability. Adding EU users? Grow Legal/Compliance. Universal domains never change.

### Universal Domains (structural — satisfied by architecture, present day one)

| # | Domain | ISO/IEC 25010 | Summary |
|---|---|---|---|
| 1 | **API & Contract** | Functional Suitability + Compatibility | Port interfaces, Zod schemas, orchestration contracts, AST firewall |
| 2 | **Data & Storage** | Reliability + Data Integrity | PII encryption, RLS, cache, idempotency, retention |
| 3 | **Error Handling** | Reliability + Fault Tolerance | Circuit breakers, fallback chains, DLQ, retries |

### Operational Domains (just-in-time — depth grows with system maturity)

| # | Domain | ISO/IEC 25010 | Summary |
|---|---|---|---|
| 4 | **Security** | Security + Privacy | RBAC, audit logs, secrets validation, output sanitization |
| 5 | **Observability** | Maintainability + Monitoring (SRE) | OTel, health endpoints, SLA gates, pre-commit validation |
| 6 | **Deployment** | Portability + Operability | Startup validator, health/readiness, environments, CI/CD |
| 7 | **Disaster Recovery** | Reliability + Recoverability | DLQ recovery, key rotation, backup/restore |
| 8 | **Developer Experience** | Maintainability + Usability | Test discipline, local dev, AST firewall, UI dashboard |
| 9 | **Legal/Compliance** | Regulatory + Security | Audit trail, PII encryption, data retention, GDPR readiness |

---

## II. UNIVERSAL DOMAINS

### Domain 1: API & Contract

#### Requirement: Port Interfaces as Structural Contracts
The system SHALL define TypeScript interfaces for every external boundary in a single `core/ports.ts` file. The orchestrator SHALL depend only on these interfaces — NEVER on concrete adapter classes.

**Required interfaces:**
- `IContactStore` — `getByPhone(phone)`, `getById(id)`, `search(query)`
- `IDealStore` — `getByContact(contactId)`, `getById(id)`, `update(dealId, fields)`
- `ICallStore` — `create(call)`, `appendTranscript(callId, chunk)`, `finalize(callId, summary)`
- `ITicketStore` — `getByContact(contactId)`, `create(ticket)`
- `IAccountStore` — `getById(id)`, `getHealthScore(id)`
- `IGraphRetriever` — `expandFromContact(contactId)`, `expandFromDeal(dealId)`, `getStaleDeals(days)`
- `IEmbeddingProvider` — `embed(text)`, `embedBatch(texts[])`
- `IAgentProvider` — `generate(context, tools)`, `generateStream(context, tools)`
- `ICacheStore` — `check(embedding)`, `store(embedding, response)`
- `IIdempotencyStore` — `checkAndSet(key, ttl)`
- `IDeadLetterQueue` — `enqueue(queue, job, errorMeta)`

#### Scenario: Adding a new embedding provider
- **WHEN** a developer wants to switch from Gemini to a local embedding model
- **THEN** they implement `IEmbeddingProvider` in a new adapter file and inject it into orchestrator config. Zero changes to orchestrator internals.

#### Scenario: Testing the orchestrator without infrastructure
- **WHEN** a unit test runs
- **THEN** all ports are injected as mocks. The test verifies orchestrator pipeline logic without touching Supabase, Neo4j, or any AI model.

#### Requirement: Local Model Fallback (Ollama)
The system SHALL support a third-tier `IAgentProvider` implementation using a local Ollama instance. This tier activates ONLY when both Gemini and DeepSeek circuits are open.

**Activation:** Fallback chain: `Gemini → DeepSeek → Ollama → cached response`. The Ollama tier is conditional — included only when `LOCAL_LLM_URL` env var is set.

**Expected quality trade-off:** Local 7B models (Llama 3.1, Mistral, Qwen 2.5) will not match Gemini's CRM reasoning quality for complex deal analysis. They are adequate for simple lookups and serve as a safety net.

#### Scenario: All cloud APIs unreachable, Ollama available
- **WHEN** both Gemini and DeepSeek circuit breakers are open AND `LOCAL_LLM_URL` is set
- **THEN** the orchestrator routes AI generation to `OllamaLocalProvider`. Response carries `{ degraded: true, modelUsed: "ollama" }` in metadata.

#### Scenario: Ollama not installed or unconfigured
- **WHEN** `LOCAL_LLM_URL` is unset and both cloud APIs are down
- **THEN** the orchestrator returns a cached response (if available) or an error. The Ollama tier is silently skipped.

#### Requirement: Code Layout — Vertical Slices with Hexagonal Boundaries
(Replaces the flat `domain/` + separate tools layout)

**Directory structure:**
```
packages/ai-core/src/
├── features/          # Vertical CRM slices
│   ├── contacts/      # Contact types, IContactStore, Mastra tools, Supabase adapter
│   ├── deals/         # Deal types, IDealStore, tools
│   ├── calls/         # Call types, ICallStore, Cartesia adapter, summarizer
│   ├── accounts/      # Account types, IAccountStore
│   ├── tickets/       # Ticket types, ITicketStore
│   └── pipeline/      # PipelineStage types, analyzer agent
├── core/              # Shared kernel
│   ├── orchestrator.ts  # Depends on ports from ports.ts
│   ├── ports.ts         # All TypeScript interfaces
│   ├── errors.ts        # Error hierarchy (see Domain 3)
│   ├── logger.ts        # Structured JSON logger with trace_id
│   └── sanitize.ts      # validateAndFilterOutput()
├── adapters/          # Concrete implementations of ports
│   ├── supabase/      # SupabaseContactStore, SupabaseDealStore, PgVectorCache
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
│   ├── startup-validator.ts  # Boot-time checks (see Domain 6)
│   └── env-schema.ts         # Zod schema for all env vars
├── health/
│   ├── health-router.ts      # /health and /ready endpoints (see Domain 5)
│   └── health-checks.ts      # Per-adapter health check functions
└── index.ts                   # Barrel export

apps/web/                    # Read-only operator dashboard (see Domain 8)
├── index.html
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── store.ts
│   ├── components/
│   │   ├── transcript-pane.ts
│   │   ├── metrics-sidebar.ts
│   │   ├── contact-bar.ts
│   │   └── magnetic-card.ts
│   └── styles/
│       ├── base.css
│       ├── grid.css
│       └── card.css
```

#### Requirement: Orchestrator Pipeline
The orchestrator accepts injected ports, not direct dependencies.

#### Scenario: Full pipeline with graceful degradation
- **WHEN** `processIntent()` is called
- **THEN** it executes: (1) session hydrate → (2) cache check → (3) contact lookup → (4) graph expansion (skip if circuit open) → (5) agent generation (primary → fallback if fail) → (6) sanitization → (7) cache store → (8) session append → (9) audit log
- **AND** each step that calls an external adapter is wrapped in a circuit breaker
- **AND** every step is wrapped in `tracer.startActiveSpan()`

#### Requirement: Omni-Channel Architecture
Each transport layer is a thin adapter that depends on the same `OrchestratorService` interface.

#### Scenario: WhatsApp message routes through orchestrator
- **WHEN** a WhatsApp webhook delivers a user message
- **THEN** `worker.ts` validates the payload with Zod, checks rate limit (5 req/10s), checks idempotency via `IIdempotencyStore`, calls `orchestrator.processIntent()`, and sends the AI response via WhatsApp API. On send failure, the job goes to `IDeadLetterQueue`.

#### Scenario: Voice call routes through orchestrator
- **WHEN** a LiveKit voice call streams audio frames
- **THEN** `voice-agent.ts` runs STT via Deepgram, passes text to `orchestrator.processIntent()`, converts response to TTS (Cartesia), and pushes to LiveKit room.

#### Requirement: AST Firewall Enforcement
The system SHALL continue enforcing all 19 AST firewall rules at commit time. The firewall scans `features/`, `adapters/`, `core/`, and `agents/`.

**Rule 3 (Boundary Zod Wrap) improvement:** Two-tier check — ancestor (`Schema.parse()` wraps `fetch()` in the call chain) plus sibling-parse fallback that walks subsequent statements to find `.parse()` consuming the fetch result or its `.json()` output, including intermediate variables.

---

### Domain 2: Data & Storage

#### Requirement: Field-Level PII Encryption at Rest
The system SHALL encrypt sensitive PII fields before writing to Supabase. Decryption SHALL happen only at read time, in-memory, never persisted in plaintext.

**Encrypted fields:**
- `contacts.phone` — AES-256-GCM with per-row encryption key
- `contacts.email` — AES-256-GCM
- `calls.transcript_json` — AES-256-GCM (full transcript blob)
- `user_sessions.messages` — AES-256-GCM

**Key hierarchy:**
- Master encryption key from `ENCRYPTION_MASTER_KEY` env var (32-byte hex)
- Per-row key derived via HKDF: `HKDF(masterKey, salt: row_id, info: "contact|call|session")`
- Key rotation: re-encrypt on read with new master key when detected (lazy, transparent)

#### Scenario: Database breach — PII is unreadable
- **WHEN** an attacker gains direct access to the Supabase database
- **THEN** `contacts.phone`, `contacts.email`, and `calls.transcript_json` contain only AES-256-GCM ciphertext. Without the master key from the runtime environment, the data is unreadable.

#### Scenario: Key rotation
- **WHEN** `ENCRYPTION_MASTER_KEY` is rotated in the environment
- **THEN** on next read of an encrypted field, the system detects the old key ID, decrypts with the old key, re-encrypts with the new key, and writes back. Rotation is lazy and transparent.

#### Requirement: Webhook Idempotency
The system SHALL prevent duplicate processing of webhook events using an idempotency key store.

#### Scenario: WhatsApp redelivers the same webhook
- **WHEN** a webhook arrives with idempotency key `msg_12345`
- **THEN** `IIdempotencyStore.checkAndSet(key, ttl: 300)` returns `true` on first call (process it) and `false` on subsequent calls within 5 minutes (skip it). The duplicate SHALL be acknowledged with HTTP 200 to stop Meta from retrying.

#### Scenario: Idempotency store is unavailable
- **WHEN** Redis is unreachable for idempotency checks
- **THEN** the system falls back to a Supabase-based idempotency check on `idempotency_keys` table. If both fail, the webhook SHALL be processed anyway (at-least-once over at-most-once for availability).

#### Requirement: Semantic Cache (pgvector)
`ICacheStore` backed by Supabase pgvector. Content-addressable deduplication via `prompt_hash`.

- **Check:** `<=>` cosine distance operator, threshold 0.05. Table: `public.cache_embeddings` via `match_cache_embeddings` RPC.
- **Store:** INSERT embedding + response into cache. Response hash stored as `prompt_hash`.
- **Eviction:** LRU eviction. Cache entries older than 30 days since last access are soft-deleted on next read. Table has `accessed_at` timestamp for this purpose.
- **Constraint:** 768-dim Gemini embed-2 vectors. Cache only business-significant queries, not every keystroke or intermediate cache artifact.
- **Firewall Rule 9:** PG Vector Operator — ensures `<=>` operator usage is validated.
- **SLA Gate:** Cache hit rate >= 30% over rolling 1-hour window.

#### Requirement: Data Retention

| Data | Retention | Notes |
|---|---|---|
| `audit_logs` | 90 days | Immutable. INSERT only, no UPDATE/DELETE. |
| `cache_embeddings` | Indefinite (LRU eviction) | `accessed_at` timestamp for eviction targeting. |
| `idempotency_keys` | 300s TTL | Auto-expired by Redis/Supabase. |
| `dlq:*` jobs | Until replayed or purged | Operator action required. |
| `calls.transcript_json` | 90 days | Encrypted at rest. Beyond 90d → soft-delete. |
| `user_sessions.messages` | 90 days after last activity | Encrypted at rest. Cleaned on read. |

#### Free Tier Budgets

| Service | Limit | How We Stay Within It |
|---|---|---|
| Supabase | 500MB DB, 50K MAU, 2GB bandwidth | Compressed JSONB transcripts. No audio files in DB. |
| Supabase pgvector | Included in 500MB | 768-dim Gemini embed-2. Cache only business-significant queries. |
| Neo4j AuraDB Free | 200MB, 50K nodes, 175K edges | Sparse graph — only business-significant relationships. No raw transcript nodes. |
| LiveKit | 50GB/month free tier | Voice only, no video. Low concurrent rooms. |
| Cartesia | 200 hours free/month | Covers substantial call volume. |
| Mastra + AI models | Pay-per-use (Gemini/DeepSeek) | Semantic cache to skip model calls. DeepSeek cheaper for generation. |
| Ollama (local) | Your hardware (RAM/GPU) | Optional third-tier fallback. 7B model uses ~8GB RAM. Zero API cost. |
| Vercel deployment | 100GB bandwidth | Edge functions for API. Static dashboard. |
| Upstash Redis (free) | 256MB, 10K commands/day | Idempotency keys + BullMQ. |

---

### Domain 3: Error Handling & Fault Tolerance

#### Requirement: Graceful Degradation with Circuit Breakers
The system SHALL survive partial infrastructure failure without dropping requests.

**Circuit breaker policy per adapter:**
- 3 consecutive failures → circuit opens (stop calling for 30s)
- Half-open probe after cooldown → 1 request allowed through
- Success → circuit closes. Failure → reset cooldown.

**Fallback chain for AI context:**
1. Neo4j graph expansion → if open circuit: `NoOpGraphRetriever` returns empty context
2. Gemini embedding → if open circuit: `CachedEmbeddingProvider` returns last-known embedding
3. Gemini generation → if open circuit: fall back to DeepSeek → Ollama (conditional) → cached response with `{ degraded: true }`

#### Scenario: Neo4j is unreachable during WhatsApp message
- **WHEN** Neo4j circuit breaker is open after 3 failures
- **THEN** the orchestrator skips graph expansion, responds using only Supabase contact lookup + semantic cache context. The response SHALL include a degraded-mode indicator in logs but NOT in the user-facing message.

#### Scenario: Primary AI model fails mid-call
- **WHEN** Gemini API returns 500 or times out during a voice call
- **THEN** the orchestrator retries once, then falls back to DeepSeek. If both fail, a cached response is returned with `{ degraded: true }` metadata.

#### Requirement: Error Hierarchy
The system SHALL use a typed error hierarchy defined in `core/errors.ts`. Every error carries machine-readable metadata but never PII.

```
BaseError
├── IntegrationError(code, message, meta?)       — External API failure (PII auto-stripped)
├── DatabaseDomainError(code, message, meta?)    — Query/schema violation
├── GraphTraversalError                          — Neo4j traversal failure
├── CacheError                                   — pgvector read/write failure
└── CircuitBreakerOpenError                      — Adapter blocked by open circuit
```

**PII Safety:** `IntegrationError` constructor auto-strips known PII keys (`phone`, `email`, `transcript`, `token`, `authorization`) from `meta`. Firewall Rule 5 enforces this. Firewall Rule 13 extends the same guard to span attributes.

#### Requirement: Retry Policy
Every adapter has explicit retry parameters. Total max elapsed time includes all retries + backoff.

| Adapter | Retries | Delay Strategy | Max Elapsed | On Final Failure |
|---|---|---|---|---|
| WhatsApp outbound | 3 | Exponential (1s, 2s, 4s) | ~7s | DLQ |
| Gemini generation | 1 | Immediate | ~timeout + 1 call | DeepSeek fallback |
| Supabase queries | 2 | Linear (100ms, 200ms) | ~300ms | Error thrown |
| Neo4j traversal | 2 | Linear (100ms, 200ms) | ~300ms | Circuit breaker |
| Gemini embedding | 1 | Immediate | ~timeout + 1 call | CachedEmbeddingProvider |
| Redis (idempotency) | 0 | N/A | N/A | Supabase fallback |

#### Requirement: Dead Letter Queue for Async Tasks
The system SHALL route all failed asynchronous processing to a BullMQ dead-letter queue with structured failure context.

**Tasks that go through DLQ:**
- WhatsApp outbound message delivery failures — `dlq:whatsapp:{jobId}` with `{ contactId, messageSnippet, errorCode, attemptCount, lastAttemptedAt }`
- Post-call summarization job failures — `dlq:summarization:{jobId}` with `{ callId, errorCode }`
- Neo4j ingestion batch failures — `dlq:ingestion:{jobId}` with `{ batchSize, failedRows, errorCode }`
- Pipeline analyzer scheduled job failures — `dlq:pipeline:{jobId}` with `{ accountId, errorCode }`

#### Scenario: WhatsApp outbound message fails after 3 retries
- **WHEN** the WhatsApp API returns non-200 after 3 attempts with exponential backoff
- **THEN** the job is moved to `dlq:whatsapp:*` with full metadata. An operator can replay from the DLQ dashboard.

---

## III. OPERATIONAL DOMAINS

### Domain 4: Security

#### Requirement: RBAC with Audit Logging
The system SHALL enforce three explicit roles with Supabase RLS policies and log all CRM data access.

**Roles:**
| Role | Permissions |
|---|---|
| `admin` | Full CRUD on all tables, manage agents, view telemetry, replay DLQ |
| `agent` (sales rep) | Read/write own contacts, deals, calls. Read accounts. Create tickets. |
| `viewer` (read-only) | Read assigned contacts, accounts, deals. No mutations. |
| `service_role` (backend) | Bypass RLS for orchestrator operations. Never exposed to clients. |

**Audit log table `audit_logs`:**
- `id, actor_id, actor_role, action, entity_type, entity_id, timestamp, ip_address`
- Immutable — INSERT only, no UPDATE/DELETE permissions
- Retained for 90 days on free tier (see Domain 2)

#### Scenario: Agent views a contact
- **WHEN** an authenticated agent queries `contacts` via Supabase
- **THEN** RLS allows only contacts where `agent_id = auth.uid()`. The access is logged to `audit_logs`.

#### Scenario: Admin detects unauthorized access
- **WHEN** an admin queries `audit_logs`
- **THEN** they see: "viewer_123 accessed deal_456 at 14:32 UTC from IP 1.2.3.4" — even though viewers normally can't access deals, the failed attempt is logged.

#### Requirement: Secrets Management
The system SHALL validate at startup that no credential is missing, expired, or hardcoded. API keys SHALL never appear in logs, error messages, or span attributes.

#### Scenario: Missing credential on startup
- **WHEN** the process boots and `GEMINI_API_KEY` is unset
- **THEN** the startup validator crashes the process with: `FATAL: Missing required credential GEMINI_API_KEY. Check .env.` — the process NEVER enters a partially-running state.

#### Scenario: API key accidentally logged
- **WHEN** an error occurs during a Gemini API call
- **THEN** the error metadata SHALL include `statusCode` and `endpoint` but NEVER the `Authorization` header value. Firewall Rule 13 guards span attributes; firewall Rule 5 guards error metadata.

#### Requirement: Output Sanitization
`validateAndFilterOutput()` strips from all AI-generated output: profanity (regex blacklist), PII (phone numbers, emails via regex), and prompt injection patterns. Firewall Rule 10: Must be called after every AI generation.

#### Security Boundary Map
```
                         TRUST BOUNDARY
WhatsApp webhook   ─── Zod parse ───►  Internal State
Voice audio        ─── STT text ───►   (validated, typed)
Supabase Realtime  ─── Zod parse ───►
LiveKit transcript ─── Zod parse ───►

Internal State ───► Storage
  PII fields (phone, email, transcript):
    AES-256-GCM encrypt ──► Supabase (ciphertext only)

Storage ───► Read
  Supabase RLS policies enforced (Rule 8)
  All access logged → audit_logs (immutable)

AI Output ───► Response
  validateAndFilterOutput(): Strip PII, enforce length (Rule 10)

Logs / Telemetry ───► External
  No API keys, no PII in logs or span attributes (Rules 5, 13)
```

---

### Domain 5: Observability

#### Requirement: Telemetry Stack
- **Framework:** OpenTelemetry → Grafana Cloud Free
- **Traces:** Head-based sampling 10% production, 100% dev/chaos
- **Metrics:** 60s export interval, max 2,000 active series
- **Logs:** Structured JSON, WARN+ only in production, no stack traces in logs

**Span Rules:** 1 span per orchestrator step (8 spans/request max — Firewall Rule 14). No PII or API keys in span attributes (Rule 13).

**Key Metric Families:**
| Metric | Type | Purpose |
|---|---|---|
| `crm.cache.hits`, `crm.cache.requests` | Counter | Cache effectiveness |
| `crm.graph.traversal.duration_ms` | Histogram | Neo4j latency P50/P95/P99 |
| `crm.ai.generation.duration_ms` | Histogram | AI model latency |
| `crm.circuit_breaker.state` | Gauge | Per-adapter health |
| `crm.dlq.enqueued` | Counter | DLQ backlog per queue |
| `crm.errors.total` | Counter | Error rate by domain |
| `crm.webhooks.duplicate` | Counter | Idempotency hit rate |
| `crm.telemetry.metrics_active` | Gauge | Budget monitoring |
| `crm.telemetry.traces_bytes` | Counter | Monthly trace volume |

#### Requirement: Health and Readiness Endpoints
The system SHALL expose `/health` (liveness) and `/ready` (readiness) on a dedicated port (8280).

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /health` | Liveness — is the process alive? | `200 { status: "ok" }` |
| `GET /ready` | Readiness — can the process serve traffic? | `200` if all healthy. `503 { failures: [...] }` if degraded |

**Ready checks (run on each request, cached):**
- Supabase: fast `SELECT 1` (no cache)
- Neo4j: `CALL db.ping()` (cached 10s)
- Redis: `PING` (cached 5s)
- Gemini: cached startup result (re-validated every 60s)
- Circuit breaker states: all closed/half-open → healthy. Any open → degraded.

#### Scenario: Load balancer routes traffic
- **WHEN** a load balancer probes `GET /ready`
- **THEN** if Neo4j circuit breaker is open, the endpoint returns `503` with `{ failures: ["neo4j"] }`. The load balancer routes traffic elsewhere.

#### Scenario: Process is alive but not ready
- **WHEN** `GET /health` returns `200` but `GET /ready` returns `503`
- **THEN** the container is NOT killed (liveness passes), but traffic is NOT routed to it (readiness fails).

#### Telemetry Budget Ceilings (Grafana Cloud Free)
| Resource | Free Limit | Our Ceiling | Enforcement |
|---|---|---|---|
| Active metrics | 10,000 series | 2,000 series | 9 metric families × ~50 label combos = ~450 series |
| Trace volume | 50 GB/month | 5 GB/month | 10% head-based sampling |
| Log volume | 50 GB/month | 2 GB/month | WARN+ only, no stack traces |
| Span count/request | — | 8 spans/request max | Firewall Rule 14 |
| Metric interval | — | 60s | `PeriodicExportingMetricReader({ exportIntervalMillis: 60000 })` |

**Budget alerts:** `crm.telemetry.metrics_active` hits 80% of 2,000 → WARN log. 95% → ERROR log.

#### Operational SLA Gates
| Gate | Threshold | Measurement |
|---|---|---|
| Cache hit rate | >= 30% | Rolling 1-hour window |
| Idempotency hit rate | <= 5% | Rolling 1-hour window |
| Circuit breaker open duration | No breaker open > 60s | Continuous |
| DLQ queue depth | < 50 per queue | Current |
| AI generation failure rate | < 5% | Rolling 1-hour window |
| Health endpoint P95 | < 500ms | Rolling 5-minute window |

#### RAG Triad Quality Gates
Evaluated via DeepEval on a fixed 50-example golden dataset (20 WhatsApp, 15 voice, 15 mixed). Block merge on failure.

| Metric | Threshold | Consequence |
|---|---|---|
| Faithfulness | >= 0.90 | Block merge |
| Answer Relevancy | >= 0.85 | Block merge |
| Context Precision | >= 0.85 | Warn |

#### Pre-Commit Validation Pipeline
```
bun check           # 19-rule AST firewall. Exit 1 = blocked.
bun run validate    # Pre-commit quality gates
  ├── RAG triad (DeepEval on golden dataset)
  ├── P95 latency (simulated load against seed data)
  ├── Metric ceiling check (active series < 2,000)
  └── SLA gate check (cache hit rate, idempotency, CB state)
  → Output: scripts/validate-results.json. Exit 1 = blocked.
```

---

### Domain 6: Deployment

#### Requirement: Immutable Startup Configuration Validator
The system SHALL validate all external dependencies and required configuration BEFORE accepting any traffic. Validation is run-once at process start. If any check fails, the process exits with code 1 and descriptive error.

**Startup checks (in order):**
1. All required env vars are present (Zod `envSchema.parse(process.env)`)
2. Supabase connectivity: `SELECT 1` on `contacts` table
3. Neo4j connectivity: `CALL db.ping()`
4. Redis connectivity: `PING`
5. Gemini API key validity: one lightweight embedding call
6. BullMQ queue is reachable

#### Scenario: Supabase is unreachable at boot
- **WHEN** the process starts and Supabase connection times out
- **THEN** the process logs `FATAL: Supabase unreachable after 3 attempts` and exits with code 1. No HTTP port is ever opened.

#### Scenario: All checks pass
- **WHEN** all 6 startup checks succeed
- **THEN** `ConfigValidator.report()` logs a structured JSON summary and the HTTP server starts accepting requests.

#### CI/CD Pipeline (Planned)
Target platform: GitHub Actions. Runs on every push to a feature branch.

```
bun install
bun check        # AST firewall — 0 violations required
bun test         # Unit + contract tests — 0 failures required
bun run validate # SLA gates + RAG triad — pass required
→ deploy to staging → manual approval → deploy to production
```

No Dockerfile or containerization for this stage. Vercel deployment handles the production path.

---

### Domain 7: Disaster Recovery

#### Recovery Coverage
| Failure Mode | Recovery Path | RTO Target | RPO Target |
|---|---|---|---|
| Supabase data loss | Restore from `pg_dump` backup, re-run `scripts/ingest.ts` | < 4 hours | < 24 hours |
| Neo4j data loss | Rebuild from Supabase via `scripts/ingest.ts` | < 1 hour | < 1 hour |
| Redis data loss | Transient only — idempotency keys (300s TTL), BullMQ state reconstructable | < 5 minutes | N/A (ephemeral) |
| Encryption key compromise | Lazy re-encrypt on read — rotate `ENCRYPTION_MASTER_KEY`, deploy new env | < 1 hour | N/A |
| Async job loss | DLQ stores failure context — replay on recovery | < 1 hour | N/A |

#### Backup Strategy (Planned)
- **Supabase:** Daily `pg_dump` to encrypted external storage. 30-day retention.
- **Neo4j:** Weekly `neo4j-admin dump` (graph is reconstructable from Supabase — backup is convenience).
- **Redis:** Not backed up. Ephemeral by design.
- **Key material:** `ENCRYPTION_MASTER_KEY` is an env var — stored in Vercel env, never in code.

#### DLQ as Recovery Mechanism
All async failures are preserved in BullMQ dead-letter queues with full metadata. Recovery = replay from DLQ. No manual data reconstruction needed for transient failures.

---

### Domain 8: Developer Experience

#### Requirement: Unit Test Discipline
The system SHALL include a minimal test suite using `bun test` (zero additional dependencies). Tests target only non-trivial logic.

**What gets tested (non-trivial logic where silent breakage causes harm):**
| Module | Risk if broken | One test |
|---|---|---|
| `sanitize.ts` | AI outputs raw PII to customers | Does "call me at 555-1234" → "[REDACTED]"? |
| `errors.ts` | PII leaks into error metadata in logs | Does `IntegrationError` strip `phone` from meta? |
| `circuit-breaker.ts` | Never opens → hammer dead adapter forever | After 3 failures, is state "open"? |
| `field-encryption.ts` | Can't decrypt what was stored | encrypt → decrypt roundtrip matches original |
| `orchestrator.ts` | Pipeline steps run out of order or skip | Mock all ports, verify each step was called |
| Each adapter | Wrong query, wrong return type | Contract test: implements interface + returns Zod-valid data |

**What gets NO test:** Trivial one-liners, type definitions, barrel exports, `logger.ts` (wrapper), `env-schema.ts` (crashes at import), health router (5-line Bun.serve).

**Test layout:** `__tests__/` next to the code. No coverage targets. No integration tests in CI. No mock frameworks — only `bun` built-in mock. Suite completes < 5s with no external dependencies.

#### Local Development Quick Start
```bash
# Prerequisites: Bun >= 1.3.0, Docker (for local Supabase)
git clone <repo>
cd knowledge-graph-repo-master
bun install

# Start local Supabase
supabase start

# Configure
cp .env.template .env
# Fill in: GEMINI_API_KEY, DEEPSEEK_API_KEY, ENCRYPTION_MASTER_KEY (32-byte hex)
#           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEO4J_URI, NEO4J_PASSWORD, REDIS_URL

# Apply migrations + seed
supabase db push
bun run scripts/seed.ts
bun run scripts/ingest.ts

# Verify
bun check      # AST firewall — 0 violations
bun test       # Unit tests — 0 failures

# Run
bun run scripts/worker.ts       # WhatsApp webhook consumer
bun run scripts/voice-agent.ts  # LiveKit voice agent
bun dev:web                     # Dashboard on localhost:5173
```

#### UI Dashboard — Read-Only Operator Workspace
The system SHALL provide a read-only operator dashboard in `apps/web/` using **Vite + Vanilla TypeScript + Motion One**.

**Stack:**
| Layer | Choice | Justification |
|---|---|---|
| Bundler | Vite 6+ | Zero-config TS, HMR. No framework lock-in. |
| Runtime | Vanilla TypeScript | Direct DOM manipulation. No virtual DOM. |
| Animation | Motion One 4.x | 3 KB. Native Web Animations API. |
| Styling | CSS custom properties + `@container` queries | Platform-native. No Tailwind/CSS-in-JS. |
| State | EventTarget-based store | Lightweight pub/sub. No Redux/Zustand. |

**Data consumed (read-only):**
- Supabase Realtime → `deals`, `contacts`, `calls` table changes (WebSocket)
- LiveKit → transcript stream (WebSocket)
- `GET /ready` on port 8280 → circuit breaker states
- OTel Prometheus endpoint → cache hit rate, active calls (polled 10s)

#### Scenario: Dashboard loads during active call
- **WHEN** an operator opens `apps/web` during a live voice call
- **THEN** the dashboard connects to all three data sources without blocking each other. If any fails, its panel shows a dimmed "data unavailable" state — never a spinner or modal.

#### UI Dashboard — Asymmetrical Workspace Layout
Pure black (`#000`) CSS Grid with two asymmetrical zones.

```
+-----------------------------+------------+
|                             |  Circuit   |
|   TRANSCRIPT STREAM          |  Status    |
|   (65% width)               |  (35%)     |
|                             |            |
|   Live scrolling text       |  Sentinel  |
|   Speaker labels            |  Card      |
|   Sentiment markers         |            |
|                             |  Metrics   |
|                             |  Grid      |
+-----------------------------+------------+
|  CONTACT CONTEXT BAR (100% width, 80px)  |
+------------------------------------------+
```

**Zones:**
1. **Transcript Stream** (65%) — LiveKit text frames. Customer left/agent right. Sentiment left-border color. `Inter` monospace, `#999` on `#000`.
2. **Metrics Sidebar** (35%) — Magnetic cards: Circuit Breaker Sentinel, Cache Health (SVG circular), Active Call (timer + sparkline), Deals at Risk.
3. **Contact Context Bar** (100%, 80px, bottom-fixed) — During call: name, account, deals. Outside call: system status.

#### UI Dashboard — Magnetic Card Cursor Tracking
Every card responds to cursor proximity with 3D tilt (±12°). Implemented via Motion One `animate()`. Touch disabled via `matchMedia("(hover: hover)")`. `will-change: transform` during animation, removed on leave.

#### UI Dashboard — Ambient Radar Border Glows
`::before` pseudo-element with `radial-gradient` mask tracking cursor pixel position. `pointer-events: none`. `rgba(255,255,255,0.06)`. Touch disabled via same media query.

---

### Domain 9: Legal/Compliance

#### Current Coverage
| Requirement | Status | Reference |
|---|---|---|
| PII encrypted at rest | **Done** | Domain 2 — AES-256-GCM + HKDF |
| PII encrypted in transit | **Done** | HTTPS/TLS on all external APIs |
| Access control (RBAC) | **Done** | Domain 4 — 3 roles + RLS |
| Audit logging | **Done** | Domain 4 — `audit_logs`, immutable, 90d |
| Data retention policy | **Defined** | Domain 2 — per-table retention |
| DSAR (access request) | **Planned** | `scripts/dsar-export.ts` |
| Right to erasure | **Planned** | `scripts/dsar-delete.ts` |
| DPA with subprocessors | **Not started** | Required before processing EU data |
| Privacy policy | **Not started** | Required before public access |
| Incident response plan | **Partially covered** | Key rotation + recovery in Domain 7 |

#### When This Domain Grows
- Processing EU citizen data → implement DSAR + erasure + verify DPA availability on all free tiers
- Public launch → draft privacy policy + terms of service
- Regulatory audit → extend audit log retention, add data processing register

---

## IV. QUANTIFIABLE SUCCESS METRICS & SLA GATES

Every requirement in this spec is verifiable. A feature branch is **not valid for merge** unless all gates pass.

### 4.1 API Latency P95 Bounds
Must hold under seed data load (25 contacts, 15 deals, 8 calls, 5 tickets in Supabase; 50+ nodes in Neo4j).

| Channel | Operation | P95 Threshold | Why This Number |
|---|---|---|---|
| WhatsApp webhook | End-to-end → response | < 2.0s | Meta retries after 2-3s. Slower = duplicate. |
| WhatsApp webhook | Idempotency check | < 50ms | Must not add latency. |
| Voice | STT → orchestrator → TTS | < 1.5s | > 1.5s = unnatural pause. |
| Orchestrator | Full pipeline (cache miss) | < 3.0s | Cold path ceiling. |
| Orchestrator | Cache hit path | < 200ms | Vector lookup. |
| Graph expansion | 2-hop traversal | < 500ms | Neo4j free tier. |
| Embedding API | Gemini single text | < 1.0s | Gemini free tier. |

### 4.2 Golden Dataset & RAG Triad
50 CRM conversation examples (20 WhatsApp + 15 voice + 15 mixed intent) evaluated via DeepEval.

| Metric | Threshold | Consequence |
|---|---|---|
| Faithfulness | >= 0.90 | Block merge |
| Answer Relevancy | >= 0.85 | Block merge |
| Context Precision | >= 0.85 | Warn |

### 4.3 Telemetry Budget Ceilings
| Resource | Our Ceiling | Enforcement |
|---|---|---|
| Active metrics | 2,000 series | `crm.telemetry.metrics_active` gauge |
| Trace volume | 5 GB/month | `crm.telemetry.traces_bytes` counter |
| Log volume | 2 GB/month | WARN+ only in prod |
| Span count | 8/request max | Firewall Rule 14 |
| Metric interval | 60s | OTEL config |

Budget alerts at 80% (WARN) and 95% (ERROR).

### 4.4 Pre-Commit Pipeline
```
bun check           # 19-rule AST firewall. Exit 1 = blocked.
bun run validate    # Aggregates all gates below
  ├── RAG triad (DeepEval on golden dataset)
  ├── P95 latency (simulated load against seed data)
  ├── Metric ceiling check (active series < 2,000)
  └── SLA gate check (cache hit rate >= 30%, idempotency <= 5%, CB state, DLQ depth)
  → Output: scripts/validate-results.json. Exit 1 = blocked.
```

---

## V. REMOVED REQUIREMENTS
- Flat domain model structure (`domain/contact.ts`, `domain/deal.ts` etc.) — replaced by vertical feature slices
- Direct adapter imports in orchestrator — replaced by port injection
- Hardcoded single-provider dependencies — replaced by fallback chains

---

## VI. Impact
- **Affected specs:** Replaces previous `production-grade-graphrag-core` spec
- **Architecture change: BREAKING** — new directory layout, new injection pattern, new port interfaces
- **Existing firewall:** Still valid, scan paths updated to `features/`, `adapters/`, `core/`, `agents/`
