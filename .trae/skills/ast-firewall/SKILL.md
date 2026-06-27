---
name: ast-firewall
description: >-
  Runs the 19-rule compile-time security firewall via bun check. Use after any
  code change batch to verify structural compliance across Zod boundaries,
  Neo4j parameterization, error handling, PII guards, Supabase RLS, Mastra
  contracts, circuit breakers, port injection, crypto requirements, and type safety. Blocks the build on violations.
---

# AST Firewall v3

## Commands

```bash
bun run check           # Full sweep (CI/pre-commit)
bun run check:watch     # File watcher (dev)
bun run check:chaos     # Verify firewall against chaos tests
```

Output: `.gate-results.json` at repo root. Exit 0 = pass, 1 = build blocked.

## 19 Rules by Domain

### Domain A: Zod Boundary Safety
1. **Schema Constraints** — Exported `*Schema`: `z.string()` must have `.max()`, `z.number()` must have `.min() + .max()`
2. **Anti-Cheat** — Forbid `z.any().parse()`, `z.unknown().safeParse()`
3. **Boundary Zod Wrap** — Every `fetch()`/`Bun.fetch()` must be Zod-validated. Uses a two-tier check:
   - **Ancestor** — `.parse()`/`.safeParse()` must wrap `fetch()` in the call chain (e.g. `Schema.parse(await fetch(...).then(r => r.json()))`).
   - **Sibling fallback** — If not an ancestor, the rule walks subsequent statements in the same block looking for `.parse()` whose argument references the fetch result variable or its `.json()` output. Tracks intermediate variables (e.g. `const raw = await r.json(); Schema.parse(raw)`) so the common two-statement pattern is accepted.
18. **WebSocket Boundary** — Realtime event handlers (`supabase.channel.on()`) that access payload/data must Zod.parse() input

### Domain B: Error & Resilience
4. **Catch Type-Guard** — Catch vars typed `: unknown`, no empty blocks, `.message` requires `instanceof Error`
5. **Error PII** — Error metadata keys and console.error/logger.* calls must not contain PII identifiers/keys (`phone`, `email`, `transcript`, etc.)
6. **Graceful Shutdown** — Files with `process.exit()` must also register `SIGTERM` + `SIGINT`
17. **Circuit Breaker** — Orchestrator files must wrap adapter calls in circuit breaker utility; no direct calls without wrapping

### Domain C: Query Injection & Data Integrity
7. **Neo4j Parameterized** — Cypher strings in `session.run()`/`tx.run()` must use `{ key: value }` parameter map only; no string interpolation or concatenation
8. **Supabase RLS** — Files with supabase client must not use raw SQL (`sql\`\``, `pg.query`) or `.rpc()` calls that bypass RLS
9. **PG Vector Operator** — Queries on `*_embedding` columns must use native `<=>` or `<->` distance operator
19. **Crypto Algorithm** — `createCipheriv()` must use `"aes-256-gcm"` explicitly; weaker ciphers/modes are blocked

### Domain D: AI Pipeline Integrity
10. **Output Sanitization** — Files calling `streamText`/`generateText`/`agent.generate()` must contain `validateAndFilterOutput` or `sanitizeOutput`
11. **Mastra Tool Contract** — `createTool({})`: `id` is alphanumeric slug, `description` ≥ 20 chars, must have `inputSchema`
12. **Agent Step Ceiling** — `new Agent({})` must have `maxSteps` between 1 and 10

### Domain E: Telemetry & Observability
13. **Span PII Guard** — OTel `span.setAttribute()` and `span.addEvent()` attributes must not contain PII keys
14. **Span Coverage** — Exported functions in `core/` and `adapters/` that call external services must include `tracer.startActiveSpan()`

### Domain F: Type Safety
15. **No `any`** — Forbid explicit `: any` type annotations AND `as any` type assertions

### Domain G: Architecture Enforcement
16. **Port Injection** — Core directory files (`core/`) must NOT directly instantiate concrete adapters (e.g., `new SupabaseContactStore()`); all adapters must be injected via port interfaces

## When to Update the Firewall

- New directory added → add to `resolveSourceFiles()` in `scripts/ast-firewall.ts`
- New tech stack component added → consider new rule if it introduces attack surface or structural constraint
- After updating firewall → run `bun check:chaos` to verify rules still fire correctly and new rules are tested


