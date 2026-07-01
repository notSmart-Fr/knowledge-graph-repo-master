/**
 * Production orchestrator factory — wires real adapters for self-hosted deploys.
 *
 * Swap adapters here (or fork) to use OpenAI, local Postgres, etc.
 * Usage: import { buildProductionOrchestrator } from "./build-production-orchestrator.js"
 */

import { createOrchestrator, type Orchestrator } from "../packages/ai-core/src/core/orchestrator.js";
import type { IContactStore, IEmbeddingProvider } from "../packages/ai-core/src/core/ports.js";
import { SupabaseContactStore } from "../packages/ai-core/src/adapters/supabase/contact-store.js";
import { SupabaseDealStore } from "../packages/ai-core/src/adapters/supabase/deal-store.js";
import { SupabaseAccountStore } from "../packages/ai-core/src/adapters/supabase/account-store.js";
import { SupabaseTicketStore } from "../packages/ai-core/src/adapters/supabase/ticket-store.js";
import { Neo4jGraphRetriever } from "../packages/ai-core/src/adapters/neo4j/neo4j-retriever.js";
import { MastraAgentProvider } from "../packages/ai-core/src/adapters/ai/mastra-agent.js";
import { GeminiEmbeddingProvider } from "../packages/ai-core/src/adapters/ai/gemini-embedding.js";
import { CachedEmbeddingProvider } from "../packages/ai-core/src/adapters/ai/cached-embedding.js";
import { PgVectorCache } from "../packages/ai-core/src/adapters/supabase/pgvector-cache.js";
import { createIdempotencyStore } from "../packages/ai-core/src/adapters/messaging/idempotency.js";
import { getEnv } from "../packages/ai-core/src/config/env-schema.js";
import { createLogger } from "../packages/ai-core/src/core/logger.js";

const logger = createLogger("production-orchestrator");

export interface ProductionOrchestratorOptions {
  contactStore?: IContactStore;
}

function buildEmbeddingProvider(): IEmbeddingProvider {
  const env = getEnv();
  if (env.GEMINI_API_KEY) {
    return new CachedEmbeddingProvider(new GeminiEmbeddingProvider());
  }
  // ponytail: zero-vector when no Gemini — semantic cache disabled; Ollama chat still works
  return {
    embed: async () => new Array(768).fill(0),
    embedBatch: async (texts) => texts.map(() => new Array(768).fill(0)),
    lastFallbackUsed: () => true,
  };
}

export function buildProductionOrchestrator(
  options: ProductionOrchestratorOptions = {}
): Orchestrator {
  const contactStore = options.contactStore ?? new SupabaseContactStore();

  logger.info("Building production orchestrator", {
    ollama: Boolean(getEnv().LOCAL_LLM_URL),
    geminiChat: Boolean(getEnv().GEMINI_API_KEY),
    geminiEmbed: Boolean(getEnv().GEMINI_API_KEY),
  });

  return createOrchestrator({
    contactStore,
    dealStore: new SupabaseDealStore(),
    accountStore: new SupabaseAccountStore(),
    ticketStore: new SupabaseTicketStore(),
    graphRetriever: new Neo4jGraphRetriever(),
    embeddingProvider: buildEmbeddingProvider(),
    agentProvider: new MastraAgentProvider(),
    cacheStore: new PgVectorCache(),
    idempotencyStore: createIdempotencyStore(),
  });
}

async function smokeTest(): Promise<void> {
  const { loadMonorepoEnv } = await import("./load-env.js");
  loadMonorepoEnv();
  const orchestrator = buildProductionOrchestrator();
  const result = await orchestrator.processIntent({
    sessionId: "smoke-session",
    userId: "+15550000001",
    channel: "smoke",
    message: "Say hello in one short sentence.",
    timestamp: new Date().toISOString(),
  });
  logger.info("Smoke test reply", {
    modelUsed: result.response.metadata?.modelUsed,
    textLength: result.response.text.length,
    degraded: result.metadata.degraded,
  });
  console.log(result.response.text);
}

if (process.argv.includes("--smoke")) {
  smokeTest().catch((error: unknown) => {
    logger.error("Smoke test failed", { error: String(error) });
    process.exit(1);
  });
}
