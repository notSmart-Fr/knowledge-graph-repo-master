import type { IEmbeddingProvider } from "../../core/ports.js";
import { IntegrationError } from "../../core/errors.js";
import { env } from "../../config/env-schema.js";
import { z } from "zod";

const GeminiEmbeddingResponseSchema = z.object({
  embedding: z.object({
    values: z.array(z.number()),
  }),
});

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  private readonly API_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

  async embed(text: string): Promise<number[]> {
    try {
      const data = GeminiEmbeddingResponseSchema.parse(
        await fetch(
          `${this.API_URL}?key=${env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
          }
        ).then(async (response) => {
          if (!response.ok) {
            throw new IntegrationError(
              "GEMINI_EMBEDDING_FAILED",
              `Failed to get embedding: ${response.statusText}`
            );
          }
          return response.json();
        })
      );
      return data.embedding.values;
    } catch (err: unknown) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError(
        "GEMINI_EMBEDDING_FAILED",
        "Failed to get embedding",
        { originalError: String(err) }
      );
    }
  }

  //Add type annotations to the map function for better type safety
  async embedBatch(texts: string[]): Promise<number[][]> {
    const promises = texts.map((text) => this.embed(text));
    return Promise.all(promises);
  }
}
