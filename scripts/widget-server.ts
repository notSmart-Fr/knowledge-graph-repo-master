/**
 * Widget Server
 *
 * HTTP transport for the embeddable customer chat widget (port 8290).
 *
 * Usage: npx tsx scripts/widget-server.ts
 */

import { loadMonorepoEnv } from "./load-env.js";
loadMonorepoEnv();

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { createClient, type User } from "@supabase/supabase-js";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { getCircuitBreaker, CircuitBreakerOpenError } from "../packages/ai-core/src/core/circuit-breaker.js";
import { type Orchestrator } from "../packages/ai-core/src/core/orchestrator.js";
import { LiveKitRoomAdapter } from "../packages/ai-core/src/adapters/livekit/livekit-room.adapter.js";
import type { AgentDispatchOptions, ILiveKitRoomManager, IContactStore, LiveKitRoomDetails } from "../packages/ai-core/src/core/ports.js";
import { SupabaseContactStore } from "../packages/ai-core/src/adapters/supabase/contact-store.js";
import { runStartupValidation, registerWidgetStartupChecks } from "../packages/ai-core/src/config/startup-validator.js";
import { registerLiveKitHealthCheck, registerCartesiaHealthCheck, registerFfmpegHealthCheck } from "../packages/ai-core/src/health/health-checks.js";
import { buildProductionOrchestrator } from "./build-production-orchestrator.js";
import { buildMockOrchestrator } from "./build-mock-orchestrator.js";
import { registerProductionHealthChecks } from "./register-production-health.js";
import { CartesiaClipTranscriber } from "../packages/ai-core/src/features/calls/clip-transcriber.js";
import { ALLOWED_AUDIO_MIME, isAllowedAudioMime, isFfmpegAvailable, MAX_AUDIO_BYTES, parseAudioUpload, transcodeToRaw } from "./audio-utils.js";

const logger = createLogger("widget-server");
const otelTracer = trace.getTracer("ai-crm-widget-server", "1.0.0");

const DEFAULT_PORT = 8290;
const HOST = "0.0.0.0";
const SESSION_TTL_MS = 30 * 60_000;

const ChatRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

const RoomRequestSchema = z.object({
  sessionId: z.string().uuid(),
});

const AGENT_PICKUP_TIMEOUT_MS = 15_000;

// --- HTTP helpers ---

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function writeSse(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function resolveAllowedOrigins(): string[] | null {
  const raw = process.env.WIDGET_ALLOWED_ORIGINS ?? "";
  if (!raw.trim()) return null;
  return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
}

/** Returns false when Origin is not on the allow-list (403). */
function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const allowed = resolveAllowedOrigins();
  const origin = req.headers.origin;

  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");

  if (allowed === null) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return true;
  }

  if (!origin || !allowed.includes(origin)) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  return true;
}

// --- Auth context ---

type AuthReason = "expired" | "malformed" | "missing";

export interface WidgetRequestContext {
  userId: string;
  user: User;
  contactId?: string;
}

// --- Session registry (T027) ---

export interface WidgetSessionEntry {
  contactId: string;
  turnIndex: number;
  lastActive: Date;
  liveRoomName: string | null;
}

const sessionRegistry = new Map<string, WidgetSessionEntry>();

export function getOrCreateSession(sessionId: string, contactId: string): WidgetSessionEntry {
  const existing = sessionRegistry.get(sessionId);
  if (existing) {
    existing.lastActive = new Date();
    existing.contactId = contactId;
    return existing;
  }
  const entry: WidgetSessionEntry = { contactId, turnIndex: 0, lastActive: new Date(), liveRoomName: null };
  sessionRegistry.set(sessionId, entry);
  return entry;
}

export function cleanupStaleSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, entry] of sessionRegistry) {
    if (entry.lastActive.getTime() < cutoff) {
      sessionRegistry.delete(id);
    }
  }
}

setInterval(cleanupStaleSessions, SESSION_TTL_MS);

export function findSessionIdByRoomName(roomName: string): string | undefined {
  for (const [sessionId, entry] of sessionRegistry) {
    if (entry.liveRoomName === roomName) return sessionId;
  }
  return undefined;
}

export function setSessionLiveRoom(sessionId: string, roomName: string): void {
  const entry = sessionRegistry.get(sessionId);
  if (entry) {
    entry.liveRoomName = roomName;
    entry.lastActive = new Date();
  }
}

export function clearSessionLiveRoom(sessionId: string): void {
  const entry = sessionRegistry.get(sessionId);
  if (entry) {
    entry.liveRoomName = null;
    entry.lastActive = new Date();
  }
}

// --- Widget session DB (live_room_name) ---

function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function persistLiveRoomName(contactId: string, roomName: string | null): Promise<void> {
  const client = createAdminClient();
  if (!client) return;

  const { data: existing } = await client
    .from("user_sessions")
    .select("id")
    .eq("user_id", contactId)
    .eq("channel", "widget")
    .limit(1)
    .maybeSingle();

  if (existing) {
    await client
      .from("user_sessions")
      .update({ live_room_name: roomName, last_active_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  if (roomName) {
    await client.from("user_sessions").insert({
      user_id: contactId,
      channel: "widget",
      live_room_name: roomName,
      messages: [],
    });
  }
}

export async function clearLiveRoomNameByRoom(roomName: string): Promise<void> {
  const client = createAdminClient();
  if (!client) return;
  await client
    .from("user_sessions")
    .update({ live_room_name: null, last_active_at: new Date().toISOString() })
    .eq("channel", "widget")
    .eq("live_room_name", roomName);
}

export async function reconcileStaleWidgetRooms(lkManager: ILiveKitRoomManager): Promise<void> {
  const client = createAdminClient();
  if (!client) return;

  const { data: rows } = await client
    .from("user_sessions")
    .select("id, live_room_name")
    .eq("channel", "widget")
    .not("live_room_name", "is", null);

  if (!rows?.length) return;

  const liveRooms = new Set(await lkManager.listRooms());
  for (const row of rows) {
    const name = row.live_room_name as string | null;
    if (!name || liveRooms.has(name)) continue;
    await client.from("user_sessions").update({ live_room_name: null }).eq("id", row.id);
    const sessionId = findSessionIdByRoomName(name);
    if (sessionId) clearSessionLiveRoom(sessionId);
    logger.info("Reconciled stale widget room", { roomName: name });
  }
}

// --- Rate limiting (FR-016) ---

interface RateWindow {
  count: number;
  windowStart: number;
}

const RATE_LIMITS: Record<string, number> = {
  "/widget/chat": 30,
  "/widget/audio": 10,
  "/widget/clip": 10,
  "/widget/room": 10,
  "/widget/room-token": 10,
};

const rateLimitByContact = new Map<string, RateWindow>();
const RATE_WINDOW_MS = 60_000;

function rateLimitKey(contactId: string, path: string): string {
  return `${contactId}:${path}`;
}

export function checkRateLimit(
  contactId: string,
  path: string
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const limit = RATE_LIMITS[path];
  if (!limit) return { allowed: true };

  const key = rateLimitKey(contactId, path);
  const now = Date.now();
  const entry = rateLimitByContact.get(key);

  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    rateLimitByContact.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= limit) {
    const retryAfterMs = RATE_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  entry.count += 1;
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitByContact) {
    if (now - entry.windowStart >= RATE_WINDOW_MS * 2) {
      rateLimitByContact.delete(key);
    }
  }
}, 5 * 60_000);

// --- Contact resolution ---

const defaultContactStore = new SupabaseContactStore();
const contactCache = new Map<string, string>();

export async function resolveContact(
  authUserId: string,
  user: User,
  contactStore: IContactStore = defaultContactStore
): Promise<string> {
  const cached = contactCache.get(authUserId);
  if (cached) return cached;

  const existing = await contactStore.getById(authUserId);
  if (existing) {
    contactCache.set(authUserId, existing.id);
    return existing.id;
  }

  const meta = user.user_metadata ?? {};
  const name =
    typeof meta.name === "string" ? meta.name : typeof meta.full_name === "string" ? meta.full_name : "Customer";
  const email =
    typeof meta.email === "string" ? meta.email : user.email ?? `widget-${authUserId}@placeholder.local`;
  const phone = `widget:${authUserId}`;

  const byEmail = await contactStore.search(email.split("@")[0] ?? name);
  const match = byEmail.find((c) => c.email === email);
  if (match) {
    contactCache.set(authUserId, match.id);
    return match.id;
  }

  const created = await contactStore.create({
    name,
    phone,
    email,
    role: "contact",
    tags: ["widget"],
  });
  contactCache.set(authUserId, created.id);
  return created.id;
}

async function orchestratorUserIdForContact(
  contactId: string,
  authUserId: string,
  contactStore: IContactStore
): Promise<string> {
  const contact = await contactStore.getById(contactId);
  return contact?.phone ?? `widget:${authUserId}`;
}

// --- Orchestrator wiring ---

export function buildWidgetOrchestrator(contactStore: IContactStore): Orchestrator {
  if ((process.env.USE_MOCK_ORCHESTRATOR ?? "") === "true") {
    return buildMockOrchestrator(contactStore);
  }
  return buildProductionOrchestrator({ contactStore });
}

// --- Server factory ---

export type AuthenticateFn = (
  req: IncomingMessage
) => Promise<WidgetRequestContext | { status: 401; reason: AuthReason }>;

export interface WidgetServerDeps {
  supabaseUrl: string;
  supabasePublishableKey: string;
  liveKitManager?: ILiveKitRoomManager;
  orchestrator?: Orchestrator;
  contactStore?: IContactStore;
  port?: number;
  authenticateFn?: AuthenticateFn;
  ffmpegAvailable?: boolean;
}

export function createWidgetServer(deps: WidgetServerDeps): {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createWidgetRoom: (options: AgentDispatchOptions) => Promise<LiveKitRoomDetails | { degraded: true }>;
} {
  const port = deps.port ?? DEFAULT_PORT;
  const contactStore = deps.contactStore ?? defaultContactStore;
  const orchestrator = deps.orchestrator ?? buildWidgetOrchestrator(contactStore);

  const authClient = createClient(deps.supabaseUrl, deps.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const liveKitBreaker = getCircuitBreaker("livekit-widget");
  const lkManager = deps.liveKitManager;
  let ffmpegAvailable = deps.ffmpegAvailable ?? false;
  const pendingRoomWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

  function clearRoomWatchdog(roomName: string): void {
    const timer = pendingRoomWatchdogs.get(roomName);
    if (timer) {
      clearTimeout(timer);
      pendingRoomWatchdogs.delete(roomName);
    }
  }

  function armRoomWatchdog(roomName: string): void {
    clearRoomWatchdog(roomName);
    const timer = setTimeout(() => {
      logger.warn({ room: roomName, event: "no-agent-pickup" }, "Voice agent did not join room within 15s");
      pendingRoomWatchdogs.delete(roomName);
    }, AGENT_PICKUP_TIMEOUT_MS);
    pendingRoomWatchdogs.set(roomName, timer);
  }

  function isAgentParticipant(kind: string | number | undefined): boolean {
    return kind === 2 || kind === 4 || kind === "AGENT" || kind === "agent";
  }

  const authenticate: AuthenticateFn =
    deps.authenticateFn ??
    (async (req) => {
      const header = req.headers.authorization;
      if (!header) return { status: 401, reason: "missing" };
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) return { status: 401, reason: "malformed" };
      const { data, error } = await authClient.auth.getUser(match[1]);
      if (error || !data.user) return { status: 401, reason: "expired" };
      return { userId: data.user.id, user: data.user };
    });

  async function createWidgetRoom(options: AgentDispatchOptions): Promise<LiveKitRoomDetails | { degraded: true }> {
    if (!lkManager) return { degraded: true };
    try {
      return await liveKitBreaker.execute(() => lkManager.createWidgetRoom(options));
    } catch (error: unknown) {
      if (error instanceof CircuitBreakerOpenError) return { degraded: true };
      throw error;
    }
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse, ctx: WidgetRequestContext): Promise<void> {
    await otelTracer.startActiveSpan("widget.chat", async (span) => {
      span.setAttribute("channel", "widget");
      try {
        const raw = await readBody(req);
        const parsed = ChatRequestSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          const tooLong = parsed.error.issues.some((i) => i.path.includes("message"));
          if (tooLong) {
            sendJson(res, 400, { error: "message too long", maxChars: 4000 });
            return;
          }
          sendJson(res, 400, { error: "invalid request" });
          return;
        }

        const { sessionId, message } = parsed.data;
        const contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        ctx.contactId = contactId;
        const session = getOrCreateSession(sessionId, contactId);
        const orchestratorUserId = await orchestratorUserIdForContact(contactId, ctx.userId, contactStore);
        const timestamp = new Date().toISOString();

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let cacheHit = false;
        for await (const chunk of orchestrator.processIntentStream({
          sessionId,
          userId: orchestratorUserId,
          channel: "widget",
          message,
          timestamp,
        })) {
          if (chunk.metadata?.cacheHit) cacheHit = true;
          if (chunk.text) {
            writeSse(res, { type: "token", content: chunk.text });
          }
          if (chunk.done) break;
        }

        writeSse(res, { type: "done", sessionId, turnIndex: session.turnIndex });
        session.turnIndex += 1;
        session.lastActive = new Date();
        span.setAttribute("cache_hit", cacheHit);
        res.end();
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        } else {
          res.end();
        }
      } finally {
        span.end();
      }
    });
  }

  async function handleAudio(req: IncomingMessage, res: ServerResponse, ctx: WidgetRequestContext): Promise<void> {
    const clipStartedAt = Date.now();
    await otelTracer.startActiveSpan("widget.audio", async (span) => {
      span.setAttribute("channel", "widget");
      try {
        if (!ffmpegAvailable) {
          sendJson(res, 503, { error: "audio unavailable", degraded: true, fallback: "text" });
          return;
        }

        const upload = await parseAudioUpload(req);
        const sessionParsed = z.string().uuid().safeParse(upload.sessionId);
        if (!sessionParsed.success || upload.audio.length === 0) {
          sendJson(res, 400, { error: "invalid request" });
          return;
        }

        if (!isAllowedAudioMime(upload.mimeType)) {
          sendJson(res, 415, {
            error: "unsupported audio type",
            accepted: [...ALLOWED_AUDIO_MIME],
          });
          return;
        }

        const sessionId = sessionParsed.data;
        const contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        ctx.contactId = contactId;
        const session = getOrCreateSession(sessionId, contactId);
        const orchestratorUserId = await orchestratorUserIdForContact(contactId, ctx.userId, contactStore);
        const timestamp = new Date().toISOString();

        const pcm = await transcodeToRaw(upload.audio, 24_000);
        const cartesiaKey = process.env.CARTESIA_API_KEY ?? "";
        const transcriber = new CartesiaClipTranscriber({ apiKey: cartesiaKey });
        await transcriber.sendPCMChunks(pcm);
        const transcript = await transcriber.finalize();

        span.setAttribute("transcript_length", transcript.length);
        span.setAttribute("clip_duration_ms", Date.now() - clipStartedAt);

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        writeSse(res, { type: "transcript", content: transcript });

        let cacheHit = false;
        for await (const chunk of orchestrator.processIntentStream({
          sessionId,
          userId: orchestratorUserId,
          channel: "widget",
          message: transcript,
          timestamp,
        })) {
          if (chunk.metadata?.cacheHit) cacheHit = true;
          if (chunk.text) {
            writeSse(res, { type: "token", content: chunk.text });
          }
          if (chunk.done) break;
        }

        writeSse(res, { type: "done", sessionId, turnIndex: session.turnIndex });
        session.turnIndex += 1;
        session.lastActive = new Date();
        span.setAttribute("cache_hit", cacheHit);
        res.end();
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (!res.headersSent) {
          const message = String(error);
          if (message.includes("audio too large")) {
            sendJson(res, 413, { error: "audio too large", maxBytes: MAX_AUDIO_BYTES });
          } else {
            sendJson(res, 500, { error: "Internal server error" });
          }
        } else {
          res.end();
        }
      } finally {
        span.end();
      }
    });
  }

  async function handleCreateRoom(req: IncomingMessage, res: ServerResponse, ctx: WidgetRequestContext): Promise<void> {
    await otelTracer.startActiveSpan("widget.room.create", async (span) => {
      try {
        const raw = await readBody(req);
        const parsed = RoomRequestSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          sendJson(res, 400, { error: "invalid request" });
          return;
        }

        const { sessionId } = parsed.data;
        const contactId = ctx.contactId ?? (await resolveContact(ctx.userId, ctx.user, contactStore));
        ctx.contactId = contactId;
        const session = getOrCreateSession(sessionId, contactId);

        if (session.liveRoomName) {
          sendJson(res, 409, { error: "room already active", roomName: session.liveRoomName });
          return;
        }

        const roomResult = await createWidgetRoom({ contactId, sessionId });
        if ("degraded" in roomResult) {
          sendJson(res, 503, { error: "voice service unavailable", degraded: true, fallback: "clip" });
          return;
        }

        try {
          await persistLiveRoomName(contactId, roomResult.roomName);
        } catch (dbError: unknown) {
          logger.error("Failed to persist live_room_name", { error: String(dbError) });
          if (lkManager) {
            await lkManager.closeRoom(roomResult.roomName).catch(() => undefined);
          }
          sendJson(res, 500, { error: "failed to persist session" });
          return;
        }

        setSessionLiveRoom(sessionId, roomResult.roomName);
        armRoomWatchdog(roomResult.roomName);
        span.setAttribute("room_name", roomResult.roomName);

        sendJson(res, 200, {
          serverUrl: roomResult.serverUrl,
          participantToken: roomResult.participantToken,
          roomName: roomResult.roomName,
        });
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      } finally {
        span.end();
      }
    });
  }

  async function handleDeleteRoom(
    res: ServerResponse,
    ctx: WidgetRequestContext,
    roomName: string
  ): Promise<void> {
    await otelTracer.startActiveSpan("widget.room.delete", async (span) => {
      span.setAttribute("room_name", roomName);
      try {
        const contactId = ctx.contactId ?? (await resolveContact(ctx.userId, ctx.user, contactStore));
        ctx.contactId = contactId;

        let allowed = false;
        for (const [, entry] of sessionRegistry) {
          if (entry.contactId === contactId && entry.liveRoomName === roomName) {
            allowed = true;
            break;
          }
        }
        if (!allowed) {
          sendJson(res, 403, { error: "room not owned by session" });
          return;
        }

        if (lkManager) {
          await liveKitBreaker.execute(() => lkManager.closeRoom(roomName));
        }
        clearRoomWatchdog(roomName);
        const sessionId = findSessionIdByRoomName(roomName);
        if (sessionId) clearSessionLiveRoom(sessionId);
        await clearLiveRoomNameByRoom(roomName);
        res.writeHead(204);
        res.end();
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      } finally {
        span.end();
      }
    });
  }

  async function handleLiveKitWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await otelTracer.startActiveSpan("livekit.webhook", async (span) => {
      try {
        if (!lkManager) {
          sendJson(res, 503, { error: "webhook handler unavailable" });
          return;
        }

        const body = await readBody(req);
        const authHeader = req.headers.authorization ?? "";
        let event;
        try {
          event = await lkManager.verifyWebhook(body, authHeader);
        } catch (error: unknown) {
          logger.warn("LiveKit webhook verification failed", { error: String(error) });
          sendJson(res, 401, { error: "invalid webhook signature" });
          return;
        }

        span.setAttribute("event_type", event.event);
        const roomName = event.room?.name;
        if (roomName) span.setAttribute("room_name", roomName);

        if (event.event === "room_started" && roomName) {
          armRoomWatchdog(roomName);
        } else if (event.event === "participant_joined" && roomName && isAgentParticipant(event.participant?.kind)) {
          clearRoomWatchdog(roomName);
        } else if (event.event === "room_finished" && roomName) {
          clearRoomWatchdog(roomName);
          const sessionId = findSessionIdByRoomName(roomName);
          if (sessionId) clearSessionLiveRoom(sessionId);
          await clearLiveRoomNameByRoom(roomName);
        }

        sendJson(res, 200, { ok: true });
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (!res.headersSent) {
          sendJson(res, 500, { error: "webhook processing failed" });
        }
      } finally {
        span.end();
      }
    });
  }

  let server: Server | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (!applyCors(req, res)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return;
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (method === "POST" && path === "/livekit/webhook") {
        await handleLiveKitWebhook(req, res);
        return;
      }

      if (method === "POST" && path === "/widget/chat") {
        const auth = await authenticate(req);
        if ("status" in auth) {
          sendJson(res, 401, { error: "invalid token", reason: auth.reason });
          return;
        }
        const ctx: WidgetRequestContext = auth;
        const contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        ctx.contactId = contactId;
        const rate = checkRateLimit(contactId, path);
        if (!rate.allowed) {
          sendJson(res, 429, { error: "rate_limit_exceeded", retryAfterMs: rate.retryAfterMs });
          return;
        }
        await handleChat(req, res, ctx);
        return;
      }

      if (method === "POST" && path === "/widget/audio") {
        const auth = await authenticate(req);
        if ("status" in auth) {
          sendJson(res, 401, { error: "invalid token", reason: auth.reason });
          return;
        }
        const ctx: WidgetRequestContext = auth;
        const contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        ctx.contactId = contactId;
        const rate = checkRateLimit(contactId, path);
        if (!rate.allowed) {
          sendJson(res, 429, { error: "rate_limit_exceeded", retryAfterMs: rate.retryAfterMs });
          return;
        }
        await handleAudio(req, res, ctx);
        return;
      }

      if (method === "POST" && path === "/widget/room") {
        const auth = await authenticate(req);
        if ("status" in auth) {
          sendJson(res, 401, { error: "invalid token", reason: auth.reason });
          return;
        }
        const ctx: WidgetRequestContext = auth;
        const contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        ctx.contactId = contactId;
        const rate = checkRateLimit(contactId, path);
        if (!rate.allowed) {
          sendJson(res, 429, { error: "rate_limit_exceeded", retryAfterMs: rate.retryAfterMs });
          return;
        }
        await handleCreateRoom(req, res, ctx);
        return;
      }

      if (method === "DELETE" && path.startsWith("/widget/room/")) {
        const roomName = decodeURIComponent(path.slice("/widget/room/".length));
        const auth = await authenticate(req);
        if ("status" in auth) {
          sendJson(res, 401, { error: "invalid token", reason: auth.reason });
          return;
        }
        const ctx: WidgetRequestContext = auth;
        const contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        ctx.contactId = contactId;
        const rate = checkRateLimit(contactId, "/widget/room");
        if (!rate.allowed) {
          sendJson(res, 429, { error: "rate_limit_exceeded", retryAfterMs: rate.retryAfterMs });
          return;
        }
        await handleDeleteRoom(res, ctx, roomName);
        return;
      }

      const auth = await authenticate(req);
      if ("status" in auth) {
        sendJson(res, 401, { error: "invalid token", reason: auth.reason });
        return;
      }

      const ctx: WidgetRequestContext = auth;
      const rateLimitedPaths = ["/widget/audio", "/widget/clip", "/widget/room", "/widget/room-token"];
      if (rateLimitedPaths.includes(path) && method !== "OPTIONS") {
        if (!ctx.contactId) {
          ctx.contactId = await resolveContact(ctx.userId, ctx.user, contactStore);
        }
        const rate = checkRateLimit(ctx.contactId, path);
        if (!rate.allowed) {
          sendJson(res, 429, { error: "rate_limit_exceeded", retryAfterMs: rate.retryAfterMs });
          return;
        }
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error: unknown) {
      logger.error("Widget server request error", { error: String(error) });
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    }
  };

  const start = async (): Promise<void> => {
    ffmpegAvailable = deps.ffmpegAvailable ?? isFfmpegAvailable();
    (globalThis as { ffmpegAvailable?: boolean }).ffmpegAvailable = ffmpegAvailable;
    if (lkManager) {
      await reconcileStaleWidgetRooms(lkManager).catch((error: unknown) => {
        logger.warn("Room reconciliation failed on boot", { error: String(error) });
      });
    }
    return new Promise((resolve, reject) => {
      server = createServer(requestHandler);
      server.on("error", reject);
      server.listen(port, HOST, () => {
        logger.info(`Widget server listening on ${HOST}:${port}`);
        resolve();
      });
    });
  };

  const stop = (): Promise<void> =>
    new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => {
        logger.info("Widget server stopped");
        server = null;
        resolve();
      });
    });

  return {
    get server() {
      if (!server) throw new Error("Widget server not started");
      return server;
    },
    start,
    stop,
    createWidgetRoom,
  };
}

// --- Bootstrap ---

let isShuttingDown = false;

function buildLiveKitManager(): LiveKitRoomAdapter | undefined {
  const serverUrl = process.env.LIVEKIT_URL ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY ?? "";
  const apiSecret = process.env.LIVEKIT_SECRET ?? process.env.LIVEKIT_API_SECRET ?? "";
  if (!serverUrl || !apiKey || !apiSecret) {
    logger.warn("LiveKit env vars incomplete — voice mode degraded");
    return undefined;
  }
  return new LiveKitRoomAdapter({
    serverUrl,
    apiKey,
    apiSecret,
    webhookSecret: process.env.LIVEKIT_WEBHOOK_SECRET ?? apiSecret,
  });
}

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const lkManager = buildLiveKitManager();

if (lkManager) {
  registerWidgetStartupChecks({ liveKitHealthCheck: () => lkManager.healthCheck() });
  registerLiveKitHealthCheck(() => lkManager.healthCheck());
} else {
  registerWidgetStartupChecks();
}
registerCartesiaHealthCheck(() => Boolean(process.env.CARTESIA_API_KEY ?? ""));
registerFfmpegHealthCheck(() => isFfmpegAvailable());

const widgetServer = createWidgetServer({
  supabaseUrl,
  supabasePublishableKey,
  liveKitManager: lkManager,
});

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  await widgetServer.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("widget-server.ts")) {
  registerProductionHealthChecks();
  await runStartupValidation();
  await widgetServer.start();
}

export { widgetServer };
