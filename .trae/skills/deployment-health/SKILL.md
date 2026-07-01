---
name: deployment-health
description: >-
  Defines the startup configuration validator and health/readiness endpoint
  requirements. Use when setting up deployment pipelines, container
  orchestration, or adding new external dependencies that require boot-time
  validation and runtime health checks.
---

# Deployment & Health

## Startup Configuration Validator (config/startup-validator.ts)

**Checks run sequentially at boot (all must pass before accepting traffic):**
1. All required env vars present (Zod `parseEnv()`)
2. Supabase connectivity (`SELECT 1`)
3. Neo4j connectivity (`CALL db.ping()`)
4. Redis connectivity (`PING`)
5. Gemini API key validity (one lightweight embedding call)
6. BullMQ queue reachable
7. Ollama reachable (if `LOCAL_LLM_URL` is set — `GET /api/tags`)

Each check retries 3 times with 1s backoff.
Any failure → `process.exit(1)` with structured JSON error.
All pass → `report()` logs JSON success summary.

## Health Endpoints (health/health-router.ts)

**Port:** 8280 (dedicated, separate from main app)

| Endpoint | Purpose | Response |
|---|---|---|
| `GET /health` | Liveness | `200 { status: "ok" }` |
| `GET /ready` | Readiness | `200` healthy. `503 { failures: [...] }` degraded |

**Ready check details:**
- Supabase: `SELECT 1` (timeout 2s)
- Neo4j: `CALL db.ping()` (timeout 2s, cached 10s)
- Redis: `PING` (timeout 1s, cached 5s)
- Gemini: cached from startup (re-validated every 60s)
- Circuit breakers: all closed/half-open = healthy; any open = degraded

**Container orchestration behavior:**
- `/health` fails → container killed and restarted
- `/ready` fails → traffic not routed (graceful degradation without restart)
- Both endpoints served on same Bun.serve instance

## Env Schema (config/env-schema.ts)

```ts
export const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  // Neo4j
  NEO4J_URI: z.string().url(),
  NEO4J_USER: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  // AI
  GEMINI_API_KEY: z.string().startsWith("AIza"),
  DEEPSEEK_API_KEY: z.string().startsWith("sk-"),
  // Voice
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_SECRET: z.string().min(1),
  CARTESIA_API_KEY: z.string().startsWith("sk-"),
  // WhatsApp
  WHATSAPP_API_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_ID: z.string().min(1),
  // Telemetry
  OTEL_SERVICE_NAME: z.string().default("ai-crm"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  // Redis
  REDIS_URL: z.string().url(),
  // Encryption
  ENCRYPTION_MASTER_KEY: z.string().length(64), // 32-byte hex
});
```

## Telemetry Budget (Grafana Cloud Free Tier)

**Ceilings (to stay well under free tier limits):**
- **Active metrics:** ≤ 2000 series (of 10 000 free)
- **Trace volume:** ≤ 5 GB/month (of 50 GB free; use 10 % head‑based sampling; configured in `config/otel-bootstrap.ts` via `PeriodicExportingMetricReader` at 60s)
- **Log volume:** ≤ 2 GB/month (WARN + only, structured JSON, no stack traces)
- **Collection interval:** 60 s (no shorter)
- **Spans per request:** ≤ 8 (1 per orchestrator step, enforced by firewall Rule 14)

**Budget alerts via OTel + Grafana:**
- `crm.telemetry.metrics_active` gauge → current active metric series
- `crm.telemetry.traces_bytes` counter → monthly trace data volume
- Thresholds: 80 % ceiling → WARN log; 95 % ceiling → ERROR log + page.
