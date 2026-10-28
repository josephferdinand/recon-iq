-- Exact status counts and parent-row paging for the exact Run Results view.
-- Match is counted by persisted group; every other bucket is counted by persisted exception item.
-- Both functions run as the caller and remain subject to ordinary table RLS.
CREATE OR REPLACE FUNCTION public.get_recon_run_result_status_counts(_tenant_id uuid, _run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp SET row_security = on
AS $$
DECLARE
  definition_id uuid;
  match_groups bigint;
  exception_items bigint;
  buckets jsonb;
BEGIN
  IF _tenant_id IS NULL OR _run_id IS NULL THEN
    RAISE EXCEPTION 'tenant and run are required' USING ERRCODE = '22023';
  END IF;
  SELECT r.definition_id INTO definition_id
  FROM public.recon_runs r WHERE r.tenant_id = _tenant_id AND r.id = _run_id;
  IF definition_id IS NULL OR NOT public.user_can_access_recon(auth.uid(), definition_id, 'read') THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO match_groups FROM public.recon_matches m
    WHERE m.tenant_id = _tenant_id AND m.run_id = _run_id;
  WITH categorized AS (
    SELECT CASE
      WHEN e.payload->>'disposition' = 'keyless_input' THEN 'invalid_key'
      WHEN CASE WHEN jsonb_typeof(e.payload->'missing_sides') = 'array' THEN jsonb_array_length(e.payload->'missing_sides') > 0 ELSE false END THEN 'missing'
      WHEN e.payload->>'rule_kind' = 'unique' THEN 'duplicate'
      WHEN jsonb_typeof(e.payload->'key') = 'string' AND jsonb_typeof(e.payload->'sides') = 'object' THEN 'partial'
      WHEN e.payload IS NULL OR e.payload = '{}'::jsonb THEN 'unavailable'
      ELSE 'other' END AS status_bucket
    FROM public.recon_exceptions e WHERE e.tenant_id = _tenant_id AND e.run_id = _run_id
  ), totals AS (
    SELECT status_bucket,count(*) AS item_count FROM categorized GROUP BY status_bucket
  )
  SELECT (SELECT count(*) FROM categorized), jsonb_build_object(
    'partial',COALESCE((SELECT item_count FROM totals WHERE status_bucket='partial'),0),
    'missing',COALESCE((SELECT item_count FROM totals WHERE status_bucket='missing'),0),
    'duplicate',COALESCE((SELECT item_count FROM totals WHERE status_bucket='duplicate'),0),
    'invalid_key',COALESCE((SELECT item_count FROM totals WHERE status_bucket='invalid_key'),0),
    'other',COALESCE((SELECT item_count FROM totals WHERE status_bucket='other'),0),
    'unavailable',COALESCE((SELECT item_count FROM totals WHERE status_bucket='unavailable'),0)
  ) INTO exception_items,buckets;
  RETURN jsonb_build_object('run_id', _run_id, 'match_groups', match_groups,
    'exception_items', exception_items, 'exception_buckets', buckets,
    'semantics', jsonb_build_object('match','persisted recon_matches groups',
      'partial','exception items with persisted key and sides, excluding missing, duplicate and keyless markers',
      'missing','exception items with a non-empty persisted missing_sides array',
      'duplicate','exception items with persisted rule_kind unique',
      'invalid_key','exception items with persisted disposition keyless_input',
      'other','non-empty legacy payload not classified by the markers above',
      'unavailable','exception items with no usable payload', 'workflow_status_is_separate',true));
END;
$$;
REVOKE ALL ON FUNCTION public.get_recon_run_result_status_counts(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recon_run_result_status_counts(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.get_recon_run_result_status_counts(uuid,uuid) IS
  'Exact uncapped counts for one authorized run. Match is a group count; exception buckets count exception items.';

-- Missing-side children emitted per source row are grouped by the exact persisted
-- run/key/missing-sides tuple. Child exception IDs, statuses and payloads stay attached.
CREATE OR REPLACE FUNCTION public.get_recon_run_result_page(
  _tenant_id uuid, _run_id uuid, _page integer DEFAULT 0, _status text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp SET row_security = on
AS $$
DECLARE
  definition_id uuid;
  result jsonb;
BEGIN
  IF _tenant_id IS NULL OR _run_id IS NULL OR _page IS NULL OR _page < 0 THEN
    RAISE EXCEPTION 'tenant, run and non-negative page are required' USING ERRCODE = '22023';
  END IF;
  IF _status IS NULL OR _status NOT IN ('all','match','partial','missing','duplicate','invalid_key','other','unavailable') THEN
    RAISE EXCEPTION 'unsupported run result status' USING ERRCODE = '22023';
  END IF;
  SELECT r.definition_id INTO definition_id FROM public.recon_runs r
    WHERE r.tenant_id = _tenant_id AND r.id = _run_id;
  IF definition_id IS NULL OR NOT public.user_can_access_recon(auth.uid(), definition_id, 'read') THEN RETURN NULL; END IF;

  WITH exception_base AS (
    SELECT e.*,
      CASE WHEN e.payload->>'disposition' = 'keyless_input' THEN 'invalid_key'
        WHEN CASE WHEN jsonb_typeof(e.payload->'missing_sides') = 'array' THEN jsonb_array_length(e.payload->'missing_sides') > 0 ELSE false END THEN 'missing'
        WHEN e.payload->>'rule_kind' = 'unique' THEN 'duplicate'
        WHEN jsonb_typeof(e.payload->'key') = 'string' AND jsonb_typeof(e.payload->'sides') = 'object' THEN 'partial'
        WHEN e.payload IS NULL OR e.payload = '{}'::jsonb THEN 'unavailable' ELSE 'other' END AS status_bucket,
      CASE WHEN CASE WHEN jsonb_typeof(e.payload->'missing_sides') = 'array' THEN jsonb_array_length(e.payload->'missing_sides') > 0 ELSE false END
          AND jsonb_typeof(e.payload->'key') = 'string'
        THEN 'missing:' || jsonb_build_array(e.payload->'key', e.payload->'missing_sides')::text
        ELSE 'exception:' || e.id::text END AS parent_key
    FROM public.recon_exceptions e WHERE e.tenant_id = _tenant_id AND e.run_id = _run_id
  ), exception_items AS (
    SELECT parent_key, status_bucket, min(created_at) AS created_at,
      jsonb_agg(jsonb_build_object('id',id,'side',side,'reason',reason,'status',status,
        'payload',payload,'created_at',created_at) ORDER BY created_at,id) AS items
    FROM exception_base GROUP BY parent_key,status_bucket
  ), source_rows AS (
    SELECT parent_key, side, jsonb_agg(source_row ORDER BY created_at,id,member_order) AS rows
    FROM (
      SELECT parent_key,side,payload->'row' AS source_row,created_at,id,1 AS member_order
      FROM exception_base WHERE jsonb_typeof(payload->'row') = 'object'
      UNION ALL
      SELECT e.parent_key,side_entry.key,member.value,e.created_at,e.id,member.ordinality::integer
      FROM exception_base e
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(e.payload->'sides')='object' THEN e.payload->'sides' ELSE '{}'::jsonb END) side_entry
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(side_entry.value)='array' THEN side_entry.value ELSE jsonb_build_array(side_entry.value) END
      ) WITH ORDINALITY AS member(value,ordinality)
    ) values_by_side
    GROUP BY parent_key,side
  ), source_members AS (
    SELECT parent_key, jsonb_object_agg(side,rows) AS members
    FROM source_rows GROUP BY parent_key
  ), exception_parents AS (
    SELECT i.parent_key,i.status_bucket,i.created_at,i.items,
      COALESCE(s.members,'{}'::jsonb) AS members
    FROM exception_items i LEFT JOIN source_members s USING (parent_key)
  ), result_rows AS (
    SELECT m.created_at,'match:'||m.id::text AS result_id,'match'::text AS status_bucket,
      jsonb_build_object('kind','match','id',m.id,'created_at',m.created_at,'rule_id',m.rule_id,
        'cardinality',m.cardinality,'members',m.members,'exception_items','[]'::jsonb) AS row
    FROM public.recon_matches m WHERE m.tenant_id=_tenant_id AND m.run_id=_run_id
    UNION ALL
    SELECT p.created_at,p.parent_key,p.status_bucket,
      jsonb_build_object('kind','exception','id',p.parent_key,'created_at',p.created_at,
        'status_bucket',p.status_bucket,'members',p.members,'exception_items',p.items) AS row
    FROM exception_parents p
  ), filtered AS (
    SELECT * FROM result_rows WHERE _status='all' OR status_bucket=_status
  ), counts AS (
    SELECT count(*) AS parent_count FROM filtered
  ), page AS (
    SELECT row,created_at,result_id FROM filtered ORDER BY created_at,result_id OFFSET _page*50 LIMIT 50
  ), fields AS (
    SELECT COALESCE(jsonb_agg(field_name ORDER BY field_name),'[]'::jsonb) AS names
    FROM (
      SELECT DISTINCT field_name FROM (
        SELECT field.key AS field_name
        FROM public.recon_matches m
        CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(m.members)='object' THEN m.members ELSE '{}'::jsonb END) side
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(side.value)='array' THEN side.value ELSE jsonb_build_array(side.value) END) member
        CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(member.value)='object' THEN member.value ELSE '{}'::jsonb END) field(key)
        WHERE m.tenant_id=_tenant_id AND m.run_id=_run_id
        UNION ALL
        SELECT field.key
        FROM public.recon_exceptions e
        CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(e.payload->'row')='object' THEN e.payload->'row' ELSE '{}'::jsonb END) field(key)
        WHERE e.tenant_id=_tenant_id AND e.run_id=_run_id
        UNION ALL
        SELECT field.key
        FROM public.recon_exceptions e
        CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(e.payload->'sides')='object' THEN e.payload->'sides' ELSE '{}'::jsonb END) side
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(side.value)='array' THEN side.value ELSE jsonb_build_array(side.value) END) member
        CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(member.value)='object' THEN member.value ELSE '{}'::jsonb END) field(key)
        WHERE e.tenant_id=_tenant_id AND e.run_id=_run_id
      ) all_fields
    ) distinct_fields
  )
  SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(page.row ORDER BY page.created_at,page.result_id) FROM page),'[]'::jsonb),
    'field_names',fields.names,
    'parent_count',counts.parent_count,'page',_page,'page_size',50,
    'has_next',((_page+1)*50 < counts.parent_count)) INTO result FROM counts CROSS JOIN fields;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_recon_run_result_page(uuid,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recon_run_result_page(uuid,uuid,integer,text) TO authenticated;
COMMENT ON FUNCTION public.get_recon_run_result_page(uuid,uuid,integer,text) IS
  'Deterministic exact-run parent paging. Missing-side children group by persisted composite key and missing-side set; individual child exception IDs/statuses remain attached.';
