# Implementation Plan: AI-Powered CRM Core

**Branch**: `001-ai-crm-core` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-ai-crm-core/spec.md`

## Summary

Build a production-grade AI CRM with hybrid hexagonal architecture. The system converges WhatsApp messaging, realtime voice calls, and a read-only operator dashboard through a single port-based AI orchestrator. Every external boundary (database, graph, AI, cache, messaging) is defined as a TypeScript interface with graceful degradation via circuit breakers and fallback chains. PII is encrypted at rest with AES-256-GCM. The entire system targets free-tier cloud services with strict budget awareness.

**Progress**: Phases 1-2 completed (T001-T022 — WhatsApp orchestrator + Voice agent with Cartesia Sonic). Phases 3-6 pending.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22+ runtime
**Package Manager**: pnpm 11.x (workspace-native, strict module isolation)
**Primary Dependencies**: Mastra (AI agents), OpenTelemetry (observability), Zod (validation), Motion One (dashboard animations), LiveKit (voice), Cartesia (STT + TTS)
**Storage**: Supabase (PostgreSQL + pgvector) for CRM data and semantic cache, Neo4j AuraDB Free for knowledge graph, Upstash Redis for idempotency and BullMQ
**Testing**: `vitest` — zero additional dependencies. Unit tests in `__tests__/` co-located with source. Contract tests verify adapters implement port interfaces.
**Target Platform**: Vercel (deployment) + local Node.js runtime (scripts). Dashboard served as static Vite build.

**Project Type**: Monorepo — `packages/ai-core/` (backend) + `apps/web/` (dashboard) + `scripts/` (workers, seed, validate)

**Performance Goals**: WhatsApp E2E P95 < 2.0s, Voice response P95 < 1.5s, Cache hit path < 200ms, Graph traversal < 500ms

**Constraints**: Free tier budgets — Supabase 500MB, Neo4j 200MB/50K nodes, LiveKit 50GB/month, Grafana Cloud 2K metrics/5GB traces/2GB logs

**Scale/Scope**: 25 contacts, 15 deals, 8 calls, 5 tickets in seed data. 2 transport channels (WhatsApp + Voice). 1 operator dashboard.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Port-Adapter Architecture | **PASS** | All 11 port interfaces in `core/ports.ts`. Orchestrator depends only on interfaces. Adapters in `adapters/` implement ports. Verified by Tasks 1.2, 2.x. |
| II. Graceful Degradation | **PASS** | Circuit breaker in `core/circuit-breaker.ts`. Fallback chain: Ollama → cached response → polite fallback (cloud APIs Gemini/DeepSeek inserted when configured). NoOp retriever for Neo4j degradation. Verified by Task 5.2-5.4 (pending). |
| III. PII Security by Default | **PASS** | AES-256-GCM + HKDF in `adapters/encryption/`. Zero PII in logs/errors via `IntegrationError` PII-strip. `validateAndFilterOutput()` on all AI output. Verified by Tasks 1.3, 1.5, 6.x. |
| IV. Compile-Time Safety (AST Firewall) | **PASS** | 25-rule firewall. `pnpm run check` blocks on violations. Scan paths cover `features/`, `adapters/`, `core/`, `agents/`. Verified by Task 14 (pending re-sweep). |
| V. Observability-Driven Operations | **PASS** | OTel spans per pipeline step (max 8/request). Structured JSON logs with `trace_id`. Health on :8280. Metrics families defined. Verified by Tasks 8, 10. |

**Constitution gates all pass.** No violations. No complexity tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-crm-core/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (from .trae/specs/production-grade-graphrag-core/tasks.md)
```

### Source Code (repository root)

```text
packages/ai-core/src/
├── features/            # CRM vertical slices
│   ├── contacts/        # Contact types, tools ✅
│   ├── deals/           # Deal types, tools ✅
│   ├── accounts/        # Account types, health score ✅
│   ├── tickets/         # Ticket types, tools ✅
│   ├── calls/           # Call types, transcriber, summarizer ✅
│   └── pipeline/        # Pipeline types, analyzer ✅
├── core/                # Shared kernel
│   ├── orchestrator.ts  # Port-based pipeline ⬜
│   ├── ports.ts         # 11 TypeScript interfaces ✅
│   ├── errors.ts        # Typed error hierarchy ✅
│   ├── logger.ts        # Structured JSON logger ✅
│   ├── sanitize.ts      # PII/profanity filter ✅
│   └── circuit-breaker.ts # Circuit breaker wrapper ⬜
├── adapters/            # Concrete implementations
│   ├── supabase/        # CRM stores + pgvector cache ✅
│   ├── neo4j/           # Graph retriever + NoOp fallback ✅
│   ├── ai/              # Gemini, DeepSeek, Ollama providers ✅
│   ├── messaging/       # Redis/Supabase idempotency + BullMQ DLQ ✅
│   └── encryption/      # AES-256-GCM field encryption ⬜
├── agents/              # Mastra agent definitions ⬜
├── config/
│   ├── startup-validator.ts  # Boot-time checks ⬜
│   ├── env-schema.ts    # Zod env schema ✅
│   └── otel-bootstrap.ts # OTel setup ⬜
├── health/
│   ├── health-router.ts # /health + /ready on :8280 ⬜
│   └── health-checks.ts # Per-adapter health checks ⬜
└── index.ts             # Barrel export ✅

apps/web/                # Vite + Vanilla TS dashboard ⬜
scripts/                 # Worker, voice agent, seed, validate ⬜
```

**Structure Decision**: Hybrid hexagonal with vertical feature slices under `features/`. Port interfaces in `core/ports.ts` are the single structural contract. All adapters implement exactly one port. The orchestrator depends only on ports — never on concrete adapter classes.

## Complexity Tracking

> No constitution violations. No entries needed.
