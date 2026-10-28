
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS dtn_tenant_status_idx ON public.digital_twin_nodes(tenant_id, status);
CREATE INDEX IF NOT EXISTS dtn_tenant_updated_idx ON public.digital_twin_nodes(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS dtn_label_trgm_idx ON public.digital_twin_nodes USING gin (label gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.get_digital_twin_stats(_tenant_id uuid)
RETURNS TABLE(
  total_nodes int,
  total_edges int,
  ok_count int,
  warning_count int,
  breached_count int,
  unknown_count int,
  types_json jsonb,
  last_updated timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.digital_twin_nodes WHERE tenant_id = _tenant_id),
    (SELECT count(*)::int FROM public.digital_twin_edges WHERE tenant_id = _tenant_id),
    (SELECT count(*)::int FROM public.digital_twin_nodes WHERE tenant_id = _tenant_id AND status = 'ok'),
    (SELECT count(*)::int FROM public.digital_twin_nodes WHERE tenant_id = _tenant_id AND status = 'warning'),
    (SELECT count(*)::int FROM public.digital_twin_nodes WHERE tenant_id = _tenant_id AND status = 'breached'),
    (SELECT count(*)::int FROM public.digital_twin_nodes WHERE tenant_id = _tenant_id AND status = 'unknown'),
    (SELECT COALESCE(jsonb_object_agg(node_type, c), '{}'::jsonb) FROM (
       SELECT node_type, count(*) AS c
         FROM public.digital_twin_nodes
        WHERE tenant_id = _tenant_id
        GROUP BY node_type
     ) t),
    (SELECT max(updated_at) FROM public.digital_twin_nodes WHERE tenant_id = _tenant_id);
$$;

REVOKE ALL ON FUNCTION public.get_digital_twin_stats(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_digital_twin_stats(uuid) TO authenticated, service_role;
