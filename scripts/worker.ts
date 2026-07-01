/**
 * WhatsApp Webhook Worker
 *
 * Receives WhatsApp webhook events, validates payloads,
 * routes to orchestrator, and sends responses.
 *
 * Usage: npx tsx scripts/worker.ts
 */

import { loadMonorepoEnv } from "./load-env.js";
loadMonorepoEnv();

import { createServer, IncomingMessage, ServerResponse } from "http";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { OrchestratorResult } from "../packages/ai-core/src/core/orchestrator.js";
import { getGlobalDLQ } from "../packages/ai-core/src/adapters/messaging/bullmq-dlq.js";
import { fieldEncryption } from "../packages/ai-core/src/adapters/encryption/field-encryption.js";
import { CartesiaClipTranscriber } from "../packages/ai-core/src/features/calls/clip-transcriber.js";
import type { IDeadLetterQueue } from "../packages/ai-core/src/core/ports.js";
import { env } from "../packages/ai-core/src/config/env-schema.js";
import { runStartupValidation } from "../packages/ai-core/src/config/startup-validator.js";
import { analyzePipeline } from "../packages/ai-core/src/features/pipeline/pipeline.analyzer.js";
import { transcodeToRaw } from "./audio-utils.js";
import { buildProductionOrchestrator } from "./build-production-orchestrator.js";
import { buildMockOrchestrator } from "./build-mock-orchestrator.js";
import { registerProductionHealthChecks } from "./register-production-health.js";

const logger = createLogger("whatsapp-worker");
const tracer = trace.getTracer("ai-crm-whatsapp-worker", "1.0.0");

export const WHATSAPP_AUDIO_FALLBACK_TEXT =
  "I received your voice message but couldn't process audio right now. Could you type your question?";

const WhatsAppMediaMetaSchema = z.object({
  url: z.string().url(),
  mime_type: z.string().optional(),
});

const WhatsAppMediaUploadSchema = z.object({
  id: z.string(),
});

const CartesiaTtsControlSchema = z.object({
  done: z.boolean().optional(),
  type: z.string().optional(),
});

// Pipeline analyzer daily scheduled job
async function runDailyPipelineAnalysis() {
  logger.info("Starting daily pipeline analysis...");
  try {
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
    const dlq = getGlobalDLQ();
    await dlq.enqueue(
      "pipeline-analyzer",
      { timestamp: new Date().toISOString() },
      { errorCode: "ANALYSIS_FAILED", errorMessage: String(error), attemptCount: 1 }
    );
  }
}

let pipelineAnalysisInterval: NodeJS.Timeout | null = null;
function startPipelineAnalyzer() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();
  runDailyPipelineAnalysis();
  pipelineAnalysisInterval = setTimeout(() => {
    startPipelineAnalyzer();
  }, delay);
  logger.info("Pipeline analyzer scheduled", { nextRunAt: nextMidnight.toISOString() });
}

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
                  text: z
                    .object({
                      body: z.string(),
                    })
                    .optional(),
                  audio: z
                    .object({
                      id: z.string(),
                      mime_type: z.string().optional(),
                    })
                    .optional(),
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

const WhatsAppSendResponseSchema = z.object({
  messaging_product: z.string(),
  messages: z.array(z.object({ id: z.string().max(256) })).optional(),
});

function verifyWebhook(query: URLSearchParams): boolean {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  if (mode === "subscribe" && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info("Webhook verified successfully");
    return true;
  }
  logger.warn("Webhook verification failed", { mode });
  return false;
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
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
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send WhatsApp message: ${response.status} ${error}`);
  }

  const data = WhatsAppSendResponseSchema.parse(await response.json());
  logger.info("WhatsApp message sent", {
    textLength: text.length,
    messageId: data.messages?.[0]?.id,
  });
}

export async function sendWhatsAppAudioMessage(to: string, mediaId: string): Promise<void> {
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
      type: "audio",
      audio: { id: mediaId },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send WhatsApp audio: ${response.status} ${error}`);
  }

  WhatsAppSendResponseSchema.parse(await response.json());
}

export async function downloadWhatsAppAudio(mediaId: string, token: string): Promise<Buffer> {
  const metaUrl = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${mediaId}`;

  async function fetchMeta(): Promise<z.infer<typeof WhatsAppMediaMetaSchema>> {
    const response = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`MEDIA_META_${response.status}`);
    }
    return WhatsAppMediaMetaSchema.parse(await response.json());
  }

  async function fetchBytes(mediaUrl: string): Promise<Buffer> {
    const { request: httpRequest } = await import("node:http");
    const { request: httpsRequest } = await import("node:https");
    const target = new URL(mediaUrl);
    const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30_000,
        },
        (res) => {
          if (res.statusCode === 403 || res.statusCode === 404) {
            reject(new Error(`MEDIA_BYTES_${res.statusCode}`));
            res.resume();
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`MEDIA_BYTES_${res.statusCode ?? 0}`));
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (buf: Buffer) => chunks.push(buf));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        }
      );
      req.on("error", (err: Error) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("MEDIA_BYTES_TIMEOUT"));
      });
      req.end();
    });
  }

  let meta = await fetchMeta();
  try {
    return await fetchBytes(meta.url);
  } catch (error: unknown) {
    const message = String(error);
    if (!message.includes("MEDIA_BYTES_403") && !message.includes("MEDIA_BYTES_404")) {
      throw error;
    }
    meta = await fetchMeta();
    return fetchBytes(meta.url);
  }
}

export async function uploadWhatsAppMedia(audio: Buffer, mimeType: string): Promise<string> {
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_ID}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([audio], { type: mimeType }), "reply.audio");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload WhatsApp media: ${response.status} ${error}`);
  }

  const uploadJson = await response.json();
  return WhatsAppMediaUploadSchema.parse(uploadJson).id;
}

export function truncateForTts(text: string, maxWords = 1000): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  logger.info("TTS output truncated for word limit", { wordCount: words.length, maxWords });
  return words.slice(0, maxWords).join(" ");
}

export async function synthesizeCartesiaSpeech(text: string): Promise<Buffer> {
  const voiceId = process.env.CARTESIA_VOICE_ID ?? "default";
  const params = new URLSearchParams({
    api_key: env.CARTESIA_API_KEY,
    cartesia_version: "2024-06-10",
    model_id: "sonic-english",
    voice_id: voiceId,
    sample_rate: "24000",
  });
  const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?${params.toString()}`);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TTS connect timeout")), 30_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("TTS websocket error"));
    };
  });

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TTS synthesis timeout")), 30_000);

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        chunks.push(Buffer.from(event.data as ArrayBuffer));
        return;
      }
      try {
        const control = CartesiaTtsControlSchema.parse(JSON.parse(event.data));
        if (control.done === true || control.type === "done") {
          clearTimeout(timer);
          resolve();
        }
      } catch {
        // ponytail: ignore non-control JSON frames
      }
    };

    ws.send(JSON.stringify({ transcript: text, continue: false }));
  });

  ws.close();
  return Buffer.concat(chunks);
}

export function encryptPhoneForDlq(phone: string, mediaId: string): string {
  return fieldEncryption.encrypt(phone, mediaId, "whatsapp-audio-dlq");
}

let sharedOrchestrator: ReturnType<typeof buildProductionOrchestrator> | null = null;

function getOrchestrator() {
  if (!sharedOrchestrator) {
    sharedOrchestrator =
      (process.env.USE_MOCK_ORCHESTRATOR ?? "") === "true"
        ? buildMockOrchestrator()
        : buildProductionOrchestrator();
  }
  return sharedOrchestrator;
}

export async function processIntent(
  sessionId: string,
  channel: string,
  userId: string,
  message: string,
  timestamp: string
): Promise<OrchestratorResult> {
  return getOrchestrator().processIntent({
    sessionId,
    userId,
    channel,
    message,
    timestamp,
  });
}

export interface WhatsAppAudioHandlerDeps {
  dlq: IDeadLetterQueue;
  sendText: (to: string, text: string) => Promise<void>;
  sendAudio: (to: string, mediaId: string) => Promise<void>;
  downloadAudio: (mediaId: string, token: string) => Promise<Buffer>;
  transcode: (input: Buffer, sampleRate: number) => Promise<Buffer>;
  createTranscriber: () => CartesiaClipTranscriber;
  synthesize: (text: string) => Promise<Buffer>;
  uploadMedia: (audio: Buffer, mimeType: string) => Promise<string>;
  runOrchestrator: typeof processIntent;
  encryptPhone: (phone: string, mediaId: string) => string;
}

export function createDefaultWhatsAppAudioDeps(): WhatsAppAudioHandlerDeps {
  return {
    dlq: getGlobalDLQ(),
    sendText: sendWhatsAppMessage,
    sendAudio: sendWhatsAppAudioMessage,
    downloadAudio: downloadWhatsAppAudio,
    transcode: transcodeToRaw,
    createTranscriber: () => new CartesiaClipTranscriber({ apiKey: env.CARTESIA_API_KEY }),
    synthesize: synthesizeCartesiaSpeech,
    uploadMedia: uploadWhatsAppMedia,
    runOrchestrator: processIntent,
    encryptPhone: encryptPhoneForDlq,
  };
}

export async function processWhatsAppAudio(
  from: string,
  mediaId: string,
  messageId: string,
  timestamp: string,
  deps: WhatsAppAudioHandlerDeps = createDefaultWhatsAppAudioDeps()
): Promise<void> {
  try {
    const rawAudio = await tracer.startActiveSpan("whatsapp.audio.download", async (span) => {
      try {
        return await deps.downloadAudio(mediaId, env.WHATSAPP_API_TOKEN);
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });

    const pcm = await tracer.startActiveSpan("whatsapp.audio.transcode", async (span) => {
      try {
        return await deps.transcode(rawAudio, 24_000);
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });

    const transcript = await tracer.startActiveSpan("whatsapp.audio.stt", async (span) => {
      try {
        const transcriber = deps.createTranscriber();
        await transcriber.sendPCMChunks(pcm);
        const text = await transcriber.finalize();
        span.setAttribute("transcript_length", text.length);
        return text;
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });

    const result = await deps.runOrchestrator(messageId, "whatsapp", from, transcript, timestamp);
    const replyText = truncateForTts(result.response.text);

    const audioReply = await tracer.startActiveSpan("whatsapp.audio.tts", async (span) => {
      try {
        const bytes = await deps.synthesize(replyText);
        span.setAttribute("audio_bytes", bytes.length);
        return bytes;
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });

    await tracer.startActiveSpan("whatsapp.audio.reply", async (span) => {
      try {
        const uploadedId = await deps.uploadMedia(audioReply, "audio/mpeg");
        await deps.sendAudio(from, uploadedId);
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });

    logger.info("WhatsApp audio message processed", {
      messageId,
      transcriptLength: transcript.length,
      responseLength: replyText.length,
    });
  } catch (error: unknown) {
    const sanitized = error instanceof Error ? error.message : String(error);
    await deps.dlq.enqueue(
      "whatsapp-audio",
      {
        type: "whatsapp_audio_fallback",
        phone: deps.encryptPhone(from, mediaId),
        mediaId,
        error: sanitized,
        retries: 0,
      },
      {
        errorCode: "WHATSAPP_AUDIO_FAILED",
        errorMessage: sanitized,
        attemptCount: 0,
      }
    );
    await deps.sendText(from, WHATSAPP_AUDIO_FALLBACK_TEXT);
    logger.error("WhatsApp audio pipeline failed — DLQ and fallback reply sent", {
      messageId,
      error: sanitized,
    });
  }
}

export async function handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
  logger.info("Received WhatsApp webhook", { object: payload.object, entryCount: payload.entry.length });

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;

      const messages = change.value.messages;
      if (!messages || messages.length === 0) continue;

      const contact = change.value.contacts?.[0];
      const message = messages[0];
      const from = message.from;
      const messageId = message.id;
      const timestamp = message.timestamp;
      const senderName = contact?.profile.name || "Unknown";

      if (message.type === "audio") {
        const mediaId = message.audio?.id;
        if (!mediaId) {
          logger.warn("Audio message missing media id", { messageId });
          continue;
        }

        logger.info("Processing WhatsApp audio message", { messageId, senderName });
        await processWhatsAppAudio(from, mediaId, messageId, timestamp);
        continue;
      }

      if (message.type !== "text") {
        logger.info(`Ignoring non-text message type: ${message.type}`);
        continue;
      }

      const text = message.text?.body;
      if (!text) continue;

      logger.info("Processing WhatsApp message", {
        messageId,
        textLength: text.length,
        senderName,
      });

      try {
        const result = await processIntent(messageId, "whatsapp", from, text, timestamp);
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
        }
      }
    }
  }
}

function createWorkerServer(): { server: ReturnType<typeof createServer>; start: () => Promise<void> } {
  let server: ReturnType<typeof createServer> | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", `http://localhost:${env.APP_PORT}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

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

    if (req.method === "POST" && url.pathname === "/webhook") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const raw = JSON.parse(Buffer.concat(chunks).toString());
        const body = WhatsAppWebhookSchema.parse(raw);
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

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", worker: "whatsapp" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };

  const start = (): Promise<void> =>
    new Promise((resolve, reject) => {
      server = createServer(requestHandler);
      server.on("error", reject);
      server.listen(env.APP_PORT, () => {
        logger.info(`WhatsApp worker listening on port ${env.APP_PORT}`);
        resolve();
      });
    });

  return {
    get server() {
      return server!;
    },
    start,
  };
}

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (import.meta.main) {
  registerProductionHealthChecks();
  await runStartupValidation();
  const worker = createWorkerServer();
  worker.start().catch((error: unknown) => {
    logger.error("Failed to start worker", { error: String(error) });
    process.exit(1);
  });
  startPipelineAnalyzer();
}

export { createWorkerServer };
