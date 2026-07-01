/**
 * WhatsApp audio pipeline self-check (T048)
 */

import { describe, it, expect, vi } from "vitest";
import { InMemoryDeadLetterQueue } from "../adapters/messaging/bullmq-dlq.js";
import {
  WHATSAPP_AUDIO_FALLBACK_TEXT,
  processWhatsAppAudio,
  type WhatsAppAudioHandlerDeps,
} from "../../../../scripts/worker.js";

class TimeoutClipTranscriber {
  async sendPCMChunks(): Promise<void> {
    return;
  }
  async finalize(): Promise<string> {
    throw new Error("clip STT finalize timeout");
  }
  close(): void {
    return;
  }
}

describe("whatsapp-audio selfcheck", () => {
  it("enqueues DLQ and sends text fallback when STT fails", async () => {
    const dlq = new InMemoryDeadLetterQueue();
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendAudio = vi.fn();

    const deps: WhatsAppAudioHandlerDeps = {
      dlq,
      sendText,
      sendAudio,
      downloadAudio: vi.fn().mockResolvedValue(Buffer.from("fake-audio")),
      transcode: vi.fn().mockResolvedValue(Buffer.alloc(1024)),
      createTranscriber: () => new TimeoutClipTranscriber() as unknown as import("../../features/calls/clip-transcriber.js").CartesiaClipTranscriber,
      synthesize: vi.fn(),
      uploadMedia: vi.fn(),
      runOrchestrator: vi.fn(),
      encryptPhone: () => "encrypted-phone-blob",
    };

    await processWhatsAppAudio("+15551234567", "media-123", "msg-1", "1700000000", deps);

    const dead = await dlq.listDead("whatsapp-audio");
    expect(dead).toHaveLength(1);
    expect(dead[0]?.job.type).toBe("whatsapp_audio_fallback");
    expect(dead[0]?.job.mediaId).toBe("media-123");
    expect(dead[0]?.job.phone).toBe("encrypted-phone-blob");
    expect(sendText).toHaveBeenCalledWith("+15551234567", WHATSAPP_AUDIO_FALLBACK_TEXT);
    expect(sendAudio).not.toHaveBeenCalled();
  });
});
