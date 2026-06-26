# Plan: Refactor Existing Codebase to Spec Alignment

## Summary
Pre-implementation cleanup. Delete e-commerce legacy files, relocate aligned infrastructure, rewrite stale scripts as CRM-domain stubs, and scaffold the `packages/ai-core/` directory structure per spec. No new feature implementation — this is purely rename/delete/relocate/stub work.

## Current State

| Artifact | Verdict | Action |
|---|---|---|
| `scripts/ast-firewall.ts` | Aligned (built for spec) | Keep in place |
| `scripts/chaos-tests/chaos-v2.ts` | Aligned (built for spec) | Keep in place |
| `scripts/chaos-tests/tsconfig.json` | Aligned | Keep in place |
| `scripts/otel-bootstrap.ts` | Semi-aligned (needs CRM metrics, 60s interval) | Move to `packages/ai-core/src/config/` |
| `scripts/load-env.ts` | References deleted `apps/storefront/` | Rewrite for repo root `.env` |
| `scripts/worker.ts` | Imports deleted `@dtc/ai-core`, e-commerce context | Delete (will be recreated in Task 11) |
| `scripts/voice-agent.ts` | Imports deleted `@dtc/ai-core`, e-commerce persona | Delete (will be recreated in Task 11) |
| `scripts/eval-rag.ts` | E-commerce domain, deleted packages | Delete (will be rewritten in Task 13) |
| `scripts/demo-graph-rag.ts` | E-commerce, deleted packages | Delete |
| `scripts/test-cache-cycle.ts` | E-commerce, deleted packages | Delete |
| `scripts/clear-cache.ts` | References deleted dirs, no error handling | Delete |
| `scripts/migrate-cache-embeddings-768.ts` | E-commerce schema, deleted paths | Delete |
| `scripts/db-schema.ts` | Placeholder stub | Delete |
| `scripts/enable-vector.ts` | Placeholder stub | Delete |
| `scripts/test-agent.ts` | Placeholder stub | Delete |
| `.cursor/` | E-commerce skills (storefront-routing, csv-ingestion, react-orchestration, etc.) | Delete entire directory |
| `.knowledge/` | Old demo docs (demo-guide.md, testing.md, README.md, runbook.md) | Delete entire directory |
| `packages/ai-core/` | Does not exist | Create with `package.json`, `tsconfig.json`, `src/` |
| `apps/web/` | Does not exist | Do NOT create (Task 12 handles this) |
| `supabase/config.toml` | Aligned (CRM project_id) | Keep (update db.schemas if needed later) |
| `.env.template` | Aligned (CRM vars) | Keep |
| `bunfig.toml` | Aligned (workspace config) | Keep |
| `package.json` | Aligned (bun scripts, workspace) | Update firewall scan scripts + add new ones |
| `AGENTS.md` | Aligned | Keep |
| `.trae/` | Aligned (rules, skills, specs) | Keep |

## Proposed Changes

### Step 1: Delete legacy artifacts (~15 files)

**What:** Remove all e-commerce and placeholder files that have no CRM role.

**Files to delete:**

1. `.cursor/` — entire directory (7 e-commerce skills + settings.json + mcp.json)
2. `.knowledge/` — entire directory (4 old demo docs)
3. `scripts/demo-graph-rag.ts` — e-commerce product graph demo
4. `scripts/test-cache-cycle.ts` — e-commerce cache cycle test
5. `scripts/clear-cache.ts` — e-commerce cache clearing
6. `scripts/migrate-cache-embeddings-768.ts` — e-commerce PG migration
7. `scripts/db-schema.ts` — placeholder stub
8. `scripts/enable-vector.ts` — placeholder stub
9. `scripts/test-agent.ts` — placeholder stub
10. `scripts/worker.ts` — e-commerce WhatsApp worker (recreated in Task 11)
11. `scripts/voice-agent.ts` — e-commerce voice agent (recreated in Task 11)
12. `scripts/eval-rag.ts` — e-commerce RAG eval (recreated in Task 13)

**Why:** These files reference deleted packages (`@dtc/ai-core`) or deleted directories (`apps/storefront/`, `apps/backend/`), contain e-commerce domain logic that doesn't map to CRM, or are empty placeholder stubs. Tasks 11 and 13 already plan to recreate `worker.ts`, `voice-agent.ts`, and `eval-rag.ts` from scratch with proper CRM context and port injection.

**How:** `DeleteFile` tool for each file, `rm -rf` for directories `.cursor/` and `.knowledge/`.

### Step 2: Create packages/ai-core/ scaffolding

**What:** Create the `packages/ai-core/` monorepo package with `package.json`, `tsconfig.json`, and empty `src/` directory structure matching the spec.

**Files to create:**

1. **`packages/ai-core/package.json`**
   - `"name": "@dtc/ai-core"`, `"type": "module"`, `"main": "./src/index.ts"`
   - Dependencies: `zod`, `@opentelemetry/api`, `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/sdk-node`
   - DevDependencies: `@types/node`

2. **`packages/ai-core/tsconfig.json`**
   - Extends a root `tsconfig.json` or standalone with `strict: true`, `target: "esnext"`, `module: "esnext"`, `moduleResolution: "bundler"`

3. **Root `tsconfig.json`** (doesn't exist yet)
   - Required for the monorepo. Base config with `strict: true`, paths for `@dtc/ai-core` → `packages/ai-core/src`

4. **Empty directory tree** (tracked with `.gitkeep` files):
   ```
   packages/ai-core/src/
   ├── core/
   │   └── .gitkeep
   ├── adapters/
   │   ├── supabase/
   │   │   └── .gitkeep
   │   ├── neo4j/
   │   │   └── .gitkeep
   │   ├── ai/
   │   │   └── .gitkeep
   │   ├── messaging/
   │   │   └── .gitkeep
   │   └── encryption/
   │       └── .gitkeep
   ├── features/
   │   └── .gitkeep
   ├── agents/
   │   └── .gitkeep
   ├── config/
   │   └── .gitkeep
   ├── health/
   │   └── .gitkeep
   └── index.ts          # Barrel export (empty stub)
   ```

**Why:** Tasks 1-8 in tasks.md all depend on `packages/ai-core/` existing. Creating the scaffolding now unblocks implementation. The `.gitkeep` files ensure empty directories are tracked by git so the structure is visible when cloning.

**How:** `Write` tool for each file. `mkdir -Force` for directories (PowerShell). Root `tsconfig.json` with workspace references.

### Step 3: Relocate otel-bootstrap.ts

**What:** Move `scripts/otel-bootstrap.ts` → `packages/ai-core/src/config/otel-bootstrap.ts`.

This is core infrastructure, not a one-off script. The spec defines `config/` under `packages/ai-core/src/` for startup-validator and env-schema. The OTel bootstrap belongs here alongside them.

**Why:** Tasks 10.1 and 13.7 reference extending `scripts/otel-bootstrap.ts`. Moving it to `packages/ai-core/src/config/` keeps all configuration code in one place. Update references in tasks.md accordingly (cosmetic — paths in spec docs are informal).

**How:** Read → Write to new path → Delete old path.

### Step 4: Rewrite load-env.ts

**What:** Rewrite `scripts/load-env.ts` to load `.env` from repo root using Bun's native `.env` loading.

Current state: loads from `apps/backend/.env`, `apps/storefront/.env`, `scripts/.env` — all deleted directories.

New behavior:
```ts
// scripts/load-env.ts
// Loads .env from repo root for any script that needs env vars.
import { join } from "path";

const rootEnvPath = join(import.meta.dir, "..", ".env");
const rootEnvFile = Bun.file(rootEnvPath);

if (await rootEnvFile.exists()) {
  const content = await rootEnvFile.text();
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (match) Bun.env[ match[1] ] = match[2];
  }
}
```

**Why:** `load-env.ts` is referenced by other scripts that need env vars. It must work. Using Bun's `.env` support keeps it minimal — 12 lines instead of the original 35.

**How:** Read old file, write replacement.

### Step 5: Create barrel export stub (index.ts)

**What:** `packages/ai-core/src/index.ts` — minimal barrel export.

```
// packages/ai-core/src/index.ts
// Barrel export — populated as modules are built.
export * from "./core/ports.js";
export * from "./core/errors.js";
export * from "./core/logger.js";
export * from "./core/sanitize.js";
export * from "./core/orchestrator.js";
export * from "./config/env-schema.js";
export * from "./config/startup-validator.js";
export * from "./config/otel-bootstrap.js";
export * from "./health/health-router.js";
export * from "./health/health-checks.js";
```

These imports will error until the respective modules exist — that's expected. Each import un-comments itself as the corresponding task completes.

**Why:** The spec requires a barrel export for `@dtc/ai-core`. Creating the skeleton now means adapters and scripts can reference `@dtc/ai-core` imports without later reorganization.

**How:** Write file.

### Step 6: Update package.json scripts and firewall scan paths

**What:** Adjust scripts in root `package.json` and firewall scan paths in `scripts/ast-firewall.ts`.

**package.json additions:**
```json
{
  "scripts": {
    "check": "bun run scripts/ast-firewall.ts",
    "check:watch": "bun run scripts/ast-firewall.ts --watch",
    "check:chaos": "bun run scripts/ast-firewall.ts --chaos",
    "validate": "echo 'Validate pipeline — run after implementation is complete.'",
    "dev:web": "echo 'UI dashboard — run after Task 12 is complete.'",
    "build:web": "echo 'UI dashboard build — run after Task 12 is complete.'"
  }
}
```

**ast-firewall.ts scan paths update:**
Current scan targets (lines 89-101):
```ts
const dirs = ["packages/ai-core/src", "apps/web/app"];
// + worker.ts, voice-agent.ts
```

Change to:
```ts
const dirs = [
  "packages/ai-core/src",
  "apps/web/app",
  "apps/web/src",   // added: Vite source (not /app/)
];
// worker.ts and voice-agent.ts stubs removed (will be recreated in Task 11)
// Keep scripts/ as explicit files only if they contain production code
```

**Why:** `apps/web/` uses Vite's default `src/` directory, not `app/`. Removing worker.ts/voice-agent.ts from permanent scan until they're recreated prevents broken imports from causing scan failures. The `validate`, `dev:web`, `build:web` scripts are referenced in tasks.md and should exist as stubs.

**How:** SearchReplace on both files.

### Step 7: Update .gitkeep or .gitignore for new empty dirs

**What:** Ensure the empty directory structure is tracked. Add a comment to `.gitignore` if needed.

The spec directory tree has many empty directories. `.gitkeep` files keep them in git. No `.gitignore` changes needed — the existing patterns already cover `node_modules`, `dist`, `.env`, etc.

## Assumptions & Decisions

1. **`worker.ts`, `voice-agent.ts`, `eval-rag.ts` are deleted, not rewritten.** Tasks 11 and 13 already plan full rewrites. Creating stubs now that import from a non-existent `@dtc/ai-core` creates broken files that would fail the AST firewall.

2. **`apps/web/` is NOT scaffolded yet.** Task 12.1 uses `bun create vite apps/web --template vanilla-ts` to scaffold it. Creating it manually would conflict with Vite's scaffolding.

3. **`.cursor/` deletion is safe.** These are e-commerce skills (storefront-routing, csv-ingestion, react-orchestration, etc.) from the previous project. The new skills are under `.trae/skills/`.

4. **`.knowledge/` deletion is safe.** The runbook.md, testing.md, demo-guide.md, and README.md all contain e-commerce content. Task 14.3 plans to rewrite runbook.md with CRM content.

5. **No imports are added to `@dtc/ai-core` in any remaining script.** The package exists but has no implementable exports. Scripts that need it (ast-firewall's ts-morph for scanning) already have their own imports.

6. **The `bun.lock` file will be regenerated** after `bun install` is run to pick up the new workspace package.

## Verification

After all steps complete, verify:
1. `bun run check` — AST firewall passes on remaining files (0 violations expected since legacy files are gone, packages/ai-core/src/ is stubs)
2. `bun run check:chaos` — 47 violations from chaos tests unchanged
3. `ls packages/ai-core/src/` — directory tree matches spec
4. `ls scripts/` — only `ast-firewall.ts`, `load-env.ts`, `otel-bootstrap.ts` (moved), and `chaos-tests/`
5. No `.cursor/` or `.knowledge/` directories remain
6. `bun install` — succeeds with new workspace package linked
7. `git status` — clean set of deletions and additions, no unexpected changes
