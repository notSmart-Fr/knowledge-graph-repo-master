# Data Model: AI-Powered CRM Core

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Entity Relationship Diagram

```
Account ──1:N──► Contact ──1:N──► Deal
                    │                 │
                    │                 └──► PipelineStage
                    │
                    ├──1:N──► Call
                    │
                    └──1:N──► Ticket

Contact ──N:1──► Agent (auth.users)
```

## Entities

### Contact

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `name` | text | NOT NULL | |
| `phone` | text | encrypted, NOT NULL | AES-256-GCM, per-row HKDF key |
| `email` | text | encrypted | AES-256-GCM |
| `account_id` | UUID | FK → accounts.id | |
| `agent_id` | UUID | FK → auth.users.id | For RLS scoping |
| `role` | text | | e.g., "decision_maker", "influencer" |
| `tags` | jsonb | | Flexible categorization |
| `created_at` | timestamptz | DEFAULT now() | |

**RLS**: `agent_id = auth.uid()` for SELECT/INSERT/UPDATE. `viewer` role: SELECT only where assigned.

### Account

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `name` | text | NOT NULL | |
| `industry` | text | | |
| `size` | text | | e.g., "1-10", "11-50" |
| `health_score` | float | 0.0-1.0 | Computed from active deals + recent activity |
| `created_at` | timestamptz | DEFAULT now() | |

**RLS**: Authenticated users → SELECT only.

### Deal

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `name` | text | NOT NULL | |
| `amount` | numeric | | |
| `stage` | text | NOT NULL | Enum: `discovery`, `qualification`, `proposal`, `negotiation`, `closed_won`, `closed_lost` |
| `contact_id` | UUID | FK → contacts.id | |
| `account_id` | UUID | FK → accounts.id | |
| `probability` | float | 0.0-1.0 | Probability of closing |
| `expected_close` | date | | |
| `agent_id` | UUID | FK → auth.users.id | For RLS |
| `created_at` | timestamptz | DEFAULT now() | |

**RLS**: `agent_id = auth.uid()` for SELECT/INSERT/UPDATE.

**State transitions**:
```
discovery → qualification → proposal → negotiation → closed_won
                                                   → closed_lost
```

### PipelineStage

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `name` | text | NOT NULL | Matches Deal.stage values |
| `sort_order` | int | NOT NULL, UNIQUE | |
| `probability` | float | 0.0-1.0 | Default probability at this stage |

**RLS**: Authenticated users → SELECT only.

### Call

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `contact_id` | UUID | FK → contacts.id | |
| `agent_id` | UUID | FK → auth.users.id | For RLS |
| `direction` | text | NOT NULL | `inbound` or `outbound` |
| `transcript_json` | jsonb | encrypted | AES-256-GCM. Shape: `{ chunks: TranscriptChunk[] }` where each chunk is `{ speaker: 'customer' \| 'agent', text: string, timestamp_ms: number, sentiment: 'positive' \| 'neutral' \| 'negative' }`. Supports barge-in and per-turn sentiment markers. |
| `summary` | text | | Post-call AI summary |
| `sentiment` | text | | Call-level rollup `positive`, `neutral`, `negative` (computed from chunk sentiments; surfaced when chunks unavailable) |
| `action_items` | jsonb | | `[{ text, assignee, due }]` |
| `duration_sec` | int | | |
| `created_at` | timestamptz | DEFAULT now() | |

**Retention**: 90 days. Soft-delete after.

**Active state (derived, no schema field)**: A call is considered `active` when `transcript_json.chunks.length > 0 AND summary IS NULL`. Completed = `summary IS NOT NULL`. Dashboard uses this derived state to populate the active-calls panel.

**RLS**: `agent_id = auth.uid()` for SELECT/INSERT/UPDATE.

### Ticket

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `contact_id` | UUID | FK → contacts.id | |
| `agent_id` | UUID | FK → auth.users.id | For RLS |
| `subject` | text | NOT NULL | |
| `status` | text | NOT NULL | `open`, `in_progress`, `resolved`, `closed` |
| `priority` | text | NOT NULL | `low`, `medium`, `high`, `urgent` |
| `created_at` | timestamptz | DEFAULT now() | |

**RLS**: `agent_id = auth.uid()` for SELECT/INSERT/UPDATE.

### UserSession

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `user_id` | UUID | FK → contacts.id | |
| `platform_user_id` | text | | WhatsApp/voice user identifier |
| `channel` | text | NOT NULL | `whatsapp`, `voice` |
| `messages` | jsonb | encrypted | AES-256-GCM, full message history |
| `context` | jsonb | | Cached context for subsequent turns |
| `created_at` | timestamptz | DEFAULT now() | |
| `updated_at` | timestamptz | DEFAULT now() | |

**Retention**: 90 days after last activity.

### CacheEmbedding (pgvector)

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `embedding` | vector(768) | NOT NULL | Gemini text-embedding-004 |
| `prompt_hash` | text | NOT NULL, UNIQUE | Content-addressable dedup |
| `response` | jsonb | NOT NULL | Zod-validated response shape |
| `intent_tags` | jsonb | | Classification tags |
| `model` | text | | Model that generated response |
| `created_at` | timestamptz | DEFAULT now() | |
| `accessed_at` | timestamptz | DEFAULT now() | For LRU eviction |

**Index**: IVFFlat on `embedding` with `vector_cosine_ops`.
**Query**: `<=>` cosine distance, threshold 0.05.
**Eviction**: Soft-delete entries where `accessed_at` > 30 days ago.

### IdempotencyKey

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `key` | text | PRIMARY KEY | WhatsApp message ID |
| `created_at` | timestamptz | DEFAULT now() | TTL cleanup via pg_cron |

**RLS**: `service_role` only. Auto-expires after 300s.

### AuditLog

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, generated | |
| `actor_id` | UUID | NOT NULL | |
| `actor_role` | text | NOT NULL | `admin`, `agent`, `viewer`, `service_role` |
| `action` | text | NOT NULL | `create`, `read`, `update`, `delete` |
| `entity_type` | text | NOT NULL | `contact`, `deal`, `call`, `ticket`, `account` |
| `entity_id` | UUID | NOT NULL | |
| `timestamp` | timestamptz | DEFAULT now() | |
| `ip_address` | inet | | |

**RLS**: Admin → SELECT. Service_role → INSERT. No UPDATE/DELETE (immutable).
**Retention**: 90 days.

### HealthCheck

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `adapter_name` | text | NOT NULL | e.g., "supabase", "neo4j" |
| `status` | text | NOT NULL | `healthy`, `degraded`, `down` |
| `last_checked_at` | timestamptz | NOT NULL | |
| `latency_ms` | int | | |

## Knowledge Graph (Neo4j)

**Nodes**: `(:Contact)`, `(:Account)`, `(:Deal)`, `(:PipelineStage)`, `(:Call)`, `(:Ticket)`

**Edges**:
- `(:Contact)-[:WORKS_AT]->(:Account)`
- `(:Contact)-[:DECISION_MAKER_FOR]->(:Account)` (when contact.role = "decision_maker")
- `(:Deal)-[:BELONGS_TO]->(:Account)`
- `(:Deal)-[:CONTACT_IS]->(:Contact)`
- `(:Deal)-[:IN_STAGE]->(:PipelineStage)`
- `(:Call)-[:WITH]->(:Contact)`
- `(:Call)-[:ABOUT]->(:Deal)` (when call references deal)
- `(:Ticket)-[:RAISED_BY]->(:Contact)`

**Traversal**: `expandFromContact(contactId)` → 2-hop: Contact → Account → Deals (with PipelineStage) → Calls → Tickets.
