/**
 * Voice Agent
 *
 * Real-time voice AI for LiveKit rooms:
 * - T016: CallLifecycle handler (onStart, onTranscript, onInterrupt, onEnd)
 * - T017: Deepgram STT integration
 * - T018: Cartesia TTS integration
 *
 * Usage: bun run scripts/voice-agent.ts
 */

import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { CallSummarizerAgent, TranscriptSegment } from "../packages/ai-core/src/agents/call-summarizer.js";

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

    logger.debug("Transcript segment received", {
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

export class CartesiaSTTClient {
  private config: STTConfig;
  private ws?: WebSocket;
  private transcriptHandlers: Array<(result: STTResult) => void> = [];

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

    // Cartesia Sonic STT WebSocket connection
    const url = `wss://api.cartesia.ai/tts/websocket?api_key=${this.config.apiKey}&cartesia_version=2024-06-10&language=${this.config.language}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data.toString());
        if (data.transcript) {
          const result: STTResult = {
            text: data.transcript,
            isFinal: data.is_final || false,
            confidence: data.confidence || 0,
            speaker: data.channel === 0 ? "agent" : "customer",
          };

          for (const handler of this.transcriptHandlers) {
            handler(result);
          }
        }
      } catch (error: unknown) {
        logger.error("STT message parse error", { error: String(error) });
      }
    };

    logger.info("Cartesia STT connected");
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
      // Audio data received
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
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Run voice agent
if (import.meta.main) {
  logger.info("Voice agent ready (use VoiceAgent class to integrate with LiveKit)");
}
