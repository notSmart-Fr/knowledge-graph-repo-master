/**
 * Widget Server
 *
 * HTTP transport for the embeddable customer chat widget (port 8290).
 *
 * Usage: npx tsx scripts/widget-server.ts
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { createClient, type User } from "@supabase/supabase-js";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { createLogger } from "../packages/ai-core/src/core/logger.js";
import { getCircuitBreaker, CircuitBreakerOpenError } from "../packages/ai-core/src/core/circuit-breaker.js";
import { createOrchestrator, type Orchestrator } from "../packages/ai-core/src/core/orchestrator.js";
import { LiveKitRoomAdapter } from "../packages/ai-core/src/adapters/livekit/livekit-room.adapter.js";
import type { AgentDispatchOptions, ILiveKitRoomManager, IContactStore, LiveKitRoomDetails } from "../packages/ai-core/src/core/ports.js";
import { SupabaseContactStore } from "../packages/ai-core/src/adapters/supabase/contact-store.js";
import { CompositeIdempotencyStore } from "../packages/ai-core/src/adapters/messaging/idempotency.js";
import { registerWidgetStartupChecks } from "../packages/ai-core/src/config/startup-validator.js";
import { registerLiveKitHealthCheck } from "../packages/ai-core/src/health/health-checks.js";

const logger = createLogger("widget-server");
const otelTracer = trace.getTracer("ai-crm-widget-server", "1.0.0");

const DEFAULT_PORT = 8290;
const HOST = "0.0.0.0";
const SESSION_TTL_MS = 30 * 60_000;

const ChatRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

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
}

const sessionRegistry = new Map<string, WidgetSessionEntry>();

export function getOrCreateSession(sessionId: string, contactId: string): WidgetSessionEntry {
  const existing = sessionRegistry.get(sessionId);
  if (existing) {
    existing.lastActive = new Date();
    existing.contactId = contactId;
    return existing;
  }
  const entry: WidgetSessionEntry = { contactId, turnIndex: 0, lastActive: new Date() };
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
  const idempotencyStore = new CompositeIdempotencyStore();
  return createOrchestrator({
    contactStore,
    dealStore: {
      getByContact: async () => [],
      getById: async () => null,
      update: async () => {
        throw new Error("Not implemented");
      },
    },
    accountStore: {
      getById: async () => null,
      getHealthScore: async () => null,
    },
    ticketStore: {
      getByContact: async () => [],
      create: async () => {
        throw new Error("Not implemented");
      },
    },
    graphRetriever: {
      expandFromContact: async () => ({ deals: [], tickets: [], calls: [] }),
      expandFromDeal: async () => ({ deals: [], tickets: [], calls: [] }),
      getStaleDeals: async () => [],
    },
    embeddingProvider: {
      embed: async () => [],
      embedBatch: async () => [],
      lastFallbackUsed: () => false,
    },
    agentProvider: {
      generate: async () => ({
        text: "How can I help you today?",
        metadata: { degraded: false, cacheHit: false, modelUsed: "default" },
      }),
      generateStream: async function* () {
        yield "How can I help you today?";
      },
    },
    cacheStore: {
      check: async () => null,
      store: async () => {},
    },
    idempotencyStore,
  });
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

  let server: Server | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
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

  const start = (): Promise<void> =>
    new Promise((resolve, reject) => {
      server = createServer(requestHandler);
      server.on("error", reject);
      server.listen(port, HOST, () => {
        logger.info(`Widget server listening on ${HOST}:${port}`);
        resolve();
      });
    });

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
  await widgetServer.start();
}

export { widgetServer };
