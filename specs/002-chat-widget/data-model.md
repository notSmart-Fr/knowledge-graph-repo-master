# Data Model: Customer Chat Widget + WhatsApp Audio Ingress

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Entity Relationship Diagram

```
Contact ──1:N──► UserSession (channel='widget')
                     │
                     ├── messages: EncryptedMessage[]  (JSONB, AES-256-GCM)
                     └── live_room_name: string | null  (new column)

Contact ──1:N──► Call  (voice sessions — existing, unchanged)

WhatsAppAudioJob ──► IDeadLetterQueue  (DLQ entry, no new table)
```

The diagram shows that `UserSession` is extended — not replaced — to cover widget sessions. No new top-level tables are introduced.

## Entities

### UserSession (Extended)

Existing table in Supabase: `user_sessions`. Two changes:
1. `channel` enum extended with `'widget'` value
2. New nullable column `live_room_name` added

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | Unchanged |
| `contact_id` | UUID | FK → contacts.id, NOT NULL | Unchanged |
| `channel` | text | NOT NULL, CHECK IN ('whatsapp', 'voice', 'widget') | **Extended** — `'widget'` added |
| `messages` | jsonb | encrypted | AES-256-GCM JSONB array of `EncryptedMessage` — unchanged |
| `live_room_name` | text | NULLABLE | **New column** — active LiveKit room name; NULL when not in live voice mode |
| `created_at` | timestamptz | DEFAULT now() | Unchanged |
| `last_active_at` | timestamptz | DEFAULT now() | Unchanged |

**RLS** (exact SQL policies — applied via Supabase dashboard or migration):
```sql
-- Widget sessions: customer owns their own session row
-- Applied as a new policy on the user_sessions table, non-conflicting with existing agent_id policy
CREATE POLICY "widget_sessions_customer_select"
  ON user_sessions FOR SELECT
  USING (
    channel = 'widget'
    AND contact_id IN (
      SELECT id FROM contacts WHERE agent_id = auth.uid()
    )
  );

-- Existing agent policy unchanged (covers whatsapp/voice channels):
-- CREATE POLICY "agent_sessions_select" ON user_sessions FOR SELECT
--   USING (channel != 'widget' AND agent_id = auth.uid());
```
Non-conflicting with existing policy: the `channel = 'widget'` and `channel != 'widget'` conditions are mutually exclusive. No row matches both policies simultaneously.

**State transitions for live_room_name**:
```
NULL → {roomName}     [on POST /widget/room success — AgentDispatch created]
{roomName} → NULL     [on LiveKit room_finished webhook]
```

**Atomicity / recovery** (CHK017): Room creation and session update are NOT in the same transaction (LiveKit is external). If `RoomServiceClient.createRoom()` succeeds but the `live_room_name` session update fails:
1. The orphaned LiveKit room is auto-cleaned by LiveKit when it becomes empty (default `empty_timeout = 5 minutes`).
2. The widget-server returns HTTP 500 to the client; the widget shows an error and does not attempt to join.
3. On the next `POST /widget/room` request, a new room name (new nanoid) is generated — no stale state conflict.
4. A startup reconciliation pass (on widget-server boot) checks for any `live_room_name` rows where the corresponding LiveKit room no longer exists and nulls them.

---

### EncryptedMessage (JSONB sub-schema, no dedicated table)

Stored as array elements within `user_sessions.messages`. No change to existing schema — the `channel` field inside each message differentiates the source.

| Field | Type | Notes |
|---|---|---|
| `role` | `'customer' \| 'assistant'` | Which side sent this turn |
| `content` | string | Plaintext before encryption. For voice turns, this is the transcript. |
| `input_mode` | `'text' \| 'clip' \| 'voice'` | **New field** — how the customer input arrived |
| `timestamp` | ISO 8601 string | Client send time |

The entire `messages` array is encrypted as a single JSONB blob per existing convention. `input_mode` is stored alongside `content` so the UI can render voice-clip turns with a mic icon.

---

### LiveKit Room (Transient — Not Persisted)

LiveKit manages its own room state. No Supabase table for rooms. The only server-side state is `user_sessions.live_room_name` (see above) — a foreign key by name into LiveKit's ephemeral room registry.

| Attribute | Source | Notes |
|---|---|---|
| `room_name` | generated: `widget-{contactId}-{nanoid(8)}` | Unique per session, prevents duplicate dispatch bug |
| `participant_token` | `AccessToken` (15 min TTL) | Minted server-side, returned to widget client |
| `agent_identity` | `"crm-voice-agent"` | Registered agent name in voice-agent worker |
| `metadata` | `JSON.stringify({ contactId, sessionId })` | Passed to agent via `createDispatch` |

---

### WhatsAppAudioJob (DLQ payload, no table)

When WhatsApp audio processing fails (STT error, TTS error, media upload error), a fallback job is enqueued via `IDeadLetterQueue`. This reuses the existing `BullMQDeadLetterQueue` — no new table.

| Field | Type | Notes |
|---|---|---|
| `type` | `'whatsapp_audio_fallback'` | Job type discriminator |
| `phone` | string | Encrypted before enqueue (PII policy) |
| `media_id` | string | WhatsApp media ID for retry |
| `error` | string | Sanitized error message (no PII) |
| `retries` | number | Current retry count (max 3) |
| `enqueued_at` | ISO 8601 | Enqueue timestamp |

On DLQ processing: send a plain text WhatsApp reply ("I received your voice message but had trouble processing it — please type your message").

---

## Validation Rules

### UserSession (widget channel)

- `contact_id` MUST resolve to an existing contact before session creation
- `channel = 'widget'` sessions MUST have `contact_id` sourced from a validated Supabase JWT `auth.uid` lookup
- `live_room_name` format: MUST match `^widget-[a-z0-9]+-[a-z0-9]{8}$` when non-null
- `messages` MUST be re-encrypted when `live_room_name` transitions to NULL (session finalize)

### Voice Clip Upload

- Max size: 10 MB (enforced in widget-server multipart parser)
- Accepted MIME types: `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/mp4`
- Duration: server-side guard — transcription WebSocket closed with error if > 5 minutes of audio

### WhatsApp Audio

- Max duration: 2 minutes (WhatsApp platform limit, no additional guard needed)
- Audio MIME: WhatsApp sends `audio/ogg; codecs=opus` — server decodes to PCM before Cartesia STT

---

## Schema Change Summary

| Change | Type | Target | Migration Required? |
|---|---|---|---|
| Add `channel = 'widget'` | Enum extension | `user_sessions.channel` CHECK constraint | Yes — `DROP CONSTRAINT` then `ADD CONSTRAINT` with all 3 values |
| Add `live_room_name` | New nullable column | `user_sessions` | Yes — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| Add `input_mode` field to `EncryptedMessage` | JSONB schema change | `user_sessions.messages` | No — JSONB is schema-less; old rows lack field, treated as `'text'` at application layer |

**Exact migration SQL**:
```sql
-- Step 1: Drop the old CHECK constraint (name may differ — check information_schema)
ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_channel_check;

-- Step 2: Re-add with all 3 values — existing 'whatsapp' and 'voice' rows are preserved
ALTER TABLE user_sessions
  ADD CONSTRAINT user_sessions_channel_check
  CHECK (channel IN ('whatsapp', 'voice', 'widget'));

-- Step 3: Add live_room_name column — idempotent (IF NOT EXISTS)
ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS live_room_name TEXT DEFAULT NULL;

-- Step 4: Optional — index widget sessions for the health reconciliation query
CREATE INDEX IF NOT EXISTS idx_user_sessions_widget
  ON user_sessions (contact_id)
  WHERE channel = 'widget';
```

**Migration safety**: Steps 1–3 are non-destructive. `DROP CONSTRAINT IF EXISTS` is safe even if constraint name differs — worst case: old constraint stays and Step 2 adds a second one (resolve manually). The `IF NOT EXISTS` guard on Step 3 makes the migration idempotent across restarts.

**Rollback plan**: If the migration fails mid-execution (e.g., Supabase free-tier disk quota):
- Steps 1–2 failure: `user_sessions` retains the old CHECK constraint; widget sessions will be rejected by the DB until re-run. No data loss.
- Step 3 failure: `live_room_name` column absent; widget-server falls back to in-memory room tracking (map of `contactId → roomName`) for the current process lifetime. No data loss.
- Rollback command: `ALTER TABLE user_sessions DROP COLUMN IF EXISTS live_room_name;` (Step 3 only; Steps 1–2 are safe to leave).
