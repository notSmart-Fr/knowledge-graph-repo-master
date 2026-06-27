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
export class MastraAgentProvider {
    fallback;
    constructor() {
        if (env.DEEPSEEK_API_KEY) {
            this.fallback = new DeepSeekFallbackProvider();
        }
    }
    async generate(context, tools) {
        try {
            // In a real implementation, this would use Mastra with Gemini
            // For now, implement a simple fallback mechanism
            const response = await this.generateWithGemini(context, tools);
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
            const response = await this.generate(context, tools);
            yield response.text;
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
    async generateWithGemini(context, tools) {
        const prompt = this.buildPrompt(context);
        const data = GeminiGenerateContentResponseSchema.parse(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
            }),
        }).then(async (response) => {
            if (!response.ok) {
                throw new IntegrationError("GEMINI_GENERATION_FAILED", `Failed to generate content: ${response.statusText}`);
            }
            return response.json();
        }));
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
    buildPrompt(context) {
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
}
