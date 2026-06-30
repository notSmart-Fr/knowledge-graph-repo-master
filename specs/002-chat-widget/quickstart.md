# Quickstart & Validation Guide: Customer Chat Widget + WhatsApp Audio Ingress

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/interfaces.md](./contracts/interfaces.md)

---

## Prerequisites

All prerequisites from [spec 001 quickstart](../001-ai-crm-core/quickstart.md) must pass first.

### Additional Environment Variables

Add to your `.env.local`:
```bash
# LiveKit (required for voice widget)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxx
LIVEKIT_API_SECRET=your-secret
LIVEKIT_WEBHOOK_SECRET=your-webhook-secret  # Set in LiveKit Cloud console

# Widget server
WIDGET_SERVER_PORT=8290  # Optional, default 8290

# Cartesia STT (same key as TTS — Ink-2 model)
CARTESIA_API_KEY=sk-...   # Already present from spec 001
```

### LiveKit Webhook Setup

In [LiveKit Cloud Console](https://cloud.livekit.io) → Your Project → Webhooks:
1. Add webhook URL: `https://your-deployment.example.com/livekit/webhook`
2. Select events: `room_started`, `room_finished`, `participant_joined`, `participant_left`
3. Copy the webhook secret → set `LIVEKIT_WEBHOOK_SECRET`

For local development, use [LiveKit CLI](https://docs.livekit.io/home/cli/) to tunnel webhooks:
```powershell
lk dev webhook --url http://localhost:8290/livekit/webhook
```

---

## Start Services

```powershell
# Terminal 1: Core worker (WhatsApp + existing orchestrator)
pnpm --filter @dtc/ai-core exec tsx scripts/worker.ts

# Terminal 2: Voice agent (must run for live voice widget mode)
pnpm --filter @dtc/ai-core exec tsx scripts/voice-agent.ts

# Terminal 3: Widget HTTP server
pnpm --filter @dtc/ai-core exec tsx scripts/widget-server.ts

# Terminal 4: Widget UI (dev mode, hot-reload)
pnpm --filter @dtc/widget dev

# OR: Build widget and serve statically
pnpm --filter @dtc/widget build
# Widget bundle at apps/widget/dist/widget.js
```

---

## Validation Scenarios

### Scenario 1: Widget Text Chat (SC-001 — P95 first token < 500ms)

```powershell
# Get a Supabase access token (via the web app or Supabase CLI)
$TOKEN = (supabase auth token)

# Send a text message to the widget server
$BODY = '{"sessionId":"test-session-001","message":"Hello, what are my recent deals?"}'
Invoke-WebRequest `
  -Uri "http://localhost:8290/widget/chat" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $TOKEN"; "Content-Type" = "application/json" } `
  -Body $BODY

# Expected: HTTP 200 text/event-stream
# data: {"type":"token","content":"Here are"}
# data: {"type":"token","content":" your recent deals:"}
# ...
# data: {"type":"done","sessionId":"test-session-001"}
```

**Pass criteria**: First `data:` line arrives within 500ms of request.

---

### Scenario 2: Voice Clip Upload (SC-002 — P95 < 5s for ≤ 30s clip)

```powershell
# Record a 10-second clip (or use a pre-recorded test file)
# Test file: specs/002-chat-widget/fixtures/test-clip.webm (create as part of implementation)

$TOKEN = (supabase auth token)
curl.exe `
  -X POST http://localhost:8290/widget/audio `
  -H "Authorization: Bearer $TOKEN" `
  -F "sessionId=test-session-002" `
  -F "audio=@specs/002-chat-widget/fixtures/test-clip.webm;type=audio/webm"

# Expected: HTTP 200 text/event-stream
# data: {"type":"transcript","content":"What is my account status?"}
# data: {"type":"token","content":"Your account is in good standing."}
# ...
# data: {"type":"done","sessionId":"test-session-002"}
```

**Pass criteria**: Transcript appears before first AI token. Full response arrives < 5s.

---

### Scenario 3: Live Voice Room Creation

```powershell
$TOKEN = (supabase auth token)
$BODY = '{"sessionId":"test-session-003"}'
Invoke-WebRequest `
  -Uri "http://localhost:8290/widget/room" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $TOKEN"; "Content-Type" = "application/json" } `
  -Body $BODY

# Expected:
# {
#   "serverUrl": "wss://your-project.livekit.cloud",
#   "participantToken": "eyJ...",
#   "roomName": "widget-abc123-xy789012"
# }
```

Then use the LiveKit CLI or livekit-client to join the room and verify the voice agent (identity `crm-voice-agent`) joins within 15 seconds.

```powershell
lk room join --url $env:LIVEKIT_URL --token <participantToken>
# Watch participant list — crm-voice-agent should appear
```

**Pass criteria**: Room created, token returned, `crm-voice-agent` joins within 15s.

---

### Scenario 4: Widget Embed (Browser Test)

Create a minimal host HTML file:

```html
<!DOCTYPE html>
<html>
<body>
  <script>
    // Simulate host page with a Supabase token
    window.crmWidget = { q: [] };
    window.crmWidget.q.push(['init', {
      token: 'YOUR_SUPABASE_ACCESS_TOKEN',
      serverUrl: 'http://localhost:8290'
    }]);
  </script>
  <script src="http://localhost:5180/widget.js" async></script>
</body>
</html>
```

Open in browser (any localhost port). Verify:
1. Widget button appears in bottom-right corner
2. No CSS leak to host page (DevTools → inspect shadow root)
3. Text message sends and receives a streaming reply
4. Mic button records and uploads a clip
5. Voice toggle button creates a LiveKit room (requires voice-agent running)

**Pass criteria**: All four widget interactions complete without console errors. `document.querySelector('crm-widget').shadowRoot` is non-null and styled.

---

### Scenario 5: WhatsApp Audio Reply

Simulate an incoming WhatsApp audio webhook:

```powershell
$PAYLOAD = @'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "+1234567890",
          "type": "audio",
          "audio": {
            "id": "test-media-id-12345",
            "mime_type": "audio/ogg; codecs=opus"
          }
        }]
      }
    }]
  }]
}
'@

# Send to WhatsApp webhook handler (worker.ts)
Invoke-WebRequest `
  -Uri "http://localhost:8280/webhook/whatsapp" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json"; "X-Hub-Signature-256" = "sha256=..." } `
  -Body $PAYLOAD
```

**Pass criteria**: Worker logs show `[audio] downloaded → transcribed → orchestrated → tts → sent`. WhatsApp API mock (or real WhatsApp sandbox) receives an audio message reply.

For full end-to-end test, use Meta's [WhatsApp Business API sandbox](https://developers.facebook.com/docs/whatsapp/sandbox).

---

### Scenario 6: Degradation — Voice Unavailable

Stop the voice-agent process. Send `POST /widget/room`.

**Expected**:
```json
HTTP 503 Service Unavailable
{
  "error": "voice service unavailable",
  "degraded": true,
  "fallback": "clip"
}
```

Widget should automatically switch to clip mode and display: "Live voice is temporarily unavailable. Use the voice clip button instead."

**Pass criteria**: HTTP 503 returned. Widget UI degrades gracefully without crash.

---

## Post-Validation Checks

```powershell
# 1. AST Firewall — 0 violations
pnpm check

# 2. Unit tests — 0 failures
pnpm test

# 3. Health check — widget-server listed as healthy
Invoke-WebRequest -Uri "http://localhost:8280/ready" | ConvertFrom-Json

# Expected: { status: "ok", adapters: { ..., livekit: "healthy", widget: "healthy" } }
```
