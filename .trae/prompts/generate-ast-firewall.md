# Task: Generate AST Firewall Rules from Constitution

You are generating a `scripts/ast-firewall.ts` file using `ts-morph` (Project, SyntaxKind, Node). You have ONLY the constitution text below and the project's tech stack description — no codebase access. Your job is to produce compile-time rules that catch AI agent coding drift.

## Step 1: Classify every quality gate into one of five safety domains

| Domain | What it guards | Pattern to scan for |
|---|---|---|
| **Data-Flow** | Data crosses trust boundary unvalidated | Data enters the process (HTTP, WebSocket, files, env vars, DB reads, AI/model output) and isn't schema-validated before use |
| **Structural** | Architecture, dependency direction, mandatory wrappers | Required wrapper/pattern missing: no tracing, no error boundary, no lifecycle handler, wrong import location, concrete dependency in wrong layer |
| **Leakage** | Sensitive data in export channels | Sensitive-named variable/logged in console, structured logger, telemetry spans, error metadata, API responses |
| **Correctness** | Wrong algorithm, value, or constraint | Wrong algorithm variant, unbounded input, injection-vulnerable interpolation, type escapes, empty error handlers, missing required config fields |
| **Resilience** | Missing safety nets: timeouts, cleanup, loop bounds, config fallbacks | External call without timeout/abort, unbounded loop, env var without default, hardcoded values in wrong location, resource allocation without release |

**General rule — enforce location, not intent:** When you can't detect what the code *means*, enforce where the pattern *may appear*. This applies to ALL five domains equally. Define what belongs where (via directory structure and naming conventions declared in the constitution), then flag patterns that appear in the wrong location.

| Can't detect... | But CAN detect... | Domain |
|---|---|---|
| "Is this an adapter/concrete dependency?" | `new Something()` in a directory that should only contain interfaces | Structural |
| "Is this a secret/credential?" | String literal matching secret patterns outside the designated config directory | Resilience |
| "Is this PII?" | Variable named with PII keywords passed to logging/export functions | Leakage |
| "Will this loop run forever?" | Unbounded loop construct without a named iteration counter | Resilience |
| "Is this a valid schema?" | Schema bypass pattern (e.g., `z.any()`, `any` type) | Data-Flow |
| "Is this a required config value?" | Config access without a fallback default, outside the config directory | Resilience |
| "Is this safe output?" | Model/output generator call without sanitizer/validator in the same file | Correctness |
| "Is this wrapped correctly?" | Relevant method call without the required wrapper in the ancestor chain | Structural |

## Step 2: For each gate, ask the lazy-agent question

> "If an AI agent were taking the SHORTEST path to working code, what shortcut would violate this rule?"

This table shows *examples* from a hexagonal TypeScript CRM project. Do NOT copy these verbatim — generate shortcuts for YOUR project's constitution instead. The examples illustrate the *kind* of reasoning, not the specific rules:

| Quality Gate (example) | Lazy-Agent Shortcut (example) |
|---|---|
| "Validate all external data at boundary" | Skip `.parse()` — data "looks fine" in testing |
| "Use the designated cipher" | Copy-paste a weaker/older cipher from a search result |
| "Parameterize all database queries" | Template literal/string interpolation — it's shorter |
| "Agent/worker must have iteration limit" | Omit `maxSteps`/`maxIterations` — happy path is 2 steps |
| "All schemas must have constraints" | Unbounded string/number type — test data is always small |
| "No type escapes" | `as any` to silence a type error — "I'll fix it later" |
| "Core depends only on interfaces/ports" | `new ConcreteImpl()` — faster than wiring dependency injection |
| "Every critical path must be traced" | Skip the tracing wrapper — function works without it |
| "All output must be sanitized" | Return raw result — no bad data in test fixtures |
| "No raw/unescaped external queries" | Raw query string — shorter than the safe client method |
| "Handle shutdown/termination signals" | Just `process.exit()` — works in dev, breaks in prod |
| "All external calls must have timeouts" | No abort signal / timeout param — "it responds fast in dev" |
| "Config values must have defaults" | Env var without fallback — "it's always set in .env" |
| "Loops must have a bound" | Unbounded loop without escape counter — "condition will become false" |
| "Resources must be released" | `new Connection()` without `.close()` — "GC will handle it" |
| "No hardcoded configuration" | URL/secret/key string literal in business logic — "I'll move it later" |
| "No sensitive data in telemetry" | Debug value in span attribute — "useful for debugging" |
| "Every write must be idempotent" | No idempotency key — "duplicates never happen in testing" |
| "No empty error handlers" | `catch (e) {}` — "this error never occurs" |

## Step 3: For each shortcut, write all syntactic variants as violation patterns

List every way the language allows that shortcut. Include aliases, wrappers, property-access variants, destructured calls:

```
Example: "Skip validation on HTTP response"
Variants:
  const data = await fetch(url)                  // direct assignment
  const res = await fetch(url); res.json()       // two-statement pattern
  const raw = await response.json()              // intermediate variable
  await this.client.fetch(url)                   // property-access variant
  await runtimeSpecific.fetch(url)               // runtime-specific variant (Bun, Deno, Node 18+)
```

## Step 4: Write one ts-morph rule function per violation pattern

```typescript
/**
 * Constitutional source: [clause reference]
 * Domain: [Data-Flow | Structural | Leakage | Correctness | Resilience]
 * Lazy-agent shortcut: [what shortcut this catches]
 * Enforcement: [location-based | pattern-based]
 */
const ruleN_DescriptiveName: RuleFn = (ctx) => {
  // Scope: only scan files that can contain this pattern
  // For location-based: scope by directory and/or file naming convention
  if (!ctx.normalizedPath.includes("/relevant/dir/")) return;

  for (const node of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TheNodeType)) {
    // Detect the violation pattern
    // If found: error(ctx, "Rule N Descriptive Name", "detail message");
  }
};
```

Requirements:
- One function per rule, self-contained with JSDoc linking to constitutional clause
- Organized by safety domain (comment separators: `// Domain A: Data-Flow Safety`, etc.)
- All rules collected in `const ALL_RULES: RuleFn[] = [...]`
- Exit code 0 = pass, 1 = blocked build
- Output `.gate-results.json` with `{ passed, violationCount, fileCount, timestamp }`
- Support `--watch` mode via chokidar and single-file scan via CLI arg
- Use AST traversal (ts-morph), NEVER regex on raw text (comments/strings cause false positives)
- Narrow scope first: skip files that can't contain the pattern
- Catch all syntactic variants: direct call, property access, aliased imports, destructured calls
- For location-based rules: scope by directory path and/or file naming convention from the constitution, then flag forbidden patterns in wrong locations

Infrastructure helpers (include in the generated file):
```typescript
type RuleFn = (ctx: GateContext) => void;

interface GateContext {
  sourceFile: SourceFile;
  relativePath: string;
  normalizedPath: string;
  fileText: string;
  violationCount: number;
  project: Project;
}

interface Violation {
  rule: string;
  path: string;
  detail: string;
  ruleNum: number;
}

// Helper: walk ancestor chain looking for a specific call pattern
function hasAncestorCall(node: Node, methodNames: string[]): boolean { ... }

// Helper: check sibling statements for guard call (two-statement boundary pattern)
function hasSiblingGuard(node: Node, methodNames: string[]): boolean { ... }
```

## Code Surface Catalog (Template — populate from constitution)

Below is a GENERIC template. For each domain, scan the constitution + tech stack description and populate the surfaces that actually exist in this project. Do NOT copy these examples — they are illustrative. Skip any surface not used by the stack.

For each populated surface, classify the enforcement strategy: **pattern-based** (detect the AST pattern regardless of location) or **location-based** (detect the pattern only in wrong directory/file, as defined by the constitution's architecture).

### Data-Flow Surfaces (data enters the process)

| Surface (examples) | Unvalidated Variant | Guard Pattern | Enforcement |
|---|---|---|---|
| HTTP response | Response body used without schema parse | Wrap in schema parse before use | Pattern-based |
| WebSocket/SSE/realtime message | Event payload used raw in handler | Schema-validate in callback | Pattern-based |
| Route/API handler body | Request body used without validation | Validate before processing | Pattern-based |
| File/system read | Parsed content without schema | Schema-validate after read | Pattern-based |
| CLI arguments | Raw arg used without parse | Validate before use | Pattern-based |
| Environment variables | Raw `process.env` / equivalent without fallback | Validate + default | Location-based if config dir exists |
| Message/job queue payload | Job data used without parse | Schema-validate job data | Pattern-based |
| Database query result | Rows trusted as-is without validation | Schema-validate after query | Pattern-based |
| AI/model generated output | Raw output returned to user | Sanitize/validate before delivery | Pattern-based |

### Structural Surfaces (architecture, wrappers, dependency direction)

| Surface (examples) | Lazy Shortcut | Guard Pattern | Enforcement |
|---|---|---|---|
| Concrete dependency in wrong layer | `new ConcreteImpl()` in core/interface layer | Inject via interface/port | Location-based |
| Required wrapper missing | Method call without circuit-breaker/retry/timeout wrapper | Wrap in required middleware | Location-based |
| Ungraceful shutdown | Exit/kill without signal handler | Register signal handlers | Pattern-based |
| Missing lifecycle config | Component/agent/worker without iteration/step limit | Include bounded config | Pattern-based |
| Missing required declaration fields | Factory/config call without required fields | Require all mandatory fields | Pattern-based |
| Untraced critical path | External call without tracing/span wrapper | Wrap in trace context | Location-based |

### Leakage Surfaces (sensitive data in export channels)

| Channel (examples) | Lazy Shortcut | Guard Pattern | Enforcement |
|---|---|---|---|
| Console/stdout logging | Sensitive-named variable passed to log call | Only log structural/aggregate data | Pattern-based + naming convention |
| Structured/JSON logger | Sensitive-named key in log metadata | Strip sensitive keys before logging | Pattern-based + naming convention |
| Telemetry/tracing span attribute | Sensitive-named key or value in span | Check key against allowlist | Pattern-based |
| Telemetry event | Sensitive-named attribute in event | Check attribute keys and values | Pattern-based |
| Error object metadata | Sensitive-named key in error constructor meta | Auto-strip from meta | Pattern-based |
| API/serialization response | Raw internal row/object with sensitive fields | Strip/sanitize before serialization | Pattern-based |

### Correctness Surfaces (wrong algorithm, config, constraints)

| Surface (examples) | Lazy Shortcut | Guard Pattern | Enforcement |
|---|---|---|---|
| Schema field unconstrained | Type without length/bound/format constraint | Require `.max()` / `.min()` / format validators | Pattern-based |
| Schema bypass | Catch-all type used as schema | Flag catch-all schema types | Pattern-based |
| Wrong algorithm variant | Weaker/older algorithm variant | Enforce specific algorithm string | Pattern-based |
| Injection via interpolation | Template literal or string concat in query | Require parameterized/bound queries | Pattern-based |
| Raw/unescaped external query | Raw query string bypassing access controls | Require client method chain with policies | Pattern-based |
| Client-side heavy computation | Pull data to app layer for compute | Require native/database-side operator | Pattern-based |
| Type escapes | Type assertion to escape hatch type | Flag all escape hatch type usages | Pattern-based |
| Empty error handler | Catch block with no body/statements | Require >= 1 statement | Pattern-based |
| Untyped error handler | Catch variable without type annotation or wrong type | Require safe type annotation | Pattern-based |
| Unsafe error property access | Error property access without type guard | Require type guard before access | Pattern-based |
| Unsanitized output | Model/generator output returned raw | Require sanitizer call in same file | Pattern-based |
| Wrong identifier format | Identifier with spaces/wrong case | Enforce format (slug, camelCase, etc.) | Pattern-based |

### Resilience Surfaces (safety nets, cleanup, bounded behavior)

| Surface (examples) | Lazy Shortcut | Guard Pattern | Enforcement |
|---|---|---|---|
| External call without timeout | No abort signal or timeout parameter | Require timeout/signal config | Pattern-based |
| Unbounded loop | Infinite loop construct without escape counter | Require named counter or max-break guard | Pattern-based |
| Config/env without fallback | Env/config access without default value | Require `??` / `||` fallback | Location-based if config dir exists |
| Hardcoded value in wrong location | URL/secret/key literal outside config dir | Constrain to designated config directory | Location-based |
| Resource without cleanup | Constructor call without matching release call | Require `.close()` / `.destroy()` / `.dispose()` in scope | Pattern-based |
| Unbounded concurrency | Parallel execution over unknown-length collection | Use concurrency limiter for dynamic-length arrays | Pattern-based (warn) |

### How to populate the catalog from the constitution:

1. Read the constitution's architecture section. Identify directory roles (what goes in `core/`, `config/`, `adapters/`, etc.). This defines the location-based scopes.
2. Read the tech stack description. Identify every I/O primitive (`fetch`, specific DB driver, specific AI SDK, specific message queue).
3. For each surface template above, ask: "Does this project's stack use this?" If yes, replace the generic description with the stack-specific pattern. If no, delete the row.
4. For each populated row, determine enforcement from the constitution's architecture rules: does the project define a specific directory for this pattern? (location-based) Or must the pattern be checked everywhere? (pattern-based)

## Output: Complete `scripts/ast-firewall.ts`

Generate the COMPLETE file with:
1. Imports (ts-morph, path, fs, chokidar)
2. Types (GateContext, RuleFn, Violation)
3. Helper functions (ancestorsOf, hasAncestorCall, hasSiblingGuard)
4. Domain-organized rule functions (each with constitutional source + domain + enforcement strategy JSDoc)
5. ALL_RULES array
6. Orchestrator: resolveSourceFiles, executeSweep, main (single-sweep + --watch modes)
7. SIGINT/SIGTERM handlers that flush .gate-results.json
8. Exit 0 on pass, exit 1 on violations

No placeholders. No "// TODO". Every rule must be fully implemented with ts-morph AST traversal. Write working code.

## Tech Stack & Constitution

### Tech Stack

[DESCRIBE YOUR STACK: runtime, framework, database, external services, validation library, AI/ML tools, etc.]

### Constitution

[PASTE YOUR CONSTITUTION TEXT HERE]
