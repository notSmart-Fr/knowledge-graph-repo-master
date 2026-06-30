# Tasks: Customer Chat Widget + WhatsApp Audio Ingress

**Input**: Design documents from `specs/002-chat-widget/`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/interfaces.md](./contracts/interfaces.md)

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[USn]**: User story this task serves (US1–US5)
- All tasks include exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding — widget Vite app, widget-server skeleton, dependency installation

- [X] T001 Create `apps/widget/` directory structure and `apps/widget/package.json` with `dependencies: { "livekit-client": "^2" }` and `devDependencies: { "vite": "^6", "typescript": "^5" }`
- [X] T002 Create `apps/widget/vite.config.ts` — `build.lib.formats: ['iife']`, `build.lib.name: 'CrmWidget'`, `build.lib.fileName: () => 'widget.js'`, `build.rollupOptions.output.inlineDynamicImports: true` to produce a single-file IIFE bundle
- [X] T003 [P] Add `apps/widget` workspace entry to root `pnpm-workspace.yaml`. Note: `tsconfig.json` covers `apps/widget` via its `include` glob — no project reference entry needed (project references require `composite:true` which is incompatible with Vite `noEmit` builds)
- [X] T004 [P] Install `livekit-server-sdk` to `packages/ai-core` — `pnpm --filter @dtc/ai-core add livekit-server-sdk`
- [X] T005 [P] Install `fluent-ffmpeg` and `@types/fluent-ffmpeg` to the scripts runtime — `pnpm add -w fluent-ffmpeg @types/fluent-ffmpeg` or add to root `package.json` dependencies
- [X] T006 Create `scripts/widget-server.ts` skeleton — Node.js `http.createServer`, listen on `process.env.WIDGET_SERVER_PORT ?? 8290`, SIGTERM graceful shutdown handler, placeholder 404 for all routes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can begin

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 Fix `CartesiaSTTClient` in `scripts/voice-agent.ts`
- [X] T008 [P] Add `ILiveKitRoomManager`, `LiveKitRoomDetails`, `AgentDispatchOptions` interfaces to `packages/ai-core/src/core/ports.ts`
- [X] T009 Implement `LiveKitRoomAdapter` in `packages/ai-core/src/adapters/livekit/livekit-room.adapter.ts`
- [X] T010 Wire `LiveKitRoomAdapter` + `CircuitBreaker` into `scripts/widget-server.ts`
- [X] T011 [P] Add LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WEBHOOK_SECRET, WIDGET_SERVER_PORT, WIDGET_ALLOWED_ORIGINS (optional) to Zod schema in `packages/ai-core/src/config/env-schema.ts`
- [X] T012 [P] Run schema migration SQL from `data-model.md §Schema Change Summary` — document as `scripts/migrate-widget.ts` executable
- [X] T013 JWT validation middleware in `scripts/widget-server.ts`
- [X] T013b [P] Per-JWT rate-limit middleware in `scripts/widget-server.ts`
- [X] T014 Contact resolver helper in `scripts/widget-server.ts`
- [X] T015 [P] Extend `packages/ai-core/src/config/startup-validator.ts`
- [X] T016 [P] Extend `packages/ai-core/src/health/health-checks.ts`
- [X] T017 Widget shadow DOM entry point in `apps/widget/src/index.ts`
- [X] T018 [P] Widget EventTarget state store in `apps/widget/src/store.ts`

**Checkpoint**: Foundation ready — schema migrated, port defined, adapter implemented, auth middleware in place, widget entry point renders shadow DOM

---

## Phase 3: User Story 1 — Text Chat (Priority: P1) 🎯 MVP

**Goal**: Customer can embed the widget, send a text message, and receive a streamed AI response within 500ms

**Independent Test**: Embed on test page with seeded Supabase user → type "What's my deal status?" → verify first SSE token ≤ 500ms and response references deal stage

- [X] T019 [US1] `POST /widget/chat` route in `scripts/widget-server.ts` — parse `{sessionId, message}` (400 if message > 4000 chars), call `resolveContact()` (T014), call `orchestrator.process({contactId, message, channel:'widget'})`, write SSE: `data: {type:'token',content}` per chunk, terminal `data: {type:'done',sessionId,turnIndex}`, set `Content-Type: text/event-stream`, `Cache-Control: no-cache` (depends T013, T014)
- [X] T020 [P] [US1] Widget shell in `apps/widget/src/widget.ts` — `init(config)`: validate token, generate session UUID, store token + serverUrl in store, call probeHealth() to set voiceAvailable/sttAvailable; message list starts empty (no AI greeting, no orchestrator call on init); `open()` / `close()` toggle visibility; `destroy()` close any active room + clear store
- [X] T021 [P] [US1] Widget chat message list component in `apps/widget/src/ui/chat.ts` — `appendTurn(role, content, inputMode)` creates DOM `<li>` bubble with role class, `appendToken(content)` appends to last assistant bubble for streaming, `setLoading(bool)` shows/hides spinner, `scrollToBottom()` called after each append
- [X] T022 [P] [US1] Widget text input component in `apps/widget/src/ui/input.ts` — `<textarea>` with placeholder text "Ask me anything about your account…" for message, submit button (`aria-label="Send"`), Enter key handler (Shift+Enter = newline), `setDisabled(bool)` during stream, `onSend(message: string)` callback
- [X] T023 [P] [US1] Widget base styles in `apps/widget/src/ui/styles.ts` — exported CSS string for: chat container, message bubbles (customer/assistant), input row, send button, mic button, voice toggle, loading spinner, :host theming variables (`--crm-primary`, `--crm-bg`, `--crm-text`), light/dark mode via `prefers-color-scheme`
- [X] T024 [US1] Text mode module in `apps/widget/src/modes/text.ts` — `sendText(sessionId, message, token, serverUrl)`: POST /widget/chat with Authorization header, open `EventSource` (or fetch + ReadableStream), dispatch `store.appendToken()` per SSE token, dispatch `store.done()` on done event; handle HTTP 401 → dispatch `store.sessionExpired()`, HTTP 429 → dispatch `store.rateLimited(retryAfterMs)` (show "Sending too quickly — wait a moment", re-enable input after delay), HTTP 503 → dispatch `store.degraded('text')` (depends T022)
- [X] T025 [US1] Wire US1 components in `apps/widget/src/widget.ts` — on `init()`: instantiate chat + input into shadow root, subscribe to store events, wire `input.onSend` → `text.sendText()` → streaming tokens into `chat.appendToken()`; style injection via `styles.ts` CSS string (depends T020, T021, T022, T023, T024)
- [X] T026 [P] [US1] OTel span in `scripts/widget-server.ts` `/widget/chat` handler — `tracer.startActiveSpan('widget.chat', span => { span.setAttribute('channel','widget'); span.setAttribute('cache_hit', bool); })` (no PII attributes)
- [X] T027 [P] [US1] In-memory session registry in `scripts/widget-server.ts` — `Map<sessionId, {contactId, turnIndex, lastActive: Date}>`, 30-min TTL cleanup interval; `getOrCreate(sessionId, contactId)` → bumps `lastActive` on each use
- [X] T028 [US1] Self-check in `packages/ai-core/src/__tests__/widget-chat.selfcheck.ts` — start widget-server with mock `orchestrator.process()` returning 3 tokens, POST /widget/chat with valid mock JWT, assert response is `text/event-stream`, assert 3 `{type:'token'}` frames followed by `{type:'done'}` frame

**Checkpoint**: Text chat is fully functional. Run Scenario 1 from quickstart.md to confirm P95 < 500ms first token.

---

## Phase 4: User Story 3 — Live Voice Call (Priority: P1)

**Goal**: Customer clicks voice toggle, WebRTC room connects, voice-agent joins and processes speech end-to-end within 1.5s SLA

**Independent Test**: POST /widget/room → join with lk CLI → speak → verify crm-voice-agent joins within 15s and STT→TTS round-trip ≤ 1.5s

- [ ] T029 [P] [US3] Refactor `scripts/voice-agent.ts` to register as a LiveKit Agents SDK worker — add `agentName: "crm-voice-agent"` to worker options; job entrypoint reads `ctx.job.metadata` (JSON: contactId, sessionId) for orchestrator context; existing `CallLifecycleManager` logic reused as job implementation (depends T007)
- [ ] T030 [US3] `POST /widget/room` route in `scripts/widget-server.ts` — check `session.liveRoomName != null` → return HTTP 409 `{error:'room already active', roomName}`; call `breaker.invoke(() => lkManager.createWidgetRoom({contactId, sessionId}))`, update `session.liveRoomName` + write `live_room_name` to DB; return `{serverUrl, participantToken, roomName}` (depends T010, T027)
- [ ] T031 [P] [US3] `DELETE /widget/room/:roomName` route in `scripts/widget-server.ts` — auth middleware, verify roomName matches `session.liveRoomName`, call `lkManager.closeRoom(roomName)`, null `session.liveRoomName` + null DB `live_room_name` (depends T030)
- [ ] T032 [US3] `POST /livekit/webhook` route in `scripts/widget-server.ts` — call `lkManager.verifyWebhook(body, authHeader)`, return HTTP 401 on failure (NOT 200); handle `room_started` → arm `pendingRooms.set(roomName, setTimeout(15000, warnNoPickup))`; `participant_joined` kind=AGENT → `clearTimeout(pendingRooms.get(roomName))`; `room_finished` → null `live_room_name` in DB + session Map (depends T010)
- [ ] T033 [P] [US3] Barge-in in `scripts/voice-agent.ts` — subscribe to customer `trackStarted` event; when customer begins speaking and TTS `LocalAudioTrack` is active → `ttsTrack.stop()`, clear TTS buffer, restart pipeline from new STT input (depends T029)
- [ ] T034 [US3] Voice mode module in `apps/widget/src/modes/voice.ts` — `startVoice(sessionId, token, serverUrl)`: POST /widget/room → `{serverUrl, participantToken, roomName}`, dynamic `import('livekit-client')`, `new Room()`, `room.connect(serverUrl, participantToken)`, publish mic LocalAudioTrack, subscribe to agent audio track; on error (CSP block) → dispatch `store.voiceUnavailable('csp')`; `stopVoice(roomName)`: `room.disconnect()`, DELETE /widget/room/:roomName (depends T030)
- [ ] T035 [P] [US3] Voice toggle UI in `apps/widget/src/ui/input.ts` — extend input component with voice-mode button (distinct from mic clip button), states: idle / connecting / active / unavailable; `store.voiceAvailable=false` → button dimmed with "Voice temporarily unavailable" tooltip (depends T022)
- [ ] T036 [US3] Wire voice mode into `apps/widget/src/widget.ts` — voice toggle click → `voice.startVoice()` or `voice.stopVoice()`; on store `room_finished` event → auto-fall back to text mode, show "Voice connection lost — switching to text chat"; `destroy()` calls `voice.stopVoice()` if active (depends T034, T035)
- [ ] T037 [P] [US3] Startup room reconciliation in `scripts/widget-server.ts` boot — after schema migration: query `user_sessions WHERE live_room_name IS NOT NULL AND channel='widget'`, call `lkManager.listRooms()`, null any `live_room_name` entries where room no longer exists in LiveKit (depends T009, T012)
- [ ] T038 [P] [US3] OTel spans for `/widget/room` (POST + DELETE) and `/livekit/webhook` in `scripts/widget-server.ts` — spans include `room_name` attribute (not PII), `event_type` for webhook handler
- [ ] T039 [US3] Self-check in `packages/ai-core/src/__tests__/livekit-adapter.selfcheck.ts` — mock `livekit-server-sdk` API client, assert `LiveKitRoomAdapter.createWidgetRoom()` calls `RoomServiceClient.createRoom` + `AgentDispatchClient.createDispatch("crm-voice-agent", ...)`, assert `healthCheck()` resolves `true`/`false` based on mock response

**Checkpoint**: Live voice is functional. Agent joins, barge-in works, room cleaned up on tab close. Run Scenario 3 from quickstart.md.

---

## Phase 5: User Story 4 — WhatsApp Voice Message (Priority: P1)

**Goal**: WhatsApp voice note in → transcript → orchestrator → TTS audio → WhatsApp voice reply, end-to-end within 10s

**Independent Test**: POST simulated WhatsApp audio webhook with test media-id → verify text fallback sent (DLQ mock) when STT fails; verify audio reply path with real sandbox

- [ ] T040 [P] [US4] `CartesiaClipTranscriber` class in `packages/ai-core/src/features/calls/clip-transcriber.ts` — WebSocket to `wss://api.cartesia.ai/stt/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=24000&cartesia_version=2026-03-01&access_token=<key>`; `sendPCMChunks(buffer: Buffer, chunkSize=32768)` sends binary frames; `finalize()` sends text message `"finalize"` and resolves with transcript string; 30s total timeout per constitution II-a; closes WebSocket on resolve or timeout
- [ ] T041 [P] [US4] `transcodeToRaw(input: Buffer, sampleRate: number): Promise<Buffer>` in `scripts/audio-utils.ts` — `fluent-ffmpeg` pipe: stdin input → `-f s16le -ar {sampleRate} -ac 1` PCM output on stdout; on ffmpeg not found: throw `FfmpegNotFoundError` (caught by callers for degradation path); reusable by US2 audio upload + US4 WhatsApp path
- [ ] T042 [US4] WhatsApp audio message handler in `scripts/worker.ts` — detect `message.type === 'audio'`, extract `audio.id` (mediaId) and `from` (phone); branch to audio pipeline vs. existing text pipeline (existing text path unchanged) (depends T041)
- [ ] T043 [P] [US4] WhatsApp media download in `scripts/worker.ts` — `downloadWhatsAppAudio(mediaId, token)`: GET `/{media-id}` → `{url, mime_type}`; GET `{url}` with `Authorization: Bearer {token}` → raw audio `Buffer`; on 404/403 from second GET: retry GET `/{media-id}` once (URL refreshed), then throw if still fails (depends T042)
- [ ] T044 [US4] WhatsApp audio full pipeline in `scripts/worker.ts` — `downloadWhatsAppAudio()` → `transcodeToRaw()` → `CartesiaClipTranscriber.finalize()` → `orchestrator.process({channel:'whatsapp', message:transcript, contactId})` → Cartesia TTS WebSocket → audio Buffer → `POST /{phone}/media` multipart → `media_id` → `POST /{phone}/messages {type:'audio', audio:{id:media_id}}` (depends T040, T041, T043)
- [ ] T045 [P] [US4] TTS output size guard in `scripts/worker.ts` — if AI response text > 1000 words, truncate to first 1000 words before passing to Cartesia TTS; log truncation event with word count (no PII); do NOT send a separate text follow-up (FR-010) (depends T044)
- [ ] T046 [US4] DLQ fallback for all WhatsApp audio pipeline failures in `scripts/worker.ts` — wrap entire audio pipeline in try/catch: `IDeadLetterQueue.enqueue({type:'whatsapp_audio_fallback', phone:encrypted, mediaId, error:sanitized, retries:0})` + send WhatsApp text reply "I received your voice message but couldn't process audio right now. Could you type your question?" (depends T044, T049 constraint: no raw PII in DLQ payload)
- [ ] T047 [P] [US4] OTel spans for WhatsApp audio pipeline in `scripts/worker.ts` — spans: `whatsapp.audio.download`, `whatsapp.audio.transcode`, `whatsapp.audio.stt`, `whatsapp.audio.tts`, `whatsapp.audio.reply`; no PII span attributes
- [ ] T048 [US4] Self-check in `packages/ai-core/src/__tests__/whatsapp-audio.selfcheck.ts` — mock `CartesiaClipTranscriber` (timeout throws), mock `IDeadLetterQueue`, mock WhatsApp send; trigger audio webhook handler; assert `DLQ.enqueue` called with `type:'whatsapp_audio_fallback'`; assert WhatsApp text fallback message sent

**Checkpoint**: WhatsApp audio path complete. Both happy-path and DLQ fallback verified. Run Scenario 5 from quickstart.md.

---

## Phase 6: User Story 2 — Voice Clip on Widget (Priority: P2)

**Goal**: Customer holds mic button, records ≤60s clip, receives transcription + streamed AI reply within 5s

**Independent Test**: Hold mic button, speak 5-second clip, release → verify transcript appears, full AI response arrives < 5s

- [ ] T049 [US2] `POST /widget/audio` route in `scripts/widget-server.ts` — parse multipart (busboy, 10MB limit); validate MIME type (webm/ogg/mpeg/mp4 → 415 otherwise); check ffmpeg available (from startup flag set by T015) → 503 `{degraded:true,fallback:'text'}` if absent; call `transcodeToRaw()` (reuse T041) → `CartesiaClipTranscriber.finalize()` (reuse T040) → `orchestrator.process()` → SSE stream with `{type:'transcript',content}` first frame, then `{type:'token'}` frames, terminal `{type:'done'}` (depends T013, T014, T027, T040, T041)
- [ ] T050 [P] [US2] MediaRecorder clip module in `apps/widget/src/modes/clip.ts` — `startRecording()`: `navigator.mediaDevices.getUserMedia({audio:true})`, `new MediaRecorder(stream, {mimeType:'audio/webm;codecs=opus'})`, collect `ondataavailable` chunks, auto-stop at 60s with store notification "Voice clips limited to 60 seconds"; `stopAndUpload(sessionId, token, serverUrl)`: assemble `Blob`, POST multipart to `/widget/audio`, consume SSE response tokens → dispatch to store; handle HTTP 429 → dispatch `store.rateLimited(retryAfterMs)` (same pattern as T024)
- [ ] T051 [P] [US2] Mic button UI in `apps/widget/src/ui/input.ts` — extend existing input component with mic button: `pointerdown` → `clip.startRecording()`, `pointerup` / `pointerleave` → `clip.stopAndUpload()`; recording state shows animated pulse ring; 60s countdown timer display; `store.sttAvailable=false` → button dimmed, tooltip "Voice transcription unavailable"
- [ ] T052 [US2] Wire clip mode into `apps/widget/src/widget.ts` — mic button events → `clip.startRecording` / `clip.stopAndUpload`; on transcript SSE frame → `chat.appendTurn('customer', transcript, 'clip')`; on token frames → `chat.appendToken()`; on SSE error / 503 → dispatch `store.sttUnavailable()` → show "Voice transcription temporarily unavailable — please type instead" (depends T049, T050, T051)
- [ ] T053 [P] [US2] OTel span for `/widget/audio` route in `scripts/widget-server.ts` — `tracer.startActiveSpan('widget.audio', ...)`, record `clip_duration_ms`, `transcript_length` (not transcript text — PII)
- [ ] T054 [P] [US2] Self-check in `packages/ai-core/src/__tests__/clip-transcriber.selfcheck.ts` — mock WebSocket, call `sendPCMChunks(Buffer.alloc(65536))`, assert 2 binary frames sent (chunkSize=32768), then call `finalize()`, assert text frame `"finalize"` sent, mock response `{type:'transcript', text:'hello'}`, assert resolves 'hello'

**Checkpoint**: Voice clip fully wired. All three widget input modes (text, clip, live) are now functional.

---

## Phase 7: User Story 5 — Graceful Degradation (Priority: P2)

**Goal**: Widget stays interactive even when LiveKit, Cartesia, or ffmpeg are unavailable; text mode never fails

**Independent Test**: Stop voice-agent → POST /widget/room → expect 503; send 401 JWT → expect session-expired banner; confirm text mode works throughout

- [ ] T055 [P] [US5] LiveKit health in `/ready` endpoint — `packages/ai-core/src/health/health-checks.ts`: call `ILiveKitRoomManager.healthCheck()` with 3s timeout (per constitution II-a: Redis=3s, treat LiveKit similarly); return `livekit: 'healthy'|'degraded'` in response body (depends T016)
- [ ] T056 [US5] Widget availability probe in `apps/widget/src/widget.ts` — on `init()`, fetch `{serverUrl}/ready`, read `adapters.livekit` and `adapters.cartesia` status; set `store.voiceAvailable = adapters.livekit === 'healthy'`, `store.sttAvailable = adapters.cartesia === 'healthy'`; probe runs silently (network failure = assume degraded, no UI crash) (depends T020)
- [ ] T057 [P] [US5] Degradation UI in `apps/widget/src/ui/input.ts` — subscribe to store events `voiceUnavailable` and `sttUnavailable`; voice toggle button: dimmed CSS class + tooltip "Voice temporarily unavailable"; mic button: dimmed + tooltip "Voice transcription unavailable" (depends T035, T051)
- [ ] T058 [P] [US5] JWT expiry handling in `apps/widget/src/modes/text.ts` and `apps/widget/src/modes/clip.ts` — on HTTP 401 `{reason:'expired'}` from any endpoint → dispatch `store.sessionExpired()` → widget shows banner "Session expired — please refresh to continue"; set `store.blocked = true`; all further fetch calls check `store.blocked` and no-op (depends T024, T050)
- [ ] T059 [P] [US5] 15-second no-pickup watchdog in `scripts/widget-server.ts` webhook handler — on `room_started`: `pendingRooms.set(roomName, setTimeout(() => logger.warn({room: roomName, event:'no-agent-pickup'}, 'Voice agent did not join room within 15s'), 15000))`; on `participant_joined` kind=AGENT: `clearTimeout(pendingRooms.get(roomName)); pendingRooms.delete(roomName)` (depends T032)
- [ ] T060 [P] [US5] ffmpeg absent graceful path in `scripts/widget-server.ts` — startup sets `global.ffmpegAvailable = checkFfmpeg()`; `/widget/audio` route checks flag, returns 503 `{error:'audio unavailable', degraded:true, fallback:'text'}` before any processing; `/ready` reflects `ffmpeg: 'healthy'|'degraded'` (depends T015)
- [ ] T061 [US5] Validate US5 via quickstart.md Scenario 6 — stop voice-agent process, POST /widget/room, assert HTTP 503; send request with expired JWT, assert 401 and store.blocked=true; confirm POST /widget/chat still returns SSE

**Checkpoint**: All 5 user stories complete and independently testable. Degradation paths verified.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Bundle validation, firewall compliance, observability, documentation

- [ ] T062 [P] Add `bundlesize` entry to `apps/widget/package.json` — add `"bundlesize": [{"path":"./dist/widget.js","maxSize":"100 kB"}]` and `"postbuild": "bundlesize"` script; run `pnpm --filter @dtc/widget build` to verify ≤ 100 KB gzipped
- [ ] T069 [P] Keyboard navigation + ARIA audit across `apps/widget/src/ui/` (FR-018, SC-009) — in `input.ts`: add `tabIndex=0` and `aria-label` to send button, mic button, voice toggle, close button; add Escape keydown handler on shadow root → `widget.close()`; in `chat.ts`: add `role="log"` + `aria-live="polite"` on message list `<ul>`; in `index.ts`: add `role="dialog"` + `aria-label="Chat widget"` on shadow host; verify Tab order matches visual order (input → send → mic → voice toggle → close)
- [ ] T063 [P] CORS middleware in `scripts/widget-server.ts` — set `Access-Control-Allow-Origin: *` by default; if `WIDGET_ALLOWED_ORIGINS` env is set, parse comma-separated list and validate `Origin` header against it; send 403 on mismatch
- [ ] T064 [P] Run `pnpm check` (AST firewall) and fix any violations — expected checks: `ILiveKitRoomManager` in `ports.ts` satisfies Rule 16 (port naming), `LiveKitRoomAdapter` satisfies Rule 1 (implements exactly one port), `widget-server.ts` covered by scan paths, `clip-transcriber.ts` has correct error handling
- [ ] T065 [P] Env schema final sweep — run `pnpm --filter @dtc/ai-core exec tsx scripts/validate.ts` to confirm all new env vars from T011 are in the Zod schema and startup validator surfaces missing vars with clear messages
- [ ] T066 [P] Update `.knowledge/code-map.md` — add entries for: `scripts/widget-server.ts`, `scripts/audio-utils.ts`, `packages/ai-core/src/adapters/livekit/livekit-room.adapter.ts`, `packages/ai-core/src/features/calls/clip-transcriber.ts`, `apps/widget/src/` (all modules), updated `scripts/voice-agent.ts` (CartesiaSTT fix + worker registration)
- [ ] T067 Run `pnpm test` — 0 failures required across all self-checks: `widget-chat.selfcheck.ts` (T028), `livekit-adapter.selfcheck.ts` (T039), `whatsapp-audio.selfcheck.ts` (T048), `clip-transcriber.selfcheck.ts` (T054)
- [ ] T068 Run quickstart.md full validation sweep — complete all 6 scenarios: text chat (SC1), voice clip (SC2), room creation (SC3), widget embed in browser (SC4), WhatsApp audio mock (SC5), degradation (SC6)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: No dependencies. Start immediately.
- **Phase 2 — Foundational**: Depends on Phase 1. **Blocks all user stories.**
- **Phase 3 — US1 Text Chat (P1)**: Depends on Phase 2. Can start as soon as T013, T014, T017, T018 are done.
- **Phase 4 — US3 Live Voice (P1)**: Depends on Phase 2. Can start in parallel with Phase 3 (different files). Requires T009 (adapter) complete.
- **Phase 5 — US4 WhatsApp Voice (P1)**: Depends on Phase 2. Can start in parallel with Phases 3+4. Requires T007 (STT fix), T040 (clip transcriber), T041 (ffmpeg util) complete.
- **Phase 6 — US2 Voice Clip (P2)**: Depends on Phase 2 + T040 + T041 (both from Phase 5). Start Phase 6 after T040–T041 complete.
- **Phase 7 — US5 Degradation (P2)**: Depends on Phases 3–6 (validates integration of all degradation paths).
- **Phase 8 — Polish**: Depends on all user story phases complete.

### User Story Dependency Graph

```
Phase 1: Setup
    ↓
Phase 2: Foundation (T007–T018) — BLOCKS ALL
    ↓               ↓               ↓
 Phase 3           Phase 4         Phase 5
 US1 P1             US3 P1          US4 P1
 Text Chat         Live Voice      WA Voice
 (T019–T028)       (T029–T039)     (T040–T048)
                                       ↓
                                   Phase 6
                                   US2 P2
                                  Voice Clip
                                  (T049–T054)
                     ↓               ↓
                   Phase 7: US5 Degradation (T055–T061)
                                   ↓
                           Phase 8: Polish (T062–T068)
```

### Within Each Story

- Port/interface before adapter (T008 before T009)
- Middleware before routes (T013 before T019)
- Widget store before UI components (T018 before T021–T023)
- Backend route before frontend mode module (T019 before T024)
- Individual components [P] before wiring (T021+T022+T023 in parallel, then T025)

### Parallel Opportunities

Phase 1: T003, T004, T005 all run in parallel with T001–T002
Phase 2: T008, T011, T012, T015, T016, T018 all run in parallel after T006
Phase 3: T020, T021, T022, T023 run in parallel; T024 and T025 depend on prior
Phase 4: T029, T031, T033, T035 run in parallel (different files)
Phase 5: T040, T041 run in parallel (reusable utilities, no cross-dep)
Phase 6: T050, T051 run in parallel; T052 wires them
Phase 8: T062–T066, T069 all fully parallel

---

## Parallel Execution Examples

### Phase 2 Parallel Batch (after T006 complete)
```
Task: "T008 [P] Add ILiveKitRoomManager to ports.ts"
Task: "T011 [P] Run schema migration SQL"
Task: "T012 [P] Add env vars to env-schema.ts"
Task: "T015 [P] Extend startup-validator.ts"
Task: "T018 [P] Widget EventTarget state store"
```

### Phase 3 Parallel Batch (UI components)
```
Task: "T020 [P] [US1] Widget shell widget.ts"
Task: "T021 [P] [US1] Chat message list ui/chat.ts"
Task: "T022 [P] [US1] Text input component ui/input.ts"
Task: "T023 [P] [US1] Widget base styles ui/styles.ts"
Task: "T026 [P] [US1] OTel span for /widget/chat"
Task: "T027 [P] [US1] Session registry Map in widget-server.ts"
```

---

## Implementation Strategy

### MVP First (US1: Text Chat — T001–T028)

1. Phase 1: Setup (T001–T006) — scaffold widget app + server
2. Phase 2: Foundation (T007–T018) — auth, schema, port, shadow DOM
3. Phase 3: US1 (T019–T028) — POST /widget/chat SSE + widget text UI
4. **STOP AND VALIDATE**: Embed widget on test page, send message, confirm stream < 500ms
5. Ship MVP — text chat is independently useful without voice

### Incremental Delivery

1. MVP: US1 (text chat) → demo-ready storefront widget
2. +US3 (live voice) → full voice call experience, same SLA as phone channel
3. +US4 (WhatsApp audio) → WhatsApp parity with voice reply
4. +US2 (voice clip) → async voice option in widget, no WebRTC overhead
5. +US5 (degradation) → production hardening, customer trust baseline

### Task Count Summary

| Phase | Tasks | Stories | Notes |
|---|---|---|---|
| 1 — Setup | T001–T006 | — | 6 tasks |
| 2 — Foundation | T007–T018 + T013b | — | 13 tasks, blocks all |
| 3 — US1 Text Chat | T019–T028 | US1 P1 | 10 tasks, MVP |
| 4 — US3 Live Voice | T029–T039 | US3 P1 | 11 tasks |
| 5 — US4 WA Voice | T040–T048 | US4 P1 | 9 tasks |
| 6 — US2 Voice Clip | T049–T054 | US2 P2 | 6 tasks |
| 7 — US5 Degradation | T055–T061 | US5 P2 | 7 tasks |
| 8 — Polish | T062–T069 | — | 8 tasks |
| **Total** | **T001–T069 + T013b** | **5 stories** | **70 tasks** |

---

## Notes

- All [P] tasks touch different files and have no dependency on concurrent tasks — safe to run in parallel
- Each user story has at least one self-check test (`*.selfcheck.ts`) that fails without the implementation
- Self-checks use zero-dependency mocks (no test framework, assert-only) per constitution test discipline
- `livekit-client` (browser SDK) is imported only in `apps/widget/` — never in `packages/ai-core/` or `scripts/` (AST firewall must not flag it)
- All catch blocks: variable typed as `: unknown`, no `as any`, at least one log/enqueue statement
- Audio files never written to disk: piped through in-memory Buffers only
- Commit after each checkpoint (T028, T039, T048, T054, T061, T068)
