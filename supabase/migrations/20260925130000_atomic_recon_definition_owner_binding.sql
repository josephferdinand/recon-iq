-- Atomic create and first-owner mapping. Direct authenticated table INSERT is
-- disabled; callers use the SECURITY DEFINER RPC, which creates the draft,
-- binds explicit same-tenant owner BUs, grants its creator draft capabilities,
-- audits the mapping, and only then exposes it as mapped_exact.

CREATE OR REPLACE FUNCTION private.recon_governance_is_active_analyst(_tenant uuid, _actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id = _tenant AND member_row.user_id = _actor
      AND member_row.active = true AND member_row.role::text = 'tenant_analyst'
  )
$function$;
REVOKE ALL ON FUNCTION private.recon_governance_is_active_analyst(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.recon_governance_is_active_analyst(uuid,uuid) TO authenticated, service_role;

-- Preserve the existing maker/checker trigger contract while admitting active
-- analysts only to the narrow development-draft INSERT used by the RPC and
-- the audited unmapped_pending -> mapped_exact transition with complete owner
-- rows. Legacy rows and all approval/promotion paths retain their old rules.
CREATE OR REPLACE FUNCTION public.tg_guard_recon_definition_governance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,extensions,pg_temp AS $$
DECLARE
  request_id uuid;
  request_row public.recon_definition_governance_requests%ROWTYPE;
  actor uuid := auth.uid();
  is_internal_transition boolean := false;
  retirement_transition boolean := false;
  owner_binding_transition boolean := false;
BEGIN
  IF TG_OP='INSERT' THEN
    request_id := nullif(current_setting('fvi.recon_governance_request_id',true),'')::uuid;
    IF request_id IS NOT NULL THEN
      SELECT * INTO request_row FROM public.recon_definition_governance_requests q WHERE q.id=request_id;
    END IF;
    IF NEW.access_mode <> 'unmapped_pending' OR NEW.environment='production'
       OR NOT (
         (NEW.governance_state='development_draft' AND NEW.created_by=actor
           AND (private.recon_governance_is_active_admin(NEW.tenant_id,actor)
             OR private.recon_governance_is_active_analyst(NEW.tenant_id,actor))
           AND NEW.governance_parent_id IS NULL
           AND NEW.staging_original_name IS NULL AND NEW.staging_generated_name IS NULL
           AND NOT NEW.multi_bu_governed)
         OR (NEW.governance_state='staging_copy'
           AND private.recon_governance_is_active_admin(NEW.tenant_id,actor)
           AND request_id IS NOT NULL
           AND request_row.request_kind='edit' AND request_row.status='approved'
           AND request_row.decided_by=actor AND request_row.tenant_id=NEW.tenant_id
           AND request_row.staging_definition_id IS NULL
           AND request_row.parent_definition_id=NEW.governance_parent_id
           AND NEW.staging_original_name IS NOT NULL AND NEW.staging_generated_name=NEW.name
           AND private.recon_governance_is_active_admin(NEW.tenant_id,actor))
       ) THEN
      RAISE EXCEPTION 'new reconciliation definitions must begin as unmapped development drafts'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.governance_parent_id IS DISTINCT FROM OLD.governance_parent_id
     OR NEW.staging_original_name IS DISTINCT FROM OLD.staging_original_name
     OR NEW.staging_generated_name IS DISTINCT FROM OLD.staging_generated_name THEN
    RAISE EXCEPTION 'reconciliation staging identity is immutable' USING ERRCODE='23514';
  END IF;

  IF OLD.access_mode='legacy_passthrough' THEN
    IF NEW.access_mode IS DISTINCT FROM OLD.access_mode
       OR NEW.governance_state IS DISTINCT FROM OLD.governance_state THEN
      RAISE EXCEPTION 'legacy reconciliation governance state requires an owner-reviewed cutover'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  owner_binding_transition := OLD.access_mode='unmapped_pending'
    AND NEW.access_mode='mapped_exact'
    AND OLD.governance_state='development_draft'
    AND NEW.governance_state='development_draft'
    AND OLD.environment='development' AND NEW.environment='development'
    AND OLD.multi_bu_governed=false AND NEW.multi_bu_governed=true
    AND (
      private.recon_governance_is_active_admin(OLD.tenant_id,actor)
      OR (OLD.created_by=actor
        AND private.recon_governance_is_active_analyst(OLD.tenant_id,actor)
        AND NOT EXISTS (
          SELECT 1 FROM public.recon_definition_business_units owner_row
          WHERE owner_row.tenant_id=OLD.tenant_id AND owner_row.recon_id=OLD.id
            AND EXISTS (
              SELECT 1 FROM unnest(ARRAY['view','edit','run']::text[]) required_action(action_name)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.recon_definition_bu_grants grant_row
                WHERE grant_row.tenant_id=owner_row.tenant_id AND grant_row.recon_id=owner_row.recon_id
                  AND grant_row.bu_id=owner_row.bu_id AND grant_row.principal_type='user'
                  AND grant_row.principal_id=actor AND grant_row.action=required_action.action_name
              )
            )
        )
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.recon_definition_business_units owner_row
      JOIN public.business_units owner_unit
        ON owner_unit.id=owner_row.bu_id AND owner_unit.tenant_id=owner_row.tenant_id
      WHERE owner_row.tenant_id=OLD.tenant_id AND owner_row.recon_id=OLD.id
        AND NOT owner_unit.is_archived
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.recon_definition_business_units owner_row
      LEFT JOIN public.business_units owner_unit
        ON owner_unit.id=owner_row.bu_id AND owner_unit.tenant_id=owner_row.tenant_id
      WHERE owner_row.tenant_id=OLD.tenant_id AND owner_row.recon_id=OLD.id
        AND (owner_unit.id IS NULL OR owner_unit.is_archived)
    );

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.bu_id IS DISTINCT FROM OLD.bu_id OR NEW.visibility IS DISTINCT FROM OLD.visibility
     OR (NEW.multi_bu_governed IS DISTINCT FROM OLD.multi_bu_governed AND NOT owner_binding_transition) THEN
    RAISE EXCEPTION 'reconciliation identity and access metadata are immutable outside the reviewed Access cutover'
      USING ERRCODE='23514';
  END IF;
  IF OLD.access_mode IS DISTINCT FROM NEW.access_mode AND NOT owner_binding_transition THEN
    RAISE EXCEPTION 'reconciliation access mode requires an owner-reviewed Access cutover'
      USING ERRCODE='23514';
  END IF;

  request_id := nullif(current_setting('fvi.recon_governance_request_id',true),'')::uuid;
  IF request_id IS NOT NULL THEN
    SELECT * INTO request_row FROM public.recon_definition_governance_requests q WHERE q.id=request_id;
    IF FOUND AND request_row.tenant_id=OLD.tenant_id
       AND request_row.decided_by=actor
       AND private.recon_governance_is_active_admin(OLD.tenant_id,actor) THEN
      is_internal_transition := true;
    ELSIF FOUND AND request_row.tenant_id=OLD.tenant_id
       AND request_row.status='pending' AND request_row.requested_by=actor
       AND request_row.request_kind IN ('edit','promotion')
       AND private.recon_governance_is_active_admin(OLD.tenant_id,actor) THEN
      is_internal_transition := true;
    END IF;
  END IF;

  IF NEW.governance_state IS DISTINCT FROM OLD.governance_state THEN
    IF NOT is_internal_transition THEN
      RAISE EXCEPTION 'reconciliation governance state changes require a verified workflow request'
        USING ERRCODE='23514';
    END IF;
    IF NOT COALESCE((
      (request_row.request_kind='edit' AND request_row.status='pending'
        AND request_row.requested_by=actor AND request_row.parent_definition_id=OLD.id
        AND OLD.governance_state='approved_locked' AND NEW.governance_state='edit_request_pending')
      OR (request_row.request_kind='edit' AND request_row.status='approved'
        AND request_row.decided_by=actor AND request_row.parent_definition_id=OLD.id
        AND OLD.governance_state='edit_request_pending' AND NEW.governance_state='approved_locked')
      OR (request_row.request_kind='edit' AND request_row.status='rejected'
        AND request_row.decided_by=actor AND request_row.parent_definition_id=OLD.id
        AND OLD.governance_state='edit_request_pending' AND NEW.governance_state='approved_locked')
      OR (request_row.request_kind='promotion' AND request_row.status='pending'
        AND request_row.requested_by=actor AND request_row.staging_definition_id=OLD.id
        AND OLD.governance_state IN ('development_draft','staging_copy')
        AND NEW.governance_state='promotion_request_pending')
      OR (request_row.request_kind='promotion' AND request_row.status='approved'
        AND request_row.decided_by=actor AND request_row.staging_definition_id=OLD.id
        AND OLD.governance_state='promotion_request_pending'
        AND NEW.governance_state IN ('approved_locked','promoted'))
      OR (request_row.request_kind='promotion' AND request_row.status='rejected'
        AND request_row.decided_by=actor AND request_row.staging_definition_id=OLD.id
        AND OLD.governance_state='promotion_request_pending'
        AND NEW.governance_state IN ('development_draft','staging_copy'))
    ),false) THEN
      RAISE EXCEPTION 'invalid reconciliation governance transition' USING ERRCODE='23514';
    END IF;
  END IF;

  IF OLD.governance_state='approved_locked' THEN
    retirement_transition := NEW.status='archived' AND OLD.status='active'
      AND NEW.retired_at IS NOT NULL AND NEW.retirement_request_id IS NOT NULL
      AND NEW.governance_state=OLD.governance_state AND NEW.access_mode=OLD.access_mode
      AND NEW.environment=OLD.environment AND NEW.name=OLD.name AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.recon_type=OLD.recon_type AND NEW.sides=OLD.sides AND NEW.rules=OLD.rules
      AND NEW.extension=OLD.extension AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
      AND EXISTS (SELECT 1 FROM public.recon_retirement_requests rr WHERE rr.id=NEW.retirement_request_id
        AND rr.tenant_id=OLD.tenant_id AND rr.recon_id=OLD.id AND rr.status='approved'
        AND rr.decided_by=actor AND rr.requested_by<>actor AND rr.decided_at IS NOT NULL);
    IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.recon_type IS DISTINCT FROM OLD.recon_type OR NEW.sides IS DISTINCT FROM OLD.sides
        OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.extension IS DISTINCT FROM OLD.extension
        OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.status IS DISTINCT FROM OLD.status)
       AND NOT retirement_transition AND NOT (is_internal_transition AND request_row.request_kind='promotion'
         AND request_row.status='approved' AND request_row.parent_definition_id=OLD.id
         AND request_row.snapshot IS NOT NULL
         AND request_row.snapshot_sha256=encode(extensions.digest(convert_to(request_row.snapshot::text,'UTF8'),'sha256'),'hex')
         AND NEW.name=request_row.snapshot->>'name'
         AND NEW.description IS NOT DISTINCT FROM request_row.snapshot->>'description'
         AND NEW.recon_type=request_row.snapshot->>'recon_type'
         AND NEW.sides=request_row.snapshot->'sides' AND NEW.rules=request_row.snapshot->'rules'
         AND NEW.extension=request_row.snapshot->'extension'
         AND NEW.environment='production' AND NEW.status='active') THEN
      RAISE EXCEPTION 'approved reconciliation definitions are locked; use the maker-checker workflow'
        USING ERRCODE='23514';
    END IF;
  ELSIF OLD.governance_state IN ('edit_request_pending','promotion_request_pending','promoted') THEN
    IF NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.recon_type IS DISTINCT FROM OLD.recon_type OR NEW.sides IS DISTINCT FROM OLD.sides
       OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.extension IS DISTINCT FROM OLD.extension
       OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.governance_state='promotion_request_pending' AND OLD.id=NEW.id
        AND request_row.request_kind='promotion' AND request_row.status='approved'
        AND request_row.staging_definition_id=OLD.id AND request_row.parent_definition_id=OLD.id
        AND request_row.snapshot_sha256=encode(extensions.digest(convert_to(request_row.snapshot::text,'UTF8'),'sha256'),'hex')
        AND NEW.name=request_row.snapshot->>'name'
        AND NEW.description IS NOT DISTINCT FROM request_row.snapshot->>'description'
        AND NEW.recon_type=request_row.snapshot->>'recon_type'
        AND NEW.sides=request_row.snapshot->'sides' AND NEW.rules=request_row.snapshot->'rules'
        AND NEW.extension=request_row.snapshot->'extension'
        AND NEW.environment='production' AND NEW.status='active') THEN
        RAISE EXCEPTION 'pending or promoted reconciliation definitions are immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF OLD.governance_state IN ('development_draft','staging_copy') THEN
    IF NEW.environment IS DISTINCT FROM OLD.environment OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'draft environment and business status are controlled by governance' USING ERRCODE='23514';
    END IF;
    IF OLD.governance_state='staging_copy' AND NOT private.recon_governance_is_active_admin(OLD.tenant_id,actor) THEN
      RAISE EXCEPTION 'staging edits currently require an active tenant administrator' USING ERRCODE='42501';
    END IF;
  END IF;

  IF NEW.environment='production' AND NEW.governance_state NOT IN ('approved_locked','edit_request_pending') THEN
    RAISE EXCEPTION 'production environment requires an approved locked version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.create_recon_definition_with_owners(
  _tenant_id uuid,
  _name text,
  _description text,
  _recon_type text,
  _sides jsonb,
  _rules jsonb,
  _owner_bu_ids uuid[]
)
RETURNS TABLE (id uuid, recon_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_bu_ids uuid[];
  v_source_ids uuid[];
  v_source_count integer;
  v_side_count integer;
  v_definition_id uuid;
  v_recon_code text;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR length(btrim(coalesce(_name,''))) NOT BETWEEN 1 AND 200
     OR _recon_type IS NULL OR _recon_type NOT IN ('one_sided','two_sided','three_sided')
     OR jsonb_typeof(coalesce(_sides,'[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_rules,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid reconciliation creation request' USING ERRCODE='22023';
  END IF;
  v_side_count := jsonb_array_length(coalesce(_sides,'[]'::jsonb));
  IF v_side_count <> (CASE _recon_type WHEN 'one_sided' THEN 1 WHEN 'two_sided' THEN 2 ELSE 3 END)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_sides,'[]'::jsonb)) side
       WHERE nullif(side->>'data_source_id','') IS NULL
          OR (nullif(side->>'upload_id','') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.workspace_data_source_uploads upload_row
              WHERE upload_row.id=(side->>'upload_id')::uuid
                AND upload_row.tenant_id=_tenant_id
                AND upload_row.data_source_id=(side->>'data_source_id')::uuid
            ))
     ) THEN
    RAISE EXCEPTION 'source bindings must be complete and belong to this workspace' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(array_agg(DISTINCT nullif(side->>'data_source_id','')::uuid
                            ORDER BY nullif(side->>'data_source_id','')::uuid),ARRAY[]::uuid[])
  INTO v_source_ids
  FROM jsonb_array_elements(coalesce(_sides,'[]'::jsonb)) side;
  SELECT count(DISTINCT source_row.id) INTO v_source_count
  FROM public.workspace_data_sources source_row
  WHERE source_row.tenant_id=_tenant_id AND source_row.id=ANY(v_source_ids);
  IF v_source_count <> cardinality(v_source_ids) THEN
    RAISE EXCEPTION 'one or more reconciliation sources are unavailable in this workspace' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id=_tenant_id AND member_row.user_id=v_actor
      AND member_row.active AND member_row.role::text='tenant_admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin AND NOT private.recon_governance_is_active_analyst(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator or analyst required' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id), ARRAY[]::uuid[])
  INTO v_bu_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_bu_ids)=0 THEN
    RAISE EXCEPTION 'at least one owning business unit is required' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    LEFT JOIN public.business_units bu
      ON bu.id=requested.bu_id AND bu.tenant_id=_tenant_id
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'owning business units must be active and belong to the reconciliation tenant' USING ERRCODE='22023';
  END IF;
  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_bu
        ON assigned_bu.id=assignment.bu_id AND assigned_bu.tenant_id=assignment.tenant_id
        AND NOT assigned_bu.is_archived
      JOIN public.business_units owner_bu
        ON owner_bu.id=requested.bu_id AND owner_bu.tenant_id=assignment.tenant_id
        AND NOT owner_bu.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=v_actor
        AND (owner_bu.id=assigned_bu.id
          OR (assignment.inherit_descendants AND owner_bu.path <@ assigned_bu.path))
    )
  ) THEN
    RAISE EXCEPTION 'analyst must be assigned to every selected owning business unit' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.recon_definitions(
    tenant_id,name,description,recon_type,sides,rules,status,created_by,
    governance_state,access_mode,multi_bu_governed
  ) VALUES (
    _tenant_id,btrim(_name),nullif(btrim(coalesce(_description,'')),''),_recon_type,
    coalesce(_sides,'[]'::jsonb),coalesce(_rules,'[]'::jsonb),'draft',v_actor,
    'development_draft','unmapped_pending',false
  ) RETURNING recon_definitions.id,recon_definitions.recon_code
    INTO v_definition_id,v_recon_code;

  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by)
  SELECT _tenant_id,v_definition_id,owner_id,v_actor FROM unnest(v_bu_ids) owner_id;

  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (
    _tenant_id,v_definition_id,'replace_owners',v_actor,
    'Atomic definition creation owner binding',
    jsonb_build_object('previous_bu_ids',ARRAY[]::uuid[],'new_bu_ids',v_bu_ids,'source','atomic_create')
  );

  -- Active tenant admins have the authoritative in-tenant override and may
  -- not have per-BU assignments. Analysts were checked above for every owner
  -- BU, so grant only their explicit draft capabilities.
  IF NOT v_is_admin THEN
    INSERT INTO public.recon_definition_bu_grants(
      tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by
    )
    SELECT _tenant_id,v_definition_id,owner_id,'user',v_actor,action_name,v_actor
    FROM unnest(v_bu_ids) owner_id
    CROSS JOIN unnest(ARRAY['view','edit','run']::text[]) action_name;
  END IF;

  UPDATE public.recon_definitions
  SET access_mode='mapped_exact',multi_bu_governed=true
  WHERE recon_definitions.id=v_definition_id AND recon_definitions.tenant_id=_tenant_id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (
    v_actor,_tenant_id,'workspace','recon.create','recon_definition',v_definition_id::text,
    jsonb_build_object('recon_code',v_recon_code,'name',btrim(_name),'type',_recon_type,
      'owner_bu_ids',v_bu_ids)
  );

  RETURN QUERY SELECT v_definition_id,v_recon_code;
END
$function$;

CREATE OR REPLACE FUNCTION public.map_recon_definition_owners(
  _recon_id uuid,
  _owner_bu_ids uuid[],
  _reason text
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_existing uuid[];
  v_bu_ids uuid[];
BEGIN
  IF v_actor IS NULL OR _recon_id IS NULL OR _reason IS NULL
     OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid reconciliation owner mapping request' USING ERRCODE='22023';
  END IF;
  SELECT definition_row.tenant_id INTO v_tenant
  FROM public.recon_definitions definition_row
  WHERE definition_row.id=_recon_id FOR UPDATE;
  IF v_tenant IS NULL OR NOT private.recon_governance_is_active_admin(v_tenant,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.recon_definitions definition_row
    WHERE definition_row.id=_recon_id AND definition_row.tenant_id=v_tenant
      AND definition_row.access_mode='unmapped_pending'
      AND definition_row.governance_state='development_draft'
      AND definition_row.environment='development'
      AND NOT definition_row.multi_bu_governed
  ) THEN
    RAISE EXCEPTION 'only an unmapped development draft can receive its first owner mapping' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recon_definition_bu_grants WHERE tenant_id=v_tenant AND recon_id=_recon_id) THEN
    RAISE EXCEPTION 'revoke unreviewed grants before the first owner mapping' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id),ARRAY[]::uuid[])
  INTO v_bu_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_bu_ids)=0 OR EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    LEFT JOIN public.business_units bu ON bu.id=requested.bu_id AND bu.tenant_id=v_tenant
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'at least one active same-tenant owning business unit is required' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
  INTO v_existing FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=v_tenant AND owner_row.recon_id=_recon_id;
  IF cardinality(v_existing)>0 THEN
    RAISE EXCEPTION 'definition already has shadow owner rows; review them before mapping' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by)
  SELECT v_tenant,_recon_id,owner_id,v_actor FROM unnest(v_bu_ids) owner_id;
  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (
    v_tenant,_recon_id,'replace_owners',v_actor,btrim(_reason),
    jsonb_build_object('previous_bu_ids',v_existing,'new_bu_ids',v_bu_ids,'source','first_owner_mapping')
  );
  UPDATE public.recon_definitions
  SET access_mode='mapped_exact',multi_bu_governed=true
  WHERE id=_recon_id AND tenant_id=v_tenant;
  RETURN v_bu_ids;
END
$function$;

REVOKE ALL ON FUNCTION public.create_recon_definition_with_owners(uuid,text,text,text,jsonb,jsonb,uuid[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.map_recon_definition_owners(uuid,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_recon_definition_with_owners(uuid,text,text,text,jsonb,jsonb,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.map_recon_definition_owners(uuid,uuid[],text) TO authenticated;

-- A root created without owner BUs can no longer be inserted by an
-- authenticated table client. The RPC above is the only authenticated create
-- path and returns only the requested identity fields, independent of RLS
-- visibility during PostgREST INSERT ... RETURNING evaluation.
REVOKE INSERT ON public.recon_definitions FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.create_recon_definition_with_owners(uuid,text,text,text,jsonb,jsonb,uuid[]) IS
  'Atomically creates a development draft with explicit same-tenant owner BUs and creator view/edit/run grants; returns id/code without relying on INSERT RETURNING RLS.';
COMMENT ON FUNCTION public.map_recon_definition_owners(uuid,uuid[],text) IS
  'Atomically binds first owner BUs and maps an existing unmapped development draft; active tenant-admin only, immutable history retained.';
