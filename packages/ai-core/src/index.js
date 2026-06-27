// packages/ai-core/src/index.ts
// Barrel export — populated as modules are built.
export * from "./core/ports.js";
export * from "./core/errors.js";
export * from "./core/logger.js";
export * from "./core/sanitize.js";
export * from "./config/env-schema.js";
export * from "./config/otel-bootstrap.js";
// Supabase Adapters
export * from "./adapters/supabase/client.js";
export * from "./adapters/supabase/contact-store.js";
export * from "./adapters/supabase/deal-store.js";
export * from "./adapters/supabase/call-store.js";
export * from "./adapters/supabase/ticket-store.js";
export * from "./adapters/supabase/account-store.js";
export * from "./adapters/supabase/pgvector-cache.js";
// Neo4j Adapters
export * from "./adapters/neo4j/client.js";
export * from "./adapters/neo4j/neo4j-retriever.js";
export * from "./adapters/neo4j/noop-retriever.js";
// AI Adapters
export * from "./adapters/ai/gemini-embedding.js";
export * from "./adapters/ai/cached-embedding.js";
export * from "./adapters/ai/mastra-agent.js";
export * from "./adapters/ai/deepseek-fallback.js";
export * from "./adapters/ai/ollama-local.js";
// Messaging Adapters
export * from "./adapters/messaging/redis-idempotency.js";
export * from "./adapters/messaging/supabase-idempotency.js";
export * from "./adapters/messaging/bullmq-dlq.js";
