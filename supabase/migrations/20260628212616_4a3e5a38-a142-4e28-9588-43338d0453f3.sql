
-- ============================================================================
-- 1. DORA / EMIR Refit hardening
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dora_reject_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  regime text NOT NULL CHECK (regime IN ('EMIR_REFIT','MIFIR','SFTR','EBA_EMIR')),
  severity text NOT NULL CHECK (severity IN ('reject','warning','info')),
  description text NOT NULL,
  remediation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dora_reject_codes TO authenticated;
GRANT ALL ON public.dora_reject_codes TO service_role;
ALTER TABLE public.dora_reject_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reject_codes_read_authenticated" ON public.dora_reject_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "reject_codes_write_platform_admin" ON public.dora_reject_codes
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));

INSERT INTO public.dora_reject_codes (code, regime, severity, description, remediation) VALUES
  ('EROR-001','EMIR_REFIT','reject','Missing UTI on new trade','Generate a valid UTI per ISO 23897'),
  ('EROR-002','EMIR_REFIT','reject','Invalid UPI','Look up product on ANNA-DSB and resubmit'),
  ('EROR-003','EMIR_REFIT','reject','Missing LEI for reporting counterparty','Backfill LEI from GLEIF and resubmit'),
  ('EROR-004','EMIR_REFIT','reject','LEI lapsed or not issued','Renew LEI with the LOU and resend with action MODI'),
  ('EROR-010','EMIR_REFIT','reject','Action type/event type combination invalid','Use the EMIR Refit action/event matrix v1.1'),
  ('EROR-021','EMIR_REFIT','warning','Late reporting flag missing','Set late=true and submit with action MODI'),
  ('EROR-030','EMIR_REFIT','reject','Inconsistent collateral portfolio code','Reconcile collateral portfolio with counterparty'),
  ('EROR-040','EMIR_REFIT','reject','Notional currency code not ISO 4217','Use a valid ISO 4217 currency code')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dora_tsr_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  install_id uuid REFERENCES public.regulatory_pack_installs(id) ON DELETE SET NULL,
  business_date date NOT NULL,
  trade_count int NOT NULL DEFAULT 0,
  matched_count int NOT NULL DEFAULT 0,
  break_count int NOT NULL DEFAULT 0,
  reject_count int NOT NULL DEFAULT 0,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  sha256_hex text,
  anchored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.dora_tsr_snapshots TO authenticated;
GRANT ALL ON public.dora_tsr_snapshots TO service_role;
ALTER TABLE public.dora_tsr_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tsr_tenant_read" ON public.dora_tsr_snapshots
  FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "tsr_tenant_write" ON public.dora_tsr_snapshots
  FOR ALL TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_tsr_tenant_date ON public.dora_tsr_snapshots(tenant_id, business_date DESC);

CREATE TABLE IF NOT EXISTS public.dora_evidence_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  install_id uuid REFERENCES public.regulatory_pack_installs(id) ON DELETE SET NULL,
  bundle_kind text NOT NULL CHECK (bundle_kind IN ('submission','tsr','reject_replay','xsd_validation')),
  payload_sha256 text NOT NULL,
  payload_size_bytes bigint NOT NULL,
  r2_object_key text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  signer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signature bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.dora_evidence_bundles TO authenticated;
GRANT ALL ON public.dora_evidence_bundles TO service_role;
ALTER TABLE public.dora_evidence_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dora_evidence_tenant_read" ON public.dora_evidence_bundles
  FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "dora_evidence_write" ON public.dora_evidence_bundles
  FOR INSERT TO authenticated
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_dora_evidence_tenant ON public.dora_evidence_bundles(tenant_id, signed_at DESC);

-- ============================================================================
-- 2. Marketplace — versions, dry-run, moderation
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.marketplace_listing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  version text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 text NOT NULL,
  changelog text,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  yanked_at timestamptz,
  yanked_reason text,
  UNIQUE (listing_id, version)
);
GRANT SELECT ON public.marketplace_listing_versions TO authenticated;
GRANT ALL ON public.marketplace_listing_versions TO service_role;
ALTER TABLE public.marketplace_listing_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mlv_read_authenticated" ON public.marketplace_listing_versions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "mlv_write_platform_admin" ON public.marketplace_listing_versions
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));

ALTER TABLE public.marketplace_installs
  ADD COLUMN IF NOT EXISTS pinned_version text,
  ADD COLUMN IF NOT EXISTS dry_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS dry_run_report jsonb;

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS publisher_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publisher_lei text,
  ADD COLUMN IF NOT EXISTS publisher_domain text,
  ADD COLUMN IF NOT EXISTS moderation_state text NOT NULL DEFAULT 'visible'
    CHECK (moderation_state IN ('visible','hidden','blocked'));

ALTER TABLE public.marketplace_ratings
  ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_reason text,
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
  ADD COLUMN IF NOT EXISTS moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. SOC 2 evidence pipeline
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.soc2_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_code text NOT NULL UNIQUE,
  tsc text NOT NULL CHECK (tsc IN ('Security','Availability','Processing Integrity','Confidentiality','Privacy')),
  title text NOT NULL,
  description text,
  evidence_query text,
  owner text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.soc2_controls TO authenticated;
GRANT ALL ON public.soc2_controls TO service_role;
ALTER TABLE public.soc2_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soc2_controls_read_authenticated" ON public.soc2_controls
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "soc2_controls_write_platform_admin" ON public.soc2_controls
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));

INSERT INTO public.soc2_controls (control_code, tsc, title, description, owner) VALUES
  ('CC1.1','Security','COSO control environment','Tone at the top, ethics policies, org structure','Compliance'),
  ('CC2.1','Security','Information & communication','Audit log retention, communication of policies','Security'),
  ('CC6.1','Security','Logical access controls','RLS, MFA, SSO, password policy','Security'),
  ('CC6.2','Security','New user provisioning','SCIM provisioning, access requests, approvals','Security'),
  ('CC6.3','Security','Access removal','SCIM deprovisioning, quarterly access reviews','Security'),
  ('CC6.6','Security','Encryption in transit & at rest','TLS 1.2+, AES-256, BYOK','Security'),
  ('CC7.1','Security','System monitoring','Worker health, observability, anomaly detection','SRE'),
  ('CC7.2','Security','Incident response','Status page, incident playbook, postmortems','SRE'),
  ('CC7.3','Security','Change management','Migration approvals, 4-eyes promotion','Eng'),
  ('CC7.4','Security','Disaster recovery','DR drills, backup verify, RPO/RTO','SRE'),
  ('A1.1','Availability','Capacity planning','Rate-limit watch, AI budget guards','SRE'),
  ('PI1.1','Processing Integrity','Audit log integrity','Hash-chained audit, anchoring, verify_audit_chain','Security'),
  ('C1.1','Confidentiality','Customer data segregation','RLS multi-tenant tests, BU scope','Eng'),
  ('P4.1','Privacy','Data retention & disposal','Retention policy, purge_expired_data','Compliance')
ON CONFLICT (control_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.soc2_evidence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id uuid NOT NULL REFERENCES public.soc2_controls(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('pass','fail','warn','skipped')),
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_sha256 text,
  worm_ledger_id uuid,
  notes text,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (control_id, run_date)
);
GRANT SELECT ON public.soc2_evidence_runs TO authenticated;
GRANT ALL ON public.soc2_evidence_runs TO service_role;
ALTER TABLE public.soc2_evidence_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soc2_runs_read_admin" ON public.soc2_evidence_runs
  FOR SELECT TO authenticated USING (is_platform_admin(auth.uid()));
CREATE POLICY "soc2_runs_write_service" ON public.soc2_evidence_runs
  FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_soc2_runs_date ON public.soc2_evidence_runs(run_date DESC);

CREATE TABLE IF NOT EXISTS public.soc2_access_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  quarter text NOT NULL,
  reviewer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','signed_off','rejected')),
  total_users int NOT NULL DEFAULT 0,
  removed_count int NOT NULL DEFAULT 0,
  signed_off_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.soc2_access_reviews TO authenticated;
GRANT ALL ON public.soc2_access_reviews TO service_role;
ALTER TABLE public.soc2_access_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ar_read" ON public.soc2_access_reviews FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)));
CREATE POLICY "ar_write" ON public.soc2_access_reviews FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)))
  WITH CHECK (is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)));

-- ============================================================================
-- 4. Chat-Ops deep integrations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.chat_ops_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  match_severity text CHECK (match_severity IN ('low','medium','high','critical')),
  match_bu_id uuid REFERENCES public.business_units(id) ON DELETE CASCADE,
  match_recon_id uuid REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  channel text NOT NULL,
  channel_kind text NOT NULL CHECK (channel_kind IN ('slack','email','teams','webhook')),
  priority int NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_ops_routing_rules TO authenticated;
GRANT ALL ON public.chat_ops_routing_rules TO service_role;
ALTER TABLE public.chat_ops_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corr_tenant_member_read" ON public.chat_ops_routing_rules FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "corr_tenant_admin_write" ON public.chat_ops_routing_rules FOR ALL TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.chat_ops_inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  from_email text NOT NULL,
  subject text,
  body_text text,
  break_id uuid REFERENCES public.recon_exceptions(id) ON DELETE SET NULL,
  parse_status text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','linked','quarantined','duplicate')),
  parse_error text,
  attachments_count int NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id)
);
GRANT SELECT, INSERT, UPDATE ON public.chat_ops_inbound_emails TO authenticated;
GRANT ALL ON public.chat_ops_inbound_emails TO service_role;
ALTER TABLE public.chat_ops_inbound_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inbound_email_read" ON public.chat_ops_inbound_emails FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "inbound_email_write" ON public.chat_ops_inbound_emails FOR ALL TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.chat_ops_slash_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  command text NOT NULL,
  invoked_by_email text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','denied','step_up_required')),
  invoked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_ops_slash_commands TO authenticated;
GRANT ALL ON public.chat_ops_slash_commands TO service_role;
ALTER TABLE public.chat_ops_slash_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slash_read" ON public.chat_ops_slash_commands FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "slash_write_service" ON public.chat_ops_slash_commands FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()));

-- ============================================================================
-- 5. Slack two-way thread sync
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.slack_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  team_id text NOT NULL,
  team_name text,
  bot_user_id text,
  encrypted_bot_token bytea NOT NULL,
  scope text,
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, team_id)
);
GRANT SELECT, INSERT, UPDATE ON public.slack_workspaces TO authenticated;
GRANT ALL ON public.slack_workspaces TO service_role;
ALTER TABLE public.slack_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sw_read" ON public.slack_workspaces FOR SELECT TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));
CREATE POLICY "sw_write" ON public.slack_workspaces FOR ALL TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.slack_thread_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  break_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.slack_workspaces(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel_id, thread_ts)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_thread_mappings TO authenticated;
GRANT ALL ON public.slack_thread_mappings TO service_role;
ALTER TABLE public.slack_thread_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stm_read" ON public.slack_thread_mappings FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE POLICY "stm_write" ON public.slack_thread_mappings FOR ALL TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))
  WITH CHECK (private.is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_stm_break ON public.slack_thread_mappings(break_id);

CREATE TABLE IF NOT EXISTS public.slack_comment_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL REFERENCES public.slack_thread_mappings(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.break_comments(id) ON DELETE SET NULL,
  slack_message_ts text,
  direction text NOT NULL CHECK (direction IN ('outbound','inbound')),
  delivered_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.slack_comment_sync TO authenticated;
GRANT ALL ON public.slack_comment_sync TO service_role;
ALTER TABLE public.slack_comment_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scs_read" ON public.slack_comment_sync FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.slack_thread_mappings m
    WHERE m.id = mapping_id AND (private.is_tenant_member(auth.uid(), m.tenant_id) OR is_platform_admin(auth.uid()))));
CREATE POLICY "scs_write" ON public.slack_comment_sync FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin(auth.uid()));

-- ============================================================================
-- 6. Roadmap audit-ready computed gate
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadmap_readiness_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_item_id uuid NOT NULL REFERENCES public.roadmap_items(id) ON DELETE CASCADE,
  criterion text NOT NULL CHECK (criterion IN ('tests_pass','docs_updated','diagram_rendered','evidence_pack','security_scan_clean','rls_coverage')),
  satisfied boolean NOT NULL DEFAULT false,
  evidence_url text,
  satisfied_at timestamptz,
  satisfied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (roadmap_item_id, criterion)
);
GRANT SELECT, INSERT, UPDATE ON public.roadmap_readiness_criteria TO authenticated;
GRANT ALL ON public.roadmap_readiness_criteria TO service_role;
ALTER TABLE public.roadmap_readiness_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rrc_read" ON public.roadmap_readiness_criteria FOR SELECT TO authenticated USING (true);
CREATE POLICY "rrc_write" ON public.roadmap_readiness_criteria FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.evaluate_roadmap_audit_ready(_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total int; v_satisfied int;
BEGIN
  SELECT count(*) FILTER (WHERE true),
         count(*) FILTER (WHERE satisfied)
    INTO v_total, v_satisfied
  FROM public.roadmap_readiness_criteria WHERE roadmap_item_id = _item_id;
  IF v_total = 0 THEN RETURN false; END IF;
  RETURN v_satisfied = v_total;
END $$;
REVOKE ALL ON FUNCTION public.evaluate_roadmap_audit_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_roadmap_audit_ready(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_roadmap_audit_ready_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.roadmap_items
    SET audit_ready = public.evaluate_roadmap_audit_ready(NEW.roadmap_item_id),
        updated_at = now()
    WHERE id = NEW.roadmap_item_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_roadmap_audit_ready_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_roadmap_audit_ready ON public.roadmap_readiness_criteria;
CREATE TRIGGER trg_roadmap_audit_ready
  AFTER INSERT OR UPDATE ON public.roadmap_readiness_criteria
  FOR EACH ROW EXECUTE FUNCTION public.tg_roadmap_audit_ready_sync();
