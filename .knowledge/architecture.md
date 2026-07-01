# AI CRM — Infrastructure Architecture

## Layer Model

The system is organized into 7 logical layers. Data flows inward from external transport to the orchestrator, fanning out to adapters, and back.

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         LAYER 7 — CLIENTS / USERS                       ║
║  WhatsApp user │ Voice caller │ Web browser (operator dashboard)        ║
║  Widget customer (embed) │ apps/widget/ shadow DOM                     ║
╚══════════════════════════════════════╤═══════════════════════════════════╝
                                       │
                                       ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                      LAYER 6 — TRANSPORT / INGRESS                      ║
║  Meta webhook (HTTPS) │ LiveKit room (WebRTC) │ Vite dev server (:5173) ║
║  worker.ts            │ voice-agent.ts        │ apps/web/               ║
║  widget-server.ts (:8290) │ apps/widget/ IIFE bundle                    ║
╚══════════════════════════════════════╤═══════════════════════════════════╝
                                       │
                                       ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                    LAYER 5 — ORCHESTRATOR (core/)                       ║
║  orchestrator.ts                                                         ║
║  ┌────────────────────────────────────────────────────────────────────┐ ║
║  │ processIntent() pipeline:                                           │ ║
║  │   hydrate → cache → contact → graph → agent → sanitize → store     │ ║
║  │   Every step: circuit breaker + tracer.startActiveSpan()            │ ║
║  └────────────────────────────────────────────────────────────────────┘ ║
║  Depends on: ports.ts (12 interfaces — NEVER concrete adapters)         ║
╚══════════════════════════════════╤═══════════════════════════════════════╝
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                         ▼
╔══════════════════╗  ╔══════════════════════╗  ╔══════════════════════╗
║ LAYER 4a — STORE ║  ║ LAYER 4b — RETRIEVER║  ║ LAYER 4c — AI       ║
║ (adapters/)      ║  ║ (adapters/)          ║  ║ (adapters/)         ║
║                  ║  ║                      ║  ║                     ║
║ SupabaseContact  ║  ║ Neo4jGraphRetriever  ║  ║ GeminiEmbedding     ║
║ SupabaseDeal     ║  ║   ↓ fallback         ║  ║   ↓ fallback        ║
║ SupabaseCall     ║  ║ NoOpGraphRetriever   ║  ║ CachedEmbedding     ║
║ SupabaseTicket   ║  ║                      ║  ║ MastraAgent (Gemini)║
║ SupabaseAccount  ║  ║                      ║  ║   ↓ fallback        ║
║                  ║  ║                      ║  ║ DeepSeekFallback    ║
╚═══════╤══════════╝  ╚═══════╤══════════════╝  ╚══════╤═══════════════╝
        │                     │                        │
        ▼                     ▼                        ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                     LAYER 3 — INFRASTRUCTURE SERVICES                    ║
║                                                                          ║
║  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ║
║  │ Supabase │  │  Neo4j   │  │  Redis   │  │  BullMQ  │  │ Grafana  │  ║
║  │pgvector  │  │ AuraDB   │  │ (Upstash)│  │  (Redis) │  │  Cloud   │  ║
║  │ 500MB    │  │ 200MB    │  │ 256MB    │  │          │  │  Free    │  ║
║  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  ║
║  Contact CRUD   Graph expand  Idempotency   DLQ / jobs    OTel traces   ║
║  PII encry.    2-hop traverse  Cache keys   WhatsApp out   metrics     ║
║  RLS policies  50K nodes      Session data  Summarization  logs        ║
╚══════════════════════════════════════════════════════════════════════════╝
                                       │
                                       ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                    LAYER 2 — CROSS-CUTTING CONCERNS                      ║
║                                                                          ║
║  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     ║
║  │ Circuit     │  │ Encryption  │  │ Telemetry   │  │ Health      │     ║
║  │ Breakers    │  │ AES-256-GCM │  │ OTel spans  │  │ :8280       │     ║
║  │ 3 fail→30s  │  │ HKDF keys   │  │ metrics     │  │ /health     │     ║
║  │ per adapter │  │ per-row salt│  │ 60s interval│  │ /ready      │     ║
║  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     ║
╚══════════════════════════════════════════════════════════════════════════╝
                                       │
                                       ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                     LAYER 1 — BUILD + QUALITY GATES                      ║
║                                                                          ║
║  ┌──────────────────────────────────────────────────────────────────┐   ║
║  │ Pre-commit pipeline: bun run validate                             │   ║
║  │  ├── AST Firewall (19 rules, compile-time, blocks build)          │   ║
║  │  ├── RAG Triad (DeepEval, Faith≥0.90, Relevance≥0.85, Prec≥0.85) │   ║
║  │  ├── P95 Latency (WhatsApp<2s, Voice<1.5s, Cold<3s)              │   ║
║  │  ├── Metric Ceiling (≤2000 series, ≤5GB traces)                  │   ║
║  │  └── SLA Gates (cache≥30%, CB<60s, DLQ<50, AI fail<5%)           │   ║
║  └──────────────────────────────────────────────────────────────────┘   ║
║  Runtime: Bun 1.3+  │  Monorepo: packages/ai-core/ + apps/web/          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Data Flow: WhatsApp Message (Cold Path)

```
WhatsApp user sends "what's the status of deal X?"
        │
        ▼
Meta webhook POST ──► worker.ts
        │
        ├──[1] Zod validate payload (Rule 3)
        ├──[2] Rate limit: 5 req/10s per sender
        ├──[3] Idempotency check: IIdempotencyStore.checkAndSet(msg_id, 300s)
        │         └── Redis SET NX EX → if exists, ACK 200, stop
        │
        ▼
Orchestrator.processIntent(intent)
        │
        ├──[4] tracer.startActiveSpan("orchestrator.pipeline")
        │
        ├──[5] Session hydrate: load last N messages from Supabase (PII decrypted in-memory)
        │
        ├──[6] Cache check: ICacheStore.check(embedding)
        │         └── HIT (<200ms) → return cached response, skip to [10]
        │         └── MISS → continue
        │
        ├──[7] Contact lookup: IContactStore.getByPhone(phone)
        │         └── Supabase: SELECT on contacts (RLS enforced)
        │         └── Decrypt phone/email in-memory (AES-256-GCM + HKDF)
        │
        ├──[8] Graph expansion: IGraphRetriever.expandFromContact(contactId)
        │         └── Circuit breaker: Neo4jGraphRetriever
        │         └── OPEN → fallback: NoOpGraphRetriever (empty context)
        │         └── CLOSED → Cypher: MATCH (c:Contact {id})-[*1..2]-(related) (parameterized, Rule 7)
        │
        ├──[9] Agent generation: IAgentProvider.generate(context, tools)
        │         └── Circuit breaker: MastraAgentProvider (Gemini)
        │         └── OPEN → fallback: DeepSeekFallbackProvider
        │         └── OPEN → fallback: OllamaLocalProvider (if LOCAL_LLM_URL set)
        │         └── ALL DEAD → cached response with { degraded: true }
        │
        ├──[10] Sanitization: validateAndFilterOutput(raw)
        │         └── Strip PII, enforce length, validate structure (Rule 10)
        │
        ├──[11] Cache store: ICacheStore.store(embedding, response)
        │
        ├──[12] Session append: write message to user_sessions (PII encrypted before write)
        │
        ├──[13] Audit log: INSERT into audit_logs (immutable)
        │
        └──[14] span.end()
        │
        ▼
Response sent via WhatsApp API
        │
        ├── SUCCESS → done
        └── FAIL (3 retries, exponential backoff) → IDeadLetterQueue.enqueue("whatsapp", job, errorMeta)
                                                  └── BullMQ: dlq:whatsapp:{jobId}
```

---

## Data Flow: Voice Call (LiveKit)

```
Caller dials in ──► LiveKit room (WebRTC)
        │
        ▼
voice-agent.ts connects to room
        │
        ├── Audio frames stream in (Cartesia Sonic STT)
        │
LOOP:   ├── Chunk transcribed → text
        │         │
        │         ▼
        │   Orchestrator.processIntent(text)  ← same pipeline as WhatsApp [4-13]
        │         │
        │         ▼
        │   TTS: Cartesia → audio frame
        │         │
        │         ▼
        │   Push to LiveKit room → caller hears response
        │
        └── Call ends → ICallStore.finalize(callId, summary)
                         └── Post-call summarizer agent (Mastra, async job)
                             └── FAIL → DLQ: dlq:summarization:{jobId}
```

---

## Data Flow: Chat Widget (spec 002)

Three input modes share one orchestrator pipeline; degradation is live voice → voice clip → text.

```
Customer site embeds <script src="widget.js">
        │
        ▼
apps/widget/ (shadow DOM, ≤100 KB gzip base bundle)
        │
        ├── Text: POST /widget/chat → SSE tokens
        │         scripts/widget-server.ts → processIntentStream(channel:"widget")
        │
        ├── Clip: MediaRecorder → POST /widget/audio (multipart)
        │         transcodeToRaw (ffmpeg) → CartesiaClipTranscriber → SSE
        │         ffmpeg down → 503 → mic disabled, text still works
        │
        └── Live: POST /widget/room → LiveKit token
                  livekit-client (CDN on demand) → WebRTC
                  voice-agent.ts (crm-voice-agent) joins via AgentDispatch
                  LiveKit down → 503 → banner + clip fallback
        │
        ▼
GET :8280/ready on init → voiceAvailable / sttAvailable flags
JWT expired → store.blocked, banner, all modes no-op
```

**CORS**: `widget-server.ts` — `Access-Control-Allow-Origin: *` default; `WIDGET_ALLOWED_ORIGINS` comma-list enforces Origin check (403).

---

## Data Flow: WhatsApp Audio (spec 002)

```
WhatsApp audio message webhook
        │
        ▼
worker.ts → downloadWhatsAppAudio → transcodeToRaw → CartesiaClipTranscriber
        │
        ▼
orchestrator.processIntent(channel:"whatsapp", message:transcript)
        │
        ▼
Cartesia TTS (≤1000 words) → Meta media upload → audio reply
        │
        └── FAIL → DLQ whatsapp_audio_fallback + text fallback message
```

---

## Data Flow: Web Dashboard (Read-Only)

```
Operator opens apps/web/ in browser
        │
        ├── Vite serves vanilla TS + Motion One (no framework)
        │
        ├──[1] Supabase Realtime WebSocket connects
        │         └── Channel: deals:INSERT/UPDATE, pipeline:UPDATE
        │         └── Pushes → EventTarget store → DOM updates
        │
        ├──[2] LiveKit transcript WebSocket connects
        │         └── Stream text frames → transcript-pane.ts
        │         └── Speaker alternation (left=caller, right=agent)
        │
        └──[3] GET /ready (port 8280) polled every 30s
                  └── Circuit breaker states → metrics-sidebar.ts
                  └── Magnetic cards update (green/amber/red)
                  └── OTel Prometheus endpoint (optional fallback)
```

---

## Service Topology

```
                          ┌─────────────────────┐
                          │    Meta WhatsApp     │
                          │    (webhook POST)    │
                          └──────────┬──────────┘
                                     │ HTTPS
                          ┌──────────▼──────────┐
                          │    worker.ts         │
                          │    (BullMQ consumer) │
                          └──────────┬──────────┘
                                     │
┌─────────────┐          ┌───────────▼───────────┐          ┌─────────────┐
│  LiveKit    │  WebRTC  │                       │  HTTP    │  Browser    │
│  (voice)    ├─────────►│  OrchestratorService  │◄─────────┤  (dashboard)│
│             │          │  (core/orchestrator)  │  :8280   │  apps/web/  │
└─────────────┘          └─────┬─────┬─────┬─────┘          └─────────────┘
                               │     │     │          ┌───────────────────┐
                               │     │     │          │  Customer sites   │
                               │     │     └─────────►│  apps/widget/     │
                               │     │                │  widget-server    │
                               │     │                │  :8290            │
                               │     │                └───────────────────┘
                    ┌──────────┘     │     └──────────┐
                    ▼                ▼                 ▼
          ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐
          │  Supabase   │  │  Neo4j      │  │  Gemini/DeepSeek│
          │  (pgvector) │  │  AuraDB     │  │  + Ollama(local)│
          │  + RLS      │  │  Free 200MB │  │  (AI models)    │
          └──────┬──────┘  └──────┬──────┘  └────────┬────────┘
                 │                │                   │
                 ▼                ▼                   ▼
          ┌─────────────────────────────────────────────────┐
          │              Redis (Upstash Free)                │
          │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
          │  │Idempotency│  │  Cache   │  │  BullMQ      │  │
          │  │ keys      │  │  keys    │  │  queues+DLQ  │  │
          │  └──────────┘  └──────────┘  └──────────────┘  │
          └─────────────────────┬───────────────────────────┘
                                │
                                ▼
          ┌─────────────────────────────────────────────────┐
          │           Grafana Cloud (OTel)                   │
          │   traces │ metrics (≤2000 series) │ logs        │
          └─────────────────────────────────────────────────┘
```

---

## Port Interface Map

All 12 interfaces defined in `core/ports.ts`. Orchestrator depends ONLY on the store/AI/messaging ports.

Widget transport uses additional adapters outside the orchestrator constructor:

```
ILiveKitRoomManager  → LiveKitRoomAdapter     (room create, dispatch, webhook)
CartesiaClipTranscriber → clip-transcriber.ts (widget clip + WhatsApp audio STT)
```

```
OrchestratorService(ports: {
  contactStore:      IContactStore       → SupabaseContactStore
  dealStore:         IDealStore          → SupabaseDealStore
  callStore:         ICallStore          → SupabaseCallStore
  ticketStore:       ITicketStore        → SupabaseTicketStore
  accountStore:      IAccountStore       → SupabaseAccountStore
  graphRetriever:    IGraphRetriever     → Neo4jGraphRetriever
                                          → NoOpGraphRetriever (degraded)
  embeddingProvider: IEmbeddingProvider  → GeminiEmbeddingProvider
                                          → CachedEmbeddingProvider (degraded)
  agentProvider:     IAgentProvider      → MastraAgentProvider
                                          → DeepSeekFallbackProvider (degraded)
  cacheStore:        ICacheStore         → PgVectorCache
  idempotencyStore:  IIdempotencyStore   → RedisIdempotencyStore
                                          → SupabaseIdempotencyStore (fallback)
  deadLetterQueue:   IDeadLetterQueue    → BullMQDeadLetterQueue
})
```

---

## Fallback Decision Tree

```
Adapter call
    │
    ├── Circuit breaker state?
    │       ├── CLOSED → call primary adapter
    │       │       ├── SUCCESS → return result
    │       │       └── FAIL → increment failure count
    │       │                  └── 3 failures → OPEN (30s cooldown)
    │       │
    │       └── OPEN → skip primary, go to fallback
    │
    └── Fallback chain (per adapter):
            Neo4j down       → NoOpGraphRetriever (empty context)
            Gemini embed down → CachedEmbeddingProvider (last-known embedding)
            Gemini gen down   → DeepSeekFallbackProvider
            Both cloud down   → OllamaLocalProvider (conditional, $0)
            All AI dead        → cached response + { degraded: true }
            Redis down        → SupabaseIdempotencyStore (idempotency_keys table)
            Both idemp. down  → at-least-once (process anyway, availability > consistency)
            Widget live voice → clip mode (503 on /widget/room)
            Widget clip STT   → text mode (503 on /widget/audio, ffmpeg/Cartesia down)
            Text mode         → never fails (always available)
```

---

## Security Boundary Map

```
┌──────────────────────────────────────────────────────────────┐
│                      TRUST BOUNDARY                           │
│                                                              │
│  WhatsApp webhook   ─── Zod parse ───►  Internal State       │
│  Widget HTTP/SSE    ─── Zod parse ───►  (validated, typed)   │
│  Widget multipart   ─── busboy + MIME ─►                       │
│  Voice audio        ─── STT text ───►                        │
│  Supabase Realtime  ─── Zod parse ───►                       │
│  LiveKit transcript ─── Zod parse ───►                       │
│                                                              │
│  Enforced by: Rule 3 (fetch), Rule 18 (WebSocket .on())      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Internal State ───► Storage                                  │
│                                                              │
│  PII fields (phone, email, transcript):                      │
│    AES-256-GCM encrypt ──► Supabase (ciphertext only)        │
│    HKDF(masterKey, salt=row_id, info=entity) per row         │
│                                                              │
│  Enforced by: Rule 19 (createCipheriv("aes-256-gcm"))        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Storage ───► Read                                            │
│                                                              │
│  Supabase RLS policies:                                       │
│    admin → full CRUD                                          │
│    agent → own contacts/deals/calls only                      │
│    viewer → read-only, assigned entities                      │
│    service_role → bypass (orchestrator only, never exposed)   │
│                                                              │
│  All access logged → audit_logs (immutable, 90d retention)    │
│                                                              │
│  Enforced by: Rule 8 (no raw SQL bypassing RLS)              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  AI Output ───► Response                                      │
│                                                              │
│  validateAndFilterOutput():                                   │
│    Strip PII, enforce length, validate structure              │
│                                                              │
│  Enforced by: Rule 10 (sanitizer must exist)                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Logs / Telemetry ───► External                                │
│                                                              │
│  No API keys, no PII in:                                     │
│    console.error / logger.* (Rule 5)                         │
│    span.setAttribute() / span.addEvent() (Rule 13)           │
│    Error metadata (Rule 5)                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Free Tier Budget Map

```
                    ┌─────────────┐
                    │  Supabase   │  500MB DB, 2GB bandwidth
                    │   pgvector  │  PII encrypted, compressed JSONB
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Neo4j      │  200MB, 50K nodes, 175K edges
                    │  AuraDB     │  Sparse graph — business relationships only
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Redis      │  256MB, 10K commands/day
                    │  (Upstash)  │  Idempotency keys (300s TTL) + BullMQ
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Grafana    │  50GB traces, 10K metrics, 14d retention
                    │  Cloud      │  Ceiling: 2000 series, 5GB traces, 2GB logs
                    └──────┬──────┘
                           │
                    ┌──────────────┐
                    │  Ollama      │  Your hardware (RAM/GPU)
                    │  (local)     │  $0 — third-tier fallback only
                    │  Optional    │  7B model ~8GB RAM
                    └──────┬───────┘
                           │
                    ┌──────▼──────┐
                    │  LiveKit    │  50GB/month
                    │  + Cartesia │  Sonic STT + TTS; voice only, low concurrent rooms
                    └─────────────┘
```

---

## AST Firewall: 28 Rules x 7 Domains

```
Domain A: Zod Boundary Safety       Domain E: Telemetry
  R1  Schema Constraints              R13 Span PII Guard
  R2  Anti-Cheat                      R14 Span Coverage
  R3  Boundary Zod Wrap
  R18 WebSocket Boundary            Domain F: Type Safety
                                       R15 No Any (+ as any)
Domain B: Error & Resilience
  R4  Catch Type-Guard              Domain G: Architecture
  R5  Error PII (+ logger.*)          R16 Port Injection
  R6  Graceful Shutdown
  R17 Circuit Breaker

Domain C: Query & Data
  R7  Neo4j Parameterized
  R8  Supabase RLS
  R9  PG Vector Operator
  R19 Crypto Algorithm

Domain D: AI Pipeline
  R10 Output Sanitization
  R11 Mastra Tool Contract
  R12 Agent Step Ceiling
```

---

## Local development

See **[run-and-verify.md](./run-and-verify.md)** for step-by-step startup (ports 8280/8290/3000/5173), tiered verification, and troubleshooting.
