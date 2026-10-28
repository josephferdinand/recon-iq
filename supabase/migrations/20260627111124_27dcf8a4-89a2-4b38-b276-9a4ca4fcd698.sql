
-- 1) Create private schema for internal RLS helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- 2) Recreate helper functions in private schema (SECURITY DEFINER preserved)
CREATE OR REPLACE FUNCTION private.has_platform_role(_user_id uuid, _role public.platform_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.platform_roles where user_id = _user_id and role = _role) $$;

CREATE OR REPLACE FUNCTION private.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select private.has_platform_role(_user_id, 'platform_admin') $$;

CREATE OR REPLACE FUNCTION private.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.tenant_members where user_id = _user_id and tenant_id = _tenant_id) $$;

CREATE OR REPLACE FUNCTION private.has_tenant_role(_user_id uuid, _tenant_id uuid, _role public.tenant_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ select exists (select 1 from public.tenant_members where user_id = _user_id and tenant_id = _tenant_id and role = _role) $$;

CREATE OR REPLACE FUNCTION private.user_has_tenant_role_or_group(_user uuid, _tenant uuid, _role public.tenant_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT private.has_tenant_role(_user, _tenant, _role)
    OR EXISTS (
      SELECT 1 FROM public.tenant_group_members gm
        JOIN public.tenant_groups g ON g.id = gm.group_id AND g.tenant_id = _tenant
        JOIN public.tenant_group_roles gr ON gr.group_id = g.id
      WHERE gm.user_id = _user AND gr.role = _role
    )
$$;

CREATE OR REPLACE FUNCTION private.user_can_access_recon(_user uuid, _recon uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH d AS (SELECT tenant_id, visibility FROM public.recon_definitions WHERE id = _recon)
  SELECT
    private.is_platform_admin(_user)
    OR EXISTS (
      SELECT 1 FROM d
      WHERE private.is_tenant_member(_user, d.tenant_id) AND (
        (d.visibility = 'tenant' AND (_perm = 'read'
          OR private.has_tenant_role(_user, d.tenant_id, 'tenant_admin')
          OR (private.has_tenant_role(_user, d.tenant_id, 'tenant_analyst') AND _perm IN ('run','edit','approve'))))
        OR (d.visibility = 'restricted' AND private.has_tenant_role(_user, d.tenant_id, 'tenant_admin'))
        OR EXISTS (SELECT 1 FROM public.recon_permissions rp
            WHERE rp.recon_id = _recon AND rp.principal_type = 'user'
              AND rp.principal_id = _user AND rp.permission = _perm)
        OR EXISTS (SELECT 1 FROM public.recon_permissions rp
            JOIN public.tenant_group_members gm ON gm.group_id = rp.principal_id AND gm.user_id = _user
            WHERE rp.recon_id = _recon AND rp.principal_type = 'group' AND rp.permission = _perm)
      )
    )
$$;

-- 3) Grant EXECUTE on private helpers to authenticated (needed for RLS evaluation)
REVOKE ALL ON FUNCTION private.has_platform_role(uuid, public.platform_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_platform_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_tenant_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_tenant_role(uuid, uuid, public.tenant_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.user_has_tenant_role_or_group(uuid, uuid, public.tenant_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.user_can_access_recon(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.has_platform_role(uuid, public.platform_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_tenant_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_tenant_role(uuid, uuid, public.tenant_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.user_has_tenant_role_or_group(uuid, uuid, public.tenant_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.user_can_access_recon(uuid, uuid, text) TO authenticated, service_role;

-- 4) Rewrite all policies referencing public helpers to use private. prefix
DO $mig$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_roles text;
  fname text;
  fnames text[] := ARRAY['is_platform_admin','has_platform_role','is_tenant_member','has_tenant_role','user_has_tenant_role_or_group','user_can_access_recon'];
  v_sql text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles, permissive
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual ~ '(is_platform_admin|has_platform_role|is_tenant_member|has_tenant_role|user_has_tenant_role_or_group|user_can_access_recon)'
        OR coalesce(with_check,'') ~ '(is_platform_admin|has_platform_role|is_tenant_member|has_tenant_role|user_has_tenant_role_or_group|user_can_access_recon)')
  LOOP
    v_qual := r.qual;
    v_check := r.with_check;
    FOREACH fname IN ARRAY fnames LOOP
      IF v_qual IS NOT NULL THEN
        v_qual := regexp_replace(v_qual, '(^|[^.\w])'||fname||'\(', '\1private.'||fname||'(', 'g');
      END IF;
      IF v_check IS NOT NULL THEN
        v_check := regexp_replace(v_check, '(^|[^.\w])'||fname||'\(', '\1private.'||fname||'(', 'g');
      END IF;
    END LOOP;

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    v_roles := array_to_string(r.roles::text[], ', ');
    IF v_roles IS NULL OR v_roles = '' THEN v_roles := 'public'; END IF;

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      r.policyname, r.schemaname, r.tablename,
      r.permissive, r.cmd, v_roles);
    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || v_qual || ')';
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || v_check || ')';
    END IF;
    EXECUTE v_sql;
  END LOOP;
END
$mig$;

-- 5) Drop the public-schema helper functions (no longer referenced by any policy)
DROP FUNCTION IF EXISTS public.is_platform_admin(uuid);
DROP FUNCTION IF EXISTS public.has_platform_role(uuid, public.platform_role);
DROP FUNCTION IF EXISTS public.is_tenant_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.has_tenant_role(uuid, uuid, public.tenant_role);
DROP FUNCTION IF EXISTS public.user_has_tenant_role_or_group(uuid, uuid, public.tenant_role);
DROP FUNCTION IF EXISTS public.user_can_access_recon(uuid, uuid, text);

-- 6) Tighten ai_model_pricing SELECT to platform admins
DROP POLICY IF EXISTS amp_read ON public.ai_model_pricing;
CREATE POLICY amp_read ON public.ai_model_pricing
  FOR SELECT TO authenticated
  USING (private.is_platform_admin(auth.uid()));

-- 7) Tighten platform_ai_settings SELECT to platform admins
DROP POLICY IF EXISTS pas_read ON public.platform_ai_settings;
CREATE POLICY pas_read ON public.platform_ai_settings
  FOR SELECT TO authenticated
  USING (private.is_platform_admin(auth.uid()));
