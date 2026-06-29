/**
 * Streaming Orchestrator Tests
 *
 * Tests for T021 - processIntentStream()
 */

import { describe, test, expect, beforeEach } from "vitest";
import { Orchestrator, OrchestratorConfig } from "../orchestrator.js";
import type {
  IContactStore,
  IGraphRetriever,
  IAgentProvider,
  ICacheStore,
  IIdempotencyStore,
  CRMGraphContext,
  OrchestratorResponse,
} from "../ports.js";
import { getCircuitBreaker } from "../circuit-breaker.js";

function createStreamingMocks() {
  const calls = { checkAndSet: 0, check: 0, getByPhone: 0, expand: 0, generateStream: 0 };

  const idempotencyStore: IIdempotencyStore = {
    checkAndSet: async () => { calls.checkAndSet++; return false; },
  } as unknown as IIdempotencyStore;

  const cacheStore: ICacheStore = {
    check: async () => { calls.check++; return null; },
    store: async () => {},
  } as unknown as ICacheStore;

  const contactStore: IContactStore = {
    getByPhone: async () => { calls.getByPhone++; return null; },
    getById: async () => null,
    search: async () => [],
  } as unknown as IContactStore;

  const graphRetriever: IGraphRetriever = {
    expandFromContact: async () => { calls.expand++; return { contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }; },
    expandFromDeal: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
    getStaleDeals: async () => [],
  } as unknown as IGraphRetriever;

  const agentProvider: IAgentProvider = {
    generate: async (): Promise<OrchestratorResponse> => ({
      text: "response",
      metadata: { degraded: false, cacheHit: false },
    }),
    generateStream: async function* () {
      calls.generateStream++;
      yield "Hello ";
      yield "world";
    },
  } as unknown as IAgentProvider;

  const embeddingProvider = {
    embed: async () => new Array(768).fill(0),
    embedBatch: async () => [new Array(768).fill(0)],
  } as unknown as { embed: (text: string) => Promise<number[]>; embedBatch: (texts: string[]) => Promise<number[][]> };

  return { calls, idempotencyStore, cacheStore, contactStore, graphRetriever, agentProvider, embeddingProvider };
}

describe("processIntentStream", () => {
  beforeEach(() => {
    getCircuitBreaker("supabase");
    getCircuitBreaker("neo4j");
    getCircuitBreaker("gemini");
  });

  test("yields streaming chunks", async () => {
    const mocks = createStreamingMocks();
    const config: OrchestratorConfig = {
      ...mocks,
      contactStore: mocks.contactStore,
      graphRetriever: mocks.graphRetriever,
      agentProvider: mocks.agentProvider,
      cacheStore: mocks.cacheStore,
      idempotencyStore: mocks.idempotencyStore,
      dealStore: {
        getByContact: async () => [],
        getById: async () => null,
        update: async (id: string) => ({ id }),
      } as unknown as IDealStoreDep,
      accountStore: {
        getById: async () => null,
        getHealthScore: async () => null,
      } as unknown as IAccountStoreDep,
      ticketStore: {
        getByContact: async () => [],
        create: async () => ({}),
      } as unknown as ITicketStoreDep,
    } as unknown as OrchestratorConfig;
    const orchestrator = new Orchestrator(config);

    const chunks: string[] = [];
    let done = false;
    for await (const chunk of orchestrator.processIntentStream({
      sessionId: "stream-test-1",
      userId: "+1234567890",
      channel: "voice",
      message: "Hello",
      timestamp: "2024-01-01T00:00:00Z",
    })) {
      chunks.push(chunk.text);
      if (chunk.done) {
        done = true;
        break;
      }
    }

    expect(chunks).toContain("Hello");
    expect(chunks).toContain("world");
    expect(done).toBe(true);
  });

  test("handles cache hit gracefully", async () => {
    const mocks = createStreamingMocks();
    const cachedResponse: OrchestratorResponse = {
      text: "Cached response",
      metadata: { degraded: false, cacheHit: true },
    };

    const cacheStoreWithHit: ICacheStore = {
      check: async () => ({
        id: "test",
        response: cachedResponse as unknown as Record<string, unknown>,
        intentTags: [],
        model: "test",
        createdAt: new Date().toISOString(),
      }),
      store: async () => {},
    } as unknown as ICacheStore;

    const config = {
      ...mocks,
      cacheStore: cacheStoreWithHit,
    } as unknown as OrchestratorConfig;
    const orchestrator = new Orchestrator(config);

    const chunks: string[] = [];
    for await (const chunk of orchestrator.processIntentStream({
      sessionId: "stream-test-2",
      userId: "+1234567890",
      channel: "voice",
      message: "Hello",
      timestamp: "2024-01-01T00:00:00Z",
    })) {
      chunks.push(chunk.text);
      if (chunk.done) break;
    }

    expect(chunks).toContain("Cached response");
  });

  test("returns fallback on error", async () => {
    const mocks = createStreamingMocks();
    const failingAgent: IAgentProvider = {
      generate: async () => ({ text: "x", metadata: {} }),
      generateStream: async function* () {
        throw new Error("Stream error");
      },
    } as unknown as IAgentProvider;

    const config = {
      ...mocks,
      agentProvider: failingAgent,
    } as unknown as OrchestratorConfig;
    const orchestrator = new Orchestrator(config);

    const chunks: string[] = [];
    for await (const chunk of orchestrator.processIntentStream({
      sessionId: "stream-test-3",
      userId: "+1234567890",
      channel: "voice",
      message: "Hello",
      timestamp: "2024-01-01T00:00:00Z",
    })) {
      chunks.push(chunk.text);
      if (chunk.done) break;
    }

    const fullText = chunks.join("");
    expect(fullText).toContain("trouble");
  });
});

// Type stubs
type IDealStoreDep = { getByContact: (...args: unknown[]) => Promise<unknown[]>; getById: (...args: unknown[]) => Promise<unknown>; update: (...args: unknown[]) => Promise<unknown> };
type IAccountStoreDep = { getById: (...args: unknown[]) => Promise<unknown>; getHealthScore: (...args: unknown[]) => Promise<unknown> };
type ITicketStoreDep = { getByContact: (...args: unknown[]) => Promise<unknown[]>; create: (...args: unknown[]) => Promise<unknown> };
