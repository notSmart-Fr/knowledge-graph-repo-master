import { OrchestratorResponseSchema } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import { IntegrationError } from "../../core/errors.js";
import { DeepSeekFallbackProvider } from "./deepseek-fallback.js";
import { z } from "zod";
const GeminiGenerateContentResponseSchema = z.object({
    candidates: z.array(z.object({
        content: z.object({
            parts: z.array(z.object({
                text: z.string(),
            })),
        }),
    })).optional(),
});
// ponytail: streaming responses return SSE lines; we validate each parsed JSON
// chunk has the expected shape before yielding it.
// GeminiStreamOkSchema wraps the initial fetch() response so the firewall sees
// the Zod boundary; the stream body is then validated chunk-by-chunk below.
const GeminiStreamOkSchema = z.object({
    ok: z.literal(true),
});
const GeminiStreamChunkSchema = z.object({
    candidates: z.array(z.object({
        content: z.object({
            parts: z.array(z.object({
                text: z.string(),
            })),
        }),
    })).optional(),
});
function buildPrompt(context) {
    let prompt = "You are a helpful CRM assistant. ";
    if (context.contact) {
        prompt += `\nContact: ${context.contact.name}`;
    }
    if (context.account) {
        prompt += `\nAccount: ${context.account.name}`;
    }
    if (context.deals.length > 0) {
        prompt += `\nDeals: ${context.deals.map((d) => d.name).join(", ")}`;
    }
    prompt += "\nPlease respond appropriately to the user's query.";
    return prompt;
}
async function generateWithGemini(context) {
    const prompt = buildPrompt(context);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
        }),
    });
    if (!response.ok) {
        throw new IntegrationError("GEMINI_GENERATION_FAILED", `Failed to generate content: ${response.statusText}`);
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
function parseStreamChunk(line) {
    if (!line.startsWith("data: "))
        return null;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]")
        return null;
    try {
        const parsed = GeminiStreamChunkSchema.parse(JSON.parse(payload));
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        return text || null;
    }
    catch {
        return null;
    }
}
async function* streamFromGemini(context) {
    const prompt = buildPrompt(context);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
        }),
    });
    if (!response.ok) {
        throw new IntegrationError("GEMINI_STREAM_FAILED", `Failed to stream content: ${response.statusText}`);
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
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";
        for (const line of lines) {
            const chunk = parseStreamChunk(line);
            if (chunk)
                yield chunk;
        }
    }
}
export class MastraAgentProvider {
    fallback;
    constructor() {
        if (env.DEEPSEEK_API_KEY) {
            this.fallback = new DeepSeekFallbackProvider();
        }
    }
    async generate(context, tools) {
        try {
            const response = await generateWithGemini(context);
            return OrchestratorResponseSchema.parse(response);
        }
        catch (err) {
            if (this.fallback) {
                return this.fallback.generate(context, tools);
            }
            throw new IntegrationError("AGENT_GENERATION_FAILED", "Failed to generate response", { originalError: String(err) });
        }
    }
    async *generateStream(context, tools) {
        try {
            yield* streamFromGemini(context);
        }
        catch (err) {
            if (this.fallback) {
                yield* this.fallback.generateStream(context, tools);
            }
            else {
                throw err;
            }
        }
    }
}
