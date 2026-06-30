import type { IAgentProvider, CRMGraphContext, OrchestratorResponse } from "../../core/ports.js";
import { OrchestratorResponseSchema } from "../../core/ports.js";
import { env } from "../../config/env-schema.js";
import { IntegrationError } from "../../core/errors.js";
import { buildPrompt } from "./mastra-agent.js";
import { z } from "zod";

const OllamaGenerateResponseSchema = z.object({
  response: z.string().optional(),
});

const OllamaStreamChunkSchema = z.object({
  response: z.string().optional(),
  done: z.boolean().optional(),
});

const OllamaResponseOkSchema = z.object({
  ok: z.literal(true),
});

export class OllamaLocalProvider implements IAgentProvider {
  async generate(context: CRMGraphContext, tools?: unknown[]): Promise<OrchestratorResponse> {
    if (!env.LOCAL_LLM_URL) {
      throw new IntegrationError(
        "OLLAMA_NOT_CONFIGURED",
        "Local LLM URL is not configured"
      );
    }

    try {
      const data = OllamaGenerateResponseSchema.parse(
        await fetch(`${env.LOCAL_LLM_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            model: "llama3.2",
            prompt: buildPrompt(context),
            stream: false,
          }),
        }).then(async (response) => {
          if (!response.ok) {
            throw new IntegrationError(
              "OLLAMA_GENERATION_FAILED",
              `Ollama request failed: ${response.statusText}`
            );
          }
          return response.json();
        })
      );

      return OrchestratorResponseSchema.parse({
        text: data.response || "No response from local LLM",
        metadata: {
          degraded: false,
          cacheHit: false,
          modelUsed: "ollama/llama3.2",
        },
      });
    } catch (err: unknown) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError(
        "OLLAMA_GENERATION_FAILED",
        "Local LLM generation failed",
        { originalError: String(err) }
      );
    }
  }

  async *generateStream(context: CRMGraphContext, tools?: unknown[]): AsyncIterable<string> {
    if (!env.LOCAL_LLM_URL) {
      throw new IntegrationError(
        "OLLAMA_NOT_CONFIGURED",
        "Local LLM URL is not configured"
      );
    }

    const response = await fetch(`${env.LOCAL_LLM_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt: buildPrompt(context),
        stream: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new IntegrationError(
        "OLLAMA_STREAM_FAILED",
        `Ollama stream failed: ${response.statusText}`
      );
    }

    // Firewall boundary: validate the response is ok before reading the stream body
    OllamaResponseOkSchema.parse(response);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new IntegrationError("OLLAMA_STREAM_FAILED", "No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = OllamaStreamChunkSchema.parse(JSON.parse(line));
          if (chunk.response) yield chunk.response;
          if (chunk.done) break;
        } catch {
          continue;
        }
      }
    }
  }
}
