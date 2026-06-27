# Production-Grade AI CRM — Hybrid Hexagonal + Free Tier

## Why
Rebuild the codebase as an **AI-powered CRM** converging **WhatsApp** (webhook), **realtime voice** (LiveKit), and a **lightweight read-only web dashboard** (Vite + Vanilla TS + Motion One in `apps/web/`) into one AI orchestrator. The previous `production-grade-graphrag-core` spec was monolithic (orchestrator directly instantiates all dependencies) and had critical gaps in operational resilience, security, and deployment readiness. This spec addresses all four production pillars.

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

## Free Tier Constraints

| Service | Limit | How We Stay Within It |
|---|---|---|
| Supabase | 500MB DB, 50K MAU, 2GB bandwidth | Compressed JSONB transcripts. No audio files in DB. |
| Supabase pgvector | Included in 500MB | 768-dim Gemini embed-2. Cache only business-significant queries. |
| Neo4j AuraDB Free | 200MB, 50K nodes, 175K edges | Sparse graph — only business-significant relationships. No raw transcript nodes. |
| LiveKit | 50GB/month free tier | Voice only, no video. Low concurrent rooms. |
| Cartesia | 200 hours free/month | Covers substantial call volume. |
| Mastra + AI models | Pay-per-use (Gemini/DeepSeek) | Semantic cache to skip model calls. DeepSeek for generation (cheaper). Fallback: DeepSeek if Gemini fails. Third tier: Ollama (local, $0) when both cloud APIs unreachable. |
| Ollama (local) | Your hardware (RAM/GPU) | Optional third-tier fallback. 7B model uses ~8GB RAM. Zero API cost. Conditional on LOCAL_LLM_URL env var. |
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

#### Requirement: Local Model Fallback (Ollama)
The system SHALL support a third-tier `IAgentProvider` implementation using a local Ollama instance. This tier activates ONLY when both Gemini and DeepSeek circuits are open, making the AI pipeline fully operational at zero API cost when cloud providers are unreachable.

**Activation:** The fallback chain is: `Gemini → DeepSeek → Ollama → cached response`. The Ollama tier is conditional — included only when `LOCAL_LLM_URL` env var is set. If unset, the chain skips from DeepSeek directly to cached response.

**Expected quality trade-off:** Local 7B models (Llama 3.1, Mistral, Qwen 2.5) will not match Gemini's CRM reasoning quality for complex deal analysis or multi-turn context. They are adequate for simple lookups ("what's the status of deal X?") and serve as a safety net rather than a primary provider.

#### Scenario: All cloud APIs unreachable, Ollama available
- **WHEN** both Gemini and DeepSeek circuit breakers are open AND `LOCAL_LLM_URL` is set
- **THEN** the orchestrator routes AI generation to `OllamaLocalProvider`. The response carries `{ degraded: true, modelUsed: "ollama" }` in metadata. The customer receives an acceptable response for simple queries.

#### Scenario: Ollama not installed or unconfigured
- **WHEN** `LOCAL_LLM_URL` is unset and both cloud APIs are down
- **THEN** the orchestrator returns a cached response (if available) or an error. The Ollama tier is silently skipped.

#### Scenario: Testing the orchestrator without infrastructure
- **WHEN** a unit test runs
- **THEN** all ports are injected as mocks. The test verifies orchestrator pipeline logic without touching Supabase, Neo4j, or any AI model.

#### Requirement: AST Firewall Enforcement (Existing — Enhanced)
The system SHALL continue enforcing all 19 AST firewall rules at commit time. The firewall now scans `features/`, `adapters/`, `core/`, and `agents/` in addition to existing paths.

**Rule 3 (Boundary Zod Wrap) improvement:** Uses a two-tier check — ancestor (`Schema.parse()` wraps `fetch()` in the call chain) plus a sibling-parse fallback that walks subsequent statements to find `.parse()` consuming the fetch result or its `.json()` output, including intermediate variables.

#### Requirement: Unit Test Discipline
The system SHALL include a minimal test suite using `bun test` (zero additional dependencies). Tests target only non-trivial logic — trivial one-liners, type definitions, and barrel exports are excluded.

**What gets tested (non-trivial logic where silent breakage causes harm):**
| Module | Risk if broken | One test |
|---|---|---|
| `sanitize.ts` | AI outputs raw PII to customers | Does "call me at 555-1234" → "[REDACTED]"? |
| `errors.ts` | PII leaks into error metadata in logs | Does `IntegrationError` strip `phone` from meta? |
| `circuit-breaker.ts` | Never opens → hammer dead adapter forever | After 3 failures, is state "open"? |
| `field-encryption.ts` | Can't decrypt what was stored | encrypt → decrypt roundtrip matches original |
| `orchestrator.ts` | Pipeline steps run out of order or skip | Mock all ports, verify each step was called |
| Each adapter | Wrong query, wrong return type | Contract test: implements interface + returns Zod-valid data |

**What gets NO test (trivial, compiler-verified, or self-announcing on failure):**
- `ports.ts` domain types — TypeScript compiler verifies these
- `index.ts` barrel export — wrong export → nothing imports, compiler catches it
- `logger.ts` — `console.log` wrapper; PII sanitization tested via `errors.test.ts`
- `env-schema.ts` — crashes at import on bad env, immediately visible
- Feature type files — type definitions, compiler is the test
- `health-router.ts` — 5-line `Bun.serve`, trivial

**Test layout:** Each test lives in `__tests__/` next to the code it tests. No coverage targets. No integration tests in CI (needs real services — those are the SLA gates in Task 13). No mock framework (bun has `mock` built in).

#### Scenario: Adding a new adapter
- **WHEN** a developer adds `adapters/ai/local-model-provider.ts`
- **THEN** they also add `adapters/ai/__tests__/local-model-provider.test.ts` with a contract test verifying the interface is implemented and return types match Zod schemas. The test is 20-40 lines.

#### Scenario: Running the test suite
- **WHEN** `bun test` runs
- **THEN** all `__tests__/` directories under `packages/ai-core/src/` are executed. The suite completes in under 5 seconds with no external service dependencies.

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

### Pillar 4a: UI Layer — Lightweight Read-Only Dashboard

#### Requirement: Isolated Frontend Package
The system SHALL provide a read-only operator dashboard in `apps/web/` using **Vite + Vanilla TypeScript + Motion One**. The frontend consumes data exclusively through HTTP and WebSocket — it never imports `packages/ai-core/`, never calls the orchestrator directly, and never mutates CRM state.

**Stack:**
| Layer | Choice | Justification |
|---|---|---|
| Bundler | Vite 6+ | Zero-config TS, HMR, tree-shaking. No framework lock-in. |
| Runtime | Vanilla TypeScript | Direct DOM manipulation. No virtual DOM overhead, no hydration. |
| Animation | Motion One 4.x | 3 KB. Native Web Animations API. GPU-accelerated CSS transforms (`rotateX`, `rotateY`, `matrix3d`). |
| Styling | CSS custom properties + `@container` queries | The platform already does this. No Tailwind, no CSS-in-JS. |
| State | EventTarget-based store | Lightweight pub/sub. No Redux, Zustand, or signals library needed. |

**Data consumed by UI (read-only):**
- Supabase Realtime → `deals`, `contacts`, `calls` table changes (WebSocket push)
- LiveKit → transcript stream (WebSocket, raw text frames displayed in transcript pane)
- `GET /ready` on port 8280 → circuit breaker states, adapter health
- OTel Prometheus endpoint → cache hit rate, active calls gauge (polled every 10s)

#### Scenario: Dashboard loads during active call
- **WHEN** an operator opens `apps/web` in a browser during a live voice call
- **THEN** the dashboard connects to Supabase Realtime (contacts, deals, call metadata), LiveKit (transcript stream), and `/ready` (health), rendering all three data sources without blocking each other. If any data source fails, its panel shows a dimmed "data unavailable" state — the dashboard never shows a spinner or blocks.

#### Scenario: Circuit breaker opens during viewing
- **WHEN** Neo4j's circuit breaker opens while the dashboard is open
- **THEN** the metrics sidebar updates the circuit breaker indicator from green → amber → red within 60s (next `/ready` poll). The transcript pane is unaffected. The operator sees the degradation without any modal or interruption.

#### Requirement: Asymmetrical Workspace Layout
The dashboard SHALL render as a pure black (`#000`) CSS Grid workspace with two asymmetrical zones.

**Grid definition:**
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
1. **Transcript Stream** (65% width, full height minus 80px bottom bar) — LiveKit text frames appended to a scroll container. Speaker segments alternated visually (left-aligned for customer, right-aligned for agent). Sentiment indicators as subtle left-border color shifts. Typography: `Inter` monospace variant, `#999` on `#000`.

2. **Metrics Sidebar** (35% width) — Stack of magnetic cards:
   - Circuit Breaker Sentinel Card — adapter name, state (green/amber/red), last transition time
   - Cache Health Card — hit rate gauge (circular SVG percentage), current throughput
   - Active Call Card — call duration timer, sentiment trend mini-sparkline
   - Deals at Risk Card — count of stalled deals, top deal name

3. **Contact Context Bar** (100% width, 80px height, bottom-fixed) — During a call: contact name, account, open deals count, last interaction date. Outside a call: system status summary.

**Pure black rationale:** Workspace displays sensitive CRM data. Pure black reduces eye fatigue during long monitoring sessions (operators may watch calls for hours). High-contrast text (`#999` body, `#fff` headings) remains readable. No decorative backgrounds — the data is the focus.

#### Requirement: Magnetic Card Cursor Tracking
Every card in the Metrics Sidebar SHALL respond to cursor proximity with a 3D tilt effect computed from pointer position relative to card center.

**Implementation (Motion One):**
```ts
// Per card: mousemove listener → Motion One animate()
card.addEventListener("mousemove", (e: MouseEvent) => {
  const rect = card.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5 to +0.5
  const y = (e.clientY - rect.top) / rect.height - 0.5;
  animate(card, {
    rotateX: y * -12,   // degrees — tilt away from cursor
    rotateY: x * 12,
  }, { duration: 0.3, easing: [0.22, 0.61, 0.36, 1] }); // custom ease-out
});

card.addEventListener("mouseleave", () => {
  animate(card, { rotateX: 0, rotateY: 0 }, { duration: 0.6 });
});
```

**Constraints:**
- `transform-style: preserve-3d` and `perspective: 800px` set on card container.
- Maximum tilt: ±12 degrees. Content inside card SHALL remain readable at all angles.
- Touch devices: effect disabled. `matchMedia("(hover: hover)")` guards the listener registration.
- Performance: `will-change: transform` set during animation, removed on `mouseleave`. No layout thrashing — only compositor-layer properties modified.

#### Requirement: Ambient Radar Border Glows
Card hover states SHALL cast a `radial-gradient` mask that tracks the raw cursor pixel position over the card element, creating a subtle spotlight border effect.

**Implementation (CSS custom property driven by mousemove):**
```ts
card.addEventListener("mousemove", (e: MouseEvent) => {
  const rect = card.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * 100; // 0-100%
  const py = ((e.clientY - rect.top) / rect.height) * 100;
  card.style.setProperty("--cursor-x", `${px}%`);
  card.style.setProperty("--cursor-y", `${py}%`);
});
```

```css
.magnetic-card {
  position: relative;
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 12px;
}

.magnetic-card::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: radial-gradient(
    250px circle at var(--cursor-x, 50%) var(--cursor-y, 50%),
    rgba(255, 255, 255, 0.06),
    transparent 60%
  );
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
}

.magnetic-card:hover::before {
  opacity: 1;
}
```

**Constraints:**
- Glow is a `::before` pseudo-element — no extra DOM nodes.
- `pointer-events: none` on the glow so it never blocks card interaction.
- Gradient size: 250px circle (smaller than card, creating edge-aware spotlight).
- Color: `rgba(255,255,255,0.06)` — extremely subtle. Data readability must never be affected.
- Touch devices: disabled via `matchMedia("(hover: hover)")`.

---

### Pillar 4b: Deployment — Config Validation + Health Endpoints

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
│   ├── calls/         # Call types, ICallStore, Cartesia adapter, summarizer
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

apps/web/                    # Read-only operator dashboard
├── index.html               # Entry point
├── vite.config.ts           # Vite config (zero plugins, vanilla TS)
├── tsconfig.json
├── src/
│   ├── main.ts              # App bootstrap, WebSocket connections
│   ├── store.ts             # EventTarget-based state store
│   ├── components/
│   │   ├── transcript-pane.ts    # LiveKit text stream
│   │   ├── metrics-sidebar.ts    # Magnetic card grid
│   │   ├── contact-bar.ts        # Bottom context bar
│   │   └── magnetic-card.ts      # Reusable card with cursor tracking + radar glow
│   └── styles/
│       ├── base.css              # Pure black #000, Inter font, CSS vars
│       ├── grid.css              # Asymmetric 65/35 CSS Grid
│       └── card.css              # Magnetic card styles, radar glow
```

### Requirement: Omni-Channel Architecture (Modified)
Each transport layer is now a thin adapter that depends on the same `OrchestratorService` interface.

#### Scenario: WhatsApp message routes through orchestrator (unchanged)
- **WHEN** a WhatsApp webhook delivers a user message
- **THEN** `worker.ts` validates the payload with Zod, checks rate limit (5 req/10s), checks idempotency via `IIdempotencyStore`, calls `orchestrator.processIntent()`, and sends the AI response via WhatsApp API. On send failure, the job goes to `IDeadLetterQueue`.

#### Scenario: Voice call routes through orchestrator (unchanged)
- **WHEN** a LiveKit voice call streams audio frames
- **THEN** `voice-agent.ts` runs STT via Cartesia, passes text to `orchestrator.processIntent()`, converts response to TTS audio, and pushes to LiveKit room.

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

## V. QUANTIFIABLE SUCCESS METRICS & SLA GATES

Every requirement in this spec is verifiable. Below are the mathematical thresholds that gate deployment readiness. A feature branch is **not valid for merge** unless all gates pass.

### 5.1 RAG Triad Quality Gates

Evaluated via DeepEval (local) on a fixed 50-example golden dataset of CRM conversations. The triad measures the pipeline end-to-end: embedding → graph expansion → agent generation.

| Metric | Threshold | Measurement | Failure Consequence |
|---|---|---|---|
| **Faithfulness** | >= 0.90 | % of claims in agent output that are supported by retrieved context | Block merge. Response is hallucinating against provided context. |
| **Answer Relevancy** | >= 0.85 | % of output sentences that answer the original question | Block merge. Agent is drifting off-topic or rambling. |
| **Context Precision** | >= 0.85 | % of retrieved chunks that are actually relevant to the question | Warn. Graph expansion is pulling noise. Review retrieval depth. |

**Golden dataset composition:**
- 20 WhatsApp CRM queries (contact lookups, deal status, ticket creation)
- 15 voice call transcripts (sales call segments, objection handling, closing questions)
- 15 mixed intent (pipeline status, account health, multi-entity queries)

**Evaluation runner:** `scripts/eval-rag.ts` (updated) — runs DeepEval against the golden dataset, outputs `scripts/eval-results.json`.

### 5.2 API Operational Bounds (P95 Latency)

Must hold under seed data load (25 contacts, 15 deals, 8 calls, 5 tickets in Supabase; 50+ nodes in Neo4j).

| Channel | Operation | P95 Threshold | Why This Number |
|---|---|---|---|
| WhatsApp webhook | End-to-end ingestion → response | < 2.0s | Meta retries webhooks after 2-3s. Slower = duplicate deliveries. |
| WhatsApp webhook | Idempotency check only | < 50ms | Must not add meaningful latency to the hot path. |
| Voice | STT chunk → orchestrator → TTS | < 1.5s | > 1.5s = unnatural pause in conversation. User interrupts or hangs up. |
| Orchestrator | Full pipeline (cache miss) | < 3.0s | Cold path ceiling. Covers: embedding API + Neo4j traversal + agent generation. |
| Orchestrator | Cache hit path | < 200ms | Vector lookup + deserialize. Must feel instant. |
| Graph expansion | 2-hop traversal | < 500ms | Neo4j AuraDB free tier latency for small graph. |
| Embedding API | Gemini embed-2 single text | < 1.0s | Gemini API P95 on free tier. |

**Measurement:** OTel histogram metrics (already defined in Pillar 4). P95 computed from `crm.graph.traversal.duration_ms`, `crm.ai.generation.duration_ms`, etc.

### 5.3 Telemetry Budget Ceilings (Grafana Cloud Free Tier)

Grafana Cloud Free provides: **50 GB traces/logs, 10K active metrics, 14-day retention.** The following ceilings keep us under these limits indefinitely.

| Resource | Free Limit | Our Ceiling | Enforcement |
|---|---|---|---|
| **Active metrics** | 10,000 series | 2,000 series | Limit to 9 metric families × ~50 unique label combinations each = ~450 series. Remaining headroom for growth. |
| **Trace volume** | 50 GB/month | 5 GB/month | Head-based sampling at 10% in production. 100% in dev/chaos mode. |
| **Log volume** | 50 GB/month | 2 GB/month | WARN+ only in production. Structured JSON, no stack traces in logs (those go to DLQ metadata). |
| **Span count per request** | — | <= 1 span per orchestrator step (8 spans/request max) | Firewall Rule 14 already enforces 1 span per step. No nested sub-spans. |
| **Metric collection interval** | — | 60s (reduce from default 10s) | `PeriodicExportingMetricReader({ exportIntervalMillis: 60000 })` in otel-bootstrap.ts. |

**Budget alerts:**
- OTel gauge `crm.telemetry.metrics_active` tracks current active metric series count
- OTel counter `crm.telemetry.traces_bytes` tracks monthly trace data volume
- When either crosses 80% of ceiling → WARN log. 95% → ERROR log + page (if alerting is configured).

### 5.4 Operational SLA Gates

| Gate | Threshold | Measurement |
|---|---|---|
| **Cache hit rate** | >= 30% | `crm.cache.hits / crm.cache.requests` over a rolling 1-hour window. Below 30% = embeddings too dissimilar or threshold too tight. |
| **Idempotency hit rate** | <= 5% | `crm.webhooks.duplicate / total webhooks` over 1 hour. > 5% = Meta is aggressively redelivering — check outbound latency. |
| **Circuit breaker state** | No open breaker for > 60s | `crm.circuit_breaker.state` gauge. If any stays open > 60s, the fallback is running — check the external service. |
| **DLQ queue depth** | < 50 items per queue | Counter `crm.dlq.enqueued` minus replayed. > 50 backlog = ingestion or outbound delivery is failing systematically. |
| **AI generation failure rate** | < 5% | `crm.errors.total{domain="gemini"} / total generations` over 1 hour. > 5% = DeepSeek fallback is handling significant load. |
| **Health endpoint latency** | GET /ready < 500ms P95 | Cached health checks (10s/5s/60s) should keep this well under. |

### 5.5 Pre-Commit Validation Pipeline

Ran automatically before merge. Blocking on failure.

```
bun check           # 19-rule AST firewall. Exit 1 = blocked.
bun run validate    # Pre-commit quality gates (see tasks.md Task 13)
  ├── RAG triad (DeepEval on golden dataset)
  ├── P95 latency (simulated load against seed data)
  ├── Metric ceiling check (active series < 2000)
  └── SLA gate check (cache hit rate, idempotency, CB state)
  → Output: scripts/validate-results.json. Exit 1 = blocked.
```

---

## Impact
- Affected specs: replaces previous `production-grade-graphrag-core` spec
- Architecture change: **BREAKING** — new directory layout, new injection pattern, new port interfaces
- Existing firewall: still valid, scan paths updated to `features/`, `adapters/`, `core/`, `agents/`
