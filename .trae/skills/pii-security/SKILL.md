---
name: pii-security
description: >-
  Mandates field-level AES-256-GCM encryption for PII stored in Supabase,
  RBAC role definitions with RLS policies, and audit logging. Use when
  creating Supabase migrations, building store adapters, or adding new
  CRM entities that store sensitive data.
---

# PII Security

## Field-Level Encryption (adapters/encryption/field-encryption.ts)

**Algorithm:** AES-256-GCM
**Key derivation:** `HKDF(masterKey, salt=rowId, info=entityType)`
**Master key source:** `ENCRYPTION_MASTER_KEY` env var (32-byte hex)

**Encrypted fields:**
| Table | Column | Entity Type |
|---|---|---|
| `contacts` | `phone` | `"contact"` |
| `contacts` | `email` | `"contact"` |
| `calls` | `transcript_json` | `"call"` |
| `user_sessions` | `messages` | `"session"` |

**API:**
```ts
encrypt(plaintext, rowId, entityType) → { ciphertext, keyId, algorithm: "AES-256-GCM" }
decrypt(ciphertext, keyId, rowId, entityType) → plaintext
rotateKey(record, newMasterKey) → re-encrypt with new key
```

**Rule:** PII is decrypted ONLY in-memory at read time. NEVER stored as plaintext. NEVERSurface in logs, error metadata, or span attributes.

## RBAC Roles

| Role | Permissions |
|---|---|
| `admin` | Full CRUD all tables, manage agents, telemetry, DLQ replay |
| `agent` | Read/write own contacts, deals, calls. Read accounts. Create tickets. |
| `viewer` | SELECT-only on assigned contacts, accounts, deals. No mutations. |
| `service_role` | Bypass RLS (backend only). NEVER exposed to clients. |

## RLS Policy Pattern

```sql
-- Example: contacts table
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_own_contacts" ON contacts
  FOR ALL USING (agent_id = auth.uid());

CREATE POLICY "viewers_read_contacts" ON contacts
  FOR SELECT USING (
    id IN (SELECT entity_id FROM assignments
           WHERE user_id = auth.uid() AND entity_type = 'contact')
  );

-- service_role bypasses all policies (handled by Supabase default)
```

## Audit Logging

**Table:** `audit_logs` — immutable (INSERT only, no UPDATE/DELETE)

**Schema:** `id, actor_id, actor_role, action, entity_type, entity_id, timestamp, ip_address`

**Retention:** 90 days on free tier

**Access:** `admin` → SELECT; `service_role` → INSERT
