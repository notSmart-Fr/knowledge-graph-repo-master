/**
 * Cartesia Sonic STT contract for voice channels (LiveKit WebRTC, async audio uploads).
 * Reference implementation: CartesiaSTTClient in scripts/voice-agent.ts.
 */

export interface CartesiaTranscriberConfig {
  apiKey: string;
  language?: string;
}

/** Partial/final chunk from Cartesia streaming STT. */
export interface CartesiaTranscriptResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  speaker?: "customer" | "agent";
}

/** Streaming STT over Cartesia Sonic WebSocket. */
export interface ICartesiaTranscriber {
  connect(): Promise<void>;
  sendAudio(audioData: ArrayBuffer | Int16Array): void;
  onTranscript(handler: (result: CartesiaTranscriptResult) => void): void;
  close(): void;
}
