/**
 * Voice Agent
 *
 * Real-time voice AI for LiveKit rooms:
 * - T016: CallLifecycle handler (onStart, onTranscript, onInterrupt, onEnd)
 * - T017: Cartesia Sonic STT (streaming WebSocket)
 * - T018: Cartesia Sonic TTS (streaming WebSocket)
 *
 * Usage: npx tsx scripts/voice-agent.ts
 */

import { loadMonorepoEnv } from "./load-env.js";
loadMonorepoEnv();

import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { CallSummarizerAgent, TranscriptSegment } from "../packages/ai-core/src/agents/call-summarizer.js";
import { z } from "zod";
import { cli, defineAgent, type JobContext, ServerOptions } from "@livekit/agents";
import { RoomEvent, Track } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";

const logger = createLogger("voice-agent");

// Call lifecycle states
export type CallState = "starting" | "active" | "paused" | "interrupted" | "ending" | "ended";

// TTS playback state
type TTSPlaybackState = "idle" | "speaking" | "interrupted";

// Call lifecycle data
export interface CallLifecycleData {
  callId: string;
  contactId: string;
  roomName: string;
  startedAt: string;
  endedAt?: string;
  state: CallState;
  transcript: TranscriptSegment[];
  duration: number;
}

// Call lifecycle events
export type CallLifecycleEvent =
  | { type: "onStart"; callId: string; contactId: string; roomName: string }
  | { type: "onTranscript"; segment: TranscriptSegment; isFinal: boolean }
  | { type: "onInterrupt" }
  | { type: "onEnd" };

export type CallLifecycleHandler = (event: CallLifecycleEvent) => Promise<void> | void;

export class CallLifecycleManager {
  private data: CallLifecycleData;
  private handlers: Map<string, CallLifecycleHandler[]> = new Map();
  private ttsState: TTSPlaybackState = "idle";
  private finalTranscriptBuffer: string[] = [];
  private summarizer: CallSummarizerAgent;
  private sttFinalizationTime?: number;
  private firstTTSByteTime?: number;
  private currentTTSAbortController?: AbortController;

  constructor(callId: string, contactId: string, roomName: string) {
    this.data = {
      callId,
      contactId,
      roomName,
      startedAt: new Date().toISOString(),
      state: "starting",
      transcript: [],
      duration: 0,
    };
    this.summarizer = new CallSummarizerAgent();
  }

  on(event: string, handler: CallLifecycleHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
    logger.debug(`Handler registered for event: ${event}`);
  }

  private async emit(event: CallLifecycleEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) || [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error: unknown) {
        logger.error(`Handler error for ${event.type}`, { error: String(error) });
      }
    }
  }

  // T016: onStart - create Call in Supabase
  async onStart(): Promise<void> {
    logger.info("Call starting", {
      callId: this.data.callId,
      contactId: this.data.contactId,
      roomName: this.data.roomName,
    });

    this.data.state = "active";
    this.data.startedAt = new Date().toISOString();

    // Create Call record in Supabase
    // ponytail: Full Supabase integration would go here
    // For now, emit event for any subscribers (e.g., dashboard, audit)
    await this.emit({ type: "onStart", callId: this.data.callId, contactId: this.data.contactId, roomName: this.data.roomName });
  }

  // T017: onTranscript - append chunk to Call
  async onTranscript(segment: TranscriptSegment, isFinal: boolean): Promise<void> {
    // Mark STT finalization time for TTS pause metric
    if (isFinal && !this.sttFinalizationTime) {
      this.sttFinalizationTime = Date.now();
    }

    this.data.transcript.push(segment);

    logger.debug("STT segment received", {
      callId: this.data.callId,
      speaker: segment.speaker,
      length: segment.text.length,
      isFinal,
    });

    if (isFinal) {
      this.finalTranscriptBuffer.push(segment.text);
    }

    await this.emit({ type: "onTranscript", segment, isFinal });
  }

  // T016: onInterrupt - discard in-progress TTS, restart pipeline
  async onInterrupt(): Promise<void> {
    logger.info("Call interrupted", { callId: this.data.callId });

    this.data.state = "interrupted";
    this.ttsState = "interrupted";

    // Abort current TTS playback
    if (this.currentTTSAbortController) {
      this.currentTTSAbortController.abort();
      this.currentTTSAbortController = undefined;
    }

    this.ttsState = "idle";

    await this.emit({ type: "onInterrupt" });

    // Restart pipeline after interrupt
    this.data.state = "active";
  }

  // T016: onEnd - finalize Call with summary
  async onEnd(): Promise<void> {
    logger.info("Call ending", {
      callId: this.data.callId,
      duration: this.data.duration,
      transcriptSegments: this.data.transcript.length,
    });

    this.data.state = "ending";
    this.data.endedAt = new Date().toISOString();
    this.data.duration = Date.now() - new Date(this.data.startedAt).getTime();

    // Generate call summary
    try {
      const summary = await this.summarizer.summarize({
        callId: this.data.callId,
        contactId: this.data.contactId,
        transcript: this.data.transcript,
        callDuration: this.data.duration,
      });

      logger.info("Call summary generated", {
        callId: this.data.callId,
        summaryLength: summary.summary.length,
        actionItems: summary.action_items.length,
      });

      // ponytail: Full Supabase update with summary would go here
    } catch (error: unknown) {
      logger.error("Failed to summarize call", {
        callId: this.data.callId,
        error: String(error),
      });
    }

    this.data.state = "ended";

    await this.emit({ type: "onEnd" });
  }

  // T018: TTS measurement
  markTTSStart(): void {
    if (this.sttFinalizationTime && !this.firstTTSByteTime) {
      this.firstTTSByteTime = Date.now();
      const pause = this.firstTTSByteTime - this.sttFinalizationTime;
      logger.info("TTS pause measured", {
        callId: this.data.callId,
        pauseMs: pause,
        target: 1500, // P95 < 1.5s
      });
    }
  }

  setTTSState(state: TTSPlaybackState): void {
    this.ttsState = state;
  }

  getTTSState(): TTSPlaybackState {
    return this.ttsState;
  }

  getData(): CallLifecycleData {
    return { ...this.data };
  }
}

// T017: Cartesia STT integration (Cartesia serves as single provider for both STT and TTS)

export interface STTResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  speaker?: "customer" | "agent";
}

export interface STTConfig {
  apiKey: string;
  language: string;
}

const CartesiaInk2EventSchema = z.object({
  type: z.enum(["turn.start", "turn.update", "turn.end"]),
  transcript: z.string().optional(),
  turn_id: z.string().optional(),
});

const CartesiaLegacySTTSchema = z.object({
  transcript: z.string().optional(),
  is_final: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  channel: z.number().optional(),
});

export class CartesiaSTTClient {
  private config: STTConfig;
  private ws?: WebSocket;
  private transcriptHandlers: Array<(result: STTResult) => void> = [];
  private partialTranscript = "";

  constructor(config: Partial<STTConfig> = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.CARTESIA_API_KEY || "",
      language: config.language || "en",
    };
  }

  onTranscript(handler: (result: STTResult) => void): void {
    this.transcriptHandlers.push(handler);
  }

  async connect(): Promise<void> {
    if (!this.config.apiKey) {
      logger.warn("Cartesia API key not set, STT disabled");
      return;
    }

    const params = new URLSearchParams({
      model: "ink-2",
      encoding: "pcm_s16le",
      sample_rate: "16000",
      cartesia_version: "2026-03-01",
      access_token: this.config.apiKey,
    });
    const url = `wss://api.cartesia.ai/stt/turns/websocket?${params.toString()}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (msg) => {
      try {
        const raw = JSON.parse(msg.data.toString());
        const ink2 = CartesiaInk2EventSchema.safeParse(raw);
        if (ink2.success) {
          const data = ink2.data;
          if (data.type === "turn.update" && data.transcript) {
            this.partialTranscript = data.transcript;
            this.emitTranscript(data.transcript, false);
          } else if (data.type === "turn.end") {
            const finalText = data.transcript ?? this.partialTranscript;
            if (finalText) {
              this.emitTranscript(finalText, true);
            }
            this.partialTranscript = "";
          }
          return;
        }

        const legacy = CartesiaLegacySTTSchema.parse(raw);
        if (legacy.transcript) {
          this.emitTranscript(legacy.transcript, legacy.is_final ?? false);
        }
      } catch (error: unknown) {
        logger.error("STT message parse error", { error: String(error) });
      }
    };

    logger.info("Cartesia STT connected");
  }

  private emitTranscript(text: string, isFinal: boolean): void {
    const result: STTResult = {
      text,
      isFinal,
      confidence: 1,
      speaker: "customer",
    };
    for (const handler of this.transcriptHandlers) {
      handler(result);
    }
  }

  sendAudio(audioData: ArrayBuffer | Int16Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    }
  }

  close(): void {
    this.ws?.close();
  }
}

// T018: Cartesia TTS integration
export interface TTSConfig {
  apiKey: string;
  voiceId: string;
  model: string;
  sampleRate: number;
}

export class CartesiaTTSClient {
  private config: TTSConfig;
  private ws?: WebSocket;

  constructor(config: Partial<TTSConfig> = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.CARTESIA_API_KEY || "",
      voiceId: config.voiceId || process.env.CARTESIA_VOICE_ID || "default",
      model: config.model || "sonic-english",
      sampleRate: config.sampleRate ?? 24000,
    };
  }

  async connect(): Promise<void> {
    if (!this.config.apiKey) {
      logger.warn("Cartesia API key not set, TTS disabled");
      return;
    }

    const url = `wss://api.cartesia.ai/tts/websocket?api_key=${this.config.apiKey}&cartesia_version=2024-06-10&model_id=${this.config.model}&voice_id=${this.config.voiceId}&sample_rate=${this.config.sampleRate}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (_msg) => {
      // Audio frames received
    };

    logger.info("Cartesia TTS connected", {
      voiceId: this.config.voiceId,
      model: this.config.model,
    });
  }

  async *stream(textStream: AsyncIterable<string>, abortSignal?: AbortSignal): AsyncIterable<ArrayBuffer> {
    if (!this.ws) {
      logger.warn("TTS not connected, skipping");
      return;
    }

    for await (const chunk of textStream) {
      if (abortSignal?.aborted) {
        logger.info("TTS stream aborted");
        return;
      }

      // Send text to Cartesia, yield audio chunks
      this.ws.send(JSON.stringify({
        transcript: chunk,
        continue: true,
      }));

      // ponytail: Cartesia streams audio back, we'd receive and yield
      // For simplicity, return a single chunk per text input
      yield new ArrayBuffer(0);
    }
  }

  close(): void {
    this.ws?.close();
  }
}

// Voice agent orchestrator
export class VoiceAgent {
  private lifecycle: CallLifecycleManager;
  private stt: CartesiaSTTClient;
  private tts: CartesiaTTSClient;

  constructor(callId: string, contactId: string, roomName: string) {
    this.lifecycle = new CallLifecycleManager(callId, contactId, roomName);
    this.stt = new CartesiaSTTClient();
    this.tts = new CartesiaTTSClient();

    this.setupPipeline();
  }

  private setupPipeline(): void {
    this.stt.onTranscript((result) => {
      this.lifecycle.onTranscript(
        {
          speaker: result.speaker || "customer",
          text: result.text,
        },
        result.isFinal
      ).catch((error: unknown) => {
        logger.error("onTranscript error", { error: String(error) });
      });
    });
  }

  async start(): Promise<void> {
    await this.lifecycle.onStart();
    await this.stt.connect();
    await this.tts.connect();
    logger.info("Voice agent started", { callId: this.lifecycle.getData().callId });
  }

  sendAudio(audio: ArrayBuffer | Int16Array): void {
    this.stt.sendAudio(audio);
  }

  async interrupt(): Promise<void> {
    await this.lifecycle.onInterrupt();
  }

  async end(): Promise<void> {
    await this.lifecycle.onEnd();
    this.stt.close();
    this.tts.close();
  }

  getLifecycle(): CallLifecycleManager {
    return this.lifecycle;
  }
}

// Graceful shutdown
let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const JobMetadataSchema = z.object({
  contactId: z.string(),
  sessionId: z.string(),
});

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const meta = JobMetadataSchema.parse(JSON.parse(ctx.job.metadata || "{}"));
    await ctx.connect();

    const voiceAgent = new VoiceAgent(
      `widget-${meta.sessionId}`,
      meta.contactId,
      ctx.room.name ?? "widget-room"
    );

    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      if (participant.identity === ctx.agent?.identity) return;
      if (voiceAgent.getLifecycle().getTTSState() === "speaking") {
        void voiceAgent.interrupt();
      }
    });

    await voiceAgent.start();
    ctx.addShutdownCallback(async () => {
      await voiceAgent.end();
    });
  },
});

const isVoiceAgentMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("voice-agent.ts");

if (isVoiceAgentMain) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: "crm-voice-agent",
      wsURL: process.env.LIVEKIT_URL ?? "",
      apiKey: process.env.LIVEKIT_API_KEY ?? "",
      apiSecret: process.env.LIVEKIT_SECRET ?? process.env.LIVEKIT_API_SECRET ?? "",
    })
  );
}
