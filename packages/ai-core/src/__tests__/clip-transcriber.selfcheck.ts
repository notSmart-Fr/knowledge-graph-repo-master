/**
 * CartesiaClipTranscriber self-check (T054)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CartesiaClipTranscriber, CLIP_PCM_CHUNK_SIZE } from "../features/calls/clip-transcriber.js";

type WsListener = (event: { data: string | ArrayBuffer }) => void;

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  sent: Array<string | ArrayBuffer | Buffer> = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, WsListener[]>();

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string | ArrayBuffer | Buffer): void {
    this.sent.push(data);
  }

  addEventListener(type: string, listener: WsListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: WsListener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => l !== listener)
    );
  }

  dispatch(type: string, event: { data?: string | ArrayBuffer }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: event.data ?? "" });
    }
  }

  close(): void {
    this.readyState = 3;
  }
}

describe("clip-transcriber selfcheck", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it("chunks PCM, sends finalize, and resolves transcript", async () => {
    const transcriber = new CartesiaClipTranscriber({ apiKey: "test-key" });
    await transcriber.sendPCMChunks(Buffer.alloc(65_536));

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    const binaryFrames = ws!.sent.filter((frame) => typeof frame !== "string");
    expect(binaryFrames).toHaveLength(2);
    expect((binaryFrames[0] as Buffer).length).toBe(CLIP_PCM_CHUNK_SIZE);
    expect((binaryFrames[1] as Buffer).length).toBe(CLIP_PCM_CHUNK_SIZE);

    const finalizePromise = transcriber.finalize();
    await Promise.resolve();
    expect(ws!.sent.some((frame) => frame === "finalize")).toBe(true);

    ws!.dispatch("message", {
      data: JSON.stringify({ type: "transcript", text: "hello" }),
    });

    await expect(finalizePromise).resolves.toBe("hello");
  });
});
