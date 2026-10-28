
-- SCIM Day 1: External ID mapping + soft-deactivation on tenant_members

-- 1) Soft-deactivation flag on tenant_members
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE INDEX IF NOT EXISTS tenant_members_active_idx
  ON public.tenant_members (tenant_id, active);

-- 2) SCIM external-ID mapping table — links an IdP-provided externalId
--    to an internal user (tenant_members.user_id) or group (tenant_groups.id).
CREATE TABLE IF NOT EXISTS public.scim_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('User','Group')),
  external_id text NOT NULL,
  internal_id uuid NOT NULL,
  user_name citext,
  token_id uuid REFERENCES public.scim_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource_type, external_id)
);

CREATE INDEX IF NOT EXISTS scim_ext_lookup_idx
  ON public.scim_external_ids (tenant_id, resource_type, internal_id);
CREATE INDEX IF NOT EXISTS scim_ext_username_idx
  ON public.scim_external_ids (tenant_id, user_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scim_external_ids TO authenticated;
GRANT ALL ON public.scim_external_ids TO service_role;

ALTER TABLE public.scim_external_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY scim_ext_admin_all ON public.scim_external_ids
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
         OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
              OR public.is_platform_admin(auth.uid()));

CREATE TRIGGER tg_scim_ext_updated
  BEFORE UPDATE ON public.scim_external_ids
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
