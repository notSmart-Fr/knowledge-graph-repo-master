
-- 004_rls_policies.sql
-- Task 3.4: RLS Policies

-- Enable RLS on all public tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cache.cache_embeddings ENABLE ROW LEVEL SECURITY;

-- Accounts: SELECT for authenticated users
CREATE POLICY "Authenticated users can view accounts"
ON public.accounts FOR SELECT
TO authenticated
USING (true);

-- Contacts: SELECT/INSERT/UPDATE where agent_id = auth.uid()
CREATE POLICY "Agents can manage their contacts"
ON public.contacts
FOR ALL
TO authenticated
USING (agent_id = auth.uid())
WITH CHECK (agent_id = auth.uid());

-- Deals: SELECT/INSERT/UPDATE where agent_id = auth.uid()
CREATE POLICY "Agents can manage their deals"
ON public.deals
FOR ALL
TO authenticated
USING (agent_id = auth.uid())
WITH CHECK (agent_id = auth.uid());

-- Pipeline Stages: SELECT for authenticated users
CREATE POLICY "Authenticated users can view pipeline stages"
ON public.pipeline_stages
FOR SELECT
TO authenticated
USING (true);

-- Calls: SELECT/INSERT/UPDATE where agent_id = auth.uid()
CREATE POLICY "Agents can manage their calls"
ON public.calls
FOR ALL
TO authenticated
USING (agent_id = auth.uid())
WITH CHECK (agent_id = auth.uid());

-- Support Tickets: SELECT/INSERT/UPDATE where agent_id = auth.uid()
CREATE POLICY "Agents can manage their tickets"
ON public.support_tickets
FOR ALL
TO authenticated
USING (agent_id = auth.uid())
WITH CHECK (agent_id = auth.uid());

-- AI Cache: SELECT authenticated, INSERT service_role
CREATE POLICY "Authenticated can select from ai_cache"
ON ai_cache.cache_embeddings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role can insert into ai_cache"
ON ai_cache.cache_embeddings
FOR INSERT
TO service_role
WITH CHECK (true);

-- Audit Logs: SELECT admin, INSERT service_role, no UPDATE/DELETE
CREATE POLICY "Service role can insert into audit_logs"
ON public.audit_logs
FOR INSERT
TO service_role
WITH CHECK (true);

-- Idempotency Keys: only service_role
CREATE POLICY "Service role can manage idempotency keys"
ON public.idempotency_keys
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
