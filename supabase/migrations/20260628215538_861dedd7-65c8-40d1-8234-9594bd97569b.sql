
-- ============================================================
-- FVI Per-Tenant Subdomains
-- {slug}.recon-spark.example / {slug}-dev.recon-spark.example / {slug}-sandbox...
-- ============================================================

-- 1. Reserved slugs --------------------------------------------
CREATE TABLE IF NOT EXISTS public.reserved_slugs (
  slug text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reserved_slugs TO authenticated, anon;
GRANT ALL   ON public.reserved_slugs TO service_role;
ALTER TABLE public.reserved_slugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reserved_slugs public read" ON public.reserved_slugs FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.reserved_slugs (slug, reason) VALUES
  ('app','platform host'),('www','marketing'),('api','api host'),('admin','admin host'),
  ('status','status page'),('docs','docs'),('auth','auth flows'),('cdn','cdn'),
  ('mail','mail'),('dev','env suffix'),('staging','env suffix'),('sandbox','env suffix'),
  ('uat','env suffix'),('prod','env suffix'),('preview','env suffix'),('test','env suffix'),
  ('demo','reserved'),('support','reserved'),('help','reserved'),('blog','reserved'),
  ('falcon','brand'),('veritas','brand'),('fvi','brand'),('meta','platform')
ON CONFLICT (slug) DO NOTHING;

-- 2. Tenant environments --------------------------------------
DO $$ BEGIN
  CREATE TYPE public.tenant_env AS ENUM ('prod','dev','sandbox','uat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.tenant_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  env public.tenant_env NOT NULL,
  host text NOT NULL UNIQUE,                 -- e.g. 'jpmc.recon-spark.example'
  is_active boolean NOT NULL DEFAULT true,
  tls_status text NOT NULL DEFAULT 'wildcard' CHECK (tls_status IN ('wildcard','custom','pending','failed')),
  health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','down')),
  last_health_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, env)
);
CREATE INDEX IF NOT EXISTS idx_tenant_envs_tenant ON public.tenant_environments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_envs_host ON public.tenant_environments(host);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_environments TO authenticated;
GRANT ALL ON public.tenant_environments TO service_role;
GRANT SELECT ON public.tenant_environments TO anon;  -- public host resolution
ALTER TABLE public.tenant_environments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_envs public host lookup"
  ON public.tenant_environments FOR SELECT TO anon USING (true);
CREATE POLICY "tenant_envs read by members"
  ON public.tenant_environments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = tenant_environments.tenant_id AND tm.user_id = auth.uid() AND tm.active
  ));
CREATE POLICY "tenant_envs write by tenant_admin"
  ON public.tenant_environments FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = tenant_environments.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = tenant_environments.tenant_id AND tm.user_id = auth.uid()
      AND tm.role::text = 'tenant_admin' AND tm.active
  ));

-- 3. Backfill: any existing tenant gets prod + dev hosts based on slug
INSERT INTO public.tenant_environments (tenant_id, env, host)
SELECT t.id, 'prod'::public.tenant_env, lower(t.slug) || '.recon-spark.example'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_environments e WHERE e.tenant_id = t.id AND e.env = 'prod'
)
ON CONFLICT (host) DO NOTHING;

INSERT INTO public.tenant_environments (tenant_id, env, host)
SELECT t.id, 'dev'::public.tenant_env, lower(t.slug) || '-dev.recon-spark.example'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_environments e WHERE e.tenant_id = t.id AND e.env = 'dev'
)
ON CONFLICT (host) DO NOTHING;

-- 4. Auto-provision trigger on new tenants ----------------------
CREATE OR REPLACE FUNCTION public.tenants_provision_environments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tenant_environments (tenant_id, env, host)
  VALUES (NEW.id, 'prod', lower(NEW.slug) || '.recon-spark.example'),
         (NEW.id, 'dev',  lower(NEW.slug) || '-dev.recon-spark.example')
  ON CONFLICT (host) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_provision_envs ON public.tenants;
CREATE TRIGGER trg_tenants_provision_envs
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_provision_environments();

-- 5. Slug validation: reject reserved slugs on tenant insert/update
CREATE OR REPLACE FUNCTION public.tenants_check_reserved_slug()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reserved_slugs WHERE slug = lower(NEW.slug)) THEN
    RAISE EXCEPTION 'Slug "%" is reserved and cannot be used as a tenant slug', NEW.slug
      USING ERRCODE = '23514';
  END IF;
  IF lower(NEW.slug) !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid slug: must be 2-63 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen'
      USING ERRCODE = '23514';
  END IF;
  IF lower(NEW.slug) LIKE '%-dev' OR lower(NEW.slug) LIKE '%-sandbox'
     OR lower(NEW.slug) LIKE '%-uat' OR lower(NEW.slug) LIKE '%-staging' THEN
    RAISE EXCEPTION 'Slug cannot end with environment suffix (-dev/-sandbox/-uat/-staging)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_reserved_slug ON public.tenants;
CREATE TRIGGER trg_tenants_reserved_slug
  BEFORE INSERT OR UPDATE OF slug ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_check_reserved_slug();

-- 6. Host-resolver function (public, used by edge middleware) ---
CREATE OR REPLACE FUNCTION public.resolve_tenant_from_host(_host text)
RETURNS TABLE (tenant_id uuid, slug text, env public.tenant_env, host text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, e.env, e.host
  FROM public.tenant_environments e
  JOIN public.tenants t ON t.id = e.tenant_id
  WHERE lower(e.host) = lower(_host) AND e.is_active = true
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_tenant_from_host(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_from_host(text) TO authenticated, anon, service_role;
