---
name: ast-firewall
description: >-
  Runs the 15-rule compile-time security firewall via bun check. Use after any
  code change batch to verify structural compliance across Zod boundaries,
  Neo4j parameterization, error handling, PII guards, Supabase RLS, Mastra
  contracts, and type safety. Blocks the build on violations.
---

# AST Firewall

## Commands

```bash
bun run check           # Full sweep (CI/pre-commit)
bun run check:watch     # File watcher (dev)
bun run check:chaos     # Verify firewall against chaos tests
```

Output: `.gate-results.json` at repo root. Exit 0 = pass, 1 = build blocked.

## 15 Rules by Domain

### Domain A: Zod Boundary Safety
1. **Schema Constraints** — Exported `*Schema`: `z.string()` must have `.max()`, `z.number()` must have `.min() + .max()`
2. **Anti-Cheat** — Forbid `z.any().parse()`, `z.unknown().safeParse()`
3. **Boundary Zod Wrap** — Every `fetch()`/`Bun.fetch()` must be inside `Schema.parse()` or `.safeParse()`

### Domain B: Error & Resilience
4. **Catch Type-Guard** — Catch vars typed `: unknown`, no empty blocks, `.message` requires `instanceof Error`
5. **Error PII** — Error metadata keys must not contain `phone`, `email`, `transcript`, `text`, `password`, `token`
6. **Graceful Shutdown** — Files with `process.exit()` must also register `SIGTERM` + `SIGINT`

### Domain C: Query Injection & Data Integrity
7. **Neo4j Parameterized** — Cypher strings in `session.run()` must not contain `$ {}` or `+ variable`. Must use `{ key: value }` param map
8. **Supabase RLS** — Files importing supabase must not use raw SQL (`pg.query`, `sql\`\``) bypassing RLS
9. **PG Vector Operator** — Queries on `*_embedding` columns must use `<=>` or `<->` operator

### Domain D: AI Pipeline Integrity
10. **Output Sanitization** — Files calling `streamText`/`generateText`/`agent.generate()` must contain `validateAndFilterOutput` or `sanitizeOutput`
11. **Mastra Tool Contract** — `createTool({})`: `id` is alphanumeric slug, `description` >= 20 chars, must have `inputSchema`
12. **Agent Step Ceiling** — `new Agent({})` must have `maxSteps` between 1 and 10

### Domain E: Telemetry
13. **Span PII Guard** — OTel `setAttribute()` keys must not match PII patterns
14. **Span Coverage** — Core pipeline files: every exported async function must contain `startActiveSpan()`

### Domain F: Type Safety
15. **No `any`** — Forbid explicit `: any` type annotations (vars, params, return types, generic type args)

## When to Update the Firewall

- New directory added → add to `resolveSourceFiles()` in `scripts/ast-firewall.ts`
- New tech stack component added → consider new rule if it introduces attack surface
- After updating firewall → run `bun check:chaos` to verify rules still fire correctly
