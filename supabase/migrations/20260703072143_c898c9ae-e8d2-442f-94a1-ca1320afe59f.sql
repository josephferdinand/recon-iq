
DROP POLICY IF EXISTS masking_rules_rw ON public.data_masking_rules;
DROP POLICY IF EXISTS masking_rules_select ON public.data_masking_rules;
DROP POLICY IF EXISTS masking_rules_admin_write ON public.data_masking_rules;

CREATE POLICY masking_rules_select ON public.data_masking_rules
FOR SELECT USING (
  public.is_platform_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = data_masking_rules.tenant_id
      AND tm.user_id = auth.uid() AND tm.active
  )
);

CREATE POLICY masking_rules_admin_write ON public.data_masking_rules
FOR ALL USING (
  public.is_platform_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = data_masking_rules.tenant_id
      AND tm.user_id = auth.uid() AND tm.active
      AND tm.role = 'tenant_admin'
  )
) WITH CHECK (
  public.is_platform_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = data_masking_rules.tenant_id
      AND tm.user_id = auth.uid() AND tm.active
      AND tm.role = 'tenant_admin'
  )
);

DROP POLICY IF EXISTS abac_write ON public.rbac_abac_predicates;
DROP POLICY IF EXISTS abac_admin_write ON public.rbac_abac_predicates;

CREATE POLICY abac_admin_write ON public.rbac_abac_predicates
FOR ALL USING (
  public.is_platform_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_abac_predicates.tenant_id
      AND tm.user_id = auth.uid() AND tm.active
      AND tm.role = 'tenant_admin'
  )
) WITH CHECK (
  public.is_platform_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = rbac_abac_predicates.tenant_id
      AND tm.user_id = auth.uid() AND tm.active
      AND tm.role = 'tenant_admin'
  )
);
