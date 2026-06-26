// compiler-trigger-comment-v4
import { sdk } from './otel-bootstrap.ts';
import { loadMonorepoEnv } from "./load-env.ts";
loadMonorepoEnv();

import { Worker, type Job } from "bullmq";
import { trace, type Span } from "@opentelemetry/api";
import { z } from "zod";

import { OrchestratorService } from "@dtc/ai-core/orchestrator";
import { logger } from "@dtc/ai-core/logger";

const tracer = trace.getTracer("whatsapp-worker");

const WhatsAppJobAttachmentSchema = z.object({
  type: z.string(),
  url: z.string(),
});

const WhatsAppJobDataSchema = z.object({
  text: z.string().optional().default(""),
  sender: z.string(),
  channel: z.string().optional().default("whatsapp"),
  attachments: z.array(WhatsAppJobAttachmentSchema).optional().default([]),
});

const WhatsAppDispatchResponseSchema = z.object({
  messaging_product: z.literal("whatsapp").optional(),
  contacts: z.array(z.object({ input: z.string(), wa_id: z.string() })).optional(),
  messages: z.array(z.object({ id: z.string() })).optional(),
});

export interface NormalizedPayload {
  text: string;
  metadata: {
    source: string;
    channel: string;
    platformUserId: string;
    sender: string;
    timestamp: number;
    messageId: string;
  };
  sessionHistory: { role: "user" | "model"; content: string }[];
}

export type ProcessMessageResult =
  | { status: "rate_limited"; sender: string }
  | { status: "ok"; channel: string; text: string; messageId: string };

interface PlatformAdapter {
  sendResponse(recipientId: string, text: string, messageId: string): Promise<void>;
}

class WhatsAppAdapter implements PlatformAdapter {
  async sendResponse(recipientId: string, text: string, messageId: string): Promise<void> {
    const response = z.instanceof(Response).parse(
      await fetch(
        `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `outbound-${messageId}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientId,
            type: "text",
            text: {
              preview_url: false,
              body: text,
            },
          }),
        }
      )
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `WhatsApp API dispatch failed with status ${response.status} (${response.statusText}): ${errorText}`
      );
    }

    const rawJson = await response.json();
    const parsedResponse = WhatsAppDispatchResponseSchema.parse(rawJson);

    logger.info(
      { messageId: parsedResponse.messages?.[0]?.id || "unknown" },
      "Dispatched outbound message to Meta",
    );
  }
}

export const platformRegistry = new Map<string, PlatformAdapter>([
  ["whatsapp", new WhatsAppAdapter()],
]);

export const orchestratorService = new OrchestratorService();

/**
 * Core message handler — exported for unit testing without spinning up BullMQ.
 * Called by the BullMQ Worker callback and by integration tests.
 */
export async function processWhatsAppMessage(
  job: { id?: string; data: unknown },
  redisClient: { incr(key: string): Promise<number>; expire(key: string, seconds: number): Promise<number> },
): Promise<ProcessMessageResult> {
  const data = WhatsAppJobDataSchema.parse(job.data);
  const messageId: string = job.id || `unknown-${Date.now()}`;

  return tracer.startActiveSpan("process-message", async (parentSpan: Span) => {
    parentSpan.setAttribute("messaging.job_id", messageId);
    parentSpan.setAttribute("messaging.channel", data.channel);

    logger.info({ sender: data.sender }, "Processing message");

    const clientKey = `rate:${data.sender}`;

    let isBlocked = false;
    await tracer.startActiveSpan("rate-limiter", async (span: Span) => {
      span.setAttribute("system.operation", "rate-limit");
      span.setAttribute("redis.key_prefix", "rate");

      const currentRequests = await redisClient.incr(clientKey);
      if (currentRequests === 1) {
        await redisClient.expire(clientKey, 10);
      }
      span.setAttribute("requests.count", currentRequests);

      if (currentRequests > 5) {
        isBlocked = true;
      }
      span.end();
    });

    if (isBlocked) {
      logger.warn({ sender: data.sender }, "Rate limit exceeded");
      parentSpan.end();
      return { status: "rate_limited" as const, sender: data.sender };
    }

    let normalizedText: string = data.text;

    if (data.attachments && data.attachments.length > 0) {
      const attachmentBlocks = data.attachments
        .map((att) => `\n\n### Attached Media [Type: ${att.type}]\n- File: ${att.url}`)
        .join("");
      normalizedText += attachmentBlocks;
    }

    const channel: string = data.channel;

    const adapter = platformRegistry.get(channel);
    if (!adapter) {
      throw new Error(`[Queue Worker] No platform adapter registered for channel: ${channel}`);
    }

    const result = await orchestratorService.processIntent({
      text: normalizedText,
      channel,
      platformUserId: data.sender,
    });

    await adapter.sendResponse(data.sender, result.text, messageId);

    parentSpan.end();
    return { status: "ok" as const, channel, text: result.text, messageId };
  });
}

const worker = new Worker(
  "whatsapp-ingestion",
  async (job: Job) => {
    await processWhatsAppMessage(
      { id: job.id, data: job.data },
      {
        incr: async (key: string) => {
          const redisClient = await worker.client;
          return redisClient.incr(key);
        },
        expire: async (key: string, seconds: number) => {
          const redisClient = await worker.client;
          return redisClient.expire(key, seconds);
        },
      },
    );
  },
  {
    connection: {
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    },
    limiter: {
      max: 1,
      duration: 4000,
    },
  }
);

worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error({ jobId: job?.id, err }, "Job failed");
});

export async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown initiated");
  try {
    await worker.close();
    await orchestratorService.close();
    await sdk.shutdown();
    logger.info("Worker closed successfully");
    process.exit(0);
  } catch (error: unknown) {
    logger.error({ err: error }, "Error during worker shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
