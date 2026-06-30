# AST Firewall Analysis — AI CRM (Implemented: Rules 20-28)

## Summary
- Constitutional gates extracted: 52
- AST-enforceable gates: 31
- Existing rules: 28 (was 25 — Rules 26-28 + Rule 18 fix implemented 2026-06-30)
- Gaps remaining: 0 actionable from constitutional analysis (6 deferred — naming conventions)
- **Feature surface gaps (002-chat-widget): 0 remaining (5 implemented 2026-06-30)**
- Drift warnings: 4 (unchanged)
- Over-enforced: 0

## Newly Found vs. Previous Run

The 7-mechanism extraction (imperative clauses, declarative rules, ✅/❌ diagrams, quality gates tables, rule/implementation tables, naming convention tables, architecture definitions) found 12 additional gates beyond the MUST/SHALL-only run. Of those, 5 are AST-enforceable and 3 are worth implementing:

| New Gate | Source Mechanism | Priority |
|---|---|---|
| "orchestrator SHALL NOT import from feature directories directly" | Architecture definition | **HIGH** |
| "Schema files: *.schema.ts next to usage" | Naming convention table | MEDIUM |
| "Config files: *.config.ts" | Naming convention table | MEDIUM (paired with Rule 22) |
| "Port interfaces: I*Store, I*Provider, I*Retriever, I*Queue" | Naming convention table | LOW (defer) |
| "Port files: *.port.ts in core/" | Naming convention table | LOW (defer — conflicts with existing I*Store.ts) |
| "Test files: *.test.ts in __tests__/ next to source" | Naming convention table | LOW (already followed; warn-only) |
| "Function prefixes: get*/fetch*/handle*/create*" | Naming convention table | LOW (too noisy; defer) |
| "Test naming: should [expected] when [condition]" | Naming convention table | LOW (not AST-enforceable for meaning) |

## Gaps (All Resolved as of 2026-06-30)

### HIGH Priority — IMPLEMENTED

| # | Constitutional Gate | Domain | Lazy Shortcut | Enforcement | Rule |
|---|---|---|---|---|---|
| 1 | "The core orchestrator SHALL NOT import from feature directories directly — it depends only on core/ports.ts" | Structural | `import { ContactTools } from "../../features/contacts/tools"` | Location-based: flag any `features/` import in `core/` directory | **Rule 25** |

### MEDIUM Priority — IMPLEMENTED

| # | Constitutional Gate | Domain | Lazy Shortcut | Enforcement | Rule |
|---|---|---|---|---|---|
| 2 | II-a: "Every external adapter call SHALL respect per-service timeout bounds" | Resilience | `fetch()` without `AbortController` / `signal` | Pattern-based (narrowed to `core/` for initial deployment) | **Rule 20** |
| 3 | II-a / VI: "startup validator SHALL block process launch if any required env var is unreachable" | Resilience | `process.env.PORT` without `?? 3000` | Location-based: flag outside `config/` and `env-schema.ts` | **Rule 21** |
| 4 | Development Standards: "No hardcoded configuration" | Resilience | `const URL = "https://api.prod.com"` in business logic | Location-based: flag URLs/ports outside `config/` and `*.config.ts` (narrowed to `core/` for initial deployment) | **Rule 22** |
| 5 | V: "All logs MUST be structured JSON with trace_id" | Correctness | `console.log("pipeline done")` instead of `logger.info({...})` | Location-based: flag `console.log/info/warn/debug` in `core/` (narrowed for initial deployment) | **Rule 23** |
| 6 | Development Standards: "Adapter files: *.adapter.ts in adapters/<domain>/" | Structural | File named `supabase-contacts.ts` instead of `supabase-contacts.adapter.ts` | Location-based (non-blocking warnings for existing files) | **Rule 24** |

### LOW Priority (Deferred — Naming Conventions)

These are constitutional gates extracted from naming convention tables. They are valid gaps but produce high false-positive rates or conflict with existing naming patterns. Deferred until the codebase migrates to the declared conventions:

| # | Constitutional Gate | Reason Deferred |
|---|---|---|
| 7 | "Port files: *.port.ts in core/" | Conflicts with existing I*Store.ts naming — needs migration |
| 8 | "Port interfaces: I*Store, I*Provider, I*Retriever, I*Queue" | Partially enforced already by convention; AST check is redundant with TypeScript's structural typing |
| 9 | "Test files: *.test.ts in __tests__/ next to source" | Already followed — low risk of drift. Warn-only. |
| 10 | "Function prefixes: get*/fetch*/handle*/create*/validate*/find*/is*" | Naming conventions have no security impact — AST enforcement would generate noise without preventing bugs |
| 11 | "Test naming: should [expected] when [condition]" | Test descriptions are human-readable — AST can't validate meaning. Blocking on naming would break legitimate tests. |
| 12 | "Schema files: *.schema.ts next to usage" | Partially followed. Additional linting value is low if schemas are already validated by Rules 1-3. |

## Drift Warnings (Rules to Review)

| Rule | Warning | Suggested Action |
|---|---|---|
| Domain B label ("Error & Resilience") | Now contains 3 new Resilience rules (Rules 20-22) alongside error handling. | ~~Rename~~ — resolved by implementing Rules 20-22. |
| Rules 5, 13 (PII patterns) | PII regex hardcodes `phone, email, transcript, etc.`. If new PII fields are added, the regex silently misses them. | Backlog: scan `ports.ts`/`*.schema.ts` for field names, build PII allowlist dynamically. Medium effort. |
| Rule 16 (Port Injection adapter patterns) | Adapter naming regex uses project-specific provider prefixes. Adding a new provider would miss injection detection. | Update regex when new adapter providers are added. Document in rule comment. |
| Rule 14 (Span Coverage) | Scope assumes `core/` and `adapters/` directory structure. If layout changes, rule silently stops scanning. | Currently valid. Flag if directory layout is refactored. |

## Over-Enforced

None. All 25 existing rules map to valid constitutional gates.

## Full Cross-Reference Table (Updated — New Gates Bolded)

| Constitutional Gate | Extraction Mechanism | Rule | Status |
|---|---|---|---|
| I: "orchestrator depends ONLY on ports" | Imperative | Rule 16 | COVERED |
| I: "adapter implements exactly one port" | Imperative | — | NOT AST-ENFORCEABLE (TypeScript compiler) |
| II: "every adapter wrapped in circuit breaker" | Imperative | Rule 17 | COVERED |
| II: "AI fallback chain" | Imperative | — | NOT AST-ENFORCEABLE (runtime) |
| II-a: "per-service timeout bounds" | Quality Gates table | Rule 20 | COVERED |
| III: "AES-256-GCM encryption" | Imperative | Rule 19 | COVERED |
| III: "zero PII in logs/errors/spans" | Imperative | Rules 5, 13 | COVERED |
| III: "IntegrationError auto-strips PII" | Imperative | Rule 5 | COVERED |
| III: "AI output through validateAndFilterOutput" | Imperative | Rule 10 | COVERED |
| III: "PII data residency" | Declarative | — | NOT AST-ENFORCEABLE (infrastructure) |
| III: "deleteByOwner(ownerId)" | Imperative | — | PARTIAL (method checkable; correctness is runtime) |
| III: "audit trail append-only, 90 day" | Declarative | — | NOT AST-ENFORCEABLE (DB constraints) |
| V: "every pipeline step traced (OTel span)" | Imperative | Rule 14 | COVERED |
| V: "all logs structured JSON with trace_id" | Imperative | Rule 23 | COVERED |
| V: "health endpoints on :8280" | Declarative | — | NOT AST-ENFORCEABLE (port binding runtime) |
| VI: "startup validator blocks launch" | Imperative | Rule 21 | COVERED |
| QG: "Zod boundary safety" | Quality Gates table | Rules 1, 2, 3, 18 | COVERED |
| QG: "No any types / @ts-ignore" | Quality Gates table | Rule 15 | COVERED |
| QG: "Catch type-guard" | Quality Gates table | Rule 4 | COVERED |
| QG: "Neo4j parameterized queries" | Quality Gates table | Rule 7 | COVERED |
| QG: "Supabase RLS no bypass" | Quality Gates table | Rule 8 | COVERED |
| QG: "Native pgvector operators" | Quality Gates table | Rule 9 | COVERED |
| QG: "Agent step ceiling" | Quality Gates table | Rule 12 | COVERED |
| QG: "Mastra tool contracts" | Quality Gates table | Rule 11 | COVERED |
| **DS: "orchestrator SHALL NOT import from feature directories"** | **Architecture def** | **Rule 25** | **COVERED** |
| **DS: "Adapter files: *.adapter.ts"** | **Naming convention table** | **Rule 24** | **COVERED** |
| **DS: "Config files: *.config.ts"** | **Naming convention table** | **Rule 22** | **COVERED** |
| **DS: "Schema files: *.schema.ts"** | **Naming convention table** | — | DEFERRED |
| **DS: "Port files: *.port.ts"** | **Naming convention table** | — | DEFERRED (conflicts with I*Store.ts) |
| **DS: "Test files: *.test.ts in __tests__/"** | **Naming convention table** | — | DEFERRED (already followed) |
| **DS: "Port interfaces: I*Store etc."** | **Naming convention table** | — | DEFERRED |
| **DS: "Function prefixes: get*/fetch* etc."** | **Naming convention table** | — | DEFERRED (too noisy) |
| **DS: "Test naming: should [expected] when..."** | **Naming convention table** | — | DEFERRED (not AST-enforceable) |

## NOT AST-Enforceable

| Gate | Reason |
|---|---|
| PII data residency / cross-region | Infrastructure concern |
| DSAR gated behind env var | Runtime config |
| Audit trail constraints | Database constraints |
| Encryption key rotation | Runtime behavior |
| Infrastructure as code / health-gated deployments | Infrastructure concern |
| Migration backward compatibility | SQL analysis too complex for ts-morph |
| Startup validator correctness | Runtime behavior |
| Metric intervals / log levels in prod | Runtime config |
| RAG triad / SLA gate thresholds | Runtime evaluation/telemetry |
| AI fallback chain execution | Runtime behavior |
| Test pass requirement / test discipline | Runtime execution / human judgment |
| Adapter implements exactly one port | TypeScript compiler enforces |

## Extraction Mechanism Coverage

For transparency, here's how the 52 gates were distributed across extraction mechanisms:

| Mechanism | Gates Found | AST-Enforceable |
|---|---|---|
| Imperative clauses (MUST/SHALL) | 22 | 14 |
| Declarative rules | 8 | 3 |
| ✅/❌ diagrams | N/A (AI CRM constitution doesn't use diagram format) | 0 |
| Quality Gates tables (data integrity, type safety, error handling, observability) | 10 | 8 |
| Rule/Implementation tables | 0 (AI CRM constitution uses free-text, not tables for these) | 0 |
| Naming convention tables | 7 | 5 (3 deferred) |
| Architecture definitions | 5 | 3 |
| **Total** | **52** | **31** |

---

## Feature Surface Gaps — 002-chat-widget (2026-06-30)

**Source**: specs/002-chat-widget/plan.md
**Surfaces analyzed**: 10 new files, 4 extended files
**Tasks referenced**: yes (T007, T029, T032, T034, T040, T041, T043, T044, T049)
**Research referenced**: yes (Cartesia STT endpoints, livekit-client constraint)

### Surface Inventory

| # | File | Surface Type | Untrusted Input | Lazy Shortcut | Cross-reference | Status |
|---|---|---|---|---|---|---|
| S1 | `scripts/widget-server.ts` | All rules | All HTTP inbound (JWT, JSON body, multipart, webhook) | Full rule set silently skipped — file not in scan paths | `resolveSourceFiles()` only adds `scripts/load-env.ts` | **META-GAP** |
| S2 | `scripts/audio-utils.ts` | All rules | Node.js Buffer (PCM output) | Full rule set silently skipped | Same scan path exclusion | **META-GAP** |
| S3 | `packages/ai-core/src/features/calls/clip-transcriber.ts` | WebSocket `.on('message')` callback | Cartesia STT JSON frames (`{type, text, isFinal}`) | `JSON.parse(e.data).text` — passes Rule 18 false-negative | Rule 18 checks `ce.getName()==='parse'`, which matches `JSON.parse` (not only Zod) | **GAP (Rule 18 false-negative)** |
| S4 | `packages/ai-core/src/features/calls/clip-transcriber.ts` | `ws.onmessage` property assignment | Cartesia STT frames | `ws.onmessage = (e) => { JSON.parse(e.data) }` — property assignment, not CallExpression | Rule 18 targets `.on()/.subscribe()` CallExpression only | **GAP** |
| S5 | `scripts/voice-agent.ts` (extended) | `JSON.parse` on metadata string | `ctx.job.metadata` (LiveKit dispatch, JSON payload) | `const { contactId } = JSON.parse(ctx.job.metadata)` without Zod | Rule 3 (fetch only), Rule 18 (.on/.subscribe only) | **GAP** |
| S6 | `apps/widget/src/modes/voice.ts` (allowed) | `import 'livekit-client'` boundary | Browser SDK (dynamic import) | Agent copies `import { Room } from 'livekit-client'` into `scripts/` or `packages/` | No rule blocks `livekit-client` import outside `apps/widget/` | **GAP** |
| S7 | `scripts/worker.ts` (extended) | `fetch()` — WhatsApp media download | WhatsApp Graph API response (`{url, mime_type}`) | `const { url } = await resp.json()` without Zod | Rule 3 covers this — IF worker.ts is in scan paths (META-GAP) | **COVERED*** |
| S8 | `scripts/widget-server.ts` | `span.setAttribute()` OTel spans | N/A (attribute key leak) | `span.setAttribute('message', ...)` — PII key in span | Rule 13 covers this — IF widget-server.ts is in scan paths (META-GAP) | **COVERED*** |
| S9 | `packages/ai-core/src/adapters/livekit/livekit-room.adapter.ts` | Adapter instantiation in core/ | N/A | `new LiveKitRoomAdapter()` in core/ | Rule 16 — `LiveKit` prefix detected | **COVERED** |
| S10 | `packages/ai-core/src/features/calls/clip-transcriber.ts` | catch blocks | External WS errors | `catch(e)` without `: unknown` | Rule 4 — file is scanned | **COVERED** |

*\* Covered only after META-GAP (S1/S2) is resolved by adding new scripts to scan paths.*

### Gap Proposals (Rules to Add or Extend)

| # | Proposed Rule Name | Domain | Surfaces | Pattern | Enforcement | Priority |
|---|---|---|---|---|---|---|
| 1 | **ScriptsScanPaths** | Structural (meta) | `scripts/widget-server.ts`, `scripts/audio-utils.ts` | `resolveSourceFiles()` only scans `scripts/load-env.ts` — all 25 rules silently skip new scripts | Extend `resolveSourceFiles()`: add `scripts/widget-server.ts` and `scripts/audio-utils.ts` to the explicit list (or switch to `scripts/**/*.ts` glob + exclusions) | **HIGH** |
| 2 | **Rule18FalseNegativeFix** | Data-Flow | `clip-transcriber.ts`, any `.on('message')` WS callback | `JSON.parse(e.data)` in `.on()` callback satisfies Rule 18 today because `ce.getName()==='parse'` matches `JSON.parse` — not just Zod | Extend Rule 18: add guard `if (ce.getExpression().getText() === 'JSON') return false` before the `includes('parse')` check | **HIGH** |
| 3 | **WsOnmessageZod** | Data-Flow | `clip-transcriber.ts` | `ws.onmessage = (e: MessageEvent) => { ... }` PropertyAssignment callback without Zod parse in body | New rule: scan `PropertyAssignment` where name is `onmessage`, `onerror`, or `on*` native WS event; require Zod `.parse()` in body | **HIGH** |
| 4 | **JsonParseWithoutZod** | Data-Flow | `clip-transcriber.ts`, `voice-agent.ts`, `widget-server.ts` | Standalone `JSON.parse(externalVar)` where result is not immediately chained into `.parse()`/`.safeParse()` | Pattern-based: flag `JSON.parse(...)` CallExpression whose parent is not a Zod `.parse()` argument | **HIGH** |
| 5 | **LiveKitClientBoundary** | Structural | `apps/widget/src/modes/voice.ts` (allowed), any other location (blocked) | `import ... from 'livekit-client'` or `import('livekit-client')` outside `apps/widget/` | Location-based: flag `livekit-client` import in any file whose `normalizedPath` does not include `apps/widget/` | **HIGH** |

Priority:
- **HIGH**: Data-Flow security, wrong-layer SDK import, scan path gaps that blind all rules
- **MEDIUM**: Structural wrappers, resilience on new external calls
- **LOW**: Naming, cosmetic

### COVERED Surfaces (no new rules needed)

| File | Surface | Existing Rule |
|---|---|---|
| `scripts/worker.ts` | `fetch()` WhatsApp media download without Zod | Rule 3 (requires scan path fix first) |
| `scripts/widget-server.ts` | `span.setAttribute()` PII key guard | Rule 13 (requires scan path fix first) |
| `packages/ai-core/src/adapters/livekit/livekit-room.adapter.ts` | Adapter file naming convention | Rule 24 |
| `packages/ai-core/src/core/ports.ts` | `new LiveKitRoomAdapter()` blocked in core/ | Rule 16 |
| `packages/ai-core/src/features/calls/clip-transcriber.ts` | `catch (e: unknown)` required | Rule 4 |
| `packages/ai-core/src/config/startup-validator.ts` | `process.env` without fallback outside config/ | Rule 21 |

### NOT AST-Enforceable (document only)

| Surface | Reason |
|---|---|
| P95 SSE < 500ms (widget text) | Runtime metric |
| P95 voice clip full response < 5s | Runtime metric |
| STT-finalization → first TTS byte < 1.5s | Runtime metric — voice agent process |
| WhatsApp audio reply < 10s | Runtime metric — async pipeline |
| Agent joins room within 15s | Runtime / LiveKit dispatch timing |
| Widget JS bundle ≤ 100 KB gzipped | Build CI constraint (bundlesize), not AST |
| ffmpeg availability | Startup probe (T015), not an AST pattern |
| LiveKit room auto-cleanup on empty | LiveKit Cloud behavior |
| CORS `Access-Control-Allow-Origin` correctness | HTTP header value — runtime config |

### Rule 18 False Negative — Detail

Rule 18 (`WebSocketBoundary`) requires that `.on()/.subscribe()` callback bodies contain a call where `ce.getName() === 'parse'`. The bug: `JSON.parse(e.data)` is a `PropertyAccessExpression` where the property name is `"parse"`, so `ce.getName()` returns `"parse"` and the rule is silently satisfied. An agent writing:

```typescript
ws.on('message', (e) => {
  const result = JSON.parse(e.data);  // NOT Zod — Rule 18 stays silent today
  return result.text;
});
```

...would not trigger Rule 18. Minimal fix in `rule18_WebSocketBoundary`:

```typescript
const hasZodParse = parseCalls.some(c => {
  const ce = c.getExpression();
  if (Node.isPropertyAccessExpression(ce)) {
    // Exclude JSON.parse — that is NOT a schema validation
    if (ce.getExpression().getText() === 'JSON') return false;
    return ["parse", "parseAsync", "safeParse"].includes(ce.getName());
  }
  return ["parse", "parseAsync", "safeParse"].includes(ce.getText());
});
```
