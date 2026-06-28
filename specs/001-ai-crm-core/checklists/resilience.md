# Resilience & Degradation Requirements Quality Checklist: AI-Powered CRM Core

**Purpose**: Validate resilience, circuit breaker, fallback chain, and graceful degradation requirements quality
**Created**: 2026-06-28
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [ ] CHK001 - Are circuit breaker requirements defined for EVERY external adapter (Supabase, Neo4j, Gemini, DeepSeek, Redis, BullMQ)? [Completeness, Spec §FR-007, §FR-008, US4]
- [ ] CHK002 - Are circuit breaker parameters (failure threshold, cooldown duration, half-open probe count) explicitly specified per adapter? [Completeness, Spec §FR-007, research.md §4]
- [ ] CHK003 - Is the full fallback chain documented for AI providers: Gemini → DeepSeek → Ollama (conditional) → cached response? [Completeness, Spec §FR-007, US4]
- [ ] CHK004 - Are requirements specified for the NoOp graph retriever fallback — what context fields are returned when Neo4j is unavailable? [Completeness, Spec §FR-008, contracts/interfaces.md]
- [ ] CHK005 - Are idempotency fallback requirements defined: Redis primary → Supabase fallback → at-least-once processing? [Completeness, Spec §FR-005, US4 Scenario 3]
- [ ] CHK006 - Are dead-letter queue requirements specified for ALL async failure paths (WhatsApp delivery, summarization, ingestion, pipeline analysis)? [Completeness, Spec §FR-013]
- [ ] CHK007 - Are DLQ job metadata requirements defined (what failure context is preserved: error code, attempt count, timestamps)? [Completeness, Spec §FR-013]
- [ ] CHK008 - Are retry policy requirements specified for each adapter (count, delay strategy, max elapsed time)? [Completeness, research.md §4, Spec §Domain 3]
- [ ] CHK009 - Are requirements defined for when to return a degraded response vs. an error to the user? [Gap, Spec US4]
- [ ] CHK010 - Are requirements specified for how long cached responses are valid when used as the final fallback? [Gap, Spec US4 Scenario 2]

## Requirement Clarity

- [ ] CHK011 - Is "3 consecutive failures" defined precisely — same endpoint, same error class, or any 3 failures within a window? [Clarity, Spec §FR-007]
- [ ] CHK012 - Is the "30-second cooldown" parameter justified with rationale tied to the free-tier service recovery characteristics? [Clarity, research.md §4]
- [ ] CHK013 - Is the Ollama fallback activation condition clear: only when `LOCAL_LLM_URL` is set AND both Gemini and DeepSeek circuits are open? [Clarity, Spec §FR-007, US4]
- [ ] CHK014 - Are "degraded" vs "healthy" response states clearly distinguished — what metadata fields indicate degradation? [Clarity, Spec US4, contracts/interfaces.md OrchestratorResponse]
- [ ] CHK015 - Is the phrase "responds using only Supabase contact lookup + semantic cache" quantified — what information is lost vs. full graph context? [Ambiguity, Spec US4 Scenario 1]
- [ ] CHK016 - Are DLQ replay requirements clear — is replay manual (operator action) or automatic on recovery detection? [Ambiguity, Spec §FR-013]
- [ ] CHK017 - Is "at-least-once delivery over at-most-once" explicitly scoped to idempotency failures only, or does it apply to other failure modes? [Clarity, Spec US4 Scenario 3]

## Requirement Consistency

- [ ] CHK018 - Do circuit breaker requirements in FR-007 align with the per-adapter retry policies documented in research.md §4? [Consistency, Spec §FR-007, research.md §4]
- [ ] CHK019 - Are degradation requirements consistent between WhatsApp (US4 Scenario 1) and Voice (US4 Scenario 2) — do both channels degrade the same way? [Consistency, Spec US4 Scenarios 1-2]
- [ ] CHK020 - Do fallback chain requirements in FR-007 match the architecture described in contracts/interfaces.md (3 AI providers + cache final)? [Consistency, Spec §FR-007, contracts/interfaces.md]
- [ ] CHK021 - Is the degraded response user-facing behavior consistent — "no error shown to customer" in US4 lines up with FR-015 sanitization? [Consistency, Spec US4 Scenario 1, §FR-015]

## Edge Case Coverage

- [ ] CHK022 - Are requirements defined for what happens when ALL adapters in the fallback chain are simultaneously unavailable (Gemini down, DeepSeek down, Ollama not configured, cache cold)? [Edge Case, Spec US4]
- [ ] CHK023 - Are requirements specified for circuit breaker state persistence across process restarts? [Edge Case, Gap]
- [ ] CHK024 - Are requirements defined for the half-open probe — what happens if the probe request itself is a cache hit vs. actual external call? [Edge Case, Gap]
- [ ] CHK025 - Are requirements specified for DLQ overflow — what happens when a BullMQ queue exceeds memory on Redis free tier (256MB)? [Edge Case, Spec Edge Cases]
- [ ] CHK026 - Are requirements defined for circuit breaker thundering herd — multiple concurrent requests all probing half-open simultaneously? [Edge Case, Gap]
- [ ] CHK027 - Are requirements specified for graceful degradation during partial Neo4j failure — some queries succeed, some fail within the same request? [Edge Case, Gap]
- [ ] CHK028 - Are requirements defined for what happens when the CachedEmbeddingProvider returns stale embeddings (last-known from > 1 hour ago)? [Edge Case, Gap]

## Non-Functional Coverage

- [ ] CHK029 - Are circuit breaker state transition latency requirements specified — how fast must an open circuit be detectable by the orchestrator? [Non-Functional, Spec §SC-005]
- [ ] CHK030 - Are degradation path latency requirements defined — when using fallback adapters, what is the acceptable P95 increase? [Non-Functional, Spec §SC-003]
- [ ] CHK031 - Are DLQ replay throughput requirements specified — operator must be able to replay how many jobs per minute? [Non-Functional, Gap]
- [ ] CHK032 - Are monitoring/alerting requirements defined for degradation scenarios — what metrics trigger operator notification? [Non-Functional, Spec US4]
