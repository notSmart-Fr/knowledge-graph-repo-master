# ArchGuard Pipeline — Skills & Data Flow

The 5 skills that implement the Architectural Guard Methodology. Each skill is defined in `.trae/skills/archguard-*/SKILL.md`. This document describes how they connect.

---

## Pipeline Overview

```
archguard-discover → archguard-clarify → archguard-plan → archguard-implement
         ↓                    ↑
         └── archguard-analyze ──┘ (incremental updates)
```

| Skill | Purpose | Input | Output |
|:---|:---|:---|:---|
| **1. discover** | Scans codebase for 4 maps + tech context + invariant bans | Source code + `package.json` | `.archguard/discover.md` + JSON maps + `.meta.json` |
| **2. clarify** | Walks user through 6 FMs to extract domain context | `discover.md` + JSON maps | `.archguard/clarify.md` + updated JSON domain flags |
| **3. plan** | Cross-references facts + intent → concrete ESLint/ArchUnit rules | `discover.md` + `clarify.md` + JSON maps | `.archguard/plan.md` |
| **4. implement** | Writes/merges ESLint config, ArchUnit tests, tsconfig, whitelist stubs | `plan.md` + existing configs | `eslint.config.*`, `tests/architecture.test.ts`, `tsconfig.json`, whitelist files |
| **5. analyze** | Incrementally updates maps when packages/files change | `.archguard/maps/*.json` + git history | Updated JSON maps + `.meta.json` |

---

## File Inventory

| File | Written By | Read By | Contents |
|:---|:---|:---|:---|
| `.archguard/discover.md` | discover, analyze | clarify, plan | Human-readable structural snapshot |
| `.archguard/maps/trust-boundaries.json` | discover, analyze | plan | Map A entries |
| `.archguard/maps/dependency-graph.json` | discover, analyze, clarify | plan | Map B entries + layer classification |
| `.archguard/maps/output-surfaces.json` | discover, analyze | plan | Map C entries |
| `.archguard/maps/resources-mutations.json` | discover, analyze | plan | Map D entries + FM6 candidates |
| `.archguard/maps/.meta.json` | discover, analyze | analyze | Git SHA baseline for incremental diffs |
| `.archguard/tech-context.json` | discover, analyze | plan | Q1-Q5 results per dependency |
| `.archguard/clarify.md` | clarify | plan | 6 FM answers + Date.now decision |
| `.archguard/plan.md` | plan | implement | Concrete rules, selectors, whitelist paths |

---

## Data Flow Detail

### discover → clarify

```
discover output:
  - Map A: "14 trust boundaries found (8 HTTP routes, 4 WebSocket handlers, 2 CLI args)"
  - Map B: "3 layers (core, adapters, features). 2 FM2 candidates."
  - Map C: "22 output surfaces (18 logger calls, 4 HTTP responses)"
  - Map D: "31 resources (19 DB mutations, 7 fetch calls, 5 stream opens)"
  - Invariant bans: "10 active, 1 deferred, 2 inactive (no Node.js runtime)"
  - Tech context: "3 packages trigger Q1-Q5 bans"

clarify reads this, then asks:
  - FM1: "14 trust boundaries. Which are external?" → user answers
  - FM2: "Are the 2 cross-layer imports accidental?" → user answers
  - ...etc
```

### clarify → plan

```
clarify adds domain context:
  - FM1: "8 boundaries are external, 6 are internal"
  - FM2: "Both imports are accidental — ban them"
  - FM3: "PII fields: email, phone, password, token"
  - FM4: "Enforce timeouts on all external calls"
  - FM5: "Has LiveKit — enforce try/finally"
  - FM6: "3 functions need atomicity"
  - Date.now: "Yes, require TimeService"

plan reads discover + clarify, generates:
  - Invariant bans (auto, from discover)
  - Tech context bans (from discover Q1-Q5)
  - Domain-specific rules (clarify FM answers × discover maps)
  - Hygiene rules (always included)
  - Whitelist file specs
```

### plan → implement

```
plan.md contains:
  ## ESLint Rules
    ### Invariant-Derived Bans (Auto)
      1. JSON.parse → selector: "..."
      2. any type → rule: "..."
      ...
    ### Tech Context Rules
      Neo4j: session.run template → selector: "..."
      ...
    ### Domain Rules
      PII in logger → selector: "..."
      ...
    ### Hygiene Rules
      complexity: max 8
      ...
  ## ArchUnit Rules
    core/** shouldNot dependOn adapters/**
    ...
  ## Whitelist Files
    adapters/http/safe-fetch.ts → wraps fetch()
    ...

implement reads this, writes:
  - eslint.config.cjs (merged with existing)
  - tests/architecture.test.ts (merged with existing)
  - tsconfig.json (updated)
  - Whitelist stub files
  - Runs lint + test:arch to verify
```

### analyze (incremental)

```
analyze --pkg neo4j-driver:
  1. Reads tech-context.json → installedVersion: "5.21.0"
  2. Reads package.json → installed: "5.22.0" → VERSION CHANGED
  3. Re-runs 5 Escape Hatch Questions on neo4j-driver@5.22.0
  4. Updates tech-context.json + affected map entries
  5. Output: "1 ban updated, 0 new trust boundaries → run plan"

analyze --changed:
  1. Reads .meta.json → lastCommitHash: "abc123"
  2. git diff --name-only abc123 HEAD → "src/routes/new.ts, package.json"
  3. Scans src/routes/new.ts → 2 new trust boundaries, 1 new output surface
  4. package.json changed → detects new dep "bullmq" → runs --pkg bullmq
  5. Updates maps + .meta.json
  6. Output: "2 new trust boundaries, 1 new pkg → run clarify + plan"
```

---

## Invariant Ban Lifecycle

The 13 invariant bans flow through the pipeline as:

```
discover:
  - Defines all 13 bans
  - Determines active/inactive/deferred status per project conditions

clarify:
  - ONLY handles Ban #10 (Date.now) — asks user whether TimeService is needed
  - All other invariant bans are skipped (no user confirmation needed)

plan:
  - Auto-includes all active invariant bans
  - Includes Ban #10 only if clarify confirmed
  - Deferred bans (Ban #10 with "no" answer) are noted but not included

implement:
  - Writes all included invariant bans to ESLint config
```

---

## First Run vs Incremental Run

| Phase | First Run | Incremental Run |
|:---|:---|:---|
| Maps | `discover` scans full codebase | `analyze` diffs only changed files |
| Tech context | `discover` runs Q1-Q5 on all deps | `analyze --pkg` on new/changed deps |
| Domain context | `clarify` asks all 6 FM questions | Re-run `clarify` only if new boundaries/mutations added |
| Rules | `plan` generates full rule set | Re-run `plan` after `clarify` if needed |
| Configs | `implement` creates files | `implement` merges into existing |
| Baseline | `discover` writes `.meta.json` | `analyze` updates `.meta.json` with new HEAD SHA |

---

## Guard Execution

After `implement` writes configs, the project's existing scripts enforce them:

```
pnpm lint       → ESLint validates all invariant + hygiene rules
pnpm test:arch  → ArchUnit validates dependency direction
pnpm knip       → Knip flags unused code (if configured)
pnpm gate       → Combined: lint + test:arch + knip
```

The pipeline generates the config. The project's own scripts enforce them.
