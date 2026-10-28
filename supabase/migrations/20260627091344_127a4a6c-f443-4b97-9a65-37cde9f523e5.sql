
-- ============================================================
-- 1) PLATFORM AI GOVERNANCE (singleton)
-- ============================================================
CREATE TABLE public.platform_ai_settings (
  id boolean PRIMARY KEY DEFAULT true,
  allow_copilot_global boolean NOT NULL DEFAULT true,
  allow_agent_global boolean NOT NULL DEFAULT true,
  allow_auto_remediation_global boolean NOT NULL DEFAULT false,
  allow_byo_llm_global boolean NOT NULL DEFAULT true,
  force_pii_redaction boolean NOT NULL DEFAULT false,
  force_log_prompts boolean NOT NULL DEFAULT true,
  default_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  global_allowed_models text[] NOT NULL DEFAULT ARRAY[
    'google/gemini-3-flash-preview','google/gemini-2.5-flash','google/gemini-2.5-flash-lite',
    'google/gemini-2.5-pro','muse/gpt-5','muse/gpt-5-mini','muse/gpt-5-nano'
  ],
  default_autonomy_ceiling text NOT NULL DEFAULT 'suggest' CHECK (default_autonomy_ceiling IN ('suggest','assist','auto')),
  global_max_tokens_per_day integer NOT NULL DEFAULT 5000000,
  global_max_agent_runs_per_day integer NOT NULL DEFAULT 5000,
  global_max_cost_usd_per_day numeric(12,2) NOT NULL DEFAULT 500.00,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_ai_settings_singleton CHECK (id IS TRUE)
);
GRANT SELECT ON public.platform_ai_settings TO authenticated;
GRANT ALL ON public.platform_ai_settings TO service_role;
ALTER TABLE public.platform_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pas_read ON public.platform_ai_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY pas_admin ON public.platform_ai_settings FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
INSERT INTO public.platform_ai_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============================================================
-- 2) FEATURE ENTITLEMENTS (platform -> tenant)
-- ============================================================
CREATE TABLE public.tenant_feature_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  plan_required text NOT NULL DEFAULT 'starter' CHECK (plan_required IN ('starter','professional','enterprise')),
  locked_reason text,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);
GRANT SELECT ON public.tenant_feature_entitlements TO authenticated;
GRANT ALL ON public.tenant_feature_entitlements TO service_role;
ALTER TABLE public.tenant_feature_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tfe_member_read ON public.tenant_feature_entitlements FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY tfe_platform_write ON public.tenant_feature_entitlements FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER tfe_set_updated BEFORE UPDATE ON public.tenant_feature_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 3) TENANT GROUPS
-- ============================================================
CREATE TABLE public.tenant_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_groups TO authenticated;
GRANT ALL ON public.tenant_groups TO service_role;
ALTER TABLE public.tenant_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tg_read ON public.tenant_groups FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY tg_admin ON public.tenant_groups FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_set_updated BEFORE UPDATE ON public.tenant_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.tenant_group_members (
  group_id uuid NOT NULL REFERENCES public.tenant_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_group_members TO authenticated;
GRANT ALL ON public.tenant_group_members TO service_role;
ALTER TABLE public.tenant_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tgm_read ON public.tenant_group_members FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = group_id AND
    (public.is_tenant_member(auth.uid(), g.tenant_id) OR public.is_platform_admin(auth.uid()))));
CREATE POLICY tgm_admin ON public.tenant_group_members FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = group_id AND
    (public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = group_id AND
    (public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))));

CREATE TABLE public.tenant_group_roles (
  group_id uuid NOT NULL REFERENCES public.tenant_groups(id) ON DELETE CASCADE,
  role tenant_role NOT NULL,
  PRIMARY KEY (group_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.tenant_group_roles TO authenticated;
GRANT ALL ON public.tenant_group_roles TO service_role;
ALTER TABLE public.tenant_group_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tgr_read ON public.tenant_group_roles FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = group_id AND
    (public.is_tenant_member(auth.uid(), g.tenant_id) OR public.is_platform_admin(auth.uid()))));
CREATE POLICY tgr_admin ON public.tenant_group_roles FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = group_id AND
    (public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = group_id AND
    (public.has_tenant_role(auth.uid(), g.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))));

-- ============================================================
-- 4) PER-RECON RBAC
-- ============================================================
ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'tenant'
    CHECK (visibility IN ('tenant','restricted'));

CREATE TABLE public.recon_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user','group')),
  principal_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('read','run','edit','approve')),
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recon_id, principal_type, principal_id, permission)
);
CREATE INDEX recon_permissions_recon_idx ON public.recon_permissions(recon_id);
GRANT SELECT, INSERT, DELETE ON public.recon_permissions TO authenticated;
GRANT ALL ON public.recon_permissions TO service_role;
ALTER TABLE public.recon_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rp_read ON public.recon_permissions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.recon_definitions d WHERE d.id = recon_id AND
    (public.is_tenant_member(auth.uid(), d.tenant_id) OR public.is_platform_admin(auth.uid()))));
CREATE POLICY rp_admin ON public.recon_permissions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.recon_definitions d WHERE d.id = recon_id AND
    (public.has_tenant_role(auth.uid(), d.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.recon_definitions d WHERE d.id = recon_id AND
    (public.has_tenant_role(auth.uid(), d.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))));

CREATE OR REPLACE FUNCTION public.user_can_access_recon(_user uuid, _recon uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (SELECT tenant_id, visibility FROM public.recon_definitions WHERE id = _recon)
  SELECT
    -- platform admins always
    public.is_platform_admin(_user)
    OR EXISTS (
      SELECT 1 FROM d
      WHERE public.is_tenant_member(_user, d.tenant_id) AND (
        -- open recons: any tenant member can read; admins can do anything
        (d.visibility = 'tenant' AND (_perm = 'read'
          OR public.has_tenant_role(_user, d.tenant_id, 'tenant_admin')
          OR (public.has_tenant_role(_user, d.tenant_id, 'tenant_analyst') AND _perm IN ('run','edit','approve'))))
        -- restricted: tenant_admin always
        OR (d.visibility = 'restricted' AND public.has_tenant_role(_user, d.tenant_id, 'tenant_admin'))
        -- direct grant
        OR EXISTS (SELECT 1 FROM public.recon_permissions rp
            WHERE rp.recon_id = _recon AND rp.principal_type = 'user'
              AND rp.principal_id = _user AND rp.permission = _perm)
        -- group grant
        OR EXISTS (SELECT 1 FROM public.recon_permissions rp
            JOIN public.tenant_group_members gm ON gm.group_id = rp.principal_id AND gm.user_id = _user
            WHERE rp.recon_id = _recon AND rp.principal_type = 'group' AND rp.permission = _perm)
      )
    )
$$;

-- Tighten recon RLS to honor visibility + grants
DROP POLICY IF EXISTS recon_defs_select_member ON public.recon_definitions;
CREATE POLICY recon_defs_select ON public.recon_definitions FOR SELECT TO authenticated
  USING (public.user_can_access_recon(auth.uid(), id, 'read'));
CREATE POLICY recon_defs_write ON public.recon_definitions FOR ALL TO authenticated
  USING (public.user_can_access_recon(auth.uid(), id, 'edit'))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

-- ============================================================
-- 5) AI COST METERING
-- ============================================================
CREATE TABLE public.ai_model_pricing (
  model text PRIMARY KEY,
  input_per_1k_usd numeric(10,6) NOT NULL DEFAULT 0,
  output_per_1k_usd numeric(10,6) NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_model_pricing TO authenticated;
GRANT ALL ON public.ai_model_pricing TO service_role;
ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY amp_read ON public.ai_model_pricing FOR SELECT TO authenticated USING (true);
CREATE POLICY amp_admin ON public.ai_model_pricing FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
INSERT INTO public.ai_model_pricing(model, input_per_1k_usd, output_per_1k_usd) VALUES
  ('google/gemini-3-flash-preview', 0.000075, 0.0003),
  ('google/gemini-2.5-flash',       0.000075, 0.0003),
  ('google/gemini-2.5-flash-lite',  0.00004,  0.00015),
  ('google/gemini-2.5-pro',         0.00125,  0.005),
  ('muse/gpt-5',                  0.005,    0.015),
  ('muse/gpt-5-mini',             0.0008,   0.0024),
  ('muse/gpt-5-nano',             0.0002,   0.0008)
ON CONFLICT (model) DO NOTHING;

CREATE TABLE public.ai_budgets (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  daily_max_tokens integer NOT NULL DEFAULT 1000000,
  daily_max_cost_usd numeric(10,2) NOT NULL DEFAULT 50.00,
  monthly_max_cost_usd numeric(10,2) NOT NULL DEFAULT 1000.00,
  alert_at_pct integer NOT NULL DEFAULT 80 CHECK (alert_at_pct BETWEEN 1 AND 100),
  hard_stop_at_pct integer NOT NULL DEFAULT 100 CHECK (hard_stop_at_pct BETWEEN 1 AND 200),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.ai_budgets TO authenticated;
GRANT ALL ON public.ai_budgets TO service_role;
ALTER TABLE public.ai_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ab_read ON public.ai_budgets FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY ab_admin ON public.ai_budgets FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('copilot','agent','aidp','schema_map','tool','other')),
  model text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  run_uid text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_tenant_day_idx ON public.ai_usage_events(tenant_id, created_at DESC);
GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY aue_read ON public.ai_usage_events FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

-- ============================================================
-- 6) AIDP — Adaptive Intelligent Document Processing
-- ============================================================
CREATE TABLE public.aidp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  doc_kind text NOT NULL DEFAULT 'generic'
    CHECK (doc_kind IN ('bank_statement','trade_confirm','invoice','custodian_report','generic')),
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_prompt text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_templates TO authenticated;
GRANT ALL ON public.aidp_templates TO service_role;
ALTER TABLE public.aidp_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_t_read ON public.aidp_templates FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY aidp_t_admin ON public.aidp_templates FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
      OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER aidp_t_set_updated BEFORE UPDATE ON public.aidp_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.aidp_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  data_source_id uuid REFERENCES public.workspace_data_sources(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.aidp_templates(id) ON DELETE SET NULL,
  original_filename text NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','extracting','review','approved','failed')),
  extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4),
  error text,
  model text,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aidp_docs_tenant_idx ON public.aidp_documents(tenant_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_documents TO authenticated;
GRANT ALL ON public.aidp_documents TO service_role;
ALTER TABLE public.aidp_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_d_read ON public.aidp_documents FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY aidp_d_write ON public.aidp_documents FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE TRIGGER aidp_d_set_updated BEFORE UPDATE ON public.aidp_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 7) AUDIT ISOLATION (verify + harden)
-- ============================================================
-- Drop overly-broad policies, then add scoped ones.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.audit_log'::regclass AND polcmd = 'r' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_log', p.polname);
  END LOOP;
END $$;
CREATE POLICY audit_tenant_read ON public.audit_log FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY audit_platform_read ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ============================================================
-- 8) Effective-permissions helper (groups + direct role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_has_tenant_role_or_group(_user uuid, _tenant uuid, _role tenant_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_tenant_role(_user, _tenant, _role)
    OR EXISTS (
      SELECT 1 FROM public.tenant_group_members gm
        JOIN public.tenant_groups g ON g.id = gm.group_id AND g.tenant_id = _tenant
        JOIN public.tenant_group_roles gr ON gr.group_id = g.id
      WHERE gm.user_id = _user AND gr.role = _role
    )
$$;
