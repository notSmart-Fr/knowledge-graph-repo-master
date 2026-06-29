# Contracts: AI-Powered CRM Core

## Port Interfaces

All port interfaces are defined in `packages/ai-core/src/core/ports.ts`. Each adapter MUST implement exactly one port interface.

### IContactStore

```typescript
interface IContactStore {
  getByPhone(phone: string): Promise<Contact | null>;
  getById(id: string): Promise<Contact | null>;
  search(query: string): Promise<Contact[]>;
  create(contact: Omit<Contact, "id" | "created_at">): Promise<Contact>;
  update(id: string, fields: Partial<Contact>): Promise<Contact>;
}
```

### IDealStore

```typescript
interface IDealStore {
  getByContact(contactId: string): Promise<Deal[]>;
  getById(id: string): Promise<Deal | null>;
  update(id: string, fields: Partial<Deal>): Promise<Deal>;
}
```

### ICallStore

```typescript
type TranscriptChunk = {
  speaker: "customer" | "agent";
  text: string;
  timestamp_ms: number;
  sentiment: "positive" | "neutral" | "negative";
};

interface ICallStore {
  create(call: Omit<Call, "id" | "created_at">): Promise<Call>;
  appendTranscript(callId: string, chunk: TranscriptChunk): Promise<void>;
  finalize(callId: string, summary: CallSummary): Promise<Call>;
  getById(id: string): Promise<Call | null>;
}
```

### ITicketStore

```typescript
interface ITicketStore {
  getByContact(contactId: string): Promise<Ticket[]>;
  create(ticket: Omit<Ticket, "id" | "created_at">): Promise<Ticket>;
  update(id: string, fields: Partial<Ticket>): Promise<Ticket>;
}
```

### IAccountStore

```typescript
interface IAccountStore {
  getById(id: string): Promise<Account | null>;
  getHealthScore(id: string): Promise<number>;
}
```

### IGraphRetriever

```typescript
interface IGraphRetriever {
  expandFromContact(contactId: string): Promise<CRMGraphContext>;
  expandFromDeal(dealId: string): Promise<CRMGraphContext>;
  getStaleDeals(days: number): Promise<Deal[]>;
}
```

### IEmbeddingProvider

```typescript
interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

### IAgentProvider

```typescript
interface IAgentProvider {
  generate(context: AgentContext, tools: MastraTool[]): Promise<AgentResponse>;
  generateStream(context: AgentContext, tools: MastraTool[]): AsyncIterable<AgentChunk>;
}
```

### ICacheStore

```typescript
interface ICacheStore {
  check(embedding: number[]): Promise<CachedResponse | null>;
  store(embedding: number[], response: CachedResponse): Promise<void>;
}
```

### IIdempotencyStore

```typescript
interface IIdempotencyStore {
  checkAndSet(key: string, ttl: number): Promise<boolean>;
}
```

### IDeadLetterQueue

```typescript
interface IDeadLetterQueue {
  enqueue(queue: string, job: unknown, errorMeta: DLErrorMeta): Promise<void>;
  replay(queue: string, jobId: string): Promise<void>;
  purge(queue: string): Promise<number>;
  listDead(queue: string, limit?: number, offset?: number): Promise<DLJobEntry[]>;
}

type DLErrorMeta = {
  errorCode: string;
  errorMessage: string;
  attemptCount: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  nextRetryAt?: string;
};

type DLJobEntry = {
  id: string;
  queue: string;
  job: unknown;
  errorMeta: DLErrorMeta;
  enqueuedAt: string;
};
```

## Orchestrator Contract

### processIntent()

```typescript
function processIntent(
  sessionId: string,
  channel: "whatsapp" | "voice",
  userId: string,
  message: string
): Promise<OrchestratorResponse>;

interface OrchestratorResponse {
  text: string;
  metadata: OrchestratorMetadata;
  session: {
    id: string;
    turnCount: number;
  };
}

interface OrchestratorMetadata {
  degraded: boolean;
  modelUsed: string;
  cacheHit: boolean;
  graphContextUsed: boolean;
}
```

### Degradation Metadata

```typescript
// When degraded=true, the following fields describe what degraded:
interface DegradationDescriptor {
  primaryModelFailed: boolean;      // true when primary AI provider was unreachable
  graphSkipped: boolean;            // true when knowledge graph expansion was skipped
  cacheFallbackUsed: boolean;       // true when cached response was the final fallback
  idempotencyDegraded: boolean;     // true when duplicate detection degraded to at-least-once
  activeCircuitBreakers: string[];  // e.g., ["neo4j", "gemini"]
}

// OrchestratorResponse.metadata extends with degradation details when degraded=true:
// { degraded: true, ...DegradationDescriptor, modelUsed: string, cacheHit: boolean, graphContextUsed: boolean }
```
```

### processIntentStream() (Voice)

```typescript
function processIntentStream(
  sessionId: string,
  channel: "voice",
  userId: string,
  message: string
): AsyncIterable<OrchestratorChunk>;

interface OrchestratorChunk {
  text: string;
  isFinal: boolean;
  metadata: OrchestratorResponse["metadata"];
}
```

## Transport Contracts

### WhatsApp Webhook

```typescript
// Inbound (Meta → Worker)
interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messages: Array<{
          id: string;        // Idempotency key
          from: string;      // Phone number
          text: { body: string };
          timestamp: string;
        }>;
      };
    }>;
  }>;
}

// Outbound (Worker → Meta)
interface WhatsAppOutboundMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: { body: string };
}
```

### Voice Call (LiveKit + Cartesia Sonic)

```typescript
// STT Input (Cartesia Sonic)
interface STTResult {
  channel: { alternatives: Array<{ transcript: string; confidence: number }> };
  is_final: boolean;
  speech_final: boolean;
}

// TTS Output (Cartesia Sonic)
interface TTSRequest {
  transcript: string;
  voice: { mode: "id"; id: string };
  output_format: { container: "raw"; sample_rate: 24000 };
}

// Call Lifecycle
interface CallLifecycle {
  onStart(callId: string, contactId: string): void;
  onTranscript(callId: string, chunk: TranscriptChunk): void;
  onInterrupt(callId: string, partialTTSText: string): void;
  onEnd(callId: string): Promise<CallSummary>;
}
```

## Health Endpoint Contract

```typescript
// GET /health → :8280
interface HealthResponse {
  status: "ok";
}

// GET /ready → :8280
interface ReadyResponse {
  status: "healthy" | "degraded";
  failures?: string[];
  timestamp: string;
}
```

## Validation

All inputs crossing trust boundaries MUST be validated with Zod schemas before processing:

| Boundary | Schema | Scope |
|---|---|---|
| WhatsApp webhook payload | `WhatsAppWebhookSchema` | Message structure, phone format, text length |
| Voice STT result | `STTResultSchema` | Transcript text, confidence range |
| Orchestrator input | `OrchestratorInputSchema` | Session ID format, channel enum, message sanitization |
| Orchestrator output | `OrchestratorResponseSchema` | Response text, metadata shape, session data |
| All adapter return values | Per-adapter Zod schemas | Entity shapes, field types |
