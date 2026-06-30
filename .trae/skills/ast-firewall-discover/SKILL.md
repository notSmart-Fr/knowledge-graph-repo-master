---
name: "ast-firewall-discover"
description: "Discover AST firewall rules from constitution for a NEW project (no existing firewall). Reads constitution, classifies quality gates using 5 safety domains, asks the lazy-agent question, produces full rule catalog. Invoke for greenfield projects or when adding ast-firewall to a project that doesn't have one yet."
---

# AST Firewall Discover

## Purpose

For a **new project** with no existing `scripts/ast-firewall.ts`: read the constitution and produce a complete catalog of AST-enforceable rules. Do NOT write any code — discovery only. Output goes to `.knowledge/ast-firewall-analysis.md`.

**Do NOT use this on a project that already has `scripts/ast-firewall.ts`** — use `/ast-firewall-analyze` instead.

## Inputs

Read these files (absolute paths from repo root):

1. **REQUIRED**: The project's constitution file — typically `.specify/memory/constitution.md`, or wherever the project keeps its constitution
2. **IF EXISTS**: `AGENTS.md` or `README.md` — for tech stack context (helps identify code surfaces)

## Methodology (self-contained)

### The Five Safety Domains

Classify every quality gate into one of five domains. The domain tells you what kind of violation pattern to look for:

| Domain | What it guards | Pattern to scan for |
|---|---|---|
| **Data-Flow** | Data crosses trust boundary unvalidated | Data enters the process (HTTP, WebSocket, files, env vars, DB reads, AI/model output) and isn't schema-validated before use |
| **Structural** | Architecture, dependency direction, mandatory wrappers | Required wrapper/pattern missing: no tracing, no error boundary, no lifecycle handler, wrong import location, concrete dependency in wrong layer |
| **Leakage** | Sensitive data in export channels | Sensitive-named variable/logged in console, structured logger, telemetry spans, error metadata, API responses |
| **Correctness** | Wrong algorithm, value, or constraint | Wrong algorithm variant, unbounded input, injection-vulnerable interpolation, type escapes, empty error handlers, missing required config fields |
| **Resilience** | Missing safety nets: timeouts, cleanup, loop bounds, config fallbacks | External call without timeout/abort, unbounded loop, env var without default, hardcoded values in wrong location, resource allocation without release |

### The Lazy-Agent Question

For each classified gate, ask:

> "If an AI agent were taking the SHORTEST path to working code, what shortcut would violate this rule?"

This is how you find violation patterns without prerequisite codebase knowledge. Examples:

| Gate | Lazy Shortcut |
|---|---|
| "Validate all external data at boundary" | Skip schema validation — data "looks fine" |
| "Use the designated cipher" | Copy-paste a weaker cipher from a search result |
| "Parameterize all database queries" | Template literal/string interpolation — it's shorter |
| "Agent/worker must have iteration limit" | Omit the limit config — happy path is 2 steps |
| "All schemas must have constraints" | Unbounded type — test data is always small |
| "No type escapes" | Cast to escape-hatch type to silence an error |
| "Core depends only on interfaces" | Instantiate concrete impl directly — faster than DI |
| "Every critical path must be traced" | Skip the tracing wrapper — function works without it |
| "All output must be sanitized" | Return raw result — no bad data in test fixtures |
| "Handle shutdown signals" | Just exit — works in dev, breaks in prod |
| "All external calls must have timeouts" | No abort signal — "it responds fast in dev" |
| "Config values must have defaults" | Env var without fallback — "always set in .env" |
| "Loops must have a bound" | Unbounded loop without counter — "condition will become false" |
| "Resources must be released" | Constructor without cleanup call — "GC handles it" |
| "No hardcoded configuration" | URL/secret literal in business logic — "I'll move it" |
| "No sensitive data in telemetry" | Debug value in span — "useful for debugging" |
| "Every write must be idempotent" | No idempotency key — "duplicates never happen" |
| "No empty error handlers" | Empty catch block — "this error never occurs" |

### Location-Based Enforcement

When you can't detect what code *means*, enforce where the pattern *may appear*:

| Can't detect... | But CAN detect... |
|---|---|
| "Is this an adapter?" | `new Something()` in a directory that should only contain interfaces |
| "Is this a secret?" | String literal matching secret patterns outside the config directory |
| "Is this PII?" | Variable named with PII keywords passed to logging/export functions |
| "Will this loop run forever?" | Unbounded loop construct without a named iteration counter |
| "Is this a valid schema?" | Schema bypass pattern (catch-all type used as validator) |
| "Is this a required config value?" | Config access without a fallback default, outside the config directory |

Patterns that can be checked structurally regardless of file location are **pattern-based** (e.g., `catch (e) {}` → flag everywhere). Patterns where location matters are **location-based** (e.g., `process.env.X` without `??` is fine in `config/`, flagged elsewhere).

## Outline

### Phase 1: Extract Constitutional Quality Gates

Read the constitution. Extract every quality gate. A "quality gate" is ANY statement that says what code SHOULD or SHOULD NOT do, expressed through any of these mechanisms:

1. **Imperative clauses** — "X MUST Y", "X SHALL Y", "X MUST NOT Y", "X is FORBIDDEN"
2. **Declarative rules** — "Dependencies point INWARD", "Never the reverse", "X is FORBIDDEN except documented exceptions"
3. **✅/❌ diagrams** — explicit permission/prohibition rules (e.g., "✅ Application → Core", "❌ Core → Framework")
4. **Quality Gates tables** — any table with a "Rule"/"Requirement" column (e.g., "No any types | < 5 allowed")
5. **"Rule | Implementation" tables** — any table with a "Rule" column (e.g., "All errors must be typed | Custom error classes")
6. **Naming convention tables** — explicit file/class/function naming patterns (e.g., "Adapter files | *.adapter.ts")
7. **Architecture definitions** — "What lives here:" sections that declare directory roles

For each extracted gate, normalize it to a single sentence: what pattern must or must not exist in code.

Ignore:
- Purely aspirational statements ("The best code is the code never written")
- Explanations/rationale sections
- Version history
- Governance/amendment process (unless it contains enforceable compliance rules)

### Phase 2: Filter AST-Enforceable Gates

For each gate, ask: **"Can a junior dev look at the source code and see this violation without running the program?"**

| Answer | Action |
|---|---|
| Yes | Proceed to Phase 3 |
| No | Mark "NOT AST-ENFORCEABLE" with reason (runtime metric, infrastructure concern, human process) |

Examples of NOT enforceable: "P95 latency ≤ 2s" (runtime metric), "Must pass code review" (human process), "Deployment health-check-gated" (infrastructure concern).

### Phase 3: Classify into Safety Domains

For each enforceable gate, classify into one of the five domains above.

### Phase 4: Ask the Lazy-Agent Question

For each classified gate, generate the violation pattern using the lazy-agent question.

### Phase 5: Map to Code Surfaces and Enforcement Strategy

For each violation pattern, identify the code surface it applies to. Determine:
- **Pattern-based**: detect the AST pattern regardless of file location
- **Location-based**: scope by directory path and/or file naming convention from the constitution

### Phase 6: Produce Rule Catalog

Output to `.knowledge/ast-firewall-analysis.md`:

```markdown
# AST Firewall Analysis — [Project Name]

## Summary
- Constitutional gates: N total, M enforceable
- Proposed rules: X

## Constitutional Gates

| # | Gate | Section | Domain | Lazy Shortcut | Enforcement |
|---|---|---|---|---|---|
| 1 | ... | I.X | Data-Flow | ... | Pattern-based |
| 2 | ... | II.Y | Structural | ... | Location-based (core/) |

## NOT AST-Enforceable

| Gate | Reason |
|---|---|
| "P95 ≤ 2s" | Runtime metric |

## Rules by Domain

### Domain A: Data-Flow
- Rule A1: [name] — [gate] — [shortcut]

### Domain B: Structural
- Rule B1: [name] — [gate] — [shortcut]
... (one section per domain)
```

## Output

`.knowledge/ast-firewall-analysis.md` — full rule catalog. No code written.

## Next Step

`/ast-firewall-plan` → `/ast-firewall-implement`
