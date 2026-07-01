/**
 * Live-Assist Agent
 *
 * Real-time AI prompts for the human agent during a call.
 * Generates suggestions and context the agent can use.
 * NOT visible to customer - only on agent dashboard.
 *
 * Usage: subscribed to by agent dashboard in real-time
 */

import { timeService } from "../core/time-service.js";
import { z } from "zod";
import { MastraAgentProvider } from "../adapters/ai/mastra-agent.js";
import type { CRMGraphContext } from "../core/ports.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("live-assist");

// Output schema for live assist prompts
export const LiveAssistPromptSchema = z.object({
  type: z.enum(["suggestion", "objection", "context", "warning", "opportunity"]),
  text: z.string().min(1).max(280),
  priority: z.enum(["low", "medium", "high"]),
  relatedData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  agentActionable: z.boolean().default(true),
});

export type LiveAssistPrompt = z.infer<typeof LiveAssistPromptSchema>;

export interface LiveAssistInput {
  callId: string;
  contactId: string;
  context: CRMGraphContext;
  recentTranscript: string;
  customerStatement?: string;
  callDuration: number;
}

export class LiveAssistAgent {
  private baseAgent: MastraAgentProvider;

  constructor() {
    this.baseAgent = new MastraAgentProvider();
  }

  async generatePrompt(input: LiveAssistInput): Promise<LiveAssistPrompt> {
    const startTime = timeService.now();

    logger.debug("Generating live-assist prompt", {
      callId: input.callId,
      contactId: input.contactId,
    });

    try {
      const response = await this.baseAgent.generate(input.context);

      const parsed = LiveAssistPromptSchema.parse(JSON.parse(response.text));

      logger.debug("Live-assist prompt generated", {
        callId: input.callId,
        type: parsed.type,
        durationMs: timeService.durationMs(startTime),
      });

      return parsed;
    } catch (error: unknown) {
      logger.error("Live-assist prompt generation failed", {
        callId: input.callId,
        error: String(error),
      });
      throw error;
    }
  }

  async *streamPrompts(
    input: LiveAssistInput
  ): AsyncIterable<LiveAssistPrompt> {
    // Generate context prompt immediately
    if (input.context.contact) {
      yield {
        type: "context",
        text: `Customer: ${input.context.contact.name}. ${input.context.deals.length} open deal(s), ${input.context.tickets.length} ticket(s).`,
        priority: "low",
        agentActionable: false,
      };
    }

    // Generate suggestion based on customer statement
    if (input.customerStatement) {
      const prompt = await this.generatePrompt(input);
      yield prompt;
    }
  }
}

export function createLiveAssist(): LiveAssistAgent {
  return new LiveAssistAgent();
}
