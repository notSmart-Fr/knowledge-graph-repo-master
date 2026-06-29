// Banner manager for the all-down state (US3 acceptance scenario 4).
// Per spec Clarifications Q3: single non-blocking banner with last-healthy timestamp.
// Listens for readyEndpointAvailable and realtimeAvailable; both false → show banner.

import { store, subscribeToKey } from "./store.js";

const BANNER_ID = "service-unavailable-banner";

export function initAllDownBanner(): void {
  // ponytail: re-evaluate on every state change — banner visibility is derived from two keys.
  const eval_ = () => {
    const s = store.getState();
    const bothDown = !s.readyEndpointAvailable && !s.realtimeAvailable;
    render(bothDown, s.lastHealthyAt);
  };

  subscribeToKey("readyEndpointAvailable", eval_);
  subscribeToKey("realtimeAvailable", eval_);
  subscribeToKey("lastHealthyAt", eval_);

  eval_();
}

function render(visible: boolean, lastHealthyAt?: string): void {
  let el = document.getElementById(BANNER_ID);
  if (!visible) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = BANNER_ID;
    el.className = "banner-unavailable";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.prepend(el);
  }
  const ts = lastHealthyAt ? formatRelative(lastHealthyAt) : "unknown";
  el.textContent = `Service Unavailable — last healthy ${ts}. Panels show last-known state.`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return new Date(iso).toLocaleString();
}