-- Keep Starter Kit and tenant-template reconciliation creation compatible
-- with the direct INSERT revoke: every new definition must carry explicit,
-- active same-tenant owner BUs through the atomic owner-binding creator.
-- Platform administrators still require an active tenant analyst/admin role
-- for tenant-data creation; the tenant-bound creator intentionally enforces it.

CREATE OR REPLACE FUNCTION public.install_recon_starter_template_atomic(
  _tenant_id uuid,
  _template_id uuid,
  _name text,
  _sides jsonb,
  _rules jsonb,
  _owner_bu_ids uuid[]
) RETURNS TABLE(recon_definition_id uuid, recon_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  actor uuid := auth.uid();
  template_row public.recon_definition_templates%ROWTYPE;
  definition_row public.recon_definitions%ROWTYPE;
  leg_count integer;
  valid_source_count integer;
  definition_type text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.is_platform_admin(actor)
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_name,''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid reconciliation name' USING ERRCODE='22023';
  END IF;
  IF coalesce(cardinality(_owner_bu_ids), 0) = 0 THEN
    RAISE EXCEPTION 'select at least one owning business unit' USING ERRCODE='22023';
  END IF;

  SELECT * INTO template_row
  FROM public.recon_definition_templates
  WHERE id = _template_id AND status = 'published'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published template not found' USING ERRCODE='P0002'; END IF;

  IF jsonb_typeof(template_row.legs) <> 'array' THEN
    RAISE EXCEPTION 'published template legs are invalid' USING ERRCODE='22023';
  END IF;
  leg_count := jsonb_array_length(template_row.legs);
  IF jsonb_typeof(_sides) <> 'array' OR jsonb_array_length(_sides) <> leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'every template leg requires one source binding' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) < 1 OR jsonb_array_length(_rules) > 50 THEN
    RAISE EXCEPTION 'compiled template rules are invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_sides) side
    WHERE COALESCE(side->>'side_id','') NOT IN ('A','B','C')
      OR NULLIF(side->>'data_source_id','') IS NULL
  ) OR (
    SELECT count(DISTINCT side->>'side_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count OR (
    SELECT count(DISTINCT side->>'data_source_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count THEN
    RAISE EXCEPTION 'template side bindings are invalid or duplicated' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO valid_source_count
  FROM jsonb_array_elements(_sides) side
  JOIN public.workspace_data_sources source
    ON source.id = (side->>'data_source_id')::uuid
   AND source.tenant_id = _tenant_id;
  IF valid_source_count <> leg_count THEN
    RAISE EXCEPTION 'template source does not belong to tenant' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rules) rule
    WHERE COALESCE(rule->>'kind','') NOT IN (
      'exact_match','case_insensitive_match','trimmed_match','numeric_equals',
      'numeric_tolerance_abs','numeric_tolerance_pct','amount_sign_flip','date_equals',
      'date_tolerance_days','date_within_range','date_age_days','string_contains','string_starts_with',
      'string_ends_with','regex_match','fuzzy_levenshtein','phonetic_soundex',
      'currency_equals','boolean_equals','non_null','unique','in_set','sum_to_match',
      'many_to_one_sum','one_to_many_sum','value_range','multiply','ignore_day_portion',
      'conditional_set','roll_up','reference_lookup','multi_pass','quick_fix'
    ) OR jsonb_typeof(rule->'fields') <> 'object'
  ) THEN
    RAISE EXCEPTION 'template compiled an unsupported rule' USING ERRCODE='22023';
  END IF;

  definition_type := CASE leg_count WHEN 1 THEN 'one_sided' WHEN 2 THEN 'two_sided' ELSE 'three_sided' END;
  SELECT created.id, created.recon_code INTO definition_row.id, definition_row.recon_code
  FROM public.create_recon_definition_with_owners(
    _tenant_id, btrim(_name), template_row.summary, definition_type, _sides, _rules, _owner_bu_ids
  ) AS created;
  IF definition_row.id IS NULL THEN RAISE EXCEPTION 'owner-bound creation returned no reconciliation'; END IF;

  UPDATE public.recon_definitions
  SET starter_template_id = template_row.id,
      starter_template_code = template_row.code,
      starter_template_snapshot = jsonb_build_object(
        'template_code',template_row.code,'asset_class',template_row.asset_class,
        'legs',template_row.legs,'keys',template_row.keys,'rules',template_row.rules,
        'tolerances',template_row.tolerances,'sample_fields',template_row.sample_fields,
        'installed_at',now()
      )
  WHERE id = definition_row.id AND tenant_id = _tenant_id
  RETURNING * INTO definition_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'created reconciliation was not readable in tenant'; END IF;

  UPDATE public.recon_definition_templates
  SET install_count = install_count + 1
  WHERE id = template_row.id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.template.install','recon_definition',definition_row.id::text,
    jsonb_build_object(
      'recon_code',definition_row.recon_code,'template_id',template_row.id,
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'owner_bu_ids',_owner_bu_ids,
      'source_ids',(SELECT jsonb_agg(side->>'data_source_id') FROM jsonb_array_elements(_sides) side),
      'rule_count',jsonb_array_length(_rules)
    ));

  RETURN QUERY SELECT definition_row.id,definition_row.recon_code;
END
$function$;

CREATE OR REPLACE FUNCTION public.instantiate_tenant_template_atomic(
  _tenant_id uuid,
  _tenant_template_id uuid,
  _name text,
  _owner_bu_ids uuid[]
) RETURNS TABLE(recon_definition_id uuid,recon_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  actor uuid := auth.uid();
  template_row public.tenant_templates%ROWTYPE;
  definition_row public.recon_definitions%ROWTYPE;
  source_count integer;
  leg_count integer;
BEGIN
  IF actor IS NULL OR NOT (
    public.is_platform_admin(actor)
    OR public.has_tenant_role(actor,_tenant_id,'tenant_admin')
    OR public.has_tenant_role(actor,_tenant_id,'tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_name,''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid reconciliation name' USING ERRCODE='22023';
  END IF;
  IF coalesce(cardinality(_owner_bu_ids), 0) = 0 THEN
    RAISE EXCEPTION 'select at least one owning business unit' USING ERRCODE='22023';
  END IF;

  SELECT * INTO template_row FROM public.tenant_templates
  WHERE id=_tenant_template_id AND tenant_id=_tenant_id AND status='published'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published tenant template not found' USING ERRCODE='P0002'; END IF;
  IF template_row.spec->>'kind' <> 'reconciliation'
     OR jsonb_typeof(template_row.spec->'sides') <> 'array'
     OR jsonb_typeof(template_row.spec->'rules') <> 'array' THEN
    RAISE EXCEPTION 'tenant template is not runnable' USING ERRCODE='22023';
  END IF;

  leg_count := jsonb_array_length(template_row.spec->'sides');
  SELECT count(*) INTO source_count FROM jsonb_array_elements(template_row.spec->'sides') side
  JOIN public.workspace_data_sources source
    ON source.id=(side->>'data_source_id')::uuid AND source.tenant_id=_tenant_id;
  IF source_count<>leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'template sources are unavailable in tenant' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(DISTINCT side->>'data_source_id') FROM jsonb_array_elements(template_row.spec->'sides') side) <> leg_count THEN
    RAISE EXCEPTION 'template source bindings must be distinct' USING ERRCODE='22023';
  END IF;

  SELECT created.id,created.recon_code INTO definition_row.id,definition_row.recon_code
  FROM public.create_recon_definition_with_owners(
    _tenant_id,btrim(_name),template_row.description,template_row.spec->>'recon_type',
    template_row.spec->'sides',template_row.spec->'rules',_owner_bu_ids
  ) AS created;
  IF definition_row.id IS NULL THEN RAISE EXCEPTION 'owner-bound creation returned no reconciliation'; END IF;

  UPDATE public.recon_definitions SET tenant_template_id=template_row.id
  WHERE id=definition_row.id AND tenant_id=_tenant_id
  RETURNING * INTO definition_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'created reconciliation was not readable in tenant'; END IF;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.tenant_template.instantiate','recon_definition',definition_row.id::text,
    jsonb_build_object('recon_code',definition_row.recon_code,'tenant_template_id',template_row.id,
      'semver',template_row.current_semver,'owner_bu_ids',_owner_bu_ids));
  INSERT INTO public.mkt_audit_log(actor_id,tenant_id,entity_type,entity_id,action,after)
  VALUES (actor,_tenant_id,'tenant_template',template_row.id,'instantiate',
    jsonb_build_object('recon_definition_id',definition_row.id,'recon_code',definition_row.recon_code,
      'owner_bu_ids',_owner_bu_ids));
  RETURN QUERY SELECT definition_row.id,definition_row.recon_code;
END
$function$;

-- Ownerless signatures are no longer callable by application roles; keeping
-- their old shapes revoked makes stale clients fail closed during cutover.
REVOKE ALL ON FUNCTION public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.instantiate_tenant_template_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb,uuid[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.instantiate_tenant_template_atomic(uuid,uuid,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb,uuid[]) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.instantiate_tenant_template_atomic(uuid,uuid,text,uuid[]) TO authenticated,service_role;

COMMENT ON FUNCTION public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb,uuid[]) IS
  'Installs a bound Starter Kit only when the caller supplies active same-tenant owning BUs; creation and ownership audit are atomic.';
COMMENT ON FUNCTION public.instantiate_tenant_template_atomic(uuid,uuid,text,uuid[]) IS
  'Instantiates a published tenant template only when the caller supplies active same-tenant owning BUs; creation and ownership audit are atomic.';
