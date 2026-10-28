
-- ============== 1. Tenant AI Governance ==============
CREATE TABLE public.tenant_ai_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  allow_copilot boolean NOT NULL DEFAULT true,
  allow_agent boolean NOT NULL DEFAULT true,
  allow_auto_remediation boolean NOT NULL DEFAULT false,
  allow_byo_llm boolean NOT NULL DEFAULT true,
  default_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  default_autonomy text NOT NULL DEFAULT 'supervised' CHECK (default_autonomy IN ('read_only','supervised','autonomous')),
  redact_pii_default boolean NOT NULL DEFAULT true,
  log_prompts boolean NOT NULL DEFAULT true,
  max_tokens_per_day integer NOT NULL DEFAULT 1000000,
  max_agent_runs_per_day integer NOT NULL DEFAULT 200,
  allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_ai_settings TO authenticated;
GRANT ALL ON public.tenant_ai_settings TO service_role;
ALTER TABLE public.tenant_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_read ON public.tenant_ai_settings FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY ai_settings_write ON public.tenant_ai_settings FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER ai_settings_updated_at BEFORE UPDATE ON public.tenant_ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============== 2. Tenant Feature Flags ==============
CREATE TABLE public.tenant_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_feature_flags TO authenticated;
GRANT ALL ON public.tenant_feature_flags TO service_role;
ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY ff_read ON public.tenant_feature_flags FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY ff_write ON public.tenant_feature_flags FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER ff_updated_at BEFORE UPDATE ON public.tenant_feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============== 3. Recon run retention (configurable) ==============
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS run_retention_days integer NOT NULL DEFAULT 90;
ALTER TABLE public.recon_runs ADD COLUMN IF NOT EXISTS run_uid text;
CREATE UNIQUE INDEX IF NOT EXISTS recon_runs_run_uid_idx ON public.recon_runs(run_uid) WHERE run_uid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_recon_run_uid()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.run_uid IS NULL THEN
    NEW.run_uid := 'R-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(NEW.id::text,'-',''),1,8);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recon_runs_set_uid BEFORE INSERT ON public.recon_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_recon_run_uid();

CREATE OR REPLACE FUNCTION public.purge_expired_recon_runs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; r record;
BEGIN
  FOR r IN SELECT id, run_retention_days FROM public.tenants LOOP
    WITH del AS (
      DELETE FROM public.recon_runs
      WHERE tenant_id = r.id
        AND started_at < now() - make_interval(days => GREATEST(r.run_retention_days,1))
      RETURNING 1
    ) SELECT v_count + count(*) INTO v_count FROM del;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.purge_expired_recon_runs() FROM PUBLIC, anon, authenticated;

-- ============== 4. Data Prep Pipelines + DQ ==============
CREATE TABLE public.data_prep_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  source_data_source_id uuid REFERENCES public.workspace_data_sources(id) ON DELETE SET NULL,
  output_data_source_id uuid REFERENCES public.workspace_data_sources(id) ON DELETE SET NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  dq_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  on_failure text NOT NULL DEFAULT 'block' CHECK (on_failure IN ('block','warn','drop_rows')),
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_prep_pipelines TO authenticated;
GRANT ALL ON public.data_prep_pipelines TO service_role;
ALTER TABLE public.data_prep_pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY dpp_read ON public.data_prep_pipelines FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY dpp_write ON public.data_prep_pipelines FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE TRIGGER dpp_updated_at BEFORE UPDATE ON public.data_prep_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.data_prep_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_uid text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','warn')),
  rows_in integer NOT NULL DEFAULT 0,
  rows_out integer NOT NULL DEFAULT 0,
  dq_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  trigger text NOT NULL DEFAULT 'manual',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by uuid REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_prep_runs TO authenticated;
GRANT ALL ON public.data_prep_runs TO service_role;
ALTER TABLE public.data_prep_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dpr_read ON public.data_prep_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY dpr_write ON public.data_prep_runs FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));

CREATE OR REPLACE FUNCTION public.tg_data_prep_run_uid()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.run_uid IS NULL THEN
    NEW.run_uid := 'P-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(NEW.id::text,'-',''),1,8);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_prep_runs_set_uid BEFORE INSERT ON public.data_prep_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_data_prep_run_uid();

-- ============== 5. Data Watchers ==============
CREATE TABLE public.data_watchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  watch_type text NOT NULL CHECK (watch_type IN ('freshness','row_count_delta','schema_change','dq_failure','no_upload')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  enabled boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_state text NOT NULL DEFAULT 'ok',
  last_alerted_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_watchers TO authenticated;
GRANT ALL ON public.data_watchers TO service_role;
ALTER TABLE public.data_watchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY dw_read ON public.data_watchers FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY dw_write ON public.data_watchers FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE TRIGGER dw_updated_at BEFORE UPDATE ON public.data_watchers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
