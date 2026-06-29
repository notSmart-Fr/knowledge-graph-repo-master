# Research: AI-Powered CRM Core

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Decisions

### 1. Runtime: Node.js 22+ with pnpm over Bun

**Decision**: Node.js 22+ with pnpm 11.x
**Rationale**: Node.js 22+ provides a stable LTS runtime with native ESM support. pnpm offers strict module isolation in the monorepo workspace, avoiding the hoisting bugs that npm can cause. The `tsx` package runner provides zero-config TypeScript execution equivalent to Bun's native runner. Node.js also avoids the Windows lockfile crash issues encountered with Bun 1.3.14.
**Alternatives considered**: Bun 1.3+ — faster startup but Windows lockfile crashes broke `bun install` reliability. Deno — good but ecosystem for Mastra/OTel immature.

### 2. AI Framework: Mastra over LangChain

**Decision**: Mastra (with direct Gemini/DeepSeek API calls)
**Rationale**: Mastra provides agent definitions, tool contracts, and output schemas natively in TypeScript. Lighter than LangChain (fewer dependencies). The project defines agents as Mastra agent configs with Zod-validated tool contracts. Direct API calls avoid abstraction overhead for simple generate/embed operations.
**Alternatives considered**: LangChain — heavier, more abstractions than needed for 4 agents. Raw Gemini SDK — would require building agent orchestration from scratch.

### 3. Port Interface Count: 11 (not fewer)

**Decision**: 11 port interfaces in `core/ports.ts`
**Rationale**: One port per external boundary keeps interfaces small and focused. Combining stores (e.g., `ICRMStore` with all 5 entities) would create a monolithic interface that's hard to mock and hard to swap. Each adapter is independently testable.
**Alternatives considered**: 5 ports (combine CRUD stores) — simpler but loses granular circuit breaking and mock isolation.

### 4. Circuit Breaker Policy

**Decision**: Per-adapter circuit breakers: 3 consecutive failures → open 30s → half-open probe → close on success or reset cooldown on failure.
**Rationale**: Matches the established resilience pattern. Free-tier services (Neo4j AuraDB, Gemini API) have unpredictable availability. 30s cooldown prevents thundering herd on recovery. Half-open probe allows 1 request through to test recovery.
**Alternatives considered**: Global circuit breaker — one failure blocks all adapters, too aggressive. Token bucket rate limiter — doesn't handle failure cascades.

**Edge Cases**:
- **Persistence across restarts**: Circuit breaker state is ephemeral (in-memory). Restart resets all circuits to closed. Rationale: free-tier services recover during restart gaps; persistent state adds Redis dependency for a rare event.
- **Half-open probe independence**: The probe request must be a live external call — cached responses do NOT count as recovery evidence. The probe bypasses the cache layer entirely.
- **Concurrent probe guard**: If multiple concurrent requests trigger a half-open probe simultaneously, only the first request performs the actual probe. Subsequent requests wait (up to 5s) and reuse the first probe's result. This prevents thundering herd on service recovery.
- **Stale embeddings during degradation**: When Neo4j is down, the CachedEmbeddingProvider returns the last-known embeddings from cache (up to 1 hour old). If no embeddings exist for the contact, the orchestrator generates the response from supabase-only CRM context with `graphSkipped: true` in degradation metadata.

### 5. Encryption: AES-256-GCM with HKDF Key Derivation

**Decision**: AES-256-GCM per-field encryption with HKDF-derived per-row keys.
**Rationale**: Master key from `ENCRYPTION_MASTER_KEY` env var (32-byte hex). Per-row key via `HKDF(masterKey, salt=row_id, info="contact|call|session")`. Lazy key rotation on read when new master key detected. This prevents bulk decryption if one row key is compromised and makes key rotation zero-downtime.
**Alternatives considered**: Single AES key for all rows — simpler but single key compromise = all data exposed. AWS KMS — adds cloud dependency, not suitable for free-tier self-hosted approach.

### 6. Semantic Cache: pgvector Cosine Distance

**Decision**: Supabase pgvector with `<=>` cosine distance operator, threshold 0.05.
**Rationale**: Content-addressable deduplication via `prompt_hash`. Gemini text-embedding-004 produces 768-dim vectors. Cosine distance < 0.05 means semantically near-identical queries hit cache. LRU eviction on entries older than 30 days (non-accessed). Cache bypass for urgent/emergency tokens.
**Alternatives considered**: Redis vector search — Redis free tier 256MB limits cache capacity. Exact text match — no semantic similarity, cache hit rate would be near zero. No cache — violates free tier budget constraints (redundant AI calls cost money).

### 7. Idempotency: Redis Primary, Supabase Fallback

**Decision**: Redis `SET NX EX` as primary, Supabase `idempotency_keys` table as fallback. If both fail, process anyway (at-least-once).
**Rationale**: WhatsApp redelivers webhooks. 5-minute TTL covers Meta's retry window. Redis free tier has 10K commands/day — idempotency check + SET per webhook fits. Supabase fallback uses DB for durability. Final fallback to at-least-once ensures availability over consistency.
**Alternatives considered**: Redis-only — no fallback if Redis is down. Supabase-only — adds 50ms+ latency per webhook. In-memory cache — lost on restart, no cross-instance dedup.

### 8. UI Dashboard: Vite + Vanilla TS + Motion One

**Decision**: Vite 6 bundler, Vanilla TypeScript (no framework), Motion One for animations.
**Rationale**: Read-only dashboard needs no virtual DOM, no state management library, no routing. Direct DOM manipulation with Web Components pattern. Motion One is 3KB (vs Framer Motion 30KB+). EventTarget-based store (zero dependencies). CSS Grid for layout, CSS custom properties for theming.
**Alternatives considered**: React + Tailwind — 50KB+ bundle vs < 10KB for vanilla. Svelte — good but adds compiler dependency to Vite config. HTMX — not suitable for WebSocket streaming (LiveKit transcript).

### 9. Transport: Omni-Channel Orchestrator

**Decision**: All channels (WhatsApp, voice) route through the same `OrchestratorService.processIntent()`. Transport-specific adapters handle channel I/O (webhook validation, STT/TTS, rate limiting).
**Rationale**: Core CRM logic (contact lookup, graph expansion, AI generation, sanitization) is channel-agnostic. Duplicating pipeline logic per channel violates DRY and makes degradation handling inconsistent.
**Alternatives considered**: Separate pipelines per channel — duplicated degradation logic, harder to maintain consistency.

### 10. Observability: OpenTelemetry → Grafana Cloud Free

**Decision**: OTel SDK with head-based sampling (10% prod, 100% dev). 60s metric export interval. 8 spans max per request. WARN+ only in production logs.
**Rationale**: Grafana Cloud Free limits: 10K metrics (we target 2K), 50GB traces (we target 5GB), 50GB logs (we target 2GB). Conservative ceilings prevent surprise bills. 8-span limit per request keeps trace volume predictable (Firewall Rule 14).
**Alternatives considered**: Prometheus + Grafana self-hosted — adds infrastructure burden. Datadog/New Relic — paid, violates free-tier principle. Console-only logging — no aggregation, no alerting.

### 11. Dead Letter Queue: Operator-Triggered Replay

**Decision**: DLQ replay is operator-triggered only (manual), not automatic on recovery detection. Purge and listDead available alongside replay.
**Rationale**: Jobs in DLQ may have been the cause of downstream data corruption — automatic replay risks compounding the problem. Operator review of failure metadata before replay is a safety valve. The `IDeadLetterQueue` interface exposes `listDead()` so operators can inspect before replaying.
**Alternatives considered**: Automatic retry with backoff — risks duplicate processing and corruption amplification. Drop-only (no replay) — loses recoverable work like summarization jobs.
