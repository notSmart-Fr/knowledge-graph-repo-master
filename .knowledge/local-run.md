# How to Run AI CRM Locally (Path A: Cloud Free Tiers + Ollama)

Everything you need to run the full AI CRM — cloud databases for persistence,
Ollama on your machine for AI. Zero API costs.

---

## What Goes Where

```
┌─────────────────┐       ┌─────────────────────────┐
│  Your Machine   │       │   Cloud (All Free Tier)  │
│                 │       │                          │
│  Ollama         │       │  Supabase (DB + Auth)    │
│  (llama3.2)     │       │  Neo4j AuraDB (Graph)    │
│  (nomic-embed)  │       │  Upstash Redis (Cache)   │
│                 │       │  LiveKit Cloud (Voice)   │
│  Widget server  │       │  Cartesia (STT + TTS)    │
│  Dashboard      │       │  WhatsApp (Messaging)    │
│  Worker         │       │  Grafana Cloud (OTel)    │
│  Voice agent    │       │                          │
│  Health router  │       │                          │
│                 │       │                          │
│  Node.js (app)──┼──────►│  All cloud services      │
└─────────────────┘       └─────────────────────────┘
```

The app code runs on your machine. All infrastructure runs on free cloud tiers.
Only Ollama is local — avoids per-request AI API costs.

---

## All Free Cloud Services (Sign Up)

| Service | What For | Sign Up | Free Tier |
|---|---|---|---|
| **Supabase** | Postgres + pgvector + Auth + Realtime | https://supabase.com | 500MB DB, 2GB bandwidth |
| **Neo4j AuraDB** | Knowledge graph (contact→deal→ticket) | https://console.neo4j.io | 200MB, 50K nodes |
| **Upstash Redis** | Idempotency + BullMQ queues | https://upstash.com | 256MB, 10K cmd/day |
| **LiveKit Cloud** | Voice rooms, WebRTC, agent dispatch | https://cloud.livekit.io | 50GB/month |
| **Cartesia** | STT (speech→text) + TTS (text→speech) | https://play.cartesia.ai | Free credits |
| **Meta/WhatsApp** | Business messaging channel | https://developers.facebook.com | Free sandbox |
| **Grafana Cloud** | Traces, metrics, logs (OpenTelemetry) | https://grafana.com | 50GB traces, 14d retention |

---

## What Runs Locally (No Signup Needed)

| Tool | Version | Install |
|---|---|---|
| Node.js | >= 22 | `winget install OpenJS.NodeJS.LTS` or https://nodejs.org |
| pnpm | >= 11 | `npm install -g pnpm` |
| Ollama | Latest | https://ollama.com |

---

## Step-by-Step Setup

### 1. Install dependencies

```powershell
cd i:\knowledge-graph-repo-master
pnpm install
```

### 2. Pull Ollama models

```powershell
ollama pull llama3.2          # Chat model (~2 GB)
ollama pull nomic-embed-text  # Embedding model (~274 MB, 768-dim)
```

Verify Ollama is running:

```powershell
ollama list
```

### 3. Configure environment

Create `.env` from template and fill in your cloud keys:

```powershell
copy .env.template .env
# Open .env in editor, replace <placeholders> with real keys from the services above
```

Relevant vars to set:
- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` — from Supabase Project Settings → API
- `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` — from Neo4j AuraDB console
- `REDIS_URL` — from Upstash console (click "Redis Rest API" → URL)
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_SECRET` — from LiveKit Cloud → Settings → Keys
- `CARTESIA_API_KEY` — from Cartesia → API Keys
- `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_ID` — from Meta Developer → WhatsApp → API Setup
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — pick any string, match it in Meta webhook config
- `WHATSAPP_WEBHOOK_URL` — your ngrok URL or deployed URL
- `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` — from Grafana → Connections → OpenTelemetry
- `LOCAL_LLM_URL` — already correct (`http://localhost:11434`)
- `ENCRYPTION_MASTER_KEY` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 4. Apply database migrations

```powershell
npx supabase db push
# Applies all 6 migration files in supabase/migrations/
```

**Or** copy/paste the migration SQL files into Supabase Dashboard → SQL Editor and run them manually.

### 5. Seed sample data

```powershell
npx tsx scripts/seed.ts
# Expected: 20-30 contacts, 5 accounts, 10-15 deals

npx tsx scripts/ingest.ts
# Expected: Builds Neo4j graph nodes + edges
```

### 6. Run the firewall check + tests

```powershell
pnpm check    # AST firewall — 0 violations required
pnpm test     # Unit + contract tests — 53 pass required
```

---

## Run the App (4 Terminals)

### Terminal 1: Widget HTTP Server (:8290)

```powershell
npx tsx scripts/widget-server.ts
```

### Terminal 2: Widget UI (build watch)

```powershell
pnpm --filter @dtc/widget dev
```

### Terminal 3: Web Dashboard (:5173)

```powershell
pnpm dev:web
# Opens http://localhost:5173
```

### Terminal 4: Health Router (:8280)

```powershell
npx tsx scripts/health-server.ts
```

---

## Verify

### Health endpoints

```powershell
Invoke-WebRequest http://localhost:8280/health | Select -Expand Content
# → {"status":"ok"}

Invoke-WebRequest http://localhost:8280/ready | Select -Expand Content
# → {"status":"healthy", ...}  or "degraded" if Neo4j still waking up
```

### Widget text chat

```powershell
$BODY = '{"sessionId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","message":"What deals are open?"}'
Invoke-WebRequest -Uri http://localhost:8290/widget/chat -Method POST `
  -ContentType "application/json" -Body $BODY
# SSE stream: "I can see..." from Ollama
```

### Orchestrator smoke test

```powershell
npx tsx scripts/build-production-orchestrator.ts --smoke
# Prints one-sentence response from Ollama
```

---

## Fallback Chain (All Local/Ollama, No Cloud AI)

```
Ollama (chat) ─┬─ OK → response
               └─ FAIL → cached response (degraded)

Ollama (embed) ─┬─ OK → semantic cache works
                └─ FAIL → zero-vector, cache disabled, chat still works

Neo4j ─┬─ OK → full graph context
       └─ FAIL → empty context, chatbot still responds

Redis ─┬─ OK → idempotency dedup
       └─ FAIL → Supabase fallback → at-least-once processing
```

---

## Port Map

| Port | Service | What |
|---|---|---|
| 8280 | Health Router | `/health` + `/ready` |
| 8290 | Widget Server | HTTP/SSE for embedded chat |
| 5173 | Vite Dashboard | Operator read-only dashboard |
| 5180 | Vite Widget | Widget IIFE bundle |
| 11434 | Ollama | Local LLM API |

---

## Running Voice + WhatsApp Locally

Voice and WhatsApp need extra setup for local development:

**LiveKit webhook tunnel** (so widget voice mode works):
```powershell
# Install LiveKit CLI: https://docs.livekit.io/home/cli/
lk dev webhook --url http://localhost:8290/livekit/webhook
```

**WhatsApp ngrok tunnel** (so Meta can reach your webhook):
```powershell
# Install: https://ngrok.com
ngrok http 3000 --domain=<your-static-domain>.ngrok-free.app
```
Then set the ngrok URL as `WHATSAPP_WEBHOOK_URL` in `.env` and in Meta webhook config.

**Voice agent** (run in separate terminal):
```powershell
npx tsx scripts/voice-agent.ts
```

**Worker** (WhatsApp webhook consumer, run in separate terminal):
```powershell
npx tsx scripts/worker.ts
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `supabase db push` can't reach cloud | Use Supabase Dashboard → SQL Editor instead |
| Ollama slow first response | Normal — model loads into RAM (~10-30s) |
| Neo4j timeout on seed/ingest | Check your AuraDB instance is not paused (free tier pauses after ~3 days idle; unpause in console) |
| "No working providers configured" | Make sure `LOCAL_LLM_URL` is set and Ollama is running |
| Tests fail with env errors | Create `.env` file — the lazy env singleton needs it |
