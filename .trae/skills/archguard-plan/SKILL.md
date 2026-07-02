---
name: "archguard-plan"
description: "Generates a concrete plan of ESLint rules, ArchUnit tests, and whitelist files from discover + clarify outputs. Invoke AFTER archguard-clarify, BEFORE archguard-implement."
---

# ArchGuard Plan

Phase 4 of the architectural guard generator. Takes the discover maps + tech context and the clarify decisions, cross-references them, and produces a concrete specification of every rule, ban, and whitelist file.

## Pipeline Position

```
archguard-discover → archguard-clarify → archguard-plan → archguard-implement
                                                   ↑ You are here
```

## Prerequisites

- `.archguard/discover.md` must exist.
- `.archguard/clarify.md` must exist.
- `.archguard/maps/*.json` and `.archguard/tech-context.json` should be used for precise rule generation when available.
- Discover's invariant-derived bans are **auto-included** in the plan — they don't require clarify confirmation. Only ban #10 (Date.now) comes from clarify.

## Procedure

### Step 1: Cross-reference each FM

**Invariant-derived bans first.** These are auto-included from discover. They don't need clarify confirmation.

For each invariant ban from discover that is marked "Active: yes":
- Ban #1 (JSON.parse) → ESLint selector + whitelist
- Ban #2 (any type + as any) → ESLint rule
- Ban #3 (@ts-ignore / @ts-nocheck) → ESLint rule
- Ban #4 (console.log) → ESLint selector + whitelist
- Ban #5 (fetch without signal) → ESLint selector + whitelist (if active)
- Ban #6 (empty catch) → ESLint selector
- Ban #7 (process.exit) → ESLint selector + whitelist (if active)
- Ban #8 (unbounded loops + setInterval) → ESLint selector (if active)
- Ban #9 (process.env) → ESLint selector + whitelist (if active)
- Ban #10 (Date.now) → Only if clarify confirmed option (1). Whitelist from clarify.
- Ban #11 (floating promises) → ESLint rule
- Ban #12 (export *) → ESLint selector
- Ban #13 (mutable module-level state) → ESLint selector

**Then domain + tech context from clarify/discover:**

For each of the 6 Failure Modes, cross-reference discover findings with clarify decisions:

```
FM1 (Trusts Input):
  clarify says: option (1/2/3)
  discover Map A has: [trust boundary categories]
  discover Tech Context Q1 has: [raw escape hatch bans]
  discover Tech Context Q3 has: [trust boundary library bans]
  →
  Generate: ban rules for every entry point in scope, using the weakest tool that can express them.

FM2 (Inverts Dependencies):
  clarify says: option (1/2/3)
  discover Map B has: [layer structure, FM2 candidates]
  discover Tech Context Q4 has: [platform split bans]
  →
  Generate: ArchUnit rules for each cross-boundary direction, ESLint no-restricted-imports if needed.

FM3 (Leaks State):
  clarify says: option (1/2/3)
  clarify sensitive fields: [list]
  discover Map C has: [output surface categories]
  →
  Generate: ESLint selectors banning PII field names in output calls.

FM4 (Ignores Failure):
  clarify says: option (1/2/3)
  discover Map D has: [external call categories]
  discover Tech Context Q2 has: [unbounded default bans]
  discover Tech Context Q5 has: [missing timeout bans]
  →
  Generate: ESLint selectors for empty catch, fetch-without-signal, unbounded constructors.

FM5 (Skips Cleanup):
  clarify says: option (1/2/3)
  discover Map D has: [resource allocation categories]
  →
  Generate: ESLint selectors for process.exit, no-floating-promises, and (if option 1) resource-specific lifecycle rules.

FM6 (Writes Partial State):
  clarify says: option (1/2/3)
  discover Map D has: [FM6 candidates]
  →
  Generate: If option 1, ESLint selector or convention check for multi-mutation without transaction wrapper.
```

### Step 2: Assign each rule to the weakest capable tool

```
ESLint selectors:   Single-node AST pattern bans.
                    "Does this node match a banned shape?"
                    → ban JSON.parse, console.log, fetch without signal, template in query,
                      unbounded constructor, PII identifier in log arg, empty catch body.

ArchUnit:           Import graph / file location rules.
                    "Does this file depend on files it shouldn't?"
                    → inner layer imports outer layer, server imports browser SDK,
                      platform-specific code in wrong directory.

TypeScript config:  Compiler-enforced type constraints.
                    → useUnknownInCatchVariables (FM4),
                      strict: true (FM1 via noImplicitAny),
                      noUncheckedIndexedAccess (FM1).

Whitelist files:    Not a tool — a pattern. Every ban must have exactly one file
                    where the banned primitive is legally wrapped with the safety
                    mechanism (validation, timeout, circuit breaker, sanitization).
```

**Only if a rule cannot be expressed in ESLint + ArchUnit + TypeScript config:** note as ts-morph candidate with justification of why the ban approach doesn't work. This should be rare — prefer banning the unsafe primitive over tracing it.

### Step 3: Generate whitelist files

For every ban, designate exactly one file where the primitive is allowed:

```
Ban: [primitive] globally
Whitelist: [one file path]

The whitelist file's job: wrap the banned primitive with the safety mechanism
that the ban enforces. Examples (paths derived from project structure):
  - fetch() ban → <adapter-layer>/http/safe-fetch.ts
  - JSON.parse ban → <core-layer>/safe-parse.ts
  - <db-driver>.query() ban → <adapter-layer>/<db-name>/parameterized-query.ts
  - AI/LLM output ban → <core-layer>/ai-sanitizer.ts
  - process.exit ban → <core-layer>/graceful-shutdown.ts
```

If a whitelist file doesn't exist yet, mark it as "create new" — implement will create it.

### Step 4: Check for gaps

Review the full set of rules against the 6 FMs:
- If clarify opted in (option 1 or 2) for a FM but zero rules were generated → gap. Flag it.
- If a Tech Context Q1-Q5 ban has no corresponding ESLint/ArchUnit rule → gap.
- If a whitelist file is missing for a ban → gap.

### Step 5: Write the plan

Output to `.archguard/plan.md`:

```markdown
# ArchGuard Plan

## Summary
- Total rules: N
  - ESLint selectors: X
  - ESLint type-aware rules: Y
  - ArchUnit: Z
  - TypeScript config: W
  - ts-morph (if absolutely needed): V
- Total whitelist files: M (existing: P, to create: Q)
- Gaps: R (list if any)

## ESLint Rules

### Invariant-Derived Bans (Auto)
[For each active invariant ban from discover:

**Ban #<N>: <description>**
- Selector: `<ESLint selector>`
- Message: "<Violation message. Include the whitelist file path.>"
- FM: <FM#>
- Whitelist: <path | N/A>
- From: Invariant I.<#>

### no-restricted-syntax selectors (Tech + Domain)
[For each ban that maps to a single-node AST pattern:

**Rule: <description>**
- Selector: `<ESLint selector>`
- Message: "<Human-readable violation message. Include the whitelist file path.>"
- FM: <FM#>
- From: <Tech Context Q# or Map #>

### type-aware rules
[For rules requiring @typescript-eslint type information:
  - no-explicit-any: error → FM4
  - no-floating-promises: error → FM5]

## ArchUnit Rules
[For each dependency direction ban:

**Rule: <description>**
- Expression: `projectFiles().inFolder('<inner>').shouldNot().dependOnFiles().inFolder('<outer>')`
- FM: FM2
- From: Map B

## TypeScript Config
[Changes to tsconfig.json compilerOptions:
  - `useUnknownInCatchVariables: true` → FM4
  - List only options that are NOT already set]

## Whitelist Files

| File | Banned Primitive | Safety Wrapper | FM |
|------|-----------------|----------------|-----|
| <path> | <banned API> | <what the wrapper adds> | <FM#> |

## Hygiene Rules
[Always included alongside invariant bans. Same ESLint config, separate concern.]

| Rule | Value | Justification |
|------|-------|---------------|
| complexity | max 8 | McCabe — defect density threshold |
| max-depth | max 3 | Nesting cognitive load |
| max-lines-per-function | warn 75 | Lipow — defect density after 100 lines |
| @typescript-eslint/no-unused-vars | error | Dead code elimination |

If `knip` is in devDependencies, add a `knip` script entry to the plan notes.

## Gaps
[Any FM opted-in with zero rules, or explain why it's covered by existing mechanisms]
```

## Constraints

- **Do NOT write config files.** This is planning only. Implement writes the files.
- **Prefer bans over traces.** A ban on the unsafe primitive is always simpler than a cross-statement check.
- **One whitelist file per ban.** Not zero, not two. One.
- **Every rule must trace to a FM + discover source.** No floating rules with no provenance.
- **Use the project's actual directory names.** If the project has `domain/` and `infra/`, use those. Not `core/` and `adapters/`.
- If both discover and clarify are missing, abort and tell the user to run the pipeline in order.
