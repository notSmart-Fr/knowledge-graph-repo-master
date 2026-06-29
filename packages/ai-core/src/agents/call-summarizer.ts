/**
 * Call Summarizer Agent
 *
 * Takes a full call transcript and produces a structured summary:
 * - summary: 2-3 sentence call summary
 * - action_items: list of follow-up tasks
 * - sentiment: positive/neutral/negative
 * - key_topics: list of main topics discussed
 *
 * Usage: bun run scripts/voice-agent.ts
 */

import { z } from "zod";
import { MastraAgentProvider } from "../adapters/ai/mastra-agent.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("call-summarizer");

// Output schema
export const CallSummarySchema = z.object({
  summary: z.string().min(10).max(500),
  action_items: z.array(z.string()).max(10),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  key_topics: z.array(z.string()).max(10),
  customer_satisfaction: z.number().min(0).max(10).optional(),
  next_steps: z.string().optional(),
});

export type CallSummary = z.infer<typeof CallSummarySchema>;

export interface TranscriptSegment {
  speaker: "customer" | "agent";
  text: string;
  timestamp?: string;
}

export interface CallSummarizerInput {
  callId: string;
  contactId: string;
  transcript: TranscriptSegment[];
  callDuration?: number;
}

export class CallSummarizerAgent {
  private baseAgent: MastraAgentProvider;

  constructor() {
    this.baseAgent = new MastraAgentProvider();
  }

  async summarize(input: CallSummarizerInput): Promise<CallSummary> {
    const startTime = Date.now();

    logger.info("Summarizing call", {
      callId: input.callId,
      transcriptLength: input.transcript.length,
    });

    try {
      // Create a minimal CRMGraphContext for the agent
      const minimalContext: import("../core/ports.js").CRMGraphContext = {
        contact: { id: input.contactId, name: "", phone: "", email: "", role: "contact" as const, tags: [], createdAt: "" },
        account: undefined,
        deals: [],
        tickets: [],
        calls: [],
      };

      const response = await this.baseAgent.generate(minimalContext);

      // Parse the generated text as JSON
      const parsed = JSON.parse(response.text);
      const summary = CallSummarySchema.parse(parsed);

      logger.info("Call summarized", {
        callId: input.callId,
        actionItems: summary.action_items.length,
        topics: summary.key_topics.length,
        durationMs: Date.now() - startTime,
      });

      return summary;
    } catch (error: unknown) {
      logger.error("Call summarization failed", {
        callId: input.callId,
        error: String(error),
      });
      throw error;
    }
  }

  async summarizeBatch(inputs: CallSummarizerInput[]): Promise<CallSummary[]> {
    logger.info("Batch summarizing calls", { count: inputs.length });

    const results: CallSummary[] = [];
    for (const input of inputs) {
      try {
        const summary = await this.summarize(input);
        results.push(summary);
      } catch (error: unknown) {
        logger.warn("Failed to summarize call in batch", {
          callId: input.callId,
          error: String(error),
        });
      }
    }

    return results;
  }
}

export function createCallSummarizer(): CallSummarizerAgent {
  return new CallSummarizerAgent();
}
