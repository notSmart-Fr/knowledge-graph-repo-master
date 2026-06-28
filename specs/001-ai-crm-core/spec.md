# Feature Specification: AI-Powered CRM Core

**Feature Branch**: `001-ai-crm-core`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "Production-grade AI CRM with hybrid hexagonal architecture — converged WhatsApp, voice, and web dashboard through an AI orchestrator with graceful degradation, PII security, and free-tier budget awareness."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sales Agent Handles Customer via WhatsApp (Priority: P1)

A sales agent receives a WhatsApp message from an existing customer. The system looks up the customer's contact, retrieves their deals and account context from the knowledge graph, generates a context-aware AI response, and delivers it back via WhatsApp — all within 2 seconds so the customer doesn't wait.

**Why this priority**: WhatsApp is the primary customer communication channel. This is the core product loop — everything else (voice, dashboard, analytics) builds on this flow. Without this, there is no product.

**Independent Test**: Send a WhatsApp message from a known contact's phone number to the system. Verify the AI response references the correct contact name, deal status, and account health. Can be tested end-to-end with seed CRM data loaded.

**Acceptance Scenarios**:

1. **Given** a known contact sends "What's the status of my deal?", **When** the WhatsApp message is delivered, **Then** the system responds within 2 seconds with the deal's current pipeline stage and expected close date, referencing the contact by name.

2. **Given** the same WhatsApp message is redelivered by the messaging platform (duplicate), **When** the message arrives with the same identifier within 5 minutes, **Then** the system acknowledges receipt but does NOT process or respond a second time.

3. **Given** a WhatsApp message from an unknown phone number, **When** the message arrives, **Then** the system creates a new contact, responds with a helpful greeting, and logs the new contact creation in the audit trail.

---

### User Story 2 - Sales Agent Takes a Voice Call (Priority: P1)

A customer calls in via voice. The system transcribes their speech in real-time, passes the text through the same AI orchestrator, converts the AI response to speech, and delivers it back through the voice channel — all with less than 1.5 seconds of perceived pause.

**Why this priority**: Voice is the second major channel. It uses the same orchestrator pipeline as WhatsApp, proving the architecture works across transport layers. Delays over 1.5 seconds create unnatural conversation pauses that degrade trust.

**Independent Test**: Connect a voice call session, speak a test sentence ("What are my open deals?"), and verify the spoken response references correct deal data. Can be tested with seed CRM data loaded.

**Acceptance Scenarios**:

1. **Given** an active voice call, **When** the customer says "Tell me about my account health," **Then** the system transcribes the speech, retrieves the account health score from the knowledge graph, and speaks back a concise summary within 1.5 seconds.

2. **Given** the primary AI provider returns an error during a voice call, **When** the orchestrator detects the failure, **Then** it falls back to a secondary AI provider within the same call, and the response carries degraded metadata internally. The customer hears a normal response — no error message.

---

### User Story 3 - Operator Monitors System Health via Dashboard (Priority: P2)

An operations team member opens the web dashboard to monitor live system health: which services are healthy or degraded, cache effectiveness, active calls, and any backlog of failed background tasks. The dashboard shows all panels without blocking each other, even when one data source is down.

**Why this priority**: Without visibility, the system is a black box. Operators need to know when a service is degraded or background tasks are backing up before customers notice.

**Independent Test**: Open the dashboard in a browser. Artificially cause the knowledge graph service to fail 3 consecutive times. Verify the health status card shows it as "degraded" within 30 seconds, while the transcript panel continues working unaffected.

**Acceptance Scenarios**:

1. **Given** all services are healthy, **When** an operator opens the dashboard, **Then** all panels render within 3 seconds. The health status cards show all services as operational. The cache effectiveness card shows hit rate above 30%.

2. **Given** the knowledge graph service is unreachable, **When** the dashboard loads, **Then** the graph status card shows a dimmed "degraded" state. The transcript stream and contact context panels continue working from the primary database alone. No spinner, no modal, no error popup.

3. **Given** an active voice call, **When** the dashboard is open, **Then** the transcript stream pane shows live scrolling text with speaker labels (customer vs. agent) and sentiment markers updating in real-time.

---

### User Story 4 - System Survives Partial Infrastructure Failure (Priority: P2)

Multiple external services become unavailable simultaneously (e.g., knowledge graph and primary AI provider). The system continues processing requests using fallback adapters and cached responses. No request is dropped. Operators are alerted via monitoring.

**Why this priority**: Cloud services have unpredictable outages. The system must degrade gracefully rather than fail hard — a degraded response is always better than no response.

**Independent Test**: Run the system with the knowledge graph service connection refused and the primary AI provider key invalid. Send a WhatsApp message. Verify the response uses primary database contact data plus cached context (if available) or a simplified fallback. Internal response metadata shows degraded status.

**Acceptance Scenarios**:

1. **Given** the knowledge graph service is unreachable (3+ consecutive failures), **When** a WhatsApp message arrives, **Then** the orchestrator skips graph expansion and responds using only the primary database contact lookup plus semantic cache. The response is useful but simpler. No error is shown to the customer.

2. **Given** both primary and secondary AI providers are unreachable, **When** a voice call is active, **Then** the system returns a cached response (if available) with degraded metadata. If no cache hit, it responds with a polite fallback message.

3. **Given** the duplicate-detection service is down, **When** a WhatsApp message arrives, **Then** the system falls back to database-based duplicate detection. If both fail, it processes the message anyway (at-least-once delivery over at-most-once for availability).

---

### User Story 5 - Admin Ensures Data Security & Compliance (Priority: P3)

An admin reviews audit logs, verifies sensitive data encryption is active, and can retrieve or delete customer data upon request. All sensitive fields (phone, email, transcripts) are unreadable in the database without the decryption key.

**Why this priority**: Security and compliance are critical for trust but don't block the core product loop. Encryption is structural (present day one), while data subject access requests and erasure are planned features.

**Independent Test**: Query the database directly. Verify phone and email columns contain only encrypted ciphertext. Query audit logs and verify they contain an immutable record of all data access.

**Acceptance Scenarios**:

1. **Given** a database breach where an attacker gains direct database access, **When** they query sensitive contact fields, **Then** all returned values are encrypted ciphertext, unreadable without the decryption key from the runtime environment.

2. **Given** an admin queries audit logs, **When** they filter by actor and date range, **Then** they see every CRM data access event with actor ID, role, action, entity type, timestamp, and IP address. No modification or deletion of audit records is possible.

3. **Given** the encryption key is rotated in the environment, **When** an encrypted field is next read, **Then** the system detects the old key, decrypts with it, re-encrypts with the new key, and writes back. This rotation is transparent — no downtime, no data loss.

---

### Edge Cases

- What happens when a WhatsApp message contains sensitive personal data (phone numbers, emails) in the body? The output filter strips sensitive patterns from AI responses before delivery.
- What happens when the semantic cache is cold (no prior similar queries)? The system falls through to live AI generation — no cache hit, some added latency.
- What happens when a voice call transcript exceeds the storage budget? Transcripts are compressed and retained for 90 days, then deleted. Older transcripts return empty.
- What happens when the background task failure queue exceeds 50 jobs per queue? A monitoring alert is triggered and the dashboard queue depth indicator turns red. Operator replays or purges.
- What happens when the encryption key is missing at startup? The startup validator stops the process with a fatal error — the system never enters a partially-running state.
- What happens when a customer interrupts the AI while TTS is playing (voice call barge-in)? The system discards the in-progress TTS, re-transcribes the customer's latest speech, and restarts the orchestrator pipeline with the most recent session context. The partial TTS is not delivered.
- What happens when ALL data sources (primary database and knowledge graph) are simultaneously unavailable on the dashboard? The dashboard shows a single "Service Unavailable" status bar with the last-known healthy timestamp. Individual panels remain empty — no spinner, no error popup, no white screen.
- What happens when a known contact has zero deals, zero tickets, and zero calls (bare contact)? The AI response references the contact by name, states the account health if available, and offers help. No hallucinated data about non-existent deals or tickets.
- What happens when a WhatsApp contact exceeds 5 messages in 10 seconds (rate limit)? Messages beyond the rate limit receive a 429 response via the webhook acknowledgment. Legitimate messages within the limit continue processing normally.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept incoming WhatsApp messages, validate payload structure, and route through the orchestrator pipeline
- **FR-002**: System MUST accept voice call audio streams, run speech-to-text, and pass transcribed text through the same orchestrator pipeline
- **FR-003**: System MUST look up contacts by phone number and retrieve associated deals, tickets, and account health from the knowledge graph
- **FR-004**: System MUST generate AI responses that reference by-name the following CRM context fields when present: contact name, open deal titles with pipeline stages, current account health score, and the 3 most recent ticket subjects. If any field is absent (e.g., contact has no deals), the response MUST omit that field gracefully without hallucinating data.
- **FR-005**: System MUST prevent duplicate processing of incoming messages using idempotency keys with a 5-minute TTL
- **FR-006**: System MUST encrypt sensitive personal fields (phone, email, transcript) at rest and decrypt only in-memory at read time
- **FR-007**: System MUST fall back to alternative AI providers when the primary provider fails, without dropping the user request
- **FR-008**: System MUST skip knowledge graph expansion and use primary database plus cached context when the graph service is unreachable (graceful degradation)
- **FR-009**: System MUST log all CRM data access to an immutable audit trail with actor ID, role, action, entity, timestamp, and IP address
- **FR-010**: System MUST expose health (liveness) and readiness (degradation status) endpoints for traffic routing
- **FR-011**: System MUST enforce three access roles (admin, agent, viewer) with data-level access policies
- **FR-012**: System MUST provide a read-only web dashboard showing live transcript stream, service health states, cache effectiveness, and active calls
- **FR-013**: System MUST route failed background tasks (message delivery, summarization, data ingestion) to a retry queue with full failure context
- **FR-014**: System MUST validate all required configuration and external service connectivity at startup before accepting any traffic
- **FR-015**: System MUST strip from all AI-generated output before user delivery: (a) sensitive personal data matching phone number and email regex patterns, (b) profanity against a configurable blocklist, and (c) prompt injection patterns including "ignore previous instructions", "you are now", "system:", and role-switching directives. Any output where stripping removes more than 50% of the content MUST be discarded and replaced with a generic fallback response.

### Key Entities

- **Contact**: A customer or lead. Key attributes: name, phone (encrypted), email (encrypted), agent assignment, account association. Linked to deals, calls, and tickets.
- **Deal**: A sales opportunity. Key attributes: title, value, pipeline stage, expected close date, contact association, account association. Linked to contacts and accounts.
- **Account**: A business/organization. Key attributes: name, health score, industry. Aggregates multiple contacts and deals.
- **Call**: A voice interaction. Key attributes: transcript (encrypted), duration, participants, sentiment markers, summary. Linked to contacts.
- **Ticket**: A support request. Key attributes: title, status, priority, contact association. Linked to contacts.
- **AuditLog**: Immutable record of data access. Key attributes: actor_id, actor_role, action, entity_type, entity_id, timestamp, ip_address. Append-only.
- **UserSession**: Conversation state for a contact across a channel. Key attributes: user_id (FK → contacts), channel (whatsapp/voice), messages (encrypted JSONB of turn history), context (cached CRM context for subsequent turns). Linked to contacts. Retained 90 days after last activity.
- **CacheEmbedding**: Semantic cache entry for AI response deduplication. Key attributes: embedding (768-dim vector), prompt_hash (content-addressable dedup key), response (Zod-validated JSONB), model, accessed_at (for LRU eviction). No direct entity relationship — content-addressed by prompt similarity.
- **IdempotencyKey**: Duplicate detection token. Key attributes: key (primary, e.g., WhatsApp message ID), created_at. Auto-expires after 300 seconds (5-minute TTL). Used internally, not exposed to users.
- **HealthCheck**: Per-adapter health snapshot. Key attributes: adapter_name, status (healthy/degraded/down), last_checked_at, latency_ms. Used by /ready endpoint and dashboard, not exposed as a user-facing entity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A sales agent receives a context-aware WhatsApp response (referencing contact name, deal status, and account health) within 2 seconds for 95% of messages
- **SC-002**: Voice call participants experience less than 1.5 seconds of perceived pause from end-of-speech (STT finalization) to start-of-TTS (first audio byte) for 95% of turns. TTS playback duration is NOT included in the pause measurement.
- **SC-003**: The system continues processing requests when any single external service is completely unavailable — zero requests dropped
- **SC-004**: The semantic cache serves at least 30% of AI generation requests from cache (measured over rolling 1-hour windows), avoiding redundant external AI calls
- **SC-005**: No individual service health check remains in a failed state for more than 60 seconds consecutively in normal operation
- **SC-006**: The web dashboard loads all panels within 3 seconds and shows accurate service health states within 30 seconds of a failure
- **SC-007**: AI-generated responses are faithful to the source CRM data with at least 90% accuracy (measured against a golden dataset of 50 CRM conversations)
- **SC-008**: An admin can retrieve a complete audit trail for any CRM entity (contact, deal, call) covering the last 90 days
- **SC-009**: Database breach results in zero readable personal data — all phone numbers, emails, and transcripts are ciphertext only
- **SC-010**: The system stays within operational monitoring budget: under 2,000 active metric series and under 5 GB of trace data per month

## Assumptions

- Customers primarily interact via WhatsApp; voice is a secondary channel with lower volume
- Sales agents are the primary internal users; admin functions are infrequent
- The system operates with 25 contacts, 15 deals, 8 calls, and 5 tickets in seed data (small business scale)
- Cloud service free tiers (database 500 MB storage, graph database 200 MB, voice platform 50 GB/month) are sufficient for initial operation
- WhatsApp message delivery is reliable; the platform may redeliver the same message but won't silently drop messages
- The encryption key is stored securely in the deployment environment, never in code or version control
- A local AI model option is available as an optional third-tier fallback but not required for production
- Privacy regulation compliance (GDPR-style data access and erasure requests) is not required for initial launch but the architecture supports it
- The dashboard is read-only; all data mutations happen through the WhatsApp and voice channels
- Primary AI provider is a cloud-based large language model; a secondary cheaper provider and a local model option form the full fallback chain
- The knowledge graph is hosted on a managed cloud service with 200 MB storage and 50,000 node limits
