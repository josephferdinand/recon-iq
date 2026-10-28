-- Early vault boundary after the hosted 20260923090200 ledger.
-- Restrictive policies intersect the existing scope/role policies. They do not
-- grant access, change historical encrypted rows, or broaden service_role.
BEGIN;

CREATE POLICY app_vault_active_tenant_boundary
ON public.app_vault_secrets AS RESTRICTIVE FOR ALL TO authenticated
USING (
  scope = 'platform'
  OR (scope = 'tenant' AND tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = app_vault_secrets.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'::public.tenant_role
      AND tm.active
  ))
)
WITH CHECK (
  scope = 'platform'
  OR (scope = 'tenant' AND tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = app_vault_secrets.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'::public.tenant_role
      AND tm.active
  ))
);

CREATE POLICY app_vault_kms_active_tenant_boundary
ON public.app_vault_kms_bindings AS RESTRICTIVE FOR ALL TO authenticated
USING (
  scope = 'platform'
  OR (scope = 'tenant' AND tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = app_vault_kms_bindings.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'::public.tenant_role
      AND tm.active
  ))
)
WITH CHECK (
  scope = 'platform'
  OR (scope = 'tenant' AND tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = app_vault_kms_bindings.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_admin'::public.tenant_role
      AND tm.active
  ))
);

-- Child records are readable/writable only through their visible parent.
-- The parent policy enforces scope, tenant identity, and active membership.
CREATE POLICY app_vault_rotation_active_tenant_boundary
ON public.app_vault_rotation_log AS RESTRICTIVE FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.app_vault_secrets s
  WHERE s.id = app_vault_rotation_log.secret_id
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.app_vault_secrets s
  WHERE s.id = app_vault_rotation_log.secret_id
));

CREATE POLICY app_vault_versions_active_tenant_boundary
ON public.app_vault_secret_versions AS RESTRICTIVE FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.app_vault_secrets s
  WHERE s.id = app_vault_secret_versions.secret_id
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.app_vault_secrets s
  WHERE s.id = app_vault_secret_versions.secret_id
));

COMMIT;
