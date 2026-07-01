---
name: "archguard-discover"
description: "Scans codebase to discover trust boundaries, dependency graph, output surfaces, and resource/mutation points. Parses package.json for tech context. Invoke FIRST in the archguard pipeline, before archguard-clarify."
---

# ArchGuard Discover

Phase 1 + Phase 2 of the architectural guard generator. Scans the codebase automatically to produce the 4 structural maps and the tech context catalog. No user interaction needed.

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

Read `package.json`. Extract `dependencies` + `devDependencies` keys. Store for Step 4.

### Step 2: Generate the 4 Maps

For each map, scan the codebase using the patterns below. Output format: `file:line — pattern matched — context snippet`.

#### MAP A: Trust Boundaries (data enters the system)

```
Grep for:
  - req.body, req.params, req.query, req.headers        (Express/Hono/Fastify)
  - ctx.body, ctx.params, ctx.query                      (Oak/Koa)
  - .on('message', .onmessage, .subscribe(               (WebSocket/realtime)
  - process.argv, process.env                            (CLI/env)
  - fs.readFile, fs.createReadStream                     (File I/O)
  - Queue.process, worker.process                        (Job queues)
  - addEventListener('message'                            (Browser/Worker)
  - new URLSearchParams(window.location.search)          (Browser query params)
```

#### MAP B: Dependency Graph (import relationships to enforce)

```
For each import in the project, classify:
  - core/ → adapters/          → FM2 violation candidate
  - core/ → features/          → FM2 violation candidate
  - packages/ → apps/          → Wrong direction
  - scripts/ → packages/       → Check if safe
  - Any "client" import in server-side path → FM2 violation candidate

Also note:
  - Directory structure (packages/, apps/, scripts/, core/, adapters/, features/)
  - Any existing ArchUnit rules in tests/architecture.test.ts
```

#### MAP C: Output Surfaces (data leaves the system)

```
Grep for:
  - return.*res\.            (Express response returns)
  - res.json(, res.send(, ctx.json(   (HTTP response methods)
  - logger.info(, logger.error(, logger.warn(   (Structured logs)
  - console.log(, console.error(       (Console output)
  - span.setAttribute(, span.addEvent( (Telemetry spans)
  - ws.send(, socket.emit(            (WebSocket outbound)
  - new IntegrationError              (Error constructors with metadata)
```

#### MAP D: Resources + Mutations (connections opened, state written)

```
Grep for:
  - .update(, .insert(, .upsert(, .delete(   (DB mutations)
  - .run(, .executeRead(, .executeWrite(     (Neo4j queries)
  - createWriteStream, createReadStream      (Streams)
  - createCipheriv                            (Crypto)
  - new Room, new Client                     (LiveKit/Twilio)
  - process.exit, Bun.exit                   (Ungraceful shutdown)
  - fetch(                                     (External calls)

Count consecutive .update/.insert/.delete calls in same function body → FM6 candidates.
```

### Step 3: Summarize Findings

For each map, produce:
- Total count of matches
- Top 5 files by match count
- List of unique pattern types found

### Step 4: Tech Context from package.json

For each dependency in the project, check against this catalog:

| Package | Ban | ESLint Selector |
|---------|-----|-----------------|
| `neo4j-driver` | Template `${}` in `.run()` | `CallExpression[callee.property.name=/run|executeRead|executeWrite/] TemplateExpression` |
| `@prisma/client` | `$queryRaw`, `$executeRaw` | `CallExpression[callee.property.name=/^\$queryRaw|\$executeRaw/]` |
| `livekit-client` | Import in non-widget paths | ArchUnit geography check |
| `@supabase/supabase-js` | `.rpc()` bypassing RLS | `CallExpression[callee.property.name='rpc']` |
| `zod` | NOT a ban — but if missing, `JSON.parse` becomes high-risk | N/A |
| `@mastra/core` | Agent without maxSteps | `NewExpression[callee.name='Agent']:not(:has(Property[key.name='maxSteps']))` |
| `ai` (Vercel AI SDK) | `generateText` / `streamText` returned raw | `ReturnStatement CallExpression[callee.property.name=/generateText|streamText/]` |
| `bullmq` | `process.exit` in worker files | `CallExpression[callee.object.name='process'][callee.property.name='exit']` |

### Step 5: Write Output

Write findings to `.archguard/discover.md` with this structure:

```markdown
# ArchGuard Discover Output

## Project Context
- Runtime: (detected from package.json type field, tsconfig)
- Package Manager: (detected from packageManager field)
- Dependencies: (list of relevant packages)

## Map A: Trust Boundaries
- Count: N matches across M files
- Top files: ...
- Pattern types found: ...

## Map B: Dependency Graph
- Layer structure: ...
- FM2 candidates: ...

## Map C: Output Surfaces
- Count: N matches across M files
- Pattern types found: ...

## Map D: Resources & Mutations
- Count: N matches across M files
- FM6 candidates (multi-mutation in single function): ...

## Tech Context
- Detected packages requiring rules: [...]
- Generated bans: [...]
```

## Constraints

- **Do NOT modify any files.** This skill is read-only scanning.
- **Do NOT ask the user questions.** All questions are left for archguard-clarify.
- **Do NOT generate config files.** That's archguard-implement's job.
- If a directory (like `packages/`) doesn't exist, note it and skip — don't create it.
- If `package.json` is missing, abort and tell the user this only works for Node.js projects.
