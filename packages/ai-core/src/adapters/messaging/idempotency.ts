import type { IIdempotencyStore } from "../../core/ports.js";
import { RedisIdempotencyStore } from "./redis-idempotency.js";
import { SupabaseIdempotencyStore } from "./supabase-idempotency.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("idempotency");

/**
 * Composite idempotency store with fallback chain:
 * Redis (primary) → Supabase (fallback) → at-least-once processing
 *
 * This ensures idempotency even when Redis is unavailable.
 */
export class CompositeIdempotencyStore implements IIdempotencyStore {
  private redisStore: RedisIdempotencyStore;
  private supabaseStore: SupabaseIdempotencyStore;
  private degraded: boolean = false;

  constructor() {
    this.redisStore = new RedisIdempotencyStore();
    this.supabaseStore = new SupabaseIdempotencyStore();
  }

  async checkAndSet(key: string, ttl: number): Promise<boolean> {
    // Try Redis first
    try {
      const result = await this.redisStore.checkAndSet(key, ttl);
      if (result) {
        logger.debug("Idempotency check: Redis hit", { key });
        return true;
      }
      logger.debug("Idempotency check: Redis key exists", { key });
      return false;
    } catch (error: unknown) {
      logger.warn("Redis idempotency check failed, falling back to Supabase", {
        error: String(error),
        key,
      });
      this.degraded = true;
    }

    // Fallback to Supabase
    try {
      const result = await this.supabaseStore.checkAndSet(key, ttl);
      if (result) {
        logger.debug("Idempotency check: Supabase hit", { key });
        return true;
      }
      logger.debug("Idempotency check: Supabase key exists", { key });
      return false;
    } catch (error: unknown) {
      logger.error("Both Redis and Supabase idempotency checks failed", {
        error: String(error),
        key,
      });
      // At-least-once: process anyway if both fail
      // This could result in duplicate processing, but prevents dropped requests
      logger.warn("Idempotency degraded: processing request anyway (at-least-once)", { key });
      return false;
    }
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  async close(): Promise<void> {
    await this.redisStore.close();
  }
}

// Factory function
export function createIdempotencyStore(): CompositeIdempotencyStore {
  return new CompositeIdempotencyStore();
}
