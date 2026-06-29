import type { CRMGraphContext, OrchestratorResponse } from "../core/ports.js";
import { OrchestratorResponseSchema } from "../core/ports.js";
import { MastraAgentProvider } from "../adapters/ai/mastra-agent.js";
import { createLogger } from "../core/logger.js";
import { z } from "zod";

const logger = createLogger("crm-agent");

// Tool contract schemas
export const GetContactToolSchema = z.object({
  name: z.literal("get_contact"),
  description: z.string(),
  parameters: z.object({
    contactId: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
});

export const GetDealsToolSchema = z.object({
  name: z.literal("get_deals"),
  description: z.string(),
  parameters: z.object({
    contactId: z.string(),
    stage: z.string().optional(),
    limit: z.number().min(1).max(50).default(10),
  }),
});

export const GetAccountHealthToolSchema = z.object({
  name: z.literal("get_account_health"),
  description: z.string(),
  parameters: z.object({
    accountId: z.string(),
  }),
});

export const GetRecentTicketsToolSchema = z.object({
  name: z.literal("get_recent_tickets"),
  description: z.string(),
  parameters: z.object({
    contactId: z.string(),
    status: z.enum(["open", "in_progress", "closed", "on_hold"]).optional(),
    limit: z.number().min(1).max(50).default(5),
  }),
});

export type ToolContracts = z.infer<typeof GetContactToolSchema>
  | z.infer<typeof GetDealsToolSchema>
  | z.infer<typeof GetAccountHealthToolSchema>
  | z.infer<typeof GetRecentTicketsToolSchema>;

// CRM-specific response schema with Zod validation
export const CRMResponseSchema = z.object({
  text: z.string(),
  metadata: z.object({
    degraded: z.boolean().default(false),
    cacheHit: z.boolean().default(false),
    modelUsed: z.string().optional(),
    toolsUsed: z.array(z.string()).default([]),
    contextFields: z.object({
      hasContact: z.boolean().default(false),
      hasAccount: z.boolean().default(false),
      hasDeals: z.boolean().default(false),
      hasTickets: z.boolean().default(false),
    }).default({ hasContact: false, hasAccount: false, hasDeals: false, hasTickets: false }),
  }),
});

export type CRMResponse = z.infer<typeof CRMResponseSchema>;

function buildCRMPrompt(context: CRMGraphContext, userMessage?: string): string {
  const parts: string[] = [];

  parts.push("You are a helpful CRM assistant responding to customer inquiries.");

  if (context.contact) {
    parts.push(`\nCustomer Information:
- Name: ${context.contact.name}
- Phone: ${context.contact.phone}
- Email: ${context.contact.email}
- Role: ${context.contact.role}`);
  }

  if (context.account) {
    parts.push(`\nAccount Information:
- Account: ${context.account.name}
- Industry: ${context.account.industry || "N/A"}
- Health Score: ${context.account.healthScore ?? "Unknown"}`);
  }

  if (context.deals.length > 0) {
    const dealList = context.deals.map((d: { name: string; amount: number; stage: string; probability: number }) =>
      `- ${d.name}: $${d.amount.toLocaleString()} (${d.stage}, ${d.probability}% probability)`
    ).join("\n");
    parts.push(`\nOpen Deals:\n${dealList}`);
  }

  if (context.tickets.length > 0) {
    const ticketList = context.tickets.map((t: { subject: string; status: string; priority: string }) =>
      `- ${t.subject} [${t.status}] Priority: ${t.priority}`
    ).join("\n");
    parts.push(`\nRecent Tickets:\n${ticketList}`);
  }

  if (context.calls.length > 0) {
    parts.push(`\nRecent Calls: ${context.calls.length} call(s) on record`);
  }

  if (userMessage) {
    parts.push(`\n\nCustomer's question: "${userMessage}"`);
    parts.push("\nPlease provide a helpful, concise response based on the CRM information above.");
  } else {
    parts.push("\n\nPlease greet the customer by name and offer assistance.");
  }

  return parts.join("");
}

export class CRMAgent {
  private baseAgent: MastraAgentProvider;

  constructor() {
    this.baseAgent = new MastraAgentProvider();
  }

  async respond(
    context: CRMGraphContext,
    userMessage?: string
  ): Promise<OrchestratorResponse> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];

    logger.info("CRM agent generating response", {
      hasContact: !!context.contact,
      hasAccount: !!context.account,
      dealCount: context.deals.length,
      ticketCount: context.tickets.length,
    });

    try {
      const prompt = buildCRMPrompt(context, userMessage);

      // Build messages for the agent
      const response = await this.baseAgent.generate(context);

      // Track which context fields were used
      const contextFields = {
        hasContact: !!context.contact,
        hasAccount: !!context.account,
        hasDeals: context.deals.length > 0,
        hasTickets: context.tickets.length > 0,
      };

      // Build enhanced response
      const enhancedResponse: CRMResponse = {
        text: response.text,
        metadata: {
          degraded: response.metadata.degraded,
          cacheHit: response.metadata.cacheHit,
          modelUsed: response.metadata.modelUsed,
          toolsUsed,
          contextFields,
        },
      };

      // Validate with Zod schema
      const validated = CRMResponseSchema.parse(enhancedResponse);

      logger.info("CRM agent response generated", {
        responseLength: validated.text.length,
        contextFields,
        durationMs: Date.now() - startTime,
      });

      return {
        text: validated.text,
        metadata: {
          degraded: validated.metadata.degraded,
          cacheHit: validated.metadata.cacheHit,
          modelUsed: validated.metadata.modelUsed,
        },
      };
    } catch (error: unknown) {
      logger.error("CRM agent failed", { error: String(error) });
      throw error;
    }
  }

  async *respondStream(
    context: CRMGraphContext,
    userMessage?: string
  ): AsyncIterable<string> {
    const prompt = buildCRMPrompt(context, userMessage);

    try {
      yield* this.baseAgent.generateStream(context);
    } catch (error: unknown) {
      logger.error("CRM agent stream failed", { error: String(error) });
      throw error;
    }
  }
}

// Factory function
export function createCRMAgent(): CRMAgent {
  return new CRMAgent();
}
