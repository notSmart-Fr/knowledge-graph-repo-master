/**
 * Register adapter health checks for self-hosted /ready probes.
 */

import { registerHealthCheck } from "../packages/ai-core/src/health/health-checks.js";
import { supabaseServiceClient } from "../packages/ai-core/src/adapters/supabase/client.js";
import { neo4jDriver } from "../packages/ai-core/src/adapters/neo4j/client.js";
import { getEnv } from "../packages/ai-core/src/config/env-schema.js";

export function registerProductionHealthChecks(): void {
  registerHealthCheck(
    "supabase",
    async () => {
      const start = Date.now();
      const { error } = await supabaseServiceClient.from("accounts").select("id").limit(1);
      if (error) {
        return { healthy: false, latencyMs: Date.now() - start, error: error.message };
      }
      return { healthy: true, latencyMs: Date.now() - start };
    },
    true
  );

  registerHealthCheck(
    "neo4j",
    async () => {
      const start = Date.now();
      const session = neo4jDriver.session();
      try {
        await session.run("RETURN 1 AS ok");
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { healthy: false, latencyMs: Date.now() - start, error: message };
      } finally {
        await session.close();
      }
    },
    true
  );

  registerHealthCheck(
    "redis",
    async () => {
      const start = Date.now();
      const { default: Redis } = await import("ioredis");
      const redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
      try {
        const pong = await redis.ping();
        return {
          healthy: pong === "PONG",
          latencyMs: Date.now() - start,
          error: pong === "PONG" ? undefined : "Unexpected PING response",
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { healthy: false, latencyMs: Date.now() - start, error: message };
      } finally {
        redis.disconnect();
      }
    },
    true
  );

  registerHealthCheck(
    "ollama",
    async () => {
      const start = Date.now();
      const base = getEnv().LOCAL_LLM_URL;
      if (!base) {
        return { healthy: false, latencyMs: 0, error: "LOCAL_LLM_URL not set" };
      }
      try {
        const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
        return {
          healthy: response.ok,
          latencyMs: Date.now() - start,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { healthy: false, latencyMs: Date.now() - start, error: message };
      }
    },
    false
  );
}
