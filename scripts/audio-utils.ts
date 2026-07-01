/**
 * Server-side audio transcoding for widget clips and WhatsApp voice notes.
 */

import type { IncomingMessage } from "node:http";
import { spawn, execSync } from "node:child_process";
import Busboy from "busboy";
import { z } from "zod";

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_AUDIO_MIME = ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"] as const;

export function isAllowedAudioMime(mimeType: string): boolean {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (ALLOWED_AUDIO_MIME as readonly string[]).includes(base);
}

export interface ParsedAudioUpload {
  sessionId: string;
  audio: Buffer;
  mimeType: string;
}

interface UploadCollectState {
  parts: Buffer[];
  mimeType: string;
  reject: (err: Error) => void;
}

function collectUploadStream(stream: NodeJS.ReadableStream, state: UploadCollectState): void {
  stream.on("limit", () => state.reject(new Error("audio too large")));
  stream.on("data", (buf: Buffer) => {
    state.parts.push(buf);
  });
}

const SessionFieldSchema = z.string();

function applySessionField(name: string, raw: string, session: { id: string }): void {
  if (name === "sessionId") {
    session.id = SessionFieldSchema.parse(raw);
  }
}

export function parseAudioUpload(req: IncomingMessage): Promise<ParsedAudioUpload> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_AUDIO_BYTES } });
    const session = { id: "" };
    const state: UploadCollectState = { parts: [], mimeType: "", reject };

    busboy.on("file", (_field, file, info) => {
      state.mimeType = info.mimeType;
      collectUploadStream(file, state);
    });

    busboy.on("field", (name, value) => {
      applySessionField(name, value, session);
    });

    busboy.on("finish", () => {
      resolve({ sessionId: session.id, audio: Buffer.concat(state.parts), mimeType: state.mimeType });
    });

    busboy.on("error", (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    req.pipe(busboy);
  });
}

export class FfmpegNotFoundError extends Error {
  constructor() {
    super("ffmpeg not found on PATH");
    this.name = "FfmpegNotFoundError";
  }
}

export function isFfmpegAvailable(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function transcodeToRaw(input: Buffer, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (buf: Buffer) => {
      chunks.push(buf);
    });

    proc.stderr.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      if (/ENOENT|not found/i.test(stderr)) {
        reject(new FfmpegNotFoundError());
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}`));
    });

    proc.on("error", (err: Error) => {
      if (/ENOENT/i.test(String(err))) {
        reject(new FfmpegNotFoundError());
        return;
      }
      reject(err);
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
