# AST Firewall: Derivation from Constitution

## Purpose

This document answers two questions:

1. **"Given a constitutional principle, how do I know what AST rules to write?"** (universal methodology)
2. **"When an AI agent takes the lazy shortcut, what pattern am I catching?"** (agent-drift framing)

---

## The Five Safety Domains

AST rules don't only guard I/O boundaries. They guard five distinct classes of code-level violations:

| Domain | What It Guards | Example |
|---|---|---|
| **Data-Flow Safety** | Data crossing trust boundaries unvalidated | `fetch()` without `.parse()`, WebSocket payload without Zod |
| **Structural Safety** | Architecture, dependency direction, mandatory wrappers | `new Adapter()` in `core/`, unwrapped adapter calls, no SIGTERM handler |
| **Leakage Safety** | Sensitive data appearing in channels that export it | PII in `console.error()`, PII in `span.setAttribute()` |
| **Correctness Safety** | Wrong algorithm, wrong config, missing constraints | `aes-128-cbc` instead of `aes-256-gcm`, `z.string()` without `.max()`, Agent without `maxSteps` |
| **Resilience Safety** | Missing safety nets: timeouts, cleanup, loop bounds, config fallbacks | `fetch()` without `AbortSignal`, `while(true)` without max, `process.env.X` without `??` fallback |

Every constitutional clause maps to one of these five domains. The domain tells you **what kind of violation pattern to look for**.

**Enforcement strategy for Resilience:** Like the adapter-in-core rule (Rule 16), many Resilience rules work by enforcing *location-based naming conventions*, not intent detection:
- You can't detect "is this a secret?" — but you CAN detect `const KEY = "sk-..."` outside of `config/`
- You can't detect "will this loop run forever?" — but you CAN detect `while(true)` without a named break counter
- You can't detect "is this env var required?" — but you CAN detect `process.env.X` without `??` fallback outside `config/`

---

## The Derivation Pipeline

```
Constitution Principle  →  Safety Domain  →  Quality Gate  →  Lazy-Agent Shortcut  →  Violation Pattern  →  AST Rule
      (what)               (category)          (rule)           (what an AI would do)     (code to catch)      (enforcement)
```

---

## Universal Methodology (No Prerequisite Knowledge Required)

### Step 1: Classify the constitutional clause into a safety domain

| If the constitution says... | Domain | Look for... |
|---|---|---|
| "Validate X at boundary" / "No untrusted data enters Core" | Data-Flow | Paths where data enters the process and isn't schema-validated |
| "Use pattern Y" / "Wrap all Z in W" / "Don't import A from B" | Structural | Missing wrappers, wrong imports, wrong instantiation locations |
| "No PII in logs/telemetry/errors" / "Don't expose X to Y" | Leakage | Sensitive-named variables crossing into log/trace/export calls |
| "Use algorithm X" / "Set constraint Y" / "Never use Z" | Correctness | Wrong function args, missing config fields, unbounded values |
| "All external calls must have timeouts" / "Handle cleanup" / "No hardcoded configs" | Resilience | Missing `signal`/`timeout`, `while(true)` without bound, missing `??` fallback, resource without `.close()` |

This classification tells you what to scan for. You don't need to know the codebase — you need to know the category.

### Step 2: Ask the lazy-agent question

> **"If an AI agent were trying to take the shortest path to working code, what shortcut would violate this rule?"**

This is the most reliable way to find violation patterns without prerequisite domain knowledge:

| Constitutional Clause | Lazy-Agent Shortcut |
|---|---|
| "Validate all external data at boundary" | Skip `.parse()` — the data "looks fine" in testing |
| "Wrap all adapters in circuit breaker" | Call the adapter directly — one less import, one less line |
| "No PII in logs" | `console.error("failed for", phone)` for a quick debug line |
| "Use AES-256-GCM" | Copy-paste `aes-128-cbc` from the first StackOverflow result |
| "Parameterize all Cypher queries" | Template literal `` `MATCH (c) WHERE c.id = ${id}` `` — it's shorter |
| "Agent must have maxSteps ≤ 10" | Omit `maxSteps` — it works fine on the happy path |
| "All schemas must have constraints" | `z.string()` without `.max()` — the test data is always short |
| "No `any` types" | `as any` to silence a type error — "I'll fix it later" |
| "Orchestrator depends only on ports" | `new SupabaseStore()` directly — faster than wiring DI |
| "Every external call must be traced" | Skip `startActiveSpan` — the function works without it |
| "AI output must be sanitized" | Return raw `result.text` — no PII in test data anyway |
| "Tools must have id + description + schema" | Skip `inputSchema` — Mastra doesn't crash without it |
| "No RLS bypass" | `` sql`SELECT * FROM contacts` `` — shorter than `.from().select()` |
| "Use native pgvector operators" | Fetch vectors into JS, compute distance there — works at small scale |
| "Handle SIGTERM/SIGINT" | Just `process.exit()` — works in dev, breaks in production |
| "All external calls must have timeouts" | No `AbortController` / `signal` — "it responds in 50ms in dev" |
| "Env vars must have fallbacks" | `process.env.PORT` without `?? 3000` — "it's always set in .env" |
| "Loops must have a bound" | `while(true)` without break counter — "the condition will eventually be false" |
| "Resources must be cleaned up" | `new Client()` without `.close()` — "GC will handle it" |

Every rule in the firewall is the answer to one of these questions.

### Step 3: Write the violation as a code pattern

For the lazy-agent shortcut identified, write down every syntactic variant the shortcut can take:

```
Shortcut: "Skip .parse() on fetch results"
Patterns:
  const data = await fetch(url)              // direct, no parse
  const res = await fetch(url); res.json()   // two-statement, no parse  
  const raw = await response.json()          // intermediate variable
  await this.client.fetch(url)               // property-access variant
  await Bun.fetch(url)                       // Bun-specific variant
```

### Step 4: Write the AST rule

For each variant: scope to relevant files, traverse the AST for that pattern, flag if the guard is missing.

### Step 5: Document the trace

Link the rule back to the constitutional clause it enforces.

---

## The Code Surface Catalog

This catalog lists every code construct in the TypeScript/Bun/Node stack where a lazy-agent shortcut could violate a constitutional principle. Use it as a checklist when adding new principles.

### Category A: Data-Flow Surfaces (Data enters the process here)

| Surface | How Data Enters | Unvalidated Variant | Guard Pattern |
|---|---|---|---|
| HTTP fetch | `fetch(url)` → `.json()` | No `.parse()` after fetch | `Schema.parse(await (await fetch(url)).json())` |
| WebSocket message | `ws.on("message", data)` | Callback uses `data` raw | `Schema.parse(JSON.parse(data))` |
| Realtime push | `.on("INSERT", payload)` | Handler uses `payload` raw | `Schema.parse(payload.new)` |
| Route handler body | `app.post("/", req => req.body)` | `req.body` used without parse | `Schema.parse(req.body)` |
| File read | `fs.readFileSync()` / `Bun.file()` | `JSON.parse(text)` without schema | `Schema.parse(JSON.parse(text))` |
| CLI arguments | `process.argv[2]` | Used raw | `Schema.parse(args[2])` |
| Environment variables | `process.env.X` | Used raw (missing, wrong format) | `z.string().url().parse(process.env.X)` |
| Message queue job | `worker.process(job)` | `job.data` used without parse | `Schema.parse(job.data)` |
| DB query result | `supabase.from("x").select()` | Rows trusted as-is | `Schema.array().parse(rows)` |
| AI generated text | `generateText()` → `.text` | `.text` returned to user raw | `sanitizeOutput(result.text)` |

### Category B: Structural Surfaces (Architecture, wrappers, dependency direction)

| Surface | Lazy Shortcut | Guard Pattern |
|---|---|---|
| Adapter instantiation | `new SupabaseStore()` in `core/` | Pass via constructor (port injection) |
| Adapter method calls | `this.store.query()` unwrapped | `breaker.invoke(() => this.store.query())` |
| Process exit | `process.exit()` without handlers | `process.on("SIGTERM", handler)` |
| Agent definition | `new Agent({})` without `maxSteps` | `maxSteps: 5` |
| Tool definition | `createTool({})` without schema | `inputSchema: z.object({...})` |
| Config/args validation | CLI args used without schema | Zod parse before use |
| Feature flags | Hardcoded `if (true)` instead of env | `process.env.FLAG === "true"` |

### Category C: Leakage Surfaces (Sensitive data appearing in export channels)

| Channel | Lazy Shortcut | Guard Pattern |
|---|---|---|
| `console.error()` | `console.error("failed:", phone)` | Only log structural attributes, never PII-named vars |
| `logger.info/warn/error()` | `logger.error({ phone, email })` | Same — structural-only keys |
| `span.setAttribute()` | `span.setAttribute("phone", value)` | Check key against PII keyword list |
| `span.addEvent()` | `span.addEvent("msg", { transcript })` | Check event attribute keys and values |
| Error constructors | `new IntegrationError(msg, code, { phone })` | Meta arg must not have PII-named keys |
| API responses | Return raw DB row with PII fields | Strip/sanitize before serialization |

### Category D: Correctness Surfaces (Right algorithm, right config, right constraints)

| Surface | Lazy Shortcut | Guard Pattern |
|---|---|---|
| Zod schema definition | `z.string()` without `.max()` | Must have `.max()` (DoS prevention) |
| Zod schema definition | `z.number()` without bounds | Must have `.min()` + `.max()` |
| Zod bypass | `z.any().parse()` / `z.unknown().safeParse()` | Flagged — no real validation |
| Crypto algorithm | `createCipheriv("aes-128-cbc")` | Must be `"aes-256-gcm"` |
| Cypher query | `` session.run(`MATCH ${id}`) `` | Must use `$param` + params map |
| Raw SQL (Supabase) | `` sql`DELETE FROM contacts` `` | Must use `.from().delete()` with RLS |
| Vector distance | JS-side `Math.sqrt()` on embedding | Must use `<=>` / `<->` operators |
| Type escapes | `as any`, `x: any`, `Promise<any>` | Flagged — type-checker disabled |
| Error catch | `catch (e) {}` or `catch (e: any)` | Must be `catch (e: unknown)` with guard |
| Error property access | `e.message` without `instanceof` check | Must guard with `instanceof Error` |
| AI output return | `return result.text` | Must pass through sanitizer first |
| Tool id format | `id: "My Tool"` | Must be lowercase slug `a-z0-9-` |

### Category E: Resilience Surfaces (Safety nets, cleanup, bounded behavior)

| Surface | Lazy Shortcut | Guard Pattern |
|---|---|---|
| `fetch()` call | No `signal` or `timeout` option | Must pass `AbortSignal.timeout(N)` or `{ signal }` |
| `while(true)` / `for(;;)` | Infinite loop with no break counter | Must have a named iteration counter or `break` after N iterations |
| `process.env.X` | No fallback value — crashes if unset | Must have `?? DEFAULT` fallback, or file is in `config/` directory |
| String literal outside `config/` | Hardcoded URL/secret/key in business logic | String literal matching `http://`, `api_key`, `secret`, `password`, `token` must only appear in `config/` or `*.config.ts` files |
| Resource constructor | `new Client()` / `new Connection()` without cleanup | Must have matching `.close()` / `.destroy()` / `.dispose()` call in same or parent scope |
| `Promise.all()` | Unbounded concurrency — no `p-limit` or `bottleneck` | `Promise.all(arr.map(async ...))` where `arr.length` is unknown at compile time — warn |

---

## Project-Specific Derivation: AI CRM Constitution → AST Rules

Every rule in `scripts/ast-firewall.ts` is derived from a specific constitutional clause, classified by safety domain, and answers a specific lazy-agent shortcut question.

### Domain A: Zod Boundary Safety — Data-Flow Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 1 | Data Integrity gates: "All schemas have runtime validation" | `z.string()` without `.max()` — unbounded input | Exported `*Schema` vars: every `z.string()` must have `.max()`; every `z.number()` must have `.min()` + `.max()` |
| Rule 2 | Data Integrity gates: "Unknown fields rejected" | `z.any().parse()` — "it accepts everything, no more type errors" | Any `.parse()`/`.safeParse()` whose receiver is `z.any()`/`z.unknown()` |
| Rule 3 | Data Integrity: "All external data validated at boundary" | Skip `.parse()` after `fetch()` — "works in testing" | Every `fetch()` must have `.parse()`/`.safeParse()` as ancestor or sibling statement |
| Rule 18 | Same as Rule 3, for push/realtime | Skip `.parse()` in `.on()` callback — "payload looks fine" | Every `.on()`/`.subscribe()` callback body must contain `.parse()`/`.safeParse()` |

### Domain B: Error & Resilience — Structural Safety + Leakage Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 4 | Error handling gates: "No empty catch. Unknown type only." | `catch (e) {}` — "silence the error, ship it" | CatchClause: var must be `: unknown`, body ≥1 stmt, no `as any`, `.message` needs `instanceof Error` guard |
| Rule 5 | III. PII Security: "Zero PII in logs/errors" | `console.error(phone)` for quick debug | All `console.error`/`logger.*`: no PII-named identifiers in args, no PII keys in objects. All domain error constructors: meta arg no PII keys |
| Rule 6 | II. Graceful Degradation: "No dropped requests on shutdown" | `process.exit()` without handlers — "it works in dev" | Any file with `process.exit()`/`Bun.exit()` must also have `process.on("SIGTERM")` + `process.on("SIGINT")` |
| Rule 17 | II. Graceful Degradation: "Every adapter wrapped in circuit breaker" | Call adapter directly — "one less import" | Every `this.*Store.*`/`this.*Provider.*` call in `core/` must have `breaker.invoke()` as ancestor |
| Rule 20 | II-a. Timeout Standards: "Every external adapter call SHALL respect per-service timeout bounds" | No `AbortController`/`signal` on `fetch()` — "it responds in 50ms in dev" | Every `fetch()` in `core/` must pass `{ signal }` in options (narrowed to `core/` for initial deployment) |
| Rule 21 | II-a / VI: env vars must have fallbacks | `process.env.X` without `??` default — "it's always set in .env" | Every `process.env.X` in non-config files must have `??`/`||` fallback or Zod parse ancestor |
| Rule 22 | Naming conventions (`*.config.ts`) + Free tier awareness | Hardcoded URL/key in business logic — "I'll move it to config later" | String literals matching `http(s)://` or known service ports flagged outside `config/` and `*.config.ts` (narrowed to `core/` for initial deployment) |

### Domain C: Query Injection & Data Integrity — Correctness Safety + Leakage Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 7 | Data Integrity: injection prevention | Template literal `` `MATCH ${id}` `` — "it's shorter" | Every `.run()`/`.executeRead()`/`.executeWrite()`: no template interpolation, no string concat, must have params map |
| Rule 8 | III. PII Security: "RBAC + RLS" | `` sql`DELETE FROM contacts` `` — bypasses RLS, one line | Supabase files: flag `.rpc()` bypass patterns, `` sql` ``, `pg.query` |
| Rule 9 | Free tier budget: native pgvector operators | Fetch vectors to JS, compute distance — "works at small scale" | Any file with `_embedding`: must use `<=>` or `<->` |
| Rule 19 | III. PII Security: "AES-256-GCM only" | `aes-128-cbc` from StackOverflow — "it encrypts, right?" | Every `createCipheriv()`: first arg must be `"aes-256-gcm"` |

### Domain D: AI Pipeline Integrity — Correctness Safety + Data-Flow Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 10 | FR-015: "Strip PII/profanity/injection from AI output" | Return raw `result.text` — "no PII in test data" | Files with `streamText`/`generateText`/`agent.generate`: must call function matching `*sanitize*`/`*validate*`/`*filter*` |
| Rule 11 | IV. AST Firewall: tool contracts enforced | Skip `inputSchema` — "Mastra doesn't crash without it" | Every `createTool()`: must have `id` (slug), `description` (≥20 chars), `inputSchema` or `schema` |
| Rule 12 | Free tier budget: agent step ceiling | Omit `maxSteps` — "happy path is 2 steps" | Every `new Agent()`: must have `maxSteps` 1–10 |

### Domain E: Telemetry & Observability — Leakage Safety + Structural Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 13 | V. Observability: "Zero PII in OTel spans" | `span.setAttribute("phone", value)` — "useful for debugging" | Every `span.setAttribute()`/`.addEvent()`: key/attribute names must not match PII pattern |
| Rule 14 | V. Observability: "Every pipeline step traced" | Skip `startActiveSpan` — "function works without it" | Exported functions in `core/`/`adapters/` calling external services: body must contain `startActiveSpan` |
| Rule 23 | V: "All logs MUST be structured JSON with trace_id" | `console.log()` instead of `logger.info()` — "I'll add structured logging later" | `console.log/info/warn/debug` flagged in `core/` (narrowed for initial deployment) |

### Domain F: Type Safety — Correctness Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 15 | 4.1 Type Safety: "No `any` types" | `as any` — "I'll fix the type later" (never does) | All param/variable/property declarations, type args, `as` expressions, return types: no `AnyKeyword` |

### Domain G: Architecture Enforcement — Structural Safety

| Rule | Constitutional Source | Lazy-Agent Shortcut | AST Check |
|---|---|---|---|
| Rule 16 | I. Port-Adapter: "Orchestrator depends only on ports" | `new SupabaseStore()` in orchestrator — faster than DI wiring | Any `NewExpression` in `core/` matching adapter patterns (`*Store`, `*Provider`, Supabase/Neo4j/Gemini prefixed) |
| Rule 25 | Development Standards: "The core orchestrator SHALL NOT import from feature directories directly" | `import {} from "../../features/contacts/tools"` — faster than going through the port | Every import declaration in `core/` must not resolve to a `features/` path |
| Rule 24 | Naming Conventions: "Adapter files: *.adapter.ts in adapters/<domain>/" | File named without `.adapter.ts` suffix — "the folder is already named adapters" | Files in `adapters/` must end in `.adapter.ts` (⚠️ warn-only for existing files during migration) |

---

## What Is NOT AST-Enforceable (and Why)

Some constitutional clauses cannot be checked at compile time:

| Constitutional Clause | Why Not AST-Enforceable |
|---|---|
| "Circuit breaker: 3 failures → open 30s" | Threshold values are runtime state |
| "Cache hit rate ≥ 30%" | Telemetry metric, not code pattern |
| "RAG triad: Faithfulness ≥ 0.90" | Requires live LLM evaluation |
| "All PII encrypted at rest" | Encryption correctness is runtime behavior |
| "Deployment health-gated rollout" | Infrastructure concern |
| "DSAR: deleteByOwner(ownerId)" | Method presence is checkable; implementation correctness is not |
| "Startup validator blocks launch" | Startup is runtime behavior |
| "P95 latency ≤ 2s" | Telemetry metric |
| "Idempotency hit rate ≤ 5%" | Telemetry metric |

---

## How to Add a New AST Rule (Step-by-Step)

When the constitution is amended, follow this checklist:

1. **Read the new clause.** Extract the quality gate.
2. **Classify the domain.** Data-Flow, Structural, Leakage, or Correctness? This tells you where to look.
3. **Check the Code Surface Catalog.** Does the relevant surface already exist in this document? If not, add it.
4. **Ask the lazy-agent question.** "What shortcut would an AI take?"
5. **Write all syntactic variants** of the violation pattern (direct call, property access, aliased import).
6. **Implement the rule.** Scope to minimum files. Use AST traversal. Add to `ALL_RULES`.
7. **Update this document** — add row to the relevant domain table.

### Worked Example: Adding "Idempotency"

**New clause:** "All external write operations MUST use idempotency keys."

**Domain:** Correctness Safety (right pattern: every write must carry an idempotency key)

**Catalog check:** Data-Flow Surfaces — `fetch()` is already listed as a write surface. Add idempotency header as its guard pattern.

**Lazy-agent question:** "What shortcut?" → Omit the `Idempotency-Key` header — the code works without it in testing, duplicates only happen in production.

**Violation patterns:**
```
fetch(url, { method: "POST", body: data })              // missing header entirely
fetch(url, { method: "PUT", headers: {...} })            // has headers but no Idempotency-Key
this.client.post(url, data)                              // custom client, can't see headers
```

**AST rule:** `rule20_IdempotencyKey` — for every `fetch()` with method POST/PUT/PATCH/DELETE: verify the headers config object contains `"Idempotency-Key"` key, OR the call is wrapped in a function named `*idempotent*`/`*withIdempotency*`.

**Domain:** Add to Domain B (Error & Resilience — writes without idempotency cause duplicates under retry).

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-06-30 | Initial: derivation methodology, principle→rule mapping |
| 1.1.0 | 2026-06-30 | Added four safety domains; replaced I/O-only framing with full Code Surface Catalog; added lazy-agent question methodology; added worked idempotency example |
| 1.3.0 | 2026-06-30 | Implemented Rules 20-25: FetchTimeout, EnvVarFallback, NoHardcodedConfig, StructuredLogs, AdapterNaming (warnings), NoFeatureImports. Completed gap analysis from 7-mechanism constitution extraction. |

---

## References

- [Constitution](file:///i:/knowledge-graph-repo-master/.specify/memory/constitution.md) — source of all AST-enforceable clauses
- [AST Firewall Source](file:///i:/knowledge-graph-repo-master/scripts/ast-firewall.ts) — implementation (25 rules, 7 domains)
- [AST Firewall Coverage](file:///i:/knowledge-graph-repo-master/.knowledge/ast-firewall-coverage.md) — spec→rule coverage (complementary: maps to spec requirements)
