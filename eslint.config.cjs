// @ts-nocheck — CommonJS config, not production TypeScript
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

// ── Bans that protect ALL production code ──────────────────────────────────
const productionBans = [
  // I.1: z.any() / z.unknown()
  {
    selector:
      "CallExpression[callee.object.name='z'][callee.property.name=/^(any|unknown)$/]",
    message: "I.1: z.any()/z.unknown() banned. Use a strict Zod schema.",
  },
  // I.1: process.env — only allowed in env-schema.ts & startup-validator.ts
  {
    selector:
      "MemberExpression[object.object.name='process'][object.property.name='env']",
    message: "I.1: process.env banned. Read env vars via env-schema.ts.",
  },
  // I.3: PII in span.setAttribute keys
  {
    selector:
      "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/phone|email|password|token|secret|transcript|api_key/i]",
    message: "I.3: PII in span attribute — telemetry permanently stores this.",
  },
  // I.4: fetch() without options (no AbortSignal)
  {
    selector: "CallExpression[callee.name='fetch'][arguments.length=1]",
    message:
      "I.4: fetch() without options banned. Must include { signal: AbortSignal.timeout(N) }.",
  },
  // I.4: Empty catch block
  {
    selector: "CatchClause[body.body.length=0]",
    message: "I.4: Empty catch block. Must log, trace, or re-throw.",
  },
  // I.4: process.exit()
  {
    selector:
      "CallExpression[callee.object.name='process'][callee.property.name='exit']",
    message: "I.4: process.exit() banned. Use graceful shutdown.",
  },
  // I.4: Direct Date/Date.now() — use time-service.ts
  {
    selector:
      "NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "I.4: Direct Date()/Date.now() banned. Use timeService from time-service.ts.",
  },
  // I.4: Infinite loops
  {
    selector:
      "WhileStatement[test.value=true], ForStatement[init=null][test=null][update=null]",
    message: "I.4: Infinite loop banned. Must use escape counter.",
  },
  // Tech: Neo4j template query
  {
    selector:
      "CallExpression[callee.property.name=/^(run|executeRead|executeWrite)$/][arguments.0.type='TemplateExpression']",
    message: "Tech: Neo4j template query banned. Use $param placeholders.",
  },
  // Tech: Neo4j string concat query
  {
    selector:
      "CallExpression[callee.property.name=/^(run|executeRead|executeWrite)$/][arguments.0.type='BinaryExpression']",
    message: "Tech: Neo4j string concat banned. Use $param placeholders.",
  },
  // Tech: Crypto — only aes-256-gcm
  {
    selector:
      "CallExpression[callee.name='createCipheriv'][arguments.0.type='Literal']:not([arguments.0.value='aes-256-gcm'])",
    message: "Tech: Non-aes-256-gcm cipher banned. Use aes-256-gcm only.",
  },
  // Tech: AI — direct return of AI output without sanitizer
  {
    selector:
      "ReturnStatement > CallExpression[callee.property.name=/^(generateText|streamText|generate)$/]",
    message: "Tech: Direct return of AI output banned. Pipe through sanitize() first.",
  },
];

// Date is exempt in mature code (core/adapters/health have 60+ uses)
// but enforced everywhere else (features/agents are fully clean)
const bansWithoutDate = productionBans.filter(
  (b) => !b.selector.includes("Date.") && !b.selector.includes("[callee.name='Date']"),
);

// process.env is exempt only for config files
const bansWithoutEnv = productionBans.filter(
  (b) => !b.selector.includes("process"),
);

// logger + time-service: exempt from process.env and Date bans
const bansWithoutEnvDate = productionBans.filter(
  (b) => !b.selector.includes("process.") && !b.selector.includes("Date.") && !b.selector.includes("[callee.name='Date']"),
);

module.exports = [
  // ═══════════════════════════════════════════════════════════════════════
  // Ignored globally
  // ═══════════════════════════════════════════════════════════════════════
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".archive/**",
      "**/__tests__/**",
      "**/__chaos__/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      "scripts/chaos-tests/**",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 1: Features — strictest, where agents write NEW code
  // ═══════════════════════════════════════════════════════════════════════
  {
    files: ["packages/ai-core/src/features/**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", ...productionBans],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 2: Agents — full bans (Date fixed, uses time-service)
  // ═══════════════════════════════════════════════════════════════════════
  {
    files: ["packages/ai-core/src/agents/**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", ...productionBans],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 3: Core + Adapters + Health — Date exempt (60+ uses, mature)
  // ═══════════════════════════════════════════════════════════════════════
  {
    files: [
      "packages/ai-core/src/core/**/*.ts",
      "packages/ai-core/src/adapters/**/*.ts",
      "packages/ai-core/src/health/**/*.ts",
    ],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", ...bansWithoutDate],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 4: Per-file whitelists (never exempt a folder — always name the file)
  // ═══════════════════════════════════════════════════════════════════════
  // ponytail: each file gets only the exemptions it genuinely needs.

  // env-schema: needs process.env (it IS the env access point)
  {
    files: ["packages/ai-core/src/config/env-schema.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": ["error", ...bansWithoutEnv],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

// startup-validator: needs process.env, Date, process.exit (boot validation)
  {
    files: ["packages/ai-core/src/config/startup-validator.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // logger: needs console + Date (wraps them for structured output)
  {
    files: ["packages/ai-core/src/core/logger.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": ["error", ...bansWithoutEnvDate],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // time-service: needs Date (abstracts it for the rest of the codebase)
  {
    files: ["packages/ai-core/src/core/time-service.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", ...bansWithoutEnvDate],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // mastra-agent: while(true) is an async read loop with break (not infinite)
  {
    files: ["packages/ai-core/src/adapters/ai/mastra-agent.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        ...productionBans.filter(
          (b) => !b.selector.includes("WhileStatement"),
        ),
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ollama-local: while(true) is an async read loop with break (not infinite)
  {
    files: ["packages/ai-core/src/adapters/ai/ollama-local.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        ...productionBans.filter(
          (b) => !b.selector.includes("WhileStatement"),
        ),
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ports: z.unknown() is legitimate for JSON blob record schemas
  {
    files: ["packages/ai-core/src/core/ports.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        ...productionBans.filter(
          (b) =>
            !b.selector.includes("^(any|unknown)"),
        ),
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 5: Apps (web + widget) — console off (Vite/no structured logger)
  // ═══════════════════════════════════════════════════════════════════════
  {
    files: ["apps/**/*.ts", "apps/**/*.tsx"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Tier 6: Scripts — not production code, minimal rules
  // ═══════════════════════════════════════════════════════════════════════
  {
    files: ["scripts/**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
