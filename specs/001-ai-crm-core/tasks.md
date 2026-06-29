# Tasks: AI-Powered CRM Core

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Runtime**: Node.js 22+ | **Package Manager**: pnpm 11.x | **Testing**: vitest

## Status Summary

**Pre-existing foundation (complete)**: Core Kernel (ports, errors, logger, sanitize, env), Adapters (Supabase, Neo4j, AI, messaging), Database Schema (migrations, RLS, RBAC), Feature Slices (contacts, deals, accounts, tickets, calls, pipeline).

**Phase 1 (complete)**: T001-T015 — Orchestrator pipeline, WhatsApp transport, observability, seed data.
**Phase 2 (complete)**: T016-T022 — Voice agent with Cartesia Sonic (STT+TTS), call summarizer, live-assist, streaming orchestrator.
**Phase 3 (complete)**: T023-T029 — Vite + Vanilla TS dashboard, EventTarget store, health/transcript/cache/active-calls panels, all-down banner.

---

## Phase 1: User Story 1 — WhatsApp AI Response (P1) 🎯 MVP

**Goal**: A sales agent receives a context-aware WhatsApp response (contact name, deal status, account health) within 2 seconds. Idempotency prevents duplicate processing. Unknown contacts are auto-created.

**Independent Test**: Send a WhatsApp webhook from a seed contact. Verify response references correct contact name, deal stage, and account health within 2s P95.

### Orchestrator Pipeline

- [x] T001 Build circuit breaker wrapper in `packages/ai-core/src/core/circuit-breaker.ts` (3 consecutive failures → open 30s → half-open probe, ephemeral per-process state, concurrent probe guard: first wins, others wait 5s)
- [x] T002 [P] Implement startup validator in `packages/ai-core/src/config/startup-validator.ts` (check all 6: SUPABASE_URL, NEO4J_URI, REDIS_URL, GEMINI_API_KEY, ENCRYPTION_MASTER_KEY, BULLMQ config — crash on missing)
- [x] T003 [P] Implement health router in `packages/ai-core/src/health/health-router.ts` (GET /health returns `{"status":"ok"}`, GET /ready returns `{"status":"healthy|degraded","failures":[...],"timestamp":"..."}` on port 8280)
- [x] T004 [P] Implement per-adapter health checks in `packages/ai-core/src/health/health-checks.ts` (ping Supabase, Neo4j, Redis — each returns latency_ms and healthy/degraded/down, consumed by /ready)
- [x] T005 Build orchestrator pipeline in `packages/ai-core/src/core/orchestrator.ts` (8-step: hydrate session → check cache → lookup contact → expand graph → call agent → sanitize output → store cache → append session. Each step wrapped in OTel span, max 8 spans/request)
- [x] T006 [P] Implement idempotency guard in orchestrator pipeline `packages/ai-core/src/core/orchestrator.ts` (call `IIdempotencyStore.checkAndSet()` before processing, fallback: Redis → Supabase → at-least-once)
- [x] T007 [P] Implement degradation paths in orchestrator (on circuit open: skip graph → Supabase-only context + cache lookup. On all AI down + cache miss → polite fallback message. On idempotency both down → process anyway)
- [x] T008 Implement CRM agent in `packages/ai-core/src/agents/crm-agent.ts` (Mastra agent with Zod-validated output schema, tool contracts: get_contact, get_deals, get_account_health, get_recent_tickets — uses context fields per FR-004)
- [x] T009 Implement output sanitizer integration in orchestrator `packages/ai-core/src/core/orchestrator.ts` (call `validateAndFilterOutput()` after AI generation, strip PII/profanity/injection patterns per FR-015, discard and replace with generic fallback if >50% stripped)
- [x] T010 Implement seed data script in `scripts/seed.ts` (populate Supabase: 25 contacts, 5 accounts, 15 deals across pipeline stages, 8 calls, 5 tickets with correct FKs and encrypted PII fields)

### WhatsApp Transport & Integration

- [x] T011 [P] Build WhatsApp webhook handler in `scripts/worker.ts` (validate payload with Zod `WhatsAppWebhookSchema`, extract message ID as idempotency key, phone as contact lookup, route to `processIntent()`, send response via WhatsApp API, enqueue DLQ on send failure with full payload + error metadata for operator replay)
- [x] T012 Wire orchestrator into WhatsApp worker `scripts/worker.ts` (pass sessionId/channel/userId/message through `processIntent()`, handle `OrchestratorResponse.metadata.degraded`, log `trace_id`)

### Observability

- [x] T013 [P] Bootstrap OTel in `packages/ai-core/src/config/otel-bootstrap.ts` (head-based sampling 10% prod/100% dev, 60s metric export, WARN+ only in prod logs)
- [x] T014 [P] Instrument orchestrator pipeline spans in `packages/ai-core/src/core/orchestrator.ts` (8 spans max per request per Firewall Rule 14: hydrate, cache_check, contact_lookup, graph_expand, agent_generate, sanitize, cache_store, session_append). Add OTel metrics: `cache_hit_total`, `cache_miss_total`, `cache_hit_ratio` gauge — needed to validate SC-004 cache >=30% hit rate

### Verification (US1)

- [x] T015 Run `pnpm exec vitest run` for orchestrator — verify all 8 pipeline steps called in order with mocked ports, verify degradation path activates on circuit open, verify unknown contact flow creates contact + returns greeting. Assert P95 E2E latency <2s from webhook receipt to WhatsApp response send (per SC-001)

---

## Phase 2: User Story 2 — Voice Call (P1)

**Goal**: Customer voice call transcribed in real-time via Cartesia Sonic, same orchestrator pipeline, AI response converted to speech (also Cartesia) within 1.5s end-of-STT to start-of-TTS. Cartesia serves as the single provider for both STT and TTS (per FR-002).

**Independent Test**: Connect a voice call session, speak "What are my open deals?", verify spoken response references correct deal data.

**Depends on**: Phase 1 completed (orchestrator pipeline must exist)

### Voice Agent

- [x] T016 [P] [US2] Build CallLifecycle handler in `scripts/voice-agent.ts` (onStart: create Call in Supabase, onTranscript: append chunk to Call, onInterrupt: discard in-progress TTS, restart pipeline with latest session context, onEnd: finalize Call with summary)
- [x] T017 [US2] Integrate Cartesia STT in `scripts/voice-agent.ts` (stream audio to Cartesia Sonic, receive `STTResult` with is_final flag, route final transcript text through `processIntentStream()`)
- [x] T018 [US2] Integrate Cartesia TTS in `scripts/voice-agent.ts` (receive `OrchestratorChunk` stream, convert text to audio via Cartesia Sonic, stream to LiveKit room. Measure pause: STT finalization timestamp → first TTS byte timestamp — must be <1.5s P95)
- [x] T019 [P] [US2] Implement call summarizer agent in `packages/ai-core/src/agents/call-summarizer.ts` (Mastra agent: summarize full transcript → structured summary with action_items, sentiment, key topics)
- [x] T020 [P] [US2] Implement live-assist agent in `packages/ai-core/src/agents/live-assist.ts` (Mastra agent: real-time prompts — "customer asked about pricing, here's the deal data: ...", not visible to customer, only to agent dashboard)

### Orchestrator Extension

- [x] T021 [US2] Implement `processIntentStream()` in `packages/ai-core/src/core/orchestrator.ts` (same 8-step pipeline but returns `AsyncIterable<OrchestratorChunk>` for voice streaming, identical degradation behavior to `processIntent()`)

### Verification (US2)

- [x] T022 [US2] Run `pnpm exec vitest run` for voice agent — verify CallLifecycle transitions (start → transcript → interrupt → end), verify STT→TTS pause <1.5s with mocked services, verify degradation fallback works on voice channel

---

## Phase 3: User Story 3 — Operator Dashboard (P2)

**Goal**: Read-only dashboard shows live transcript stream, circuit breaker states, cache health, active calls. All panels load within 3s. No panel blocks another when one data source is down.

**Independent Test**: Open dashboard, trip Neo4j circuit breaker, verify status card updates within 30s while transcript panel continues.

**Depends on**: Phase 1 (orchestrator, health endpoints) + Phase 2 (voice calls for transcript stream)

### Dashboard

- [x] T023 [US3] Initialize Vite + Vanilla TS dashboard in `apps/web/` (Vite 6, zero framework, Motion One for animations, CSS Grid layout, CSS custom properties theming)
- [x] T024 [P] [US3] Build EventTarget-based state store in `apps/web/src/store.ts` (subscribe/publish pattern, state shape: { contacts, deals, calls, health, cache, transcript }, no external deps)
- [x] T025 [P] [US3] Build health status cards in `apps/web/src/components/health-cards.ts` (poll /ready every 30s, render per-adapter status: green=healthy, yellow=degraded, dimmed=circuit_open, show latency_ms. No panel blocking)
- [x] T026 [P] [US3] Build transcript stream pane in `apps/web/src/components/transcript-pane.ts` (subscribe to Supabase Realtime on calls table, scroll live text with speaker labels customer/agent, sentiment markers color-coded: green/neutral/red)
- [x] T027 [P] [US3] Build cache health card in `apps/web/src/components/cache-card.ts` (poll /ready for cache metrics, show hit rate %, last cache store timestamp, model distribution pie)
- [x] T028 [US3] Implement all panels with independent data source isolation (each panel handles its own data source failure: show empty/dimmed state, no spinner, no modal, no blocking. All-down → single "Service Unavailable" bar with last-known health time)

### Verification (US3)

- [x] T029 [US3] Run `pnpm dev:web` and verify: all panels render <3s, circuit breaker card updates <30s after failure, transcript pane shows live scrolling text during active call, all-down shows "Service Unavailable" bar

---

## Phase 4: User Story 4 — Graceful Degradation (P2)

**Goal**: System processes requests when any single external service is unavailable. Zero requests dropped. No errors shown to customers.

**Independent Test**: Run worker with Neo4j connection refused + Gemini key invalid. Send WhatsApp. Verify response uses Supabase data + cache, degraded metadata present.

**Depends on**: Phase 1 (circuit breaker + degradation paths already built in orchestrator)

### Degradation Validation

- [x] T030 [US4] Implement fallback adapter for Neo4j NoOp retriever in `packages/ai-core/src/adapters/neo4j/noop-retriever.ts` (returns minimal CRMGraphContext: contact name only, no deals/accounts/tickets — marked `graphSkipped: true` in degradation metadata)
- [x] T031 [P] [US4] Implement CachedEmbeddingProvider in `packages/ai-core/src/adapters/ai/cached-embedding-provider.ts` (returns last-known embeddings from pgvector cache when Gemini is down, max age 1 hour, marks `cacheFallbackUsed: true`)
- [x] T032 [US4] Implement idempotency fallback chain in `packages/ai-core/src/adapters/messaging/idempotency.ts` (Redis `SET NX EX 300` → Supabase `idempotency_keys` INSERT ON CONFLICT → at-least-once, mark `idempotencyDegraded: true` on Supabase fallback)
- [x] T033 [US4] Wire all degradation metadata into `OrchestratorResponse.metadata` (populate `DegradationDescriptor` fields: primaryModelFailed, graphSkipped, cacheFallbackUsed, idempotencyDegraded, activeCircuitBreakers list)
- [x] T033a [P] [US4] Implement DLQ operator lifecycle in `packages/ai-core/src/adapters/messaging/dead-letter-queue.ts` (IDeadLetterQueue contract: `enqueue(msg, error)` → BullMQ, `listDead(limit, offset)` → paginated list, `replay(jobId)` → re-process single job, `purge()` → clear all. Admin endpoint on /ready exposes current DLQ depth)

### Verification (US4)

- [x] T034 [US4] Run degradation scenario tests: (a) Neo4j down → graphSkipped=true, contact-only response. (b) Gemini+DeepSeek down → cache hit or polite fallback. (c) Redis down → Supabase idempotency. Verify zero dropped requests, no customer-facing errors

---

## Phase 5: User Story 5 — Security & Compliance (P3)

**Goal**: PII encrypted at rest, audit logs immutable, RBAC enforced, DSAR architecture ready (gated behind `DSAR_ENABLED`).

**Independent Test**: Query contacts table directly. Verify phone/email are ciphertext. Query audit_logs — verify no UPDATE/DELETE possible.

**Depends on**: Phase 1 (orchestrator must exist for audit log writes)

### Encryption

- [ ] T035 [US5] Implement per-field encryption in `packages/ai-core/src/adapters/encryption/field-encryption.ts` (AES-256-GCM, HKDF per-row key from `ENCRYPTION_MASTER_KEY` + `salt=row_id` + `info="contact|call|session"`, lazy re-encrypt on key rotation when master key changes)
- [ ] T036 [US5] Integrate encryption into Supabase adapter CRUD in `packages/ai-core/src/adapters/supabase/` (encrypt on write for phone/email/transcript_json/messages fields, decrypt on read in-memory only, never log decrypted values)

### Audit Logs

- [ ] T037 [P] [US5] Implement audit log writer in `packages/ai-core/src/adapters/supabase/audit-log.ts` (INSERT-only on every CRM data access: actor_id, actor_role, action, entity_type, entity_id, timestamp, ip_address. Service_role for writes, no UPDATE/DELETE allowed via RLS)
- [ ] T038 [US5] Wire audit logging into every adapter CRUD method (log on create/read/update/delete with correct entity_type and action, use requesting user's auth.uid() as actor)

### DSAR Architecture

- [ ] T039 [P] [US5] Gate DSAR endpoints behind `DSAR_ENABLED` env var in `packages/ai-core/src/config/env-schema.ts` (add `DSAR_ENABLED` as optional boolean to Zod env schema, default false)
- [ ] T040 [US5] Implement DSAR export endpoint in `packages/ai-core/src/features/contacts/dsar.ts` (when `DSAR_ENABLED=true`: join contacts↔calls↔tickets↔audit_logs by contact_id, return complete dataset as JSON. When `DSAR_ENABLED=false`: return 501)
- [ ] T040a [P] [US5] Implement `deleteByOwner(ownerId)` in every Supabase adapter (contacts, deals, calls, tickets, user_sessions, audit_logs — hard-deletes all records owned by a given contact, including encrypted fields, session history, transcripts. Called by DSAR endpoint when DSAR_ENABLED=true)

### Verification (US5)

- [ ] T041 [US5] Run `pnpm exec vitest run` for encryption: encrypt→decrypt roundtrip, verify PII fields are ciphertext in DB, verify key rotation re-encrypts on read. Run audit log test: verify INSERT succeeds with actor fields, verify UPDATE/DELETE blocked by RLS. Verify audit_logs table has 90-day retention policy and no UPDATE/DELETE grants. Verify `GET /audit?entity=contact&id=X&from=90d` returns complete trail (SC-008)

---

## Phase 6: Polish & Cross-Cutting Concerns

**Goal**: Production readiness — firewall re-sweep, SLA gates validation, documentation.

**Depends on**: All user story phases complete

### Quality Gates

- [ ] T042 Run `pnpm check` full AST firewall re-sweep across all new files (19 rules, 0 violations required — scan `core/orchestrator.ts`, `agents/`, `config/`, `health/`, `scripts/`, `apps/web/`)
- [ ] T043 [P] Build SLA gate validation script in `scripts/validate.ts` (checks: cache hit rate >=30%, idempotency hit rate <=5%, no breaker >60s, DLQ depth <50, AI failure rate <5%, health P95 <500ms — all rolling windows)
- [ ] T043a [P] Instrument free tier budget counters per constitution telemetry budget table: Supabase storage bytes gauge, Neo4j node + relationship count gauge, LiveKit bandwidth bytes counter. Wire into `/ready` and `scripts/validate.ts` to alert at 80% threshold
- [ ] T044 [P] Build RAG triad evaluation script in `scripts/eval-rag.ts` (DeepEval on 50-example golden dataset: faithfulness >=0.90, answer relevancy >=0.85, context precision >=0.85)

### Documentation & Integration

- [ ] T045 [P] Write runnable self-check demo in `scripts/demo.ts` (end-to-end WhatsApp → orchestrator → response, assert P95 latency <2s, assert degradation path works, assert encryption roundtrip — zero framework dependencies)
- [ ] T046 [P] Implement pipeline analyzer agent in `packages/ai-core/src/agents/pipeline-analyzer.ts` (Mastra agent: scans all deals, identifies stale deals >30 days with no stage change, generates summary report)
- [ ] T047 Wire pipeline analyzer into BullMQ scheduled job in `scripts/worker.ts` (daily at 00:00 UTC, report pushed to DLQ if generation fails)

### Final Validation

- [ ] T048 Run `pnpm validate` full pre-commit pipeline (pnpm check → pnpm exec vitest run → pnpm exec tsx scripts/eval-rag.ts → pnpm exec tsx scripts/validate.ts — all gates must pass, exit 1 on any failure)

---

## Dependency Graph

```
Phase 1 (US1: WhatsApp) ──────────────────────────────────────────────────────
  T001 (circuit breaker) ── No deps
  T002 (startup) ────────── [P] parallel with T001
  T003 (health) ─────────── [P] parallel with T001
  T004 (health checks) ──── [P] parallel with T001
  T005 (orchestrator) ───── depends on T001, T002
  T006-T009 ─────────────── depends on T005
  T010 (seed) ───────────── [P] parallel with T005-T009
  T011-T012 (worker) ────── depends on T005, T010
  T013-T014 (telemetry) ─── [P] parallel with T011-T012
  T015 (test US1) ───────── depends on T005-T014
     │
     ├──► Phase 2 (US2: Voice) ──────────────────────────────────────────────
     │      T016-T020 (voice agent) ─ depends on T005 (orchestrator)
     │      T021 (processIntentStream) ─ depends on T005
     │      T022 (test US2) ─ depends on T016-T021
     │
     ├──► Phase 3 (US3: Dashboard) ─────────────────────────────────────────
     │      T023-T028 (dashboard) ─ depends on T003, T004 (health), T016 (voice)
     │      T029 (test US3) ─ depends on T023-T028
     │
     ├──► Phase 4 (US4: Degradation) ───────────────────────────────────────
     │      T030-T033 ─ depends on T005 (circuit breaker + orchestrator)
     │      T034 (test US4) ─ depends on T030-T033
     │
     └──► Phase 5 (US5: Security) ──────────────────────────────────────────
            T035-T036 (encryption) ─ depends on T005 (orchestrator writes)
            T037-T038 (audit) ─ [P] parallel with T035-T036
            T039-T040 (DSAR) ─ [P] parallel with T035-T038
            T041 (test US5) ─ depends on T035-T040

Phase 6 (Polish) ─────────────────────────────────────────────────────────────
  depends on Phases 1-5 all complete
  T042-T048 ─ all [P] except T042 (firewall first, then rest parallel)
```

## Parallel Execution Examples

### Phase 1 (within team)
```
Developer A: T001 (circuit breaker) + T005 (orchestrator) + T008 (agent)
Developer B: T002 (startup) + T003 (health) + T004 (health checks)
Developer C: T010 (seed data) + T013 (OTel) + T014 (spans)
Developer D: T011 (webhook handler) + T012 (wire orchestrator)
→ All merge, then T015 (verify)
```

### Phases 3-5 (after Phase 1+2 complete)
```
Developer A: Phase 3 (Dashboard) — T023-T029
Developer B: Phase 4 (Degradation) — T030-T034
Developer C: Phase 5 (Security) — T035-T041
→ All independent, no cross-phase blocking
```

## Implementation Strategy

1. **MVP** = Phase 1 only (WhatsApp AI response). Ship when T001-T015 all pass. This is the product core.
2. **Add Voice** = Phase 2. Reuses 100% of orchestrator pipeline, adds channel via Cartesia Sonic (STT+TTS).
3. **Add Dashboard** = Phase 3. Can be built in parallel with Phase 4+5, blocks on health endpoints only.
4. **Harden** = Phases 4+5 can run in parallel after Phase 1+2 stable.
5. **Ship** = Phase 6 validates everything, then tag v1.0.0.
