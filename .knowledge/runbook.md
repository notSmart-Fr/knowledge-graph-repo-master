# AURA — Demo Runbook

How to start every process for a local demo, plus common problems.

## Prerequisites

| Dependency | Notes |
|---|---|
| Node.js | >= 20 |
| pnpm | 10.x |
| Postgres | Local `vendure` DB |
| Redis | `localhost:6379` |
| API keys | DeepSeek, Gemini (embedding), Neon (vector cache) |

## Infrastructure (one-time)

```powershell
docker compose up -d
```

Or run containers individually:

```powershell
docker run -d --name aura-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vendure -p 5432:5432 postgres:16
docker run -d --name aura-redis -p 6379:6379 redis:7
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 -p 4317:4317 jaegertracing/all-in-one:latest
```

## Env Setup

```powershell
copy apps\backend\.env.template apps\backend\.env
copy apps\storefront\.env.template apps\storefront\.env
copy scripts\.env.template scripts\.env
```

Minimum keys for a web concierge demo:

| File | Required keys |
|---|---|
| `apps/backend/.env` | `DB_*`, `JWT_SECRET`, `COOKIE_SECRET`, `REDIS_URL=redis://localhost:6379` |
| `apps/storefront/.env` | `VENDURE_API_URL=http://localhost:3000/shop-api`, `SESSION_SECRET`, `DEEPSEEK_API_KEY`, `PAYLOAD_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vendure`, `EMBEDDING_API_KEY`, `SEMANTIC_CACHE_ENABLED=true` |

## First-Time Data

```powershell
pnpm install
pnpm backend:seed
```

## Start (separate terminals, from repo root)

| # | Command | What |
|---|---|---|
| 1 | `pnpm verify-agent` | AST guardrails (recommended) |
| 2 | `pnpm backend:dev` | Vendure on :3000 |
| 3 | `pnpm storefront:dev` | Remix on :5173 |
| 4 | `node --experimental-strip-types scripts/worker.ts` | WhatsApp worker |
| 5 | `node --experimental-strip-types scripts/voice-agent.ts dev` | Voice agent |

Terminals 4 and 5 are optional — only needed for WhatsApp or voice demos.

## Test the Pipeline

**Graph RAG (before/after comparison):**
```powershell
node --experimental-strip-types scripts/demo-graph-rag.ts
```
Full guide: [`.knowledge/demo-guide.md`](.knowledge/demo-guide.md)

**RAG evaluation (Recall@3 / MRR):**
```powershell
node --experimental-strip-types scripts/eval-rag.ts
```

**Semantic cache:**
```powershell
node --experimental-strip-types scripts/test-cache-cycle.ts
```
Expect: `--- TEST CYCLE SUCCESSFUL ---`

**Web concierge:**
1. Open http://localhost:5173
2. Click the concierge widget
3. Try: *"Search the catalog for minimalist jackets"*

## Telemetry (optional)

1. Start Jaeger (Docker command above)
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces` in `apps/storefront/.env`
3. Restart storefront
4. Open http://localhost:16686 — look for `context-hydration` and `rate-limiter` spans

## WhatsApp Demo

Extra keys needed:

| File | Keys |
|---|---|
| `apps/storefront/.env` | `WHATSAPP_APP_SECRET` |
| `scripts/.env` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |

Also set `WHATSAPP_VERIFY_TOKEN` (same value in both `apps/backend/.env` and `apps/storefront/.env`).

Expose your webhook (ngrok): `ngrok http 5173` → Meta Developer Console → Webhook URL: `https://<tunnel>/api/webhook/whatsapp`

Flow: Meta POST → Remix webhook → BullMQ → worker.ts → Orchestrator → Meta Graph API reply

## Voice Demo

Extra keys in `scripts/.env`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`

Join the configured LiveKit room, speak, expect TTS reply.

## Shutdown

Ctrl+C in each terminal, then:
```powershell
docker stop jaeger aura-redis aura-postgres
```

## Common Failures

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 6379` | Redis not running | Start Redis |
| `ECONNREFUSED 5432` | Postgres not running | Start Postgres |
| Embedding errors | Missing `EMBEDDING_API_KEY` | Set in `apps/storefront/.env` |
| Concierge 500 | Missing `DEEPSEEK_API_KEY` | Set in `apps/storefront/.env` |
| Empty catalog | DB not seeded | `pnpm backend:seed` |
| Worker idle, no replies | Queue empty or wrong keys | Check webhook delivery + `scripts/.env` |
| No traces | Collector down | Start Jaeger, check env var |
