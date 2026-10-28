
-- 1) tenant_invitations: drop invitee SELECT policy that exposed raw token
DROP POLICY IF EXISTS "invitee can see own invitations via view" ON public.tenant_invitations;

-- 2) rekon_db_connections: restrict SELECT to tenant_admin + platform_admin
DROP POLICY IF EXISTS "tenant writers read db conns" ON public.rekon_db_connections;
CREATE POLICY "tenant admins read db conns" ON public.rekon_db_connections
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

-- Also tighten write/manage policy to admin-only (was analyst+admin)
DROP POLICY IF EXISTS "tenant writers manage db conns" ON public.rekon_db_connections;
CREATE POLICY "tenant admins manage db conns" ON public.rekon_db_connections
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

-- 3) rekon_inline_api_sources: restrict SELECT + manage to tenant_admin
DROP POLICY IF EXISTS "tenant writers read api sources" ON public.rekon_inline_api_sources;
CREATE POLICY "tenant admins read api sources" ON public.rekon_inline_api_sources
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS "tenant writers manage api sources" ON public.rekon_inline_api_sources;
CREATE POLICY "tenant admins manage api sources" ON public.rekon_inline_api_sources
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

-- 4) status_subscribers: enforce email format + rate limit anonymous inserts
CREATE OR REPLACE FUNCTION public.tg_status_subscribers_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_allowed boolean; v_count int; v_retry int;
BEGIN
  -- Email format validation (RFC 5322 simplified)
  IF NEW.email IS NULL OR NEW.email !~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address format' USING ERRCODE = '22023';
  END IF;
  IF length(NEW.email) > 254 THEN
    RAISE EXCEPTION 'Email too long' USING ERRCODE = '22023';
  END IF;

  -- Per-email rate limit: max 5 sign-up attempts per hour
  SELECT allowed, current_count, retry_after_seconds
    INTO v_allowed, v_count, v_retry
  FROM public.rate_limit_hit('status_sub:' || lower(NEW.email), 3600, 5);
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Too many subscription attempts for this email, please try again later'
      USING ERRCODE = '53400';
  END IF;

  NEW.email := lower(NEW.email);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_status_subscribers_validate ON public.status_subscribers;
CREATE TRIGGER tg_status_subscribers_validate
  BEFORE INSERT ON public.status_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.tg_status_subscribers_validate();

REVOKE EXECUTE ON FUNCTION public.tg_status_subscribers_validate() FROM PUBLIC, anon, authenticated;
