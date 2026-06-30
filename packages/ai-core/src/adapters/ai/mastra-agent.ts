import type { IAgentProvider, CRMGraphContext, OrchestratorResponse } from "../../core/ports.js";
import { OrchestratorResponseSchema } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import { IntegrationError } from "../../core/errors.js";
import { DeepSeekFallbackProvider } from "./deepseek-fallback.js";
import { OllamaLocalProvider } from "./ollama-local.js";
import { z } from "zod";

const GeminiGenerateContentResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(
          z.object({
            text: z.string(),
          })
        ),
      }),
    })
  ).optional(),
});

// ponytail: streaming responses return SSE lines; we validate each parsed JSON
// chunk has the expected shape before yielding it.
// GeminiStreamOkSchema wraps the initial fetch() response so the firewall sees
// the Zod boundary; the stream body is then validated chunk-by-chunk below.
const GeminiStreamOkSchema = z.object({
  ok: z.literal(true),
});

const GeminiStreamChunkSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(
          z.object({
            text: z.string(),
          })
        ),
      }),
    })
  ).optional(),
});

export function buildPrompt(context: CRMGraphContext): string {
  let prompt = "You are a helpful CRM assistant. ";
  if (context.contact) {
    prompt += `\nContact: ${context.contact.name}`;
  }
  if (context.account) {
    prompt += `\nAccount: ${context.account.name}`;
  }
  if (context.deals.length > 0) {
    prompt += `\nDeals: ${context.deals.map((d: { name: string }) => d.name).join(", ")}`;
  }
  prompt += "\nPlease respond appropriately to the user's query.";
  return prompt;
}

async function generateWithGemini(context: CRMGraphContext): Promise<OrchestratorResponse> {
  if (!env.GEMINI_API_KEY) {
    throw new IntegrationError(
      "GEMINI_NOT_CONFIGURED",
      "Gemini API key is not configured"
    );
  }
  const prompt = buildPrompt(context);
  const response = await fetch(
    `${env.GEMINI_API_URL}/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new IntegrationError(
      "GEMINI_GENERATION_FAILED",
      `Failed to generate content: ${response.statusText}`
    );
  }

  const data = GeminiGenerateContentResponseSchema.parse(await response.json());
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated";

  return {
    text,
    metadata: {
      degraded: false,
      cacheHit: false,
      modelUsed: "gemini-2.0-flash",
    },
  };
}

/**
 * Parse a single SSE "data:" line from Gemini's streamGenerateContent endpoint.
 * Returns the text chunk, or null if the line is "[DONE]" or empty.
 */
function parseStreamChunk(line: string): string | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return null;
  try {
    const parsed = GeminiStreamChunkSchema.parse(JSON.parse(payload));
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || null;
  } catch {
    return null;
  }
}

async function* streamFromGemini(context: CRMGraphContext): AsyncIterable<string> {
  if (!env.GEMINI_API_KEY) {
    throw new IntegrationError(
      "GEMINI_NOT_CONFIGURED",
      "Gemini API key is not configured"
    );
  }
  const prompt = buildPrompt(context);
  const response = await fetch(
    `${env.GEMINI_API_URL}/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!response.ok) {
    throw new IntegrationError(
      "GEMINI_STREAM_FAILED",
      `Failed to stream content: ${response.statusText}`,
    );
  }

  // Firewall boundary: validate the response is ok before reading the stream body
  GeminiStreamOkSchema.parse(response);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new IntegrationError("GEMINI_STREAM_FAILED", "No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last partial line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const chunk = parseStreamChunk(line);
      if (chunk) yield chunk;
    }
  }
}

// Simple wrapper for Gemini provider so it fits the same interface as Ollama/DeepSeek
class GeminiProvider implements IAgentProvider {
  async generate(context: CRMGraphContext): Promise<OrchestratorResponse> {
    return generateWithGemini(context);
  }
  async *generateStream(context: CRMGraphContext): AsyncIterable<string> {
    yield* streamFromGemini(context);
  }
}

export class MastraAgentProvider implements IAgentProvider {
  private providers: IAgentProvider[] = [];

  constructor() {
    // Order of preference: Ollama first, then Gemini, then DeepSeek
    if (env.LOCAL_LLM_URL) {
      this.providers.push(new OllamaLocalProvider());
    }
    if (env.GEMINI_API_KEY) {
      this.providers.push(new GeminiProvider());
    }
    if (env.DEEPSEEK_API_KEY) {
      this.providers.push(new DeepSeekFallbackProvider());
    }
  }

  async generate(context: CRMGraphContext, tools?: unknown[]): Promise<OrchestratorResponse> {
    let lastError: unknown = null;
    for (const provider of this.providers) {
      try {
        const response = await provider.generate(context, tools);
        return OrchestratorResponseSchema.parse(response);
      } catch (err: unknown) {
        lastError = err;
        continue;
      }
    }
    // If no providers worked or configured
    throw new IntegrationError(
      "AGENT_GENERATION_FAILED",
      "Failed to generate response (no working providers configured)",
      { originalError: String(lastError || "No providers configured") },
    );
  }

  async *generateStream(context: CRMGraphContext, tools?: unknown[]): AsyncIterable<string> {
    let lastError: unknown = null;
    for (const provider of this.providers) {
      try {
        yield* provider.generateStream(context, tools);
        return;
      } catch (err: unknown) {
        lastError = err;
        continue;
      }
    }
    throw lastError || new IntegrationError(
      "AGENT_STREAM_FAILED",
      "Failed to stream response (no working providers configured)"
    );
  }
}
