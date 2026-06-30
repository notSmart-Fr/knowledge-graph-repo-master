# AST Firewall Implementation Plan — AI CRM (002-chat-widget Surface Gaps)

## Source
Derived from `.knowledge/ast-firewall-analysis.md` — Feature Surface Gaps section (2026-06-30)
5 gaps from `/ast-firewall-surface` on `specs/002-chat-widget/plan.md`

**Status: COMPLETE (2026-06-30)**

---

## Pre-Implementation
- [X] Task P1: Run `pnpm check` on current codebase — confirm 0 violations (baseline before changes)

---

## Tasks (in priority order)

### Infrastructure First — Scan Path Fix (unblocks S7, S8 COVERED* items)

- [X] Task I1: Extend `resolveSourceFiles()` in `scripts/ast-firewall.ts` — **add new scripts to scan**
  - Added: `scripts/widget-server.ts`, `scripts/audio-utils.ts` (existence-gated)
  - Deferred: `worker.ts`, `voice-agent.ts` — pre-existing Rule 3/5/20 violations; enable during 002-chat-widget implement

---

### Domain A: Zod Boundary Safety (3 tasks — all HIGH)

- [X] Task A1: Fix Rule 18 false-negative — **`JSON.parse` excluded from valid parse check**
- [X] Task A2: Add Rule 26 (`WsOnmessageZod`) — **native `ws.onmessage` property assignment**
  - Handles BinaryExpression (`ws.onmessage = fn`) and PropertyAssignment
- [X] Task A3: Add Rule 27 (`JsonParseWithoutZod`) — **standalone `JSON.parse` on external strings**
  - Scoped to `scripts/` + `features/`; literal + JSON.stringify clone exempt; sibling Zod parse supported

---

### Domain G: Architecture Enforcement (1 task — HIGH)

- [X] Task G1: Add Rule 28 (`LiveKitClientBoundary`) — **browser SDK import boundary**
  - Static and dynamic `import('livekit-client')` blocked outside `apps/widget/`

---

### Post-Implementation

- [X] Task Z1: Run `pnpm check` — 0 violations on existing codebase (28 rules)
- [X] Task Z2: Add chaos tests:
  - `scripts/chaos-tests/rule18-json-parse-bypass.ts`
  - `scripts/chaos-tests/rule26-ws-onmessage-no-zod.ts`
  - `scripts/chaos-tests/rule27-json-parse-no-schema.ts`
  - `scripts/chaos-tests/rule28-livekit-client-server.ts`
- [X] Task Z3: Rule 27 literal exempt verified (`jsonParseLiteralOk` in chaos file)
- [X] Task Z4: Rule 28 allowed path — `apps/widget/` exempt (no widget app yet; rule scoped by path)
- [X] Task Z5: Updated `ast-firewall-analysis.md` Summary — 28 rules, 0 surface gaps

---

## Rule Number Map (after this plan)

| Rule | Name | Domain | Type |
|---|---|---|---|
| 18 | WebSocketBoundary (fixed) | A | Update — JSON.parse guard added |
| 26 | WsOnmessageZod | A | New |
| 27 | JsonParseWithoutZod | A | New |
| 28 | LiveKitClientBoundary | G | New |
