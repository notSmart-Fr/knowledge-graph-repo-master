import { IntegrationError } from "../../core/errors.js";
import { env } from "../../config/env-schema.js";
import { z } from "zod";
const GeminiEmbeddingResponseSchema = z.object({
    embedding: z.object({
        values: z.array(z.number()),
    }),
});
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
export class GeminiEmbeddingProvider {
    API_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
    async embed(text) {
        try {
            const values = await this.embedWithRetry(text);
            return values;
        }
        catch (err) {
            if (err instanceof IntegrationError)
                throw err;
            throw new IntegrationError("GEMINI_EMBEDDING_FAILED", "Failed to get embedding", { originalError: String(err) });
        }
    }
    async embedWithRetry(text, attempt = 0) {
        const response = await fetch(`${this.API_URL}?key=${env.GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
        });
        if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
            // ponytail: exponential backoff with jitter; ceiling at ~4s total across 3 retries
            const baseMs = 200 * Math.pow(2, attempt);
            const jitter = Math.random() * baseMs;
            await new Promise((r) => setTimeout(r, baseMs + jitter));
            return this.embedWithRetry(text, attempt + 1);
        }
        if (!response.ok) {
            throw new IntegrationError("GEMINI_EMBEDDING_FAILED", `Failed to get embedding: ${response.statusText} (${response.status})`);
        }
        const data = GeminiEmbeddingResponseSchema.parse(await response.json());
        return data.embedding.values;
    }
    async embedBatch(texts) {
        const promises = texts.map((text) => this.embed(text));
        return Promise.all(promises);
    }
}
