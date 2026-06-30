# AST Firewall Implementation Plan — AI CRM

## Source
Derived from `.knowledge/ast-firewall-analysis.md` on 2026-06-30 (7-mechanism extraction, 52 gates, 31 enforceable).

## Summary
- **Gaps to implement**: 6 (1 HIGH, 5 MEDIUM)
- **Deferred**: 6 LOW (naming conventions — function prefixes, port file naming, test file naming, test descriptions, schema file naming, port interface naming)
- **New rules**: Rules 20–25
- **Result**: 19 → 25 rules, domain count unchanged (7 domains A–G)

## Domain Placement & Rule Numbers

| New Rule | Name | Domain | Placement | After |
|---|---|---|---|---|
| Rule 25 | NoFeatureImports | G (Architecture) | HIGH → first in domain after existing Rule 16 | Rule 16 |
| Rule 20 | FetchTimeout | B (Error & Resilience) | MEDIUM | Rule 17 |
| Rule 21 | EnvVarFallback | B (Error & Resilience) | MEDIUM | Rule 20 |
| Rule 22 | NoHardcodedConfig | B (Error & Resilience) | MEDIUM | Rule 21 |
| Rule 24 | AdapterNaming | G (Architecture) | MEDIUM | Rule 25 |
| Rule 23 | StructuredLogs | E (Telemetry) | MEDIUM | Rule 14 |

Rule numbers are assigned top-down by domain, not by priority. HIGH rules go first in their domain, then MEDIUM. Domain G gets 25 before 24 because 25 is HIGH.

## Pre-Implementation

- [X] Task P1: Run `pnpm check` to establish baseline (0 violations expected on existing code)

## Implementation Tasks

### Domain B: Error & Resilience — Add 3 New Rules

- [X] **Task B1: Add Rule 20 (FetchTimeout)** — priority: MEDIUM
  - **Constitutional**: II-a Timeout Standards — "Every external adapter call SHALL respect per-service timeout bounds"
  - **Lazy shortcut**: `fetch(url)` without `AbortController` / `signal` — "it responds in 50ms in dev"
  - **Enforcement**: Pattern-based. Detect `fetch()` calls (including Bun.fetch and property-access variants like `this.client.fetch()`) that lack a `signal` option in the second argument. Flag if no `AbortController`, `AbortSignal.timeout()`, or `signal:` key found in the fetch options object.
  - **Insert after**: Rule 17 (`rule17_CircuitBreaker`) in Domain B
  - **Scope**: All scanned directories (packages/ai-core/src, apps/web/src, scripts/load-env.ts)
  - **Chaos test**: `scripts/chaos-tests/rule20-fetch-no-timeout.ts` — a file with `await fetch("https://api.example.com")` without signal → expect 1 violation

- [X] **Task B2: Add Rule 21 (EnvVarFallback)** — priority: MEDIUM
  - **Constitutional**: II-a (timeout defaults configurable via env vars) + VI (startup validator blocks missing env) — derived: env access without fallback means no startup-time validation
  - **Lazy shortcut**: `process.env.DATABASE_URL` without `?? "postgres://..."` — "it's always set in .env"
  - **Enforcement**: Location-based. Scan for `process.env.` access outside `config/` directory and `env-schema.ts`. Flag any bare `process.env.X` (no `??` / `||` fallback, no `assertExists()` wrapper, no Zod `.parse()` call that would catch the missing value). Allow: `config/`, `*.config.ts`, and `env-schema.ts`.
  - **Insert after**: Rule 20 (`rule20_FetchTimeout`) in Domain B
  - **Scope**: `packages/ai-core/src/` excluding `config/` and `env-schema.ts`
  - **Chaos test**: `scripts/chaos-tests/rule21-env-no-fallback.ts` — `const url = process.env.API_URL;` in a non-config file → expect 1 violation

- [X] **Task B3: Add Rule 22 (NoHardcodedConfig)** — priority: MEDIUM
  - **Constitutional**: Development Standards naming conventions (`*.config.ts`) + Free Tier Budget Awareness (URLs, endpoints, thresholds must be configurable)
  - **Lazy shortcut**: `const SUPABASE_URL = "https://xyz.supabase.co"` in an adapter — "I'll move it to config later"
  - **Enforcement**: Location-based. Flag string literals containing URL patterns (`http://`, `https://`, `ws://`, `wss://`), API key patterns (`api_key`, `apiKey`, `secret`, `password`, `token`, `access_key`), or port numbers (`:5432`, `:6379`, `:7474`, `:7687`) outside `config/` directory and `*.config.ts` files.
  - **Insert after**: Rule 21 (`rule21_EnvVarFallback`) in Domain B
  - **Scope**: `packages/ai-core/src/` excluding `config/` and `*.config.ts`
  - **Chaos test**: `scripts/chaos-tests/rule22-hardcoded-config.ts` — `const URL = "https://api.example.com";` in an adapter → expect 1 violation

### Domain E: Telemetry & Observability — Add 1 New Rule

- [X] **Task E1: Add Rule 23 (StructuredLogs)** — priority: MEDIUM
  - **Constitutional**: V — "All logs MUST be structured JSON with trace_id"
  - **Lazy shortcut**: `console.log("pipeline done")` instead of `logger.info({ pipeline: "done" })` — "I'll add structured logging later"
  - **Enforcement**: Location-based. Flag `console.log`, `console.info`, `console.warn`, `console.debug` in `core/` and `adapters/`. Exclude: `__tests__/`, `scripts/`, `apps/`, and `console.error` (console.error is checked separately by Rule 5 for PII). Allow `console.time/timeEnd` (legitimate profiling).
  - **Insert after**: Rule 14 (`rule14_SpanCoverage`) in Domain E
  - **Scope**: `packages/ai-core/src/core/` and `packages/ai-core/src/adapters/` (exclude `__tests__/`)
  - **Chaos test**: `scripts/chaos-tests/rule23-console-log.ts` — `console.log("done");` in a core file → expect 1 violation

### Domain G: Architecture Enforcement — Add 2 New Rules

- [X] **Task G1: Add Rule 25 (NoFeatureImports)** — priority: HIGH
  - **Constitutional**: Development Standards / Vertical Feature Slice Structure — "The core orchestrator SHALL NOT import from feature directories directly — it depends only on core/ports.ts"
  - **Lazy shortcut**: `import { ContactTools } from "../../features/contacts/tools"` — faster than going through the port interface
  - **Enforcement**: Location-based. For every file in `core/`, scan import declarations. Flag any import whose module specifier path resolves to a `features/` directory. This catches both relative (`../../features/`) and absolute (`features/`) imports. Allow: `core/ports.ts` (it defines the interfaces, not importing features) and `__tests__/` (test files may import features for integration testing).
  - **Insert after**: Rule 16 (`rule16_PortInjection`) in Domain G — placed before Rule 24 because HIGH priority
  - **Scope**: `packages/ai-core/src/core/` excluding `__tests__/`
  - **Edge case**: `core/ports.ts` itself imports nothing from features (type-only imports of feature interfaces would be a design smell but are not enforced here — that's a different architectural concern)
  - **Chaos test**: `scripts/chaos-tests/rule25-feature-import.ts` — `import {} from "../../features/contacts/tools"` in a core file → expect 1 violation

- [X] **Task G2: Add Rule 24 (AdapterNaming)** — priority: MEDIUM
  - **Constitutional**: Development Standards / Naming Conventions — "Adapter files: *.adapter.ts in adapters/<domain>/"
  - **Lazy shortcut**: File named `supabase-contacts.ts` instead of `supabase-contacts.adapter.ts` — "the folder is already named adapters, it's clear enough"
  - **Enforcement**: Location-based. For every file in `adapters/`, check the filename. Flag if it doesn't end in `.adapter.ts`. Allow: barrel files (`index.ts`), type definition files (`types.ts`, `*.types.ts`), test files (`*.test.ts`), and schema files (`*.schema.ts`).
  - **Insert after**: Rule 25 (`rule25_NoFeatureImports`) in Domain G — placed after because MEDIUM priority
  - **Scope**: `packages/ai-core/src/adapters/`
  - **Edge case**: Existing adapter files that don't follow the convention — this is a **warning** for existing files, blocking for new files. Suggested: generate warnings for existing violations, errors for new files (via git diff or manual scope flag). For initial implementation, flag all violations as warnings (exit 0 but report).
  - **Chaos test**: `scripts/chaos-tests/rule24-adapter-naming.ts` — a file at `packages/ai-core/src/adapters/supabase/bad-name.ts` → expect 1 violation

## Post-Implementation

- [X] **Task Z1**: Update file header comment — change "19 Rules, 7 Domains" to "25 Rules, 7 Domains"
- [X] **Task Z2**: Update orchestrator success message — change "19 firewall rules" to "25 firewall rules" (line 1031)
- [X] **Task Z3**: Update `ALL_RULES` array ordering — insert new rules in correct domain positions
- [X] **Task Z4**: Run `pnpm check` — verify 0 violations on the existing codebase
- [X] **Task Z5**: Create chaos test files for all 6 new rules in `scripts/chaos-tests/`
- [X] **Task Z6**: Run `bun scripts/ast-firewall.ts --chaos` — verify all 6 chaos tests catch their intended violations
- [X] **Task Z7**: Update `.knowledge/ast-decisions.md` — add entries for Rules 20–25 with domain, constitutional gate, and enforcement strategy
- [X] **Task Z8**: Update `.knowledge/ast-firewall-analysis.md` — mark all 6 gaps as IMPLEMENTED and update cross-reference table

## Updated ALL_RULES Order

After implementation, `ALL_RULES` should be:
```
  Domain A: rule1, rule2, rule3, rule18       (Zod Boundary Safety)
  Domain B: rule4, rule5, rule6, rule17,
            rule20, rule21, rule22             (Error & Resilience)
  Domain C: rule7, rule8, rule9, rule19        (Query Injection & Data Integrity)
  Domain D: rule10, rule11, rule12             (AI Pipeline Integrity)
  Domain E: rule13, rule14, rule23             (Telemetry & Observability)
  Domain F: rule15                             (Type Safety)
  Domain G: rule16, rule25, rule24             (Architecture Enforcement)
```

## Deferred (LOW Priority)

Implemented when the codebase is ready for naming convention migration:

| Constitutional Gate | Reason Deferred |
|---|---|
| Port files: `*.port.ts` in `core/` | Conflicts with existing `I*Store.ts` naming — needs migration |
| Port interfaces: `I*Store`, `I*Provider`, etc. | Partially enforced by convention; AST redundant with TS structural typing |
| Test files: `*.test.ts` in `__tests__/` | Already followed — warn-only |
| Function prefixes: `get*`/`fetch*`/`handle*`/etc. | Noisy; no security impact |
| Test naming: `should [expected] when [condition]` | Not AST-enforceable for meaning |
| Schema files: `*.schema.ts` next to usage | Partially followed; low drift risk |

## Drift Warnings (Unchanged)

These are existing concerns from the analysis — not new implementation tasks, but reminders:

| Rule | Warning | Action |
|---|---|---|
| Domain B label ("Error & Resilience") | Contains no Resilience rules (currently). After Tasks B1-B3, it WILL contain resilience rules — no rename needed. | ~~Rename~~ — resolved by adding Rules 20-22 |
| Rules 5, 13 (PII patterns) | Regex hardcodes PII field names | Backlog: scan ports.ts for field names, build dynamic PII allowlist |
| Rule 16 (Port Injection) | Adapter name regex uses project-specific prefixes | Update when new providers are added |
| Rule 14 (Span Coverage) | Scope assumes `core/` + `adapters/` directory layout | Revisit if directory layout is refactored |
