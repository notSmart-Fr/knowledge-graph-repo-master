---
name: "ast-firewall-implement"
description: "Implement AST firewall rules from the plan. Reads ast-firewall-plan.md tasks, writes ts-morph rule functions into scripts/ast-firewall.ts with proper domain organization, JSDoc, and ALL_RULES registration. Invoke after ast-firewall-plan to execute the implementation."
---

# AST Firewall Implement

## Purpose

Reads the implementation plan from `.knowledge/ast-firewall-plan.md` (produced by `/ast-firewall-plan`) and writes the actual TypeScript rules into `scripts/ast-firewall.ts`.

## Prerequisites

- `.knowledge/ast-firewall-plan.md` MUST exist with concrete tasks (run `/ast-firewall-plan` first)
- `scripts/ast-firewall.ts` MUST exist (if new project, create a skeleton with helpers + orchestrator first)
- `.specify/memory/constitution.md` for rule JSDoc constitutional source references

## Inputs

Read these files (absolute paths from repo root):

1. **REQUIRED**: `.knowledge/ast-firewall-plan.md` — implementation plan with ordered tasks
2. **REQUIRED**: `scripts/ast-firewall.ts` — the file to modify
3. **REQUIRED**: `.specify/memory/constitution.md` — for JSDoc clause references

## Rule Function Template

Every new rule follows this structure:

```typescript
/**
 * Constitutional source: [exact clause reference from constitution]
 * Domain: [Data-Flow | Structural | Leakage | Correctness | Resilience]
 * Lazy-agent shortcut: [what shortcut this catches]
 * Enforcement: [location-based (scope: /path/) | pattern-based]
 */
const ruleN_DescriptiveName: RuleFn = (ctx) => {
  // Scope: only scan files that can contain this pattern
  if (!ctx.normalizedPath.includes("/relevant/dir/")) return;

  for (const node of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TheNodeType)) {
    // Detect the violation pattern
    // If found: error(ctx, "Rule N Descriptive Name", "detail message");
  }
};
```

## Implementation Rules

- Use ts-morph AST traversal (SyntaxKind, getDescendantsOfKind) — NEVER regex on raw text
- Narrow scope first: skip files that can't contain the pattern
- Catch all syntactic variants: direct call, property access, aliased imports, destructured calls
- For location-based rules: scope by directory path and/or file naming convention from constitution
- Write complete, working code — no `// TODO`, no placeholders
- Each rule must be self-contained and independently testable

## Outline

### Phase 1: Parse the Plan

Read `.knowledge/ast-firewall-plan.md`. Extract:
- New helper functions to add (Task H*)
- New rules to add (Task A*-E* per domain)
- Existing rules to update (Task U*)
- Existing rules to remove (Task R*)
- Documentation fixes — JSDoc-only additions (Task D*)
- Scope drift fixes — path/pattern updates (Task S*)
- Stack drift resolution — deprecate or update dead rules (Task K*)

### Phase 2: Baseline Check

Run `pnpm check`. If it fails with existing violations, report them and STOP. Do not add rules to a broken firewall.

### Phase 3: Add Helper Functions

If the plan calls for new helpers, add them in the helpers section (after existing helpers like `hasAncestorCall`, `hasSiblingParse`). Each helper needs JSDoc with usage example. Use ts-morph Node API, not regex.

### Phase 4: Add New Rules

For each new rule in task order:
1. Determine insertion point (domain section + position within domain)
2. Write the rule function using the template above
3. Add to `ALL_RULES` array at the bottom
4. Run `pnpm check` after each rule to catch issues early

### Phase 5: Update Existing Rules

For each update task: read the existing rule, apply the specified change, preserve rule number and JSDoc structure.

### Phase 6: Fix Documentation Gaps

For each D-task (UNDOCUMENTED_MATCH rules from the analysis):
1. Locate the rule function in `ast-firewall.ts`
2. Add the missing JSDoc block above the function with the metadata from the plan:
   - `Constitutional source:` clause reference from constitution
   - `@domain` tag with the safety domain
   - `Lazy-agent shortcut:` description of the violation pattern
   - `Enforcement:` pattern-based or location-based with scope
3. Do NOT change any rule logic — this is a metadata-only change
4. Do NOT change the rule number

### Phase 7: Fix Scope Drift

For each S-task (stale directory paths or naming conventions):
1. Locate the rule function
2. Update the hardcoded path string or file-name convention in `ctx.normalizedPath` checks (e.g., `includes("/old-dir/")` → `includes("/new-dir/")`)
3. Verify the new path exists in the repository layout
4. Run `pnpm check` to confirm the rule still fires on the intended scope

### Phase 8: Remove Dead Rules

For each removal task: delete the function body, remove from ALL_RULES. Do NOT renumber remaining rules.

### Phase 9: Validation

1. Run `pnpm check` — must pass with 0 violations
2. If violations on existing code: the rule scope is too wide, narrow it
3. Create chaos tests: write intentional violations in a test file, verify they're caught

### Phase 10: Update Documentation

1. Create or update `.knowledge/ast-decisions.md` — add project-specific rule-to-constitution mapping for new rules
2. Mark all tasks in `.knowledge/ast-firewall-plan.md` as `[X]`

## Output

- Updated `scripts/ast-firewall.ts` with new/updated/removed rules
- Updated or created `.knowledge/ast-decisions.md`
- Updated `.knowledge/ast-firewall-plan.md` (tasks marked complete)

## Completion Report

Report: rules added, updated, removed; `pnpm check` result; chaos tests created.
