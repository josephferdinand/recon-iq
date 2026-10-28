-- =============================================================
-- Break-Glass Emergency Access
-- =============================================================

-- Scope enumeration
DO $$ BEGIN
  CREATE TYPE public.break_glass_scope AS ENUM (
    'tenant_data_read',
    'tenant_data_write',
    'tenant_admin_impersonate',
    'secrets_read',
    'billing_admin',
    'audit_export',
    'full_platform'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.break_glass_status AS ENUM ('pending','active','expired','revoked','denied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Policies ----------
CREATE TABLE IF NOT EXISTS public.break_glass_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope public.break_glass_scope NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL,
  max_duration_minutes int NOT NULL DEFAULT 60,
  requires_approval boolean NOT NULL DEFAULT true,
  min_approvers int NOT NULL DEFAULT 1,
  require_step_up boolean NOT NULL DEFAULT true,
  require_incident_ref boolean NOT NULL DEFAULT true,
  notify_channels jsonb NOT NULL DEFAULT '["platform_admin","security_team"]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.break_glass_policies TO authenticated;
GRANT ALL ON public.break_glass_policies TO service_role;
ALTER TABLE public.break_glass_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bg_policies_read_admins" ON public.break_glass_policies
  FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "bg_policies_write_admins" ON public.break_glass_policies
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER bg_policies_updated_at BEFORE UPDATE ON public.break_glass_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- Grants ----------
CREATE TABLE IF NOT EXISTS public.break_glass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_uid text UNIQUE,
  scope public.break_glass_scope NOT NULL,
  status public.break_glass_status NOT NULL DEFAULT 'pending',
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  justification text NOT NULL,
  incident_ref text,
  requested_duration_minutes int NOT NULL CHECK (requested_duration_minutes BETWEEN 5 AND 480),
  activated_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoke_reason text,
  step_up_grant_id uuid REFERENCES public.step_up_grants(id),
  ip_address text,
  user_agent text,
  approver_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.break_glass_grants TO authenticated;
GRANT ALL ON public.break_glass_grants TO service_role;
ALTER TABLE public.break_glass_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bg_grants_read_admins" ON public.break_glass_grants
  FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "bg_grants_insert_admins" ON public.break_glass_grants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()) AND requested_by = auth.uid());
CREATE POLICY "bg_grants_update_admins" ON public.break_glass_grants
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TRIGGER bg_grants_updated_at BEFORE UPDATE ON public.break_glass_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_break_glass_uid()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.grant_uid IS NULL THEN
    NEW.grant_uid := 'BG-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(NEW.id::text,'-',''),1,8);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bg_grants_uid BEFORE INSERT ON public.break_glass_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_break_glass_uid();

CREATE INDEX IF NOT EXISTS idx_bg_grants_status ON public.break_glass_grants(status);
CREATE INDEX IF NOT EXISTS idx_bg_grants_requested_by ON public.break_glass_grants(requested_by);
CREATE INDEX IF NOT EXISTS idx_bg_grants_tenant ON public.break_glass_grants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bg_grants_expires ON public.break_glass_grants(expires_at) WHERE status = 'active';

-- ---------- Approvals (4-eyes) ----------
CREATE TABLE IF NOT EXISTS public.break_glass_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.break_glass_grants(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve','deny')),
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grant_id, approver_user_id)
);
GRANT SELECT, INSERT ON public.break_glass_approvals TO authenticated;
GRANT ALL ON public.break_glass_approvals TO service_role;
ALTER TABLE public.break_glass_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bg_approvals_read_admins" ON public.break_glass_approvals
  FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "bg_approvals_insert_admins" ON public.break_glass_approvals
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()) AND approver_user_id = auth.uid());

-- ---------- Activities (append-only ledger) ----------
CREATE TABLE IF NOT EXISTS public.break_glass_activities (
  id bigserial PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES public.break_glass_grants(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  resource_type text,
  resource_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.break_glass_activities TO authenticated;
GRANT ALL ON public.break_glass_activities TO service_role;
ALTER TABLE public.break_glass_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bg_activities_read_admins" ON public.break_glass_activities
  FOR SELECT TO authenticated USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "bg_activities_insert_admins" ON public.break_glass_activities
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()) AND actor_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.tg_bg_activity_block_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'break_glass_activities is append-only'; END $$;
CREATE TRIGGER bg_activities_no_update BEFORE UPDATE ON public.break_glass_activities
  FOR EACH ROW EXECUTE FUNCTION public.tg_bg_activity_block_mutation();
CREATE TRIGGER bg_activities_no_delete BEFORE DELETE ON public.break_glass_activities
  FOR EACH ROW EXECUTE FUNCTION public.tg_bg_activity_block_mutation();

CREATE INDEX IF NOT EXISTS idx_bg_activities_grant ON public.break_glass_activities(grant_id, occurred_at DESC);

-- ---------- Helper functions ----------

-- Is a user currently in an active break-glass session for a (scope, optional tenant)?
CREATE OR REPLACE FUNCTION public.bg_is_active(_user uuid, _scope public.break_glass_scope, _tenant uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.break_glass_grants
    WHERE requested_by = _user
      AND scope = _scope
      AND status = 'active'
      AND expires_at > now()
      AND (_tenant IS NULL OR tenant_id IS NULL OR tenant_id = _tenant)
  )
$$;
REVOKE ALL ON FUNCTION public.bg_is_active(uuid, public.break_glass_scope, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bg_is_active(uuid, public.break_glass_scope, uuid) TO authenticated, service_role;

-- Auto-expire grants whose expires_at has passed
CREATE OR REPLACE FUNCTION public.bg_expire_grants()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.break_glass_grants
    SET status = 'expired'
    WHERE status = 'active' AND expires_at <= now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.bg_expire_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bg_expire_grants() TO service_role;

-- ---------- Seed policies ----------
INSERT INTO public.break_glass_policies(scope, display_name, description, max_duration_minutes, requires_approval, min_approvers, require_step_up, require_incident_ref)
VALUES
  ('tenant_data_read',         'Tenant Data — Read',          'Read tenant business data (reconciliations, exceptions) for investigation.', 60,  true,  1, true, true),
  ('tenant_data_write',        'Tenant Data — Write',         'Modify tenant business data to remediate a critical incident.',              30,  true,  2, true, true),
  ('tenant_admin_impersonate', 'Tenant Admin Impersonation',  'Act as a tenant administrator to perform a privileged operation.',           45,  true,  2, true, true),
  ('secrets_read',             'Secrets / Credentials',       'View tenant-scoped secrets, BYO-LLM keys, or SSO metadata.',                 30,  true,  2, true, true),
  ('billing_admin',            'Billing / Subscription Admin','Override billing, refunds, or subscription state.',                            60,  true,  1, true, true),
  ('audit_export',             'Audit Log Export',            'Bulk-export audit records for legal hold or regulatory request.',           120,  true,  1, true, true),
  ('full_platform',            'Full Platform Override',      'Cross-tenant platform-wide elevation. Use only for catastrophic incidents.', 30,  true,  2, true, true)
ON CONFLICT (scope) DO NOTHING;