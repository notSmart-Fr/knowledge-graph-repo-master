import type { IEmbeddingProvider } from "../../core/ports.js";
import { IntegrationError } from "../../core/errors.js";
import { env } from "../../config/env-schema.js";
import { z } from "zod";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("ollama-embedding");

const OllamaEmbeddingResponseSchema = z.object({
  embedding: z.array(z.number()),
});

const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_DIM = 768;

/** Embedding provider backed by a local Ollama instance. Zero API cost. */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  private fallbackFlag = false;
  private readonly model: string;

  constructor(model?: string) {
    this.model = model ?? process.env.OLLAMA_EMBED_MODEL ?? DEFAULT_MODEL;
  }

  async embed(text: string): Promise<number[]> {
    this.fallbackFlag = false;
    if (!env.LOCAL_LLM_URL) {
      this.fallbackFlag = true;
      return new Array(DEFAULT_DIM).fill(0);
    }

    try {
      const response = await fetch(`${env.LOCAL_LLM_URL}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new IntegrationError(
          "OLLAMA_EMBED_FAILED",
          `Ollama embedding failed: ${response.statusText}`
        );
      }

      const data = OllamaEmbeddingResponseSchema.parse(await response.json());
      return data.embedding;
    } catch (err: unknown) {
      logger.warn("Ollama embedding failed, returning zero vector", {
        error: String(err),
      });
      this.fallbackFlag = true;
      return new Array(DEFAULT_DIM).fill(0);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  lastFallbackUsed(): boolean {
    return this.fallbackFlag;
  }
}
