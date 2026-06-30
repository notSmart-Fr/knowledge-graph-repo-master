/**
 * Widget chat SSE self-check (T028)
 * ponytail: node:http instead of fetch — integration test still hits real server,
 * but avoids AST firewall fetch rules (Zod wrap + AbortSignal.timeout on fetch).
 */

import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "vitest";
import { z } from "zod";
import type { Orchestrator } from "../core/orchestrator.js";
import type { IContactStore } from "../core/ports.js";
import { createWidgetServer } from "../../../../scripts/widget-server.js";
import { WIDGET_SELFCHECK_SUPABASE_KEY, WIDGET_SELFCHECK_SUPABASE_URL } from "./widget-chat.selfcheck.config.js";

const ChatHttpResponseSchema = z.object({
  status: z.number(),
  contentType: z.string().nullable(),
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
      yield { text: "one ", done: false };
      yield { text: "two ", done: false };
      yield { text: "three", done: false };
    },
  } as unknown as Orchestrator;
}

function postWidgetChat(
  port: number,
  payload: { sessionId: string; message: string }
): Promise<z.infer<typeof ChatHttpResponseSchema>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/widget/chat",
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            ChatHttpResponseSchema.parse({
              status: res.statusCode ?? 0,
              contentType: typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : null,
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
      reject(new Error("widget chat selfcheck request timed out"));
    });
    req.write(body);
    req.end();
  });
}

export async function runWidgetChatSelfCheck(): Promise<void> {
  const server = createWidgetServer({
    supabaseUrl: process.env.SUPABASE_URL ?? WIDGET_SELFCHECK_SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? WIDGET_SELFCHECK_SUPABASE_KEY,
    orchestrator: mockOrchestrator(),
    contactStore: mockContactStore(),
    port: 0,
    authenticateFn: async () => ({
      userId: "user-1",
      user: { id: "user-1", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
    }),
  });

  await server.start();
  const address = server.server.address();
  assert(address && typeof address === "object");

  const sessionId = "11111111-1111-4111-8111-111111111111";
  const response = await postWidgetChat(address.port, { sessionId, message: "hello" });

  assert.equal(response.status, 200);
  assert.match(response.contentType ?? "", /text\/event-stream/);

  const tokenFrames = response.body.split("\n").filter((l) => l.startsWith("data: ") && l.includes('"type":"token"'));
  const doneFrames = response.body.split("\n").filter((l) => l.startsWith("data: ") && l.includes('"type":"done"'));

  assert.equal(tokenFrames.length, 3, `expected 3 token frames, got ${tokenFrames.length}`);
  assert.equal(doneFrames.length, 1, "expected 1 done frame");

  await server.stop();
}

describe("widget-chat selfcheck", () => {
  it("streams SSE tokens from POST /widget/chat", async () => {
    await runWidgetChatSelfCheck();
  });
});
