
CREATE TABLE public.tenant_copilot_plugins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plugin_id)
);

CREATE INDEX idx_tenant_copilot_plugins_tenant_enabled
  ON public.tenant_copilot_plugins (tenant_id, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_copilot_plugins TO authenticated;
GRANT ALL ON public.tenant_copilot_plugins TO service_role;

ALTER TABLE public.tenant_copilot_plugins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read copilot plugins"
  ON public.tenant_copilot_plugins
  FOR SELECT
  TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_viewer'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

CREATE POLICY "tenant admins insert copilot plugins"
  ON public.tenant_copilot_plugins
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

CREATE POLICY "tenant admins update copilot plugins"
  ON public.tenant_copilot_plugins
  FOR UPDATE
  TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

CREATE POLICY "tenant admins delete copilot plugins"
  ON public.tenant_copilot_plugins
  FOR DELETE
  TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.is_platform_admin(auth.uid())
  );

CREATE TRIGGER trg_tenant_copilot_plugins_updated_at
  BEFORE UPDATE ON public.tenant_copilot_plugins
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
