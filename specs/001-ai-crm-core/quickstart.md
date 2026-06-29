# Quickstart: AI-Powered CRM Core

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Prerequisites

- **Node.js** >= 22.0 — [install](https://nodejs.org)
- **pnpm** >= 11.0 — `npm install -g pnpm`
- **Docker** — for local Supabase (or use Supabase cloud free tier)
- **Supabase CLI** — `pnpm add -g supabase`
- **Git** — for version control

**External accounts (free tier)**:
- Supabase (cloud project + local)
- Neo4j AuraDB Free instance
- Upstash Redis Free instance
- Google AI Studio (Gemini API key)
- DeepSeek API key
- LiveKit Cloud (free tier)
- Cartesia API key (STT + TTS)
- Grafana Cloud Free (optional, for telemetry)

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd knowledge-graph-repo-master
pnpm install

# 2. Start local Supabase (or skip if using cloud)
supabase start

# 3. Configure environment
cp .env.template .env
# Fill in:
#   GEMINI_API_KEY=<your-key>
#   DEEPSEEK_API_KEY=<your-key>
#   ENCRYPTION_MASTER_KEY=<32-byte-hex>
#   SUPABASE_URL=<your-url>
#   SUPABASE_SERVICE_ROLE_KEY=<your-key>
#   NEO4J_URI=<your-uri>
#   NEO4J_USERNAME=neo4j
#   NEO4J_PASSWORD=<your-password>
#   REDIS_URL=<your-redis-url>
#   Optional: LOCAL_LLM_URL (for Ollama fallback)

# 4. Apply database migrations
supabase db push

# 5. Verify core build
pnpm check      # AST firewall — 0 violations required
pnpm test       # Unit + contract tests — 0 failures required
```

## Seed Data

```bash
# Populate Supabase with sample CRM data
pnpm exec tsx scripts/seed.ts
# Expected: 20-30 contacts, 5 accounts, 10-15 deals, 5-8 calls, 3-5 tickets

# Build knowledge graph in Neo4j
pnpm exec tsx scripts/ingest.ts
# Expected: Nodes and relationships created. Verify with:
#   MATCH (n) RETURN labels(n), count(*) — expect 6 label types
```

## Run

### WhatsApp Worker

```bash
pnpm exec tsx scripts/worker.ts
# Listens for WhatsApp webhooks
# Test: curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" \
#   -d '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"value":...
```

### Voice Agent

```bash
pnpm exec tsx scripts/voice-agent.ts
# Connects to LiveKit room
# Test: Join LiveKit room in browser, speak "What are my open deals?"
# Expected: TTS response referencing deal data
```

### Web Dashboard (Dev)

```bash
pnpm dev:web
# Opens http://localhost:5173
# Expected: Dashboard loads with health cards, transcript pane (empty until active call)
```

## Verify

### Run Full Validation

```bash
pnpm validate
# Runs: eval-rag → validate-latency → validate-metrics → validate-sla
# Output: scripts/validate-results.json
# Exit 1 if any gate fails
```

### Check Endpoints

```bash
# Health endpoints (port 8280)
curl http://localhost:8280/health
# Expected: {"status":"ok"}

curl http://localhost:8280/ready
# Expected: {"status":"healthy"} or {"status":"degraded","failures":["neo4j"]}
```

### Test Degradation

```bash
# 1. Stop Neo4j (or use wrong credentials)
# 2. Send WhatsApp message
# 3. Verify response still works (degraded context)
# 4. Check logs: "graph expansion skipped — circuit breaker open"
# 5. GET /ready should return {"status":"degraded","failures":["neo4j"]}
```

### Verify PII Encryption

```bash
# Query Supabase directly (via dashboard SQL editor)
SELECT phone, email FROM contacts LIMIT 1;
# Expected: Both columns contain only AES-256-GCM ciphertext (hex strings)
# These should NOT be readable phone numbers or email addresses
```

## Key Commands

| Command | Purpose |
|---|---|
| `pnpm check` | AST firewall (19 rules, 0 violations required) |
| `pnpm test` | Unit + contract tests (vitest) |
| `pnpm validate` | Full pre-commit pipeline (SLA gates + RAG triad) |
| `pnpm exec tsx scripts/seed.ts` | Populate Supabase with seed CRM data |
| `pnpm exec tsx scripts/ingest.ts` | Build Neo4j knowledge graph from Supabase |
| `pnpm exec tsx scripts/worker.ts` | WhatsApp webhook consumer |
| `pnpm exec tsx scripts/voice-agent.ts` | LiveKit voice agent (Cartesia STT+TTS) |
| `pnpm dev:web` | Dashboard dev server (localhost:5173) |
