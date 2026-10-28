
CREATE TABLE IF NOT EXISTS public.tenant_custom_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  env public.tenant_env NOT NULL DEFAULT 'prod',
  host text NOT NULL,
  verification_token text NOT NULL DEFAULT ('fvi-verify-' || encode(gen_random_bytes(16), 'hex')),
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','failed','revoked')),
  verified_at timestamptz,
  tls_status text NOT NULL DEFAULT 'pending'
    CHECK (tls_status IN ('pending','provisioning','active','failed','revoked')),
  tls_provisioned_at timestamptz,
  health_status text NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown','healthy','degraded','down')),
  last_health_check_at timestamptz,
  last_verification_check_at timestamptz,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_custom_domains_host_unique UNIQUE (host),
  CONSTRAINT tenant_custom_domains_host_format
    CHECK (host ~* '^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  CONSTRAINT tenant_custom_domains_not_apex
    CHECK (host NOT LIKE '%.recon-spark.example' AND host <> 'recon-spark.example')
);

CREATE INDEX IF NOT EXISTS idx_tenant_custom_domains_tenant ON public.tenant_custom_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_custom_domains_status ON public.tenant_custom_domains(verification_status, tls_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_custom_domains TO authenticated;
GRANT SELECT ON public.tenant_custom_domains TO anon;
GRANT ALL ON public.tenant_custom_domains TO service_role;

ALTER TABLE public.tenant_custom_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_domains anon read verified"
  ON public.tenant_custom_domains FOR SELECT TO anon
  USING (verification_status = 'verified');

CREATE POLICY "custom_domains members read"
  ON public.tenant_custom_domains FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = tenant_custom_domains.tenant_id
      AND tm.user_id = auth.uid() AND tm.active
  ));

CREATE POLICY "custom_domains admin write"
  ON public.tenant_custom_domains FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = tenant_custom_domains.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = tenant_custom_domains.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));

CREATE OR REPLACE FUNCTION public.tenant_custom_domains_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_tenant_custom_domains_touch ON public.tenant_custom_domains;
CREATE TRIGGER trg_tenant_custom_domains_touch
  BEFORE UPDATE ON public.tenant_custom_domains
  FOR EACH ROW EXECUTE FUNCTION public.tenant_custom_domains_touch();

DROP FUNCTION IF EXISTS public.resolve_tenant_from_host(text);
CREATE OR REPLACE FUNCTION public.resolve_tenant_from_host(_host text)
RETURNS TABLE (
  tenant_id uuid,
  slug text,
  env public.tenant_env,
  host text,
  source text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT t.id AS tenant_id, t.slug, e.env, e.host, 'subdomain'::text AS source
    FROM public.tenant_environments e
    JOIN public.tenants t ON t.id = e.tenant_id
    WHERE lower(e.host) = lower(_host) AND e.is_active = true
    UNION ALL
    SELECT t.id AS tenant_id, t.slug, d.env, d.host, 'custom'::text AS source
    FROM public.tenant_custom_domains d
    JOIN public.tenants t ON t.id = d.tenant_id
    WHERE lower(d.host) = lower(_host)
      AND d.verification_status = 'verified'
  ) r
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_tenant_from_host(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_from_host(text) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.mark_custom_domain_verified(_id uuid, _verified boolean)
RETURNS public.tenant_custom_domains
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.tenant_custom_domains;
BEGIN
  UPDATE public.tenant_custom_domains
     SET verification_status = CASE WHEN _verified THEN 'verified' ELSE 'failed' END,
         verified_at         = CASE WHEN _verified THEN now() ELSE verified_at END,
         tls_status          = CASE WHEN _verified AND tls_status='pending' THEN 'provisioning' ELSE tls_status END,
         last_verification_check_at = now()
   WHERE id = _id
   RETURNING * INTO r;
  RETURN r;
END $$;

REVOKE EXECUTE ON FUNCTION public.mark_custom_domain_verified(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_custom_domain_verified(uuid, boolean) TO authenticated, service_role;
