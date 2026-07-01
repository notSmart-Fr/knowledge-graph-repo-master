---
name: "archguard-plan"
description: "Generates a concrete plan of ESLint rules, ArchUnit tests, and whitelist files from discover + clarify outputs. Invoke AFTER archguard-clarify, BEFORE archguard-implement."
---

# ArchGuard Plan

Phase 4 of the architectural guard generator. Takes the discover maps and the clarify answers, cross-references them, and produces a concrete specification of every rule, ban, and whitelist file.

## Pipeline Position

```
archguard-discover → archguard-clarify → archguard-plan → archguard-implement
                                                   ↑ You are here
```

## Prerequisites

- `.archguard/discover.md` must exist.
- `.archguard/clarify.md` must exist.

## Procedure

### Step 1: Cross-reference

For each of the 6 Failure Modes, cross-reference discover findings with clarify decisions:

```
IF clarify says "FM1: external, option 1" AND discover Map A has Express routes:
  → RULE: Ban raw req.body access. Force Zod schema on all route handlers.

IF clarify says "FM2: option 1" AND discover Map B has core→adapters imports:
  → RULE: ArchUnit — core/** shouldNot dependOn adapters/**

IF clarify says "FM3: option 1" AND discover Map C has logger calls + PII vars:
  → RULE: ESLint — ban PII-named identifiers in logger arguments

...etc for all 6 FMs
```

### Step 2: Assign each rule to the weakest capable tool

```
ESLint selectors:   Single-node syntax bans (ban JSON.parse, ban console.log,
                    ban fetch without signal, ban template in session.run, etc.)

ArchUnit:           Import graph rules (core → adapters, server → browser SDK,
                    naming conventions for layer files)

TypeScript config:  catch : unknown enforcement (useUnknownInCatchVariables),
                    no-explicit-any, no-floating-promises
```

Only if a rule genuinely cannot be expressed in any of these three: note it as a `ts-morph` candidate WITH justification of why the ban approach doesn't work.

### Step 3: Generate whitelist files

For every ban, designate exactly one file where the primitive is allowed:

```
Ban: fetch() globally
Whitelist: adapters/http/safe-fetch.ts   (wraps fetch + Zod + signal + breaker)

Ban: JSON.parse globally
Whitelist: core/safe-parse.ts            (JSON.parse inside Zod.safeParse)

Ban: session.run() with template strings
Whitelist: adapters/neo4j/parameterized-run.ts

Ban: generateText() returned directly
Whitelist: core/ai-sanitizer.ts          (wraps generateText + sanitize)
```

If a whitelist file doesn't exist yet, mark it as "create new" — implement will create it.

### Step 4: Check for gaps

Review the full set of rules against the 6 FMs. If any FM is "active" (clarify opted in) but has zero rules → that's a gap. Flag it.

### Step 5: Write the plan

Output to `.archguard/plan.md`:

```markdown
# ArchGuard Plan

## Summary
- Total rules: N (ESLint: X, ArchUnit: Y, TypeScript: Z, ts-morph: W)
- Total whitelist files: M (existing: P, to create: Q)
- Gaps: R (list if any)

## ESLint Rules (eslint.config.cjs)

### Rule: Ban raw JSON.parse
- Selector: `CallExpression[callee.object.name='JSON'][callee.property.name='parse']`
- Message: "Raw JSON.parse() banned. Use safeParse() from core/safe-parse.ts."
- Exemptions: `core/safe-parse.ts`
- FM: FM1

[...repeat for each ESLint rule]

## ArchUnit Rules (tests/architecture.test.ts)

### Rule: Core must not import Adapters
- Expression: `projectFiles().inFolder('core/**').shouldNot().dependOnFiles().inFolder('adapters/**')`
- FM: FM2

[...repeat for each ArchUnit rule]

## TypeScript Config

- `useUnknownInCatchVariables: true` — FM4
- `noUncheckedIndexedAccess: true` — FM1
- `${existing tsconfig options}` — keep existing

## Whitelist Files

| File | Primitive | Purpose |
|------|-----------|---------|
| adapters/http/safe-fetch.ts | fetch() | Wrap fetch + Zod + signal + breaker |
| core/safe-parse.ts | JSON.parse | JSON.parse inside Zod.safeParse wrapper |

## Gaps

[List any FM that is active but has zero rules, or explain why it's covered by tests]
```

## Constraints

- **Do NOT write config files.** This is planning only. Implement writes the files.
- **Prefer bans over traces.** A ban on the unsafe primitive is always simpler than a cross-statement check.
- **One whitelist file per ban.** Not zero, not two. One.
- If both discover and clarify are missing, abort and tell the user to run the pipeline in order.
