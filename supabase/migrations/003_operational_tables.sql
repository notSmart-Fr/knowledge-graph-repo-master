
-- 003_operational_tables.sql
-- Task 3.3: Operational Tables

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    key TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    actor_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    ip_address TEXT
);

CREATE TABLE IF NOT EXISTS public.health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adapter_name TEXT NOT NULL,
    status TEXT NOT NULL,
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    latency_ms INTEGER
);
