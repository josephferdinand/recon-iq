
ALTER TABLE public.tenant_invitations
  ADD COLUMN IF NOT EXISTS token_hash bytea;

UPDATE public.tenant_invitations
  SET token_hash = sha256(convert_to(token, 'UTF8'))
  WHERE token_hash IS NULL AND token IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_invitations_token_hash_idx
  ON public.tenant_invitations(token_hash);

ALTER TABLE public.tenant_invitations DROP COLUMN IF EXISTS token;

CREATE OR REPLACE FUNCTION public.find_invitation_by_token(_token text)
RETURNS TABLE(id uuid, tenant_id uuid, email text, role tenant_role, expires_at timestamptz, accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, i.accepted_at
  FROM public.tenant_invitations i
  WHERE i.token_hash = sha256(convert_to(_token, 'UTF8'))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.find_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_invitation_by_token(text) TO authenticated, anon;

CREATE TABLE IF NOT EXISTS public.tenant_domain_verification (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  verification_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_domain_verification TO authenticated;
GRANT ALL ON public.tenant_domain_verification TO service_role;
ALTER TABLE public.tenant_domain_verification ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tdv_admin_read ON public.tenant_domain_verification;
CREATE POLICY tdv_admin_read ON public.tenant_domain_verification
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS tdv_admin_write ON public.tenant_domain_verification;
CREATE POLICY tdv_admin_write ON public.tenant_domain_verification
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));

INSERT INTO public.tenant_domain_verification (tenant_id, verification_token)
  SELECT id, domain_verification_token FROM public.tenants
  WHERE domain_verification_token IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.tenants DROP COLUMN IF EXISTS domain_verification_token;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='reporting_db_exports' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reporting_db_exports', r.policyname);
  END LOOP;
END $$;

CREATE POLICY rde_read ON public.reporting_db_exports
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));

CREATE POLICY rde_write ON public.reporting_db_exports
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));
