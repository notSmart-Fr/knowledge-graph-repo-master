/**
 * Widget degradation self-check (T061)
 */

import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "vitest";
import { z } from "zod";
import type { Orchestrator } from "../core/orchestrator.js";
import type { IContactStore } from "../core/ports.js";
import { createWidgetServer } from "../../../../scripts/widget-server.js";
import { WIDGET_SELFCHECK_SUPABASE_KEY, WIDGET_SELFCHECK_SUPABASE_URL } from "./widget-chat.selfcheck.config.js";

const JsonHttpResponseSchema = z.object({
  status: z.number(),
  body: z.string(),
});

function mockContactStore(): IContactStore {
  const contact = {
    id: "contact-1",
    name: "Test",
    phone: "widget:user-1",
    email: "test@example.com",
    role: "contact" as const,
    tags: [] as string[],
    createdAt: new Date().toISOString(),
  };
  return {
    getByPhone: async () => contact,
    getById: async (id) => (id === "user-1" || id === "contact-1" ? contact : null),
    search: async () => [contact],
    create: async (c) => ({ ...c, id: "contact-1", createdAt: new Date().toISOString() }),
    update: async (id, fields) => ({ ...contact, id, ...fields }),
  };
}

function mockOrchestrator(): Orchestrator {
  return {
    processIntentStream: async function* () {
      yield { text: "still works", done: false };
    },
  } as unknown as Orchestrator;
}

function httpRequest(
  port: number,
  options: { path: string; method: string; headers?: Record<string, string>; body?: string }
): Promise<z.infer<typeof JsonHttpResponseSchema>> {
  return new Promise((resolve, reject) => {
    const body = options.body ?? "";
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: options.path,
        method: options.method,
        headers: {
          ...options.headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            JsonHttpResponseSchema.parse({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            })
          );
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("degradation selfcheck request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

export async function runWidgetDegradationSelfCheck(): Promise<void> {
  const server = createWidgetServer({
    supabaseUrl: process.env.SUPABASE_URL ?? WIDGET_SELFCHECK_SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? WIDGET_SELFCHECK_SUPABASE_KEY,
    orchestrator: mockOrchestrator(),
    contactStore: mockContactStore(),
    port: 0,
    liveKitManager: undefined,
    authenticateFn: async (req) => {
      const header = req.headers.authorization ?? "";
      if (header.includes("expired-token")) {
        return { status: 401, reason: "expired" };
      }
      return {
        userId: "user-1",
        user: { id: "user-1", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
      };
    },
  });

  await server.start();
  const address = server.server.address();
  assert(address && typeof address === "object");

  const sessionId = "22222222-2222-4222-8222-222222222222";
  const roomBody = JSON.stringify({ sessionId });

  const roomResponse = await httpRequest(address.port, {
    path: "/widget/room",
    method: "POST",
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: roomBody,
  });

  assert.equal(roomResponse.status, 503);
  const roomJson = JSON.parse(roomResponse.body) as {
    error?: string;
    degraded?: boolean;
    fallback?: string;
  };
  assert.equal(roomJson.error, "voice service unavailable");
  assert.equal(roomJson.degraded, true);
  assert.equal(roomJson.fallback, "clip");

  const expiredResponse = await httpRequest(address.port, {
    path: "/widget/chat",
    method: "POST",
    headers: {
      Authorization: "Bearer expired-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId, message: "hello" }),
  });

  assert.equal(expiredResponse.status, 401);
  const expiredJson = JSON.parse(expiredResponse.body) as { reason?: string };
  assert.equal(expiredJson.reason, "expired");

  const chatResponse = await httpRequest(address.port, {
    path: "/widget/chat",
    method: "POST",
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ sessionId, message: "hello" }),
  });

  assert.equal(chatResponse.status, 200);
  assert.match(chatResponse.body, /"type":"token"/);
  assert.match(chatResponse.body, /"type":"done"/);

  await server.stop();
}

describe("widget-degradation selfcheck", () => {
  it("returns 503 for voice without LiveKit, 401 for expired JWT, chat still streams", async () => {
    await runWidgetDegradationSelfCheck();
  });
});
