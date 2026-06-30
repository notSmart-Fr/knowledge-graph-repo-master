---
name: ast-firewall
description: >-
  Compile-time security firewall with 19 rules across 7 domains. Enforces Zod boundaries,
  Neo4j parameterization, error PII guards, Supabase RLS, Mastra contracts, circuit breakers,
  port injection, crypto requirements, and type safety. Invoke via `bun check`. Blocks build
  on violations. For planning new rules, use ast-firewall-plan. For implementing rules, use ast-firewall-implement.
---

# AST Firewall

**Source:** `scripts/ast-firewall.ts` — ts-morph AST traversal
**Run:** `bun check` (exit 0 = pass, 1 = blocked)

## 19 Rules by Domain

### Domain A: Zod Boundary Safety (Data-Flow)
1. **Schema Constraints** — Exported `*Schema`: `z.string()` must have `.max()`, `z.number()` must have `.min() + .max()`
2. **Anti-Cheat** — Forbid `z.any().parse()`, `z.unknown().safeParse()`
3. **Boundary Zod Wrap** — Every `fetch()`/`Bun.fetch()` must be Zod-validated. Two-tier check: ancestor `.parse()` in call chain OR sibling `.parse()` on result variable.
18. **WebSocket Boundary** — Realtime event handlers (`supabase.channel.on()`) must Zod.parse() input

### Domain B: Error & Resilience (Correctness + Leakage)
4. **Catch Type-Guard** — Catch vars typed `: unknown`, no empty blocks, `.message` requires `instanceof Error`
5. **Error PII** — Error metadata and `console.error`/`logger.*` must not contain PII identifiers (`phone`, `email`, `transcript`, etc.)
6. **Graceful Shutdown** — Files with `process.exit()` must also register `SIGTERM` + `SIGINT`
17. **Circuit Breaker** — Orchestrator files must wrap adapter calls in circuit breaker; no direct calls

### Domain C: Query Injection & Data Integrity (Correctness)
7. **Neo4j Parameterized** — Cypher strings must use `$param` + params map; no `${}` interpolation or string concat
8. **Supabase RLS** — Files with supabase client must not use raw SQL or `.rpc()` calls that bypass RLS
9. **PG Vector Operator** — Queries on `*_embedding` columns must use native `<=>` or `<->` operator
19. **Crypto Algorithm** — `createCipheriv()` must use `"aes-256-gcm"`; weaker ciphers blocked

### Domain D: AI Pipeline Integrity (Correctness)
10. **Output Sanitization** — Files calling `streamText`/`generateText`/`agent.generate()` must contain sanitizer call
11. **Mastra Tool Contract** — `createTool({})`: `id` is slug, `description` ≥ 20 chars, must have `inputSchema`
12. **Agent Step Ceiling** — `new Agent({})` must have `maxSteps` 1–10

### Domain E: Telemetry & Observability (Leakage + Structural)
13. **Span PII Guard** — OTel `span.setAttribute()` and `span.addEvent()` attributes must not contain PII keys
14. **Span Coverage** — Exported functions in `core/`/`adapters/` calling external services must include `tracer.startActiveSpan()`

### Domain F: Type Safety (Correctness)
15. **No `any`** — Forbid `: any` type annotations AND `as any` type assertions

### Domain G: Architecture Enforcement (Structural)
16. **Port Injection** — `core/` files must NOT instantiate concrete adapters (`new SupabaseStore()` etc.)

## Enforcement Strategy

| Strategy | Rules using it | Description |
|---|---|---|
| **Pattern-based** | 1-5, 7-15, 18, 19 | Detect AST pattern regardless of file location |
| **Location-based** | 6, 8, 9, 14, 16, 17 | Detect pattern only in wrong directory/file |

## Related Artifacts

- [Constitution](file:///i:/knowledge-graph-repo-master/.specify/memory/constitution.md) — source of all enforceable clauses
- [AST Derivation Methodology](file:///i:/knowledge-graph-repo-master/.knowledge/ast-decisions.md) — how rules are derived (5 domains, lazy-agent question, code surface catalog)
- [AST Firewall Coverage](file:///i:/knowledge-graph-repo-master/.knowledge/ast-firewall-coverage.md) — spec→rule coverage map
