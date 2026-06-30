# Plan Quality Checklist: Customer Chat Widget + WhatsApp Audio Ingress

**Purpose**: Unit-test the plan and research artifacts for completeness, clarity, and readiness before generating tasks
**Created**: 2026-06-30
**Feature**: [plan.md](../plan.md)
**Depth**: Standard (pre-tasks sanity check)
**Focus**: Plan quality — architecture decisions, technical context, constitution alignment
**Mandatory gate areas**: Cartesia STT fix, degradation paths, PII, performance SLAs, schema migration safety

---

## Plan Completeness

- [x] CHK001 — Is the Cartesia STT endpoint bug (`/tts/websocket` → `/stt/turns/websocket`) documented as a **blocking** prerequisite with the exact corrected URLs for both live and clip endpoints? [Completeness, Plan §Summary] ✓ plan.md §Summary explicitly calls this out as a "Key pre-implementation fix required"
- [ ] CHK002 — Are ALL new environment variables documented? The plan mentions `LIVEKIT_WEBHOOK_SECRET` and `WIDGET_SERVER_PORT` but not `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` — are these assumed to already exist from spec 001? [Clarity, Gap]
- [ ] CHK003 — Is `livekit-client` (browser SDK) documented as a **widget-only** dependency that must not be bundled into `packages/ai-core/`? The plan lists it in Technical Context but not the AST firewall scope. [Completeness, Plan §Technical Context]
- [ ] CHK004 — Does each Constitution Check evidence statement reference a specific file path or task ID rather than a future assertion (e.g., "will be covered by Rule 16")? [Clarity, Plan §Constitution Check]
- [ ] CHK005 — Does the Source Code project structure include test file locations (`__tests__/` directories) for the new adapter and widget-server? [Gap, Plan §Project Structure]
- [ ] CHK006 — Is the voice-agent.ts refactoring scope fully specified? The plan says "Fix CartesiaSTTClient endpoint; add widget session identity" — is this the complete change surface or are additional modifications needed (e.g., LiveKit Agents SDK worker registration)? [Clarity, Plan §Project Structure]

---

## Research Decision Quality

- [ ] CHK007 — Does Decision 1 (Cartesia STT) specify all required WebSocket query parameters (`model=ink-2`, `encoding=pcm_s16le`, `sample_rate=24000`, `cartesia_version=2026-03-01`) for the clip/WhatsApp async path? [Completeness, Research §1]
- [x] CHK008 — Is Deepgram documented as a concrete fallback contingency plan with specific activation criteria? [Clarity, Research §1] ✓ Deepgram removed; contingency is graceful degradation (circuit breaker → text fallback) — no second STT provider at free-tier scale. OpenAI Realtime noted as drop-in-compatible if needed.
- [ ] CHK009 — Does Decision 2 (LiveKit dispatch) specify what the widget-server returns to the client if `createDispatch()` throws (network error, rate limit, invalid credentials)? [Edge Cases, Research §2]
- [ ] CHK010 — Is the 15-second no-pickup watchdog timer justified with a specific rationale (e.g., LiveKit job pickup P99 latency), or is it an arbitrary value? [Clarity, Research §2]
- [x] CHK011 — Does Decision 5 (WhatsApp audio) specify how `ffmpeg` is installed in the deployment environment? [Completeness, Research §5] ✓ research.md §5 now documents 4 deployment options ranked by preference (system ffmpeg, @ffmpeg-installer, @ffmpeg/ffmpeg WASM, Vercel unsupported).
- [ ] CHK012 — Does the plan address the potential race condition where WhatsApp's short-lived media URL (~5 min) expires during long audio processing? [Edge Cases, Research §5]

---

## Data Model Quality

- [ ] CHK013 — Is the `user_sessions.channel` CHECK constraint change specified with the exact SQL pattern, or is "ALTER TABLE" left as an implementation detail for tasks? [Clarity, Data Model §Schema Change Summary]
- [ ] CHK014 — Is the backward compatibility of the `EncryptedMessage.input_mode` field (absent in old rows) documented with the specific application-layer default (`'text'`) and where this default is applied? [Clarity, Data Model §EncryptedMessage]
- [ ] CHK015 — Does the data model specify an index strategy for querying widget sessions by `channel = 'widget'`, given that this is a new query pattern against an existing table? [Gap, Performance]
- [x] CHK016 — Is the RLS policy for widget sessions stated with the complete SQL condition, and is it confirmed non-conflicting with the existing `agent_id = auth.uid()` policy? [Completeness, Data Model §UserSession] ✓ data-model.md now includes full `CREATE POLICY` SQL with non-conflict explanation (channel='widget' vs channel!='widget' are mutually exclusive).
- [x] CHK017 — Does the data model address atomicity: what happens if room creation in LiveKit succeeds but the `live_room_name` session update fails? [Edge Cases, Data Model §UserSession] ✓ data-model.md documents 4-point recovery strategy: LiveKit auto-cleanup (5 min empty_timeout), HTTP 500 to client, new nanoid on next request, startup reconciliation pass.

---

## Contract Completeness

- [ ] CHK018 — Does the `ILiveKitRoomManager` interface include a `healthCheck()` or equivalent method for the `/ready` health endpoint that lists LiveKit as an adapter? [Gap, Contracts §1]
- [ ] CHK019 — Are all HTTP error responses (401, 413, 415, 503) documented with their **exact JSON body schema** so the widget client can parse and display them consistently? [Completeness, Contracts §2]
- [ ] CHK020 — Is the SSE `"done"` event payload fully specified (does it carry `sessionId` only, or also `messageId`, total turn count, etc.)? [Clarity, Contracts §2]
- [x] CHK021 — Does the `/livekit/webhook` contract specify the HTTP status code on signature verification failure? [Ambiguity, Contracts §2] ✓ contracts/interfaces.md now explicitly documents: 200 on success, 401 on bad signature (not 200, which would cause retry loop), 500 on unexpected error (LiveKit retries up to 3 times).
- [ ] CHK022 — Is the `window.crmWidget` async loader pattern documented with what happens if `init()` is called a second time (idempotent, error, or re-auth)? [Edge Cases, Contracts §3]
- [ ] CHK023 — Does the Cartesia STT contract specify a recommended audio chunk size for PCM streaming (balancing WebSocket overhead vs. latency)? [Gap, Contracts §4]
- [ ] CHK024 — Does the WhatsApp audio reply contract specify handling when Cartesia TTS output exceeds WhatsApp's media upload size limit (16 MB)? [Edge Cases, Contracts §5]

---

## Performance SLA Measurability

- [x] CHK025 — Is the "< 500ms first SSE token" target defined relative to a specific measurement point? [Clarity, Plan §Performance Goals] ✓ plan.md §Performance Goals now specifies all 4 SLAs with exact measurement points ("HTTP request received at widget-server", "multipart upload complete", etc.).
- [ ] CHK026 — Is the "≤ 100 KB gzipped" bundle size constraint measurable at build time with a specific tooling reference (e.g., `vite-bundle-analyzer`, `bundlesize` CI check)? [Measurability, Plan §Constraints]
- [ ] CHK027 — Are performance SLAs defined for the **degradation paths** (e.g., what is acceptable latency when serving a text-only fallback during voice outage)? [Gap, Performance]

---

## Degradation and Fallback Coverage

- [ ] CHK028 — Is the 3-mode degradation chain (live voice → clip → text) documented with **user-visible messaging** for each automatic mode transition? [Completeness, Plan §Constitution Check II]
- [x] CHK029 — Is the mechanism by which the widget detects voice unavailability specified? [Clarity, Gap] ✓ plan.md §Constitution Check II now documents the 3-level detection: (1) HTTP 503 from POST /widget/room → auto-switch to clip with message, (2) clip SSE error → fall back to text, (3) text always available.
- [ ] CHK030 — Is the DLQ retry behavior for WhatsApp audio failures documented with specific max-retry count, backoff strategy, and what happens after max retries are exhausted? [Completeness, Data Model §WhatsAppAudioJob]
- [ ] CHK031 — Is the "polite fallback message" text for WhatsApp audio failures locked in the spec/plan, or left to implementation discretion? [Clarity, Research §5]

---

## PII and Security Requirements

- [ ] CHK032 — Is "voice clip audio files never persisted" documented with a specific statement of what IS logged at each step (upload receipt, STT connection, transcription, error)? Audio metadata (size, duration, MIME type) may be logged — is this specified? [Clarity, Plan §Constitution Check III]
- [ ] CHK033 — Is JWT validation failure handling documented for every widget-server endpoint (what the server returns and what the widget UI shows to the customer)? [Gap, Security]
- [ ] CHK034 — Is the CORS policy for the widget-server specified (which origins are allowed, given the widget is embedded on arbitrary host pages)? [Gap, Security]
- [ ] CHK035 — Is the `LIVEKIT_WEBHOOK_SECRET` rotation procedure documented, and is it noted that all in-flight rooms are unaffected during rotation? [Gap, Security]

---

## Schema Migration Safety

- [x] CHK036 — Does the data model confirm that the `channel` CHECK constraint change does NOT invalidate existing `'whatsapp'` and `'voice'` rows? [Consistency, Data Model §Schema Change Summary] ✓ data-model.md now includes exact migration SQL: `CHECK (channel IN ('whatsapp', 'voice', 'widget'))` — all 3 values preserved. Old rows remain valid.
- [ ] CHK037 — Is there a documented rollback plan if the `live_room_name` column addition fails mid-migration (e.g., disk quota exceeded on free-tier Supabase)? [Gap, Edge Cases]
- [ ] CHK038 — Is the `IF NOT EXISTS` guard mentioned in plan.md confirmed to be idempotent across multiple restarts (not just a one-time migration)? [Clarity, Data Model §Schema Change Summary]

---

## Summary

| Category | Items | Mandatory Gate |
|---|---|---|
| Plan Completeness | CHK001–CHK006 | CHK001 (STT fix blocker) |
| Research Decision Quality | CHK007–CHK012 | CHK008 (Deepgram contingency), CHK011 (ffmpeg deployment) |
| Data Model Quality | CHK013–CHK017 | CHK016 (RLS policy), CHK017 (atomicity) |
| Contract Completeness | CHK018–CHK024 | CHK021 (webhook status code ambiguity) |
| Performance SLA Measurability | CHK025–CHK027 | CHK025 (measurement point) |
| Degradation and Fallback | CHK028–CHK031 | CHK029 (detection mechanism) |
| PII and Security | CHK032–CHK035 | CHK032 (audio persistence), CHK033 (JWT failure) |
| Schema Migration Safety | CHK036–CHK038 | CHK036 (existing row safety) |

**Total**: 38 items across 8 categories
**Mandatory gates**: 9 items — **all 9 resolved** ✓ — cleared to proceed to `/speckit-tasks`
**Remaining open**: CHK002–CHK007, CHK009–CHK010, CHK012–CHK015, CHK018–CHK020, CHK022–CHK024, CHK026–CHK028, CHK030–CHK035, CHK037–CHK038 — non-blocking; resolve during implementation or tasks generation
