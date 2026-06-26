# Checklist — Production-Grade AI CRM

## Pillar 1: Operational — Fault Tolerance
- [ ] Circuit breaker implemented per adapter (3 failures → 30s cooldown → half-open probe)
- [ ] `NoOpGraphRetriever` fallback returns empty context when Neo4j circuit is open
- [ ] `CachedEmbeddingProvider` returns stale embeddings when Gemini circuit is open
- [ ] `DeepSeekFallbackProvider` activates when primary AI generation circuit is open
- [ ] `RedisIdempotencyStore` returns `true` on first call, `false` on duplicates within TTL
- [ ] `SupabaseIdempotencyStore` fallback works when Redis is down
- [ ] `BullMQDeadLetterQueue` routes failed jobs to `dlq:{queue}:*` with metadata
- [ ] WhatsApp outbound failure → 3 retries with exponential backoff → DLQ
- [ ] Post-call summarization failure → DLQ with transcript reference
- [ ] Neo4j ingestion batch failure → DLQ with batch metadata
- [ ] Idempotency fallback chain: Redis → Supabase → at-least-once (if both down)
- [ ] Graceful degradation logs WARN; user-facing response never mentions "degraded"
- [ ] `crm.circuit_breaker.state` gauge reflects each adapter state
- [ ] `crm.dlq.enqueued` counter increments per queue

## Pillar 2: Developmental — SOLID + Contracts
- [ ] `core/ports.ts` defines all 11 interfaces (`IContactStore`, `IDealStore`, ..., `IDeadLetterQueue`)
- [ ] Orchestrator depends ONLY on ports — no direct adapter imports
- [ ] `createOrchestrator(config)` factory accepts all ports via injection
- [ ] Adding a new embedding provider requires only implementing `IEmbeddingProvider` — no orchestrator changes
- [ ] All Mastra tools have `inputSchema`, `id` slug, `description` >= 20 chars (firewall Rule 11)
- [ ] All agents have `maxSteps` <= 10 (firewall Rule 12)
- [ ] `bun check` scans `features/`, `adapters/`, `core/`, `agents/` directories
- [ ] `bun check:chaos` still flags 47 violations

## Pillar 3: Security — PII + RBAC + Secrets
- [ ] `FieldEncryption.encrypt()` returns `{ ciphertext, keyId, algorithm: "AES-256-GCM" }`
- [ ] `FieldEncryption.decrypt()` recovers plaintext from ciphertext + keyId
- [ ] HKDF key derivation: `HKDF(masterKey, salt=rowId, info=entityType)`
- [ ] `ENCRYPTION_MASTER_KEY` is required at startup (32-byte hex)
- [ ] `contacts.phone` and `contacts.email` stored encrypted in Supabase
- [ ] `calls.transcript_json` stored encrypted in Supabase
- [ ] `user_sessions.messages` stored encrypted in Supabase
- [ ] PII decrypted only in-memory at read time, never persisted plaintext
- [ ] `rotateKey(record, newMasterKey)` re-encrypts with new key on read
- [ ] `audit_logs` table exists, immutable (INSERT only, no UPDATE/DELETE)
- [ ] `admin` role: full CRUD on all tables, telemetry access, DLQ replay
- [ ] `agent` role: scoped to own contacts/deals/calls/tickets via RLS
- [ ] `viewer` role: SELECT-only on assigned entities
- [ ] `service_role`: backend bypass, never exposed to clients
- [ ] All API keys absent from logs, error metadata, and span attributes
- [ ] `parseEnv()` crashes on missing required env vars

## Pillar 4a: UI Dashboard — Lightweight Read-Only Workspace
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
- [ ] Transcript pane: customer left-aligned (`#444`), agent right-aligned (`#111`)
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
- [ ] Bundle size: `apps/web/dist/` < 50 KB gzipped (Motion One is 3 KB)
- [ ] Accessibility: all interactive elements keyboard-navigable
- [ ] Accessibility: all text meets WCAG AA contrast (>= 4.5:1 on `#000` background)
- [ ] No framework detected in bundle: `grep -r "react|vue|angular|svelte" apps/web/dist/` returns empty

## Pillar 4b: Deployment — Config + Health
- [ ] `startup-validator.ts` checks all 6 dependencies (env → Supabase → Neo4j → Redis → Gemini → BullMQ)
- [ ] Any startup check failure → `process.exit(1)` with structured JSON error
- [ ] All startup checks pass → `report()` logs JSON success summary
- [ ] `GET /health` on port 8280 returns `200 { status: "ok" }` (liveness)
- [ ] `GET /ready` on port 8280 returns `200` if all adapters healthy
- [ ] `GET /ready` returns `503 { failures: [...] }` if any adapter is down
- [ ] Health checks cached appropriately (Neo4j 10s, Redis 5s, Gemini 60s)
- [ ] Circuit breaker states included in readiness check
- [ ] `health_checks` table records per-adapter health results

## Preexisting: Verified Continuity
- [ ] All 6 CRM domain types have Zod schemas with constraints (firewall Rule 1)
- [ ] All Neo4j Cypher queries parameterized (firewall Rule 7)
- [ ] All Supabase files use client methods, no raw SQL bypass (firewall Rule 8)
- [ ] All pgvector embedding queries use `<=>` operator (firewall Rule 9)
- [ ] All AI outputs pass through `validateAndFilterOutput()` (firewall Rule 10)
- [ ] No `any` type annotations in production code (firewall Rule 15)
- [ ] Every orchestrator step wrapped in `tracer.startActiveSpan()` (firewall Rule 14)
- [ ] All catch blocks use `: unknown` + `instanceof Error` guard (firewall Rule 4)
- [ ] All `fetch()` calls wrapped in `Zod.parse()` (firewall Rule 3)
- [ ] Supabase migrations run successfully on local and remote
- [ ] 20-30 seed contacts, 10-15 deals, 5-8 calls, 3-5 tickets in Supabase
- [ ] Neo4j graph has all nodes and edges from seed data
- [ ] `bun check` passes with 0 violations
- [ ] `.knowledge/runbook.md` documents architecture, degradation, encryption, health endpoints, DLQ recovery

## Pillar 5: Quantifiable SLA Gates — Pre-Commit Validation
- [ ] Golden dataset exists at `scripts/golden-dataset.json` (50 examples: 20 WhatsApp, 15 voice, 15 mixed)
- [ ] DeepEval Faithfulness >= 0.90 on golden dataset
- [ ] DeepEval Answer Relevancy >= 0.85 on golden dataset
- [ ] DeepEval Context Precision >= 0.85 on golden dataset
- [ ] P95 WhatsApp webhook end-to-end latency < 2.0s
- [ ] P95 idempotency check latency < 50ms
- [ ] P95 voice STT → orchestrator → TTS latency < 1.5s
- [ ] P95 full pipeline (cache miss) latency < 3.0s
- [ ] P95 cache hit path latency < 200ms
- [ ] P95 2-hop graph expansion latency < 500ms
- [ ] P95 Gemini embed-2 latency < 1.0s
- [ ] Active metric series < 2,000
- [ ] Metric collection interval = 60s (not 10s)
- [ ] Trace sampling = 10% in production config
- [ ] `crm.telemetry.metrics_active` gauge functional
- [ ] `crm.telemetry.traces_bytes` counter functional
- [ ] Cache hit rate >= 30% under simulated load
- [ ] Idempotency hit rate <= 5% under simulated load
- [ ] No circuit breaker open for > 60s during validation run
- [ ] DLQ queue depth < 50 during validation run
- [ ] AI generation failure rate < 5% under simulated load
- [ ] GET /ready P95 latency < 500ms
- [ ] `bun run validate` aggregates all gates into `scripts/validate-results.json`
- [ ] `bun run validate` exits 1 if any gate fails
