-- Restrict platform-level (tenant_id IS NULL) rows on red_team_scans, chaos_drills, chaos_drill_findings to platform admins only.

DROP POLICY IF EXISTS rts_read ON public.red_team_scans;
CREATE POLICY rts_read ON public.red_team_scans
  FOR SELECT TO authenticated
  USING (
    (tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = red_team_scans.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active
    ))
    OR (tenant_id IS NULL AND public.is_platform_admin(auth.uid()))
  );

DROP POLICY IF EXISTS cd_read ON public.chaos_drills;
CREATE POLICY cd_read ON public.chaos_drills
  FOR SELECT TO authenticated
  USING (
    (tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = chaos_drills.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active
    ))
    OR (tenant_id IS NULL AND public.is_platform_admin(auth.uid()))
  );

DROP POLICY IF EXISTS cdf_read ON public.chaos_drill_findings;
CREATE POLICY cdf_read ON public.chaos_drill_findings
  FOR SELECT TO authenticated
  USING (
    (tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = chaos_drill_findings.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active
    ))
    OR (tenant_id IS NULL AND public.is_platform_admin(auth.uid()))
  );
