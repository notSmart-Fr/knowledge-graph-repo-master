import type { IIdempotencyStore } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import Redis from "ioredis";
import { IntegrationError } from "../../core/errors.js";

export class RedisIdempotencyStore implements IIdempotencyStore {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(env.REDIS_URL);
  }

  async checkAndSet(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.set(key, "1", "EX", ttl, "NX");
      return result === "OK";
    } catch (err: unknown) {
      throw new IntegrationError(
        "REDIS_IDEMPOTENCY_FAILED",
        "Failed to check and set idempotency key",
        { originalError: String(err) }
      );
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  isDegraded(): boolean {
    // Redis is the primary; this adapter itself never degrades — the composite decides.
    return false;
  }
}
