# Implementation Plan: Customer Chat Widget + WhatsApp Audio Ingress

**Branch**: `002-chat-widget` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-chat-widget/spec.md`

## Summary

Add a third transport channel to the existing AI CRM: an embeddable customer-facing chat widget (`apps/widget/`) and an extension to the WhatsApp worker that handles audio messages. The orchestrator is untouched — both new transports converge at the existing `orchestrator.process()` boundary. Three input modes are supported in the widget: text (HTTP POST + SSE), async voice clip (multipart upload → Cartesia Ink-2 STT stream → text SSE reply), and live voice call (LiveKit WebRTC room + Cartesia Ink-2 streaming STT + Cartesia TTS). WhatsApp audio messages mirror the existing voice pipeline using the Cartesia WebSocket STT with `finalize` command for async clips.

**Key pre-implementation fix required**: The existing `CartesiaSTTClient` in `scripts/voice-agent.ts` connects to `/tts/websocket` — the TTS endpoint — instead of the correct STT endpoint `wss://api.cartesia.ai/stt/turns/websocket`. This must be corrected before any widget voice work begins.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22+ (unchanged from spec 001)
**Package Manager**: pnpm 11.x workspace (unchanged)
**Primary New Dependencies**: `livekit-server-sdk` (room management + token generation + agent dispatch), `livekit-client` (browser SDK, widget only)
**Storage**: No schema additions beyond extending `user_sessions.channel` to accept `'widget'`. Widget sessions reuse the existing `user_sessions` table.
**Testing**: vitest, zero additional dependencies (unchanged)
**Target Platform**: Same as spec 001 — Node.js scripts + Vite static build

**Project Type**: Extends the existing monorepo:
- `apps/widget/` — new Vite app (IIFE bundle, embeddable)
- `scripts/widget-server.ts` — new HTTP server (port 8290)
- `packages/ai-core/` — adds one new port interface (`ILiveKitRoomManager`)

**Performance Goals**:
- Widget text: first SSE token < 500ms P95, measured from **HTTP request received at widget-server** to first `data:` SSE frame sent (excludes network RTT; consistent with spec 001 measurement convention)
- Widget voice clip: full SSE response < 5s P95 for clips ≤ 30s, measured from **multipart upload complete at widget-server** to SSE `done` event
- Widget live voice: STT-finalization → first TTS audio byte < 1.5s P95 (same as spec 001 voice SLA, measured inside voice-agent process)
- WhatsApp audio reply: full cycle < 10s P95 for clips ≤ 2 min, measured from **webhook receipt** to WhatsApp `messages` API call returning 200

**Constraints**:
- Widget JS bundle ≤ 100 KB gzipped (no framework, no heavy dependencies) — enforced at build time via `vite-bundle-analyzer` or `bundlesize` CI check
- LiveKit 50 GB/month free tier: one room per widget session, rooms auto-cleaned on empty
- Cartesia single API key for both STT (Ink-2) and TTS (Sonic)
- Voice-agent process must be running alongside widget-server (same deployment unit on free tier)
- CORS policy: widget-server `Access-Control-Allow-Origin` defaults to `*` (public widget). Optionally locked to a host allowlist via `WIDGET_ALLOWED_ORIGINS` env var (comma-separated). All JWT validation happens server-side — CORS is a defence-in-depth measure, not the primary auth gate.
- `livekit-client` (browser SDK) must NOT be imported by `packages/ai-core/` or `scripts/` — widget-only dependency, excluded from AST firewall scan paths.
- Rate limiting: per-JWT (per `contactId`) in-memory sliding window — 30 req/min on `POST /widget/chat`, 10 req/min on `POST /widget/clip` and `GET /widget/room-token`. Returns HTTP 429 `{error:'rate_limit_exceeded', retryAfterMs}`. No Redis needed at free-tier scale (FR-016).
- Session ephemerality: each `window.crmWidget.init()` starts a fresh session with an empty message list. No history-load endpoint or resume UX. Prior session messages are stored for CRM operator review only (FR-017, clarified 2026-06-30).
- Widget initial state: static placeholder text in input box, empty message list. No AI greeting, no orchestrator call on `init()` — first request fires only on customer's first message (FR-017).
- WhatsApp TTS reply size cap: AI text response MUST be truncated to ≤ 1000 words before passing to Cartesia TTS to keep outgoing audio under WhatsApp's 16 MB media upload limit (FR-010).
- Accessibility: keyboard navigation (Tab/Enter/Escape) and ARIA roles on all interactive elements required. Full WCAG 2.1 AA compliance is out of scope for this release (FR-018, SC-009).

**Scale/Scope**: Low concurrent widget sessions expected at free-tier scale (< 5 simultaneous). LiveKit room limit not a constraint at this scale.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Port-Adapter Architecture | **PASS** | `ILiveKitRoomManager` defined in `core/ports.ts`. `LiveKitRoomAdapter` in `adapters/livekit/`. Widget-server depends only on port interface, never on adapter directly. Orchestrator untouched. |
| II. Graceful Degradation | **PASS** | Constitution II-a already specifies `LiveKit / Cartesia (STT + TTS) | 30s timeout | 0 retries | Polite fallback message`. Widget mode-level degradation: (1) voice unavailability detected via HTTP 503 from `POST /widget/room` — widget automatically shows "Live voice unavailable, use voice clip instead" and switches to clip mode; (2) clip STT failure → SSE error event → widget shows "Could not process audio, please type your message"; (3) final text fallback always available. WhatsApp audio failures route to DLQ with text reply (FR-011). |
| III. PII Security by Default | **PASS** | Voice clip audio files never persisted (transcription-only). Widget session messages encrypted as JSONB per existing `user_sessions` AES-256-GCM. Customer email/name from JWT stored in contact per existing encryption policy. No PII in widget-server logs or spans (AST firewall Rule 5, 13). |
| IV. Compile-Time Safety (AST Firewall) | **PASS** | Widget-server is scanned by `pnpm check`. New `ILiveKitRoomManager` port in `core/ports.ts` is covered by Rule 16. Any adapter call in widget-server goes through circuit breaker. |
| V. Observability-Driven Operations | **PASS** | Widget-server wraps each request in `tracer.startActiveSpan()`. Health endpoint piggybacked on existing port 8280 `/ready` (widget-server status included as new adapter entry). Max 8 spans per widget request (same as orchestrator ceiling). |
| VI. Deployment Safety | **PASS** | Six new env vars: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (LiveKit credentials), `LIVEKIT_WEBHOOK_SECRET` (webhook signature verification), `WIDGET_SERVER_PORT` (default 8290), `WIDGET_ALLOWED_ORIGINS` (optional CORS allowlist). `startup-validator.ts` extended with widget-server + ffmpeg checks. No schema migrations — existing `user_sessions` table extended in-application. |

**Constitution gates all pass.** No violations. No complexity tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-chat-widget/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── interfaces.md    # Phase 1 output
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
# New
apps/widget/              # Embeddable customer chat widget
├── src/
│   ├── index.ts          # IIFE entry point — Shadow DOM init, window.crmWidget API
│   ├── widget.ts         # Widget shell — auth, mode state, message history
│   ├── modes/
│   │   ├── text.ts       # POST /widget/chat → SSE stream
│   │   ├── clip.ts       # MediaRecorder → multipart upload → SSE stream
│   │   └── voice.ts      # livekit-client WebRTC room join/leave
│   ├── ui/
│   │   ├── chat.ts       # Message list DOM component
│   │   ├── input.ts      # Text input + mic button + mode toggle
│   │   └── styles.ts     # Inlined CSS (injected into Shadow DOM)
│   └── store.ts          # EventTarget state store (same pattern as apps/web/)
├── vite.config.ts        # IIFE lib build, inline CSS, no chunk splitting
└── package.json

scripts/widget-server.ts  # New HTTP server (port 8290)

# Extended
packages/ai-core/src/
├── core/
│   └── ports.ts          # + ILiveKitRoomManager interface
├── adapters/
│   └── livekit/
│       └── livekit-room.adapter.ts  # Implements ILiveKitRoomManager
└── config/
    └── startup-validator.ts  # + widget-server health check

scripts/
├── voice-agent.ts        # Fix CartesiaSTTClient endpoint; add widget session identity
└── worker.ts             # + audio message handler + WhatsApp audio reply path
```

## Complexity Tracking

> No constitution violations — section left blank.
