# Production-Grade AI CRM — Hybrid Hexagonal + Free Tier

## Why
Rebuild the codebase as an **AI-powered CRM** converging **WhatsApp** (webhook), **realtime voice** (LiveKit), and **web UI** (future) into one AI orchestrator. The previous `production-grade-graphrag-core` spec was monolithic (orchestrator directly instantiates all dependencies) and had critical gaps in operational resilience, security, and deployment readiness. This spec addresses all four production pillars.

## Architecture Decision
**Hybrid Feature-Driven Hexagonal.** Vertical slices under `features/` for CRM domain cohesion. Core orchestration depends on TypeScript **interfaces (ports)**, not concrete adapters. Adapters live in `adapters/` and implement those ports. Every external boundary (Neo4j, Gemini, Deepgram, Supabase) has a **fallback adapter** for graceful degradation.

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

## Free Tier Constraints

| Service | Limit | How We Stay Within It |
|---|---|---|
| Supabase | 500MB DB, 50K MAU, 2GB bandwidth | Compressed JSONB transcripts. No audio files in DB. |
| Supabase pgvector | Included in 500MB | 768-dim Gemini embed-2. Cache only business-significant queries. |
| Neo4j AuraDB Free | 200MB, 50K nodes, 175K edges | Sparse graph — only business-significant relationships. No raw transcript nodes. |
| LiveKit | 50GB/month free tier | Voice only, no video. Low concurrent rooms. |
| Deepgram STT | 200 hours free/month | Covers substantial call volume. |
| Mastra + AI models | Pay-per-use (Gemini/DeepSeek) | Semantic cache to skip model calls. DeepSeek for generation (cheaper). Fallback: DeepSeek if Gemini fails. |
| Vercel deployment | 100GB bandwidth | Edge functions for API. Static dashboard. |
| Upstash Redis (free) | 256MB, 10K commands/day | Idempotency keys + BullMQ. |

---

## ADDED Requirements

### Pillar 1: Operational — Fault Tolerance & Resilience

#### Requirement: Graceful Degradation with Circuit Breakers
The system SHALL survive partial infrastructure failure without dropping requests.

**Circuit breaker policy per adapter:**
- 3 consecutive failures → circuit opens (stop calling for 30s)
- Half-open probe after cooldown → 1 request allowed through
- Success → circuit closes. Failure → reset cooldown.

**Fallback chain for AI context:**
1. Neo4j graph expansion → if open circuit: `NoOpGraphRetriever` returns empty context
2. Gemini embedding → if open circuit: `CachedEmbeddingProvider` returns last-known embedding
3. Gemini generation → if open circuit: fall back to DeepSeek

#### Scenario: Neo4j is unreachable during WhatsApp message
- **WHEN** Neo4j circuit breaker is open after 3 failures
- **THEN** the orchestrator skips graph expansion, responds using only Supabase contact lookup + semantic cache context. The response SHALL include a degraded-mode indicator in logs but NOT in the user-facing message.

#### Scenario: Primary AI model fails mid-call
- **WHEN** Gemini API returns 500 or times out during a voice call
- **THEN** the orchestrator retries once, then falls back to DeepSeek. If both fail, a cached response is returned with `{ degraded: true }` metadata.

#### Requirement: Dead Letter Queue for Async Tasks
The system SHALL route all failed asynchronous processing to a BullMQ dead-letter queue with structured failure context.

**Tasks that go through DLQ:**
- WhatsApp outbound message delivery failures
- Post-call summarization job failures
- Neo4j ingestion batch failures
- Pipeline analyzer scheduled job failures

#### Scenario: WhatsApp outbound message fails after 3 retries
- **WHEN** the WhatsApp API returns non-200 after 3 attempts with exponential backoff
- **THEN** the job is moved to `dlq:whatsapp:*` with metadata: `{ contactId, messageSnippet, errorCode, attemptCount, lastAttemptedAt }`. An operator can replay from the DLQ dashboard.

#### Requirement: Webhook Idempotency
The system SHALL prevent duplicate processing of webhook events using an idempotency key store.

#### Scenario: WhatsApp redelivers the same webhook
- **WHEN** a webhook arrives with idempotency key `msg_12345`
- **THEN** `IIdempotencyStore.checkAndSet(key, ttl: 300)` returns `true` on first call (process it) and `false` on subsequent calls within 5 minutes (skip it). The duplicate SHALL be acknowledged with HTTP 200 to stop Meta from retrying.

#### Scenario: Idempotency store is unavailable
- **WHEN** Redis is unreachable for idempotency checks
- **THEN** the system falls back to a Supabase-based idempotency check on `idempotency_keys` table. If both fail, the webhook SHALL be processed anyway (at-least-once over at-most-once for availability).

---

### Pillar 2: Developmental — SOLID + Compile-Time Contracts

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
- `IIdempotencyStore` — `checkAndSet(key, ttl)`
- `IDeadLetterQueue` — `enqueue(queue, job, errorMeta)`
- `ICacheStore` — `check(embedding)`, `store(embedding, response)`

#### Scenario: Adding a new embedding provider
- **WHEN** a developer wants to switch from Gemini to a local embedding model
- **THEN** they implement `IEmbeddingProvider` in a new adapter file and inject it into orchestrator config. Zero changes to orchestrator internals.

#### Scenario: Testing the orchestrator without infrastructure
- **WHEN** a unit test runs
- **THEN** all ports are injected as mocks. The test verifies orchestrator pipeline logic without touching Supabase, Neo4j, or any AI model.

#### Requirement: AST Firewall Enforcement (Existing — Unchanged)
The system SHALL continue enforcing all 15 AST firewall rules at commit time. The firewall now scans `features/`, `adapters/`, `core/`, and `agents/` in addition to existing paths.

---

### Pillar 3: Security — PII Encryption + RBAC + Secrets

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
- Key rotation: re-encrypt on read with new master key when detected

#### Scenario: Database breach — PII is unreadable
- **WHEN** an attacker gains direct access to the Supabase database
- **THEN** `contacts.phone`, `contacts.email`, and `calls.transcript_json` contain only AES-256-GCM ciphertext. Without the master key from the runtime environment, the data is unreadable.

#### Scenario: Key rotation
- **WHEN** `ENCRYPTION_MASTER_KEY` is rotated in the environment
- **THEN** on next read of an encrypted field, the system detects the old key ID, decrypts with the old key, re-encrypts with the new key, and writes back. Rotation is lazy and transparent.

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
- Retained for 90 days on free tier

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
- **THEN** the error metadata SHALL include `statusCode` and `endpoint` but NEVER the `Authorization` header value. Firewall Rule 13 already guards span attributes; firewall Rule 5 guards error metadata.

---

### Pillar 4: Deployment — Config Validation + Health Endpoints

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
- **THEN** the process logs `FATAL: Supabase unreachable after 3 attempts` and exits with code 1. The container orchestrator (Vercel, Docker, K8s) restarts it. No HTTP port is ever opened.

#### Scenario: All checks pass
- **WHEN** all 6 startup checks succeed
- **THEN** `ConfigValidator.report()` logs a structured JSON summary and the HTTP server starts accepting requests.

#### Requirement: Health and Readiness Endpoints
The system SHALL expose `/health` (liveness) and `/ready` (readiness) HTTP endpoints on a dedicated port (8280).

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /health` | Liveness — is the process alive? | `200 { status: "ok" }` — always returns 200 if process is running |
| `GET /ready` | Readiness — can the process serve traffic? | `200` if all adapters healthy. `503` with `{ failures: ["neo4j", "redis"] }` if any adapter is down |

**Ready checks (run on each request):**
- Supabase: fast `SELECT 1`
- Neo4j: `CALL db.ping()` (cached for 10s to avoid overhead)
- Redis: `PING` (cached for 5s)
- Gemini: cached result from startup (re-validated every 60s)
- Circuit breaker states: all closed or half-open → healthy. Any open → degraded.

#### Scenario: Load balancer routes traffic
- **WHEN** a load balancer probes `GET /ready`
- **THEN** if Neo4j circuit breaker is open, the endpoint returns `503` with `{ failures: ["neo4j"] }`. The load balancer routes traffic to another instance (or the degraded instance accepts traffic without graph context).

#### Scenario: Process is alive but not ready
- **WHEN** `GET /health` returns `200` but `GET /ready` returns `503`
- **THEN** the container is NOT killed (liveness passes), but traffic is NOT routed to it (readiness fails). This enables graceful degradation without container churn.

---

## MODIFIED Requirements

### Requirement: Code Layout — Vertical Slices with Hexagonal Boundaries
(Replaces the flat `domain/` + separate tools layout)

**Directory structure:**
```
packages/ai-core/src/
├── features/          # Vertical CRM slices
│   ├── contacts/      # Contact types, IContactStore, Mastra tools, Supabase adapter
│   ├── deals/         # Deal types, IDealStore, tools
│   ├── calls/         # Call types, ICallStore, Deepgram adapter, summarizer
│   ├── accounts/      # Account types, IAccountStore
│   ├── tickets/       # Ticket types, ITicketStore
│   └── pipeline/      # PipelineStage types, analyzer agent
├── core/              # Shared kernel
│   ├── orchestrator.ts  # Depends on ports from ports.ts
│   ├── ports.ts         # All TypeScript interfaces
│   ├── errors.ts        # IntegrationError, DatabaseDomainError, etc.
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
│   ├── startup-validator.ts  # Boot-time checks
│   └── env-schema.ts         # Zod schema for all env vars
├── health/
│   ├── health-router.ts      # /health and /ready endpoints
│   └── health-checks.ts      # Per-adapter health check functions
└── index.ts                   # Barrel export
```

### Requirement: Omni-Channel Architecture (Modified)
Each transport layer is now a thin adapter that depends on the same `OrchestratorService` interface.

#### Scenario: WhatsApp message routes through orchestrator (unchanged)
- **WHEN** a WhatsApp webhook delivers a user message
- **THEN** `worker.ts` validates the payload with Zod, checks rate limit (5 req/10s), checks idempotency via `IIdempotencyStore`, calls `orchestrator.processIntent()`, and sends the AI response via WhatsApp API. On send failure, the job goes to `IDeadLetterQueue`.

#### Scenario: Voice call routes through orchestrator (unchanged)
- **WHEN** a LiveKit voice call streams audio frames
- **THEN** `voice-agent.ts` runs STT via Deepgram, passes text to `orchestrator.processIntent()`, converts response to TTS audio, and pushes to LiveKit room.

### Requirement: Orchestrator Pipeline (Modified)
The orchestrator now accepts injected ports, not direct dependencies.

#### Scenario: Full pipeline with graceful degradation
- **WHEN** `processIntent()` is called
- **THEN** it executes: (1) session hydrate → (2) cache check → (3) contact lookup → (4) graph expansion (skip if circuit open) → (5) agent generation (primary → fallback if fail) → (6) sanitization → (7) cache store → (8) session append
- **AND** each step that calls an external adapter is wrapped in a circuit breaker
- **AND** every step is wrapped in `tracer.startActiveSpan()`

---

## REMOVED Requirements
- Flat domain model structure (`domain/contact.ts`, `domain/deal.ts` etc.) — replaced by vertical feature slices
- Direct adapter imports in orchestrator — replaced by port injection
- Hardcoded single-provider dependencies — replaced by fallback chains

---

## Impact
- Affected specs: replaces previous `production-grade-graphrag-core` spec
- Architecture change: **BREAKING** — new directory layout, new injection pattern, new port interfaces
- Existing firewall: still valid, scan paths updated to `features/`, `adapters/`, `core/`, `agents/`
