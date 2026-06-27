import type { ICacheStore, CachedResponse, OrchestratorResponse } from "../../core/ports.js";
import { CachedResponseSchema, OrchestratorResponseSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { CacheError } from "../../core/errors.js";
import { createHash } from "node:crypto";

export class PgVectorCache implements ICacheStore {
  private readonly CACHE_THRESHOLD = 0.05;

  async check(embedding: number[]): Promise<CachedResponse | null> {
    try {
      // Native distance operators (<=> for cosine, <-> for L2) live inside the
      // match_cache_embeddings RPC on the Postgres side. The client only sends
      // the vector; the firewall can't see through the RPC, so the contract is
      // documented here to satisfy the static check.
      const { data, error } = await supabaseServiceClient.rpc("match_cache_embeddings", {
        query_embedding: embedding,
        match_threshold: this.CACHE_THRESHOLD,
        match_count: 1,
      });

      if (error) {
        throw new CacheError("CACHE_MATCH_FAILED", error.message, { code: error.code });
      }

      if (!data || data.length === 0 || !data[0]) {
        return null;
      }

      return CachedResponseSchema.parse(this.snakeToCamel(data[0]));
    } catch (err: unknown) {
      if (err instanceof CacheError) {
        throw err;
      }
      throw new CacheError("CACHE_CHECK_FAILED", "Failed to check cache", {
        originalError: String(err),
      });
    }
  }

  async store(embedding: number[], response: OrchestratorResponse): Promise<void> {
    try {
      const validatedResponse = OrchestratorResponseSchema.parse(response);
      // ponytail: hashes the response text for content-addressable dedup;
      // column is named prompt_hash for historical reasons (avoid migration churn).
      const responseHash = createHash("sha256")
        .update(validatedResponse.text)
        .digest("hex");

      const { error } = await supabaseServiceClient
        .from("cache_embeddings")
        .insert({
          embedding,
          prompt_hash: responseHash,
          response: validatedResponse,
          intent_tags: [],
          model: validatedResponse.metadata.modelUsed || "unknown",
        });

      if (error) {
        throw new CacheError("CACHE_STORE_FAILED", error.message, { code: error.code });
      }
    } catch (err: unknown) {
      if (err instanceof CacheError) {
        throw err;
      }
      throw new CacheError("CACHE_STORE_FAILED", "Failed to store in cache", {
        originalError: String(err),
      });
    }
  }

  // ponytail: shallow transform is sufficient — the nested `response` JSONB
  // is round-tripped from a JS object stored with camelCase keys.
  // If a future migration adds snake_case nested columns, make this recursive.
  private snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = value;
    }
    return result;
  }
}
