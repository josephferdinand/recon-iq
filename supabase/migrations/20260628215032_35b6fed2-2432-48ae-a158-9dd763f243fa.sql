
-- ============================================================
-- FVI RBAC Foundation
-- Permissions, custom roles, multi-scope grants, SoD, last-owner protection
-- Additive: existing tenant_members.role enum remains the source of truth for
-- legacy code paths; new code consults has_permission() resolved via grants.
-- ============================================================

-- 1. Permission catalog ---------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  id text PRIMARY KEY,                       -- e.g. 'recon.definition.publish'
  resource text NOT NULL,                    -- 'recon.definition'
  action text NOT NULL,                      -- 'publish'
  description text NOT NULL,
  category text NOT NULL,                    -- 'recon' | 'admin' | 'security' | 'ai' | 'data' | 'audit' | 'billing' | 'support'
  is_dangerous boolean NOT NULL DEFAULT false,
  requires_step_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL    ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "permissions readable by authenticated"
  ON public.permissions FOR SELECT TO authenticated USING (true);

-- 2. Roles (system + custom per tenant) -----------------------
CREATE TABLE IF NOT EXISTS public.rbac_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,  -- null = system role
  key text NOT NULL,                         -- e.g. 'tenant_owner', 'custom_xyz'
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_assignable boolean NOT NULL DEFAULT true,
  cloned_from uuid REFERENCES public.rbac_roles(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_rbac_roles_tenant ON public.rbac_roles(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rbac_roles TO authenticated;
GRANT ALL ON public.rbac_roles TO service_role;
ALTER TABLE public.rbac_roles ENABLE ROW LEVEL SECURITY;

-- 3. Role -> Permission mapping -------------------------------
CREATE TABLE IF NOT EXISTS public.rbac_role_permissions (
  role_id uuid NOT NULL REFERENCES public.rbac_roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
GRANT SELECT, INSERT, DELETE ON public.rbac_role_permissions TO authenticated;
GRANT ALL ON public.rbac_role_permissions TO service_role;
ALTER TABLE public.rbac_role_permissions ENABLE ROW LEVEL SECURITY;

-- 4. Scope enum + user grants ---------------------------------
DO $$ BEGIN
  CREATE TYPE public.rbac_scope_type AS ENUM ('tenant','business_unit','recon_definition','data_source');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.rbac_user_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.rbac_roles(id) ON DELETE CASCADE,
  scope_type public.rbac_scope_type NOT NULL DEFAULT 'tenant',
  scope_id uuid,                             -- null when scope_type='tenant'
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  reason text,
  CONSTRAINT rbac_scope_id_consistency CHECK (
    (scope_type = 'tenant' AND scope_id IS NULL) OR
    (scope_type <> 'tenant' AND scope_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS rbac_grants_unique_active
  ON public.rbac_user_grants(tenant_id, user_id, role_id, scope_type, COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rbac_grants_user ON public.rbac_user_grants(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rbac_grants_tenant ON public.rbac_user_grants(tenant_id) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.rbac_user_grants TO authenticated;
GRANT ALL ON public.rbac_user_grants TO service_role;
ALTER TABLE public.rbac_user_grants ENABLE ROW LEVEL SECURITY;

-- 5. Separation-of-Duties conflict rules ----------------------
CREATE TABLE IF NOT EXISTS public.rbac_sod_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,  -- null = platform-wide
  name text NOT NULL,
  description text,
  permission_a text NOT NULL REFERENCES public.permissions(id),
  permission_b text NOT NULL REFERENCES public.permissions(id),
  same_scope_only boolean NOT NULL DEFAULT true,
  severity text NOT NULL DEFAULT 'block' CHECK (severity IN ('warn','block')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rbac_sod_rules TO authenticated;
GRANT ALL ON public.rbac_sod_rules TO service_role;
ALTER TABLE public.rbac_sod_rules ENABLE ROW LEVEL SECURITY;

-- 6. Revoked sessions (used for suspend/offboard) -------------
CREATE TABLE IF NOT EXISTS public.rbac_session_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES auth.users(id),
  reason text
);
CREATE INDEX IF NOT EXISTS idx_rbac_sess_revoke_user ON public.rbac_session_revocations(user_id, revoked_at DESC);
GRANT SELECT, INSERT ON public.rbac_session_revocations TO authenticated;
GRANT ALL ON public.rbac_session_revocations TO service_role;
ALTER TABLE public.rbac_session_revocations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Core resolver: has_permission(user, permission, scope_type, scope_id, tenant)
-- SECURITY DEFINER so RLS policies can call it without recursion.
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_permission(
  _user_id uuid,
  _permission text,
  _tenant_id uuid,
  _scope_type public.rbac_scope_type DEFAULT 'tenant',
  _scope_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rbac_user_grants g
    JOIN public.rbac_role_permissions rp ON rp.role_id = g.role_id
    WHERE g.user_id = _user_id
      AND g.tenant_id = _tenant_id
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND rp.permission_id = _permission
      AND (
        -- Tenant-wide grant covers any scope
        g.scope_type = 'tenant'
        -- Exact scope match
        OR (g.scope_type = _scope_type AND g.scope_id = _scope_id)
        -- BU grant inherits down (via ltree)
        OR (g.scope_type = 'business_unit' AND _scope_type = 'business_unit'
            AND EXISTS (
              SELECT 1 FROM public.business_units child
              JOIN public.business_units parent ON parent.id = g.scope_id
              WHERE child.id = _scope_id
                AND child.tenant_id = _tenant_id
                AND child.path <@ parent.path
            ))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid,text,uuid,public.rbac_scope_type,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid,text,uuid,public.rbac_scope_type,uuid) TO authenticated, service_role;

-- ============================================================
-- Last-owner protection: cannot remove or deactivate final tenant_owner
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_last_tenant_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_remaining int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
    IF OLD.role::text <> 'tenant_admin' THEN RETURN OLD; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_tenant := NEW.tenant_id;
    -- Only fire if losing admin status or being deactivated
    IF NEW.active = OLD.active AND NEW.role = OLD.role THEN RETURN NEW; END IF;
    IF OLD.role::text <> 'tenant_admin' THEN RETURN NEW; END IF;
  END IF;

  SELECT count(*) INTO v_remaining
  FROM public.tenant_members
  WHERE tenant_id = v_tenant
    AND role::text = 'tenant_admin'
    AND active = true
    AND id <> COALESCE(NEW.id, OLD.id);

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'Cannot remove last active tenant_admin for tenant %', v_tenant
      USING ERRCODE = '23514', HINT = 'Promote another member to tenant_admin first.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_last_owner_del ON public.tenant_members;
CREATE TRIGGER trg_guard_last_owner_del
  BEFORE DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_tenant_owner();

DROP TRIGGER IF EXISTS trg_guard_last_owner_upd ON public.tenant_members;
CREATE TRIGGER trg_guard_last_owner_upd
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_tenant_owner();

-- ============================================================
-- SoD enforcement on grant insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_sod_on_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT s.name, s.permission_a, s.permission_b, s.severity
    FROM public.rbac_sod_rules s
    WHERE (s.tenant_id IS NULL OR s.tenant_id = NEW.tenant_id)
      AND EXISTS (
        SELECT 1 FROM public.rbac_role_permissions rp
        WHERE rp.role_id = NEW.role_id AND rp.permission_id = s.permission_a
      )
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.rbac_user_grants g2
      JOIN public.rbac_role_permissions rp2 ON rp2.role_id = g2.role_id
      WHERE g2.user_id = NEW.user_id
        AND g2.tenant_id = NEW.tenant_id
        AND g2.revoked_at IS NULL
        AND rp2.permission_id = r.permission_b
    ) THEN
      IF r.severity = 'block' THEN
        RAISE EXCEPTION 'SoD violation: % (permissions % and %)', r.name, r.permission_a, r.permission_b
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rbac_sod ON public.rbac_user_grants;
CREATE TRIGGER trg_rbac_sod
  BEFORE INSERT ON public.rbac_user_grants
  FOR EACH ROW WHEN (NEW.revoked_at IS NULL)
  EXECUTE FUNCTION public.enforce_sod_on_grant();

-- ============================================================
-- RLS policies for rbac_* (tenant-scoped reads, admin writes)
-- ============================================================
CREATE POLICY "roles readable in tenant"
  ON public.rbac_roles FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_roles.tenant_id AND tm.user_id = auth.uid() AND tm.active
  ));
CREATE POLICY "roles writable by tenant_admin"
  ON public.rbac_roles FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_roles.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ))
  WITH CHECK (tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_roles.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));

CREATE POLICY "role_perms readable in tenant"
  ON public.rbac_role_permissions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rbac_roles r
    WHERE r.id = rbac_role_permissions.role_id
      AND (r.tenant_id IS NULL OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = r.tenant_id AND tm.user_id = auth.uid() AND tm.active
      ))
  ));
CREATE POLICY "role_perms writable by tenant_admin"
  ON public.rbac_role_permissions FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rbac_roles r
    JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
    WHERE r.id = rbac_role_permissions.role_id
      AND r.tenant_id IS NOT NULL
      AND tm.user_id = auth.uid() AND tm.role::text = 'tenant_admin' AND tm.active
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.rbac_roles r
    JOIN public.tenant_members tm ON tm.tenant_id = r.tenant_id
    WHERE r.id = rbac_role_permissions.role_id
      AND r.tenant_id IS NOT NULL
      AND tm.user_id = auth.uid() AND tm.role::text = 'tenant_admin' AND tm.active
  ));

CREATE POLICY "grants readable in tenant"
  ON public.rbac_user_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_user_grants.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));
CREATE POLICY "grants writable by tenant_admin"
  ON public.rbac_user_grants FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_user_grants.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));
CREATE POLICY "grants updatable by tenant_admin"
  ON public.rbac_user_grants FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_user_grants.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));

CREATE POLICY "sod readable in tenant"
  ON public.rbac_sod_rules FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_sod_rules.tenant_id AND tm.user_id = auth.uid() AND tm.active
  ));
CREATE POLICY "sod writable by tenant_admin"
  ON public.rbac_sod_rules FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_sod_rules.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ))
  WITH CHECK (tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_sod_rules.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));

CREATE POLICY "session_revocations readable by self or admin"
  ON public.rbac_session_revocations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_session_revocations.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));
CREATE POLICY "session_revocations writable by tenant_admin"
  ON public.rbac_session_revocations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_session_revocations.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));

-- ============================================================
-- Seed: 80 canonical permissions + 11 system roles
-- ============================================================
INSERT INTO public.permissions (id, resource, action, description, category, is_dangerous, requires_step_up) VALUES
-- Recon
('recon.definition.read',    'recon.definition', 'read',    'View reconciliation definitions',    'recon', false, false),
('recon.definition.create',  'recon.definition', 'create',  'Create reconciliation definitions',  'recon', false, false),
('recon.definition.update',  'recon.definition', 'update',  'Edit reconciliation definitions',    'recon', false, false),
('recon.definition.publish', 'recon.definition', 'publish', 'Publish recon definition versions',  'recon', true,  false),
('recon.definition.delete',  'recon.definition', 'delete',  'Delete reconciliation definitions',  'recon', true,  true),
('recon.run.execute',        'recon.run',        'execute', 'Trigger recon runs',                 'recon', false, false),
('recon.run.cancel',         'recon.run',        'cancel',  'Cancel in-flight recon runs',        'recon', false, false),
('recon.match.approve',      'recon.match',      'approve', 'Approve proposed matches',           'recon', false, false),
('recon.match.bulk_approve', 'recon.match',      'bulk_approve','Bulk-approve matches',           'recon', true,  false),
('recon.match.manual',       'recon.match',      'manual',  'Create manual matches',              'recon', false, false),
('break.read',               'break',            'read',    'View breaks',                        'recon', false, false),
('break.update',             'break',            'update',  'Edit break details/notes',           'recon', false, false),
('break.assign',             'break',            'assign',  'Assign breaks',                      'recon', false, false),
('break.resolve',            'break',            'resolve', 'Resolve individual breaks',          'recon', false, false),
('break.bulk_resolve',       'break',            'bulk_resolve','Bulk-resolve breaks',            'recon', true,  false),
('break.reopen',             'break',            'reopen',  'Reopen resolved breaks',             'recon', false, false),
('signoff.submit',           'signoff',          'submit',  'Submit EOD signoff',                 'recon', false, false),
('signoff.approve',          'signoff',          'approve', '4-eyes approve EOD signoff',         'recon', true,  false),
-- Data
('data.source.read',         'data.source',      'read',    'View data sources/connectors',       'data',  false, false),
('data.source.create',       'data.source',      'create',  'Create data sources/connectors',     'data',  false, false),
('data.source.update',       'data.source',      'update',  'Edit data sources/connectors',       'data',  false, false),
('data.source.delete',       'data.source',      'delete',  'Delete data sources/connectors',     'data',  true,  true),
('data.upload',              'data',             'upload',  'Upload data files',                  'data',  false, false),
('data.prep.read',           'data.prep',        'read',    'View data prep pipelines',           'data',  false, false),
('data.prep.author',         'data.prep',        'author',  'Create/edit data prep pipelines',    'data',  false, false),
('data.prep.promote',        'data.prep',        'promote', 'Promote staged pipelines to prod',   'data',  true,  true),
('data.lineage.read',        'data.lineage',     'read',    'View data lineage',                  'data',  false, false),
-- Reference data
('reference.read',           'reference',        'read',    'View reference data tables',         'data',  false, false),
('reference.update',         'reference',        'update',  'Edit reference data tables',         'data',  false, false),
-- AI
('ai.copilot.use',           'ai.copilot',       'use',     'Use Copilot chat',                   'ai',    false, false),
('ai.agent.run',             'ai.agent',         'run',     'Run agentic AI actions',             'ai',    false, false),
('ai.agent.configure',       'ai.agent',         'configure','Configure agent policies',          'ai',    true,  false),
('ai.budget.read',           'ai.budget',        'read',    'View AI budgets',                    'ai',    false, false),
('ai.budget.update',         'ai.budget',        'update',  'Set AI budgets',                     'ai',    true,  false),
('ai.model.configure',       'ai.model',         'configure','Configure AI models / providers',   'ai',    true,  true),
('aidp.document.read',       'aidp.document',    'read',    'View AIDP documents',                'ai',    false, false),
('aidp.document.upload',     'aidp.document',    'upload',  'Upload AIDP documents',              'ai',    false, false),
('aidp.template.author',     'aidp.template',    'author',  'Author AIDP templates',              'ai',    false, false),
('aidp.training.run',        'aidp.training',    'run',     'Train AIDP models',                  'ai',    true,  false),
-- Admin
('tenant.settings.read',     'tenant.settings',  'read',    'View tenant settings',               'admin', false, false),
('tenant.settings.update',   'tenant.settings',  'update',  'Edit tenant settings',               'admin', true,  false),
('tenant.branding.update',   'tenant.branding',  'update',  'Edit tenant branding/theme',         'admin', false, false),
('tenant.domain.manage',     'tenant.domain',    'manage',  'Manage tenant subdomain/custom domain','admin',true, true),
('tenant.bu.read',           'tenant.bu',        'read',    'View business units',                'admin', false, false),
('tenant.bu.manage',         'tenant.bu',        'manage',  'Create/edit business units',         'admin', false, false),
('tenant.user.read',         'tenant.user',      'read',    'View tenant users',                  'admin', false, false),
('tenant.user.invite',       'tenant.user',      'invite',  'Invite users to tenant',             'admin', false, false),
('tenant.user.suspend',      'tenant.user',      'suspend', 'Suspend/reactivate users',           'admin', true,  true),
('tenant.user.offboard',     'tenant.user',      'offboard','Permanently deactivate users',       'admin', true,  true),
('tenant.role.read',         'tenant.role',      'read',    'View roles',                         'admin', false, false),
('tenant.role.manage',       'tenant.role',      'manage',  'Create/edit custom roles',           'admin', true,  true),
('tenant.role.grant',        'tenant.role',      'grant',   'Grant roles to users',               'admin', true,  true),
-- Security
('security.mfa.enforce',     'security.mfa',     'enforce', 'Enforce MFA policy',                 'security', true, true),
('security.sso.configure',   'security.sso',     'configure','Configure SSO/SAML',                'security', true, true),
('security.ip.manage',       'security.ip',      'manage',  'Manage IP allowlist',                'security', true, true),
('security.byok.read',       'security.byok',    'read',    'View BYOK keys',                     'security', false, false),
('security.byok.manage',     'security.byok',    'manage',  'Manage BYOK / CMEK keys',            'security', true, true),
('security.dlp.manage',      'security.dlp',     'manage',  'Manage DLP policies',                'security', true, true),
('security.break_glass.request','security.break_glass','request','Request break-glass access',    'security', true, true),
('security.break_glass.approve','security.break_glass','approve','Approve break-glass access',    'security', true, true),
-- Audit & compliance
('audit.log.read',           'audit.log',        'read',    'View audit log',                     'audit', false, false),
('audit.log.export',         'audit.log',        'export',  'Export audit log',                   'audit', true,  false),
('audit.anchor.verify',      'audit.anchor',     'verify',  'Verify audit hash chain',            'audit', false, false),
('compliance.evidence.read', 'compliance.evidence','read',  'View compliance evidence',           'audit', false, false),
('compliance.evidence.generate','compliance.evidence','generate','Generate evidence bundles',     'audit', false, false),
('compliance.retention.manage','compliance.retention','manage','Manage retention policies',       'audit', true,  true),
('compliance.access_review.attest','compliance.access_review','attest','Attest access reviews',   'audit', false, false),
-- Billing
('billing.read',             'billing',          'read',    'View subscription/billing',          'billing', false, false),
('billing.manage',           'billing',          'manage',  'Manage subscription/billing',        'billing', true,  true),
-- Support
('support.ticket.read',      'support.ticket',   'read',    'View support tickets',               'support', false, false),
('support.ticket.create',    'support.ticket',   'create',  'Create support tickets',             'support', false, false),
('support.ticket.respond',   'support.ticket',   'respond', 'Respond to tickets as agent',        'support', false, false),
-- API/integration
('api.token.read',           'api.token',        'read',    'View API tokens',                    'admin', false, false),
('api.token.create',         'api.token',        'create',  'Create API tokens',                  'admin', true,  true),
('api.token.revoke',         'api.token',        'revoke',  'Revoke API tokens',                  'admin', true,  false),
('webhook.manage',           'webhook',          'manage',  'Manage webhook subscriptions',       'admin', false, false),
('marketplace.install',      'marketplace',      'install', 'Install marketplace packages',       'admin', false, false),
('navigator.kb.author',      'navigator.kb',     'author',  'Author Navigator KB articles',       'admin', false, false)
ON CONFLICT (id) DO NOTHING;

-- System roles (tenant_id IS NULL => global templates) ---------
INSERT INTO public.rbac_roles (id, tenant_id, key, name, description, is_system, is_assignable) VALUES
('11111111-0000-0000-0000-000000000001'::uuid, NULL, 'tenant_owner',      'Tenant Owner',      'Full tenant control including billing. 1-2 per tenant.', true, true),
('11111111-0000-0000-0000-000000000002'::uuid, NULL, 'tenant_admin',      'Tenant Admin',      'Tenant administration excluding billing.', true, true),
('11111111-0000-0000-0000-000000000003'::uuid, NULL, 'security_admin',    'Security Admin',    'Security, SSO, MFA, audit, BYOK.', true, true),
('11111111-0000-0000-0000-000000000004'::uuid, NULL, 'compliance_officer','Compliance Officer','Read-only audit and compliance evidence.', true, true),
('11111111-0000-0000-0000-000000000005'::uuid, NULL, 'recon_manager',     'Recon Manager',     'Manage recons in assigned BUs; 4-eyes approver.', true, true),
('11111111-0000-0000-0000-000000000006'::uuid, NULL, 'recon_operator',    'Recon Operator',    'Run recons and work breaks.', true, true),
('11111111-0000-0000-0000-000000000007'::uuid, NULL, 'recon_viewer',      'Recon Viewer',      'Read-only access across assigned scope.', true, true),
('11111111-0000-0000-0000-000000000008'::uuid, NULL, 'data_engineer',     'Data Engineer',     'Manage connectors, pipelines, schemas.', true, true),
('11111111-0000-0000-0000-000000000009'::uuid, NULL, 'ai_steward',        'AI Steward',        'AI budgets, model governance, prompt review.', true, true),
('1111111a-0000-0000-0000-000000000010'::uuid, NULL, 'support_agent',     'Support Agent',     'Helpdesk: tickets and read-only context.', true, true),
('1111111b-0000-0000-0000-000000000011'::uuid, NULL, 'api_service',       'API Service Account','Programmatic access, no UI.', true, true)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- Role -> permission seeding (compact mapping) ----------------
-- Helper macro pattern via WITH ... INSERT
WITH role_perms AS (
  SELECT '11111111-0000-0000-0000-000000000001'::uuid AS role_id, p.id AS permission_id FROM public.permissions p  -- owner: everything
  UNION ALL SELECT '11111111-0000-0000-0000-000000000002'::uuid, p.id FROM public.permissions p WHERE p.id <> 'billing.manage'  -- admin: all except billing.manage
  UNION ALL SELECT '11111111-0000-0000-0000-000000000003'::uuid, p.id FROM public.permissions p WHERE p.category IN ('security','audit') OR p.id IN ('tenant.user.read','tenant.role.read','audit.log.read','audit.log.export')
  UNION ALL SELECT '11111111-0000-0000-0000-000000000004'::uuid, p.id FROM public.permissions p WHERE p.category='audit' OR p.id IN ('tenant.user.read','tenant.settings.read','compliance.evidence.read','compliance.evidence.generate','compliance.access_review.attest','recon.definition.read','break.read','data.lineage.read')
  UNION ALL SELECT '11111111-0000-0000-0000-000000000005'::uuid, p.id FROM public.permissions p WHERE p.id IN ('recon.definition.read','recon.definition.create','recon.definition.update','recon.definition.publish','recon.run.execute','recon.run.cancel','recon.match.approve','recon.match.bulk_approve','recon.match.manual','break.read','break.update','break.assign','break.resolve','break.bulk_resolve','break.reopen','signoff.submit','signoff.approve','data.source.read','data.upload','data.prep.read','data.lineage.read','reference.read','reference.update','tenant.bu.read','tenant.user.read','tenant.role.read','ai.copilot.use','ai.agent.run','audit.log.read','support.ticket.create','support.ticket.read','aidp.document.read','aidp.document.upload')
  UNION ALL SELECT '11111111-0000-0000-0000-000000000006'::uuid, p.id FROM public.permissions p WHERE p.id IN ('recon.definition.read','recon.run.execute','recon.match.approve','recon.match.manual','break.read','break.update','break.assign','break.resolve','break.reopen','signoff.submit','data.source.read','data.upload','data.prep.read','reference.read','tenant.bu.read','ai.copilot.use','ai.agent.run','support.ticket.create','aidp.document.read','aidp.document.upload')
  UNION ALL SELECT '11111111-0000-0000-0000-000000000007'::uuid, p.id FROM public.permissions p WHERE p.action='read' OR p.id IN ('ai.copilot.use','support.ticket.create')
  UNION ALL SELECT '11111111-0000-0000-0000-000000000008'::uuid, p.id FROM public.permissions p WHERE p.id IN ('data.source.read','data.source.create','data.source.update','data.source.delete','data.upload','data.prep.read','data.prep.author','data.prep.promote','data.lineage.read','reference.read','reference.update','webhook.manage','api.token.read','api.token.create','api.token.revoke','recon.definition.read','tenant.bu.read','ai.copilot.use','support.ticket.create','aidp.document.upload','aidp.template.author')
  UNION ALL SELECT '11111111-0000-0000-0000-000000000009'::uuid, p.id FROM public.permissions p WHERE p.category='ai' OR p.id IN ('audit.log.read','tenant.settings.read','support.ticket.create')
  UNION ALL SELECT '1111111a-0000-0000-0000-000000000010'::uuid, p.id FROM public.permissions p WHERE p.category='support' OR p.id IN ('tenant.user.read','recon.definition.read','break.read','audit.log.read')
  UNION ALL SELECT '1111111b-0000-0000-0000-000000000011'::uuid, p.id FROM public.permissions p WHERE p.id IN ('recon.definition.read','recon.run.execute','break.read','data.source.read','data.upload','api.token.read','webhook.manage')
)
INSERT INTO public.rbac_role_permissions (role_id, permission_id)
SELECT role_id, permission_id FROM role_perms
ON CONFLICT DO NOTHING;

-- Seed SoD rules (platform-wide) ------------------------------
INSERT INTO public.rbac_sod_rules (id, tenant_id, name, description, permission_a, permission_b, severity)
VALUES
  (gen_random_uuid(), NULL, 'SoD: cannot submit & approve own signoff', 'Same user cannot both submit and approve EOD signoff', 'signoff.submit', 'signoff.approve', 'block'),
  (gen_random_uuid(), NULL, 'SoD: cannot author and promote data prep',  'Same user cannot author and promote data prep pipelines', 'data.prep.author', 'data.prep.promote', 'block'),
  (gen_random_uuid(), NULL, 'SoD: cannot request and approve break-glass','Same user cannot request and approve break-glass',       'security.break_glass.request', 'security.break_glass.approve', 'block')
ON CONFLICT DO NOTHING;
