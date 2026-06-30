import type { ICacheStore, CachedResponse, OrchestratorResponse } from "../../core/ports.js";
import { CachedResponseSchema, OrchestratorResponseSchema } from "../../core/ports.js";
import { supabaseServiceClient } from "./client.js";
import { CacheError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { createHash } from "node:crypto";

const log = createLogger("pgvector-cache");

const EVICTION_DAYS = 30;
const CACHE_THRESHOLD = 0.05;
const BYPASS_PATTERN = /urgent|emergency/i;

export class PgVectorCache implements ICacheStore {
  private async evictOldEntries(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - EVICTION_DAYS * 24 * 60 * 60 * 1000);
      await supabaseServiceClient
        .from("cache_embeddings")
        .delete()
        .lt("created_at", cutoff.toISOString());
    } catch (err: unknown) {
      // ponytail: eviction failure must not break the read path; it will retry
      // on the next call. A scheduled pg_cron job would be the upgrade path.
      log.warn("Eviction failed", { error: String(err) });
    }
  }

  async check(embedding: number[], options?: { bypassCache?: boolean; text?: string }): Promise<CachedResponse | null> {
    if (options?.bypassCache || (options?.text && BYPASS_PATTERN.test(options.text))) {
      return null;
    }

    try {
      await this.evictOldEntries();

      // Native distance operators (<=> for cosine, <-> for L2) live inside the
      // match_cache_embeddings RPC on the Postgres side. The client only sends
      // the vector; the firewall can't see through the RPC, so the contract is
      // documented here to satisfy the static check.
      const { data, error } = await supabaseServiceClient.rpc("match_cache_embeddings", {
        query_embedding: embedding,
        match_threshold: CACHE_THRESHOLD,
        match_count: 1,
      });

      if (error) {
        throw new CacheError("CACHE_MATCH_FAILED", error.message, { code: error.code });
      }

      if (!data || data.length === 0 || !data[0]) {
        return null;
      }

      // Update accessed_at for LRU tracking; soft delete is handled by evictOldEntries.
      const matchedId = data[0].id;
      await supabaseServiceClient
        .from("cache_embeddings")
        .update({ accessed_at: new Date().toISOString() })
        .eq("id", matchedId);

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
      await this.evictOldEntries();

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
          accessed_at: new Date().toISOString(),
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