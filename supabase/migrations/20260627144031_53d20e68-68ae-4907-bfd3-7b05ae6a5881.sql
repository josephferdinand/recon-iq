
-- =========================================================
-- Batch A — P0 Duco-parity foundations
-- =========================================================

-- 1. Reporting field mappings (cross-process semantic layer)
CREATE TABLE public.reporting_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  canonical_field text NOT NULL,
  display_label text NOT NULL,
  data_type text NOT NULL DEFAULT 'string',
  description text,
  source_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_suggested boolean NOT NULL DEFAULT false,
  ai_confidence numeric,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','archived')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, canonical_field, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reporting_field_mappings TO authenticated;
GRANT ALL ON public.reporting_field_mappings TO service_role;
ALTER TABLE public.reporting_field_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rfm_read" ON public.reporting_field_mappings FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "rfm_write" ON public.reporting_field_mappings FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE INDEX idx_rfm_tenant ON public.reporting_field_mappings(tenant_id, status);
CREATE TRIGGER trg_rfm_upd BEFORE UPDATE ON public.reporting_field_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Reporting DB exports
CREATE TABLE public.reporting_db_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  format text NOT NULL DEFAULT 'parquet' CHECK (format IN ('parquet','csv','jsonl')),
  destination_kind text NOT NULL DEFAULT 's3' CHECK (destination_kind IN ('s3','gcs','azure','snowflake','redshift','bigquery','sftp')),
  destination_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule_cron text,
  is_enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  last_run_rows bigint,
  last_run_error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reporting_db_exports TO authenticated;
GRANT ALL ON public.reporting_db_exports TO service_role;
ALTER TABLE public.reporting_db_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rde_read" ON public.reporting_db_exports FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "rde_write" ON public.reporting_db_exports FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE INDEX idx_rde_tenant ON public.reporting_db_exports(tenant_id, is_enabled);
CREATE TRIGGER trg_rde_upd BEFORE UPDATE ON public.reporting_db_exports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Proposed matches (ML review queue)
CREATE TABLE public.proposed_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.recon_runs(id) ON DELETE CASCADE,
  definition_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  members jsonb NOT NULL,
  cardinality text NOT NULL DEFAULT '1:1',
  ml_score numeric NOT NULL,
  ml_features jsonb DEFAULT '{}'::jsonb,
  rule_hint text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
  reviewer_id uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposed_matches TO authenticated;
GRANT ALL ON public.proposed_matches TO service_role;
ALTER TABLE public.proposed_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pm_read" ON public.proposed_matches FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "pm_write" ON public.proposed_matches FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE INDEX idx_pm_tenant_status ON public.proposed_matches(tenant_id, status, ml_score DESC);
CREATE INDEX idx_pm_run ON public.proposed_matches(run_id);

-- 4. Manual match approvals (maker-checker on manual matches)
CREATE TABLE public.manual_match_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.recon_runs(id) ON DELETE SET NULL,
  exception_ids uuid[] NOT NULL DEFAULT '{}',
  members jsonb NOT NULL,
  cardinality text NOT NULL DEFAULT '1:1',
  rationale text,
  proposed_by uuid NOT NULL REFERENCES auth.users(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approver_id uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  reject_reason text,
  created_match_id uuid REFERENCES public.recon_matches(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_match_approvals TO authenticated;
GRANT ALL ON public.manual_match_approvals TO service_role;
ALTER TABLE public.manual_match_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mma_read" ON public.manual_match_approvals FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "mma_propose" ON public.manual_match_approvals FOR INSERT TO authenticated
  WITH CHECK ((public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
      AND proposed_by = auth.uid());
CREATE POLICY "mma_approve" ON public.manual_match_approvals FOR UPDATE TO authenticated
  USING ((public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
      AND proposed_by <> auth.uid())
  WITH CHECK ((public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
      AND proposed_by <> auth.uid());
CREATE INDEX idx_mma_tenant_status ON public.manual_match_approvals(tenant_id, status, proposed_at DESC);
CREATE TRIGGER trg_mma_upd BEFORE UPDATE ON public.manual_match_approvals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. Reference data lookup tables
CREATE TABLE public.reference_data_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  key_columns text[] NOT NULL DEFAULT '{}',
  value_columns text[] NOT NULL DEFAULT '{}',
  row_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_data_tables TO authenticated;
GRANT ALL ON public.reference_data_tables TO service_role;
ALTER TABLE public.reference_data_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rdt_read" ON public.reference_data_tables FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "rdt_write" ON public.reference_data_tables FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE TRIGGER trg_rdt_upd BEFORE UPDATE ON public.reference_data_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.reference_data_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.reference_data_tables(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  row_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_data_rows TO authenticated;
GRANT ALL ON public.reference_data_rows TO service_role;
ALTER TABLE public.reference_data_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rdr_read" ON public.reference_data_rows FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "rdr_write" ON public.reference_data_rows FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE INDEX idx_rdr_table ON public.reference_data_rows(table_id);
CREATE INDEX idx_rdr_data ON public.reference_data_rows USING GIN (row_data);

-- 6. SCIM tokens + sync log
CREATE TABLE public.scim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scim_tokens TO authenticated;
GRANT ALL ON public.scim_tokens TO service_role;
ALTER TABLE public.scim_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scimt_read" ON public.scim_tokens FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE POLICY "scimt_write" ON public.scim_tokens FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

CREATE TABLE public.scim_sync_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.scim_tokens(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  operation text NOT NULL,
  external_id text,
  payload jsonb,
  status_code integer,
  error text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.scim_sync_log TO authenticated;
GRANT ALL ON public.scim_sync_log TO service_role;
ALTER TABLE public.scim_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scims_read" ON public.scim_sync_log FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE INDEX idx_scims_tenant_time ON public.scim_sync_log(tenant_id, occurred_at DESC);

-- 7. Recon definition extension for new rule kinds
ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS extension jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.recon_definitions.extension IS
  'Carries extended rule config (conditional sets, roll-ups, ref-lookups, multi-pass, quick-fix). Engine reads keys: conditional_sets[], roll_ups[], reference_lookups[], multi_pass[], quick_fixes[].';
