
-- ============================================================
-- Tenant Administration Foundation (Batch 1)
-- 18 new tables · RLS · GRANTs · updated_at triggers
-- ============================================================

-- Shared updated_at trigger fn (idempotent create)
CREATE OR REPLACE FUNCTION public.tenant_admin_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Convenience predicate: caller is tenant_admin of _tenant OR platform_admin
CREATE OR REPLACE FUNCTION public.can_admin_tenant(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), _tenant, 'tenant_admin'::public.tenant_role);
$$;

CREATE OR REPLACE FUNCTION public.can_read_tenant(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT public.is_platform_admin(auth.uid())
      OR public.has_tenant_role(auth.uid(), _tenant, 'tenant_admin'::public.tenant_role)
      OR public.has_tenant_role(auth.uid(), _tenant, 'tenant_analyst'::public.tenant_role)
      OR public.has_tenant_role(auth.uid(), _tenant, 'tenant_viewer'::public.tenant_role);
$$;

-- ============================================================
-- T-5 · workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  department text,
  business_unit_id uuid REFERENCES public.business_units(id) ON DELETE SET NULL,
  region text,
  data_residency text,
  template_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived','deleting')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON public.workspaces(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspaces_read ON public.workspaces FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY workspaces_write ON public.workspaces FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_workspaces_touch BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- workspace_members
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_ws ON public.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_members_read ON public.workspace_members FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id) OR user_id = auth.uid());
CREATE POLICY ws_members_write ON public.workspace_members FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));

-- ============================================================
-- T-7 · workspace_quotas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  storage_gb_soft numeric,
  storage_gb_hard numeric,
  users_soft int,
  users_hard int,
  ai_spend_usd_soft numeric,
  ai_spend_usd_hard numeric,
  api_calls_soft bigint,
  api_calls_hard bigint,
  enforcement text NOT NULL DEFAULT 'notify' CHECK (enforcement IN ('notify','block','throttle')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_quotas TO authenticated;
GRANT ALL ON public.workspace_quotas TO service_role;
ALTER TABLE public.workspace_quotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_quotas_read ON public.workspace_quotas FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY ws_quotas_write ON public.workspace_quotas FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_ws_quotas_touch BEFORE UPDATE ON public.workspace_quotas
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-10 · workspace_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE, -- NULL = platform template
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general','department','business_unit','project','industry')),
  description text,
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_templates TO authenticated;
GRANT ALL ON public.workspace_templates TO service_role;
ALTER TABLE public.workspace_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_templates_read ON public.workspace_templates FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.can_read_tenant(tenant_id));
CREATE POLICY ws_templates_write ON public.workspace_templates FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.can_admin_tenant(tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.can_admin_tenant(tenant_id));
CREATE POLICY ws_templates_platform ON public.workspace_templates FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_ws_templates_touch BEFORE UPDATE ON public.workspace_templates
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-11 · teams + team_members
-- ============================================================
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  lead_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_teams_tenant ON public.teams(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_read ON public.teams FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY teams_write ON public.teams FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_teams_touch BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_read ON public.team_members FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id) OR user_id = auth.uid());
CREATE POLICY team_members_write ON public.team_members FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));

-- ============================================================
-- T-13 / T-32 · access review campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS public.access_review_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  scope text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant','workspace','team','role','entitlement')),
  scope_ref uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed','cancelled')),
  starts_at timestamptz,
  due_at timestamptz,
  closed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_review_campaigns TO authenticated;
GRANT ALL ON public.access_review_campaigns TO service_role;
ALTER TABLE public.access_review_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY arc_admin ON public.access_review_campaigns FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_arc_touch BEFORE UPDATE ON public.access_review_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.access_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.access_review_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_role text,
  subject_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision text CHECK (decision IN ('approved','revoked','modified','pending')) DEFAULT 'pending',
  decision_note text,
  decided_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ari_campaign ON public.access_review_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ari_reviewer ON public.access_review_items(reviewer_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_review_items TO authenticated;
GRANT ALL ON public.access_review_items TO service_role;
ALTER TABLE public.access_review_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ari_admin ON public.access_review_items FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id) OR reviewer_id = auth.uid())
  WITH CHECK (public.can_admin_tenant(tenant_id) OR reviewer_id = auth.uid());
CREATE TRIGGER trg_ari_touch BEFORE UPDATE ON public.access_review_items
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-17 · conditional_access_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conditional_access_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  priority int NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb, -- {geo, ip, device_posture, time_windows, risk_score_max, roles}
  action text NOT NULL CHECK (action IN ('allow','deny','step_up','session_limit')),
  action_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_car_tenant ON public.conditional_access_rules(tenant_id, priority);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conditional_access_rules TO authenticated;
GRANT ALL ON public.conditional_access_rules TO service_role;
ALTER TABLE public.conditional_access_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY car_admin ON public.conditional_access_rules FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_car_touch BEFORE UPDATE ON public.conditional_access_rules
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-18 · risk_auth_policies (adaptive auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.risk_auth_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  low_threshold int NOT NULL DEFAULT 30,   -- <= low: allow
  medium_threshold int NOT NULL DEFAULT 60, -- <= med: step-up
  high_threshold int NOT NULL DEFAULT 80,   -- > high: block
  step_up_methods text[] NOT NULL DEFAULT ARRAY['totp','webauthn'],
  block_action text NOT NULL DEFAULT 'deny' CHECK (block_action IN ('deny','challenge','notify_admin')),
  notify_channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_auth_policies TO authenticated;
GRANT ALL ON public.risk_auth_policies TO service_role;
ALTER TABLE public.risk_auth_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY rap_admin ON public.risk_auth_policies FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_rap_touch BEFORE UPDATE ON public.risk_auth_policies
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-22 · secret_access_approvals (n-eyes for vault)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.secret_access_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  secret_id uuid NOT NULL REFERENCES public.app_vault_secrets(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  window_minutes int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired','used')),
  required_approvals int NOT NULL DEFAULT 2,
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  granted_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saa_secret ON public.secret_access_approvals(secret_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secret_access_approvals TO authenticated;
GRANT ALL ON public.secret_access_approvals TO service_role;
ALTER TABLE public.secret_access_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY saa_read ON public.secret_access_approvals FOR SELECT TO authenticated
  USING (public.can_admin_tenant(tenant_id) OR requester_id = auth.uid());
CREATE POLICY saa_insert ON public.secret_access_approvals FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND public.can_read_tenant(tenant_id));
CREATE POLICY saa_update ON public.secret_access_approvals FOR UPDATE TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_saa_touch BEFORE UPDATE ON public.secret_access_approvals
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-23 · secret_rotation_policies
-- ============================================================
CREATE TABLE IF NOT EXISTS public.secret_rotation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  secret_id uuid REFERENCES public.app_vault_secrets(id) ON DELETE CASCADE,
  category text, -- when secret_id NULL, applies to whole category
  rotation_interval_days int NOT NULL DEFAULT 90,
  auto_rotate boolean NOT NULL DEFAULT false,
  provider text, -- e.g., 'aws','gcp','azure','manual'
  next_rotation_at timestamptz,
  last_rotation_at timestamptz,
  alert_days_before int NOT NULL DEFAULT 14,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srp_tenant ON public.secret_rotation_policies(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secret_rotation_policies TO authenticated;
GRANT ALL ON public.secret_rotation_policies TO service_role;
ALTER TABLE public.secret_rotation_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY srp_admin ON public.secret_rotation_policies FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_srp_touch BEFORE UPDATE ON public.secret_rotation_policies
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-26 · tenant_email_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_key text NOT NULL, -- 'invitation','mfa_challenge','password_reset','notification_digest',...
  subject text NOT NULL,
  html_body text NOT NULL,
  text_body text,
  from_name text,
  from_email text,
  reply_to text,
  is_active boolean NOT NULL DEFAULT true,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_key, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_email_templates TO authenticated;
GRANT ALL ON public.tenant_email_templates TO service_role;
ALTER TABLE public.tenant_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tet_admin ON public.tenant_email_templates FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tet_touch BEFORE UPDATE ON public.tenant_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-29 · tenant_notification_channels + preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms','push','inapp','slack','webhook')),
  is_enabled boolean NOT NULL DEFAULT true,
  digest_schedule text CHECK (digest_schedule IN ('realtime','hourly','daily','weekly')) DEFAULT 'realtime',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_notification_channels TO authenticated;
GRANT ALL ON public.tenant_notification_channels TO service_role;
ALTER TABLE public.tenant_notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tnc_read ON public.tenant_notification_channels FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY tnc_write ON public.tenant_notification_channels FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tnc_touch BEFORE UPDATE ON public.tenant_notification_channels
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.tenant_notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['inapp'],
  is_opt_in_required boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_notification_preferences TO authenticated;
GRANT ALL ON public.tenant_notification_preferences TO service_role;
ALTER TABLE public.tenant_notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tnp_admin ON public.tenant_notification_preferences FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tnp_touch BEFORE UPDATE ON public.tenant_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-30 · tenant_maintenance_windows
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  banner_severity text NOT NULL DEFAULT 'info' CHECK (banner_severity IN ('info','warning','critical')),
  block_writes boolean NOT NULL DEFAULT false,
  broadcast_channels text[] NOT NULL DEFAULT ARRAY['inapp'],
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tmw_tenant_time ON public.tenant_maintenance_windows(tenant_id, starts_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_maintenance_windows TO authenticated;
GRANT ALL ON public.tenant_maintenance_windows TO service_role;
ALTER TABLE public.tenant_maintenance_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tmw_read ON public.tenant_maintenance_windows FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY tmw_write ON public.tenant_maintenance_windows FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tmw_touch BEFORE UPDATE ON public.tenant_maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-31 · tenant_compliance_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_compliance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  gdpr_enabled boolean NOT NULL DEFAULT false,
  ccpa_enabled boolean NOT NULL DEFAULT false,
  dora_enabled boolean NOT NULL DEFAULT false,
  pipl_enabled boolean NOT NULL DEFAULT false,
  hipaa_enabled boolean NOT NULL DEFAULT false,
  soc2_enabled boolean NOT NULL DEFAULT true,
  iso27001_enabled boolean NOT NULL DEFAULT false,
  custom_frameworks jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_defaults jsonb NOT NULL DEFAULT '{}'::jsonb, -- retention, residency, notification, etc.
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_compliance_profiles TO authenticated;
GRANT ALL ON public.tenant_compliance_profiles TO service_role;
ALTER TABLE public.tenant_compliance_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcp_read ON public.tenant_compliance_profiles FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY tcp_write ON public.tenant_compliance_profiles FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tcp_touch BEFORE UPDATE ON public.tenant_compliance_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-33 · tenant_policy_compliance (per control status)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_policy_compliance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  control_id text NOT NULL, -- e.g. 'CC6.1','A.9.2.1','DORA-3.2'
  framework text NOT NULL,  -- 'soc2','iso27001','dora','gdpr','ccpa','pipl','hipaa'
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','implemented','tested','failing','expired','waived')),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_tested_at timestamptz,
  next_test_due timestamptz,
  evidence_url text,
  notes text,
  score int, -- 0-100
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, framework, control_id)
);
CREATE INDEX IF NOT EXISTS idx_tpc_tenant ON public.tenant_policy_compliance(tenant_id, framework);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_policy_compliance TO authenticated;
GRANT ALL ON public.tenant_policy_compliance TO service_role;
ALTER TABLE public.tenant_policy_compliance ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpc_admin ON public.tenant_policy_compliance FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tpc_touch BEFORE UPDATE ON public.tenant_policy_compliance
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-2 · tenant_dashboard_scores (rollups: security, compliance, ROI)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_dashboard_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  score_key text NOT NULL, -- 'security','compliance','roi','adoption','renewal_days'
  score_value numeric NOT NULL,
  score_max numeric NOT NULL DEFAULT 100,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, score_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_dashboard_scores TO authenticated;
GRANT ALL ON public.tenant_dashboard_scores TO service_role;
ALTER TABLE public.tenant_dashboard_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tds_read ON public.tenant_dashboard_scores FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY tds_write ON public.tenant_dashboard_scores FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_tds_touch BEFORE UPDATE ON public.tenant_dashboard_scores
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- T-34 · tenant_report_definitions (report library)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('security','ai','users','compliance','usage','cost','custom')),
  description text,
  query_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  format text NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf','csv','xlsx','json')),
  schedule_cron text,
  recipients text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_report_definitions TO authenticated;
GRANT ALL ON public.tenant_report_definitions TO service_role;
ALTER TABLE public.tenant_report_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY trd_read ON public.tenant_report_definitions FOR SELECT TO authenticated USING (public.can_read_tenant(tenant_id));
CREATE POLICY trd_write ON public.tenant_report_definitions FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER trg_trd_touch BEFORE UPDATE ON public.tenant_report_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tenant_admin_touch_updated_at();

-- ============================================================
-- profiles.manager_id (T-12) — hierarchy
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='manager_id') THEN
    ALTER TABLE public.profiles ADD COLUMN manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_profiles_manager ON public.profiles(manager_id);
  END IF;
END $$;
