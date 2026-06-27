import { OrchestratorResponseSchema } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import { IntegrationError } from "../../core/errors.js";
import { z } from "zod";
const DeepSeekChatCompletionSchema = z.object({
    choices: z.array(z.object({
        message: z.object({
            content: z.string().nullable(),
        }),
    })),
});
export class DeepSeekFallbackProvider {
    async generate(context, tools) {
        try {
            const prompt = this.buildPrompt(context);
            const data = DeepSeekChatCompletionSchema.parse(await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: prompt }],
                }),
            }).then(async (response) => {
                if (!response.ok) {
                    throw new IntegrationError("DEEPSEEK_FALLBACK_FAILED", `DeepSeek request failed: ${response.statusText}`);
                }
                return response.json();
            }));
            const text = data.choices?.[0]?.message?.content || "No response";
            return OrchestratorResponseSchema.parse({
                text,
                metadata: {
                    degraded: true,
                    cacheHit: false,
                    modelUsed: "deepseek-chat",
                },
            });
        }
        catch (err) {
            if (err instanceof IntegrationError)
                throw err;
            throw new IntegrationError("DEEPSEEK_FALLBACK_FAILED", "DeepSeek fallback failed", { originalError: String(err) });
        }
    }
    async *generateStream(context, tools) {
        const response = await this.generate(context, tools);
        yield response.text;
    }
    buildPrompt(context) {
        return "You are a helpful CRM assistant. Please respond to the user's query.";
    }
}
