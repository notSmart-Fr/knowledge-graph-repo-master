# Aura Demo Guide — Graph RAG + LiveKit Voice

Two demos to run in an interview. Each shows a different strength of the architecture.

---

## Demo A: Graph RAG Retrieval

**What it proves:** The system doesn't just return similar products — it understands relationships.
Collections, attributes, and paired items are discovered through graph traversal, not flat vector matching.

**Runtime:** ~30 seconds | **Dependencies:** Postgres, Redis, seeded catalog

### Steps

```powershell
# 1. Ensure infrastructure is up
docker start aura-postgres aura-redis

# 2. Seed the catalog (one-time, or if DB was reset)
pnpm backend:seed

# 3. Run the comparison demo
node --no-warnings --experimental-strip-types scripts/demo-graph-rag.ts
```

### What You See

```
============================================================
QUERY: "Show me wool coats for winter"
============================================================

─── Vector RAG (top-3 by cosine) ───
  • Merino Wool Overcoat (merino-wool-overcoat)
      SKU: MWO-BLK-M | $890.00 | In stock
      SKU: MWO-CHR-L | $890.00 | In stock

─── Graph RAG (seeds + graph traversal) ───
[Product: Merino Wool Overcoat]
  Slug: merino-wool-overcoat
  Description: Premium Italian merino wool...
  Collections: Winter Essentials, Evening Edit
  Attributes: material: Merino Wool | color: Black
  Variants:
    SKU: MWO-BLK-M, Price: $890.00, Available: Yes
    SKU: MWO-CHR-L, Price: $890.00, Available: Yes
  Pairs with: Cashmere Turtleneck, Italian Leather Gloves
```

The top section (vector only) returns flat product + SKU data.
The bottom section (graph) adds **collections, attributes, and paired products** — all discovered from the existing Vendure schema without a separate graph database.

### If Graph Section Is Empty

Your catalog doesn't have collections or facets assigned to products. This is expected on a fresh seed.
Run this in the Vendure admin UI (http://localhost:3000/admin) to populate:
1. Create a Collection ("Winter Essentials")
2. Add products to it
3. Re-run the demo — graph relationships now appear

---

## Demo B: Full WhatsApp Loop with Graph RAG

**What it proves:** End-to-end multi-channel AI — WhatsApp message enters webhook,
gets Zod-validated, queued, processed through the graph-enhanced orchestrator,
and the response is dispatched back to the phone.

**Runtime:** 2-3 minutes setup | **Dependencies:** ngrok, Meta Developer account

### Steps

```powershell
# Start apps (separate terminals)
pnpm backend:dev           # Terminal 1
pnpm storefront:dev        # Terminal 2
node --experimental-strip-types scripts/worker.ts  # Terminal 3

# In another terminal, expose the webhook
ngrok http 5173
```

2. Copy the ngrok HTTPS URL (e.g., `https://abc123.ngrok.io`)
3. Meta Developer Console → WhatsApp → Configuration → Webhook URL: `https://abc123.ngrok.io/api/webhook/whatsapp`
4. Verify token: same as `WHATSAPP_VERIFY_TOKEN` in your `.env` files
5. Send a WhatsApp message to your test number:
   - *"I need an outfit for a dinner event"*
   - *"What goes with the cashmere turtleneck?"*
   - *"Add the merino overcoat to my cart"*

### What Happens (Trace in Jaeger)

```
context-hydration
  ├── vector-match (pgvector cosine)
  ├── graph-expand
  │     ├── graph-hop-1 (collections, facets, variants)
  │     └── graph-hop-2 (paired products)
  └── shopAgent.generate (DeepSeek + tool calls)
```

### What to Show the Interviewer

1. **The trace tree** — shows the system thinking in relationships, not just similarity
2. **The agent tools called** — searchCatalog, exploreProduct, modifyCart
3. **The response quality** — product + collection + paired items, not just a flat list
4. **The architecture point:** "Same pipeline handles WhatsApp, web, and voice — adding Telegram is one adapter class"

---

## Demo C: LiveKit Voice with Graph RAG

**What it proves:** Real-time voice input goes through the same graph-enhanced orchestrator
as WhatsApp — multi-modal, single-source-of-truth architecture.

**Runtime:** 2-3 minutes setup | **Dependencies:** LiveKit Cloud account, ngrok (optional)

### Prerequisites

1. Create a [LiveKit Cloud](https://cloud.livekit.io) project (free tier works)
2. Get: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
3. Get [Deepgram](https://console.deepgram.com) API key for STT
4. Get [Cartesia](https://play.cartesia.ai) API key for TTS

### Env Setup

Add to `scripts/.env`:
```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxx
LIVEKIT_API_SECRET=your-secret
DEEPGRAM_API_KEY=your-deepgram-key
CARTESIA_API_KEY=your-cartesia-key
```

### Steps

```powershell
# Terminal 1: AST guardrails
pnpm verify-agent

# Terminal 2: Vendure
pnpm backend:dev

# Terminal 3: Remix storefront
pnpm storefront:dev

# Terminal 4: Voice agent
node --no-warnings --experimental-strip-types scripts/voice-agent.ts dev
```

Wait for: `[Voice Portal] Real-time audio pipeline online. Listening...`

### Joining the Room

Option 1 — Use LiveKit's demo client:
```
https://meet.livekit.io/custom?liveKitUrl=wss://your-project.livekit.cloud&token=<generate-token>
```

Option 2 — Write a quick HTML page with LiveKit client SDK (5 lines of JS).

Generate a room token using LiveKit's [token generator](https://cloud.livekit.io/projects/p_/api-keys) or CLI:
```powershell
livekit-cli create-token --api-key APIxx --api-secret secretxx --identity my-name --room my-room --valid-for 24h
```

### What to Say

Speak into the microphone. The voice agent:
1. Deepgram STT converts speech to text
2. Text goes to `OrchestratorService.processIntent` — same pipeline as WhatsApp
3. Graph expansion enriches context
4. DeepSeek generates response
5. Cartesia TTS streams reply back as audio

### Pipeline Trace (Jaeger)

Same trace tree as WhatsApp — the `channel` attribute differentiates `whatsapp` from `livekit_voice`:
```
context-hydration
  channel: "livekit_voice"
  ├── vector-match
  ├── graph-expand
  │     ├── graph-hop-1
  │     └── graph-hop-2
  └── shopAgent.generate
```

### What to Show

1. **Speak a query** — *"Show me winter coats"*
2. **Jaeger trace** — shows `channel: livekit_voice` hitting the same orchestrator
3. **Architecture point:** "WhatsApp text and LiveKit voice share the identical pipeline.
   The only difference is the transport layer — an adapter and an audio codec."

---

## Combined Demo Flow (Interview)

**Best order for a 10-minute demo:**

| Minute | What | Why |
|--------|------|-----|
| 0-1 | Show terminal: 5 processes running (backend, storefront, worker, voice, firewall) | Demonstrate multi-process architecture |
| 1-3 | Run `demo-graph-rag.ts` — show before/after output | Prove graph retrieval works |
| 3-5 | Jaeger trace from the demo — expand the span tree | Visual proof of graph hops |
| 5-7 | Send WhatsApp message — show trace in Jaeger | Full distributed loop |
| 7-9 | Speak into LiveKit — show same trace structure | Multi-modal, same pipeline |
| 9-10 | Quick architecture walkthrough | Tie it together |

**One-liner for each demo:**
- Graph RAG: *"Vector search finds the seeds, graph traversal finds the relationships."*
- WhatsApp: *"Webhook validated in Zod, queued in Redis, processed through the graph pipeline."*
- LiveKit: *"Same orchestrator — just a different adapter and an audio codec."*
- Jaeger traces: *"Every span is instrumented — I can see exactly how the system thinks."*

---

## Troubleshooting

| Problem | Check |
|---------|-------|
| Graph section empty in demo | Collections/facets not assigned to products in Vendure admin |
| `ECONNREFUSED 6379` | `docker start aura-redis` |
| `ECONNREFUSED 5432` | `docker start aura-postgres` |
| Embedding errors | `EMBEDDING_API_KEY` set in `apps/storefront/.env` |
| Worker idle, no WhatsApp replies | `scripts/.env` has `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` |
| Voice agent crashes | `scripts/.env` has `LIVEKIT_*`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` |
| No Jaeger traces | `docker start jaeger`, check `:16686` |
| `pnpm backend:seed` fails | Postgres not running or wrong `DB_*` in `apps/backend/.env` |
