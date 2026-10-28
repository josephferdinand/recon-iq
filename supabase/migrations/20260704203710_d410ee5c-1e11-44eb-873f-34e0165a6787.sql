
CREATE OR REPLACE FUNCTION public.is_platform_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_roles
    WHERE user_id = _user_id
      AND role IN ('platform_admin','platform_member')
  )
$$;

DROP POLICY IF EXISTS "Members read their tenants" ON public.tenants;
CREATE POLICY "Members and platform staff read tenants"
  ON public.tenants FOR SELECT TO authenticated
  USING (
    public.is_platform_staff(auth.uid())
    OR public.is_tenant_member(auth.uid(), id)
  );
