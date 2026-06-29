// Transcript stream pane.
// Subscribes to Supabase Realtime on `calls` table for live streaming (per spec Clarifications Q1).
// Per-chunk speaker labels + per-chunk sentiment encoded as left-border accent (per spec Clarifications Q5).
// Per data-model.md: TranscriptChunk = { speaker, text, timestamp_ms, sentiment }.

import { z } from "zod";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { store, subscribeToKey, type TranscriptChunk } from "../store.js";

// Public Supabase config — read from Vite env. Values are exposed to the browser (publishable key only).
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";

const MAX_CHUNKS_IN_DOM = 200; // ponytail: cap DOM growth — older chunks scroll off naturally.

export function renderTranscriptPane(root: HTMLElement): void {
  const pane = root.querySelector<HTMLElement>('[data-zone="transcript"]');
  if (!pane) return;

  pane.innerHTML = `
    <div style="padding:12px 16px; border-bottom:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center;">
      <strong>Live Transcript</strong>
      <span id="realtime-status" style="font-size:11px; color:var(--color-text-faint);">connecting…</span>
    </div>
    <div id="chunks" role="log" aria-live="polite" aria-label="Live voice transcript"
         style="flex:1; overflow-y:auto; padding:12px 16px;"></div>
  `;

  const chunksEl = pane.querySelector<HTMLDivElement>("#chunks")!;
  const statusEl = pane.querySelector<HTMLSpanElement>("#realtime-status")!;

  subscribeToKey("liveTranscript", (chunks) => {
    chunksEl.innerHTML = chunks
      .slice(-MAX_CHUNKS_IN_DOM)
      .map(renderChunk)
      .join("");
    // Auto-scroll to bottom so the operator always sees the freshest chunks.
    chunksEl.scrollTop = chunksEl.scrollHeight;
  });

  // ponytail: bail with a clear status if Supabase isn't configured in this environment.
  // Per US3 acceptance scenario 4, panel must NOT block others — just show its own state.
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    statusEl.textContent = "Supabase not configured";
    chunksEl.innerHTML = `<div style="color:var(--color-text-faint); font-size:12px;">Realtime disabled — set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</div>`;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });

  const pgChangeSchema = z.object({
    new: z.object({
      transcript_json: z.object({
        chunks: z.array(z.object({
          speaker: z.enum(["customer", "agent"]),
          text: z.string(),
          timestamp_ms: z.number(),
          sentiment: z.enum(["positive", "neutral", "negative"]),
        })),
      }).optional(),
    }).optional(),
  });

  const subStatusSchema = z.enum(["SUBSCRIBED", "CLOSED", "CHANNEL_ERROR"]);

  let channel: RealtimeChannel | null = null;
  try {
    channel = supabase
      .channel("calls-transcript")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls" },
        (payload) => {
          // New chunks are appended to transcript_json.chunks[]. We re-read the whole chunks array
          // on each event; postgres_changes sends only the row, so this is bounded by call size.
          const row = pgChangeSchema.parse(payload).new;
          if (!row?.transcript_json?.chunks) return;
          store.setState("liveTranscript", row.transcript_json.chunks);
          store.patchState({ realtimeAvailable: true });
        }
      )
      .subscribe((status) => {
        const parsed = subStatusSchema.parse(status);
        if (parsed === "SUBSCRIBED") {
          statusEl.textContent = "live";
          store.patchState({ realtimeAvailable: true, lastHealthyAt: new Date().toISOString() });
        } else if (parsed === "CLOSED" || parsed === "CHANNEL_ERROR") {
          statusEl.textContent = "disconnected";
          store.patchState({ realtimeAvailable: false });
        }
      });
  } catch (_e: unknown) {
    statusEl.textContent = "Realtime failed to connect";
    store.patchState({ realtimeAvailable: false });
  }

  // ponytail: tear down on page unload to avoid ghost channels on hot reload.
  window.addEventListener("beforeunload", () => {
    channel?.unsubscribe();
    supabase.removeChannel(channel!);
  });
}

function renderChunk(chunk: TranscriptChunk): string {
  const ts = formatTimestamp(chunk.timestamp_ms);
  const sentimentClass = `sentiment-${chunk.sentiment}`;
  const speakerLabel = chunk.speaker === "customer" ? "Customer" : "Agent";
  const speakerAlign = chunk.speaker === "customer" ? "flex-start" : "flex-end";

  // ponytail: alignment by speaker — customer left, agent right — matches WhatsApp-style UX conventions.
  return `
    <div
      class="chunk ${sentimentClass}"
      role="article"
      aria-label="${speakerLabel}: ${escapeHtml(chunk.text)} (sentiment: ${chunk.sentiment})"
      style="
        display:flex; justify-content:${speakerAlign}; margin:6px 0;
      ">
      <div style="
        max-width:300px;
        padding:8px 12px;
        border-left:3px solid var(--color-sentiment-${chunk.sentiment});
        background:var(--color-surface);
        border-radius:6px;
        font-size:13px;
      ">
        <div style="font-size:10px; color:var(--color-text-faint); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">
          ${speakerLabel} · ${ts}
        </div>
        <div>${escapeHtml(chunk.text)}</div>
      </div>
    </div>
  `;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}