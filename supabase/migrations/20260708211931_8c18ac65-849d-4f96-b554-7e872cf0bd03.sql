
CREATE TABLE IF NOT EXISTS public.scim_provisioning_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  auto_deprovision BOOLEAN NOT NULL DEFAULT true,
  default_role TEXT NOT NULL DEFAULT 'tenant_member',
  base_url_override TEXT,
  attribute_mapping JSONB NOT NULL DEFAULT jsonb_build_object(
    'userName',      'userName',
    'email',         'emails[primary].value',
    'givenName',     'name.givenName',
    'familyName',    'name.familyName',
    'displayName',   'displayName',
    'externalId',    'externalId',
    'active',        'active',
    'department',    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department',
    'title',         'title',
    'groups',        'groups[].display'
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scim_provisioning_settings TO authenticated;
GRANT ALL ON public.scim_provisioning_settings TO service_role;

ALTER TABLE public.scim_provisioning_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scim_ps_read"
  ON public.scim_provisioning_settings
  FOR SELECT TO authenticated
  USING (
    is_platform_admin(auth.uid())
    OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  );

CREATE POLICY "scim_ps_write"
  ON public.scim_provisioning_settings
  FOR ALL TO authenticated
  USING (
    is_platform_admin(auth.uid())
    OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  )
  WITH CHECK (
    is_platform_admin(auth.uid())
    OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
  );

CREATE OR REPLACE FUNCTION public.audit_scim_provisioning_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    COALESCE(NEW.updated_by, auth.uid()),
    NEW.tenant_id,
    'tenant',
    CASE TG_OP
      WHEN 'INSERT' THEN 'scim.settings.create'
      WHEN 'UPDATE' THEN 'scim.settings.update'
      ELSE 'scim.settings.change'
    END,
    'scim_provisioning_settings',
    NEW.tenant_id::text,
    jsonb_build_object(
      'enabled', NEW.enabled,
      'auto_deprovision', NEW.auto_deprovision,
      'default_role', NEW.default_role,
      'prev_enabled', CASE WHEN TG_OP='UPDATE' THEN OLD.enabled ELSE NULL END,
      'attribute_mapping_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(NEW.attribute_mapping) k)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_scim_provisioning ON public.scim_provisioning_settings;
CREATE TRIGGER trg_audit_scim_provisioning
  AFTER INSERT OR UPDATE ON public.scim_provisioning_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_scim_provisioning_settings_change();

CREATE OR REPLACE FUNCTION public.touch_scim_provisioning_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_scim_provisioning ON public.scim_provisioning_settings;
CREATE TRIGGER trg_touch_scim_provisioning
  BEFORE UPDATE ON public.scim_provisioning_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_scim_provisioning_settings();
