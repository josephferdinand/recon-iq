
-- Thin SECURITY INVOKER wrappers in public delegating to private SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.has_platform_role(_user_id uuid, _role public.platform_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$ select private.has_platform_role(_user_id, _role) $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$ select private.is_platform_admin(_user_id) $$;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$ select private.is_tenant_member(_user_id, _tenant_id) $$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_user_id uuid, _tenant_id uuid, _role public.tenant_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$ select private.has_tenant_role(_user_id, _tenant_id, _role) $$;

CREATE OR REPLACE FUNCTION public.user_has_tenant_role_or_group(_user uuid, _tenant uuid, _role public.tenant_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$ select private.user_has_tenant_role_or_group(_user, _tenant, _role) $$;

CREATE OR REPLACE FUNCTION public.user_can_access_recon(_user uuid, _recon uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$ select private.user_can_access_recon(_user, _recon, _perm) $$;

REVOKE ALL ON FUNCTION public.has_platform_role(uuid, public.platform_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_tenant_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_tenant_role(uuid, uuid, public.tenant_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_tenant_role_or_group(uuid, uuid, public.tenant_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can_access_recon(uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_platform_role(uuid, public.platform_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, uuid, public.tenant_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_tenant_role_or_group(uuid, uuid, public.tenant_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_recon(uuid, uuid, text) TO authenticated, service_role;
