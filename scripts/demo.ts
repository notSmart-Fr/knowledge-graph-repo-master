import { createOrchestrator } from "../packages/ai-core/src/core/orchestrator.js";
import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { fieldEncryption } from "../packages/ai-core/src/adapters/encryption/field-encryption.js";
import crypto from "node:crypto";

const logger = createLogger("demo");

async function runDemo() {
  logger.info("=== Running AI CRM Demo ===");

  // Test 1: Encryption roundtrip
  logger.info("\n--- Test 1: Field Encryption Roundtrip ---");
  const testId = crypto.randomUUID();
  const testPhone = "+15551234567";
  const encrypted = fieldEncryption.encryptObject({ id: testId, phone: testPhone }, testId, ["phone"], "contact");
  if (!encrypted.phone) throw new Error("Phone not encrypted");
  if (encrypted.phone === testPhone) throw new Error("Phone still in plaintext");
  const decrypted = fieldEncryption.decryptObject(encrypted, testId, ["phone"], "contact");
  if (decrypted.phone !== testPhone) throw new Error("Decryption failed");
  logger.info("✅ Encryption roundtrip passed");

  // Test 2: Orchestrator execution
  logger.info("\n--- Test 2: Orchestrator Execution ---");
  const startTime = Date.now();
  const orchestrator = createOrchestrator({
    contactStore: {
      getByPhone: async () => null,
      getById: async () => null,
      search: async () => [],
      create: async (c) => ({ ...c, id: crypto.randomUUID(), createdAt: new Date().toISOString() }),
      update: async (id, fields) => ({ id, ...fields } as any),
    },
    dealStore: {
      getByContact: async () => [],
      getById: async () => null,
      update: async () => { throw new Error("Not implemented"); },
    },
    accountStore: {
      getById: async () => null,
      getHealthScore: async () => null,
    },
    ticketStore: {
      getByContact: async () => [],
      create: async () => { throw new Error("Not implemented"); },
    },
    graphRetriever: {
      expandFromContact: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    },
    embeddingProvider: {
      embed: async () => [],
      embedBatch: async () => [],
    },
    agentProvider: {
      generate: async () => ({
        text: "I'm a CRM assistant. How can I help you today?",
        metadata: { degraded: false, cacheHit: false, modelUsed: "mock" },
      }),
      generateStream: async function* () { yield "Mock response"; },
    },
    cacheStore: {
      check: async () => null,
      store: async () => {},
    },
    idempotencyStore: {
      check: async () => null,
      store: async () => {},
    },
  });
  const result = await orchestrator.processIntent({
    sessionId: "demo-session-1",
    userId: "+15559876543",
    channel: "demo",
    message: "Hello",
    timestamp: new Date().toISOString(),
  });
  const durationMs = Date.now() - startTime;
  if (durationMs > 2000) throw new Error(`P95 latency check failed: ${durationMs}ms > 2000ms`);
  logger.info(`✅ Orchestrator execution passed (${durationMs}ms)`);
  logger.info(`Response: ${result.response.text.slice(0, 50)}...`);

  // Test 3: Degradation path
  logger.info("\n--- Test 3: Degradation Path ---");
  const orchestratorDegraded = createOrchestrator({
    contactStore: {
      getByPhone: async () => null,
      getById: async () => null,
      search: async () => [],
      create: async (c) => ({ ...c, id: crypto.randomUUID(), createdAt: new Date().toISOString() }),
      update: async (id, fields) => ({ id, ...fields } as any),
    },
    dealStore: {
      getByContact: async () => [],
      getById: async () => null,
      update: async () => { throw new Error("Not implemented"); },
    },
    accountStore: {
      getById: async () => null,
      getHealthScore: async () => null,
    },
    ticketStore: {
      getByContact: async () => [],
      create: async () => { throw new Error("Not implemented"); },
    },
    graphRetriever: {
      expandFromContact: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    },
    embeddingProvider: {
      embed: async () => [],
      embedBatch: async () => [],
    },
    agentProvider: {
      generate: async () => { throw new Error("Primary agent failed"); },
      generateStream: async function* () { yield "Mock fallback"; },
    },
    cacheStore: {
      check: async () => null,
      store: async () => {},
    },
    idempotencyStore: {
      check: async () => null,
      store: async () => {},
    },
  });
  const resultDegraded = await orchestratorDegraded.processIntent({
    sessionId: "demo-session-2",
    userId: "+15559876543",
    channel: "demo",
    message: "Hello again",
    timestamp: new Date().toISOString(),
  });
  if (!resultDegraded.metadata.degraded) throw new Error("Degraded path not triggered");
  logger.info("✅ Degradation path passed");

  logger.info("\n=== All Demo Tests Passed! ===");
}

runDemo().catch(error => {
  logger.error("Demo failed", { error: String(error) });
  process.exit(1);
});

