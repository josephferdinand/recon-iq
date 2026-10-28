-- Phase 8 P3 QA hardening: tighten platform-scope chaos drill writes and prevent duplicate digital twin edges

-- 1) Tighten chaos_drills: only service_role may write platform-scope (tenant_id IS NULL) rows
DROP POLICY IF EXISTS cd_write ON public.chaos_drills;
DROP POLICY IF EXISTS cd_update ON public.chaos_drills;

CREATE POLICY cd_write_tenant ON public.chaos_drills
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
                WHERE tm.tenant_id = chaos_drills.tenant_id
                  AND tm.user_id = auth.uid()
                  AND tm.active = true)
  );

CREATE POLICY cd_update_tenant ON public.chaos_drills
  FOR UPDATE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
                WHERE tm.tenant_id = chaos_drills.tenant_id
                  AND tm.user_id = auth.uid()
                  AND tm.active = true)
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
                WHERE tm.tenant_id = chaos_drills.tenant_id
                  AND tm.user_id = auth.uid()
                  AND tm.active = true)
  );

-- 2) Tighten chaos_drill_findings: same restriction for platform-scope rows
DROP POLICY IF EXISTS cdf_write ON public.chaos_drill_findings;

CREATE POLICY cdf_write_tenant ON public.chaos_drill_findings
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
                WHERE tm.tenant_id = chaos_drill_findings.tenant_id
                  AND tm.user_id = auth.uid()
                  AND tm.active = true)
  );

-- 3) Prevent duplicate digital twin edges; allow upsert semantics
CREATE UNIQUE INDEX IF NOT EXISTS digital_twin_edges_unique_idx
  ON public.digital_twin_edges (tenant_id, src_node_id, dst_node_id, rel);
