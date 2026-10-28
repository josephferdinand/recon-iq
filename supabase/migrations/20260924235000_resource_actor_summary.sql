-- Server-side display projection for audit actors. Actor UUIDs and profile
-- emails remain inside the database; resource IDs only correlate requested rows.

CREATE OR REPLACE FUNCTION private.resource_actor_display_label(
  _tenant_id uuid,
  _actor_id uuid,
  _actor_status text
)
RETURNS TABLE(label text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_active boolean;
  v_full_name text;
BEGIN
  IF _actor_id IS NULL AND _actor_status = 'unattributed' THEN
    RETURN QUERY SELECT 'Unattributed'::text, 'unattributed'::text;
    RETURN;
  END IF;
  IF _actor_id IS NULL AND _actor_status IS NULL THEN
    RETURN QUERY SELECT 'Unknown'::text, 'unknown'::text;
    RETURN;
  END IF;
  IF _actor_status <> 'authenticated_user' OR _actor_id IS NULL THEN
    IF _actor_status = 'authenticated_user' THEN
      RETURN QUERY SELECT 'Unavailable'::text, 'removed'::text;
    ELSE
      RETURN QUERY SELECT 'Unknown'::text, 'unknown'::text;
    END IF;
    RETURN;
  END IF;

  -- Profiles are global rows; expose a name only through an active membership
  -- in the resource tenant. Never select or return the profile email.
  SELECT tm.active, p.full_name
  INTO v_active, v_full_name
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.tenant_id = _tenant_id AND tm.user_id = _actor_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'Unavailable'::text, 'removed'::text;
  ELSIF NOT coalesce(v_active, false) THEN
    RETURN QUERY SELECT 'Inactive user'::text, 'inactive'::text;
  ELSE
    v_full_name := left(nullif(btrim(regexp_replace(coalesce(v_full_name, ''), '[[:cntrl:]]', '', 'g')), ''), 120);
    IF v_full_name IS NULL
       OR v_full_name ~* '(^|[[:space:]])[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+($|[[:space:]])'
       OR v_full_name ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' THEN
      RETURN QUERY SELECT 'Unknown'::text, 'unknown'::text;
    ELSE
      RETURN QUERY SELECT v_full_name, 'known'::text;
    END IF;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION private.resource_actor_display_label(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_resource_actor_summary(
  _resource_type text,
  _resource_ids uuid[]
)
RETURNS TABLE(
  resource_type text,
  resource_id uuid,
  created_by_label text,
  created_by_status text,
  updated_by_label text,
  updated_by_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private
AS $function$
DECLARE
  v_row record;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF _resource_type IS NULL OR _resource_type NOT IN (
    'data_source','data_source_schedule','db_connection','inline_api_source','erp_connection',
    'file_watcher','aidp_template','aidp_document','reference_table','data_prep_pipeline','reconciliation'
  ) THEN
    RAISE EXCEPTION 'unsupported resource type' USING ERRCODE = '22023';
  END IF;
  IF _resource_ids IS NULL OR cardinality(_resource_ids) NOT BETWEEN 1 AND 100
     OR array_position(_resource_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'between 1 and 100 resource IDs are required' USING ERRCODE = '22023';
  END IF;

  BEGIN
    FOR v_row IN
      WITH visible AS MATERIALIZED (
        SELECT a.resource_id
        FROM public.get_data_resource_access_summary(_resource_type, _resource_ids) a
      ), roots AS MATERIALIZED (
        SELECT 'data_source'::text AS resource_type, s.id AS resource_id, s.tenant_id,
          s.created_by_actor_id, s.created_by_actor_status, s.updated_by_actor_id, s.updated_by_actor_status
        FROM public.workspace_data_sources s
        WHERE _resource_type='data_source' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'data_source_schedule',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.data_source_schedules s
        WHERE _resource_type='data_source_schedule' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'db_connection',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.rekon_db_connections s
        WHERE _resource_type='db_connection' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'inline_api_source',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.rekon_inline_api_sources s
        WHERE _resource_type='inline_api_source' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'erp_connection',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.erp_connector_configs s
        WHERE _resource_type='erp_connection' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'file_watcher',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.data_watchers s
        WHERE _resource_type='file_watcher' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'aidp_template',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.aidp_templates s
        WHERE _resource_type='aidp_template' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'aidp_document',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.aidp_documents s
        WHERE _resource_type='aidp_document' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'reference_table',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.reference_data_tables s
        WHERE _resource_type='reference_table' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'data_prep_pipeline',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.data_prep_pipelines s
        WHERE _resource_type='data_prep_pipeline' AND s.id=ANY(_resource_ids)
        UNION ALL
        SELECT 'reconciliation',s.id,s.tenant_id,s.created_by_actor_id,s.created_by_actor_status,s.updated_by_actor_id,s.updated_by_actor_status
        FROM public.recon_definitions s
        WHERE _resource_type='reconciliation' AND s.id=ANY(_resource_ids)
      )
      SELECT r.*
      FROM roots r
      JOIN visible v ON v.resource_id = r.resource_id
    LOOP
      resource_type := v_row.resource_type;
      resource_id := v_row.resource_id;
      SELECT x.label,x.status INTO created_by_label,created_by_status
      FROM private.resource_actor_display_label(v_row.tenant_id,v_row.created_by_actor_id,v_row.created_by_actor_status) x;
      SELECT x.label,x.status INTO updated_by_label,updated_by_status
      FROM private.resource_actor_display_label(v_row.tenant_id,v_row.updated_by_actor_id,v_row.updated_by_actor_status) x;
      RETURN NEXT;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Hide database and authorization internals from API clients.
    RAISE EXCEPTION 'unable to load resource actor summary' USING ERRCODE = 'P0001';
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.get_resource_actor_summary(text,uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_resource_actor_summary(text,uuid[]) TO authenticated;
COMMENT ON FUNCTION public.get_resource_actor_summary(text,uuid[]) IS
  'Returns safe actor labels/statuses only for requested rows visible to the authenticated actor under get_data_resource_access_summary. Never returns actor IDs or profile emails. Upload child records are intentionally unsupported.';
