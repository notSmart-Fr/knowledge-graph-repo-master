// Health status cards panel.
// Polls /ready every 30s (per spec Clarifications 2026-06-29 Q1).
// Renders per-adapter status: green=healthy, yellow=degraded, dimmed=circuit_open, red=down.
// Panel NEVER blocks other panels — failures are isolated (US3 acceptance scenario 2).

import { z } from "zod";
import { store, subscribeToKey, type AdapterHealth, type AdapterStatus } from "../store.js";

const POLL_INTERVAL_MS = 30_000;
// In dev, vite proxies /api/ready to backend. In prod, the same path is served by the dashboard host.
const READY_URL = "/api/ready";

export function renderHealthCards(root: HTMLElement): void {
  const card = root.querySelector<HTMLElement>('[data-card="health"]');
  const breakersCard = root.querySelector<HTMLElement>('[data-card="circuit-breakers"]');
  if (!card || !breakersCard) return;

  // Initial render from store, in case state was populated before this panel mounted.
  render(card, breakersCard, store.getState().adapters, store.getState().circuitBreakers);

  subscribeToKey("adapters", (adapters) => render(card, breakersCard, adapters, store.getState().circuitBreakers));
  subscribeToKey("circuitBreakers", (breakers) => render(card, breakersCard, store.getState().adapters, breakers));

  // Mark lastHealthyAt as long as the endpoint is reachable.
  const markHealthy = () => {
    store.patchState({ readyEndpointAvailable: true, lastHealthyAt: new Date().toISOString() });
  };
  markHealthy();

  // ponytail: separate failure handler keeps the panel from throwing on poll errors.
  // US3 acceptance scenario 2 requires this panel to dim without affecting others.
  const readyPayloadSchema = z.object({
    status: z.enum(["healthy", "degraded"]),
    failures: z.array(z.string()),
    timestamp: z.string(),
    adapters: z.array(z.object({
      name: z.string(),
      status: z.enum(["healthy", "degraded", "down", "circuit_open"]),
      latencyMs: z.number(),
      lastChecked: z.string(),
      circuitBreakerState: z.string().optional(),
      error: z.string().optional(),
    })).optional(),
    circuitBreakers: z.array(z.object({
      name: z.string(),
      state: z.enum(["closed", "open", "half-open"]),
      openedAt: z.string().optional(),
      consecutiveFailures: z.number(),
    })).optional(),
  });

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(READY_URL, { method: "GET", signal: AbortSignal.timeout(5_000) });
      if (!res.ok) {
        store.patchState({ readyEndpointAvailable: false });
        render(card, breakersCard, store.getState().adapters, store.getState().circuitBreakers, true);
        return;
      }
      const body = readyPayloadSchema.parse(await res.json());
      markHealthy();
      ingestReadyPayload(body);
    } catch (_e: unknown) {
      store.patchState({ readyEndpointAvailable: false });
      render(card, breakersCard, store.getState().adapters, store.getState().circuitBreakers, true);
    }
  };

  // Poll immediately on mount, then every 30s.
  void poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

interface ReadyPayload {
  status: "healthy" | "degraded";
  failures: string[];
  timestamp: string;
  // When the backend extends /ready with per-adapter details, those flow in here.
  adapters?: Array<{
    name: string;
    status: AdapterStatus;
    latencyMs: number;
    lastChecked: string;
    circuitBreakerState?: string;
    error?: string;
  }>;
  circuitBreakers?: Array<{
    name: string;
    state: "closed" | "open" | "half-open";
    openedAt?: string;
    consecutiveFailures: number;
  }>;
}

function ingestReadyPayload(body: ReadyPayload): void {
  const adapters: AdapterHealth[] = (body.adapters ?? []).map((a) => ({
    name: a.name,
    status: a.status,
    latencyMs: a.latencyMs,
    lastChecked: a.lastChecked,
    circuitBreakerState: a.circuitBreakerState,
    error: a.error,
  }));

  const breakers = body.circuitBreakers ?? [];

  store.patchState({
    overallHealth: body.status === "healthy" ? "healthy" : "degraded",
    adapters,
    circuitBreakers: breakers,
  });
}

function render(
  card: HTMLElement,
  breakersCard: HTMLElement,
  adapters: AdapterHealth[],
  breakers: { name: string; state: string; consecutiveFailures: number }[],
  stale = false
): void {
  card.innerHTML = `
    <h3>Service Health</h3>
    <div class="value">
      <span class="dot" data-status="${store.getState().readyEndpointAvailable ? aggregateStatus(adapters) : "down"}"></span>
      ${store.getState().readyEndpointAvailable ? aggregateStatus(adapters) : "unavailable"}
    </div>
    <div class="meta">${adapters.length} adapters · polled every 30s</div>
    <ul style="list-style:none; padding:0; margin:8px 0 0 0; font-size:12px; max-height:120px; overflow:auto;">
      ${adapters
        .map(
          (a) => `
        <li style="display:flex; justify-content:space-between; padding:2px 0;">
          <span><span class="dot" data-status="${a.status}"></span>${a.name}</span>
          <span style="color:var(--color-text-faint); font-family:var(--font-mono);">${a.latencyMs}ms</span>
        </li>`
        )
        .join("")}
    </ul>
  `;
  card.dataset.stale = stale ? "true" : "false";

  breakersCard.innerHTML = `
    <h3>Circuit Breakers</h3>
    <div class="value">${breakers.filter((b) => b.state === "open").length} open</div>
    <div class="meta">${breakers.length} registered</div>
    <ul style="list-style:none; padding:0; margin:8px 0 0 0; font-size:12px; max-height:120px; overflow:auto;">
      ${breakers
        .map(
          (b) => `
        <li style="display:flex; justify-content:space-between; padding:2px 0;">
          <span><span class="dot" data-status="${b.state === "open" ? "circuit_open" : "healthy"}"></span>${b.name}</span>
          <span style="color:var(--color-text-faint); font-family:var(--font-mono);">${b.state}</span>
        </li>`
        )
        .join("")}
    </ul>
  `;
}

function aggregateStatus(adapters: AdapterHealth[]): AdapterStatus {
  if (adapters.some((a) => a.status === "down")) return "down";
  if (adapters.some((a) => a.status === "degraded" || a.status === "circuit_open")) return "degraded";
  return "healthy";
}