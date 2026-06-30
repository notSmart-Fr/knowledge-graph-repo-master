import type { IAgentProvider, CRMGraphContext, OrchestratorResponse } from "../../core/ports.js";
import { OrchestratorResponseSchema } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import { IntegrationError } from "../../core/errors.js";
import { z } from "zod";

const DeepSeekChatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
      }),
    })
  ),
});

export class DeepSeekFallbackProvider implements IAgentProvider {
  async generate(context: CRMGraphContext, tools?: unknown[]): Promise<OrchestratorResponse> {
    try {
      const prompt = this.buildPrompt(context);
      const data = DeepSeekChatCompletionSchema.parse(
        await fetch(env.DEEPSEEK_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
          }),
        }).then(async (response) => {
          if (!response.ok) {
            throw new IntegrationError(
              "DEEPSEEK_FALLBACK_FAILED",
              `DeepSeek request failed: ${response.statusText}`
            );
          }
          return response.json();
        })
      );
      const text = data.choices?.[0]?.message?.content || "No response";

      return OrchestratorResponseSchema.parse({
        text,
        metadata: {
          degraded: true,
          cacheHit: false,
          modelUsed: "deepseek-chat",
        },
      });
    } catch (err: unknown) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError(
        "DEEPSEEK_FALLBACK_FAILED",
        "DeepSeek fallback failed",
        { originalError: String(err) }
      );
    }
  }

  async *generateStream(context: CRMGraphContext, tools?: unknown[]): AsyncIterable<string> {
    const response = await this.generate(context, tools);
    yield response.text;
  }

  private buildPrompt(context: CRMGraphContext): string {
    return "You are a helpful CRM assistant. Please respond to the user's query.";
  }
}
