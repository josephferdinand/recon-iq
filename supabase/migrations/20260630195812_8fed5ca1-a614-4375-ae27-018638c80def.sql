-- D-2
DROP POLICY IF EXISTS rts_write ON public.red_team_scans;
CREATE POLICY rts_write ON public.red_team_scans
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tenant_members tm
                WHERE tm.tenant_id = red_team_scans.tenant_id
                  AND tm.user_id = auth.uid() AND tm.active = true)
  );

-- D-3
DROP FUNCTION IF EXISTS public.get_kg_neighbors(uuid, uuid, integer);
CREATE FUNCTION public.get_kg_neighbors(
  _tenant_id uuid, _start_node uuid, _max_depth int DEFAULT 3
)
RETURNS TABLE(node_id uuid, depth int, edge_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE walk AS (
    SELECT _start_node AS node_id, 0 AS depth, NULL::text AS edge_type,
           ARRAY[_start_node] AS visited
    UNION ALL
    SELECT e.dst_node_id, w.depth + 1, e.edge_type, w.visited || e.dst_node_id
    FROM walk w
    JOIN public.recon_kg_edges e
      ON e.src_node_id = w.node_id AND e.tenant_id = _tenant_id
    WHERE w.depth < _max_depth AND NOT (e.dst_node_id = ANY(w.visited))
  )
  SELECT node_id, depth, edge_type FROM walk WHERE depth > 0;
$$;
REVOKE EXECUTE ON FUNCTION public.get_kg_neighbors(uuid, uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_kg_neighbors(uuid, uuid, int) TO authenticated, service_role;

-- D-4
CREATE INDEX IF NOT EXISTS ca_entitlements_tenant_idx ON public.ca_entitlements(tenant_id);
CREATE INDEX IF NOT EXISTS fund_nav_components_tenant_idx ON public.fund_nav_components(tenant_id);
CREATE INDEX IF NOT EXISTS dq_results_tenant_idx ON public.dq_results(tenant_id);
CREATE INDEX IF NOT EXISTS outreach_messages_tenant_idx ON public.outreach_messages(tenant_id);
CREATE INDEX IF NOT EXISTS red_team_scans_tenant_idx ON public.red_team_scans(tenant_id);

-- D-5
DROP POLICY IF EXISTS ror_rw ON public.rule_optimisation_runs;
CREATE POLICY ror_rw ON public.rule_optimisation_runs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = rule_optimisation_runs.tenant_id
                   AND tm.user_id = auth.uid() AND tm.active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm
                      WHERE tm.tenant_id = rule_optimisation_runs.tenant_id
                        AND tm.user_id = auth.uid() AND tm.active = true));
