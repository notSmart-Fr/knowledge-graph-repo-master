# Research: Customer Chat Widget + WhatsApp Audio Ingress

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Decisions

### 1. Cartesia STT: Ink-2 Streaming WebSocket (Not Batch REST)

**Decision**: Cartesia Ink-2 streaming STT over WebSocket for all voice input paths (live, clip, WhatsApp audio).

**Rationale**: Cartesia released their STT product (Ink-2) in May 2026. There is no batch/REST transcription endpoint — only two WebSocket endpoints:
- **With auto turn detection**: `wss://api.cartesia.ai/stt/turns/websocket` (model=ink-2, API version 2026-03-01) — preferred for live voice calls
- **With manual finalization**: `wss://api.cartesia.ai/stt/websocket` — preferred for async clips (stream audio chunks, send text message `"finalize"` to trigger transcription)

For async voice clips and WhatsApp audio:
1. Open a WebSocket to the manual endpoint
2. Send the audio file as PCM chunks (decode from WebM/OGG/OGP using a server-side decoder before sending)
3. Send `"finalize"` to receive the transcript
4. Close the WebSocket

**Pre-implementation fix required**: The existing `CartesiaSTTClient` in `scripts/voice-agent.ts` connects to `wss://api.cartesia.ai/tts/websocket` — the TTS endpoint. The correct STT endpoints are `/stt/turns/websocket` (live) and `/stt/websocket` (manual/clip). Fix the URL before any voice work.

**Cartesia Ink-2 constraints**:
- English only (as of 2026-06-30) — acceptable for current scope
- Audio encoding: `pcm_s16le`, `pcm_s32le`, `pcm_f16le`, `pcm_f32le`, `pcm_mulaw`, `pcm_alaw`
- Sample rate: configurable (24000 is the standard for WebM/browser recording)

**Alternatives considered**:
- OpenAI Realtime API — Cartesia provides a migration guide from OpenAI Realtime Transcription to Cartesia `/stt/turns/websocket`. Drop-in shape compatibility means switching is < 1 day of work if needed.
- Browser Web Speech API — not viable: no server-side access, language/browser coverage inconsistent, no offline capability.
- No second STT provider needed at free-tier scale: Cartesia STT failure is handled by graceful degradation — circuit breaker opens → voice clip/live endpoints return HTTP 503 → widget falls back to text mode → WhatsApp audio failures route to DLQ with text reply. This is consistent with the existing degradation policy (Constitution II-a: `LiveKit / Cartesia | 30s timeout | 0 retries | polite fallback`). Adding a second STT provider would require a second API key, a second WebSocket contract, and additional firewall adapter rules — none of which are justified at < 5 concurrent sessions.

---

### 2. Widget-to-Voice-Agent Dispatch: LiveKit AgentDispatchClient

**Decision**: Use `AgentDispatchClient.createDispatch(roomName, "crm-voice-agent", { metadata })` from `livekit-server-sdk` to signal the voice-agent to join a widget room.

**Rationale**: LiveKit's official dispatch mechanism requires no IPC, no webhook polling, no Redis pub/sub between widget-server and voice-agent. The widget-server calls the LiveKit Cloud API, which dispatches the job to the registered agent worker. The voice-agent process must register with agent name `"crm-voice-agent"` using the LiveKit Agents Node.js SDK worker pattern.

Dispatch flow:
1. Customer calls `startVoice()` in widget
2. Widget-server creates room via `RoomServiceClient.createRoom(roomName)`
3. Widget-server mints customer token via `AccessToken` (identity = contactId, 15-min TTL)
4. Widget-server calls `AgentDispatchClient.createDispatch(roomName, "crm-voice-agent", { metadata: JSON.stringify({ contactId, sessionId }) })`
5. LiveKit dispatches job to voice-agent worker
6. Widget-server returns `{ serverUrl, participantToken }` to widget client
7. Widget opens LiveKit room using `livekit-client`
8. Voice-agent joins room, Cartesia Ink-2 STT begins

**Room naming**: `widget-{contactId}-{nanoid(8)}` — unique per session, prevents stale dispatch bug.

**No-pickup monitoring**: On dispatch creation, store a 15s expiry timer. If `participant_joined` webhook (kind=AGENT) doesn't arrive, emit a health warning log (no hard failure — free tier voice slots limited).

**Alternatives considered**:
- In-process EventEmitter IPC (widget-server + voice-agent in same process) — simpler but couples two independent processes; forces single-process deployment; harder to scale.
- LiveKit webhook `room_started` → widget-server signals voice-agent via HTTP — adds internal HTTP hop, requires widget-server to know voice-agent URL.
- The chosen approach (AgentDispatchClient) is the documented LiveKit best practice and requires zero custom IPC code.

---

### 3. Embeddable Widget Build: Vite IIFE + Shadow DOM + Vanilla TS

**Decision**: Vite 6 `build.lib.formats: ['iife']` producing a single `widget.js` ≤ 100 KB gzipped. Vanilla TypeScript (no framework) to match `apps/web/` pattern. Shadow DOM for style isolation.

**Rationale**: 
- IIFE: single `<script>` tag on host page, no module system required, no CORS issues.
- Shadow DOM: `customElements.define('crm-widget', CrmWidgetElement)` with `attachShadow({ mode: 'open' })`. CSS compiled to string and injected into shadow root on `connectedCallback`.
- No CSS framework: vendor-copied minimal CSS. `@property` declarations in Shadow DOM are not supported by browsers (Tailwind CSS v4 `@property` issue confirmed) — plain CSS avoids this entirely.
- Async loader pattern: `window.crmWidget.init({ token })` queues commands until the script loads, then executes.
- `livekit-client` (browser SDK) is the largest dependency — only imported when voice mode is activated (dynamic import).

**CSS Shadow DOM constraint**: Tailwind v4 uses `@property` which doesn't work in shadow roots. Decision: write minimal hand-crafted CSS for the widget. The widget UI is simple (text bubbles, mic button, mode toggle) — no utility framework needed.

**Build output**:
- `apps/widget/dist/widget.js` — single IIFE, all JS + CSS inlined
- Host page: `<script src="/widget.js"></script>` then `window.crmWidget.init({ token: '<supabase-jwt>' })`

**Alternatives considered**:
- React + Rollup — adds React 19 (~45KB) to bundle; virtual DOM overhead unnecessary for simple chat UI.
- Svelte + Rolldown — better than React but adds Svelte runtime; inconsistent with project's vanilla TS pattern.
- Web Component without Shadow DOM — host page CSS would break widget styling; rejected.

---

### 4. Widget Server Transport: HTTP POST + SSE for Text/Clip, WebRTC for Live Voice

**Decision**: Three distinct transport paths from widget to backend:
1. **Text**: `POST /widget/chat` → synchronous orchestrator call → `text/event-stream` SSE response
2. **Voice clip**: `POST /widget/audio` (multipart `audio/webm`) → Cartesia STT → text → orchestrator → SSE response
3. **Live voice**: `POST /widget/room` → AgentDispatch → return `{ serverUrl, participantToken }` → widget uses `livekit-client` directly

**Rationale**: Each mode has different latency and streaming requirements. SSE (server-sent events) is the simplest streaming protocol for text — already used in the project pattern (no WebSocket library needed server-side). LiveKit handles the WebRTC complexity for live voice. No WebSocket server needed in widget-server (LiveKit provides that).

**Authentication**: Every widget-server request carries `Authorization: Bearer <supabase-jwt>`. Widget-server validates JWT via Supabase `auth.getUser()`, resolves to `contactId`. JWT validation adds < 50ms (Supabase auth fast path with service role key bypass).

**Alternatives considered**:
- WebSocket for text streaming — adds ws library dependency, complicates connection lifecycle. SSE is sufficient for unidirectional streaming.
- Single WebSocket for all modes — overly complex state machine; SSE + LiveKit is simpler and well-suited per mode.

---

### 5. WhatsApp Audio Ingress: Media Download → Cartesia STT → Text Orchestrator → TTS Reply

**Decision**: Extend `scripts/worker.ts` WhatsApp webhook handler to detect `message.type === 'audio'`, download the audio file from Meta's CDN, pipe to Cartesia STT manual WebSocket (`finalize`), run orchestrator with transcript, generate TTS reply via Cartesia TTS, upload audio to WhatsApp media API, send audio message reply.

**WhatsApp Audio API flow**:
1. `GET /{media-id}` (Meta Graph API) → returns `{ url, mime_type }` (URL is short-lived, ~5 min)
2. `GET {url}` with `Authorization: Bearer {WHATSAPP_TOKEN}` → audio file bytes (OGG/Opus format typically)
3. Decode OGG/Opus → PCM for Cartesia STT (using Node.js `ffmpeg` subprocess or `opusscript` npm package)
4. Cartesia STT manual WebSocket → transcript
5. Orchestrator → AI text response
6. Cartesia TTS WebSocket → audio bytes (MP3 or OGG)
7. `POST /{phone-number-id}/media` (multipart form) → media-id
8. `POST /{phone-number-id}/messages` with `{ type: "audio", audio: { id: media-id } }` → send reply

**Audio decoding**: WhatsApp sends audio as OGG/Opus. Browser `MediaRecorder` outputs `audio/webm;codecs=opus` (Chrome) or `audio/ogg;codecs=opus` (Firefox). Cartesia STT requires raw PCM. Decision: use `fluent-ffmpeg` npm package (wraps system ffmpeg) for server-side transcoding to PCM.

**Deployment options for ffmpeg** (ranked by preference for free-tier Node.js):
1. **System ffmpeg** — available by default on Render, Railway, Fly.io, and most Linux container environments. Set `FFMPEG_PATH` if non-standard. Confirm with `ffmpeg -version` in deployment environment.
2. **`@ffmpeg-installer/ffmpeg`** — npm package that bundles a platform-appropriate ffmpeg binary (~50 MB). No system dependency. Adds to install time. Use if deployment environment lacks system ffmpeg.
3. **`@ffmpeg/ffmpeg` (WASM)** — no binary, runs in Node.js. ~30 MB package, 3–5s cold-start overhead per process. Acceptable for widget-server (long-lived process, not serverless).
4. **Vercel**: ffmpeg is NOT available in Vercel Edge/Serverless. `widget-server.ts` must not run on Vercel — run as a long-lived Node.js process (Render Free, Railway Starter, or local). This is already implied by the deployment model (long-lived voice-agent + widget-server).

Decision: use `fluent-ffmpeg` with system ffmpeg as the default. Document `@ffmpeg-installer/ffmpeg` as the drop-in if system ffmpeg is absent. The `scripts/widget-server.ts` startup validator checks `ffmpeg -version` and logs a warning (not a crash) if absent — WhatsApp audio path degraded, text still works.

**DLQ for audio failures**: If STT fails or TTS fails, enqueue a WhatsApp text message reply ("I received your voice message but had trouble processing it — please type your message") via the existing `IDeadLetterQueue` mechanism.

**Alternatives considered**:
- Third-party transcription service for WhatsApp audio — adds cost/dependency. Cartesia STT handles this natively with `finalize` command.
- Text-only reply to WhatsApp audio — spec explicitly requires voice reply for voice input (FR-008).

---

### 6. Widget Authentication: Host-Page Supabase JWT

**Decision**: Host page authenticates customer via Supabase Auth, passes `accessToken` to `window.crmWidget.init({ token })`. Widget-server validates every request with this token via `supabase.auth.getUser(token)`. On first visit, widget-server auto-creates a CRM contact from the JWT `user_metadata` (name, email encrypted per policy).

**Rationale**: Single source of auth truth (Supabase). No second login flow in widget. Contact creation is idempotent — keyed on `auth.uid`, not phone (widget customers may not have phone numbers).

**Token refresh**: `livekit-client` handles token expiry for live voice (AccessToken TTL = 15 min). For text/clip SSE connections, each request carries a fresh JWT from the browser's Supabase Auth session. Widget-side Supabase Auth JS SDK handles token refresh automatically.

**Alternatives considered**:
- Widget-managed login flow — adds complexity, duplicates auth UI already on the host page.
- API key per customer — no user identity, no contact resolution. Rejected.

---

### 7. Widget Session Persistence: Extend user_sessions Table

**Decision**: Widget sessions reuse the existing `user_sessions` table. A new `channel` enum value `'widget'` is added. A new nullable column `live_room_name` (text) tracks the active LiveKit room. Message history stored in the existing `messages` encrypted JSONB column.

**Rationale**: No new table minimizes schema migration risk. The existing `user_sessions` entity already covers all required fields (contactId, channel, messages, timestamps). The `live_room_name` column is ephemeral — set on room create, nulled on `room_finished` webhook.

**RLS**: Widget sessions are customer-owned — RLS policy: `contact_id IN (SELECT id FROM contacts WHERE auth_uid = auth.uid())`. Agents cannot read widget message content directly (they see only the contact record). This matches the principle: customer data stays in customer-scoped rows.

**Alternatives considered**:
- Separate `widget_sessions` table — redundant with `user_sessions`; would require duplicating the message schema and encryption logic.
- Browser localStorage only — no server persistence, loses history on page reload. Rejected per spec FR-013.
