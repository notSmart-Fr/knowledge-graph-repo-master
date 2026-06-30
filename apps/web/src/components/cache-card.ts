// Cache health card + active-calls card.
// Both poll /ready for derived metrics. Per spec Clarifications Q1: cache health uses /ready polling.
// Active-calls panel uses derived state from /ready (Q4: active = chunks.length > 0 AND summary IS NULL).
// If /ready is down, the card dims but does not throw (US3 acceptance scenario 2).

import { z } from "zod";
import { store, subscribeToKey, type CacheMetrics, type ActiveCall } from "../store.js";

const POLL_INTERVAL_MS = 30_000;
const READY_URL = "/api/ready";

export function renderCacheCard(root: HTMLElement): void {
  const card = root.querySelector<HTMLElement>('[data-card="cache"]');
  const activeCallsCard = root.querySelector<HTMLElement>('[data-card="active-calls"]');
  if (!card || !activeCallsCard) return;

  // Initial render.
  render(card, activeCallsCard, store.getState().cache, store.getState().activeCalls);

  subscribeToKey("cache", (cache) => render(card, activeCallsCard, cache, store.getState().activeCalls));
  subscribeToKey("activeCalls", (calls) => render(card, activeCallsCard, store.getState().cache, calls));

  const cachePayloadSchema = z.object({
    cache: z.object({
      hitRate: z.number(),
      totalRequests: z.number(),
      totalHits: z.number(),
      lastStoreAt: z.string().optional(),
      modelDistribution: z.record(z.string(), z.number()),
    }).optional(),
    activeCalls: z.array(z.object({
      id: z.string(),
      contactId: z.string(),
      contactName: z.string(),
      direction: z.enum(["inbound", "outbound"]),
      startedAt: z.string(),
      chunkCount: z.number(),
    })).optional(),
  });

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(READY_URL, { method: "GET", signal: AbortSignal.timeout(5_000) });
      if (!res.ok) {
        render(card, activeCallsCard, store.getState().cache, store.getState().activeCalls, true);
        return;
      }
      const body = cachePayloadSchema.parse(await res.json());
      if (body.cache) store.setState("cache", body.cache);
      if (body.activeCalls) store.setState("activeCalls", body.activeCalls);
    } catch (_e: unknown) {
      render(card, activeCallsCard, store.getState().cache, store.getState().activeCalls, true);
    }
  };

  void poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

function render(
  card: HTMLElement,
  activeCallsCard: HTMLElement,
  cache: CacheMetrics | null,
  activeCalls: ActiveCall[],
  stale = false
): void {
  // ponytail: SC-004 requires cache hit rate >=30%; we surface this with a clear threshold call-out.
  const hitPct = cache ? Math.round(cache.hitRate * 100) : null;
  const meetsThreshold = hitPct !== null && hitPct >= 30;

  card.innerHTML = `
    <h3>Semantic Cache</h3>
    <div class="value">
      ${hitPct !== null ? `${hitPct}%` : "—"}
      <span style="font-size:12px; color:${meetsThreshold ? "var(--color-status-healthy)" : "var(--color-status-degraded)"};">
        ${meetsThreshold ? "✓ ≥30%" : "✗ <30%"}
      </span>
    </div>
    <div class="meta">
      ${cache ? `${cache.totalHits}/${cache.totalRequests} hits` : "no data"}
      ${cache?.lastStoreAt ? ` · last store ${formatRelative(cache.lastStoreAt)}` : ""}
    </div>
    ${cache?.modelDistribution ? renderModelPie(cache.modelDistribution) : ""}
  `;
  card.dataset.stale = stale ? "true" : "false";

  activeCallsCard.innerHTML = `
    <h3>Active Calls</h3>
    <div class="value">${activeCalls.length}</div>
    <div class="meta">derived: chunks.length > 0 AND summary IS NULL</div>
    <ul style="list-style:none; padding:0; margin:8px 0 0 0; font-size:12px; max-height:120px; overflow:auto;">
      ${activeCalls
        .slice(0, 5)
        .map(
          (c) => `
        <li style="padding:2px 0;">
          <span style="color:var(--color-text-faint);">${c.direction === "inbound" ? "←" : "→"}</span>
          ${escapeHtml(c.contactName)}
          <span style="color:var(--color-text-faint); float:right;">${c.chunkCount} chunks</span>
        </li>`
        )
        .join("")}
    </ul>
  `;
  activeCallsCard.dataset.stale = stale ? "true" : "false";
}

// ponytail: tiny SVG pie — no chart library needed for ~4 model slices.
function renderModelPie(distribution: Record<string, number>): string {
  const entries = Object.entries(distribution).filter(([, n]) => n > 0);
  if (entries.length === 0) return "";

  const total = entries.reduce((s, [, n]) => s + n, 0);
  const colors = ["#22c55e", "#3b82f6", "#eab308", "#a855f7", "#ef4444"];
  let cumulative = 0;
  const slices = entries
    .map(([model, n], i) => {
      const start = (cumulative / total) * 360;
      cumulative += n;
      const end = (cumulative / total) * 360;
      return { model, start, end, color: colors[i % colors.length] };
    })
    .map(
      (s) => `
      <path d="${arcPath(s.start, s.end)}" fill="${s.color}" opacity="0.8"></path>
      <title>${s.model}: ${((s.end - s.start) / 360 * 100).toFixed(0)}%</title>`
    )
    .join("");

  return `
    <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-label="Cache model distribution">
        <circle cx="18" cy="18" r="15.9" fill="var(--color-surface)" stroke="var(--color-border)" />
        ${slices}
      </svg>
      <div style="font-size:10px; color:var(--color-text-faint);">
        ${entries.map(([m], i) => `<div><span style="color:${colors[i % colors.length]};">●</span> ${m}</div>`).join("")}
      </div>
    </div>
  `;
}

function arcPath(startDeg: number, endDeg: number): string {
  // ponytail: inline SVG arc — full circle if 100%, otherwise pie slice.
  if (endDeg - startDeg >= 359.9) return "M18,2.1 a15.9,15.9 0 1,0 0,31.8 a15.9,15.9 0 1,0 0,-31.8";
  const start = polar(18, 18, 15.9, startDeg);
  const end = polar(18, 18, 15.9, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M18,18 L${start.x},${start.y} A15.9,15.9 0 ${large},1 ${end.x},${end.y} Z`;
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}