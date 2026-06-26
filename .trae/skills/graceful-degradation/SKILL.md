---
name: graceful-degradation
description: >-
  Defines the circuit breaker pattern, fallback adapter chains, and dead-letter
  queue recovery for the AI CRM. Use when implementing adapters that call
  external services (Neo4j, Gemini, DeepSeek, Supabase, Redis) to ensure
  partial infrastructure failures are handled without dropping requests.
---

# Graceful Degradation

## Circuit Breaker (core/circuit-breaker.ts)

**Configuration:**
- `maxFailures`: 3
- `cooldownMs`: 30000 (30 seconds)

**State machine:** `closed → open (3 failures) → half-open (after 30s) → closed (success) or open (failure)`

**Exposes:** `.state` for health endpoint + OTel metric `crm.circuit_breaker.state`

## Fallback Chains

### Graph Retrieval (when Neo4j is down)
```
Neo4jGraphRetriever → circuit opens → NoOpGraphRetriever (empty context)
                                                           ↓
                                              Response uses only Supabase
                                              contact lookup + cache context
```

### Embedding (when Gemini is down)
```
GeminiEmbeddingProvider → circuit opens → CachedEmbeddingProvider
                                           (returns last-known embedding)
```

### AI Generation (when primary model is down)
```
MastraAgentProvider (Gemini) → circuit opens → DeepSeekFallbackProvider
                                                 ↓
                                    If both fail → return cached response
                                                     (if available)
```

## Dead Letter Queue (adapters/messaging/)

**Queues that feed into DLQ:**
- WhatsApp outbound message delivery failures
- Post-call summarization job failures
- Neo4j ingestion batch failures
- Pipeline analyzer scheduled job failures

**DLQ entry format:**
```
dlq:{queue}:{jobId} → { contactId, messageSnippet, errorCode,
                         attemptCount, lastAttemptedAt, stackTrace }
```

**Recovery:** Operator replays from DLQ dashboard or re-queues via BullMQ UI.

## Idempotency (adapters/messaging/)

**Fallback chain:**
```
RedisIdempotencyStore (SET NX EX)
  → SupabaseIdempotencyStore (idempotency_keys table)
    → at-least-once (process anyway if both down)
```

**TTL:** 300 seconds (5 minutes)
