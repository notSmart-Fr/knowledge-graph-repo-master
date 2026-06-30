/**
 * WhatsApp Webhook Worker
 *
 * Receives WhatsApp webhook events, validates payloads,
 * routes to orchestrator, and sends responses.
 *
 * Usage: bun run scripts/worker.ts
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { z } from "zod";
import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { createOrchestrator, OrchestratorResult } from "../packages/ai-core/src/core/orchestrator.js";
import { CompositeIdempotencyStore } from "../packages/ai-core/src/adapters/messaging/idempotency.js";
import { env } from "../packages/ai-core/src/config/env-schema.js";
import { analyzePipeline } from "../packages/ai-core/src/features/pipeline/pipeline.analyzer.js";
import { getGlobalDLQ } from "../packages/ai-core/src/adapters/messaging/bullmq-dlq.js";

const logger = createLogger("whatsapp-worker");

// Pipeline analyzer daily scheduled job
async function runDailyPipelineAnalysis() {
  logger.info("Starting daily pipeline analysis...");
  try {
    const dlq = getGlobalDLQ();
    const mockGraphRetriever = {
      expandFromContact: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    };
    const report = await analyzePipeline(mockGraphRetriever);
    logger.info("Daily pipeline analysis complete", { reportLength: report.length });
    return report;
  } catch (error: unknown) {
    logger.error("Pipeline analysis failed", { error: String(error) });
    // Enqueue to DLQ as per T047
    const dlq = getGlobalDLQ();
    await dlq.enqueue("pipeline-analyzer", { timestamp: new Date().toISOString() }, { errorCode: "ANALYSIS_FAILED", errorMessage: String(error), attemptCount: 1 });
  }
}

// Schedule daily at 00:00 UTC
let pipelineAnalysisInterval: NodeJS.Timeout | null = null;
function startPipelineAnalyzer() {
  // Calculate time until next midnight UTC
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();

  // Run once immediately, then every 24h
  runDailyPipelineAnalysis();

  pipelineAnalysisInterval = setTimeout(() => {
    startPipelineAnalyzer(); // Restart to calculate next midnight again
  }, delay);

  logger.info("Pipeline analyzer scheduled", { nextRunAt: nextMidnight.toISOString() });
}

// WhatsApp webhook payload schema
export const WhatsAppWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal("whatsapp"),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  profile: z.object({
                    name: z.string(),
                  }),
                  wa_id: z.string(),
                })
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.enum(["text", "image", "audio", "video", "document", "location", "contacts", "sticker"]),
                  text: z.object({
                    body: z.string(),
                  }).optional(),
                })
              )
              .optional(),
          }),
          field: z.string(),
        })
      ),
    })
  ),
});

export type WhatsAppWebhookPayload = z.infer<typeof WhatsAppWebhookSchema>;

// Webhook verification (GET)
function verifyWebhook(query: URLSearchParams): boolean {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (mode === "subscribe" && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info("Webhook verified successfully");
    return true;
  }

  logger.warn("Webhook verification failed", { mode, token });
  return false;
}

// Send WhatsApp message
async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send WhatsApp message: ${response.status} ${error}`);
  }

  logger.info("WhatsApp message sent", { to, textLength: text.length });
}

// Process incoming message
async function processIntent(
  sessionId: string,
  channel: string,
  userId: string,
  message: string,
  timestamp: string
): Promise<OrchestratorResult> {
  // Initialize orchestrator with required dependencies
  const idempotencyStore = new CompositeIdempotencyStore();

  // ponytail: For MVP, we create a minimal orchestrator config
  // Full implementation would inject real adapters
  const orchestrator = createOrchestrator({
    contactStore: {
      getByPhone: async () => null,
      getById: async () => null,
      search: async () => [],
    },
    dealStore: {
      getByContact: async () => [],
      getById: async () => null,
      update: async () => { throw new Error("Not implemented"); },
    },
    accountStore: {
      getById: async () => null,
      getHealthScore: async () => null,
    },
    ticketStore: {
      getByContact: async () => [],
      create: async () => { throw new Error("Not implemented"); },
    },
    graphRetriever: {
      expandFromContact: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ contact: undefined, account: undefined, deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    },
    embeddingProvider: {
      embed: async () => [],
      embedBatch: async () => [],
    },
    agentProvider: {
      generate: async () => ({
        text: "I'm a CRM assistant. How can I help you today?",
        metadata: { degraded: false, cacheHit: false, modelUsed: "mock" },
      }),
      generateStream: async function* () { yield "Mock response"; },
    },
    cacheStore: {
      check: async () => null,
      store: async () => {},
    },
    idempotencyStore,
  });

  return orchestrator.processIntent({
    sessionId,
    userId,
    channel,
    message,
    timestamp,
  });
}

// Handle webhook POST
async function handleWebhook(body: unknown): Promise<void> {
  const payload = WhatsAppWebhookSchema.parse(body);

  logger.info("Received WhatsApp webhook", { object: payload.object, entryCount: payload.entry.length });

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;

      const messages = change.value.messages;
      if (!messages || messages.length === 0) continue;

      const contact = change.value.contacts?.[0];
      const message = messages[0];

      if (message.type !== "text") {
        logger.info(`Ignoring non-text message type: ${message.type}`);
        continue;
      }

      const from = message.from;
      const messageId = message.id;
      const text = message.text.body;
      const timestamp = message.timestamp;
      const senderName = contact?.profile.name || "Unknown";

      logger.info("Processing WhatsApp message", {
        from,
        messageId,
        textLength: text.length,
        senderName,
      });

      try {
        // Process through orchestrator
        const result = await processIntent(
          messageId,
          "whatsapp",
          from,
          text,
          timestamp
        );

        // Send response
        await sendWhatsAppMessage(from, result.response.text);

        logger.info("WhatsApp message processed", {
          messageId,
          degraded: result.metadata.degraded,
          responseLength: result.response.text.length,
        });
      } catch (error: unknown) {
        logger.error("Failed to process WhatsApp message", {
          messageId,
          error: String(error),
        });

        // Send polite fallback
        try {
          await sendWhatsAppMessage(
            from,
            "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
          );
        } catch (sendError: unknown) {
          logger.error("Failed to send fallback message", {
            messageId,
            error: String(sendError),
          });
          // Enqueue to DLQ for operator replay
          // ponytail: DLQ integration would go here
        }
      }
    }
  }
}

// HTTP server
function createWorkerServer(): { server: ReturnType<typeof createServer>; start: () => Promise<void> } {
  let server: ReturnType<typeof createServer> | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", `http://localhost:${env.APP_PORT}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET - webhook verification
    if (req.method === "GET" && url.pathname === "/webhook") {
      const verified = verifyWebhook(url.searchParams);
      if (verified) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(url.searchParams.get("hub.challenge") || "verified");
      } else {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
      }
      return;
    }

    // POST - webhook events
    if (req.method === "POST" && url.pathname === "/webhook") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        await handleWebhook(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "processed" }));
      } catch (error: unknown) {
        logger.error("Webhook handler error", { error: String(error) });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", worker: "whatsapp" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };

  const start = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      server = createServer(requestHandler);
      server.on("error", reject);
      server.listen(env.APP_PORT, () => {
        logger.info(`WhatsApp worker listening on port ${env.APP_PORT}`);
        resolve();
      });
    });
  };

  return {
    get server() {
      return server!;
    },
    start,
  };
}

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Run worker
if (import.meta.main) {
  const worker = createWorkerServer();
  worker.start().catch((error) => {
    logger.error("Failed to start worker", { error: String(error) });
    process.exit(1);
  });
  startPipelineAnalyzer();
}

export { createWorkerServer };
