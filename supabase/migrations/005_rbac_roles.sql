
-- 005_rbac_roles.sql
-- Task 3.5: RBAC Roles

-- Create custom roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'admin') THEN
        CREATE ROLE admin NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agent') THEN
        CREATE ROLE agent NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viewer') THEN
        CREATE ROLE viewer NOINHERIT;
    END IF;
END
$$;

-- Admin has full privileges (bypass RLS)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ai_cache TO admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ai_cache TO admin;

-- Grant agent role permissions (we already set RLS policies)
GRANT USAGE ON SCHEMA public TO agent;
GRANT USAGE ON SCHEMA ai_cache TO agent;
GRANT SELECT, INSERT, UPDATE ON public.contacts TO agent;
GRANT SELECT, INSERT, UPDATE ON public.deals TO agent;
GRANT SELECT, INSERT, UPDATE ON public.calls TO agent;
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO agent;
GRANT SELECT ON public.accounts TO agent;
GRANT SELECT ON public.pipeline_stages TO agent;
GRANT SELECT ON ai_cache.cache_embeddings TO agent;

-- Viewer has read-only on some tables
GRANT USAGE ON SCHEMA public TO viewer;
GRANT SELECT ON public.contacts TO viewer;
GRANT SELECT ON public.accounts TO viewer;
GRANT SELECT ON public.deals TO viewer;
