
ALTER TABLE public.tenant_invitations
  ADD COLUMN IF NOT EXISTS role_ids  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS group_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS bu_id     uuid REFERENCES public.business_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tenant_invitations.role_ids  IS 'RBAC role IDs (public.rbac_roles) granted on acceptance via rbac_user_grants.';
COMMENT ON COLUMN public.tenant_invitations.group_ids IS 'Tenant group IDs (public.tenant_groups) the user is added to on acceptance.';
COMMENT ON COLUMN public.tenant_invitations.bu_id     IS 'Optional Business Unit scope applied to direct grants on acceptance.';
