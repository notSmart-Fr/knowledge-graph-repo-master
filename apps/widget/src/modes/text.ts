import { store } from "../store.js";
import { handleUnauthorized } from "../auth.js";

export interface SendTextResult {
  ok: boolean;
  error?: "auth" | "rate_limit" | "degraded" | "network";
  retryAfterMs?: number;
}

export async function sendText(
  sessionId: string,
  message: string,
  token: string,
  serverUrl: string
): Promise<SendTextResult> {
  if (store.getState().blocked) {
    return { ok: false, error: "auth" };
  }

  const response = await fetch(`${serverUrl}/widget/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ sessionId, message }),
  });

  if (response.status === 401) {
    await handleUnauthorized(response);
    return { ok: false, error: "auth" };
  }
  if (response.status === 429) {
    const body = (await response.json()) as { retryAfterMs?: number };
    store.rateLimited(body.retryAfterMs ?? 5000);
    return { ok: false, error: "rate_limit", retryAfterMs: body.retryAfterMs };
  }
  if (response.status === 503) {
    store.degraded("text");
    return { ok: false, error: "degraded" };
  }
  if (!response.ok || !response.body) {
    return { ok: false, error: "network" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
        sessionId?: string;
        turnIndex?: number;
      };
      if (payload.type === "token" && payload.content) {
        store.appendToken(payload.content);
      } else if (payload.type === "done") {
        store.done();
      }
    }
  }

  return { ok: true };
}
