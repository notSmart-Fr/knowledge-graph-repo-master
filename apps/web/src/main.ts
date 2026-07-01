// AI CRM Operator Dashboard — entry point.
// Wires the EventTarget state store into the three panel modules.
// Each panel polls its own data source; failures are isolated per US3 acceptance scenario 2 + 4.

import { initAllDownBanner } from "./all-down-banner.js";
import { renderHealthCards } from "./components/health-cards.js";
import { renderTranscriptPane } from "./components/transcript-pane.js";
import { renderCacheCard } from "./components/cache-card.js";
import { startRadarGlow } from "./radar-glow.js";
import { store } from "./store.js";

const root = document.querySelector<HTMLDivElement>("#app")!;

root.innerHTML = `
  <div class="area-transcript" data-zone="transcript"></div>
  <aside class="area-sidebar" data-zone="sidebar">
    <div data-card="health" class="card"></div>
    <div data-card="cache" class="card"></div>
    <div data-card="active-calls" class="card"></div>
    <div data-card="circuit-breakers" class="card"></div>
  </aside>
  <div class="area-contact" data-zone="contact"></div>
`;

// ponytail: contact zone is intentionally minimal — dashboard is read-only and there's no contact picker in the read-only spec.
// Render a placeholder so the bottom-bar layout is honored (per ui-dashboard skill).
const contactZone = root.querySelector<HTMLElement>('[data-zone="contact"]')!;
contactZone.innerHTML = `
  <div style="color:var(--color-text-faint); font-size:12px;">
    Contact context · awaiting selection
  </div>
`;

// ponytail: each panel registers independently. None of them can throw into the others because each render() is wrapped
// in a try/catch-equivalent (the poll() functions catch and dim their own card).
renderHealthCards(root);
renderCacheCard(root);
renderTranscriptPane(root);

initAllDownBanner();
startRadarGlow(root);

// ponytail: expose store for debugging and for the upcoming tests (T029).
if (import.meta.env.DEV) {
  (window as unknown as { __crmStore: typeof store }).__crmStore = store;
}

// no console — structured logging not available in dashboard