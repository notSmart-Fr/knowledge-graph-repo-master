# Contracts: Customer Chat Widget + WhatsApp Audio Ingress

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md)

---

## 1. New Port Interface: ILiveKitRoomManager

Defined in `packages/ai-core/src/core/ports.ts`. Orchestrator and widget-server depend only on this interface — never on the adapter directly.

```typescript
interface LiveKitRoomDetails {
  roomName: string;
  participantToken: string; // JWT, 15-min TTL
  serverUrl: string;        // LiveKit WSS URL
}

interface AgentDispatchOptions {
  contactId: string;
  sessionId: string;
}

interface ILiveKitRoomManager {
  /** Create a room and dispatch the voice agent to it. Returns tokens for the customer participant. */
  createWidgetRoom(options: AgentDispatchOptions): Promise<LiveKitRoomDetails>;

  /** Close an active room, kicking all participants. */
  closeRoom(roomName: string): Promise<void>;

  /** Verify a LiveKit webhook payload signature. Throws if invalid. */
  verifyWebhook(body: string, authHeader: string): WebhookEvent;

  /** Health check for /ready endpoint — returns true if LiveKit Cloud is reachable. */
  healthCheck(): Promise<boolean>;
}
```

**Adapter**: `adapters/livekit/livekit-room.adapter.ts` — implements `ILiveKitRoomManager` using `livekit-server-sdk` (`RoomServiceClient`, `AgentDispatchClient`, `WebhookReceiver`).

**Circuit breaker**: `breaker.invoke(() => liveKitRoomManager.createWidgetRoom(options))` in widget-server. If open: return HTTP 503 with `degraded: true` and instruct client to use text mode.

---

## 2. Widget-Server HTTP API

Base URL: `http://localhost:8290` (configurable via `WIDGET_SERVER_PORT`)

All endpoints require `Authorization: Bearer <supabase-access-token>` header. Widget-server validates token via `supabase.auth.getUser(token)` on every request.

### POST /widget/chat

Send a text message and receive a streaming response.

**Request**:
```
POST /widget/chat
Content-Type: application/json
Authorization: Bearer <token>

{
  "sessionId": "uuid",
  "message": "string (1–4000 chars)"
}
```

**Response** (streaming):
```
HTTP 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: {"type":"token","content":"Hello"}
data: {"type":"token","content":", how"}
data: {"type":"token","content":" can I help?"}
data: {"type":"done","sessionId":"uuid"}
```

**Error** (non-streaming, before stream opens — exact JSON schemas):
```
HTTP 400 Bad Request
Content-Type: application/json
{ "error": "message too long", "maxChars": 4000 }

HTTP 401 Unauthorized
Content-Type: application/json
{ "error": "invalid token", "reason": "expired" | "malformed" | "missing" }

HTTP 503 Service Unavailable
Content-Type: application/json
{ "error": "service degraded", "degraded": true, "fallback": "text" }
```

---

### POST /widget/audio

Upload a voice clip for transcription and AI response.

**Request**:
```
POST /widget/audio
Content-Type: multipart/form-data
Authorization: Bearer <token>

--boundary
Content-Disposition: form-data; name="sessionId"
uuid

--boundary
Content-Disposition: form-data; name="audio"; filename="clip.webm"
Content-Type: audio/webm
<binary audio data>
```

**Constraints**: Max file size 10 MB. Accepted types: `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/mp4`.

**Response** (streaming — same SSE format as `/widget/chat`):
```
data: {"type":"transcript","content":"What is my order status?"}
data: {"type":"token","content":"Your order"}
data: {"type":"token","content":" is being processed."}
data: {"type":"done","sessionId":"uuid","turnIndex":3}
```

The `"done"` event carries `sessionId` (for client-side reconciliation) and `turnIndex` (0-based count of AI turns in this session, for message list key assignment).

**Error**:
```
HTTP 413 Payload Too Large
{ "error": "audio too large", "maxBytes": 10485760 }

HTTP 415 Unsupported Media Type
{ "error": "unsupported audio type", "accepted": ["audio/webm","audio/ogg","audio/mpeg","audio/mp4"] }
```

---

### POST /widget/room

Request a live voice room.

**Request**:
```
POST /widget/room
Content-Type: application/json
Authorization: Bearer <token>

{
  "sessionId": "uuid"
}
```

**Response**:
```
HTTP 200 OK
Content-Type: application/json

{
  "serverUrl": "wss://your-livekit-cloud.livekit.cloud",
  "participantToken": "<livekit-jwt>",
  "roomName": "widget-{contactId}-{nanoid}"
}
```

**Error**:
```
HTTP 503 Service Unavailable
{
  "error": "voice service unavailable",
  "degraded": true,
  "fallback": "clip"
}
```

---

### DELETE /widget/room/:roomName

End an active live voice session (customer hangs up).

**Request**:
```
DELETE /widget/room/widget-abc123-xy789012
Authorization: Bearer <token>
```

**Response**:
```
HTTP 204 No Content
```

---

### POST /livekit/webhook

Receives LiveKit server-side webhook events. Verified via HMAC signature (`LIVEKIT_WEBHOOK_SECRET`).

**LiveKit sends**:
```
POST /livekit/webhook
Authorization: <livekit-signature>
Content-Type: application/json

{
  "event": "room_started" | "room_finished" | "participant_joined" | "participant_left",
  "room": { "name": "widget-abc123-xy789012", "sid": "...", ... },
  "participant": { "identity": "...", "kind": 0 | 2, ... }  // kind=2 means AGENT
}
```

**Handled events**:
- `room_started` → arm 15s dispatch watchdog timer
- `participant_joined` (kind=AGENT) → cancel watchdog, update session status
- `participant_left` (kind=AGENT) → log voice agent left unexpectedly
- `room_finished` → null `live_room_name` in UserSession, cancel any watchdog

**Response**:
```
HTTP 200 OK   ← on valid signature + successful processing
HTTP 401 Unauthorized  ← on signature verification failure (IMPORTANT: do NOT return 200,
                          which would cause LiveKit to consider the webhook delivered and stop retrying
                          legitimate events; 401 causes LiveKit to log a delivery failure and move on)
HTTP 500 Internal Server Error  ← on unexpected handler error (LiveKit will retry up to 3 times)
```

---

## 3. Widget JavaScript Public API

Set on `window.crmWidget` by the IIFE bundle.

```typescript
interface CrmWidgetConfig {
  token: string;          // Supabase access token from host page auth session
  serverUrl?: string;     // Widget-server URL (default: same origin)
  theme?: 'light' | 'dark';  // Optional theme override
}

interface CrmWidgetAPI {
  /** Initialize the widget. Must be called before any other method. */
  init(config: CrmWidgetConfig): void;

  /** Open the widget UI. */
  open(): void;

  /** Close the widget UI (hides, does not destroy session). */
  close(): void;

  /** Destroy the widget, end any active session. */
  destroy(): void;
}

declare global {
  interface Window {
    crmWidget: CrmWidgetAPI & {
      /** Command queue — called before init(), replayed after init() */
      q?: Array<[keyof CrmWidgetAPI, ...unknown[]]>;
    };
  }
}
```

**`init()` idempotency**: If `init()` is called a second time with the same token, it is a no-op (widget is already initialized). If called with a different token (re-auth scenario), the widget tears down the current session, clears message history from the UI, and re-initializes with the new token. Any active LiveKit room is cleanly closed before re-init.

**Async loader pattern** (what host page inserts):
```html
<script>
  window.crmWidget = window.crmWidget || { q: [] };
  window.crmWidget.q.push(['init', { token: '<supabase-access-token>' }]);
</script>
<script src="/widget.js" async></script>
```

---

## 4. Cartesia STT WebSocket Contracts (Corrected)

### Live Voice: Auto Turn Detection

```
WebSocket: wss://api.cartesia.ai/stt/turns/websocket
  ?model=ink-2
  &encoding=pcm_s16le
  &sample_rate=16000
  &cartesia_version=2026-03-01
  &access_token=<short-lived-token>
```

**Recommended chunk size**: 4096 bytes per WebSocket binary frame (~128ms of audio at pcm_s16le 16kHz mono). Smaller chunks increase WebSocket overhead; larger chunks increase first-transcript latency for live voice. For async clips, 32KB chunks are acceptable (latency irrelevant for offline clips).

**Client → Server**: raw PCM binary audio frames

**Server → Client**:
```json
{ "type": "turn.start",    "timestamp": 1234 }
{ "type": "turn.update",   "transcript": "partial text", "timestamp": 1234 }
{ "type": "turn.eager_end","transcript": "full text",    "timestamp": 1234 }
{ "type": "turn.end",      "transcript": "final text",   "timestamp": 1234 }
```

### Async Clip / WhatsApp Audio: Manual Finalization

```
WebSocket: wss://api.cartesia.ai/stt/websocket
  ?model=ink-2
  &encoding=pcm_s16le
  &sample_rate=24000
  &cartesia_version=2026-03-01
  &access_token=<short-lived-token>
```

**Client → Server**:
1. Binary PCM frames (stream entire audio file as chunks)
2. Text message: `"finalize"` (signals end of audio)

**Server → Client**:
```json
{ "type": "transcript", "text": "full transcript of the clip", "isFinal": true }
```

---

## 5. WhatsApp Audio Message Webhook Extension

The existing WhatsApp webhook handler in `scripts/worker.ts` currently processes text messages. Extension adds handling for `message.type === 'audio'`.

**Incoming WhatsApp webhook (audio message)**:
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "+1234567890",
          "type": "audio",
          "audio": {
            "id": "media-id-from-meta",
            "mime_type": "audio/ogg; codecs=opus"
          }
        }]
      }
    }]
  }]
}
```

**WhatsApp audio reply (outgoing)**:
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+1234567890",
  "type": "audio",
  "audio": {
    "id": "uploaded-media-id"
  }
}
```

**Processing pipeline**:
1. Detect `message.type === 'audio'`
2. `GET /{media-id}` → media URL (URL is valid ~5 min — begin download immediately)
3. `GET {url}` (with auth) → OGG/Opus bytes
4. Decode OGG/Opus → PCM via ffmpeg subprocess
5. Cartesia STT manual WebSocket → transcript text
6. `orchestrator.process({ contactId, message: transcript, channel: 'whatsapp' })`
7. Cartesia TTS → audio bytes (MP3 or OGG, target ≤ 5 MB)
8. `POST /{phone}/media` → media-id
9. `POST /{phone}/messages` with audio payload

**TTS output size limit**: WhatsApp media upload limit is 16 MB for audio. Cartesia TTS at MP3 128kbps generates ~1 MB/min of audio. A 2-minute AI response would be ~2 MB — well within limit. If the AI response text is unusually long (> 5 minutes of speech), truncate the TTS to the first 5 minutes and append a text-only follow-up message with the remaining content.

**WhatsApp media URL race condition**: The media URL returned in step 2 is valid for ~5 minutes. The ffmpeg decode + Cartesia STT + orchestrator + TTS pipeline for a 2-minute clip may take 10–15 seconds total — well within the 5-minute window. If step 3 returns HTTP 404/403 (URL expired), enqueue to DLQ with `media_id` and retry from step 2 (new URL fetch). Max 1 retry.
