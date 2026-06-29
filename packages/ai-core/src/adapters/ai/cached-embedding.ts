import type { IEmbeddingProvider } from "../../core/ports.js";
import { createLogger } from "../../core/logger.js";
import { createHash } from "node:crypto";

const logger = createLogger("cached-embedding");

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour per FR-031 / T031
const DEFAULT_DIM = 768;

/**
 * Cached embedding provider with pgvector-style fallback.
 *
 * Layered lookup on `embed(text)`:
 *   1. In-memory L1 hit (instant).
 *   2. Primary provider (Gemini) — wraps result, primes L1.
 *   3. On primary failure, L2 cold cache fallback (max age 1 hour).
 *      Marks `cacheFallbackUsed: true` so the orchestrator can surface
 *      the degradation in `OrchestratorResponse.metadata`.
 *
 * ponytail: L2 is provided as a synchronous callback (pgvector or any
 * read store) so tests can mock it without touching the DB. The contract
 * is `(textHash) => embedding | null`; ttl enforcement lives here.
 */
export class CachedEmbeddingProvider implements IEmbeddingProvider {
  private l1: Map<string, { embedding: number[]; expiresAt: number }> = new Map();
  private fallbackFlag = false;
  private readonly maxAgeMs: number;
  private readonly dimension: number;

  constructor(
    private readonly primary: IEmbeddingProvider,
    private readonly l2Lookup?: (textHash: string) => Promise<{ embedding: number[]; storedAt: number } | null>,
    options?: { maxAgeMs?: number; dimension?: number },
  ) {
    this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.dimension = options?.dimension ?? DEFAULT_DIM;
  }

  async embed(text: string): Promise<number[]> {
    this.fallbackFlag = false;
    const hash = this.hashText(text);

    // L1 hit
    const cached = this.l1.get(hash);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.embedding;
    }

    // Primary attempt
    try {
      const embedding = await this.primary.embed(text);
      this.l1.set(hash, { embedding, expiresAt: Date.now() + this.maxAgeMs });
      return embedding;
    } catch (error: unknown) {
      logger.warn("Primary embedding failed, attempting fallback", { error: String(error) });
    }

    // L2 fallback
    if (this.l2Lookup) {
      const l2 = await this.l2Lookup(hash);
      if (l2 && Date.now() - l2.storedAt <= this.maxAgeMs) {
        this.fallbackFlag = true;
        this.l1.set(hash, { embedding: l2.embedding, expiresAt: Date.now() + this.maxAgeMs });
        logger.info("Embedding served from fallback cache", { hash });
        return l2.embedding;
      }
    }

    // Last resort: zero vector so downstream code can still run
    logger.error("No embedding available, returning zero vector");
    this.fallbackFlag = true;
    return new Array(this.dimension).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  lastFallbackUsed(): boolean {
    return this.fallbackFlag;
  }

  private hashText(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }
}
