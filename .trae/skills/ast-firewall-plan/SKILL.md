---
name: "ast-firewall-plan"
description: "Produce a concrete implementation plan from the gap analysis. Reads ast-firewall-analysis.md (produced by discover or analyze), converts gaps/rules into ordered implementation tasks with priorities and file placement. Invoke after discover or analyze."
---

# AST Firewall Plan

## Purpose

Reads `.knowledge/ast-firewall-analysis.md` (produced by `/ast-firewall-discover` or `/ast-firewall-analyze`) and converts the raw gaps/rules catalog into an ordered, actionable implementation plan with concrete tasks.

## The Pipeline

```
/ast-firewall-discover   →  .knowledge/ast-firewall-analysis.md  (WHAT: rule catalog for new project)
/ast-firewall-analyze    →  .knowledge/ast-firewall-analysis.md  (WHAT: gap analysis for existing project)
/ast-firewall-plan       →  .knowledge/ast-firewall-plan.md      (HOW: ordered implementation tasks)
/ast-firewall-implement  →  scripts/ast-firewall.ts              (CODE: working ts-morph rules)
```

## Prerequisites

- `.knowledge/ast-firewall-analysis.md` MUST exist (run `/ast-firewall-discover` or `/ast-firewall-analyze` first)

## Inputs

Read these files (absolute paths from repo root):

1. **REQUIRED**: `.knowledge/ast-firewall-analysis.md` — the gap analysis or rule catalog
2. **REQUIRED**: `.specify/memory/constitution.md` — for cross-referencing clause text
3. **IF EXISTS**: `scripts/ast-firewall.ts` — to understand existing structure (domain ordering, helper functions, orchestrator boilerplate, existing rule numbers)

## Outline

### Phase 1: Validate the Input

Read `.knowledge/ast-firewall-analysis.md`. Verify every gap/rule has:
- Constitutional gate reference
- Safety domain
- Lazy-agent shortcut
- Enforcement strategy (pattern-based or location-based with scope)

Mark incomplete entries as "NEEDS CLARIFICATION" and skip them — they stay as unresolved analysis items.

### Phase 2: Prioritize

Assign each gap/rule a priority:
- **HIGH**: catches data loss, security violations, or injection (Data-Flow, Correctness, Leakage domains)
- **MEDIUM**: catches architecture drift, missing wrappers, config issues (Structural, Resilience domains)
- **LOW**: naming conventions, formatting, cosmetic checks

### Phase 3: Determine Implementation Order

Sort rules by:
1. **Priority** (HIGH → MEDIUM → LOW)
2. **Dependencies**: helper functions before rules that need them
3. **Domain grouping**: batch rules for the same domain together (keeps the file organized)

### Phase 4: Determine File Placement

For each new rule:
- Which domain section in `ast-firewall.ts`?
- Rule number (next available in domain, or renumbered if removing rules)
- Position within domain section (logical grouping)

For updates to existing rules:
- Preserve existing rule number
- Note exact change (scope update, pattern update, guard update)

For removals:
- Identify function to delete + ALL_RULES entry to remove

### Phase 5: Generate Implementation Tasks

Write to `.knowledge/ast-firewall-plan.md`:

```markdown
# AST Firewall Implementation Plan — [Project Name]

## Source
Derived from `.knowledge/ast-firewall-analysis.md` on [date]

## Pre-Implementation
- [ ] Task P1: Verify `pnpm check` passes on current codebase (baseline)

## Tasks (in priority order)

### Add New Helpers (if needed)
- [ ] Task H1: Add [helper name] — purpose: [what it does] — needed for rules [X, Y]

### Domain A: Data-Flow
- [ ] Task A1: Add Rule N ([name]) — priority: HIGH
  - Constitutional: [clause]
  - Lazy shortcut: [shortcut]
  - Enforcement: [pattern-based | location-based: scope /path/]
  - Insert after: [existing rule or section header]

### Domain B: Structural
...

### Domain E: Resilience
...

### Update Existing Rules
- [ ] Task U1: Update Rule N — [change description]

### Remove Rules
- [ ] Task R1: Remove Rule N — [reason]

### Post-Implementation
- [ ] Task Z1: Run `pnpm check` — verify 0 violations
- [ ] Task Z2: Create chaos test for each new rule
- [ ] Task Z3: Update `.knowledge/ast-decisions.md` with new rule mappings
```

## Output

`.knowledge/ast-firewall-plan.md` — ordered, actionable implementation tasks.

## Next Step

`/ast-firewall-implement`
