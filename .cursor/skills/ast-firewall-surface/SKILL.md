---
name: "ast-firewall-surface"
description: "Scan a new feature plan's code surfaces for AST firewall gaps. No constitution needed. Target: explicit path arg (/ast-firewall-surface specs/003-name) takes priority over .specify/feature.json (last-planned shortcut). Reads plan.md + tasks.md + research.md, applies the lazy-agent question to each new file and trust boundary, cross-references against existing rules in ast-firewall.ts, and appends surface gaps to .knowledge/ast-firewall-analysis.md. Run after /speckit-plan, before /ast-firewall-plan."
---

# AST Firewall Surface

## Purpose

For an **existing project** with `scripts/ast-firewall.ts` and a **completed feature plan** (`/speckit-plan`): scan the new code surfaces the feature will introduce and find firewall gaps **before implementation**.

Unlike `/ast-firewall-analyze` (constitution → rules, principle-level), this skill is **feature-plan → surfaces → lazy-agent shortcuts → rule gaps** (pattern-level). It does **not** read the constitution.

**When to run**: After `/speckit-plan`, before `/ast-firewall-plan` and before `/speckit-implement`.

**Independent from analyze**: Run `surface` when a new feature is planned. Run `analyze` when the constitution changes. Either can run alone.

## The Pipeline

```
/speckit-plan            →  specs/{feature}/plan.md, tasks.md, research.md
         ↓
/ast-firewall-surface    →  .knowledge/ast-firewall-analysis.md  (appends Feature Surface Gaps section)
         ↓
/ast-firewall-plan       →  .knowledge/ast-firewall-plan.md
         ↓
/ast-firewall-implement  →  scripts/ast-firewall.ts
```

Parallel entry (constitution health, run rarely):

```
/ast-firewall-analyze    →  .knowledge/ast-firewall-analysis.md  (constitutional gaps — separate section)
```

## Inputs

Read these files (absolute paths from repo root):

1. **REQUIRED**: Feature plan — resolve path from `.specify/feature.json` (`feature_directory`) → `specs/{feature}/plan.md`. If missing, use the plan path from user arguments.
2. **REQUIRED**: `scripts/ast-firewall.ts` — existing rules to cross-reference (extract rule numbers, SyntaxKind targets, location scopes from JSDoc + rule bodies)
3. **IF EXISTS**: `specs/{feature}/tasks.md` — task descriptions name exact code patterns agents will write
4. **IF EXISTS**: `specs/{feature}/research.md` — tech decisions (API shapes, WebSocket endpoints, SDK boundaries)
5. **IF EXISTS**: `specs/{feature}/contracts/` — HTTP/WebSocket contracts and trust boundaries

**Do NOT read** `.specify/memory/constitution.md` for this skill.

## Methodology (self-contained)

### The Five Safety Domains

Classify each candidate gap into one domain:

| Domain | What it guards | Lazy-agent question for surfaces |
|---|---|---|
| **Data-Flow** | Untrusted data enters without validation | "What does the agent skip — Zod, schema, type guard on this inbound payload?" |
| **Structural** | Wrong layer, wrong import, missing wrapper | "Does the agent import a browser SDK in server code, or instantiate an adapter in core/?" |
| **Leakage** | Sensitive data in logs, spans, errors | "Does the agent log or trace raw request fields, audio metadata, or JWT claims?" |
| **Correctness** | Wrong algorithm, format, unbounded input | "Does the agent use the wrong endpoint, cipher, or skip size/duration limits?" |
| **Resilience** | Missing timeout, DLQ, cleanup | "Does the agent skip AbortSignal, circuit breaker, or DLQ on this external call?" |

### Enforcement Strategies

- **Pattern-based**: flag the AST pattern everywhere (e.g., `JSON.parse` without subsequent `.parse()`)
- **Location-based**: flag only outside allowed directories (e.g., `livekit-client` import outside `apps/widget/`)

## Outline

### Phase 0: Resolve Feature Context

Resolve the target plan using this priority order — stop at the first that succeeds:

1. **User argument** — if the user passed a path (e.g. `/ast-firewall-surface specs/003-name`), use that as `feature_directory`. Accept either a directory path (`specs/003-name`) or a direct file path (`specs/003-name/plan.md`).
2. **`.specify/feature.json`** — read `feature_directory` from this file (last-planned shortcut written by `/speckit-plan`).
3. **Error** — neither is available: report `"No feature target — pass a spec path (e.g. /ast-firewall-surface specs/003-name) or run /speckit-plan first"` and stop.

Then load `plan.md` from the resolved directory, record the feature branch name from the plan header, and note today's date for the output section header.

### Phase 1: Extract New Code Surfaces

From **plan.md** — "Project Structure" / "Source Code" section:

For each **new** file or directory (marked `# New` or equivalent):
- File path
- Role (one line from plan)
- External I/O: HTTP routes, WebSocket, subprocess (ffmpeg), SDK (LiveKit, Cartesia, Supabase)
- Untrusted inputs: JWT, multipart upload, webhook body, LiveKit metadata JSON, WhatsApp media bytes
- Cross-layer imports implied by plan (e.g., `livekit-client` widget-only)

For each **extended** file (marked `# Extended`):
- Only the **new** code paths described in plan/tasks (not the whole file)

From **tasks.md** (if exists):
- Scan task descriptions for concrete patterns: `JSON.parse`, `ws.on`, `multipart`, `span.setAttribute`, `createDispatch`, `fluent-ffmpeg`, etc.
- Map each pattern to a file path from the task

From **research.md** (if exists):
- Documented API endpoints (e.g., Cartesia `/stt/websocket` vs `/tts/websocket`)
- Deployment constraints (ffmpeg, Vercel unsupported) that imply resilience gaps

From **contracts/** (if exists):
- New HTTP routes and webhook handlers = new trust boundaries

Produce an internal surface inventory (do not write to disk yet):

```text
Surface ID | File | Surface Type | Untrusted Input | Planned Pattern (from tasks/research)
```

### Phase 2: Lazy-Agent Question Per Surface

For **each** surface in the inventory, run the five domain questions (Phase 2 of plan). Record only non-empty answers as **candidate violation patterns**.

Examples:

| Surface | Lazy shortcut | Domain |
|---|---|---|
| `clip-transcriber.ts` WebSocket `onmessage` | `JSON.parse(e.data).text` without Zod | Data-Flow |
| `voice-agent.ts` `ctx.job.metadata` | `JSON.parse(metadata); const { contactId }` without schema | Data-Flow |
| `widget-server.ts` | `import { Room } from 'livekit-client'` | Structural |
| `POST /widget/audio` | Log `mime_type` + file size OK; log transcript text | Leakage (partial — Rule 5 may catch transcript in logs) |
| `CartesiaSTTClient` URL | Wrong `/tts/websocket` instead of `/stt/` | Correctness (document as implementation risk; AST may not catch URL strings) |

Skip surfaces where the lazy shortcut is purely runtime (SLA latency, "agent joins within 15s") — mark NOT AST-ENFORCEABLE in inventory, do not propose rules.

### Phase 3: Cross-Reference Against Existing Rules

Read `scripts/ast-firewall.ts`. For each candidate pattern:

1. Identify which existing rule(s) target the same `SyntaxKind` or string pattern
2. Decide status:
   - **COVERED** — existing rule catches this exact pattern on this surface (document which rule)
   - **PARTIAL** — a rule addresses the same principle but not this surface (e.g., Rule 3 = `fetch()` only; WebSocket not included) → **GAP** (propose extension or new rule)
   - **GAP** — no rule matches → propose new rule

**Critical**: Do NOT mark COVERED at principle level only. "Zod at boundary" is COVERED only if Rule 3/18 (or another) actually matches `ws.onmessage` / `JSON.parse` on that file.

Extract from each relevant rule: rule number, name, targeted SyntaxKinds, location scope (`ctx.normalizedPath` patterns).

### Phase 4: Append to `.knowledge/ast-firewall-analysis.md`

**Append only** — never overwrite constitutional analysis, drift warnings, or prior feature sections.

If `.knowledge/ast-firewall-analysis.md` does not exist, create it with a minimal header:

```markdown
# AST Firewall Analysis — [Project Name]

## Summary
- Surface-only run (no constitutional analyze yet)
```

Then append:

```markdown
---

## Feature Surface Gaps — {feature-branch} ({YYYY-MM-DD})

**Source**: specs/{feature}/plan.md
**Surfaces analyzed**: N new files, M extended files
**Tasks referenced**: yes/no
**Research referenced**: yes/no

### Surface Inventory

| # | File | Surface Type | Untrusted Input | Lazy Shortcut | Cross-reference | Status |
|---|---|---|---|---|---|---|
| 1 | ... | WebSocket onmessage | Cartesia STT frames | JSON.parse without Zod | Rule 3 (fetch only) | GAP |

### Gap Proposals (Rules to Add or Extend)

| # | Proposed Rule Name | Domain | Surfaces | Pattern | Enforcement | Priority |
|---|---|---|---|---|---|---|
| 1 | WebSocketInboundZod | Data-Flow | clip-transcriber.ts, ... | ws.on/onmessage handler without Schema.parse | Pattern-based | HIGH |

Priority:
- **HIGH**: Data-Flow security, injection, wrong-layer SDK import
- **MEDIUM**: Structural wrappers, resilience on new external calls
- **LOW**: Naming, cosmetic

### COVERED Surfaces (no new rules needed)

| File | Surface | Existing Rule |
|---|---|---|
| widget-server.ts | PII in span attributes | Rule 13 |

### NOT AST-Enforceable (document only)

| Surface | Reason |
|---|---|
| P95 SSE < 500ms | Runtime metric |
```

**If zero gaps**: append a short section:

```markdown
## Feature Surface Gaps — {feature-branch} ({date})

**Source**: specs/{feature}/plan.md
0 gaps. All planned surfaces covered by existing rules (or runtime-only).
```

Update the file's **Summary** section at the top (if present) to increment surface gap counts — do not remove constitutional summary lines.

## Output

- **File**: `.knowledge/ast-firewall-analysis.md` — appended `Feature Surface Gaps` section
- **No code** written to `scripts/ast-firewall.ts`

## Completion Report

Report to the user:
- Feature branch and source plan path
- Surfaces analyzed (count)
- Gaps proposed (count) with HIGH priority listed
- COVERED count
- Next step: `/ast-firewall-plan` then `/ast-firewall-implement` before `/speckit-implement`

## Next Step

`/ast-firewall-plan` → `/ast-firewall-implement`

Optionally run `/ast-firewall-analyze` separately when the constitution changes — not required before plan/implement for this feature.
