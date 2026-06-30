# Code Map — Data Flow Trace

> Use this to find which file handles which step.
> `[PLANNED]` = spec exists, code not yet written. `[DONE]` = implemented.

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

## File Inventory: What Each File Does

### `core/` — No external dependencies, pure logic

| File | Status | Role |
|---|---|---|
| `core/ports.ts` | [DONE] | 11 port interfaces + 10 domain Zod schemas. The contract every adapter must fulfill. |
| `core/errors.ts` | [DONE] | Error hierarchy: IntegrationError, DatabaseDomainError, GraphTraversalError, CacheError, CircuitBreakerOpenError. PII auto-stripped from meta on IntegrationError. |
| `core/logger.ts` | [DONE] | `createLogger(module)` → JSON log lines. PII sanitization on all meta keys. |
| `core/sanitize.ts` | [DONE] | `validateAndFilterOutput()` strips profanity, PII, prompt injection from AI output. |
| `core/circuit-breaker.ts` | [PLANNED] | State machine: closed → open (3 failures) → half-open (30s) → closed. Exposes OTel gauge. |
| `core/orchestrator.ts` | [PLANNED] | `processIntent()` pipeline: 9 steps in order. Port-injected. Every step wrapped in tracer span. |

### `config/` — Boot-time setup

| File | Status | Role |
|---|---|---|
| `config/env-schema.ts` | [DONE] | Zod schema for ALL env vars. Crashes on import if any required keys missing. |
| `config/otel-bootstrap.ts` | [DONE] | OTel SDK setup: traces + metrics, 60s export interval, service name "ai-crm". |
| `config/startup-validator.ts` | [PLANNED] | Sequential checks: env → Supabase → Neo4j → Redis → Gemini → BullMQ. 3 retries each. |

### `adapters/` — Concrete implementations of port interfaces

| File | Status | Role |
|---|---|---|
| `adapters/supabase/supabase-contact-store.ts` | [PLANNED] | `IContactStore` via Supabase. PII encrypt/decrypt transparently. |
| `adapters/supabase/supabase-deal-store.ts` | [PLANNED] | `IDealStore` via Supabase. |
| `adapters/supabase/supabase-call-store.ts` | [PLANNED] | `ICallStore` via Supabase. Transcript encrypt/decrypt. |
| `adapters/supabase/supabase-ticket-store.ts` | [PLANNED] | `ITicketStore` via Supabase. |
| `adapters/supabase/supabase-account-store.ts` | [PLANNED] | `IAccountStore` via Supabase. |
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
| `features/calls/call.transcriber.ts` | [PARTIAL] | Cartesia Sonic STT types + `ICartesiaTranscriber` contract. Impl in `scripts/voice-agent.ts`. |
| `features/calls/call.summarizer.ts` | [PLANNED] | Post-call summarizer trigger. |
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
| `health/health-router.ts` | [PLANNED] | Bun.serve on port 8280. GET /health (liveness), GET /ready (degradation). |
| `health/health-checks.ts` | [PLANNED] | Per-adapter checks: Supabase SELECT 1, Neo4j CALL db.ping(), Redis PING, Gemini cached. |

### Root `scripts/`

| File | Status | Role |
|---|---|---|
| `scripts/worker.ts` | [PLANNED] | WhatsApp webhook consumer (BullMQ). Wires idempotency, DLQ, circuit breaker. |
| `scripts/voice-agent.ts` | [PARTIAL] | LiveKit room agent. Cartesia Sonic STT + TTS, orchestrator. |
| `scripts/seed.ts` | [PLANNED] | Supabase seed data insertion. |
| `scripts/ingest.ts` | [PLANNED] | Neo4j graph ingestion from Supabase seed data. |
| `scripts/eval-rag.ts` | [PLANNED] | DeepEval RAG triad against golden dataset. |
| `scripts/validate.ts` | [PLANNED] | Pre-commit pipeline orchestrator. Runs all gates. |
| `scripts/ast-firewall.ts` | [DONE] | 19-rule compile-time security scanner. `bun check`. |

---

## How to Trace a Request

```
1. Figure out the channel:
   WhatsApp → scripts/worker.ts → line 1
   Voice    → scripts/voice-agent.ts → line 1
   Web      → apps/web/src/main.ts → line 1

2. Follow to the orchestrator:
   Both worker.ts and voice-agent.ts call:
   core/orchestrator.ts → processIntent() or processIntentStream()

3. The orchestrator calls interfaces (NEVER adapters directly):
   All 11 interfaces defined in: core/ports.ts

4. To find which adapter implements an interface:
   Search for "implements I<Name>" in adapters/

5. To understand a specific step:
   Step names are in the flow diagrams above.
   Each step maps 1:1 to an interface method call in orchestrator.ts
```

## Quick Reference: "Where is X?"

| Question | Answer |
|---|---|
| Where are the database tables defined? | `supabase/migrations/` (Task 3, [PLANNED]) |
| Where does encryption happen? | `adapters/encryption/field-encryption.ts` [PLANNED] |
| Where are RLS policies? | `supabase/migrations/` (Task 3.4, [PLANNED]) |
| Where does the circuit breaker live? | `core/circuit-breaker.ts` [PLANNED] |
| Where are agent system prompts? | `agents/crm-agent.ts` (Task 7, [PLANNED]) |
| Where is the health endpoint? | `health/health-router.ts` on `:8280` [PLANNED] |
| Where are tests? | Not yet created (see discussion) |
| Where are env vars validated? | `config/env-schema.ts` [DONE] |
| Where is telemetry set up? | `config/otel-bootstrap.ts` [DONE] |
