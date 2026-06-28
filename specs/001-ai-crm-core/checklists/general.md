# General Requirements Quality Checklist: AI-Powered CRM Core

**Purpose**: Validate overall requirements completeness, clarity, consistency, and coverage across all 5 user stories
**Created**: 2026-06-28
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [ ] CHK001 - Are functional requirements mapped to every acceptance scenario across all 5 user stories? [Completeness, Spec §FR-001 through §FR-015]
- [ ] CHK002 - Are WhatsApp webhook validation requirements complete — payload structure, phone format, text length limits, rate limiting? [Completeness, Spec §FR-001]
- [ ] CHK003 - Are voice call lifecycle requirements complete — call start, in-progress transcription, interruption handling, call end, post-call summarization? [Completeness, Spec §FR-002, US2]
- [ ] CHK004 - Are knowledge graph traversal requirements complete — what node types and relationship depths are included in CRM context? [Completeness, Spec §FR-003, data-model.md]
- [ ] CHK005 - Are orchestrator pipeline step requirements complete — all 8 steps defined (hydrate → cache → contact → graph → agent → sanitize → store → append)? [Completeness, Spec §FR-004, contracts/interfaces.md]
- [ ] CHK006 - Are startup validation requirements complete — all 6 checks (env vars, Supabase, Neo4j, Redis, Gemini, BullMQ) explicitly listed? [Completeness, Spec §FR-014]
- [ ] CHK007 - Are health endpoint requirements complete — both /health (liveness) and /ready (readiness with per-adapter degradation status)? [Completeness, Spec §FR-010]
- [ ] CHK008 - Are dashboard data source requirements complete — Supabase Realtime for entities, LiveKit for transcript, /ready for health, OTel for metrics? [Completeness, Spec §FR-012]
- [ ] CHK009 - Are semantic cache requirements complete — cache check criteria (cosine distance < 0.05), storage format (768-dim vector), eviction policy (30-day LRU)? [Completeness, Spec §FR-004, data-model.md CacheEmbedding]
- [ ] CHK010 - Are seed data requirements specified — what minimum data volume is needed for each entity type to validate all user stories? [Gap, quickstart.md]

## Requirement Clarity

- [ ] CHK011 - Is "context-aware AI response" in FR-004 quantified — what specific CRM fields MUST be included in the response context? [Clarity, Spec §FR-004]
- [ ] CHK012 - Is "within 2 seconds" in SC-001 clearly scoped — end-to-end (webhook receipt → WhatsApp send) or orchestrator-only (input → response text)? [Clarity, Spec §SC-001]
- [ ] CHK013 - Is "less than 1.5 seconds of perceived pause" in SC-002 defined — from end of speech to start of TTS, or includes TTS playback time? [Clarity, Spec §SC-002]
- [ ] CHK014 - Are "speaker labels" in the transcript pane requirement defined — what distinguishes customer vs. agent in the data? [Clarity, Spec §FR-012, US3]
- [ ] CHK015 - Are "sentiment markers" requirements specified — what sentiment values, how are they displayed (color, icon, text)? [Clarity, Spec US3 Scenario 3]
- [ ] CHK016 - Is "health score" computation defined — what inputs (active deals, recent activity, etc.) feed the score? [Ambiguity, Spec Key Entities, data-model.md Account]
- [ ] CHK017 - Is the orchestrator pipeline ordering constraint explicit — are steps required to execute sequentially or can some run in parallel? [Clarity, contracts/interfaces.md]

## Requirement Consistency

- [ ] CHK018 - Do WhatsApp requirements in US1 align with voice requirements in US2 — both route through the same orchestrator pipeline per architecture? [Consistency, Spec US1, US2]
- [ ] CHK019 - Are dashboard requirements in FR-012 consistent with health endpoint requirements in FR-010 — does the dashboard consume /ready data? [Consistency, Spec §FR-010, §FR-012]
- [ ] CHK020 - Do success criteria thresholds (SC-001 to SC-010) align with the SLA gates defined in Constitution §Quality Gates? [Consistency, Spec Success Criteria, Constitution SLA Gates]
- [ ] CHK021 - Are the 6 key entities in the spec consistent with the 10 entities in data-model.md (missing: UserSession, CacheEmbedding, IdempotencyKey, HealthCheck)? [Consistency, Spec Key Entities, data-model.md]
- [ ] CHK022 - Does the assumption "dashboard is read-only" in spec assumptions match FR-012 which describes a read-only dashboard? [Consistency, Spec Assumptions, §FR-012]

## Acceptance Criteria Quality

- [ ] CHK023 - Can SC-001 (WhatsApp response within 2 seconds for 95% of messages) be objectively measured without implementation details? [Measurability, Spec §SC-001]
- [ ] CHK024 - Can SC-003 (zero requests dropped when any single service is unavailable) be verified — what defines "dropped" vs "degraded"? [Measurability, Spec §SC-003]
- [ ] CHK025 - Can SC-007 (AI responses 90% faithful to CRM data) be measured — is the golden dataset of 50 conversations defined and accessible? [Measurability, Spec §SC-007]
- [ ] CHK026 - Can SC-010 (stay within monitoring budget) be measured — are the metric series count and trace volume metrics instrumented? [Measurability, Spec §SC-010]
- [ ] CHK027 - Are all 10 success criteria free of implementation details (no framework, database, or tool names)? [Measurability, Spec Success Criteria]

## Scenario Coverage

- [ ] CHK028 - Are requirements defined for the WhatsApp unknown contact flow — create contact, respond, and audit log? [Coverage, Spec US1 Scenario 3]
- [ ] CHK029 - Are requirements defined for voice call interruption — when customer speaks while TTS is playing? [Coverage, Gap, Spec US2]
- [ ] CHK030 - Are requirements defined for dashboard loading when ALL data sources are unavailable simultaneously? [Coverage, Spec US3 Scenario 2]
- [ ] CHK031 - Are requirements defined for the orchestrator when the contact exists but has zero deals, zero tickets, and zero calls? [Coverage, Gap, Spec US1]
- [ ] CHK032 - Are requirements defined for multi-turn conversation context — how many previous turns are included in session context? [Coverage, Gap, Spec FR-004]

## Edge Case Coverage

- [ ] CHK033 - Are requirements defined for WhatsApp message rate limiting — what happens above 5 requests per 10 seconds? [Edge Case, Gap, Spec US1]
- [ ] CHK034 - Are requirements defined for voice call transcript exceeding the 500MB Supabase free tier during a single long call? [Edge Case, Spec Edge Cases]
- [ ] CHK035 - Are requirements defined for what happens when the semantic cache is cold — first-ever query to the system? [Edge Case, Spec Edge Cases]
- [ ] CHK036 - Are requirements defined for Neo4j free tier node limit (50K) exhaustion — what happens when the graph exceeds capacity? [Edge Case, Gap]

## Dependencies & Assumptions

- [ ] CHK037 - Is the assumption that WhatsApp webhook delivery is reliable validated — what's the fallback if Meta silently drops a message? [Assumption, Spec Assumptions]
- [ ] CHK038 - Is the assumption that 25 contacts / 15 deals is sufficient seed data validated against all acceptance scenario needs? [Assumption, Spec Assumptions]
- [ ] CHK039 - Are external service dependency requirements documented — what API versions, authentication methods, and rate limits apply? [Dependency, Gap]
- [ ] CHK040 - Is the Ollama conditional dependency requirement clear — how is LOCAL_LLM_URL absence detected and handled? [Dependency, Spec Assumptions]
