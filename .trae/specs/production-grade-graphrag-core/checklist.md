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

## Pillar 4: Deployment — Config + Health
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
