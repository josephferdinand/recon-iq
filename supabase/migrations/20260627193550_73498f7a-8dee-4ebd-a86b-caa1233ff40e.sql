
CREATE TABLE public.tenant_theme_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  palette_id text NOT NULL DEFAULT 'warm-sand',
  side_chrome_id text NOT NULL DEFAULT 'navy',
  top_chrome_id text NOT NULL DEFAULT 'navy',
  dual_mode boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_theme_settings TO authenticated;
GRANT ALL ON public.tenant_theme_settings TO service_role;

ALTER TABLE public.tenant_theme_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tts_member_read" ON public.tenant_theme_settings
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tts_admin_write" ON public.tenant_theme_settings
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE TRIGGER tenant_theme_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_theme_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
