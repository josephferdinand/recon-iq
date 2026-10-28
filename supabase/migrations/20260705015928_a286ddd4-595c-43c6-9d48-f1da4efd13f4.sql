-- 1. Backfill: every current platform_admin also becomes platform_super_admin
INSERT INTO public.platform_roles (user_id, role, granted_by, granted_at)
SELECT user_id, 'platform_super_admin'::platform_role, user_id, now()
FROM public.platform_roles
WHERE role = 'platform_admin'
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Private helper (SECURITY DEFINER, bypasses RLS on platform_roles)
CREATE OR REPLACE FUNCTION private.is_platform_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT private.has_platform_role(_user_id, 'platform_super_admin'::platform_role)
$$;

-- 3. Public wrapper for RPC callers
CREATE OR REPLACE FUNCTION public.is_platform_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$ SELECT private.is_platform_super_admin(_user_id) $$;

REVOKE ALL ON FUNCTION public.is_platform_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_super_admin(uuid) TO authenticated, service_role;