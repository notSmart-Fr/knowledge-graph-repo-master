/**
 * Mock orchestrator for tests and USE_MOCK_ORCHESTRATOR=true offline dev.
 */

import { createOrchestrator, type Orchestrator } from "../packages/ai-core/src/core/orchestrator.js";
import type { IContactStore } from "../packages/ai-core/src/core/ports.js";
import { CompositeIdempotencyStore } from "../packages/ai-core/src/adapters/messaging/idempotency.js";

function defaultMockContactStore(): IContactStore {
  return {
    getByPhone: async () => null,
    getById: async () => null,
    search: async () => [],
    create: async (c) => ({ ...c, id: "mock-contact", createdAt: new Date().toISOString() }),
    update: async (id, fields) => ({
      id,
      name: "Mock",
      phone: "+10000000000",
      email: "mock@example.com",
      role: "contact",
      tags: [],
      createdAt: new Date().toISOString(),
      ...fields,
    }),
  };
}

export function buildMockOrchestrator(contactStore?: IContactStore): Orchestrator {
  const store = contactStore ?? defaultMockContactStore();
  const idempotencyStore = new CompositeIdempotencyStore();
  return createOrchestrator({
    contactStore: store,
    dealStore: {
      getByContact: async () => [],
      getById: async () => null,
      update: async () => {
        throw new Error("Not implemented");
      },
    },
    accountStore: {
      getById: async () => null,
      getHealthScore: async () => null,
    },
    ticketStore: {
      getByContact: async () => [],
      create: async () => {
        throw new Error("Not implemented");
      },
    },
    graphRetriever: {
      expandFromContact: async () => ({ deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    },
    embeddingProvider: {
      embed: async () => [],
      embedBatch: async () => [],
      lastFallbackUsed: () => false,
    },
    agentProvider: {
      generate: async () => ({
        text: "How can I help you today?",
        metadata: { degraded: false, cacheHit: false, modelUsed: "mock" },
      }),
      generateStream: async function* () {
        yield "How can I help you today?";
      },
    },
    cacheStore: {
      check: async () => null,
      store: async () => {},
    },
    idempotencyStore,
  });
}
