-- Early, independent boundary after the hosted 20260923090100 ledger.
-- Do not pull the pending importer / reconciliation Access chain forward.
-- These restrictive policies intersect existing permissive policies: no role,
-- grant, human write permission or service-role intake behavior is added.
-- Distinct policy names also compose with the later 20260927160000 PII/RPC
-- migration, which replaces permissive policies and further narrows writes.
BEGIN;

DO $boundary$
DECLARE
  target text;
  human_roles constant text := $predicate$
    auth.uid() IS NOT NULL AND (
      public.has_mkt_role(auth.uid(), 'super_admin'::public.mkt_admin_role)
      OR public.has_mkt_role(auth.uid(), 'sales_admin'::public.mkt_admin_role)
      OR public.has_mkt_role(auth.uid(), 'marketing_admin'::public.mkt_admin_role)
    )
    AND EXISTS (
      SELECT 1 FROM public.mkt_admin_users administrator
      WHERE administrator.user_id = auth.uid() AND administrator.status = 'active'
    )
  $predicate$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'mkt_leads', 'mkt_lead_files', 'mkt_lead_notes', 'mkt_lead_tasks',
    'mkt_lead_activity', 'mkt_appointments', 'mkt_chat_sessions',
    'mkt_chat_messages', 'mkt_kb_queries', 'mkt_llm_usage', 'mkt_cta_events'
  ] LOOP
    -- Fail the entire transaction on missing/disabled RLS, rather than claim a
    -- boundary that cannot be enforced. All tables predate the hosted ledger.
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Expected RLS-enabled marketing table public.%', target;
    END IF;
    EXECUTE format(
      'CREATE POLICY mkt_pii_human_role_boundary ON public.%I AS RESTRICTIVE
       FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      target, human_roles, human_roles
    );
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mkt_content_audit_log' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected RLS-enabled marketing audit table';
  END IF;
  -- Lead mutations copy names/company and free-form notes into before/after/
  -- summary. Current configuration entities retain their existing audit read
  -- access; lead and any unknown/new entity types fail closed for other roles.
  EXECUTE format(
    'CREATE POLICY mkt_lead_pii_audit_boundary ON public.mkt_content_audit_log
     AS RESTRICTIVE FOR SELECT TO authenticated USING (
       entity_type IN (''homepage_section'', ''site_logo'', ''llm_provider'',
         ''kb_source'', ''admin_role'', ''chatbot_prompt'', ''appointment_type'',
         ''site_theme'', ''theme_approval'', ''mkt_bootstrap'') OR (%s))',
    human_roles
  );
END
$boundary$;

COMMIT;
