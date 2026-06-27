/**
 * AST Security Firewall v3 — 19 Rules, 7 Domains
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
// ── Helpers ──────────────────────────────────────────────────────────────
function ancestorsOf(node) {
    const result = [];
    let current = node.getParent();
    while (current) {
        result.push(current);
        current = current.getParent();
    }
    return result;
}
function hasAncestorCall(node, methodNames) {
    for (const ancestor of ancestorsOf(node)) {
        if (Node.isCallExpression(ancestor)) {
            const expr = ancestor.getExpression();
            if (Node.isPropertyAccessExpression(expr)) {
                if (methodNames.includes(expr.getName()))
                    return true;
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
function hasSiblingParse(fetchCall, methodNames) {
    // Walk up from fetchCall to find the enclosing VariableDeclaration
    let varDecl = fetchCall.getParent();
    while (varDecl && !Node.isVariableDeclaration(varDecl)) {
        varDecl = varDecl.getParent();
    }
    if (!varDecl)
        return false;
    const varName = varDecl.getName();
    // Find the enclosing block (function / try / if body, etc.)
    let block = varDecl.getParent();
    while (block && !Node.isBlock(block) && !Node.isSourceFile(block)) {
        block = block.getParent();
    }
    if (!block || !(Node.isBlock(block) || Node.isSourceFile(block)))
        return false;
    // Walk statements after the fetch-containing statement.
    // Track intermediate variables assigned from varName.json() so that
    //   const raw = await response.json(); Schema.parse(raw);
    // is accepted alongside the direct Schema.parse(await response.json()).
    const stmts = Node.isBlock(block)
        ? block.getStatements()
        : block.getStatements();
    const jsonVars = new Set();
    for (const stmt of stmts) {
        if (stmt.getPos() <= fetchCall.getPos())
            continue;
        // Detect intermediate: const raw = await response.json()
        for (const vd of stmt.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
            const init = vd.getInitializer();
            if (!init)
                continue;
            // Match `response.json()` anywhere in the initializer text
            if (init.getText().includes(`${varName}.json()`)) {
                jsonVars.add(vd.getName());
            }
        }
        for (const call of stmt.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const expr = call.getExpression();
            if (!Node.isPropertyAccessExpression(expr))
                continue;
            if (!methodNames.includes(expr.getName()))
                continue;
            const args = call.getArguments();
            if (args.length === 0)
                continue;
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
function error(gate, rule, detail) {
    gate.violationCount++;
    process.stderr.write(`❌ ${rule} in [${gate.relativePath}]:\n   ${detail}\n`);
}
// ── Scan target resolution ───────────────────────────────────────────────
function resolveSourceFiles(project, isChaos, targetPath) {
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
        if (fs.existsSync(abs))
            project.addSourceFileAtPath(script);
    }
}
// ═══════════════════════════════════════════════════════════════════════════
// Domain A: Zod Boundary Safety
// ═══════════════════════════════════════════════════════════════════════════
const rule1_SchemaConstraints = (ctx) => {
    // Only scan files likely to contain Mastra tools or Zod schemas
    if (!ctx.normalizedPath.includes("/tools/") &&
        !ctx.normalizedPath.includes("/schemas/") &&
        !ctx.normalizedPath.endsWith("Tool.ts") &&
        !ctx.normalizedPath.endsWith("Schema.ts"))
        return;
    for (const v of ctx.sourceFile.getVariableDeclarations()) {
        if (!v.isExported())
            continue;
        if (!v.getName().endsWith("Schema"))
            continue;
        const init = v.getInitializer();
        if (!init)
            continue;
        for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const exprText = call.getExpression().getText();
            if (exprText === "z.string") {
                if (!hasAncestorCall(call, ["max", "uuid", "email", "url", "min"])) {
                    error(ctx, "Rule 1 Schema Constraint", `Exported schema "${v.getName()}" has unconstrained z.string() — add .max().`);
                }
            }
            if (exprText === "z.number") {
                let hasMin = hasAncestorCall(call, ["min", "positive", "nonnegative"]);
                let hasMax = hasAncestorCall(call, ["max"]);
                if (!hasMin || !hasMax) {
                    error(ctx, "Rule 1 Schema Constraint", `Exported schema "${v.getName()}" has unconstrained z.number() — add .min() and .max().`);
                }
            }
        }
    }
};
const rule2_AntiCheat = (ctx) => {
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (!Node.isPropertyAccessExpression(expr))
            continue;
        const method = expr.getName();
        if (!["parse", "parseAsync", "safeParse"].includes(method))
            continue;
        const sub = expr.getExpression();
        if (!Node.isCallExpression(sub))
            continue;
        const subExpr = sub.getExpression();
        if (!Node.isPropertyAccessExpression(subExpr))
            continue;
        const zMethod = subExpr.getName(); // any | unknown
        if (subExpr.getExpression().getText() === "z" &&
            ["any", "unknown"].includes(zMethod)) {
            error(ctx, "Rule 2 Anti-Cheat", `z.${zMethod}().${method}() bypasses structural validation. Use a real schema.`);
        }
    }
};
const rule3_BoundaryZodWrap = (ctx) => {
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const exprText = call.getExpression().getText();
        const isFetch = exprText === "fetch" || exprText.endsWith(".fetch") || exprText === "Bun.fetch";
        if (!isFetch)
            continue;
        const parseMethods = ["parse", "parseAsync", "safeParse"];
        if (!hasAncestorCall(call, parseMethods) &&
            !hasSiblingParse(call, parseMethods)) {
            error(ctx, "Rule 3 Boundary Zod Wrap", `fetch() / Bun.fetch() must be wrapped in Schema.parse() or .safeParse(). ` +
                `Untrusted network data cannot enter internal state raw.`);
        }
    }
};
const rule18_WebSocketBoundary = (ctx) => {
    if (!/\.on\(/.test(ctx.fileText))
        return;
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (!Node.isPropertyAccessExpression(expr))
            continue;
        if (expr.getName() !== "on")
            continue;
        const args = call.getArguments();
        const callback = args[args.length - 1];
        if (!callback)
            continue;
        const callbackText = callback.getText();
        // Only flag handlers accessing payload/data/message/text without Zod parse
        if (!/payload|data|message|text|event|body/.test(callbackText))
            continue;
        if (/\.(parse|parseAsync|safeParse)\(/.test(callbackText))
            continue;
        error(ctx, "Rule 18 WebSocket Boundary", `WebSocket/realtime event handler ".on()" must Zod.parse() untrusted incoming payload. ` +
            `Untrusted WebSocket data cannot enter internal state raw — same as fetch() boundary.`);
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Domain B: Error & Resilience
// ═══════════════════════════════════════════════════════════════════════════
const rule4_CatchTypeGuard = (ctx) => {
    for (const catchClause of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
        const varDecl = catchClause.getVariableDeclaration();
        if (varDecl) {
            const varName = varDecl.getName();
            const typeNode = varDecl.getTypeNode();
            // Must be typed : unknown
            if (!typeNode || typeNode.getKind() !== SyntaxKind.UnknownKeyword) {
                error(ctx, "Rule 4 Catch Type-Guard", `Catch variable "${varName}" must be explicitly typed as ": unknown".`);
            }
            const block = catchClause.getBlock();
            const statements = block.getStatements();
            // Empty catch forbidden
            if (statements.length === 0) {
                error(ctx, "Rule 4 Catch Type-Guard", `Catch block for "${varName}" is empty — must log, trace, or re-throw.`);
                continue;
            }
            const blockText = block.getText();
            // Ban "as any" casts
            if (new RegExp(`\\(\\s*${varName}\\s+as\\s+any\\s*\\)`).test(blockText)) {
                error(ctx, "Rule 4 Catch Type-Guard", `Catch variable "${varName}" must not be cast with "as any".`);
            }
            // .message access requires instanceof guard
            if (new RegExp(`\\b${varName}\\.message\\b`).test(blockText)) {
                if (!new RegExp(`${varName}\\s+instanceof\\s+(Error|IntegrationError|DatabaseDomainError|GraphTraversalError|CacheError)`)
                    .test(blockText)) {
                    error(ctx, "Rule 4 Catch Type-Guard", `Accessing "${varName}.message" requires an instanceof Error guard first.`);
                }
            }
        }
    }
};
const rule5_DataErrorPII = (ctx) => {
    const piiPattern = /\b(phone|email|transcript|text|password|token|secret|api_key|access_key|private_key)\b/i;
    // Check domain error constructors (IntegrationError, DatabaseDomainError, etc.)
    const domainErrors = new Set([
        "IntegrationError", "DatabaseDomainError", "GraphTraversalError", "CacheError",
    ]);
    for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        if (!domainErrors.has(ne.getExpression().getText()))
            continue;
        const args = ne.getArguments();
        if (args.length < 3)
            continue;
        const meta = args[2];
        if (!Node.isObjectLiteralExpression(meta))
            continue;
        for (const prop of meta.getProperties()) {
            if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop))
                continue;
            const propName = Node.isPropertyAssignment(prop) ? prop.getName() : prop.getName();
            if (piiPattern.test(propName)) {
                error(ctx, "Rule 5 Error PII", `Error metadata key "${propName}" may contain raw PII — use structural attributes only.`);
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
        if (!isConsoleError && !isLoggerCall)
            continue;
        for (const arg of call.getArguments()) {
            if (Node.isIdentifier(arg) && piiPattern.test(arg.getText())) {
                const loggerType = isConsoleError ? "console.error" : `logger.${expr.getName()}`;
                error(ctx, "Rule 5 Error PII", `${loggerType} must not pass unvetted PII identifier "${arg.getText()}".`);
            }
        }
    }
};
const rule6_GracefulShutdown = (ctx) => {
    const hasExit = /process\.exit\(|Bun\.exit\(/.test(ctx.fileText);
    if (!hasExit)
        return;
    const hasSigterm = /process\.on\(["']SIGTERM["']/.test(ctx.fileText);
    const hasSigint = /process\.on\(["']SIGINT["']/.test(ctx.fileText);
    if (!(hasSigterm && hasSigint)) {
        error(ctx, "Rule 6 Graceful Shutdown", "File contains process.exit()/Bun.exit() but missing SIGTERM and/or SIGINT handler. " +
            "Ungraceful exits orphan queues and leak connections.");
    }
};
const rule17_CircuitBreaker = (ctx) => {
    if (!ctx.normalizedPath.includes("/core/orchestrator"))
        return;
    const hasCircuitBreakerImport = /withCircuitBreaker|CircuitBreaker|breaker\./.test(ctx.fileText);
    if (!hasCircuitBreakerImport) {
        error(ctx, "Rule 17 Circuit Breaker", "Orchestrator has no circuit breaker import/usage. All external adapter calls must be wrapped.");
    }
    else {
        // Check if adapter calls are wrapped in breaker.invoke() or similar
        const adapterPatterns = [
            /this\.graphRetriever\./, /this\.embeddingProvider\./, /this\.agentProvider\./,
            /this\.contactStore\./, /this\.dealStore\./, /this\.callStore\./,
            /this\.cacheStore\./, /this\.idempotencyStore\./,
        ];
        for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const exprText = call.getExpression().getText();
            if (!adapterPatterns.some(p => p.test(exprText)))
                continue;
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
                error(ctx, "Rule 17 Circuit Breaker", `Adapter call "${exprText}" is not wrapped in circuit breaker. Use breaker.invoke(() => ...).`);
            }
        }
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Domain C: Query Injection & Data Integrity
// ═══════════════════════════════════════════════════════════════════════════
const rule7_Neo4jParameterized = (ctx) => {
    if (!ctx.fileText.includes("session.run") && !ctx.fileText.includes("tx.run"))
        return;
    // Find .run() calls
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (!Node.isPropertyAccessExpression(expr))
            continue;
        if (expr.getName() !== "run")
            continue;
        // First arg is the Cypher string
        const args = call.getArguments();
        if (args.length === 0)
            continue;
        const firstArg = args[0];
        const firstArgText = firstArg.getText();
        // Template literal with interpolation = danger
        if (firstArg.getKind() === SyntaxKind.TemplateExpression) {
            const spans = firstArg.getTemplateSpans?.() || [];
            for (const span of spans) {
                const exprText = span.getExpression().getText();
                // Parameters like { key } in template literals are captured as expressions
                // The span expression is the interpolation — if it's not just a param reference, flag it
                if (exprText && !/^\s*params\.\w+\s*$/.test(exprText) && !/^\s*\w+\s*$/.test(exprText)) {
                    // This is suspicious inline interpolation
                    error(ctx, "Rule 7 Neo4j Parameterized", `Cypher query uses string interpolation (template literal with \${...}). ` +
                        `Use parameterized queries: session.run(query, { key: value }).`);
                    break;
                }
            }
        }
        // String concatenation
        if (firstArg.getKind() === SyntaxKind.BinaryExpression) {
            error(ctx, "Rule 7 Neo4j Parameterized", `Cypher query uses string concatenation (+). ` +
                `Use parameterized queries: session.run(query, { key: value }).`);
        }
        // Check if second arg (params map) exists
        if (args.length < 2) {
            // Only flag if the query string looks dynamic
            if (firstArg.getKind() === SyntaxKind.TemplateExpression) {
                error(ctx, "Rule 7 Neo4j Parameterized", `Cypher query has a template string but no parameter map as second argument. ` +
                    `Use session.run(query, { key: value }).`);
            }
        }
    }
};
const rule8_SupabaseRLS = (ctx) => {
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
    if (!hasSupabase)
        return;
    // Flag raw SQL that bypasses RLS
    if (/\.rpc\(/.test(ctx.fileText)) {
        // Allow .rpc() but warn if used for data access bypassing RLS
        // This is a soft check — we flag .rpc combined with suspicious patterns
        if (/\.rpc\(["'][^"']*(?:bypass|as_admin|service_role)[^"']*["']/i.test(ctx.fileText)) {
            error(ctx, "Rule 8 Supabase RLS", `Detected .rpc() call suggesting RLS bypass. ` +
                `Use supabase client methods (.from().select()) with RLS policies instead.`);
        }
    }
    // Flag raw SQL/pg access in supabase files
    if (/sql`/.test(ctx.fileText) || /pg\.query/.test(ctx.fileText)) {
        error(ctx, "Rule 8 Supabase RLS", `Raw SQL (sql\`\` / pg.query) in supabase client file bypasses RLS. ` +
            `Use supabase.from().select() chain or verify RLS policies cover this query.`);
    }
};
const rule9_PGVectorOperator = (ctx) => {
    if (!ctx.fileText.includes("_embedding"))
        return;
    // Check that file contains native distance operator if it references vector tables
    if (!/<=>|<\->/.test(ctx.fileText)) {
        error(ctx, "Rule 9 PG Vector Operator", `Query referencing embedding columns must use native distance operator (<=> or <->). ` +
            `Never pull vectors into JS memory for distance computation.`);
    }
};
const rule19_CryptoAlgorithm = (ctx) => {
    if (!ctx.fileText.includes("createCipheriv"))
        return;
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (call.getExpression().getText() !== "createCipheriv")
            continue;
        const args = call.getArguments();
        if (args.length === 0)
            continue;
        const algoArg = args[0].getText().replace(/['"`]/g, "");
        if (algoArg !== "aes-256-gcm") {
            error(ctx, "Rule 19 Crypto Algorithm", `createCipheriv() uses "${algoArg}" — must use "aes-256-gcm" per PII encryption spec.`);
        }
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Domain D: AI Pipeline Integrity
// ═══════════════════════════════════════════════════════════════════════════
const rule10_OutputSanitization = (ctx) => {
    let hasAIOutput = false;
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const exprText = call.getExpression().getText();
        if (/streamText$|generateText$|\.streamText$|\.generateText$|\.generate\(|\.stream\(/.test(exprText)) {
            hasAIOutput = true;
            break;
        }
    }
    if (!hasAIOutput)
        return;
    if (!ctx.fileText.includes("validateAndFilterOutput") &&
        !ctx.fileText.includes("sanitizeOutput")) {
        error(ctx, "Rule 10 Output Sanitization", `AI output (streamText/generateText/agent.generate) must be sanitized with ` +
            `"validateAndFilterOutput" or "sanitizeOutput" before storage or user-facing return.`);
    }
};
const rule11_MastraToolContract = (ctx) => {
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (call.getExpression().getText() !== "createTool")
            continue;
        const args = call.getArguments();
        if (args.length === 0 || !Node.isObjectLiteralExpression(args[0]))
            continue;
        const config = args[0];
        // Check id
        const idProp = config.getProperty("id");
        if (idProp && Node.isPropertyAssignment(idProp)) {
            const idVal = idProp.getInitializer()?.getText()?.replace(/['"`]/g, "") || "";
            if (!/^[a-z0-9-]+$/.test(idVal)) {
                error(ctx, "Rule 11 Mastra Tool Contract", `Tool id "${idVal}" must be a lowercase alphanumeric slug (a-z, 0-9, hyphens).`);
            }
        }
        else {
            error(ctx, "Rule 11 Mastra Tool Contract", `createTool() is missing the "id" property.`);
        }
        // Check description length
        const descProp = config.getProperty("description");
        if (descProp && Node.isPropertyAssignment(descProp)) {
            const descVal = descProp.getInitializer()?.getText()?.replace(/['"`]/g, "") || "";
            if (descVal.length < 20) {
                error(ctx, "Rule 11 Mastra Tool Contract", `Tool description is too short (${descVal.length} chars). Minimum 20 characters required.`);
            }
        }
        else {
            error(ctx, "Rule 11 Mastra Tool Contract", `createTool() is missing the "description" property.`);
        }
        // Check inputSchema
        if (!config.getProperty("inputSchema") && !config.getProperty("schema")) {
            error(ctx, "Rule 11 Mastra Tool Contract", `createTool() is missing "inputSchema" — every tool must have a Zod schema.`);
        }
    }
};
const rule12_AgentStepCeiling = (ctx) => {
    for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        if (ne.getExpression().getText() !== "Agent")
            continue;
        const args = ne.getArguments();
        if (args.length === 0 || !Node.isObjectLiteralExpression(args[0]))
            continue;
        const config = args[0];
        const maxStepsProp = config.getProperty("maxSteps");
        if (!maxStepsProp) {
            error(ctx, "Rule 12 Agent Step Ceiling", `new Agent() must include "maxSteps" (<= 10) to prevent unbounded ReAct loops.`);
            continue;
        }
        if (Node.isPropertyAssignment(maxStepsProp)) {
            const val = parseInt(maxStepsProp.getInitializer()?.getText() || "0", 10);
            if (val > 10 || val <= 0) {
                error(ctx, "Rule 12 Agent Step Ceiling", `Agent maxSteps = ${val}. Must be between 1 and 10 to prevent infinite tool-calling loops.`);
            }
        }
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Domain E: Telemetry & Observability
// ═══════════════════════════════════════════════════════════════════════════
const rule13_SpanPIIGuard = (ctx) => {
    const piiKeys = /\b(phone|email|sender|text|message|transcript|password|token|secret|api_key|access_key|private_key)\b/i;
    // Check setAttribute
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (!Node.isPropertyAccessExpression(expr))
            continue;
        if (expr.getName() !== "setAttribute")
            continue;
        const args = call.getArguments();
        if (args.length === 0)
            continue;
        const keyVal = args[0].getText().toLowerCase().replace(/['"`]/g, "");
        if (piiKeys.test(keyVal)) {
            error(ctx, "Rule 13 Span PII Guard", `OpenTelemetry span attribute "${keyVal}" contains PII. ` +
                `Span attributes are exported to telemetry backends and are permanently queryable.`);
        }
    }
    // Check addEvent attributes
    for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (!Node.isPropertyAccessExpression(expr))
            continue;
        if (expr.getName() !== "addEvent")
            continue;
        const args = call.getArguments();
        if (args.length < 2)
            continue;
        const attrs = args[1];
        if (!Node.isObjectLiteralExpression(attrs))
            continue;
        for (const prop of attrs.getProperties()) {
            if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop))
                continue;
            const propName = (Node.isPropertyAssignment(prop) ? prop.getName() : prop.getName()).toLowerCase();
            if (piiKeys.test(propName)) {
                error(ctx, "Rule 13 Span PII Guard", `OpenTelemetry span addEvent attribute "${propName}" contains PII. ` +
                    `Event attributes are exported to telemetry backends and are permanently queryable.`);
            }
        }
    }
};
const rule14_SpanCoverage = (ctx) => {
    // Only check core and adapters directories
    if (!ctx.normalizedPath.includes("/core/") &&
        !ctx.normalizedPath.includes("/adapters/"))
        return;
    const functions = [
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ];
    for (const fn of functions) {
        // Only check exported functions
        const isExported = fn.isExported?.() ||
            fn.getParentIfKind(SyntaxKind.VariableDeclaration)?.isExported();
        if (!isExported)
            continue;
        const name = fn.getName?.() || fn.getParentIfKind(SyntaxKind.VariableDeclaration)?.getName() || "anonymous";
        const body = fn.getBody?.();
        if (!body)
            continue;
        const bodyText = body.getText();
        // Only require spans if function calls external services
        const callsExternal = /fetch\(|session\.run\(|tx\.run\(|supabase\.|redis\.|createCipheriv\(/.test(bodyText);
        if (!callsExternal)
            continue;
        if (!bodyText.includes("startActiveSpan")) {
            error(ctx, "Rule 14 Span Coverage", `Exported function "${name}" in core/adapters calls external services without tracer.startActiveSpan(). ` +
                `All pipeline boundaries must be traced.`);
        }
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Domain F: Type Safety
// ═══════════════════════════════════════════════════════════════════════════
const rule15_NoAny = (ctx) => {
    // Variables / parameters with explicit : any
    for (const node of [
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Parameter),
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
    ]) {
        const typeNode = node.getTypeNode();
        if (typeNode && typeNode.getKind() === SyntaxKind.AnyKeyword) {
            error(ctx, "Rule 15 No Any", `Explicit "any" type on "${node.getName()}" — use a specific type or "unknown".`);
        }
    }
    // Generic type arguments with any
    for (const ref of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference)) {
        for (const arg of ref.getTypeArguments()) {
            if (arg.getKind() === SyntaxKind.AnyKeyword) {
                error(ctx, "Rule 15 No Any", `Generic type argument "any" in "${ref.getText()}" — use a specific type.`);
            }
        }
    }
    // Return types containing any
    for (const fn of [
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
        ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ]) {
        const returnType = fn.getReturnTypeNode();
        if (returnType && /\bany\b/.test(returnType.getText())) {
            error(ctx, "Rule 15 No Any", `Return type containing "any" — use a specific type.`);
        }
    }
    // "as any" type assertions
    for (const ae of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression)) {
        const typeNode = ae.getTypeNode();
        if (typeNode && typeNode.getKind() === SyntaxKind.AnyKeyword) {
            error(ctx, "Rule 15 No Any", `"as any" type assertion bypasses type checking — use a specific type or "as unknown".`);
        }
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Domain G: Architecture Enforcement
// ═══════════════════════════════════════════════════════════════════════════
const rule16_PortInjection = (ctx) => {
    if (!ctx.normalizedPath.includes("/core/"))
        return;
    const adapterConstructors = [
        "SupabaseContactStore", "SupabaseDealStore", "SupabaseCallStore",
        "SupabaseTicketStore", "SupabaseAccountStore",
        "Neo4jGraphRetriever", "NoOpGraphRetriever",
        "GeminiEmbeddingProvider", "CachedEmbeddingProvider",
        "MastraAgentProvider", "DeepSeekFallbackProvider",
        "RedisIdempotencyStore", "SupabaseIdempotencyStore",
        "BullMQDeadLetterQueue", "FieldEncryption",
    ];
    for (const ne of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        const ctorName = ne.getExpression().getText();
        if (adapterConstructors.includes(ctorName)) {
            error(ctx, "Rule 16 Port Injection", `Direct instantiation of "${ctorName}" in core/ — inject via ports instead (no new adapters in core).`);
        }
    }
};
// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════════════
const ALL_RULES = [
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
    // Domain F: Type Safety
    rule15_NoAny,
    // Domain G: Architecture Enforcement
    rule16_PortInjection,
];
async function executeSweep(targetPath) {
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
        const ctx = {
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
    const passed = totalViolations.count === 0;
    fs.writeFileSync(path.join(process.cwd(), ".gate-results.json"), JSON.stringify({
        passed,
        violationCount: totalViolations.count,
        fileCount: sourceFiles.length,
        timestamp: Date.now(),
    }, null, 2));
    if (passed) {
        console.log("✅ All 19 firewall rules passed. Build allowed.\n");
    }
    else {
        console.error(`\n🚨 BUILD BLOCKED: ${totalViolations.count} structural security violation(s) found across ${sourceFiles.length} file(s).\n`);
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
        watcher.on("add", async (fp) => {
            console.log(`\n📄 File added: ${fp}`);
            await executeSweep(fp);
        });
        watcher.on("change", async (fp) => {
            console.log(`\n📝 File changed: ${fp}`);
            await executeSweep(fp);
        });
        watcher.on("unlink", async () => {
            console.log(`\n🗑️  File removed — re-sweeping...`);
            await executeSweep();
        });
        console.log("👀 Watching for changes...\n");
    }
    else {
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
            fs.writeFileSync(gateResultsPath, JSON.stringify({ passed: false, status: "stale_or_terminated" }, null, 2));
        }
    }
    catch {
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
