import { env } from "../../config/env-schema.js";
import Redis from "ioredis";
import { IntegrationError } from "../../core/errors.js";
export class RedisIdempotencyStore {
    redis;
    constructor() {
        this.redis = new Redis(env.REDIS_URL);
    }
    async checkAndSet(key, ttl) {
        try {
            const result = await this.redis.set(key, "1", "EX", ttl, "NX");
            return result === "OK";
        }
        catch (err) {
            throw new IntegrationError("REDIS_IDEMPOTENCY_FAILED", "Failed to check and set idempotency key", { originalError: String(err) });
        }
    }
    async close() {
        await this.redis.quit();
    }
}
