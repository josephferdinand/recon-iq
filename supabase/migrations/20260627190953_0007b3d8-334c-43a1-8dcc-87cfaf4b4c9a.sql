
CREATE TABLE public.tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  logo_url text,
  primary_hex text NOT NULL DEFAULT '#3B2A1F',
  accent_hex text NOT NULL DEFAULT '#C9A24B',
  surface_hex text NOT NULL DEFAULT '#F5EFE3',
  ink_hex text NOT NULL DEFAULT '#1A120B',
  headline text,
  tagline text,
  support_email text,
  support_url text,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_branding_primary_hex_chk CHECK (primary_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT tenant_branding_accent_hex_chk  CHECK (accent_hex  ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT tenant_branding_surface_hex_chk CHECK (surface_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT tenant_branding_ink_hex_chk     CHECK (ink_hex     ~* '^#[0-9a-f]{6}$')
);

GRANT SELECT ON public.tenant_branding TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_branding TO authenticated;
GRANT ALL ON public.tenant_branding TO service_role;

ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

-- Public can read only enabled branding (powers /t/{slug}/auth)
CREATE POLICY "tenant_branding_public_read_enabled"
  ON public.tenant_branding FOR SELECT
  TO anon, authenticated
  USING (enabled = true);

-- Tenant admins (or platform admins) manage their tenant's branding
CREATE POLICY "tenant_branding_admin_manage"
  ON public.tenant_branding FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );

CREATE TRIGGER tenant_branding_set_updated_at
  BEFORE UPDATE ON public.tenant_branding
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
