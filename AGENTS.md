# AI CRM — Architecture Reference

## Stack
- **Runtime:** Bun 1.3+
- **Data:** Supabase (pgvector) + Neo4j AuraDB Free
- **AI:** Gemini (embedding), Mastra (agents), DeepSeek (fallback)
- **Voice:** LiveKit + Cartesia
- **Messaging:** BullMQ (Redis), WhatsApp API
- **Telemetry:** OpenTelemetry → Grafana Cloud Free

## Architecture
```
Transport (WhatsApp / Voice / Web)
  → Orchestrator (depends on ports)
      → IContactStore →    Supabase adapter
      → IGraphRetriever →   Neo4j adapter  │  NoOp (degraded)
      → IEmbeddingProvider → Gemini         │  Cached (degraded)
      → IAgentProvider →     Mastra         │  DeepSeek (degraded)
      → IIdempotencyStore → Redis           │  Supabase (fallback)
      → IDeadLetterQueue →  BullMQ
```

## Directory Layout
```
packages/ai-core/src/
├── features/      — CRM vertical slices (contacts, deals, accounts, tickets, calls, pipeline)
├── core/          — ports.ts, orchestrator.ts, errors.ts, logger.ts, sanitize.ts
├── adapters/      — supabase/, neo4j/, ai/, messaging/, encryption/
├── agents/        — Mastra agent definitions (crm-agent, call-summarizer, live-assist, pipeline-analyzer)
├── config/        — startup-validator.ts, env-schema.ts
└── health/        — health-router.ts, health-checks.ts
```

## Key Files
| File | Purpose |
|---|---|
| `.trae/rules/project_rules.md` | Behavioral constraints (lazy senior dev mode) |
| `.trae/skills/` | On-demand skills for specific domains |
| `.trae/specs/production-grade-graphrag-core/` | Full spec, task list, checklist |
| `scripts/ast-firewall.ts` | 15-rule compile-time security firewall |
