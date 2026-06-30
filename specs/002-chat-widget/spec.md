# Feature Specification: Customer Chat Widget + WhatsApp Audio Ingress

**Feature Branch**: `002-chat-widget`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Embeddable customer-facing chat widget with text input, async voice clip, and live WebRTC voice toggle (LiveKit). Customers authenticate via Supabase Auth before the widget appears. WhatsApp must also accept audio messages and reply with voice. All three widget input modes and the WhatsApp audio path converge at the existing AI orchestrator."

## Clarifications

### Session 2026-06-30

- Q: Who is the widget for and where does it live? → A: Customer-facing, embeddable as a single `<script>` tag on any host website (storefront, landing page). Shadow DOM prevents CSS leakage.
- Q: How does the widget identify a customer? → A: Full Supabase Auth JWT — the host site authenticates the customer first, then passes the access token to `window.crmWidget.init({ token })`. The widget server validates the JWT on every request and resolves it to a CRM contact ID (creates new contact on first visit).
- Q: What is the voice priority in the widget? → A: Equal — the user explicitly switches between text mode and voice mode via a toggle. Text mode (with an optional voice-clip mic button) is the default. Live voice call is a distinct mode the user activates.
- Q: For WhatsApp audio messages, what format is the reply? → A: Mirror the input — voice message in → voice reply out (Cartesia TTS → audio file sent back via WhatsApp). Text message in → text reply out (existing behavior unchanged).
- Q: Does widget conversation history persist across browser sessions? → A: Ephemeral per page load — each widget open starts a fresh session. Prior session history is stored in the CRM backend for operator review but is NOT loaded into the widget UI on subsequent customer visits.
- Q: Should widget-server endpoints be rate-limited? → A: Per-JWT (per contactId) rate limiting — 30 req/min on `/widget/chat`, 10 req/min on `/widget/clip` and `/widget/room-token`. In-memory sliding window is sufficient at free-tier scale.
- Q: What does the widget display before the customer sends their first message? → A: Static placeholder text in the input box, empty message list. No AI greeting, no orchestrator call on open.
- Q: What accessibility level is required for the widget UI? → A: Keyboard navigation (Tab/Enter/Escape) + ARIA roles on interactive elements. Full WCAG 2.1 AA compliance is not required for this release.
- Q: What happens when Cartesia TTS output for a WhatsApp audio reply would exceed WhatsApp's 16 MB media upload limit? → A: Truncate the AI text response to a maximum of 1000 words before passing to Cartesia TTS, preventing oversized audio at source.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Customer Chats via Text on the Storefront Widget (Priority: P1)

A logged-in customer on the company storefront sees the chat widget and types a question about their order or account. The widget sends the message, streams a response token-by-token, and the customer sees the first word appear within 500ms. The full response references their contact name and relevant CRM context.

**Why this priority**: Text chat is the simplest, most accessible input mode and the foundation everything else builds on. It must work independently of voice infrastructure.

**Independent Test**: Embed the widget on a test page with a seeded Supabase Auth user mapped to a known contact. Type "What's the status of my deal?" and verify the response streams back within 500ms (first token) and references the correct deal stage.

**Acceptance Scenarios**:

1. **Given** a logged-in customer opens the widget and types a question, **When** they submit the message, **Then** the first response token appears within 500ms and the full response references the customer's name and their current deal stage within 3 seconds.

2. **Given** the AI provider is in degraded mode (cache hit), **When** a customer submits a text message, **Then** the response streams from the semantic cache and is marked internally as a cached response. The customer sees no visible difference.

3. **Given** a customer submits a message with a personal phone number embedded in the text, **When** the AI response is generated, **Then** the phone number is stripped from the response before it reaches the customer. The response is otherwise complete.

---

### User Story 2 — Customer Sends a Voice Clip on the Widget (Priority: P2)

A logged-in customer on the storefront holds the mic button, records a short question ("When does my contract renew?"), releases the button, and receives a text response. No real-time connection is required — this is asynchronous, like leaving a voice note.

**Why this priority**: Voice clip is a lower-friction entry point than live voice for customers who prefer speaking but don't need a full call. It uses the same transcription infrastructure as the live voice mode without WebRTC overhead.

**Independent Test**: Embed the widget on a test page. Hold the mic button, speak a 5-second test sentence, release. Verify the recording is uploaded, transcribed, and a text response appears within 5 seconds.

**Acceptance Scenarios**:

1. **Given** a customer holds the mic button and records a voice clip under 60 seconds, **When** they release the button, **Then** the clip is uploaded, transcribed via Cartesia, and a full text response appears within 5 seconds for clips under 30 seconds.

2. **Given** a customer attempts to record a clip longer than 60 seconds, **When** the 60-second limit is reached, **Then** recording stops automatically, the clip up to that point is sent, and a notice is shown: "Voice clips are limited to 60 seconds."

3. **Given** the transcription service is unavailable, **When** a customer submits a voice clip, **Then** the widget shows a non-blocking error: "Voice transcription is temporarily unavailable. Please type your message instead." Text mode remains fully functional.

---

### User Story 3 — Customer Starts a Live Voice Call via the Widget (Priority: P1)

A logged-in customer clicks the live voice toggle on the widget. A WebRTC connection is established and the customer hears an AI voice greet them. They speak a question, the AI transcribes it in real-time, generates a response, and speaks it back — all within 1.5 seconds of the customer finishing speaking. The customer can interrupt the AI mid-response (barge-in).

**Why this priority**: Live voice is the highest-engagement mode. It uses the same call lifecycle infrastructure as the existing phone channel (Cartesia STT + TTS + orchestrator), proving the architecture works for a new transport.

**Independent Test**: Open the widget on a test page with a seeded contact. Toggle live voice, speak "Tell me about my open deals", and verify the spoken response references correct deal data within 1.5 seconds (STT finalization to first TTS audio byte).

**Acceptance Scenarios**:

1. **Given** a customer activates live voice mode, **When** the WebRTC room is ready (within 3 seconds of toggle), **Then** the customer hears an AI greeting, can speak freely, and receives spoken responses within 1.5 seconds of finishing each utterance.

2. **Given** the customer interrupts the AI while it is speaking (barge-in), **When** the customer begins speaking, **Then** the current AI audio is immediately discarded, the customer's new speech is transcribed, and the pipeline restarts with the latest input. The interrupted audio is not replayed.

3. **Given** the live voice connection drops mid-call, **When** reconnection is not possible within 5 seconds, **Then** the widget automatically falls back to text mode, shows "Voice connection lost — switching to text chat", and the conversation history is preserved.

4. **Given** a customer is in live voice mode and the primary AI provider fails, **When** the orchestrator detects the failure, **Then** the fallback chain activates silently. The customer hears a slightly delayed but complete spoken response. No error audio is played.

---

### User Story 4 — Customer Sends a WhatsApp Voice Message (Priority: P1)

A customer records and sends a voice note on WhatsApp. The system receives the audio file, transcribes it, processes the text through the same AI orchestrator, converts the response to audio, and sends a voice reply back to the customer on WhatsApp — mirroring the customer's chosen input format.

**Why this priority**: WhatsApp voice messages are widely used, especially on mobile. Ignoring them forces the customer to retype what they said. Mirror-reply keeps the channel experience native.

**Independent Test**: Send a WhatsApp voice note ("What's my account status?") from a seeded contact's number. Verify a voice audio reply arrives within 10 seconds containing information about the contact's account.

**Acceptance Scenarios**:

1. **Given** a WhatsApp contact sends a voice message under 5 minutes in length, **When** the message is received, **Then** the audio is downloaded, transcribed via Cartesia, processed through the orchestrator, and a voice reply (Cartesia TTS → audio file) is sent back within 10 seconds.

2. **Given** the Cartesia transcription service is unavailable during a WhatsApp audio message, **When** transcription fails after the timeout, **Then** the system replies with a text message: "I received your voice message but couldn't process audio right now. Could you type your question?" The original audio message is logged to the dead-letter queue for potential replay.

3. **Given** a WhatsApp contact sends both voice and text messages in the same session, **When** each message is received, **Then** each is replied to in kind — voice in → voice out, text in → text out. The underlying orchestrator pipeline is the same for both.

---

### User Story 5 — Widget Degrades Gracefully When Services Are Down (Priority: P2)

A customer opens the widget when the LiveKit voice infrastructure is unavailable. Text mode works perfectly. Voice clip and live voice modes show non-blocking notices and offer text as a fallback. The widget never shows a blank screen or unresponsive spinner.

**Why this priority**: The widget is customer-facing. A broken widget on a storefront damages trust more than a degraded internal dashboard. Text must always work.

**Independent Test**: Simulate LiveKit unavailability. Open the widget. Verify text mode works, the live voice toggle shows a "Voice unavailable" notice, and the UI remains interactive.

**Acceptance Scenarios**:

1. **Given** the LiveKit service is unreachable, **When** a customer opens the widget, **Then** text mode initializes normally. The voice toggle shows a dimmed "Voice temporarily unavailable" state. The mic clip button shows the same notice. No spinner, no blocking error.

2. **Given** the widget loses its JWT (session expires), **When** the customer submits a message, **Then** the widget shows "Session expired — please refresh to continue" and stops sending requests. It does not retry with an invalid token.

---

### Edge Cases

- What happens when two simultaneous live voice rooms are requested by the same customer session? The second request returns an error: the customer already has an active voice room. One room per authenticated session at a time.
- What happens when a WhatsApp audio file exceeds the 16 MB platform limit? Meta's API rejects the file before the webhook fires; nothing reaches the worker. No action needed.
- What happens when the Cartesia TTS *reply* audio for a WhatsApp voice response would exceed WhatsApp's 16 MB outgoing media upload limit? The AI text response is truncated to a maximum of 1000 words before being passed to Cartesia TTS. This bounds the audio output to well under 16 MB at standard speech rates and bit rates.
- What happens when a WhatsApp voice clip is longer than 5 minutes? The worker attempts transcription; Cartesia's batch API applies its own duration limits. On transcription failure the system falls back to the text-reply degradation path.
- What happens when a new customer visits the widget (no prior CRM contact)? The widget server creates a new CRM contact from the Supabase Auth profile (email, display name) on first message. The session proceeds normally. The new contact appears in the CRM.
- What happens when the widget is embedded on a page with a Content Security Policy that blocks WebSocket connections? Text mode and voice clip (HTTP upload) continue to work. Live voice (WebRTC via LiveKit) fails silently and is marked unavailable. The widget detects this on room-join attempt and degrades without crashing.
- What happens when a customer exceeds the rate limit? The widget-server returns HTTP 429 with a `retryAfterMs` field. The widget shows a non-blocking notice: "You're sending messages too quickly — please wait a moment." and re-enables input after the indicated delay.
- What happens when the customer closes the browser tab mid-call? LiveKit detects participant departure, the room empties, the voice-agent exits the room cleanly, and the call is finalized (summary generated). No dangling rooms.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an embeddable JavaScript bundle that customers load via a single `<script>` tag. The widget MUST render inside a shadow DOM to prevent host-page style interference.
- **FR-002**: The widget MUST authenticate customers by accepting a Supabase Auth JWT token via `window.crmWidget.init({ token })`. Every widget-server request MUST carry this JWT in the `Authorization: Bearer` header and be validated server-side.
- **FR-003**: On the customer's first message, the widget-server MUST resolve the JWT to an existing CRM contact or create a new contact from the Supabase Auth profile (name, email). Subsequent messages in the same session MUST reuse the resolved contact ID without repeated lookup.
- **FR-004**: The widget MUST support text input. Text messages MUST be sent to the widget-server and streamed back as a server-sent event response (SSE), with the first token arriving within 500ms under normal conditions.
- **FR-005**: The widget MUST support an optional mic button for async voice clip input. Clicking and holding the button MUST record audio from the microphone (up to 60 seconds). On release, the clip MUST be uploaded to the widget-server, transcribed via Cartesia, and the transcribed text MUST be routed through the orchestrator. The response MUST be returned as a text SSE stream.
- **FR-006**: The widget MUST support a live voice toggle that activates a real-time WebRTC voice call. Activating the toggle MUST request a LiveKit room token from the widget-server and join the resulting room using the LiveKit browser client.
- **FR-007**: When a new LiveKit room is created for a widget session, the widget-server MUST receive a `room_started` dispatch webhook from LiveKit and signal the voice-agent process to join the room as the AI participant.
- **FR-008**: During a live voice session, the voice-agent MUST stream customer audio through Cartesia STT, pass the transcribed text through the orchestrator, convert the response to audio via Cartesia TTS, and publish the audio track back to the LiveKit room — within 1.5 seconds of STT finalization.
- **FR-009**: The widget MUST support barge-in during live voice mode: when the customer speaks while the AI audio is playing, the current TTS audio MUST be immediately discarded and the pipeline MUST restart with the new customer speech.
- **FR-010**: The WhatsApp worker MUST handle incoming messages where `message.type === 'audio'`. On receiving an audio message, the system MUST download the audio file from Meta's media API, transcribe it via Cartesia, route the text through the orchestrator, and reply with a Cartesia TTS-generated audio file sent via WhatsApp. Before passing the orchestrator response to Cartesia TTS, the text MUST be truncated to a maximum of 1000 words to prevent the resulting audio from exceeding WhatsApp's 16 MB outgoing media upload limit.
- **FR-011**: The system MUST route failed WhatsApp audio transcription or reply attempts to the dead-letter queue with full failure context.
- **FR-012**: The widget MUST degrade mode-by-mode: if LiveKit is unavailable, live voice mode MUST be disabled with a non-blocking notice; if Cartesia is unavailable, voice clip mode MUST be disabled with a non-blocking notice; text mode MUST always remain functional.
- **FR-013**: All customer audio uploads (voice clips) and session message histories MUST be encrypted at rest per constitution Principle III. Audio files MUST NOT be persisted beyond the duration of the transcription request.
- **FR-014**: The widget-server MUST expose a `GET /widget/room-token` endpoint that creates a LiveKit room and returns `{ roomName, token }` to the authenticated browser. One active room per session is enforced.
- **FR-015**: The widget-server MUST expose a `POST /livekit/webhook` endpoint to receive LiveKit dispatch events and trigger voice-agent room joins.
- **FR-016**: The widget-server MUST enforce per-JWT (per `contactId`) rate limits: 30 requests/minute on `POST /widget/chat`, 10 requests/minute on `POST /widget/clip` and `GET /widget/room-token`. Requests exceeding the limit MUST return `HTTP 429` with body `{ error: 'rate_limit_exceeded', retryAfterMs: <number> }`. The rate limit state MAY be held in-process (sliding window).
- **FR-017**: On initial open, the widget MUST display an empty message list with a static placeholder text in the input box (e.g., "Ask me anything about your account…"). No AI call or orchestrator request is made until the customer sends their first message.
- **FR-018**: The widget UI MUST support keyboard navigation: Tab to focus interactive elements (input box, send button, mic button, voice toggle, close button), Enter to submit a message or activate a focused button, and Escape to close the widget. All interactive elements MUST have ARIA roles and labels sufficient for screen-reader identification. Full WCAG 2.1 AA compliance is out of scope for this release.

### Key Entities

- **WidgetSession**: Active customer session on the chat widget. Key attributes: `contactId` (FK → contacts), `channel: 'widget'`, `messages` (encrypted JSONB turn history), `liveRoomName` (nullable, active LiveKit room name), `createdAt`, `lastActiveAt`. Extends the existing `UserSession` model. Sessions are ephemeral from the customer's perspective — each page load starts a fresh conversation. The `messages` history is persisted in the CRM backend for operator review only; it is NOT surfaced to the customer on subsequent visits.
- **LiveKitRoom** (transient, not persisted): Runtime allocation tracking a widget voice call room. Key attributes: `roomName`, `contactId`, `sessionId`, `createdAt`. Exists only for the duration of the call; cleaned up on room-empty webhook.
- **WhatsAppAudioJob** (DLQ entry): Failed WhatsApp audio-message processing job. Key attributes: `from` (phone), `mediaId`, `errorCode`, `attemptCount`, `lastAttemptedAt`. Enqueued to DLQ on transcription or reply failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Widget text chat delivers the first streamed response token within 500ms for 95% of messages under normal infrastructure conditions.
- **SC-002**: Widget voice clip upload + transcription + full text response completes within 5 seconds for clips up to 30 seconds in length, measured end-to-end from button release to last SSE token.
- **SC-003**: Widget live voice achieves under 1.5 seconds from customer STT finalization to first TTS audio byte in the browser for 95% of turns — identical SLA to the existing voice channel.
- **SC-004**: WhatsApp audio messages are fully replied to (voice reply delivered) within 10 seconds of webhook receipt for clips under 2 minutes in length.
- **SC-005**: The widget JavaScript bundle is interactive within 2 seconds of the `<script>` tag load on a standard 4G connection (≤ 100 KB gzipped bundle size target).
- **SC-006**: Text mode remains fully functional with zero error states when LiveKit and Cartesia are simultaneously unavailable.
- **SC-007**: A customer's first message (new contact auto-create path) receives a response within 3 seconds — within the same latency window as a returning contact.
- **SC-008**: No customer PII (name, email, audio content) appears in widget-server logs, OTel span attributes, or error objects.
- **SC-009**: All interactive widget elements are reachable and operable via keyboard alone (Tab, Enter, Escape). All interactive elements carry ARIA roles and labels.

## Assumptions

- The host website completes Supabase Auth login before calling `window.crmWidget.init()`. The widget does not implement its own login UI.
- Widget voice rooms are short-lived; LiveKit automatically removes rooms when all participants leave. No manual room cleanup is needed under normal conditions.
- WhatsApp audio files delivered via webhook are under 16 MB and under 5 minutes (Meta platform limits). Files outside these limits are rejected at the platform boundary before reaching the worker.
- Voice clip recordings use the browser's built-in MediaRecorder API in `.webm` or `.ogg` format — no third-party recording library is required.
- The Cartesia API supports batch (REST) audio transcription in addition to streaming WebSocket transcription. Batch is used for voice clips and WhatsApp audio; streaming is used for live voice calls.
- One active LiveKit voice room per widget session is a hard constraint. Concurrent multi-room scenarios are out of scope.
- The widget bundle is served from a CDN (static file). The widget-server is a separate backend process on a configurable port (default 8290).
- The voice-agent process is always running alongside the widget-server. Room join signals pass between them via a lightweight in-process IPC mechanism (the two processes share the same deployment unit in the free-tier setup).
- WhatsApp voice reply audio is encoded as MP3 before upload to Meta's media API. Cartesia TTS output is MP3-compatible.
- The `UserSession` entity in the existing data model is extended with `channel: 'widget'` to track widget sessions — no new table required.
- Widget sessions are ephemeral from the customer's perspective. The widget does not implement a history-load endpoint or resume UX. Each `window.crmWidget.init()` call begins a new session with an empty message list.
- The widget displays a static placeholder in the input box on open. No AI greeting or welcome message is generated. The first orchestrator call occurs only when the customer submits their first message.
