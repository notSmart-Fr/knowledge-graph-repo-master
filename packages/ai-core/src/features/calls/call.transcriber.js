// ponytail: Placeholder for Deepgram STT adapter.
// Implementation will use Deepgram SDK for streaming transcription.
export function createTranscriber(config) {
    return {
        start: async (audioStream) => {
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
