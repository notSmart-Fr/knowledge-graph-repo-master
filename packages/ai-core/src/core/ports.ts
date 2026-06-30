import { z } from "zod";

// Domain Types
export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().email(),
  accountId: z.string().optional(),
  role: z.enum(["lead", "contact", "decision_maker"]),
  tags: z.array(z.string()),
  agentId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type Contact = z.infer<typeof ContactSchema>;

export const DealSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
  stage: z.string(),
  contactId: z.string(),
  accountId: z.string().optional(),
  probability: z.number().min(0).max(100),
  expectedClose: z.string().datetime().optional(),
  agentId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type Deal = z.infer<typeof DealSchema>;

export const CallSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  agentId: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]),
  transcriptJson: z.record(z.string(), z.unknown()),
  summary: z.string().optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  actionItems: z.array(z.string()),
  durationSec: z.number().optional(),
  createdAt: z.string().datetime(),
});

export type Call = z.infer<typeof CallSchema>;

export const TicketSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  subject: z.string(),
  status: z.enum(["open", "in_progress", "closed", "on_hold"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  agentId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type Ticket = z.infer<typeof TicketSchema>;

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string().optional(),
  size: z.enum(["small", "medium", "enterprise"]).optional(),
  healthScore: z.number().min(0).max(100).optional(),
  createdAt: z.string().datetime(),
});

export type Account = z.infer<typeof AccountSchema>;

export const PipelineStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  probability: z.number().min(0).max(100),
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const CRMGraphContextSchema = z.object({
  contact: ContactSchema.optional(),
  account: AccountSchema.optional(),
  deals: z.array(DealSchema).default([]),
  tickets: z.array(TicketSchema).default([]),
  calls: z.array(CallSchema).default([]),
});

export type CRMGraphContext = z.infer<typeof CRMGraphContextSchema>;

export const CachedResponseSchema = z.object({
  id: z.string(),
  response: z.record(z.string(), z.unknown()),
  intentTags: z.array(z.string()).default([]),
  model: z.string(),
  createdAt: z.string().datetime(),
});

export type CachedResponse = z.infer<typeof CachedResponseSchema>;

export const OrchestratorResponseSchema = z.object({
  text: z.string(),
  metadata: z.object({
    degraded: z.boolean().default(false),
    cacheHit: z.boolean().default(false),
    modelUsed: z.string().optional(),
  }),
});

export type OrchestratorResponse = z.infer<typeof OrchestratorResponseSchema>;

// Port Interfaces
export interface IContactStore {
  getByPhone(phone: string): Promise<Contact | null>;
  getById(id: string): Promise<Contact | null>;
  search(query: string): Promise<Contact[]>;
  create(contact: Omit<Contact, "id" | "createdAt">): Promise<Contact>;
  update(id: string, fields: Partial<Contact>): Promise<Contact>;
}

export interface IDealStore {
  getByContact(contactId: string): Promise<Deal[]>;
  getById(id: string): Promise<Deal | null>;
  update(dealId: string, fields: Partial<Deal>): Promise<Deal>;
}

export interface ICallStore {
  create(call: Omit<Call, "id" | "createdAt">): Promise<Call>;
  appendTranscript(callId: string, chunk: Record<string, unknown>): Promise<void>;
  finalize(callId: string, summary: string): Promise<Call>;
}

export interface ITicketStore {
  getByContact(contactId: string): Promise<Ticket[]>;
  create(ticket: Omit<Ticket, "id" | "createdAt">): Promise<Ticket>;
}

export interface IAccountStore {
  getById(id: string): Promise<Account | null>;
  getHealthScore(id: string): Promise<number | null>;
}

export interface IGraphRetriever {
  expandFromContact(contactId: string): Promise<CRMGraphContext>;
  expandFromDeal(dealId: string): Promise<CRMGraphContext>;
  getStaleDeals(days: number): Promise<Deal[]>;
}

export interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  /** True if the most recent embed() returned a cached/fallback value. */
  lastFallbackUsed(): boolean;
}

export interface IAgentProvider {
  generate(context: CRMGraphContext, tools?: unknown[]): Promise<OrchestratorResponse>;
  generateStream(context: CRMGraphContext, tools?: unknown[]): AsyncIterable<string>;
}

export interface ICacheStore {
  check(embedding: number[]): Promise<CachedResponse | null>;
  store(embedding: number[], response: OrchestratorResponse): Promise<void>;
}

export type DLQErrorMeta = {
  errorCode: string;
  errorMessage: string;
  attemptCount: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  nextRetryAt?: string;
};

export type DLQJobEntry = {
  id: string;
  queue: string;
  job: Record<string, unknown>;
  errorMeta: DLQErrorMeta;
  enqueuedAt: string;
};

export interface IIdempotencyStore {
  checkAndSet(key: string, ttl: number): Promise<boolean>;
  /** True if the last call degraded to a fallback (Redis → Supabase → at-least-once). */
  isDegraded(): boolean;
}

export interface IDeadLetterQueue {
  enqueue(queue: string, job: Record<string, unknown>, errorMeta: Record<string, unknown>): Promise<void>;
  listDead(queue: string, limit?: number, offset?: number): Promise<DLQJobEntry[]>;
  replay(queue: string, jobId: string): Promise<DLQJobEntry | null>;
  purge(queue: string): Promise<number>;
  /** Current number of dead jobs in a queue (used by /ready for SLA gate). */
  depth(queue: string): Promise<number>;
  /** Job handler registered via onReplay — invoked when replay() is called. */
  onReplay(handler: (job: Record<string, unknown>, queue: string) => Promise<void>): void;
}
