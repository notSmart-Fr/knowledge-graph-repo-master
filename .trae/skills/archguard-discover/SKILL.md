---
name: "archguard-discover"
description: "Scans codebase to discover trust boundaries, dependency graph, output surfaces, and resource/mutation points. Parses package.json for tech context using the 5 Escape Hatch Questions. Invoke FIRST in the archguard pipeline, before archguard-clarify."
---

# ArchGuard Discover

Phase 1 + Phase 2 of the architectural guard generator. Scans the codebase automatically to produce the 4 structural maps and the tech context. No user interaction needed.

## Pipeline Position

```
archguard-discover → archguard-clarify → archguard-plan → archguard-implement
         ↑ You are here
```

## Prerequisites

- A TypeScript/JavaScript project with `package.json` at the root.
- If ESLint or ArchUnit configs already exist, note them — implement will merge, not overwrite.

## Procedure

### Step 1: Parse package.json

Read `package.json`. Extract:
- `dependencies` + `devDependencies` → full dependency list
- `type` field → `"module"` or `"commonjs"` (default)
- `packageManager` → pnpm/npm/yarn/bun
- `workspaces` → monorepo structure if present

Step 2.1: Map discovered directories to architectural roles

For each top-level source directory, classify it by scanning for common patterns:
- If a directory contains files that import from other directories but are rarely imported themselves → likely `core-layer`
- If a directory primarily contains external integrations (DB, HTTP clients, SDKs) → likely `adapter-layer`
- If a directory contains configuration/schemas/environment files → likely `config-layer`

Fallback for whitelist paths:
- If no clear `<core-layer>` found → default to `src/utils/` or `lib/`
- If no clear `<adapter-layer>` found → default to `src/integrations/` or `src/lib/`
- If no clear `<config-layer>` found → default to `src/config/`

The whitelist file names (e.g., `safe-parse.ts`) are **suggestions**. The skill should adapt the exact name to the project's naming conventions (e.g., `safe-parse.ts` vs `parse-utils.ts` vs `validation.ts`).

### Step 2.5: Generate Invariant-Derived Bans

These 13 bans are the axioms. They apply to every project. No user confirmation needed. No dependency check needed — they're universal. Generate them immediately.

| # | Ban | FM | Condition | ESLint Rule / Selector | Whitelist |
|---|-----|-----|-----------|----------------------|-----------|
| 1 | Raw `JSON.parse()` | I.1 / FM1 | Always | `CallExpression[callee.object.name='JSON'][callee.property.name='parse']` | `<core-layer>/safe-parse.ts` |
| 2 | `any` type + `as any` | FM4 | Always | `@typescript-eslint/no-explicit-any: error` | N/A |
| 3 | `@ts-ignore` / `@ts-nocheck` | FM4 | Always | `@typescript-eslint/ban-ts-comment: ['error', {'ts-ignore': true, 'ts-nocheck': true}]` | N/A |
| 4 | `console.log` (and info/warn/debug) | I.3 / FM3 | Always | `CallExpression[callee.object.name='console'][callee.property.name=/^(log\|info\|warn\|debug)$/]` | `<the project's logger file>` |
| 5 | `fetch()` without `AbortSignal` | I.4 / FM4 | If `fetch()` is used | `CallExpression[callee.name='fetch']:not([arguments.1.properties[name='signal']])` | `<adapter-layer>/safe-fetch.ts` |
| 6 | Empty `catch` blocks | I.4 / FM4 | Always | `CatchClause[body.body.length=0]` | N/A |
| 7 | `process.exit()` / `Bun.exit()` | I.5 / FM5 | Node.js or Bun only | `CallExpression[callee.object.name='process'][callee.property.name='exit']` | `<core-layer>/shutdown.ts` |
| 8 | `while(true)` / `for(;;)` + `setInterval` | I.4/FM4 I.5/FM5 | If found | `WhileStatement[test.value=true]`, `ForStatement[init=null][test=null][update=null]`, `CallExpression[callee.name='setInterval']` | N/A |
| 9 | `process.env` outside config | I.1 / FM1 | Node.js only | `MemberExpression[object.object.name='process'][object.property.name='env']` (excl. config dir) | `<config-layer>/env-schema.ts` |
| 10 | `Date.now()` / `new Date()` in business logic | I.4 | **Deferred to clarify** | `NewExpression[callee.name='Date'][arguments.length=0]`, `CallExpression[callee.object.name='Date'][callee.property.name='now']` | `<core-layer>/time-service.ts` |
| 11 | Floating promises (un-awaited) | FM5 / FM4 | Always | `@typescript-eslint/no-floating-promises: error` | N/A |
| 12 | `export *` (barrel exports) | FM3 | Always | `ExportAllDeclaration` | N/A |
| 13 | Mutable module-level state (`let`/`var` at module scope) | FM6 | Always | `VariableDeclaration[kind!='const']:not(:has(ancestor::BlockStatement))` | N/A |

**How to determine whitelist paths:**
- `<core-layer>` = the innermost domain layer discovered in Step 2 (e.g., `core/`, `domain/`, `src/domain/`)
- `<adapter-layer>` = the infrastructure layer (e.g., `adapters/`, `infrastructure/`, `src/infra/`)
- `<config-layer>` = the config directory (e.g., `config/`, `src/config/`)
- If the project has no clear layers, default to `src/utils/` or `lib/`
- The whitelist file name is suggested — adapt to project conventions

**For each ban, check activation conditions:**
- Run `grep fetch(` across the codebase → if matches > 0, ban #5 is active
- Run `grep 'process.exit\|Bun.exit'` → if matches > 0, ban #7 is active
- Run `grep 'while\s*(true)\|for\s*(;;)'` → if matches > 0, ban #8 is active
- Run `grep 'setInterval'` → if matches > 0, ban #8 is active
- Run `grep 'process.env'` → if matches > 0, ban #9 is active (check if any are outside config files)
- If runtime is Deno, skip bans #7 and #9 (Deno uses `Deno.exit` and `Deno.env`)
- Bans #10 is always deferred to `archguard-clarify`
- Bans #11, #12, #13 are always active

### Step 2.6: Generate Whitelist File Specs

For every ban with a whitelist path (not N/A), produce a whitelist file spec. The stub enforces what the ban requires — timeout + signal + validation.

| Ban # | Banned Primitive | Whitelist File | Safety Wrapper |
|-------|-----------------|----------------|----------------|
| 1 | `JSON.parse` | `<core-layer>/safe-parse.ts` | JSON.parse inside Zod.safeParse |
| 4 | `console.log` | `<logger-file>` | Structured logger with trace IDs |
| 5 | `fetch()` | `<adapter-layer>/safe-fetch.ts` | Timeout (AbortSignal) + Zod validation |
| 7 | `process.exit` | `<core-layer>/shutdown.ts` | Graceful SIGTERM/SIGINT handler |
| 9 | `process.env` | `<config-layer>/env-schema.ts` | Centralized env parsing + validation |
| 10 | `Date.now()` / `new Date()` | `<core-layer>/time-service.ts` | Injectable time abstraction |

These go into the output as a `## Whitelist Files` section.

### Step 3: Generate the 4 Maps

For each map, scan using the pattern categories below. The patterns are abstract — the agent determines the concrete search terms from the project's actual dependencies and structure.

Output format per match: `file:line — pattern category — context snippet`

#### MAP A: Trust Boundaries (data enters the system from outside)

Search for these categories of entry points:

| Category | What to look for | How to find it |
|----------|-----------------|----------------|
| **HTTP request objects** | Framework-specific request body/params/query access | Grep the codebase for the HTTP framework found in dependencies. Common patterns: `req.body`, `req.params`, `request.json()`, `ctx.request.body` — match against the framework actually used. |
| **WebSocket / realtime events** | Inbound message handlers | `.on('message'`, `.onmessage`, `.subscribe(`, event listener callbacks on socket/connection objects |
| **CLI / process arguments** | Command-line input | `process.argv`, environment variable reads (`process.env`), stdin reads |
| **File system reads** | File content ingested as data | `fs.readFile`, `fs.createReadStream`, `Bun.file()`, `Deno.readFile` |
| **Job queue consumers** | Background job payloads | Worker `process()` callbacks, queue consumer registration |
| **Browser / platform events** | User-triggered events | `addEventListener(`, `postMessage` handlers, URL/query parameter reads |

#### MAP B: Dependency Graph (import relationships between layers)

First, identify the project's layer boundaries by analyzing directory structure and import conventions:

```
1. List all directories that contain source code
2. Identify "inner" layers (domain logic, business rules, core) and "outer" layers (infrastructure, adapters, drivers, entrypoints, UI)
3. Classify each directory by role:
   - Domain/Core: pure business logic, port interfaces
   - Infrastructure/Adapters: concrete implementations of ports
   - Entrypoints/Transport: HTTP controllers, CLI commands, WebSocket handlers
   - Features/Modules: vertical slices that compose domain + infrastructure
   - Apps/UI: frontend application code
   - Scripts: one-off utilities, workers, seeders
4. Determine which dependency directions are ALLOWED vs BANNED based on the project's architecture
```

Then, for each import statement, flag cross-boundary imports that violate the allowed direction:

```
FM2 candidates:
  - Domain layer importing from Infrastructure/Adapters (should depend on ports, not concrete impls)
  - Domain layer importing from Features
  - Server-side code importing browser-only libraries (detect by package name containing "client" or peer deps on DOM)
  - Entrypoints importing from other entrypoints
  - Any import that crosses from inner → outer in the dependency onion
```

#### MAP C: Output Surfaces (data leaves the system)

Search for these categories of exit points:

| Category | What to look for | How to find it |
|----------|-----------------|----------------|
| **HTTP responses** | Data returned to clients | Response methods: `.json()`, `.send()`, `.end()`, `return` in route handlers |
| **Logging calls** | Data written to logs | Structured logger calls (`.info(`, `.error(`, `.warn(`, `.debug(`), console methods |
| **Telemetry / tracing** | Data sent to observability | `span.setAttribute(`, `span.addEvent(`, `setTag(`, metric recording |
| **WebSocket outbound** | Data sent to connected clients | `.send(`, `.emit(`, `.broadcast(` |
| **Error propagation** | Error details returned to callers | Error constructors with metadata, error response builders, `throw new` with detailed messages |

#### MAP D: Resources + Mutations (connections opened, state written)

Search for these categories:

| Category | What to look for | How to find it |
|----------|-----------------|----------------|
| **Database mutations** | Data persisted | For EACH database driver found in dependencies: find its write methods (e.g., `.insert(`, `.update(`, `.delete(`, `.upsert(`, `.execute(`, `.run(`). Use the driver's actual API, not hardcoded names. |
| **Database queries** | Data read operations | For EACH database driver: find its read methods. Check for string interpolation / template literal usage (FM1 overlap). |
| **Stream/file handles** | OS resources opened | `createWriteStream`, `createReadStream`, `open(`, file descriptor operations |
| **Crypto operations** | Encryption/decryption | `createCipheriv`, `createDecipheriv`, `generateKeyPair`, WebCrypto `encrypt`/`decrypt` |
| **Realtime connections** | Persistent sockets | For EACH realtime/WebSocket library found in dependencies: find its connect/open/join methods |
| **Process termination** | Ungraceful shutdown | `process.exit(`, `Deno.exit(`, runtime-specific exit calls |
| **External network calls** | Outbound HTTP | `fetch(`, framework-specific HTTP clients from dependencies |

**FM6 detection (multi-mutation):** For each function body, count consecutive calls to write methods. If 3+ mutations appear sequentially without a transaction/atomic wrapper, flag as FM6 candidate.

### Step 4: Tech Context — The 5 Escape Hatch Questions

**Do NOT use a hardcoded catalog.** For EACH dependency found in `package.json`, apply these 5 questions to derive tech-specific bans. The questions are universal. The answers come from the dependency's API surface.

For each dependency, run through all 5 questions:

---

**Q1: Raw escape hatch?** Does this library allow passing raw/untrusted strings to an engine/interpreter/query processor?

*How to check:* Look at the library's primary query/execute method signature. Does it accept template literals or string concatenation? If yes → ban the raw variant, force parameterized/safe API.

*FM mapping:* **FM1 (Trusts Input)** — raw strings mean untrusted data reaches the engine.

*Example discoveries (NOT a fixed catalog):*
- A database driver with `.query(template\`SELECT ${x}\`)` → ban template expressions in query calls
- An ORM with `.$queryRaw\`\`` → ban raw query methods
- A shell/exec library with `exec(userInput)` → ban string arguments to exec

---

**Q2: Unbounded default?** Does this library allow creation of long-running/expensive operations without explicit limits?

*How to check:* Look at the constructor/config signature. Does it have optional maxSteps/maxTokens/maxRetries/timeout/maxConnections? If a limit parameter exists but is optional → ban instantiation without it.

*FM mapping:* **FM4 (Ignores Failure)** — unbounded operations are DoS/time bombs.

*Example discoveries:*
- An agent framework with `new Agent({})` and optional `maxSteps` → require maxSteps
- An AI SDK with optional `maxTokens` → require explicit token limit
- A connection pool with optional `max` → require explicit max connections

---

**Q3: Trust boundary?** Is this library's output treated as trusted/safe by the rest of the application?

*How to check:* Does this library produce data that flows into storage, user-facing responses, or downstream systems? If yes → its output must pass through validation/sanitization before use.

*FM mapping:* **FM1 (Trusts Input)** if output enters internal state. **FM3 (Leaks State)** if output reaches external surfaces.

*Example discoveries:*
- An AI/LLM SDK → output must be sanitized before storage or user-facing return
- A file parser/deserializer → parsed content must be validated before use
- A user-content renderer (markdown/html) → output must be sanitized for XSS

---

**Q4: Client/server split?** Does this library have platform-specific variants (browser-only, Node-only, Deno-only)?

*How to check:* Check the package name/description for platform indicators. Check peer dependencies for DOM/Node APIs. If a variant is platform-specific → ban its import in the wrong platform context.

*FM mapping:* **FM2 (Inverts Dependencies)** — platform-specific code in wrong context.

*Example discoveries:*
- A library with "client" in name + DOM peer deps → ban in server-side paths
- A library with "server" in name + Node peer deps → ban in browser entrypoints
- A React Native-specific library → ban in web-only code

---

**Q5: Missing timeout?** Can this library's primary operations be called without a deadline/abort mechanism?

*How to check:* Look at the call signature. Does it accept timeout/signal/AbortController? If the parameter exists but is optional → ban calls without it. If the library has no timeout mechanism at all → flag as risk (needs wrapper).

*FM mapping:* **FM4 (Ignores Failure)** — no timeout means thread starvation on hang.

*Example discoveries:*
- `fetch(url)` without second argument → ban, require `{ signal }`
- Database query method without timeout option → require explicit timeout config
- File read without timeout → low risk but note if large files expected

---

**After all 5 questions:** For each dependency that triggers a ban, output:
```
DEP: <package-name>
  Q1: [yes/no] → <ban description> → FM1
  Q2: [yes/no] → <ban description> → FM4
  Q3: [yes/no] → <ban description> → FM1/FM3
  Q4: [yes/no] → <ban description> → FM2
  Q5: [yes/no] → <ban description> → FM4
```

Dependencies with all "no" answers need no bans. That's fine — not every dependency is a risk.

### Step 5: Write Output

Write TWO outputs:

#### Output A: Human-readable (`.archguard/discover.md`)

```markdown
# ArchGuard Discover Output

## Project Context
- Runtime: (from tsconfig/package.json)
- Package Manager: (from packageManager field)
- Project Structure: (monorepo/single, layer layout)
- Dependencies: (count + notable packages)

## Invariant-Derived Bans (Auto)
[Always applied. No user confirmation needed.]

| Ban | FM | Active? | Selector | Whitelist |
|-----|-----|---------|----------|-----------|
| 1. Raw JSON.parse | I.1 / FM1 | yes | `CallExpression[...]` | `<path>` |
| 2. any type + as any | FM4 | yes | `@typescript-eslint/no-explicit-any` | N/A |
| 3. @ts-ignore / @ts-nocheck | FM4 | yes | `@typescript-eslint/ban-ts-comment` | N/A |
| 4. console.log | I.3 / FM3 | yes | `CallExpression[...]` | `<logger-file>` |
| 5. fetch() without signal | I.4 / FM4 | yes/no | `CallExpression[...]` | `<safe-fetch>` |
| 6. Empty catch | I.4 / FM4 | yes | `CatchClause[...]` | N/A |
| 7. process.exit | I.5 / FM5 | yes/no | `CallExpression[...]` | `<shutdown-handler>` |
| 8. Unbounded loops + setInterval | I.4/FM4 I.5/FM5 | yes/no | `WhileStatement[...]` | N/A |
| 9. process.env (non-config) | I.1 / FM1 | yes/no | `MemberExpression[...]` | `<env-schema>` |
| 10. Date.now() / new Date() | I.4 | deferred | N/A — promoted to clarify | N/A |
| 11. Floating promises | FM5 / FM4 | yes | `@typescript-eslint/no-floating-promises` | N/A |
| 12. export * (barrel exports) | FM3 | yes | `ExportAllDeclaration` | N/A |
| 13. Mutable module-level state | FM6 | yes | `VariableDeclaration[...]` | N/A |

## Whitelist Files
[For each ban with a whitelist path]

| Primitive | File | Safety Wrapper |
|-----------|------|----------------|
| JSON.parse | <path> | JSON.parse inside Zod.safeParse |
| console.log | <path> | Structured logger with trace IDs |
| fetch() | <path> | Timeout (AbortSignal) + Zod validation |
| process.exit | <path> | Graceful SIGTERM/SIGINT handler |
| process.env | <path> | Centralized env parsing + validation |
| Date.now() / new Date() | <path> | Injectable time abstraction |

## Map A: Trust Boundaries
- Count: N matches across M files
- Top files by match count: ...
- Categories found: [HTTP routes, WebSocket, CLI, File I/O, Job queues]

## Map B: Dependency Graph
- Layer structure: [list layers and their roles]
- Allowed directions: [layer X → layer Y]
- FM2 candidates (violating allowed directions): [...]
- Platform-split candidates (Q4): [...]

## Map C: Output Surfaces
- Count: N matches across M files
- Categories found: [HTTP responses, Logging, Telemetry, WebSocket out, Error propagation]

## Map D: Resources & Mutations
- Count: N matches across M files
- Categories found: [DB mutations, DB queries, Streams, Crypto, Realtime connections, Network calls]
- FM6 candidates (3+ sequential mutations in same function): [...]

## Tech Context (5 Escape Hatch Questions)
[For each dependency that triggered a "yes" to any question]:

### DEP: <package-name>
- Q1 (raw escape): [yes/no] → <ban> → <FM#>
- Q2 (unbounded): [yes/no] → <ban> → <FM#>
- Q3 (trust boundary): [yes/no] → <ban> → <FM#>
- Q4 (platform split): [yes/no] → <ban> → <FM#>
- Q5 (no timeout): [yes/no] → <ban> → <FM#>

### Dependencies with no risks
[List packages that passed all 5 questions — no bans needed]
```

#### Output B: Machine-readable JSON maps (`.archguard/maps/`)

Create the directory `.archguard/maps/` and write these four files. These are the **source of truth** for incremental updates via `archguard-analyze`.

**`.archguard/maps/trust-boundaries.json`**
```json
{
  "map": "trust-boundaries",
  "generatedAt": "<ISO timestamp>",
  "totalCount": N,
  "entries": [
    {
      "file": "<relative path>",
      "line": <number>,
      "category": "<HTTP request | WebSocket | CLI | File I/O | Job queue | Browser event>",
      "pattern": "<the concrete pattern matched, e.g. req.body>",
      "context": "<surrounding code snippet, max 120 chars>",
      "fm": "FM1"
    }
  ]
}
```

**`.archguard/maps/dependency-graph.json`**
```json
{
  "map": "dependency-graph",
  "generatedAt": "<ISO timestamp>",
  "layers": [
    { "path": "<directory>", "role": "<Domain | Infrastructure | Entrypoints | Features | Apps | Scripts>" }
  ],
  "allowedDirections": [["Domain", "Ports"], ["Infrastructure", "Domain"]],
  "violations": [
    {
      "file": "<relative path>",
      "line": <number>,
      "imports": "<imported module specifier>",
      "fromLayer": "<layer role>",
      "toLayer": "<layer role>",
      "fm": "FM2"
    }
  ],
  "platformSplits": [
    {
      "file": "<relative path>",
      "line": <number>,
      "package": "<package name>",
      "expectedPlatform": "<browser | server>",
      "actualPlatform": "<browser | server>",
      "fm": "FM2"
    }
  ]
}
```

**`.archguard/maps/output-surfaces.json`**
```json
{
  "map": "output-surfaces",
  "generatedAt": "<ISO timestamp>",
  "totalCount": N,
  "entries": [
    {
      "file": "<relative path>",
      "line": <number>,
      "category": "<HTTP response | Logging | Telemetry | WebSocket outbound | Error propagation>",
      "pattern": "<the concrete pattern matched>",
      "context": "<surrounding code snippet, max 120 chars>",
      "fm": "FM3"
    }
  ]
}
```

**`.archguard/maps/resources-mutations.json`**
```json
{
  "map": "resources-mutations",
  "generatedAt": "<ISO timestamp>",
  "totalCount": N,
  "entries": [
    {
      "file": "<relative path>",
      "line": <number>,
      "category": "<DB mutation | DB query | Stream | Crypto | Realtime | Network call | Process termination>",
      "pattern": "<the concrete pattern matched>",
      "context": "<surrounding code snippet, max 120 chars>",
      "fm": "<FM1 | FM4 | FM5 | FM6>"
    }
  ],
  "fm6Candidates": [
    {
      "file": "<relative path>",
      "line": <number>,
      "functionName": "<function or anonymous>",
      "mutationCount": <number>,
      "hasTransaction": false
    }
  ]
}
```

Also write **`.archguard/tech-context.json`**:
```json
{
  "generatedAt": "<ISO timestamp>",
  "dependencies": {
    "<package-name>": {
      "installedVersion": "<semver from package.json>",
      "q1_rawEscape": { "triggered": true, "ban": "<description>", "fm": "FM1" },
      "q2_unbounded": { "triggered": false },
      "q3_trustBoundary": { "triggered": true, "ban": "<description>", "fm": "FM1" },
      "q4_platformSplit": { "triggered": false },
      "q5_noTimeout": { "triggered": true, "ban": "<description>", "fm": "FM4" }
    }
  }
}
```

Also write **`.archguard/maps/.meta.json`** (baseline for incremental analysis):

```json
{
  "generatedAt": "<ISO timestamp>",
  "lastCommitHash": "<git rev-parse HEAD at time of scan>",
  "lastAnalyzedAt": "<ISO timestamp>"
}
```

This gives `archguard-analyze --changed` a valid commit SHA to diff against from the very first incremental run.

## Constraints

- **Do NOT modify existing config files.** This skill is read-only scanning.
- **Do NOT ask the user questions.** All questions are left for archguard-clarify.
- **Do NOT generate config files.** That's archguard-implement's job.
- **Do NOT hardcode dependency names or directory structures.** Use the actual project's package.json and file tree.
- **The 5 questions are universal.** Apply them to every dependency. Skip none.
- **The 10 invariant bans are universal.** Always generate them. Let conditions determine active/inactive.
- **Write both outputs.** The JSON maps enable incremental `archguard-analyze` runs. The markdown is for human review and clarify.
- If a directory doesn't exist, note it and skip — don't create it.
- If `package.json` is missing, abort and tell the user this only works for Node.js projects.
