import { OrchestratorResponseSchema } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import { IntegrationError } from "../../core/errors.js";
import { z } from "zod";
const OllamaGenerateResponseSchema = z.object({
    response: z.string().optional(),
});
export class OllamaLocalProvider {
    async generate(context, tools) {
        if (!env.LOCAL_LLM_URL) {
            throw new IntegrationError("OLLAMA_NOT_CONFIGURED", "Local LLM URL is not configured");
        }
        try {
            const data = OllamaGenerateResponseSchema.parse(await fetch(`${env.LOCAL_LLM_URL}/api/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "llama3.2",
                    prompt: "You are a helpful CRM assistant. Please respond.",
                    stream: false,
                }),
            }).then(async (response) => {
                if (!response.ok) {
                    throw new IntegrationError("OLLAMA_GENERATION_FAILED", `Ollama request failed: ${response.statusText}`);
                }
                return response.json();
            }));
            return OrchestratorResponseSchema.parse({
                text: data.response || "No response from local LLM",
                metadata: {
                    degraded: true,
                    cacheHit: false,
                    modelUsed: "ollama/llama3.2",
                },
            });
        }
        catch (err) {
            if (err instanceof IntegrationError)
                throw err;
            throw new IntegrationError("OLLAMA_GENERATION_FAILED", "Local LLM generation failed", { originalError: String(err) });
        }
    }
    async *generateStream(context, tools) {
        const response = await this.generate(context, tools);
        yield response.text;
    }
}
