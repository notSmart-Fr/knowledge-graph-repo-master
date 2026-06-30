// @ts-nocheck — IDE TS is 6.x, ts-morph is built against 5.x. Runs via `bun run`, not `tsc`.
/**
 * AST Security Firewall v3 — 25 Rules, 7 Domains
 *
 * Compile-time structural verification. Runs as a compiler step — no manual review.
 *
 * Usage:
 *   bun scripts/ast-firewall.ts              # Full sweep (CI / pre-commit)
 *   bun scripts/ast-firewall.ts --watch      # File watcher (dev)
 *   bun scripts/ast-firewall.ts --chaos      # Verify against chaos test suite
 *   bun scripts/ast-firewall.ts <file.ts>    # Single file scan
 *
 * Output: .gate-results.json at repo root. Exit 0 = pass, 1 = build blocked.
 */

import { Project, SyntaxKind, Node } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import chokidar from "chokidar";

// ── Types ────────────────────────────────────────────────────────────────

interface GateContext {
  sourceFile: ReturnType<Project["getSourceFiles"]>[number];
  relativePath: string;
  normalizedPath: string;
  fileText: string;
  violationCount: number;
  project: Project;
}

type RuleFn = (ctx: GateContext) => void;

// ── Helpers ──────────────────────────────────────────────────────────────

function ancestorsOf(node: Node): Node[] {
  const result: Node[] = [];
  let current: Node | undefined = node.getParent();
  while (current) {
    result.push(current);
    current = current.getParent();
  }
  return result;
}

function hasAncestorCall(
  node: Node,
  methodNames: string[],
): boolean {
  for (const ancestor of ancestorsOf(node)) {
    if (Node.isCallExpression(ancestor)) {
      const expr = ancestor.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        if (methodNames.includes(expr.getName())) return true;
      }
    }
  }
  return false;
}

/**
 * After a `const v = await fetch(...)` that isn't wrapped in .parse() as an
 * ancestor, check whether sibling statements later feed v (or its .json())
 * into a Schema.parse() / .safeParse() call.  This catches the two-statement
 * pattern that the ancestor-only check misses:
 *   const r = await fetch(...); const d = Schema.parse(await r.json());
 */
function hasSiblingParse(
  fetchCall: Node,
  methodNames: string[],
): boolean {
  // Walk up from fetchCall to find the enclosing VariableDeclaration
  let varDecl: Node | undefined = fetchCall.getParent();
  while (varDecl && !Node.isVariableDeclaration(varDecl)) {
    varDecl = varDecl.getParent();
  }
  if (!varDecl) return false;
  const varName = varDecl.getName();

  // Find the enclosing block (function / try / if body, etc.)
  let block: Node | undefined = varDecl.getParent();
  while (block && !Node.isBlock(block) && !Node.isSourceFile(block)) {
    block = block.getParent();
  }
  if (!block || !(Node.isBlock(block) || Node.isSourceFile(block))) return false;

  // Walk statements after the fetch-containing statement.
  // Track intermediate variables assigned from varName.json() so that
  //   const raw = await response.json(); Schema.parse(raw);
  // is accepted alongside the direct Schema.parse(await response.json()).
  const stmts = Node.isBlock(block)
    ? (block as any).getStatements()
    : (block as any).getStatements();
  const jsonVars = new Set<string>();

  for (const stmt of stmts) {
    if (stmt.getPos() <= fetchCall.getPos()) continue;

    // Detect intermediate: const raw = await response.json()
    for (const vd of stmt.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = vd.getInitializer();
      if (!init) continue;
      // Match `response.json()` anywhere in the initializer text
      if (init.getText().includes(`${varName}.json()`)) {
        jsonVars.add(vd.getName());
      }
    }

    for (const call of stmt.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;
      if (!methodNames.includes(expr.getName())) continue;

      const args = call.getArguments();
      if (args.length === 0) continue;
      const argText = args[0].getText();

      // Direct: Schema.parse(response) or Schema.parse(await response.json())
      if (argText === varName || argText.includes(`${varName}.json()`)) {
        return true;
      }
      // Intermediate: const raw = await response.json(); Schema.parse(raw)
       if (jsonVars.has(argText)) {
         return true;
       }
    }
  }
  return false;
}

// ── Violation collection (sorted output) ──────────────────────────────

interface Violation {
  rule: string;
  path: string;
  detail: string;
  ruleNum: number;
}

const violations: Violation[] = [];

function error(gate: GateContext, rule: string, detail: string) {
  gate.violationCount++;
  const m = rule.match(/^Rule (\d+)/);
  const ruleNum = m ? parseInt(m[1], 10) : 99;
  violations.push({ rule, path: gate.relativePath, detail, ruleNum });
}

// Non-blocking warnings — reported but don't fail the build.
// Used for rules that are in phased rollout (existing code needs migration time).
interface Warning {
  rule: string;
  path: string;
  detail: string;
  ruleNum: number;
}
const warnings: Warning[] = [];

function warn(gate: GateContext, rule: string, detail: string) {
  const m = rule.match(/^Rule (\d+)/);
  const ruleNum = m ? parseInt(m[1], 10) : 99;
  warnings.push({ rule, path: gate.relativePath, detail, ruleNum });
}

function flushViolations() {
  // Flush warnings first (non-blocking, advisory only)
  if (warnings.length > 0) {
    warnings.sort((a, b) => a.ruleNum - b.ruleNum);
    for (const w of warnings) {
      process.stderr.write(
        `⚠️  ${w.rule} in [${w.path}]:\n   ${w.detail}\n`,
      );
    }
    warnings.length = 0;
  }
  // Flush blocking violations
  violations.sort((a, b) => a.ruleNum - b.ruleNum);
  for (const v of violations) {
    process.stderr.write(
      `❌ ${v.rule} in [${v.path}]:\n   ${v.detail}\n`,
    );
  }
  violations.length = 0; // reset for next sweep
}

// ── Scan target resolution ───────────────────────────────────────────────

function resolveSourceFiles(project: Project, isChaos: boolean, targetPath?: string): void {
  if (isChaos) {
    console.log("☣️  Running Chaos Test Suite Verification...");
    project.addSourceFilesAtPaths("scripts/chaos-tests/**/*.ts");
    project.addSourceFilesAtPaths("scripts/chaos-tests/**/*.tsx");
    project.addSourceFilesAtPaths("packages/ai-core/src/__chaos__/**/*.ts");
    return;
  }

  if (targetPath) {
    const abs = path.resolve(process.cwd(), targetPath.replace(/\\/g, "/"));
    if (!fs.existsSync(abs)) {
      console.error(`❌ File not found: ${targetPath}`);
      process.exit(1);
    }
    project.addSourceFileAtPath(abs);
    console.log(`🔎 Target file: ${targetPath}`);
    return;
  }

  // Full sweep — only scan directories that exist, exclude __chaos__
  const dirs = [
    "packages/ai-core/src",
    "apps/web/src",
    "apps/web/app",
  ];
  for (const dir of dirs) {
    const absDir = path.resolve(process.cwd(), dir);
    if (fs.existsSync(absDir)) {
      project.addSourceFilesAtPaths([`${dir}/**/*.ts`, `!${dir}/**/__chaos__/**`]);
      project.addSourceFilesAtPaths([`${dir}/**/*.tsx`, `!${dir}/**/__chaos__/**`]);
    }
  }
  // Scripts (only scan load-env.ts for now)
  for (const script of ["scripts/load-env.ts"]) {
    const abs = path.resolve(process.cwd(), script);
    if (fs.existsSync(abs)) project.addSourceFileAtPath(script);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain A: Zod Boundary Safety
// ═══════════════════════════════════════════════════════════════════════════

const rule1_SchemaConstraints: RuleFn = (ctx) => {
  // Only scan files likely to contain Mastra tools or Zod schemas
  if (
    !ctx.normalizedPath.includes("/tools/") &&
    !ctx.normalizedPath.includes("/schemas/") &&
    !ctx.normalizedPath.endsWith("Tool.ts") &&
    !ctx.normalizedPath.endsWith("Schema.ts")
  ) return;

  for (const v of ctx.sourceFile.getVariableDeclarations()) {
    if (!v.isExported()) continue;
    if (!v.getName().endsWith("Schema")) continue;
    const init = v.getInitializer();
    if (!init) continue;

    for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();

      if (exprText === "z.string") {
        if (!hasAncestorCall(call, ["max", "uuid", "email", "url", "min"])) {
          error(ctx, "Rule 1 Schema Constraint",
            `Exported schema "${v.getName()}" has unconstrained z.string() — add .max().`);
        }
      }

      if (exprText === "z.number") {
        let hasMin = hasAncestorCall(call, ["min", "positive", "nonnegative"]);
        let hasMax = hasAncestorCall(call, ["max"]);
        if (!hasMin || !hasMax) {
          error(ctx, "Rule 1 Schema Constraint",
            `Exported schema "${v.getName()}" has unconstrained z.number() — add .min() and .max().`);
        }
      }
    }
  }
};

const rule2_AntiCheat: RuleFn = (ctx) => {
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const method = expr.getName();
    if (!["parse", "parseAsync", "safeParse"].includes(method)) continue;

    const sub = expr.getExpression();
    if (!Node.isCallExpression(sub)) continue;
    const subExpr = sub.getExpression();
    if (!Node.isPropertyAccessExpression(subExpr)) continue;

    const zMethod = subExpr.getName(); // any | unknown

    if (
      subExpr.getExpression().getText() === "z" &&
      ["any", "unknown"].includes(zMethod)
    ) {
      error(ctx, "Rule 2 Anti-Cheat",
        `z.${zMethod}().${method}() bypasses structural validation. Use a real schema.`);
    }
  }
};

const rule3_BoundaryZodWrap: RuleFn = (ctx) => {
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const exprText = expr.getText();

    // ponytail: catch any fetch call — direct, property-access (.fetch), or Bun.fetch variants
    const isFetch = exprText === "fetch"
      || exprText.endsWith(".fetch")
      || (Node.isPropertyAccessExpression(expr) && expr.getName() === "fetch");

    if (!isFetch) continue;

    const parseMethods = ["parse", "parseAsync", "safeParse"];
    if (
      !hasAncestorCall(call, parseMethods) &&
      !hasSiblingParse(call, parseMethods)
    ) {
      error(ctx, "Rule 3 Boundary Zod Wrap",
        `fetch() / Bun.fetch() must be wrapped in Schema.parse() or .safeParse(). ` +
        `Untrusted network data cannot enter internal state raw.`);
    }
  }
};

const rule18_WebSocketBoundary: RuleFn = (ctx) => {
  // ponytail: check for any realtime/websocket subscription pattern — not just .on()
  const hasRealtime = /\.on\(|\.subscribe\(/.test(ctx.fileText);
  if (!hasRealtime) return;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const methodName = expr.getName();
    if (methodName !== "on" && methodName !== "subscribe") continue;

    const args = call.getArguments();
    // .on("event", callback) or .subscribe(callback) — find the last function arg
    const callback = [...args].reverse().find(a =>
      Node.isArrowFunction(a) || Node.isFunctionExpression(a)
    );
    if (!callback) continue;

    // Use AST traversal on the body — NEVER regex on text (comments contain false positives)
    const body = (callback as any).getBody?.();
    if (!body) continue;

    const bodyText = body.getText();
    if (!/payload|data|message|text|event|body/.test(bodyText)) continue;

    // AST-based parse detection — catches both property access and destructured calls
    const parseCalls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
    const hasZodParse = parseCalls.some(c => {
      const ce = c.getExpression();
      if (Node.isPropertyAccessExpression(ce)) {
        return ["parse", "parseAsync", "safeParse"].includes(ce.getName());
      }
      return ["parse", "parseAsync", "safeParse"].includes(ce.getText());
    });

    if (!hasZodParse) {
      error(ctx, "Rule 18 WebSocket Boundary",
        `WebSocket/realtime handler ".${methodName}()" must Zod.parse() untrusted incoming payload. ` +
        `Untrusted WebSocket data cannot enter internal state raw — same as fetch() boundary.`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Domain B: Error & Resilience
// ═══════════════════════════════════════════════════════════════════════════

const rule4_CatchTypeGuard: RuleFn = (ctx) => {
  for (const catchClause of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const varDecl = catchClause.getVariableDeclaration();

    if (varDecl) {
      const varName = varDecl.getName();
      const typeNode = varDecl.getTypeNode();

      // Must be typed : unknown
      if (!typeNode || typeNode.getKind() !== SyntaxKind.UnknownKeyword) {
        error(ctx, "Rule 4 Catch Type-Guard",
          `Catch variable "${varName}" must be explicitly typed as ": unknown".`);
      }

      const block = catchClause.getBlock();
      const statements = block.getStatements();

      // Empty catch forbidden
      if (statements.length === 0) {
        error(ctx, "Rule 4 Catch Type-Guard",
          `Catch block for "${varName}" is empty — must log, trace, or re-throw.`);
        continue;
      }

      const blockText = block.getText();

      // Ban "as any" casts
      if (new RegExp(`\\(\\s*${varName}\\s+as\\s+any\\s*\\)`).test(blockText)) {
        error(ctx, "Rule 4 Catch Type-Guard",
          `Catch variable "${varName}" must not be cast with "as any".`);
      }

      // .message access requires instanceof guard
      if (new RegExp(`\\b${varName}\\.message\\b`).test(blockText)) {
        if (
          !new RegExp(`${varName}\\s+instanceof\\s+(Error|IntegrationError|DatabaseDomainError|GraphTraversalError|CacheError)`)
            .test(blockText)
        ) {
          error(ctx, "Rule 4 Catch Type-Guard",
            `Accessing "${varName}.message" requires an instanceof Error guard first.`);
        }
      }
    }
  }
};

const rule5_DataErrorPII: RuleFn = (ctx) => {
  const piiPattern = /\b(phone|email|transcript|text|password|token|secret|api_key|access_key|private_key)\b/i;

  // Check domain error constructors (IntegrationError, DatabaseDomainError, etc.)
  const domainErrors = new Set([
    "IntegrationError", "DatabaseDomainError", "GraphTraversalError", "CacheError",
  ]);
  for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (!domainErrors.has(ne.getExpression().getText())) continue;
    const args = ne.getArguments();
    if (args.length < 3) continue;
    const meta = args[2];
    if (!Node.isObjectLiteralExpression(meta)) continue;

    for (const prop of meta.getProperties()) {
      if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) continue;
      const propName = Node.isPropertyAssignment(prop) ? prop.getName() : prop.getName();
      if (piiPattern.test(propName)) {
        error(ctx, "Rule 5 Error PII",
          `Error metadata key "${propName}" may contain raw PII — use structural attributes only.`);
      }
    }
  }

  // Check console.error AND logger.* calls (info, warn, debug, error)
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const isConsoleError = expr.getText() === "console.error";

    let isLoggerCall = false;
    if (Node.isPropertyAccessExpression(expr)) {
      const base = expr.getExpression().getText();
      const method = expr.getName();
      if (base === "logger" && ["info", "warn", "debug", "error"].includes(method)) {
        isLoggerCall = true;
      }
    }

    if (!isConsoleError && !isLoggerCall) continue;

    const loggerType = isConsoleError ? "console.error"
      : `logger.${(expr as any).getName?.() ?? "?"}`;

    for (const arg of call.getArguments()) {
      // Identifier references: console.error(email) where email is a PII-named var
      if (Node.isIdentifier(arg) && piiPattern.test(arg.getText())) {
        error(ctx, "Rule 5 Error PII",
          `${loggerType} must not pass unvetted PII identifier "${arg.getText()}".`);
      }

      // String literals containing PII-looking content
      if (Node.isStringLiteral(arg)) {
        const val = arg.getLiteralValue();
        if (typeof val === "string" && piiPattern.test(val)) {
          // ponytail: only flag if the literal looks like actual data, not a key name
          if (val.length > 3) {
            error(ctx, "Rule 5 Error PII",
              `${loggerType} must not pass string literal that looks like PII: "${val.slice(0, 40)}..."`);
          }
        }
      }

      // Object literals: check property names (not values, too expensive to track)
      if (Node.isObjectLiteralExpression(arg)) {
        for (const prop of arg.getProperties()) {
          if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) continue;
          const propName = Node.isPropertyAssignment(prop) ? prop.getName() : prop.getName();
          if (piiPattern.test(propName)) {
            error(ctx, "Rule 5 Error PII",
              `${loggerType} object has PII property name "${propName}" — use structural attributes only.`);
          }
        }
      }
    }
  }
};

const rule6_GracefulShutdown: RuleFn = (ctx) => {
  const hasExit = /process\.exit\(|Bun\.exit\(/.test(ctx.fileText);
  if (!hasExit) return;

  // ponytail: check both process.on and process.once
  const hasSigterm = /process\.on(?:ce)?\(["']SIGTERM["']/.test(ctx.fileText);
  const hasSigint = /process\.on(?:ce)?\(["']SIGINT["']/.test(ctx.fileText);

  if (!(hasSigterm && hasSigint)) {
    error(ctx, "Rule 6 Graceful Shutdown",
      "File contains process.exit()/Bun.exit() but missing SIGTERM and/or SIGINT handler. " +
      "Ungraceful exits orphan queues and leak connections.");
  }
};

const rule17_CircuitBreaker: RuleFn = (ctx) => {
  // ponytail: pattern match — catches orchestrator/, orchestrator.ts, orchestrator-v2.ts, etc.
  // Also catches apps/core/orchestrator and nested core/orchestrator/** variants.
  const isOrchestrator = ctx.normalizedPath.includes("/core/") &&
    /orchestrator/i.test(ctx.normalizedPath);
  if (!isOrchestrator) return;

  const hasCircuitBreakerImport = /withCircuitBreaker|CircuitBreaker|breaker\./.test(ctx.fileText);
  if (!hasCircuitBreakerImport) {
    error(ctx, "Rule 17 Circuit Breaker",
      "Orchestrator has no circuit breaker import/usage. All external adapter calls must be wrapped.");
  } else {
    // Check if adapter calls are wrapped in breaker.invoke() or similar
    const adapterPatterns = [
      /this\.graphRetriever\./, /this\.embeddingProvider\./, /this\.agentProvider\./,
      /this\.contactStore\./, /this\.dealStore\./, /this\.callStore\./,
      /this\.cacheStore\./, /this\.idempotencyStore\./,
    ];
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      if (!adapterPatterns.some(p => p.test(exprText))) continue;

      // Check ancestors for circuit breaker wrapper
      let parent = call.getParent();
      let wrapped = false;
      while (parent) {
        if (Node.isCallExpression(parent)) {
          const parentExprText = parent.getExpression().getText();
          if (parentExprText.includes("breaker.") || 
              parentExprText.includes("invoke") || 
              parentExprText.includes("withCircuitBreaker")) {
            wrapped = true;
            break;
          }
        }
        parent = parent.getParent();
      }
      if (!wrapped) {
        error(ctx, "Rule 17 Circuit Breaker",
          `Adapter call "${exprText}" is not wrapped in circuit breaker. Use breaker.invoke(() => ...).`);
      }
    }
  }
};

/**
 * Constitutional source: II-a Timeout Standards — "Every external adapter call SHALL
 *   respect per-service timeout bounds" (5–30s per adapter table)
 * Domain: Resilience
 * Lazy-agent shortcut: fetch(url) without AbortController/signal — "it responds in 50ms in dev"
 * Enforcement: pattern-based
 */
const rule20_FetchTimeout: RuleFn = (ctx) => {
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const exprText = expr.getText();

    // Match any fetch variant: direct fetch(), property-access .fetch(), Bun.fetch
    const isFetch = exprText === "fetch"
      || exprText.endsWith(".fetch")
      || (Node.isPropertyAccessExpression(expr) && expr.getName() === "fetch");
    if (!isFetch) continue;

    const args = call.getArguments();
    // fetch(url) with no second arg = no timeout signal
    if (args.length < 2) {
      error(ctx, "Rule 20 FetchTimeout",
        `fetch() call has no options argument — must include { signal: AbortSignal.timeout(N) }.`);
      continue;
    }

    // Second arg exists — check for signal in options object
    const opts = args[1];
    if (Node.isObjectLiteralExpression(opts)) {
      const signalProp = opts.getProperty("signal");
      if (!signalProp) {
        error(ctx, "Rule 20 FetchTimeout",
          `fetch() options missing "signal" — must include { signal: AbortSignal.timeout(N) } to enforce per-service timeout bounds.`);
      }
    }
  }
};

/**
 * Constitutional source: II-a (timeout defaults configurable via env vars) +
 *   VI (startup validator blocks missing env) — derived: env access without fallback
 *   means no startup-time validation
 * Domain: Resilience
 * Lazy-agent shortcut: process.env.DATABASE_URL without ?? fallback — "it's always set in .env"
 * Enforcement: location-based (scope: exclude config/ and env-schema.ts)
 */
const rule21_EnvVarFallback: RuleFn = (ctx) => {
  if (ctx.normalizedPath.includes("/config/")) return;
  if (ctx.normalizedPath.endsWith("env-schema.ts")) return;

  for (const pe of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pe.getExpression().getText() !== "process.env") continue;
    const varName = pe.getName();
    const parent = pe.getParent();

    // Allow: process.env.X ?? fallback or process.env.X || fallback
    if (Node.isBinaryExpression(parent)) {
      const op = parent.getOperatorToken().getText();
      if (op === "??" || op === "||") continue;
    }

    // Allow: validated by Zod (envSchema.parse(process.env) or Schema.parse(process.env.X))
    let isZodValidated = false;
    let ancestor: Node | undefined = pe;
    while (ancestor) {
      if (Node.isCallExpression(ancestor)) {
        const ce = ancestor.getExpression();
        if (Node.isPropertyAccessExpression(ce)) {
          if (["parse", "safeParse", "parseAsync"].includes(ce.getName())) {
            isZodValidated = true;
            break;
          }
        }
      }
      ancestor = ancestor.getParent();
    }
    if (isZodValidated) continue;

    error(ctx, "Rule 21 EnvVarFallback",
      `process.env.${varName} accessed without ?? fallback or Zod validation. ` +
      `Missing env vars cause runtime crashes — provide a default or parse via env-schema.`);
  }
};

/**
 * Constitutional source: Development Standards naming conventions (*.config.ts) +
 *   Free Tier Budget Awareness (URLs/endpoints/thresholds must be configurable)
 * Domain: Resilience
 * Lazy-agent shortcut: const SUPABASE_URL = "https://xyz.supabase.co" in an adapter —
 *   "I'll move it to config later"
 * Enforcement: location-based (scope: exclude config/ and *.config.ts)
 */
const rule22_NoHardcodedConfig: RuleFn = (ctx) => {
  if (ctx.normalizedPath.includes("/config/")) return;
  if (ctx.normalizedPath.endsWith(".config.ts")) return;

  for (const sl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const val = sl.getLiteralValue();
    if (typeof val !== "string") continue;

    // Hardcoded URLs
    if (/^https?:\/\/|^wss?:\/\//.test(val)) {
      error(ctx, "Rule 22 NoHardcodedConfig",
        `Hardcoded URL "${val.slice(0, 60)}" — move to config/ or a *.config.ts file.`);
      continue;
    }

    // Hardcoded infrastructure addresses with common service ports
    if (/:\d{4,5}/.test(val) &&
        /:(5432|6379|7474|7687|5433|9092|5672|27017|9200|3306|5000|3000|8080|8280)\b/.test(val)) {
      error(ctx, "Rule 22 NoHardcodedConfig",
        `Hardcoded infrastructure address "${val.slice(0, 60)}" — move to config/ or a *.config.ts file.`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Domain C: Query Injection & Data Integrity
// ═══════════════════════════════════════════════════════════════════════════

const rule7_Neo4jParameterized: RuleFn = (ctx) => {
  // ponytail: check for any Neo4j session/tx method that runs cypher — not just .run()
  const hasNeo4jQuery = /session\.(?:run|executeRead|executeWrite)\b|tx\.(?:run|executeRead|executeWrite)\b/.test(ctx.fileText);
  if (!hasNeo4jQuery) return;

  // Find .run() / .executeRead() / .executeWrite() calls
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const methodName = expr.getName();
    if (!["run", "executeRead", "executeWrite"].includes(methodName)) continue;

    // First arg is the Cypher string
    const args = call.getArguments();
    if (args.length === 0) continue;

    const firstArg = args[0];

    // Template literal with interpolation = danger (any interpolation is JS injection)
    if (firstArg.getKind() === SyntaxKind.TemplateExpression) {
      const spans = (firstArg as any).getTemplateSpans?.() || [];
      for (const span of spans) {
        const exprText = span.getExpression().getText();
        if (exprText) {
          // ponytail: any interpolation in a Cypher template literal is injection risk.
          // Users MUST use $param placeholders and pass params as second argument.
          error(ctx, "Rule 7 Neo4j Parameterized",
            `Cypher query uses string interpolation (\${${exprText.slice(0, 30)}}). ` +
            `Use $parameterized Cypher queries: session.run("MATCH ... WHERE n.id = $id", { id: value }).`);
          break;
        }
      }
    }

    // String concatenation
    if (firstArg.getKind() === SyntaxKind.BinaryExpression) {
      error(ctx, "Rule 7 Neo4j Parameterized",
        `Cypher query uses string concatenation (+). ` +
        `Use parameterized queries: session.run(query, { key: value }).`);
    }

    // Check if second arg (params map) exists
    if (args.length < 2) {
      // Only flag if the query string looks dynamic
      if (firstArg.getKind() === SyntaxKind.TemplateExpression) {
        error(ctx, "Rule 7 Neo4j Parameterized",
          `Cypher query has a template string but no parameter map as second argument. ` +
          `Use session.run(query, { key: value }).`);
      }
    }
  }
};

const rule8_SupabaseRLS: RuleFn = (ctx) => {
  // Check for supabase imports OR variable declarations
  let hasSupabase = false;

  // Check imports
  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    if (/supabase|createClient/.test(imp.getModuleSpecifierValue())) {
      hasSupabase = true;
      break;
    }
  }

  // Check variable declarations (covers `const supabase = ...` and `declare const supabase`)
  if (!hasSupabase) {
    for (const vd of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (vd.getName() === "supabase") {
        hasSupabase = true;
        break;
      }
    }
  }

  if (!hasSupabase) return;

  // Flag raw SQL that bypasses RLS
  if (/\.rpc\(/.test(ctx.fileText)) {
    // Allow .rpc() but warn if used for data access bypassing RLS
    // This is a soft check — we flag .rpc combined with suspicious patterns
    if (/\.rpc\(["'][^"']*(?:bypass|as_admin|service_role)[^"']*["']/i.test(ctx.fileText)) {
      error(ctx, "Rule 8 Supabase RLS",
        `Detected .rpc() call suggesting RLS bypass. ` +
        `Use supabase client methods (.from().select()) with RLS policies instead.`);
    }
  }

  // Flag raw SQL/pg access in supabase files
  if (/sql`/.test(ctx.fileText) || /pg\.query/.test(ctx.fileText)) {
    error(ctx, "Rule 8 Supabase RLS",
      `Raw SQL (sql\`\` / pg.query) in supabase client file bypasses RLS. ` +
      `Use supabase.from().select() chain or verify RLS policies cover this query.`);
  }
};

const rule9_PGVectorOperator: RuleFn = (ctx) => {
  if (!ctx.fileText.includes("_embedding")) return;

  // Check that file contains native distance operator if it references vector tables
  if (!/<=>|<\->/.test(ctx.fileText)) {
    error(ctx, "Rule 9 PG Vector Operator",
      `Query referencing embedding columns must use native distance operator (<=> or <->). ` +
      `Never pull vectors into JS memory for distance computation.`);
  }
};

const rule19_CryptoAlgorithm: RuleFn = (ctx) => {
  if (!ctx.fileText.includes("createCipheriv")) return;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "createCipheriv") continue;
    const args = call.getArguments();
    if (args.length === 0) continue;

    const algoArg = args[0].getText().replace(/['"`]/g, "");
    if (algoArg !== "aes-256-gcm") {
      error(ctx, "Rule 19 Crypto Algorithm",
        `createCipheriv() uses "${algoArg}" — must use "aes-256-gcm" per PII encryption spec.`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Domain D: AI Pipeline Integrity
// ═══════════════════════════════════════════════════════════════════════════

const rule10_OutputSanitization: RuleFn = (ctx) => {
  let hasAIOutput = false;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    if (/streamText$|generateText$|\.streamText$|\.generateText$|\.generate\(|\.stream\(/.test(exprText)) {
      hasAIOutput = true;
      break;
    }
  }
  if (!hasAIOutput) return;

  // ponytail: naming-convention based — any function call or import containing sanitize/validate/filter
  const hasSanitizer = /\b(sanitize|validate|filter)\w*(Output|Response|Result|Content)\b/i.test(ctx.fileText);
  if (!hasSanitizer) {
    error(ctx, "Rule 10 Output Sanitization",
      `AI output (streamText/generateText/agent.generate) must be sanitized before storage or user-facing return. ` +
      `Expected a function matching *sanitize*, *validate*, or *filter* before returning AI output.`);
  }
};

const rule11_MastraToolContract: RuleFn = (ctx) => {
  // ponytail: track imported "createTool" identifiers to catch aliases like
  // `import { createTool as makeTool }` — getText() returns "makeTool", not "createTool"
  const createToolAliases = new Set<string>();
  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    for (const named of imp.getNamedImports()) {
      if (named.getNameNode().getText() === "createTool") {
        createToolAliases.add(named.getAliasNode()?.getText() ?? "createTool");
      }
    }
  }
  // Also catch global/ambient createTool
  createToolAliases.add("createTool");

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!createToolAliases.has(call.getExpression().getText())) continue;
    const args = call.getArguments();
    if (args.length === 0 || !Node.isObjectLiteralExpression(args[0])) continue;

    const config = args[0];

    // Check id
    const idProp = config.getProperty("id");
    if (idProp && Node.isPropertyAssignment(idProp)) {
      const idVal = idProp.getInitializer()?.getText()?.replace(/['"`]/g, "") || "";
      if (!/^[a-z0-9-]+$/.test(idVal)) {
        error(ctx, "Rule 11 Mastra Tool Contract",
          `Tool id "${idVal}" must be a lowercase alphanumeric slug (a-z, 0-9, hyphens).`);
      }
    } else {
      error(ctx, "Rule 11 Mastra Tool Contract",
        `createTool() is missing the "id" property.`);
    }

    // Check description length
    const descProp = config.getProperty("description");
    if (descProp && Node.isPropertyAssignment(descProp)) {
      const descVal = descProp.getInitializer()?.getText()?.replace(/['"`]/g, "") || "";
      if (descVal.length < 20) {
        error(ctx, "Rule 11 Mastra Tool Contract",
          `Tool description is too short (${descVal.length} chars). Minimum 20 characters required.`);
      }
    } else {
      error(ctx, "Rule 11 Mastra Tool Contract",
        `createTool() is missing the "description" property.`);
    }

    // Check inputSchema
    if (!config.getProperty("inputSchema") && !config.getProperty("schema")) {
      error(ctx, "Rule 11 Mastra Tool Contract",
        `createTool() is missing "inputSchema" — every tool must have a Zod schema.`);
    }
  }
};

const rule12_AgentStepCeiling: RuleFn = (ctx) => {
  for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (ne.getExpression().getText() !== "Agent") continue;
    const args = ne.getArguments();
    if (args.length === 0 || !Node.isObjectLiteralExpression(args[0])) continue;

    const config = args[0];
    const maxStepsProp = config.getProperty("maxSteps");

    if (!maxStepsProp) {
      error(ctx, "Rule 12 Agent Step Ceiling",
        `new Agent() must include "maxSteps" (<= 10) to prevent unbounded ReAct loops.`);
      continue;
    }

    if (Node.isPropertyAssignment(maxStepsProp)) {
      const val = parseInt(maxStepsProp.getInitializer()?.getText() || "0", 10);
      if (val > 10 || val <= 0) {
        error(ctx, "Rule 12 Agent Step Ceiling",
          `Agent maxSteps = ${val}. Must be between 1 and 10 to prevent infinite tool-calling loops.`);
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Domain E: Telemetry & Observability
// ═══════════════════════════════════════════════════════════════════════════

const rule13_SpanPIIGuard: RuleFn = (ctx) => {
  const piiKeys = /\b(phone|email|sender|text|message|transcript|password|token|secret|api_key|access_key|private_key)\b/i;

  // Check setAttribute
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (expr.getName() !== "setAttribute") continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const keyVal = args[0].getText().toLowerCase().replace(/['"`]/g, "");

    if (piiKeys.test(keyVal)) {
      error(ctx, "Rule 13 Span PII Guard",
        `OpenTelemetry span attribute "${keyVal}" contains PII. ` +
        `Span attributes are exported to telemetry backends and are permanently queryable.`);
    }

    // Value check: if value references a PII-named variable
    if (args.length >= 2) {
      const valText = args[1].getText();
      if (Node.isIdentifier(args[1]) && piiKeys.test(valText)) {
        error(ctx, "Rule 13 Span PII Guard",
          `span.setAttribute("${keyVal}", ${valText}) — value references PII variable "${valText}".`);
      }
    }
  }

  // Check addEvent attributes
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
      const propName = (Node.isPropertyAssignment(prop) ? prop.getName() : prop.getName()).toLowerCase();

      if (piiKeys.test(propName)) {
        error(ctx, "Rule 13 Span PII Guard",
          `OpenTelemetry span addEvent attribute "${propName}" contains PII. ` +
          `Event attributes are exported to telemetry backends and are permanently queryable.`);
      }

      // Value check for property assignments
      if (Node.isPropertyAssignment(prop)) {
        const val = prop.getInitializer();
        if (val && Node.isIdentifier(val) && piiKeys.test(val.getText())) {
          error(ctx, "Rule 13 Span PII Guard",
            `addEvent attribute "${propName}" value references PII variable "${val.getText()}".`);
        }
      }
    }
  }
};

const rule14_SpanCoverage: RuleFn = (ctx) => {
  // Only check core and adapters directories
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
    const isExported = (fn as any).isExported?.() || 
      fn.getParentIfKind(SyntaxKind.VariableDeclaration)?.isExported();
    if (!isExported) continue;

    const name = fn.getName?.() || fn.getParentIfKind(SyntaxKind.VariableDeclaration)?.getName() || "anonymous";
    const body = (fn as any).getBody?.();
    if (!body) continue;

    const bodyText = body.getText();

    // Only require spans if function calls external services
    // ponytail: naming-convention based — catch any adapter/service call pattern
    const callsExternal =
      /fetch\(/.test(bodyText) ||                             // any fetch() variant
      /\.(run|executeRead|executeWrite)\(/.test(bodyText) ||  // Neo4j session/tx methods
      /\.(from|rpc|channel|removeSubscription)\(/.test(bodyText) || // Supabase client
      /createCipheriv\(/.test(bodyText) ||                    // crypto
      /\.(send|publish|subscribe)\(/.test(bodyText) ||        // messaging
      /\.(generate|stream|generateText|streamText)\(/.test(bodyText); // AI
    if (!callsExternal) continue;

    if (!bodyText.includes("startActiveSpan")) {
      error(ctx, "Rule 14 Span Coverage",
        `Exported function "${name}" in core/adapters calls external services without tracer.startActiveSpan(). ` +
        `All pipeline boundaries must be traced.`);
    }
  }
};

/**
 * Constitutional source: V — "All logs MUST be structured JSON with trace_id"
 * Domain: Correctness / Observability
 * Lazy-agent shortcut: console.log("pipeline done") instead of logger.info({...}) —
 *   "I'll add structured logging later"
 * Enforcement: location-based (scope: core/ and adapters/, exclude __tests__/)
 */
const rule23_StructuredLogs: RuleFn = (ctx) => {
  if (!ctx.normalizedPath.includes("/core/") && !ctx.normalizedPath.includes("/adapters/")) return;
  if (ctx.normalizedPath.includes("/__tests__/")) return;
  // ponytail: logger.ts is the structured logger implementation itself;
  // its console.log(JSON.stringify(entry)) is the legitimate output mechanism.
  if (ctx.normalizedPath.endsWith("logger.ts")) return;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (expr.getExpression().getText() !== "console") continue;

    const method = expr.getName();
    // Flag console.log, .info, .warn, .debug — not .error (handled by Rule 5 PII check)
    // Allow console.time / console.timeEnd (legitimate profiling)
    if (["log", "info", "warn", "debug"].includes(method)) {
      error(ctx, "Rule 23 StructuredLogs",
        `console.${method}() in core/adapters — use structured logger (logger.info/warn/error with trace_id). ` +
        `All logs MUST be structured JSON per constitution V.`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Domain F: Type Safety
// ═══════════════════════════════════════════════════════════════════════════

const rule15_NoAny: RuleFn = (ctx) => {
  // Variables / parameters with explicit : any
  for (const node of [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ParameterDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PropertySignature),
  ]) {
    const typeNode = node.getTypeNode();
    if (typeNode && typeNode.getKind() === SyntaxKind.AnyKeyword) {
      const name = (node as any).getName?.() || "(anonymous)";
      error(ctx, "Rule 15 No Any",
        `Explicit "any" type on "${name}" — use a specific type or "unknown".`);
    }
  }

  // Generic type arguments with any
  for (const ref of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference)) {
    for (const arg of ref.getTypeArguments()) {
      if (arg.getKind() === SyntaxKind.AnyKeyword) {
        error(ctx, "Rule 15 No Any",
          `Generic type argument "any" in "${ref.getText()}" — use a specific type.`);
      }
    }
  }

  // Return types containing any — use AST traversal, not regex
  for (const fn of [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ]) {
    const returnType = fn.getReturnTypeNode();
    if (!returnType) continue;
    if (
      returnType.getKind() === SyntaxKind.AnyKeyword ||
      returnType.getDescendantsOfKind(SyntaxKind.AnyKeyword).length > 0
    ) {
      error(ctx, "Rule 15 No Any",
        `Return type containing "any" — use a specific type.`);
    }
  }

  // "as any" type assertions
  for (const ae of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression)) {
    const typeNode = ae.getTypeNode();
    if (typeNode && typeNode.getKind() === SyntaxKind.AnyKeyword) {
      error(ctx, "Rule 15 No Any",
        `"as any" type assertion bypasses type checking — use a specific type or "as unknown".`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Domain G: Architecture Enforcement
// ═══════════════════════════════════════════════════════════════════════════

const rule16_PortInjection: RuleFn = (ctx) => {
  if (!ctx.normalizedPath.includes("/core/")) return;

  // ponytail: naming-convention based detection instead of hardcoded list.
  // Catches new adapters automatically — any constructor ending in Store, Provider, Retriever,
  // or containing "Adapter" / "Encrypt" signals a concrete adapter.
  // Also catches well-known adapter prefixes (Supabase*, Neo4j*, Gemini*, etc.).
  const isAdapterName = (name: string): boolean => {
    if (/^(Supabase|Neo4j|NoOp|Gemini|Cached|Mastra|DeepSeek|Redis|BullMQ|Ollama|Field|LiveKit|Cartesia|Deepgram)/.test(name)) return true;
    if (name.endsWith("Store") || name.endsWith("Provider") || name.endsWith("Retriever")) return true;
    if (name.endsWith("FallbackProvider") || name.endsWith("AgentProvider") || name.endsWith("EmbeddingProvider")) return true;
    if (name.includes("Adapter") || name.includes("Encrypt")) return true;
    return false;
  };

  for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const ctorName = ne.getExpression().getText();
    // Skip native/built-in constructors
    if (/^(Error|Map|Set|Array|Object|Date|Promise|URL|RegExp|Buffer|AbortController|FormData|Headers|Request|Response|TextEncoder|TextDecoder|WeakMap|WeakSet)$/.test(ctorName)) continue;
    if (isAdapterName(ctorName)) {
      error(ctx, "Rule 16 Port Injection",
        `Direct instantiation of "${ctorName}" in core/ — inject via ports instead (no new adapters in core).`);
    }
  }
};

/**
 * Constitutional source: Development Standards / Vertical Feature Slice Structure —
 *   "The core orchestrator SHALL NOT import from feature directories directly —
 *    it depends only on core/ports.ts"
 * Domain: Structural
 * Lazy-agent shortcut: import { ContactTools } from "../../features/contacts/tools" —
 *   faster than going through the port interface
 * Enforcement: location-based (scope: core/, exclude __tests__/ and ports.ts)
 */
const rule25_NoFeatureImports: RuleFn = (ctx) => {
  if (!ctx.normalizedPath.includes("/core/")) return;
  if (ctx.normalizedPath.includes("/__tests__/")) return;
  // ponytail: ports.ts defines interfaces that features reference; it doesn't import from features
  if (ctx.normalizedPath.endsWith("ports.ts")) return;

  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    // Catch relative imports into features/ (../../features/ or ../features/)
    // and absolute imports from features/
    if (/features\//.test(specifier)) {
      error(ctx, "Rule 25 NoFeatureImports",
        `core/ file imports from "${specifier}" — core SHALL depend only on core/ports.ts, not feature directories.`);
    }
  }
};

/**
 * Constitutional source: Development Standards / Naming Conventions —
 *   "Adapter files: *.adapter.ts in adapters/<domain>/"
 * Domain: Structural
 * Lazy-agent shortcut: File named supabase-contacts.ts instead of
 *   supabase-contacts.adapter.ts — "the folder is already named adapters, it's clear enough"
 * Enforcement: location-based (scope: adapters/, allow barrels/types/tests/schemas)
 */
const rule24_AdapterNaming: RuleFn = (ctx) => {
  if (!ctx.normalizedPath.includes("/adapters/")) return;

  const fileName = ctx.normalizedPath.split("/").pop() || "";

  // Allow standard exceptions
  if (fileName.endsWith(".adapter.ts")) return;
  if (fileName === "index.ts") return;
  if (fileName === "types.ts" || fileName.endsWith(".types.ts")) return;
  if (fileName.endsWith(".test.ts")) return;
  if (fileName.endsWith(".schema.ts")) return;

  // ponytail: non-blocking warning — existing adapters need migration time.
  // Upgrade to error() once all adapter files are renamed.
  warn(ctx, "Rule 24 AdapterNaming",
    `Adapter file "${fileName}" must end in .adapter.ts per naming conventions. ` +
    `Barrel files, types, tests, and schemas are exempt.`);
};

// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

const ALL_RULES: RuleFn[] = [
  // Domain A: Zod Boundary Safety
  rule1_SchemaConstraints,
  rule2_AntiCheat,
  rule3_BoundaryZodWrap,
  rule18_WebSocketBoundary,
  // Domain B: Error & Resilience
  rule4_CatchTypeGuard,
  rule5_DataErrorPII,
  rule6_GracefulShutdown,
  rule17_CircuitBreaker,
  rule20_FetchTimeout,
  rule21_EnvVarFallback,
  rule22_NoHardcodedConfig,
  // Domain C: Query Injection & Data Integrity
  rule7_Neo4jParameterized,
  rule8_SupabaseRLS,
  rule9_PGVectorOperator,
  rule19_CryptoAlgorithm,
  // Domain D: AI Pipeline Integrity
  rule10_OutputSanitization,
  rule11_MastraToolContract,
  rule12_AgentStepCeiling,
  // Domain E: Telemetry & Observability
  rule13_SpanPIIGuard,
  rule14_SpanCoverage,
  rule23_StructuredLogs,
  // Domain F: Type Safety
  rule15_NoAny,
  // Domain G: Architecture Enforcement
  rule16_PortInjection,
  rule25_NoFeatureImports,
  rule24_AdapterNaming,
];

async function executeSweep(targetPath?: string): Promise<boolean> {
  const isChaos = process.argv.includes("--chaos");
  const project = new Project();
  resolveSourceFiles(project, isChaos, targetPath);

  const sourceFiles = project.getSourceFiles();
  console.log(`🔎 Scanning ${sourceFiles.length} source file(s)...\n`);

  const totalViolations = { count: 0 };

  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(process.cwd(), sourceFile.getFilePath());
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const fileText = sourceFile.getText();

    const ctx: GateContext = {
      sourceFile,
      relativePath,
      normalizedPath,
      fileText,
      violationCount: 0,
      project,
    };

    for (const rule of ALL_RULES) {
      rule(ctx);
    }

    totalViolations.count += ctx.violationCount;
  }

  // Flush sorted violations
  flushViolations();

  const passed = totalViolations.count === 0;

  fs.writeFileSync(
    path.join(process.cwd(), ".gate-results.json"),
    JSON.stringify(
      {
        passed,
        violationCount: totalViolations.count,
        fileCount: sourceFiles.length,
        timestamp: Date.now(),
      },
      null,
      2,
    ),
  );

  if (passed) {
    console.log("✅ All 25 firewall rules passed. Build allowed.\n");
  } else {
    console.error(
      `\n🚨 BUILD BLOCKED: ${totalViolations.count} structural security violation(s) found across ${sourceFiles.length} file(s).\n`,
    );
  }
  return passed;
}

// ── Execution modes ───────────────────────────────────────────────────────

async function main() {
  const isWatch = process.argv.includes("--watch");

  if (isWatch) {
    console.log("🔥 AST Firewall v2 — Watch Mode\n");
    await executeSweep();

    const watchPaths = [
      "packages/ai-core/src/**/*.ts",
      "packages/ai-core/src/**/*.tsx",
      "apps/web/src/**/*.ts",
      "apps/web/src/**/*.tsx",
      "apps/web/app/**/*.ts",
      "apps/web/app/**/*.tsx",
      "scripts/load-env.ts",
    ].filter((p) => {
      // Only watch directories/files that exist
      const base = p.replace("/**/*.ts", "").replace("/**/*.tsx", "");
      const abs = path.resolve(process.cwd(), base);
      return fs.existsSync(abs);
    });

    const watcher = chokidar.watch(watchPaths.length > 0 ? watchPaths : ["scripts/ast-firewall.ts"], {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on("add", async (fp: string) => {
      console.log(`\n📄 File added: ${fp}`);
      await executeSweep(fp);
    });
    watcher.on("change", async (fp: string) => {
      console.log(`\n📝 File changed: ${fp}`);
      await executeSweep(fp);
    });
    watcher.on("unlink", async () => {
      console.log(`\n🗑️  File removed — re-sweeping...`);
      await executeSweep();
    });

    console.log("👀 Watching for changes...\n");
  } else {
    console.log("🔥 AST Firewall v2 — Single Sweep\n");
    const targetPath = process.argv.slice(2).find((a) => !a.startsWith("-"));
    const passed = await executeSweep(targetPath);
    process.exit(passed ? 0 : 1);
  }
}

// ── Signal cleanup ────────────────────────────────────────────────────────

const gateResultsPath = path.join(process.cwd(), ".gate-results.json");

function flushGateState() {
  try {
    if (fs.existsSync(gateResultsPath)) {
      fs.writeFileSync(
        gateResultsPath,
        JSON.stringify({ passed: false, status: "stale_or_terminated" }, null, 2),
      );
    }
  } catch {
    // best effort
  }
}

process.on("SIGINT", () => {
  flushGateState();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flushGateState();
  process.exit(0);
});

main().catch((err) => {
  console.error("🔥 Firewall crashed:", err);
  process.exit(1);
});
