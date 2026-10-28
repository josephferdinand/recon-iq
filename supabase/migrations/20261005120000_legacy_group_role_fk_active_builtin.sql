CREATE OR REPLACE FUNCTION private.user_has_tenant_role_or_group(_user uuid, _tenant uuid, _role tenant_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member
    WHERE member.user_id = _user AND member.tenant_id = _tenant
      AND member.active IS TRUE
  ) AND (
    private.has_tenant_role(_user, _tenant, _role)
    OR EXISTS (
      SELECT 1 FROM public.tenant_group_members gm
        JOIN public.tenant_groups g ON g.id = gm.group_id AND g.tenant_id = _tenant
        JOIN public.tenant_group_roles gr ON gr.group_id = g.id
        JOIN public.rbac_roles rr ON rr.id = gr.role_id
      WHERE gm.user_id = _user AND rr.is_system IS TRUE
        AND rr.tenant_id IS NULL AND rr.key = _role::text
    )
  )
$function$
