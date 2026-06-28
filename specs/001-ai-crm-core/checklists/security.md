# Security & PII Requirements Quality Checklist: AI-Powered CRM Core

**Purpose**: Validate security and PII requirements completeness, clarity, and consistency
**Created**: 2026-06-28
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [ ] CHK001 - Are encryption requirements specified for ALL PII fields identified in the data model (phone, email, transcript_json, user_sessions.messages)? [Completeness, Spec §FR-006, data-model.md]
- [ ] CHK002 - Are encryption key hierarchy requirements documented (master key → per-row HKDF derivation → per-field encryption)? [Completeness, Spec §FR-006, research.md §5]
- [ ] CHK003 - Are key rotation requirements defined with specific trigger conditions (env var change, scheduled, compromise event)? [Completeness, Spec §FR-006, US5]
- [ ] CHK004 - Are audit log requirements complete for all CRUD operations across all 6 entity types? [Completeness, Spec §FR-009, data-model.md]
- [ ] CHK005 - Are RBAC permission requirements specified for each role (admin, agent, viewer, service_role) against each entity table? [Completeness, Spec §FR-011]
- [ ] CHK006 - Are output sanitization requirements defined for ALL AI output paths (WhatsApp text, voice TTS, dashboard display)? [Completeness, Spec §FR-015]
- [ ] CHK007 - Are requirements specified for what PII patterns the sanitizer MUST strip (phone regex, email regex, prompt injection patterns)? [Completeness, Spec §FR-015]
- [ ] CHK008 - Are requirements defined for logging PII safety — what fields MUST be excluded from logs, errors, and trace spans? [Completeness, Spec §FR-009, Constitution §III]
- [ ] CHK009 - Are data retention requirements specified for audit logs (90 days), call transcripts (90 days), and user sessions (90 days after last activity)? [Completeness, Spec §FR-009, data-model.md]
- [ ] CHK010 - Are DSAR (data subject access request) and data erasure requirements defined, or is their intentional exclusion documented? [Gap, Spec §Domain 9]

## Requirement Clarity

- [ ] CHK011 - Is the AES-256-GCM algorithm choice explicitly justified with rationale, or is it assumed without documentation? [Clarity, Spec §FR-006]
- [ ] CHK012 - Is "per-row key derivation" quantified with the specific HKDF parameters (salt source, info string format, key length)? [Clarity, Spec §FR-006, research.md §5]
- [ ] CHK013 - Is the encryption scope boundary clear — does it cover data in transit, at rest, in memory, or a specific subset? [Clarity, Spec §FR-006]
- [ ] CHK014 - Are "sensitive personal data" and "PII" terms explicitly defined with a concrete field list, or left to interpretation? [Clarity, Spec §FR-015]
- [ ] CHK015 - Is the term "prompt injection patterns" in the sanitizer requirement defined with examples or a reference spec? [Ambiguity, Spec §FR-015]
- [ ] CHK016 - Are "profanity" blacklist criteria specified, or is the filtering scope left to implementation discretion? [Ambiguity, Spec §FR-015]
- [ ] CHK017 - Is the "immutable" audit log requirement clear — does it mean no UPDATE/DELETE at DB level, application level, or both? [Clarity, Spec §FR-009]

## Requirement Consistency

- [ ] CHK018 - Do encryption requirements in FR-006 align with the key rotation scenario in US5 (lazy re-encrypt on read, not bulk migration)? [Consistency, Spec §FR-006, US5 Scenario 3]
- [ ] CHK019 - Are RBAC requirements in FR-011 consistent with the specific RLS policies documented in the data model? [Consistency, Spec §FR-011, data-model.md]
- [ ] CHK020 - Do PII-stripping requirements in FR-015 align with the IntegrationError PII-strip requirement in Constitution §III? [Consistency, Spec §FR-015, Constitution §III]
- [ ] CHK021 - Are data retention periods in FR-009 consistent with the retention table in data-model.md for all 3 temporal entities? [Consistency, Spec §FR-009, data-model.md]

## Edge Case Coverage

- [ ] CHK022 - Are requirements defined for what happens when ENCRYPTION_MASTER_KEY is missing at startup? [Edge Case, Spec Edge Cases]
- [ ] CHK023 - Are requirements specified for handling corrupted or unreadable ciphertext at read time? [Edge Case, Gap]
- [ ] CHK024 - Are requirements defined for concurrent key rotation — two reads of the same row triggering simultaneous re-encrypt? [Edge Case, Gap]
- [ ] CHK025 - Are requirements specified for audit log storage exhaustion on the free tier (500MB Supabase limit)? [Edge Case, Gap]
- [ ] CHK026 - Are requirements defined for what happens when a viewer role attempts to access unassigned contacts via direct API? [Edge Case, Spec §FR-011, US5]
- [ ] CHK027 - Are requirements specified for PII appearing inside AI-generated text (not just input fields) — e.g., AI hallucinating a phone number? [Edge Case, Gap]

## Non-Functional Coverage

- [ ] CHK028 - Are encryption/decryption latency requirements specified for the per-field path (must not exceed X ms to meet P95 latency gates)? [Non-Functional, Spec §SC-001]
- [ ] CHK029 - Are audit log write throughput requirements defined for peak WhatsApp webhook volume? [Non-Functional, Gap]
- [ ] CHK030 - Are RBAC audit completeness requirements specified — must every failed access attempt be logged, or only successful ones? [Non-Functional, Spec §FR-009, US5 Scenario 2]

## Dependencies & Assumptions

- [ ] CHK031 - Is the assumption that the encryption master key is stored securely in Vercel env vars validated against Vercel's security model? [Assumption, Spec Assumptions]
- [ ] CHK032 - Is the assumption that GDPR/DPA compliance is not required for initial launch explicitly documented with the planned activation trigger? [Assumption, Spec Assumptions]
- [ ] CHK033 - Are the external dependencies for encryption (Bun crypto API, HKDF implementation) documented with fallback requirements? [Dependency, Gap]
