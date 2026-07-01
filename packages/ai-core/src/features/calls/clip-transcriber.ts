/**
 * Cartesia Ink-2 clip/async STT (manual finalize WebSocket).
 * Used by WhatsApp audio ingress and widget voice-clip upload (US2/US4).
 */

import { trace, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { createLogger } from "../../core/logger.js";
import { IntegrationError } from "../../core/errors.js";

const logger = createLogger("clip-transcriber");
const tracer = trace.getTracer("ai-crm-clip-transcriber", "1.0.0");

const CLIP_STT_TIMEOUT_MS = 30_000;
const CLIP_PCM_CHUNK_SIZE = 32_768;

const CartesiaClipTranscriptSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  transcript: z.string().optional(),
  isFinal: z.boolean().optional(),
});

export interface CartesiaClipTranscriberConfig {
  apiKey: string;
  sampleRate?: number;
}

export class CartesiaClipTranscriber {
  private readonly apiKey: string;
  private readonly sampleRate: number;
  private ws?: WebSocket;
  private connectPromise?: Promise<void>;

  constructor(config: CartesiaClipTranscriberConfig) {
    this.apiKey = config.apiKey;
    this.sampleRate = config.sampleRate ?? 24_000;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = tracer.startActiveSpan("cartesia.clip.connect", async (span) => {
      try {
        const params = new URLSearchParams({
          model: "ink-2",
          encoding: "pcm_s16le",
          sample_rate: String(this.sampleRate),
          cartesia_version: "2026-03-01",
          access_token: this.apiKey,
        });
        const url = `wss://api.cartesia.ai/stt/websocket?${params.toString()}`;
        const ws = new WebSocket(url);

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("clip STT connect timeout")), CLIP_STT_TIMEOUT_MS);
          ws.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
          ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error("clip STT websocket error"));
          };
        });

        this.ws = ws;
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw new IntegrationError("CARTESIA_CLIP_STT_CONNECT", "Failed to connect clip STT", {
          error: String(error),
        });
      } finally {
        span.end();
        this.connectPromise = undefined;
      }
    });

    await this.connectPromise;
  }

  async sendPCMChunks(buffer: Buffer, chunkSize = CLIP_PCM_CHUNK_SIZE): Promise<void> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new IntegrationError("CARTESIA_CLIP_STT_NOT_CONNECTED", "Clip STT socket not open");
    }

    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const chunk = buffer.subarray(offset, offset + chunkSize);
      ws.send(chunk);
    }
  }

  async finalize(): Promise<string> {
    return tracer.startActiveSpan("cartesia.clip.finalize", async (span) => {
      try {
        await this.ensureConnected();
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new IntegrationError("CARTESIA_CLIP_STT_NOT_CONNECTED", "Clip STT socket not open");
        }

        const transcript = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("clip STT finalize timeout")), CLIP_STT_TIMEOUT_MS);

          const onMessage = (event: MessageEvent): void => {
            try {
              if (typeof event.data !== "string") return;
              const parsed = CartesiaClipTranscriptSchema.parse(JSON.parse(event.data));
              const text = parsed.text ?? parsed.transcript;
              if (text && (parsed.type === "transcript" || parsed.isFinal === true)) {
                clearTimeout(timer);
                ws.removeEventListener("message", onMessage);
                resolve(text);
              }
            } catch (error: unknown) {
              logger.warn("Ignoring clip STT message", { error: String(error) });
            }
          };

          ws.addEventListener("message", onMessage);
          ws.send("finalize");
        });

        span.setAttribute("transcript_length", transcript.length);
        return transcript;
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        this.close();
        span.end();
      }
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}

export { CLIP_PCM_CHUNK_SIZE };
