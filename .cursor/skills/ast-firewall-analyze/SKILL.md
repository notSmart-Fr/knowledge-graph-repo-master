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
7. **Architecture definitions** — "What lives here:" sections that declare directory roles, AND any prose that describes what a directory, layer, or module is responsible for (e.g., "The /adapters directory handles all infrastructural translations so that our core domain logic remains decoupled from third-party APIs")

**Implicit Constraint Derivation Rule**: For any directory role definition (explicit or prose-implied), derive the implicit constraint: *If X is defined as the sole place for Y, then Y found outside of X is a violation.* Example: if `/adapters` is described as the sole layer that talks to third-party SDKs, then `import { PrismaClient } from '@prisma/client'` in `/core/` is a structural violation — even if the constitution never said "MUST NOT import SDKs in core."

For each extracted gate, normalize it to a single sentence: what pattern must or must not exist in code.

Then filter for AST-enforceable: can a dev see this violation in source code without running the program?

Ignore:
- Purely aspirational statements
- Explanations/rationale sections
- Version history
- Governance/amendment process (unless it contains enforceable compliance rules)

### Phase 2: Extract Existing Rules (AST & API Footprint)

Read `scripts/ast-firewall.ts`. For each rule function, extract three layers of information:

**Layer 1 — JSDoc Metadata (when present)**:
- Constitutional source (which gate it enforces — e.g., `@gate` or `Constitutional source:` tag)
- Safety domain (e.g., `@domain Resilience`)
- Shortcut caught (e.g., `Lazy-agent shortcut:` tag)

**Layer 2 — AST Signature (always extracted)**:
- The specific `SyntaxKind` constants targeted (e.g., `SyntaxKind.ImportDeclaration`, `SyntaxKind.CatchClause`, `SyntaxKind.CallExpression`)
- The property/method invariants invoked on AST nodes to assert safety (e.g., `.getModuleSpecifierValue()`, `.getText()`, `.getArguments()`, `.getName()`)

**Layer 3 — Location Context (when applicable)**:
- Whether the rule uses `ctx.normalizedPath`, `ctx.relativePath`, `ctx.fileText`, or similar context properties for location-based scoping
- The directory path patterns or file name conventions it gates on (e.g., `includes("/core/")`, `endsWith(".adapter.ts")`)

**Fallback Rule — UNDOCUMENTED_MATCH**: If a rule function lacks JSDoc metadata (no `@domain`, `@gate`, or source comment), do NOT guess its semantic intent. Instead, log its status as `UNDOCUMENTED_MATCH`, tracking ONLY:
- Its targeted `SyntaxKind` constants (mechanically extracted from the code)
- Its location scope (from `ctx.normalizedPath` patterns)

UNDOCUMENTED_MATCH rules are cross-referenced in the matrix solely by their structural footprint — they appear as "Rule N (undocumented)" matched against gates that share the same domain pattern. The analysis must flag these as documentation gaps in the Drift Warnings section, recommending the author add JSDoc metadata.

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

For each EXISTING rule, run three drift checks:

#### 5a. Scope Drift — Directory Staleness

For every rule classified as **Location-based** (enforcing directory architecture via `ctx.normalizedPath` patterns), verify:

1. **Path-Awareness Check**: Confirm the rule logic actively uses `ctx.normalizedPath`, `ctx.relativePath`, or equivalent context properties for location decisions. A rule that targets `SyntaxKind.ImportDeclaration` without any path filter is pattern-based, not location-based — do not apply directory checks to it.

2. **Scope Verification**: Cross-reference the hardcoded directory strings or file-name conventions inside the rule against the actual physical repository layout. If a rule references a directory path that no longer exists in the project root (e.g., `ctx.normalizedPath.includes("/old-layer/")` but `/old-layer/` was removed), flag it as **Scope Drift** — the rule is gating on a non-existent directory and silently allowing violations in the real code paths.

3. **Pattern Staleness**: If a rule uses naming conventions (e.g., `endsWith(".port.ts")`, `endsWith(".adapter.ts")`), verify those file patterns are still the project's active convention. If the project migrated naming conventions (e.g., from `*.port.ts` to `*.interface.ts`) but the rule wasn't updated, flag it.

#### 5b. Stack Drift — Structural Rule Silence Test

To detect rules guarding abandoned libraries, frameworks, or code patterns (dead rules):

1. For each rule, identify its core `SyntaxKind` target or string token matcher from Phase 2 Layer 2.
2. Query the active `ts-morph` `Project` instance to determine whether that syntax signature exists *anywhere* in the current repository file pool.
3. If a rule would yield a total match count of **0** across the entire codebase (i.e., the pattern it guards against no longer exists in any scanned file), flag it as a **Stack Drift Warning (Potential Dead Rule)**.

A dead rule passes every sweep, producing zero violations, and appears as `COVERED` in the cross-reference matrix — but it is functionally useless. The suggested action must prompt the developer to either:
- Deprecate the rule (the guarded library/pattern was removed from the stack), or
- Update the rule to match the current stack (the pattern changed but the constitutional intent still applies).

#### 5c. False-Positive / False-Negative Risk

Flag rules whose guard pattern may produce false positives (flagging safe code) or false negatives (missing violations) due to overly broad or narrow matching. Examples: a regex that hardcodes a provider name, a PII keyword list that hasn't been updated for new fields, or a directory scope that is too wide.

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

| Rule | Type | Warning | Suggested Action |
|---|---|---|---|
| Rule 9 | Scope Drift | References `/old-layer/` — directory removed | Update path to `/new-layer/` |
| Rule 14 | Stack Drift | SyntaxKind target not found in codebase | Deprecate or update for current stack |

## Documentation Gaps (UNDOCUMENTED_MATCH)

| Rule | Targeted SyntaxKind | Missing Metadata |
|---|---|---|
| Rule 1 | `SyntaxKind.CallExpression` (z.string) | No `@domain`, `@gate`, or constitutional source JSDoc |

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
