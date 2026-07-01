# Code Map — Data Flow Trace

> Use this to find which file handles which step.
> Covers **spec 001** (AI CRM core) and **spec 002** (chat widget + WhatsApp audio).
> `[PLANNED]` = not yet implemented. `[DONE]` / `[PARTIAL]` = in repo.

---

## Flow 1: WhatsApp Message → Response (Cold Path)

```
User sends "what's the status of deal X?" in WhatsApp
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1 — WEBHOOK RECEPTION                    [PLANNED]         │
│ scripts/worker.ts                                                │
│   • Zod-validate payload (Rule 3)                                │
│   • Rate limit: 5 req/10s per sender                             │
│   • Idempotency: IIdempotencyStore.checkAndSet(msg_id, 300s)     │
│     └─ If duplicate → ACK 200, stop                              │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2 — SESSION HYDRATE                      [PLANNED]         │
│ core/orchestrator.ts → processIntent()                           │
│   • Load last N messages from Supabase                           │
│   • PII decrypted in-memory on read                              │
│   • Wrapped in tracer.startActiveSpan("orchestrator.session")    │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3 — CACHE CHECK                          [PLANNED]         │
│ core/orchestrator.ts → ICacheStore.check()                       │
│   adapters/supabase/pgvector-cache.ts                            │
│   • Uses <=> operator (cosine distance) threshold 0.05           │
│   • HIT (<200ms) → skip to Step 8                                │
│   • MISS → continue                                              │
│   • Circuit breaker wraps this call                              │
│   • Metric: crm.cache.hits counter                               │
└─────────────────────────────────────────────────────────────────┘
 │ (cache miss)
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4 — CONTACT LOOKUP                       [PLANNED]         │
│ core/orchestrator.ts → IContactStore.getByPhone()                │
│   adapters/supabase/supabase-contact-store.ts                    │
│   • SELECT * FROM contacts WHERE phone = $1 (RLS enforced)       │
│   • Decrypt phone, email in-memory                               │
│   • Decryption: adapters/encryption/field-encryption.ts          │
│     └─ AES-256-GCM + HKDF(masterKey, salt=rowId, info="contact") │
│   • Zod-validate returned row → Contact type                     │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5 — GRAPH EXPANSION                      [PLANNED]         │
│ core/orchestrator.ts → IGraphRetriever.expandFromContact()       │
│   adapters/neo4j/neo4j-graph-retriever.ts                        │
│   • Cypher: MATCH (c:Contact {id:$id})-[*1..2]-(related)        │
│   • Returns: account, deals, tickets, calls                      │
│   • Falls back to NoOpGraphRetriever if circuit breaker is open  │
│     └─ adapters/neo4j/noop-retriever.ts → empty CRMGraphContext  │
│   • Circuit breaker: core/circuit-breaker.ts                     │
│     └─ 3 failures → OPEN (30s cooldown)                          │
│   • Metric: crm.graph.traversal.duration_ms histogram            │
│   • Metric: crm.circuit_breaker.state gauge (adapter="neo4j")    │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6 — AGENT GENERATION                     [PLANNED]         │
│ core/orchestrator.ts → IAgentProvider.generate()                 │
│   adapters/ai/mastra-agent-provider.ts (primary, Gemini)         │
│   • Calls agents/crm-agent.ts with tools + graph context         │
│   • maxSteps: 8 (Rule 12 enforced)                               │
│   • Falls back to DeepSeek if Gemini circuit is open             │
│     └─ adapters/ai/deepseek-fallback-provider.ts                 │
│   • Falls back to local Ollama if both cloud APIs are down       │
│     └─ adapters/ai/ollama-local-provider.ts [PLANNED]            │
│   • Both dead → return cached response with { degraded: true }   │
│   • Metric: crm.ai.generation.duration_ms histogram              │
│   • Metric: crm.circuit_breaker.state gauge (adapter="gemini")   │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 7 — OUTPUT SANITIZATION                  [DONE]             │
│ core/sanitize.ts → validateAndFilterOutput()                     │
│   • Strip profanity (regex blacklist)                            │
│   • Strip PII (phone numbers, emails via regex)                  │
│   • Strip prompt injection patterns                              │
│   • Rule 10 enforced: must be called after any AI generation     │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 8 — CACHE STORE                           [PLANNED]         │
│ core/orchestrator.ts → ICacheStore.store()                       │
│   adapters/supabase/pgvector-cache.ts                            │
│   • INSERT embedding + response into cache_embeddings            │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 9 — SESSION APPEND                        [PLANNED]         │
│ core/orchestrator.ts → ICallStore.appendTranscript()             │
│   adapters/supabase/supabase-call-store.ts                       │
│   • Encrypt message PII before storing                           │
│   • Write to user_sessions table                                 │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 10 — AUDIT LOG                            [PLANNED]         │
│ core/orchestrator.ts                                            │
│   • INSERT into audit_logs (actor_id, action, entity_type, ...)  │
│   • Immutable — no UPDATE/DELETE allowed                         │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 11 — RESPONSE SEND                        [PLANNED]         │
│ scripts/worker.ts → WhatsApp API                                 │
│   • POST to Meta Graph API /v20.0/{phone_id}/messages            │
│   • 3 retries, exponential backoff                               │
│   • FAIL → IDeadLetterQueue.enqueue("whatsapp", job, errorMeta)  │
│     └─ adapters/messaging/bullmq-dead-letter-queue.ts            │
│     └─ Stored in dlq:whatsapp:{jobId} on Redis                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flow 2: Voice Call (LiveKit)

```
Caller dials → LiveKit room (WebRTC)
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1 — ROOM CONNECTION                       [PLANNED]         │
│ scripts/voice-agent.ts                                            │
│   • Connects to LiveKit room                                      │
│   • Cartesia Sonic STT for real-time transcription                │
│     └─ features/calls/call.transcriber.ts                         │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2 — CHUNK PROCESSING                      [PLANNED]         │
│ scripts/voice-agent.ts                                            │
│   • Each transcribed chunk → Orchestrator.processIntent()         │
│   • Same pipeline as Flow 1, Steps 2-10                          │
│   • Uses processIntentStream() for low-latency streaming          │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3 — TTS OUTPUT                            [PLANNED]         │
│ scripts/voice-agent.ts                                            │
│   • Cartesia TTS → audio frame                                   │
│   • Push to LiveKit room → caller hears                          │
│   • Interruption: cancel TTS on new speech input                  │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4 — POST-CALL SUMMARIZE                   [PLANNED]         │
│ features/calls/call.summarizer.ts                                 │
│   • Trigger summarizer agent (agents/call-summarizer.ts)          │
│   • maxSteps: 5 (Rule 12)                                        │
│   • Output: { summary, actionItems, sentiment, CRMUpdates }      │
│   • ICallStore.finalize(callId, summary)                          │
│   • FAIL → DLQ: dlq:summarization:{jobId}                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flow 3: Web Dashboard (Read-Only)

```
Operator opens apps/web/ in browser
 │
 ├── [1] Vite serves vanilla TS + Motion One
 │        apps/web/src/main.ts                                  [PLANNED]
 │
 ├── [2] Supabase Realtime WebSocket connects                  [PLANNED]
 │        apps/web/src/main.ts
 │        • Channel: deals:INSERT/UPDATE, pipeline:UPDATE
 │        • Pushes → apps/web/src/store.ts (EventTarget)
 │          └─ Components re-render via subscription
 │
 ├── [3] LiveKit transcript WebSocket connects                  [PLANNED]
 │        apps/web/src/components/transcript-pane.ts
 │        • Stream text frames → speaker bubbles
 │        • Sentiment coloring (green/neutral/red)
 │
 └── [4] Health polling every 60s                              [PLANNED]
          apps/web/src/components/metrics-sidebar.ts
          • GET http://localhost:8280/ready
          • Circuit breaker states → magnetic cards
```

---

## Flow 4: Seed Data Ingestion

```
scripts/seed.ts                                                 [PLANNED]
 │
 ├── [1] Insert 20-30 contacts into Supabase
 │        • PII fields encrypted → adapters/encryption/field-encryption.ts
 │        • Zod validation on every row
 │        • Audit log entries written
 │
 └── [2] Call scripts/ingest.ts                                [PLANNED]
          │
          ├── Read seed data from Supabase (PII decrypted)
          ├── Create Neo4j nodes: Contact, Account, Deal, Call, Ticket
          ├── Create edges: WORKS_AT, DECISION_MAKER_FOR, IN_STAGE, etc.
          ├── All Cypher parameterized (Rule 7)
          ├── Zod validation on every entity
          └── Failed batches → IDeadLetterQueue.enqueue("ingestion", ...)
```

---

## Flow 5: Widget Text Chat (spec 002 — SC-001)

```
Customer types in embedded <crm-widget> shadow DOM
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1 — WIDGET CLIENT                         [DONE]            │
│ apps/widget/src/modes/text.ts → sendText()                       │
│   • POST /widget/chat + Bearer JWT                               │
│   • ReadableStream SSE consumer → store.appendToken()              │
│   • 401 → auth.ts handleUnauthorized() → store.sessionExpired()│
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2 — WIDGET SERVER                         [DONE]            │
│ scripts/widget-server.ts → handleChat()                          │
│   • JWT auth + per-contact rate limit                            │
│   • getOrCreateSession(sessionId, contactId) — 30min TTL         │
│   • orchestrator.processIntentStream({ channel: "widget" })        │
│   • SSE: token → done                                            │
│   • OTel span: widget.chat                                       │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
 (same orchestrator pipeline as Flow 1, Steps 2–10)
```

---

## Flow 6: Widget Voice Clip (spec 002 — SC-002)

```
Customer holds mic button (≤60s)
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1 — RECORD + UPLOAD                       [DONE]            │
│ apps/widget/src/modes/clip.ts                                    │
│   • MediaRecorder (audio/webm) → multipart POST /widget/audio    │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2 — TRANSCODE + STT                       [DONE]            │
│ scripts/widget-server.ts → handleAudio()                         │
│   • scripts/audio-utils.ts → parseAudioUpload() + transcodeToRaw()│
│   • features/calls/clip-transcriber.ts → CartesiaClipTranscriber │
│   • ffmpeg absent → 503 { error: "audio unavailable", fallback } │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3 — STREAM REPLY                          [DONE]            │
│ SSE: transcript frame → token frames → done                      │
│ Widget: transcript → chat.appendTurn('customer', …, 'clip')      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flow 7: Widget Live Voice (spec 002 — SC-003)

```
Customer toggles live voice
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1 — ROOM CREATION                          [DONE]            │
│ apps/widget/src/modes/voice.ts → POST /widget/room               │
│ scripts/widget-server.ts → LiveKitRoomAdapter.createWidgetRoom() │
│   • Agent dispatch: crm-voice-agent                                │
│   • 503 degraded → store.voiceUnavailable('degraded') → clip mode  │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2 — WEBRTC + AGENT                        [DONE]            │
│ voice.ts loads livekit-client from CDN on first use (bundle size)│
│ scripts/voice-agent.ts — LiveKit Agents worker, barge-in         │
│ POST /livekit/webhook — room_started watchdog (15s no-pickup)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flow 8: WhatsApp Audio Ingress (spec 002 — SC-005)

```
WhatsApp user sends voice note
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1 — WEBHOOK + DOWNLOAD                    [DONE]            │
│ scripts/worker.ts → processWhatsAppAudio()                       │
│   • downloadWhatsAppAudio(mediaId) — node:http, Zod boundaries   │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2 — TRANSCODE + STT + ORCHESTRATE         [DONE]            │
│ audio-utils.transcodeToRaw() → CartesiaClipTranscriber.finalize() │
│ orchestrator.processIntent({ channel: "whatsapp", message })     │
└─────────────────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3 — TTS REPLY                             [DONE]            │
│ Cartesia TTS → upload media → send audio message                   │
│ Fail → DLQ whatsapp_audio_fallback + text fallback message       │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Inventory: What Each File Does

### `core/` — No external dependencies, pure logic

| File | Status | Role |
|---|---|---|
| `core/ports.ts` | [DONE] | 12 port interfaces (+ `ILiveKitRoomManager`) + domain Zod schemas. |
| `core/errors.ts` | [DONE] | Error hierarchy: IntegrationError, DatabaseDomainError, GraphTraversalError, CacheError, CircuitBreakerOpenError. PII auto-stripped from meta on IntegrationError. |
| `core/logger.ts` | [DONE] | `createLogger(module)` → JSON log lines. PII sanitization on all meta keys. |
| `core/sanitize.ts` | [DONE] | `validateAndFilterOutput()` strips profanity, PII, prompt injection from AI output. |
| `core/circuit-breaker.ts` | [DONE] | State machine: closed → open (3 failures) → half-open (30s) → closed. |
| `core/orchestrator.ts` | [DONE] | `processIntent()` / `processIntentStream()` pipeline. Port-injected. |

### `config/` — Boot-time setup

| File | Status | Role |
|---|---|---|
| `config/env-schema.ts` | [DONE] | Zod schema for ALL env vars. Crashes on import if any required keys missing. |
| `config/otel-bootstrap.ts` | [DONE] | OTel SDK setup: traces + metrics, 60s export interval, service name "ai-crm". |
| `config/startup-validator.ts` | [DONE] | Sequential checks + `registerWidgetStartupChecks()` (LiveKit, ffmpeg). |

### `adapters/` — Concrete implementations of port interfaces

| File | Status | Role |
|---|---|---|
| `adapters/supabase/contact-store.ts` | [DONE] | `IContactStore` via Supabase. |
| `adapters/supabase/deal-store.ts` | [DONE] | `IDealStore` via Supabase. |
| `adapters/supabase/call-store.ts` | [DONE] | `ICallStore` via Supabase. |
| `adapters/supabase/ticket-store.ts` | [DONE] | `ITicketStore` via Supabase. |
| `adapters/supabase/account-store.ts` | [DONE] | `IAccountStore` via Supabase. |
| `adapters/livekit/livekit-room.adapter.ts` | [DONE] | `ILiveKitRoomManager` — room create, dispatch, webhook verify, healthCheck. |
| `adapters/supabase/pgvector-cache.ts` | [DONE] | `ICacheStore` via pgvector `<=>` operator (inside `match_cache_embeddings` RPC). Stores response hash as `prompt_hash` for content-addressable dedup. Table: `public.cache_embeddings`. |
| `adapters/neo4j/neo4j-graph-retriever.ts` | [PLANNED] | `IGraphRetriever` via Neo4j Cypher. 2-hop traversal. |
| `adapters/neo4j/noop-retriever.ts` | [PLANNED] | `IGraphRetriever` fallback. Empty context. Used when Neo4j circuit is open. |
| `adapters/ai/gemini-embedding.ts` | [DONE] | `IEmbeddingProvider` via Gemini text-embedding-004. 768-dim. Zod-validated response. |
| `adapters/ai/cached-embedding-provider.ts` | [PLANNED] | `IEmbeddingProvider` fallback. Returns last-known embedding. |
| `adapters/ai/mastra-agent.ts` | [DONE] | `IAgentProvider` via Gemini generateContent. Falls back to DeepSeek. Zod-validated. |
| `adapters/ai/deepseek-fallback.ts` | [DONE] | `IAgentProvider` fallback via DeepSeek chat/completions. Zod-validated. |
| `adapters/ai/ollama-local.ts` | [DONE] | `IAgentProvider` third-tier fallback via local Ollama. Conditional on `LOCAL_LLM_URL`. Zero API cost. |
| `adapters/messaging/redis-idempotency-store.ts` | [PLANNED] | `IIdempotencyStore` via Redis SET NX EX. |
| `adapters/messaging/supabase-idempotency-store.ts` | [PLANNED] | `IIdempotencyStore` fallback via Supabase. |
| `adapters/messaging/bullmq-dead-letter-queue.ts` | [PLANNED] | `IDeadLetterQueue` via BullMQ. |
| `adapters/encryption/field-encryption.ts` | [PLANNED] | AES-256-GCM + HKDF per-row key derivation. `encrypt()`, `decrypt()`, `rotateKey()`. |

### `features/` — CRM domain types + Mastra tools

| File | Status | Role |
|---|---|---|
| `features/contacts/contact.types.ts` | [PLANNED] | Contact Zod types. |
| `features/contacts/contact.tools.ts` | [PLANNED] | `lookupContact(phone)` Mastra tool. |
| `features/deals/deal.types.ts` | [PLANNED] | Deal Zod types + pipeline stage enum. |
| `features/deals/deal.tools.ts` | [PLANNED] | `getDeals(contactId)`, `updateDeal()` tools. |
| `features/accounts/account.types.ts` | [PLANNED] | Account type + health_score. |
| `features/tickets/ticket.types.ts` | [PLANNED] | Ticket type + status/priority enums. |
| `features/tickets/ticket.tools.ts` | [PLANNED] | `getTickets`, `createTicket` tools. |
| `features/calls/call.types.ts` | [PLANNED] | Call type + transcript json + sentiment. |
| `features/calls/call.transcriber.ts` | [DONE] | Cartesia live STT types + contract. Impl in `scripts/voice-agent.ts`. |
| `features/calls/clip-transcriber.ts` | [DONE] | `CartesiaClipTranscriber` — async clip STT (widget + WhatsApp). |
| `features/pipeline/pipeline.types.ts` | [PLANNED] | PipelineStage type + ordered stages. |
| `features/pipeline/pipeline.analyzer.ts` | [PLANNED] | Pipeline analyzer agent trigger. |

### `agents/` — Mastra agent definitions

| File | Status | Role |
|---|---|---|
| `agents/crm-agent.ts` | [PLANNED] | Main CRM agent. Tools: lookupContact, getDeals, getTickets, updateDeal, createTicket. maxSteps: 8. |
| `agents/call-summarizer.ts` | [PLANNED] | Post-call transcript summarizer. maxSteps: 5. |
| `agents/live-assist.ts` | [PLANNED] | During-call rep prompts. maxSteps: 4. |
| `agents/pipeline-analyzer.ts` | [PLANNED] | Stale deal risk report. maxSteps: 6. |

### `health/` — Startup validation + HTTP endpoints

| File | Status | Role |
|---|---|---|
| `health/health-router.ts` | [DONE] | Node http on :8280. GET /health, GET /ready (adapters array). |
| `health/health-checks.ts` | [DONE] | Per-adapter checks; livekit (3s), cartesia, ffmpeg registrars. |

### Root `scripts/`

| File | Status | Role |
|---|---|---|
| `scripts/worker.ts` | [DONE] | WhatsApp webhook + text/audio pipelines, DLQ fallback. |
| `scripts/voice-agent.ts` | [DONE] | LiveKit Agents worker (`crm-voice-agent`), Cartesia STT/TTS, barge-in. |
| `scripts/widget-server.ts` | [DONE] | Widget HTTP :8290 — chat/audio/room routes, CORS, JWT, LiveKit webhook. |
| `scripts/audio-utils.ts` | [DONE] | ffmpeg transcode, multipart parse, `isFfmpegAvailable()`. |
| `scripts/ast-firewall.ts` | [DONE] | 28-rule compile-time security scanner. `pnpm check`. |

### `apps/widget/` — Embeddable chat widget (spec 002)

| File | Status | Role |
|---|---|---|
| `apps/widget/src/index.ts` | [DONE] | `<crm-widget>` custom element, `window.crmWidget` queue API. |
| `apps/widget/src/widget.ts` | [DONE] | init/mount/open/close, health probe, component wiring. |
| `apps/widget/src/store.ts` | [DONE] | EventTarget state — modes, degradation banners, blocked flag. |
| `apps/widget/src/auth.ts` | [DONE] | JWT 401 → sessionExpired(). |
| `apps/widget/src/modes/text.ts` | [DONE] | POST /widget/chat SSE consumer. |
| `apps/widget/src/modes/clip.ts` | [DONE] | MediaRecorder + POST /widget/audio. |
| `apps/widget/src/modes/voice.ts` | [DONE] | LiveKit room join; CDN-loaded livekit-client. |
| `apps/widget/src/ui/chat.ts` | [DONE] | Message bubbles, streaming tokens, aria-live log. |
| `apps/widget/src/ui/input.ts` | [DONE] | Textarea, send/mic/voice controls, degradation UI. |
| `apps/widget/src/ui/styles.ts` | [DONE] | Shadow DOM CSS string. |
| `apps/widget/vite.config.ts` | [DONE] | IIFE bundle; livekit-client external (≤100 KB gzip). |

---

## How to Trace a Request

```
1. Figure out the channel:
   WhatsApp → scripts/worker.ts
   Voice (PSTN/LiveKit agent) → scripts/voice-agent.ts
   Widget text/clip → apps/widget → scripts/widget-server.ts
   Widget live voice → apps/widget/modes/voice.ts → widget-server → voice-agent
   Web dashboard → apps/web/src/main.ts

2. Follow to the orchestrator:
   worker.ts, voice-agent.ts, widget-server.ts all call:
   core/orchestrator.ts → processIntent() or processIntentStream()

3. The orchestrator calls interfaces (NEVER adapters directly):
   All interfaces defined in: core/ports.ts (12 ports)

4. Widget-specific I/O (not orchestrator ports):
   ILiveKitRoomManager → adapters/livekit/livekit-room.adapter.ts
   CartesiaClipTranscriber → features/calls/clip-transcriber.ts
```

## Quick Reference: "Where is X?"

| Question | Answer |
|---|---|
| Where are the database tables defined? | `supabase/migrations/` (Task 3, [PLANNED]) |
| Where does encryption happen? | `adapters/encryption/field-encryption.ts` [PLANNED] |
| Where are RLS policies? | `supabase/migrations/` (Task 3.4, [PLANNED]) |
| Where does the circuit breaker live? | `core/circuit-breaker.ts` [PLANNED] |
| Where are agent system prompts? | `agents/crm-agent.ts` (Task 7, [PLANNED]) |
| Where is the health endpoint? | `health/health-router.ts` on `:8280` [DONE] |
| Where is the widget server? | `scripts/widget-server.ts` on `:8290` [DONE] |
| Where is the embeddable widget? | `apps/widget/dist/widget.js` (IIFE, shadow DOM) [DONE] |
| Where is clip/WhatsApp STT? | `features/calls/clip-transcriber.ts` [DONE] |
| Where is ffmpeg transcoding? | `scripts/audio-utils.ts` [DONE] |
| Where are widget self-checks? | `packages/ai-core/src/__tests__/*.selfcheck.ts` [DONE] |
| How do I run everything locally? | [.knowledge/run-and-verify.md](./run-and-verify.md) |
| Where are env vars validated? | `config/env-schema.ts` [DONE] |
| Where is telemetry set up? | `config/otel-bootstrap.ts` [DONE] |
