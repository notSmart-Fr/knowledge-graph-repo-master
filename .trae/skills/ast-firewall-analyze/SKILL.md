---
name: "ast-firewall-analyze"
description: "Analyze an EXISTING ast-firewall.ts against the constitution to find gaps, drift, and over-enforcement. Reads constitution + existing firewall, compares against 5 safety domains and lazy-agent question methodology. Invoke when constitution is amended or when reviewing firewall completeness."
---

# AST Firewall Analyze

## Purpose

For an **existing project** with `scripts/ast-firewall.ts`: compare current rules against the constitution to find:

- **Gaps**: constitutional gates with no corresponding AST rule
- **Drift**: existing rules whose scope no longer matches the codebase
- **Over-enforcement**: rules that enforce gates no longer in the constitution

**Do NOT use on a project without `scripts/ast-firewall.ts`** — use `/ast-firewall-discover` instead.

## Inputs

Read these files (absolute paths from repo root):

1. **REQUIRED**: The project's constitution file — typically `.specify/memory/constitution.md`, or wherever the project keeps its constitution
2. **REQUIRED**: `scripts/ast-firewall.ts` — the existing firewall implementation
3. **IF EXISTS**: `.knowledge/ast-decisions.md` — project-specific rule-to-constitution mappings (if it exists, use as cross-reference)

## Methodology (self-contained)

### The Five Safety Domains

Every rule guards one of five classes of violations:

| Domain | What it guards |
|---|---|
| **Data-Flow** | Data crosses trust boundary unvalidated |
| **Structural** | Architecture, mandatory wrappers, dependency direction |
| **Leakage** | Sensitive data in export channels (logs, telemetry, errors) |
| **Correctness** | Wrong algorithm, value, constraint, or injection pattern |
| **Resilience** | Missing safety nets: timeouts, cleanup, loop bounds, fallbacks |

### Enforcement Strategies

- **Pattern-based**: detect the AST pattern regardless of file location (e.g., `catch (e) {}` → flag everywhere)
- **Location-based**: enforce where patterns may appear by directory/convention (e.g., `process.env.X` without `??` is fine in `config/`, flagged elsewhere)

### The Lazy-Agent Question

For each unenforced gate, ask: "If an AI agent took the shortest path, what shortcut would violate this?" This generates the violation pattern.

## Outline

### Phase 1: Extract Constitutional Gates

Read the constitution. Extract every quality gate. A "quality gate" is ANY statement that says what code SHOULD or SHOULD NOT do, expressed through any of these mechanisms:

1. **Imperative clauses** — "X MUST Y", "X SHALL Y", "X MUST NOT Y", "X is FORBIDDEN"
2. **Declarative rules** — "Dependencies point INWARD", "Never the reverse", "X is FORBIDDEN except documented exceptions"
3. **✅/❌ diagrams** — explicit permission/prohibition rules (e.g., "✅ Application → Core", "❌ Core → Framework")
4. **Quality Gates tables** — any table with a "Rule"/"Requirement" column (e.g., "No any types | < 5 allowed")
5. **"Rule | Implementation" tables** — any table with a "Rule" column (e.g., "All errors must be typed | Custom error classes")
6. **Naming convention tables** — explicit file/class/function naming patterns (e.g., "Adapter files | *.adapter.ts")
7. **Architecture definitions** — "What lives here:" sections that declare directory roles

For each extracted gate, normalize it to a single sentence: what pattern must or must not exist in code.

Then filter for AST-enforceable: can a dev see this violation in source code without running the program?

Ignore:
- Purely aspirational statements
- Explanations/rationale sections
- Version history
- Governance/amendment process (unless it contains enforceable compliance rules)

### Phase 2: Extract Existing Rules

Read `scripts/ast-firewall.ts`. For each rule function, extract from its JSDoc/comments:
- Constitutional source (which gate it enforces)
- Safety domain
- What shortcut it catches

If a rule lacks source documentation, infer by matching its pattern against constitutional gates. Note undocumented rules as documentation gaps.

### Phase 3: Cross-Reference

Build a comparison matrix:

| Constitutional Gate | Existing Rule? | Rule # | Status |
|---|---|---|---|
| "Validate at boundary" | Yes | Rule 3, 18 | COVERED |
| "No PII in logs" | Yes | Rule 5 | COVERED |
| "Idempotency required" | No | — | GAP |

### Phase 4: Identify Gaps

For each GAP row:
1. Ask the lazy-agent question → generate the violation pattern
2. Identify the code surface it applies to
3. Determine enforcement: pattern-based or location-based
4. Propose a rule name, scope, and domain placement

### Phase 5: Identify Drift

For each EXISTING rule, check:
- Does its directory scope still exist?
- Does its guard pattern still match the current stack?
- Flag rules that may produce false positives or negatives.

### Phase 6: Produce Gap Analysis

Output to `.knowledge/ast-firewall-analysis.md`:

```markdown
# AST Firewall Analysis — [Project Name] (Gap Analysis)

## Summary
- Constitutional gates: N total, M enforceable
- Existing rules: X
- Gaps found: Y
- Drift warnings: Z
- Over-enforced: W

## Gaps (Rules to Add)

| # | Constitutional Gate | Domain | Lazy Shortcut | Enforcement | Proposed Rule |
|---|---|---|---|---|---|
| 1 | "Idempotency required" | Correctness | No idempotency key header | Pattern-based | rule20_IdempotencyKey |

## Drift Warnings (Rules to Review)

| Rule | Warning | Suggested Action |
|---|---|---|

## Over-Enforced (Rules to Consider Removing)

| Rule | Reason |
|---|---|

## Full Cross-Reference Table

| Constitutional Gate | Rule | Status |
|---|---|---|
```

## Output

`.knowledge/ast-firewall-analysis.md` — gap analysis. No code written.

## Next Step

`/ast-firewall-plan` → `/ast-firewall-implement`
