-- Owner-bound, tenant-scoped reconciliation imports. One RPC invocation is
-- one transaction: a validation, owner, row, or audit failure rolls back the
-- complete batch. Existing approved/pending/promoted definitions are never
-- overwritten; overwrite is limited to editable development drafts whose
-- existing owner BU set exactly matches the caller's explicit selection.

CREATE OR REPLACE FUNCTION public.import_recon_definitions_with_owners(
  _tenant_id uuid,
  _definitions jsonb,
  _owner_bu_ids uuid[],
  _mode text DEFAULT 'skip'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_owner_ids uuid[];
  v_existing_owner_ids uuid[];
  v_item jsonb;
  v_name text;
  v_description text;
  v_recon_type text;
  v_sides jsonb;
  v_rules jsonb;
  v_side_count integer;
  v_source_count integer;
  v_distinct_source_count integer;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_state text;
  v_existing_access text;
  v_existing_environment text;
  v_existing_multi_bu boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_created record;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _mode IS NULL OR _mode NOT IN ('skip','overwrite')
     OR jsonb_typeof(_definitions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_definitions) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid reconciliation import request' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id=_tenant_id AND member_row.user_id=v_actor
      AND member_row.active AND member_row.role::text='tenant_admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin AND NOT private.recon_governance_is_active_analyst(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator or analyst required' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id),ARRAY[]::uuid[])
  INTO v_owner_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_owner_ids)=0 OR cardinality(v_owner_ids)<>cardinality(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'choose one or more distinct owning business units' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
    LEFT JOIN public.business_units bu ON bu.id=requested.bu_id AND bu.tenant_id=_tenant_id
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'owning business units must be active and belong to this tenant' USING ERRCODE='42501';
  END IF;
  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_bu
        ON assigned_bu.id=assignment.bu_id AND assigned_bu.tenant_id=assignment.tenant_id
        AND NOT assigned_bu.is_archived
      JOIN public.business_units owner_bu
        ON owner_bu.id=requested.bu_id AND owner_bu.tenant_id=assignment.tenant_id
        AND NOT owner_bu.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=v_actor
        AND (owner_bu.id=assigned_bu.id OR (assignment.inherit_descendants AND owner_bu.path <@ assigned_bu.path))
    )
  ) THEN
    RAISE EXCEPTION 'analyst must be assigned to every selected owning business unit' USING ERRCODE='42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_definitions) item
    GROUP BY lower(btrim(coalesce(item->>'name','')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'import file contains duplicate definition names' USING ERRCODE='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_definitions) AS items(value)
  LOOP
    v_name := btrim(coalesce(v_item->>'name',''));
    v_description := nullif(btrim(coalesce(v_item->>'description','')),'');
    v_recon_type := v_item->>'recon_type';
    v_sides := v_item->'sides';
    v_rules := v_item->'rules';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
       OR (v_item ? 'description' AND jsonb_typeof(v_item->'description') NOT IN ('string','null'))
       OR length(v_name) NOT BETWEEN 1 AND 120
       OR length(coalesce(v_description,'')) > 2000
       OR v_recon_type IS NULL OR v_recon_type NOT IN ('one_sided','two_sided','three_sided')
       OR jsonb_typeof(v_sides) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_rules) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_sides) > 3
       OR jsonb_array_length(v_rules) > 100
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_sides) side WHERE jsonb_typeof(side) IS DISTINCT FROM 'object')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) rule WHERE jsonb_typeof(rule) IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'an imported definition has invalid fields' USING ERRCODE='22023';
    END IF;
    v_side_count := jsonb_array_length(v_sides);
    IF v_side_count <> (CASE v_recon_type WHEN 'one_sided' THEN 1 WHEN 'two_sided' THEN 2 ELSE 3 END)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_sides) side
         WHERE coalesce(side->>'data_source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) THEN
      RAISE EXCEPTION 'an imported definition has incomplete source bindings' USING ERRCODE='22023';
    END IF;
    SELECT count(*) INTO v_distinct_source_count
    FROM (
      SELECT DISTINCT (side->>'data_source_id')::uuid AS id
      FROM jsonb_array_elements(v_sides) side
    ) imported_ids;
    SELECT count(DISTINCT source_row.id) INTO v_source_count
    FROM public.workspace_data_sources source_row
    JOIN (
      SELECT DISTINCT (side->>'data_source_id')::uuid AS id
      FROM jsonb_array_elements(v_sides) side
    ) imported_source ON imported_source.id=source_row.id
    WHERE source_row.tenant_id=_tenant_id;
    IF v_source_count <> v_distinct_source_count THEN
      RAISE EXCEPTION 'every imported source must belong to this tenant' USING ERRCODE='42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_sides) side
      WHERE nullif(side->>'upload_id','') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.workspace_data_source_uploads upload_row
          WHERE upload_row.id=(side->>'upload_id')::uuid AND upload_row.tenant_id=_tenant_id
            AND upload_row.data_source_id=(side->>'data_source_id')::uuid
        )
    ) THEN
      RAISE EXCEPTION 'every imported upload must belong to its same-tenant source' USING ERRCODE='42501';
    END IF;

    SELECT definition_row.id, definition_row.status, definition_row.governance_state,
           definition_row.access_mode, definition_row.environment, definition_row.multi_bu_governed
    INTO v_existing_id, v_existing_status, v_existing_state, v_existing_access,
         v_existing_environment, v_existing_multi_bu
    FROM public.recon_definitions definition_row
    WHERE definition_row.tenant_id=_tenant_id AND lower(definition_row.name)=lower(v_name)
    ORDER BY definition_row.created_at, definition_row.id
    LIMIT 1 FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      IF _mode='skip' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF v_existing_status IS DISTINCT FROM 'draft'
         OR v_existing_state IS DISTINCT FROM 'development_draft'
         OR v_existing_access IS DISTINCT FROM 'mapped_exact'
         OR v_existing_environment IS DISTINCT FROM 'development'
         OR v_existing_multi_bu IS DISTINCT FROM true
         OR NOT private.recon_authoritative_access_decision(v_existing_id,'read')
         OR NOT private.recon_authoritative_access_decision(v_existing_id,'edit') THEN
        RAISE EXCEPTION 'only an editable development draft can be overwritten; the batch was not applied' USING ERRCODE='42501';
      END IF;
      SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
      INTO v_existing_owner_ids
      FROM public.recon_definition_business_units owner_row
      WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=v_existing_id;
      IF v_existing_owner_ids IS DISTINCT FROM v_owner_ids THEN
        RAISE EXCEPTION 'overwrite owner units must match the existing definition exactly' USING ERRCODE='42501';
      END IF;
      UPDATE public.recon_definitions
      SET description=v_description, recon_type=v_recon_type, sides=v_sides, rules=v_rules
      WHERE id=v_existing_id AND tenant_id=_tenant_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'an imported definition could not be updated'; END IF;
      INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
      VALUES (v_actor,_tenant_id,'workspace','recon.bulk_import.overwrite','recon_definition',v_existing_id::text,
        jsonb_build_object('name',v_name,'owner_bu_ids',v_owner_ids,'mode',_mode));
      v_updated := v_updated + 1;
    ELSE
      SELECT * INTO v_created
      FROM public.create_recon_definition_with_owners(
        _tenant_id,v_name,v_description,v_recon_type,v_sides,v_rules,v_owner_ids
      );
      IF v_created.id IS NULL THEN RAISE EXCEPTION 'an imported definition was not created'; END IF;
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,context)
  VALUES (v_actor,_tenant_id,'workspace','recon.bulk_import','recon_definitions',
    jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skipped',v_skipped,'mode',_mode,
      'owner_bu_ids',v_owner_ids,'definition_count',jsonb_array_length(_definitions)));
  RETURN jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skipped',v_skipped);
END
$function$;

REVOKE ALL ON FUNCTION public.import_recon_definitions_with_owners(uuid,jsonb,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_recon_definitions_with_owners(uuid,jsonb,uuid[],text) TO authenticated;
COMMENT ON FUNCTION public.import_recon_definitions_with_owners(uuid,jsonb,uuid[],text) IS
  'Atomically imports tenant reconciliation definitions with explicit owner BUs; new rows are drafts, duplicate names skip or may update only accessible owner-identical development drafts, and approved/history states remain immutable.';
