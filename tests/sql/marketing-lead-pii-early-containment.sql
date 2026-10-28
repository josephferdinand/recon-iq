-- Emergency fail-closed containment, NOT an automatic production rollback.
-- Disable public intake in the application first. This blocks all authenticated
-- queue/PII access while preserving service-role intake/audit operations.
-- Dropping the early policies would reopen the original PII exposure.
BEGIN;
DO $contain$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'mkt_leads','mkt_lead_files','mkt_lead_notes','mkt_lead_tasks',
    'mkt_lead_activity','mkt_appointments','mkt_chat_sessions',
    'mkt_chat_messages','mkt_kb_queries','mkt_llm_usage','mkt_cta_events'
  ] LOOP
    EXECUTE format(
      'ALTER POLICY mkt_pii_human_role_boundary ON public.%I USING (false) WITH CHECK (false)',
      target
    );
  END LOOP;
END
$contain$;
ALTER POLICY mkt_lead_pii_audit_boundary ON public.mkt_content_audit_log
  USING (entity_type IN ('homepage_section','site_logo','llm_provider',
    'kb_source','admin_role','chatbot_prompt','appointment_type',
    'site_theme','theme_approval','mkt_bootstrap'));
COMMIT;
