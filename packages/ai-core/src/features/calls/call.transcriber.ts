
// ponytail: Placeholder for Deepgram STT adapter.
// Implementation will use Deepgram SDK for streaming transcription.

export interface TranscriberConfig {
  apiKey: string;
}

export function createTranscriber(config: TranscriberConfig) {
  return {
    start: async (audioStream: AsyncIterable<Uint8Array>) => {
      // TODO: Implement Deepgram streaming transcription
      for await (const chunk of audioStream) {
        // Process audio chunk
      }
    },
    stop: async () => {
      // TODO: Stop transcription
    },
  };
}
