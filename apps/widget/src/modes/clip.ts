import { store } from "../store.js";
import { handleUnauthorized } from "../auth.js";

const MAX_CLIP_MS = 60_000;

let mediaStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

export interface ClipRecordingCallbacks {
  onCountdown?: (secondsLeft: number) => void;
  onRecordingChange?: (recording: boolean) => void;
}

let callbacks: ClipRecordingCallbacks = {};

export function setClipCallbacks(next: ClipRecordingCallbacks): void {
  callbacks = next;
}

function clearTimers(): void {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
}

function stopStream(): void {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }
}

async function stopRecordingInternal(): Promise<Blob | null> {
  clearTimers();
  callbacks.onRecordingChange?.(false);
  callbacks.onCountdown?.(0);

  if (!recorder || recorder.state === "inactive") {
    stopStream();
    return chunks.length ? new Blob(chunks, { type: recorder?.mimeType ?? "audio/webm" }) : null;
  }

  return new Promise((resolve) => {
    recorder!.onstop = () => {
      const blob = chunks.length ? new Blob(chunks, { type: recorder?.mimeType ?? "audio/webm" }) : null;
      recorder = null;
      stopStream();
      resolve(blob);
    };
    recorder!.stop();
  });
}

export async function startRecording(): Promise<void> {
  if (store.getState().blocked || !store.getState().sttAvailable) return;

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  recorder = new MediaRecorder(mediaStream, { mimeType });
  chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.start(250);
  callbacks.onRecordingChange?.(true);

  const startedAt = Date.now();
  const tick = (): void => {
    const elapsed = Date.now() - startedAt;
    const left = Math.max(0, Math.ceil((MAX_CLIP_MS - elapsed) / 1000));
    callbacks.onCountdown?.(left);
  };
  tick();
  const countdownInterval = setInterval(tick, 1000);

  autoStopTimer = setTimeout(() => {
    clearInterval(countdownInterval);
    store.patch({ banner: "Voice clips limited to 60 seconds" });
    void stopRecordingInternal();
  }, MAX_CLIP_MS);
}

export async function stopAndUpload(
  sessionId: string,
  token: string,
  serverUrl: string
): Promise<{ ok: boolean }> {
  if (store.getState().blocked) return { ok: false };

  const blob = await stopRecordingInternal();
  if (!blob || blob.size === 0) return { ok: false };

  const form = new FormData();
  form.append("sessionId", sessionId);
  form.append("audio", blob, "clip.webm");

  const response = await fetch(`${serverUrl}/widget/audio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (response.status === 401) {
    await handleUnauthorized(response);
    return { ok: false };
  }
  if (response.status === 429) {
    const body = (await response.json()) as { retryAfterMs?: number };
    store.rateLimited(body.retryAfterMs ?? 5000);
    return { ok: false };
  }
  if (response.status === 503) {
    store.sttUnavailable();
    return { ok: false };
  }
  if (!response.ok || !response.body) {
    store.sttUnavailable();
    return { ok: false };
  }

  store.patch({ loading: true, mode: "clip" });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTranscript = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6)) as {
        type: string;
        content?: string;
      };
      if (payload.type === "transcript" && payload.content) {
        store.emitTranscript(payload.content);
        sawTranscript = true;
      } else if (payload.type === "token" && payload.content) {
        store.appendToken(payload.content);
      } else if (payload.type === "done") {
        store.done();
      }
    }
  }

  if (!sawTranscript) {
    store.sttUnavailable();
    return { ok: false };
  }

  return { ok: true };
}

export async function cancelRecording(): Promise<void> {
  chunks = [];
  await stopRecordingInternal();
}
