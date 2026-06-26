# Plan: AST Firewall v3 Upgrade + .knowledge Audit Doc

## Summary
Upgrade the 15-rule AST firewall to v3 (19 rules) based on the spec coverage audit. Add 4 new rules for spec requirements the firewall currently misses. Patch 4 existing rules with known gaps. Create `.knowledge/ast-firewall-coverage.md` that documents what the firewall can and cannot enforce at compile time.

## Phase 1: Existing Gaps Audit (from previous review)

The audit identified these concrete issues:

### Gap Fixes on Existing Rules

| Rule | Gap | Fix |
|---|---|---|
| Rule 5 (Error PII) | Only checks `console.error`, misses `logger.info()`, `logger.warn()`, `logger.debug()` | Extend to check all logger method calls |
| Rule 13 (Span PII) | Only checks `span.setAttribute()`, misses `span.addEvent(name, attributes)` and `Resource` attributes | Add `span.addEvent()` PII check |
| Rule 14 (Span Coverage) | Hardcoded file list: `orchestrator.ts`, `cache-engine.ts`, `graph-retriever.ts`, `embedding.client.ts` — new pipeline files won't be checked. File names don't match actual spec layout (`core/orchestrator.ts` not `src/orchestrator.ts`) | Change to directory-scoped: any exported function in `core/` and `adapters/` that calls external services must have `startActiveSpan` |
| Rule 15 (No Any) | Detects `: any` on vars/params/return types but misses `as any` type assertions | Add `as any` detection in expression statements |

### New Rules to Add

| Rule | Domain | What It Enforces | Spec Pillar |
|---|---|---|---|
| Rule 16: Port Injection | Type Safety | Orchestrator constructor must accept interfaces from `ports.ts`, never concrete adapter classes. Detects `new SupabaseContactStore()` inside orchestrator. | Pillar 2 (SOLID) |
| Rule 17: Circuit Breaker Wrapper | Error & Resilience | Adapter calls in orchestrator pipeline must be wrapped in circuit breaker utility (`withCircuitBreaker()` or `breaker.invoke()`). | Pillar 1 (Operational) |
| Rule 18: WebSocket Boundary | Zod Boundary Safety | Supabase Realtime `.on()` and LiveKit room event handlers must Zod-parse incoming data. | Pillar 2 (Boundaries) |
| Rule 19: Crypto Algorithm | Security | `createCipheriv()` calls must use `'aes-256-gcm'` algorithm (not `aes-128-cbc`, `aes-256-cbc`, etc.). | Pillar 3 (PII Encryption) |

## Phase 2: Proposed Changes

### Step 1: Patch Rule 5 — Expand PII check to all logger calls

**File:** `scripts/ast-firewall.ts` (lines 238-272)

**What:** Currently only checks `console.error`. Extend to also check `logger.info()`, `logger.warn()`, `logger.debug()`, `logger.error()` — all structured logger calls used throughout the codebase (defined in `core/logger.ts`).

**Implementation:**
```ts
// const rule5_DataErrorPII: RuleFn = (ctx) => {
//   ... existing domain error checks unchanged ...

//   // Check all logger method calls, not just console.error
//   for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
//     const expr = call.getExpression();
//     const exprText = expr.getText();
//     
//     // Match: console.error, logger.info, logger.warn, logger.error, logger.debug
//     const isLoggerCall = 
//       exprText === "console.error" ||
//       (Node.isPropertyAccessExpression(expr) && 
//        expr.getExpression().getText() === "logger" &&
//        ["info", "warn", "error", "debug"].includes(expr.getName()));
//     
//     if (!isLoggerCall) continue;
//     for (const arg of call.getArguments()) {
//       if (Node.isIdentifier(arg) && piiPattern.test(arg.getText())) {
//         error(ctx, "Rule 5 Error PII",
//           `Log call must not pass unvetted PII identifier "${arg.getText()}".`);
//       }
//     }
//   }
// };
```

### Step 2: Patch Rule 13 — Add span.addEvent() PII guard

**File:** `scripts/ast-firewall.ts` (lines 493-512)

**What:** Currently only checks `span.setAttribute()`. Add check for `span.addEvent(name, attributes)` where the second arg (attributes object) might contain PII keys. Also check `Resource` instantiation.

**Implementation:**
```ts
// After existing setAttribute check, add:
// Check span.addEvent(name, attributes)
for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) continue;
  if (expr.getName() !== "addEvent") continue;
  
  const args = call.getArguments();
  if (args.length < 2) continue;
  const attrs = args[1];
  if (!Node.isObjectLiteralExpression(attrs)) continue;
  
  for (const prop of attrs.getProperties()) {
    if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) continue;
    const propName = Node.isPropertyAssignment(prop) ? prop.getName() : prop.getName();
    if (piiKeys.test(propName)) {
      error(ctx, "Rule 13 Span PII Guard",
        `Span addEvent attribute "${propName}" contains PII. ` +
        `Event attributes are exported to telemetry backends.`);
    }
  }
}
```

### Step 3: Patch Rule 14 — Scope to core/ and adapters/ directories

**File:** `scripts/ast-firewall.ts` (lines 514-543)

**What:** Replace hardcoded file list with directory-scoped check. Any file under `core/` or `adapters/` that exports async functions must have `startActiveSpan` in those functions.

**Implementation:**
```ts
const rule14_SpanCoverage: RuleFn = (ctx) => {
  // Scope to core/ and adapters/ directories (all pipeline boundary code)
  if (
    !ctx.normalizedPath.includes("/core/") &&
    !ctx.normalizedPath.includes("/adapters/")
  ) return;

  const functions = [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
  ];

  for (const fn of functions) {
    // Only check exported functions
    const parentVar = fn.getParentIfKind(SyntaxKind.VariableDeclaration);
    if (!fn.isExported?.() && !parentVar?.isExported()) continue;
    
    const name = fn.getName?.() || parentVar?.getName() || "anonymous";
    const body = (fn as any).getBody?.();
    if (!body) continue;

    const bodyText = body.getText();
    // Only require spans if the function body calls an external service (fetch, session.run, supabase., etc.)
    const callsExternal = /fetch\(|session\.run\(|supabase\.|redis\.|createCipheriv\(/.test(bodyText);
    if (!callsExternal) continue;

    if (!bodyText.includes("startActiveSpan")) {
      error(ctx, "Rule 14 Span Coverage",
        `Exported function "${name}" in pipeline boundary file calls external service with no tracer.startActiveSpan().`);
    }
  }
};
```

### Step 4: Patch Rule 15 — Add `as any` assertion detection

**File:** `scripts/ast-firewall.ts` (lines 549-584)

**What:** Add detection of `as any` type assertions (currently only catches `: any` type annotations).

**Implementation:**
```ts
// Add after existing type annotation checks:
// "as any" type assertions
for (const ae of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression)) {
  const typeNode = ae.getTypeNode();
  if (typeNode && typeNode.getKind() === SyntaxKind.AnyKeyword) {
    error(ctx, "Rule 15 No Any",
      `"as any" type assertion bypasses type checking — use a specific type or "as unknown".`);
  }
}
```

### Step 5: Add Rule 16 — Port Injection

**File:** `scripts/ast-firewall.ts` (new rule function)

**What:** In files under `core/`, detect direct instantiation of concrete adapter classes (e.g., `new SupabaseContactStore()`) instead of depending on port interfaces. The orchestrator must only accept injected ports.

**Implementation:**
```ts
// Domain F: Type Safety (after Rule 15)
const rule16_PortInjection: RuleFn = (ctx) => {
  // Only check orchestrator and core pipeline files
  if (!ctx.normalizedPath.includes("/core/")) return;

  // Concrete adapter class names (anything in adapters/ that implements a port)
  const adapterConstructors = [
    "SupabaseContactStore", "SupabaseDealStore", "SupabaseCallStore", 
    "SupabaseTicketStore", "SupabaseAccountStore", "PgVectorCache",
    "Neo4jGraphRetriever", "NoOpGraphRetriever",
    "GeminiEmbeddingProvider", "CachedEmbeddingProvider", "MastraAgentProvider",
    "DeepSeekFallbackProvider",
    "RedisIdempotencyStore", "SupabaseIdempotencyStore", "BullMQDeadLetterQueue",
    "FieldEncryption",
  ];

  for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const constructorName = ne.getExpression().getText();
    if (adapterConstructors.includes(constructorName)) {
      error(ctx, "Rule 16 Port Injection",
        `Direct instantiation of "${constructorName}" inside core/ violates port-based architecture. ` +
        `Inject via createOrchestrator({ ... }) config — orchestrator depends on interfaces, not adapters.`);
    }
  }
};
```

### Step 6: Add Rule 17 — Circuit Breaker Wrapper

**File:** `scripts/ast-firewall.ts` (new rule function)

**What:** Adapter method calls in the orchestrator pipeline must be wrapped in a circuit breaker. Detects direct calls like `this.graphRetriever.expandFromContact(id)` without `breaker.invoke()` or `withCircuitBreaker()` wrapper.

**Implementation:**
```ts
// Domain B: Error & Resilience (after Rule 6)
const rule17_CircuitBreaker: RuleFn = (ctx) => {
  // Only check orchestrator
  if (!ctx.normalizedPath.includes("/core/orchestrator")) return;

  // Check for circuit breaker imports or usage
  const hasCircuitBreakerImport = /withCircuitBreaker|CircuitBreaker|breaker\./.test(ctx.fileText);
  if (!hasCircuitBreakerImport) {
    error(ctx, "Rule 17 Circuit Breaker",
      `Orchestrator file has no circuit breaker import or usage. ` +
      `All external adapter calls must be wrapped: breaker.invoke(() => adapter.method()).`);
    return;
  }

  // Verify breaker wrapper is used on adapter calls (soft check — pattern-based)
  // We look for adapter method calls that aren't wrapped in breaker.invoke()
  const adapterMethods = [
    "this.graphRetriever.", "this.embeddingProvider.", "this.agentProvider.",
    "this.contactStore.", "this.dealStore.", "this.callStore.",
    "this.cacheStore.", "this.idempotencyStore.",
  ];
  
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    if (adapterMethods.some(m => exprText.startsWith(m))) {
      // Check if this call is wrapped in breaker.invoke()
      let parent = call.getParent();
      let wrapped = false;
      while (parent) {
        if (Node.isCallExpression(parent)) {
          const parentExpr = parent.getExpression();
          if (parentExpr.getText().includes("breaker.") || 
              parentExpr.getText().includes("invoke")) {
            wrapped = true;
            break;
          }
        }
        parent = parent.getParent();
      }
      if (!wrapped) {
        error(ctx, "Rule 17 Circuit Breaker",
          `Adapter call "${exprText}" is not wrapped in a circuit breaker. ` +
          `Use breaker.invoke(() => ${exprText}(...)).`);
      }
    }
  }
};
```

### Step 7: Add Rule 18 — WebSocket Boundary Zod

**File:** `scripts/ast-firewall.ts` (new rule function)

**What:** Supabase Realtime `.on()` and LiveKit room event handlers must Zod-parse incoming WebSocket data. These are trust boundaries just like `fetch()`.

**Implementation:**
```ts
// Domain A: Zod Boundary Safety (after Rule 3)
const rule18_WebSocketBoundary: RuleFn = (ctx) => {
  // Check for Supabase Realtime channel subscriptions
  const hasSupabaseOn = /\.on\(/.test(ctx.fileText);
  const hasLiveKitRoom = /\.on\(/.test(ctx.fileText);
  
  if (!hasSupabaseOn && !hasLiveKitRoom) return;

  // Find .on() calls that are subscription handlers
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (expr.getName() !== "on") continue;

    // Check the callback (last argument to .on())
    const args = call.getArguments();
    const callback = args[args.length - 1];
    
    if (!callback) continue;
    
    // Check if callback body has Zod parse/safeParse
    const callbackText = callback.getText();
    const hasZodParse = /\.parse\(|\.safeParse\(/.test(callbackText);
    
    if (!hasZodParse) {
      // Only flag if the handler likely processes external data (has payload access)
      if (/payload|data|event|message|body/.test(callbackText)) {
        error(ctx, "Rule 18 WebSocket Boundary",
          `WebSocket/realtime event handler ".on()" must Zod-parse incoming payload. ` +
          `Untrusted WebSocket data cannot enter internal state raw — same as fetch() boundary.`);
        break;
      }
    }
  }
};
```

### Step 8: Add Rule 19 — Crypto Algorithm

**File:** `scripts/ast-firewall.ts` (new rule function)

**What:** `createCipheriv()` calls must use `'aes-256-gcm'` algorithm string (not weaker ciphers).

**Implementation:**
```ts
// Domain C: Query Injection & Data Integrity (after Rule 9)
const rule19_CryptoAlgorithm: RuleFn = (ctx) => {
  if (!ctx.fileText.includes("createCipheriv")) return;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "createCipheriv") continue;
    
    const args = call.getArguments();
    if (args.length === 0) continue;
    
    const algoArg = args[0].getText().replace(/['"`]/g, "");
    if (algoArg !== "aes-256-gcm") {
      error(ctx, "Rule 19 Crypto Algorithm",
        `createCipheriv() uses "${algoArg}" — must use "aes-256-gcm" per PII encryption spec. ` +
        `Weaker ciphers (aes-128-cbc, aes-256-cbc) do not meet Pillar 3 security requirements.`);
    }
  }
};
```

### Step 9: Update chaos-v2.ts with new rule violations

**File:** `scripts/chaos-tests/chaos-v2.ts`

**What:** Add intentional violations for Rules 16-19 so `bun check:chaos` verifies them.

**New sections to add:**
```ts
// ═══ RULE 16: Port Injection — no direct adapter instantiation in core/ ═══
// (This violation block lives in a file path containing /core/ to trigger the rule)
function orchestratorWithDirectInstantiation() {
  const store = new SupabaseContactStore();   // VIOLATION: direct instantiation
  const retriever = new Neo4jGraphRetriever(); // VIOLATION: direct instantiation
}

// ═══ RULE 17: Circuit Breaker — adapter calls must be wrapped ═══
// (This violation block lives in a file named orchestrator.ts to trigger)
class OrchestratorViolation {
  async processIntent() {
    await this.graphRetriever.expandFromContact("id"); // VIOLATION: no breaker
  }
}

// ═══ RULE 18: WebSocket Boundary — .on() handlers must Zod-parse ═══
async function supabaseRealtimeHandler() {
  supabase.channel("deals").on("INSERT", (payload: unknown) => {
    console.log(payload);  // VIOLATION: no Zod parse of WebSocket payload
  });
}

// ═══ RULE 19: Crypto Algorithm — must use aes-256-gcm ═══
// declare const createCipheriv: any; // stub
function weakEncryption() {
  const cipher = createCipheriv("aes-128-cbc", key, iv);  // VIOLATION: weak cipher
}
```

However, Rules 16 and 17 are path-scoped (only fire in `/core/` paths), so the chaos test file won't trigger them from `scripts/chaos-tests/`. We solve this by adding a separate chaos file at `packages/ai-core/src/core/__chaos_violations__.ts` that exercises Rules 14, 16, 17 in the correct path scope. This file is excluded from the full sweep (added to a skip list in resolveSourceFiles) but included in `--chaos` mode.

**Alternative (simpler):** Use `--chaos` mode to scan `scripts/chaos-tests/` AND a special `packages/ai-core/src/__chaos__/` directory for path-scoped rules. The `isChaos` branch in `resolveSourceFiles` already handles this.

### Step 10: Update firewall rule list and scan paths

**File:** `scripts/ast-firewall.ts`

**Changes:**
1. Update `ALL_RULES` array to include rules 16-19
2. Update `resolveSourceFiles` chaos mode to also scan `packages/ai-core/src/__chaos__/**/*.ts`
3. Update all rule count references from "15" to "19"
4. Update comment header from "15 Rules, 6 Domains" to "19 Rules, 7 Domains" (add Domain G: Architecture Enforcement)

### Step 11: Update SKILL.md

**File:** `.trae/skills/ast-firewall/SKILL.md`

**Changes:** Update rule list from 15 to 19, add new Domain G, update rule descriptions.

### Step 12: Create .knowledge/ast-firewall-coverage.md

**New file:** `.knowledge/ast-firewall-coverage.md`

This document catalogs:
- Every AST firewall rule with its spec requirement it enforces
- What each rule CAN detect (compile-time structural patterns)
- What each rule CANNOT detect (runtime behavior, semantic correctness)
- A table mapping spec requirements to their enforcement mechanism (AST rule, runtime check, or both)

## Assumptions & Decisions

1. **Rule 16 (Port Injection) is path-scoped to `/core/`** only. Feature files and adapters are allowed to instantiate their own adapter classes (adapters implementing ports need to instantiate dependencies like `createClient()`).

2. **Rule 17 (Circuit Breaker) is path-scoped to orchestrator files** (`/core/orchestrator`). It's reasonable to expect circuit breakers at the orchestration boundary. Adapter internals may not need their own breakers.

3. **Rule 18 (WebSocket Boundary) is a soft check** — it only flags `.on()` handlers that appear to access `payload`/`data`/`event`/`message`/`body` without Zod parsing. Pure logging handlers (e.g., `.on("disconnect", () => logger.info("gone"))`) won't be flagged.

4. **Rule 19 (Crypto Algorithm) is a simple string-check** on the first argument to `createCipheriv()`. It won't catch dynamic algorithm selection (`const algo = getAlgo(); createCipheriv(algo, ...)`) but that pattern is rare in static code.

5. **Chaos test for path-scoped rules** uses a separate directory `packages/ai-core/src/__chaos__/` that `--chaos` mode scans. Full sweep skips `__chaos__` directories. The existing `scripts/chaos-tests/` continues to hold the non-path-scoped violations (Rules 1-13, 15, 18, 19).

6. **Rule 14 (Span Coverage) change** from hardcoded files to directory-scoped means it will also scan adapter files. Adapter files that call external services (fetch, session.run, etc.) should have spans — this is correct per the spec ("every step that calls an external adapter is wrapped in tracer.startActiveSpan()").

## Verification

1. `bun check` — 0 violations on current codebase (stubs in packages/ai-core/src/ with .gitkeep only)
2. `bun check:chaos` — expected violations count increases from 47 to ~55 (4 new rules × ~2 violations each)
3. All existing chaos violations still fire (Rules 1-15 unchanged except patched gaps)
4. New rules 16-19 fire correctly in chaos test
5. `.knowledge/ast-firewall-coverage.md` exists with complete mapping
