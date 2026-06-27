# AST Firewall Coverage: Spec Enforcement vs Runtime Requirements

## Overview

This document maps every requirement in our AI CRM spec to the enforcement mechanism: either compile-time via the AST firewall, or runtime (via tests, monitoring, or other means).

---

## Legend

- 🔴 **Required but NOT enforced by AST Firewall**
- 🟡 **Partially enforced by AST Firewall**
- 🟢 **Fully enforced by AST Firewall**

---

## Table of Contents

1. [Operational Requirements (Pillar 1)](#1-operational-requirements-pillar-1)
2. [Development Requirements (Pillar 2)](#2-development-requirements-pillar-2)
3. [Security Requirements (Pillar 3)](#3-security-requirements-pillar-3)
4. [UI Requirements (Pillar 4a)](#4-ui-requirements-pillar-4a)
5. [Deployment Requirements (Pillar 4b)](#5-deployment-requirements-pillar-4b)
6. [SLA Gates (Section V)](#6-sla-gates-section-v)

---

## 1. Operational Requirements (Pillar 1)

| Requirement | AST Coverage | Notes |
|---|---|---|
| Circuit breakers for external adapter calls (3 failures → 30s cooldown) | 🟡 Partial | Rule17 enforces that adapter calls in orchestrator are wrapped in circuit breaker; cannot verify specific failure/cooldown thresholds (runtime) |
| Fallback chains (Neo4j → NoOpGraphRetriever, Gemini → CachedEmbeddingProvider, Gemini → DeepSeekFallbackProvider) | 🔴 None | Cannot verify fallback logic via static analysis (must test at runtime) |
| Dead Letter Queue (DLQ) for failed jobs | 🔴 None | Queue implementation is runtime; static analysis cannot verify DLQ usage |
| Idempotency store (Redis + Supabase fallback) | 🔴 None | Store usage is runtime; Rule16 indirectly helps via port injection |
| All external calls must be wrapped in tracer.startActiveSpan() | 🟡 Partial | Rule14 enforces spans for exported functions in core/ and adapters/ that call external services; cannot verify 100% coverage for internal calls |

---

## 2. Development Requirements (Pillar 2)

| Requirement | AST Coverage | Notes |
|---|---|---|
| Hybrid hexagonal architecture: Orchestrator depends only on port interfaces (core/ports.ts), never concrete adapters | 🟢 Full | Rule16 enforces NO direct adapter instantiation in core/ directory |
| All network boundaries must be wrapped in Zod schema parse (fetch, webhook, realtime, websocket) | 🟢 Full | Rule3 (fetch — ancestor + sibling-parse fallback) + Rule18 (Supabase Realtime .on()) |
| AI output must pass through sanitizer (validateAndFilterOutput / sanitizeOutput) before storage or return | 🟡 Partial | Rule10 enforces sanitizer exists in file with AI output; cannot verify sanitizer correctness |
| Port interfaces exist for all adapters (IContactStore, IDealStore, ICallStore, ITicketStore, IAccountStore, IGraphRetriever, IEmbeddingProvider, IAgentProvider, ICacheStore, IIdempotencyStore, IDeadLetterQueue) | 🔴 None | File existence check possible, but not structural (not needed since we build them from scratch) |
| All exported Zod schemas must have constraints (.max() on strings, .min() + .max() on numbers) | 🟢 Full | Rule1 |
| No z.any().parse() / z.unknown().safeParse() bypassing validation | 🟢 Full | Rule2 |
| No "any" type or "as any" assertion | 🟢 Full | Rule15 |
| Mastra tools must follow contract: id slug, description ≥ 20 chars, inputSchema | 🟢 Full | Rule11 |
| Mastra agents must have maxSteps set (1–10) to prevent infinite loops | 🟢 Full | Rule12 |

---

## 3. Security Requirements (Pillar 3)

| Requirement | AST Coverage | Notes |
|---|---|---|
| PII fields (contacts.phone, contacts.email, calls.transcript_json, user_sessions.messages) must use AES‑256‑GCM encryption with HKDF key derivation | 🟡 Partial | Rule19 enforces `createCipheriv("aes-256-gcm")`; cannot verify HKDF or correct usage (key management, etc.) |
| Supabase RLS policies for all tables: admin (all), agent (limited), viewer (read-only), service role bypass | 🔴 None | RLS policies are SQL in migrations, not TypeScript; Rule8 only detects supabase.rpc() patterns that look like bypass, not full policy coverage |
| Audit logs for all sensitive changes | 🔴 None | Audit logging is runtime/DB-level |
| No API keys, secrets in logs, errors, or OpenTelemetry attributes | 🟢 Full | Rule5 (console.error/logger.*) + Rule13 (span.setAttribute/span.addEvent) |
| Neo4j Cypher queries use parameterized syntax only ($key, not ${key}) | 🟢 Full | Rule7 |
| Embedding distance queries use native PG vector operators (<=> / <->), not JS‑side computation | 🟢 Full | Rule9 |

---

## 4. UI Requirements (Pillar 4a)

| Requirement | AST Coverage | Notes |
|---|---|---|
| UI uses React? No (spec says Vite + Vanilla TS + Motion One) | 🔴 Not part of scope for v3 | N/A |
| Asymmetric grid layout (65/35), magnetic cards, radar border glow | 🔴 None | UI visual specs are runtime/dom-level; no AST enforcement |
| No heavy framework dependencies | 🔴 None | Could add, but not part of current rules |

---

## 5. Deployment Requirements (Pillar 4b)

| Requirement | AST Coverage | Notes |
|---|---|---|
| Startup validator checks all dependencies at boot | 🔴 None | Startup logic is runtime |
| /health endpoint returns 200 when healthy | 🔴 None | Runtime endpoint |
| /ready endpoint returns 503 when dependencies down | 🔴 None | Runtime endpoint |

---

## 6. SLA Gates (Section V)

| Requirement | AST Coverage | Notes |
|---|---|---|
| RAG triad (Faithfulness ≥ 0.90, Answer Relevance ≥ 0.85, Context Precision ≥ 0.85) measured via DeepEval | 🔴 None | Evaluation is runtime/test-time only |
| P95 WhatsApp latency ≤ 2.0s | 🔴 None | Telemetry-only (Grafana alert) |
| P95 voice latency ≤ 1.5s | 🔴 None | Telemetry-only (Grafana alert) |
| Grafana Cloud budget ≤ 2000 metric series, ≤ 5GB traces/month | 🔴 None | Monitoring-only |

---

## Summary

- **🟢 Fully covered by v3 AST rules**: 14 requirements (all structural safety/arch constraints)
- **🟡 Partially covered**: 5 requirements (circuit breaker, span coverage, sanitizer presence, crypto algorithm)
- **🔴 Not covered**: 16 requirements (runtime behavior, visual UI, SLA metrics, RAG evaluation, startup checks, DB policies)

The AST firewall acts as a **compile‑time structural safety net**, catching regressions and anti-patterns early. Runtime requirements are enforced via tests, monitoring, and pre-commit scripts.

