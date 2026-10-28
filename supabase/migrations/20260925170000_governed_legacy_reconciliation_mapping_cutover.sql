-- Additive per-definition cutover for the owner-authorized synthetic PROD
-- Assurance records. Legacy bu_id/status/config/history are retained; the new
-- legacy_mapped state means Access is mapped while definition content remains
-- unreviewed and immutable pending a separate governed edit workflow.

ALTER TABLE public.recon_definitions
  DROP CONSTRAINT IF EXISTS recon_definitions_governance_state_check;
ALTER TABLE public.recon_definitions
  ADD CONSTRAINT recon_definitions_governance_state_check
  CHECK (governance_state IN ('legacy_unreviewed','legacy_mapped','development_draft','staging_copy',
    'edit_request_pending','promotion_request_pending','approved_locked','promoted'));

ALTER TABLE public.recon_definition_bu_admin_audit
  DROP CONSTRAINT IF EXISTS recon_definition_bu_admin_audit_operation_check;
ALTER TABLE public.recon_definition_bu_admin_audit
  ADD CONSTRAINT recon_definition_bu_admin_audit_operation_check
  CHECK (operation IN ('replace_owners','grant_action','revoke_action','map_legacy'));

CREATE TABLE private.recon_legacy_mapping_cutover_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  owner_bu_ids uuid[] NOT NULL,
  maker_user_id uuid NOT NULL,
  checker_user_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (maker_user_id <> checker_user_id),
  UNIQUE (transaction_id, tenant_id, recon_id)
);
ALTER TABLE private.recon_legacy_mapping_cutover_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.recon_legacy_mapping_cutover_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reject_recon_legacy_mapping_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION 'legacy mapping cutover receipts are immutable';
END
$function$;
CREATE TRIGGER recon_legacy_mapping_receipt_immutable
  BEFORE UPDATE OR DELETE ON private.recon_legacy_mapping_cutover_receipts
  FOR EACH ROW EXECUTE FUNCTION private.reject_recon_legacy_mapping_receipt_mutation();
REVOKE ALL ON FUNCTION private.reject_recon_legacy_mapping_receipt_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.recon_legacy_mapping_transition_authorized(
  _tenant_id uuid, _recon_id uuid, _actor_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM private.recon_legacy_mapping_cutover_receipts receipt
    WHERE receipt.transaction_id = txid_current()
      AND receipt.tenant_id = _tenant_id AND receipt.recon_id = _recon_id
      AND receipt.actor_id = _actor_id
      AND receipt.owner_bu_ids = ARRAY(
        SELECT owner_row.bu_id
        FROM public.recon_definition_business_units owner_row
        WHERE owner_row.tenant_id = _tenant_id AND owner_row.recon_id = _recon_id
        ORDER BY owner_row.bu_id
      )
  )
$function$;
REVOKE ALL ON FUNCTION private.recon_legacy_mapping_transition_authorized(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Patch only the legacy branch of the existing guard, preserving the rest of
-- its current reviewed trigger logic. Fail migration if the expected source is
-- not present so an upstream trigger edit cannot be silently overwritten.
DO $migration$
DECLARE
  v_definition text := pg_get_functiondef('public.tg_guard_recon_definition_governance()'::regprocedure);
  v_replacement text := $new$IF OLD.access_mode='legacy_passthrough' THEN
    IF NEW.access_mode IS DISTINCT FROM OLD.access_mode
       OR NEW.governance_state IS DISTINCT FROM OLD.governance_state
       OR NEW.multi_bu_governed IS DISTINCT FROM OLD.multi_bu_governed THEN
      IF NOT (
        NEW.access_mode='mapped_exact' AND NEW.governance_state='legacy_mapped'
        AND OLD.governance_state='legacy_unreviewed'
        AND NEW.multi_bu_governed=true AND OLD.multi_bu_governed=false
        AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
        AND NEW.status IS NOT DISTINCT FROM OLD.status
        AND NEW.bu_id IS NOT DISTINCT FROM OLD.bu_id
        AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility
        AND NEW.environment IS NOT DISTINCT FROM OLD.environment
        AND NEW.name IS NOT DISTINCT FROM OLD.name
        AND NEW.description IS NOT DISTINCT FROM OLD.description
        AND NEW.recon_type IS NOT DISTINCT FROM OLD.recon_type
        AND NEW.sides IS NOT DISTINCT FROM OLD.sides
        AND NEW.rules IS NOT DISTINCT FROM OLD.rules
        AND NEW.extension IS NOT DISTINCT FROM OLD.extension
        AND NEW.retired_at IS NOT DISTINCT FROM OLD.retired_at
        AND NEW.retirement_request_id IS NOT DISTINCT FROM OLD.retirement_request_id
        AND NEW.governance_parent_id IS NOT DISTINCT FROM OLD.governance_parent_id
        AND NEW.staging_original_name IS NOT DISTINCT FROM OLD.staging_original_name
        AND NEW.staging_generated_name IS NOT DISTINCT FROM OLD.staging_generated_name
        AND NEW.starter_template_id IS NOT DISTINCT FROM OLD.starter_template_id
        AND NEW.starter_template_code IS NOT DISTINCT FROM OLD.starter_template_code
        AND NEW.starter_template_snapshot IS NOT DISTINCT FROM OLD.starter_template_snapshot
        AND NEW.tenant_template_id IS NOT DISTINCT FROM OLD.tenant_template_id
        AND private.recon_legacy_mapping_transition_authorized(OLD.tenant_id,OLD.id,auth.uid())
      ) THEN
        RAISE EXCEPTION 'legacy reconciliation governance state requires an owner-reviewed cutover'
          USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    RETURN NEW;
  END IF;$new$;
  v_legacy_mapped_branch text := $branch$  IF OLD.governance_state='legacy_mapped' THEN
    IF NEW.governance_state IS DISTINCT FROM OLD.governance_state
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.environment IS DISTINCT FROM OLD.environment
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.recon_type IS DISTINCT FROM OLD.recon_type
       OR NEW.sides IS DISTINCT FROM OLD.sides
       OR NEW.rules IS DISTINCT FROM OLD.rules
       OR NEW.extension IS DISTINCT FROM OLD.extension
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
       OR NEW.retirement_request_id IS DISTINCT FROM OLD.retirement_request_id
       OR NEW.starter_template_id IS DISTINCT FROM OLD.starter_template_id
       OR NEW.starter_template_code IS DISTINCT FROM OLD.starter_template_code
       OR NEW.starter_template_snapshot IS DISTINCT FROM OLD.starter_template_snapshot
       OR NEW.tenant_template_id IS DISTINCT FROM OLD.tenant_template_id THEN
      RAISE EXCEPTION 'mapped legacy reconciliation content is immutable pending governed review'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

$branch$;
  v_start integer;
  v_end integer;
  v_insert_at integer;
  v_needle text := 'request_id := nullif(current_setting(''fvi.recon_governance_request_id'',true),'''')::uuid;';
BEGIN
  v_start := position('IF OLD.access_mode=''legacy_passthrough'' THEN' IN v_definition);
  v_end := position('owner_binding_transition := OLD.access_mode' IN v_definition);
  IF v_start=0 OR v_end<=v_start THEN
    RAISE EXCEPTION 'expected reconciliation governance legacy branch was not found';
  END IF;
  v_definition := substring(v_definition FROM 1 FOR v_start-1)
    || v_replacement || E'\n\n  ' || substring(v_definition FROM v_end);
  v_start := position('owner_binding_transition := OLD.access_mode' IN v_definition);
  v_insert_at := v_start + position(v_needle IN substring(v_definition FROM v_start)) - 1;
  IF v_start=0 OR v_insert_at<v_start THEN RAISE EXCEPTION 'expected reconciliation governance workflow block was not found'; END IF;
  v_definition := overlay(v_definition placing v_legacy_mapped_branch from v_insert_at for 0);
  EXECUTE v_definition;
END
$migration$;

-- A mapped legacy definition may run only through the actor-bound decision
-- helper. This keeps the legacy run-trigger exception scoped to passthrough.
DO $migration$
DECLARE
  v_definition text := pg_get_functiondef('public.tg_guard_recon_run_governance()'::regprocedure);
  v_old text := $old$  IF d.governance_state='legacy_unreviewed' AND d.access_mode='legacy_passthrough' THEN RETURN NEW; END IF;$old$;
  v_new text := $new$  IF d.governance_state='legacy_unreviewed' AND d.access_mode='legacy_passthrough' THEN RETURN NEW; END IF;
  IF d.governance_state='legacy_mapped' AND d.access_mode='mapped_exact'
     AND NEW.run_by=auth.uid()
     AND private.recon_authoritative_access_decision(d.id,'run') THEN
    RETURN NEW;
  END IF;$new$;
BEGIN
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'expected legacy reconciliation run branch was not found';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END
$migration$;

CREATE OR REPLACE FUNCTION public.cutover_legacy_recon_definition_mapping(
  _tenant_id uuid,
  _recon_id uuid,
  _owner_bu_ids uuid[],
  _maker_user_id uuid,
  _checker_user_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_definition public.recon_definitions%ROWTYPE;
  v_owner_ids uuid[];
  v_existing_owner_ids uuid[];
  v_maker_role text;
  v_checker_role text;
  v_receipt_id uuid;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _recon_id IS NULL
     OR _maker_user_id IS NULL OR _checker_user_id IS NULL
     OR _maker_user_id=_checker_user_id OR v_actor IN (_maker_user_id,_checker_user_id)
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid legacy mapping cutover request' USING ERRCODE='22023';
  END IF;
  IF NOT private.recon_governance_is_active_admin(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active same-tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id=_recon_id AND d.tenant_id=_tenant_id
  FOR UPDATE;
  IF NOT FOUND OR v_definition.access_mode<>'legacy_passthrough'
     OR v_definition.governance_state<>'legacy_unreviewed'
     OR v_definition.multi_bu_governed THEN
    RAISE EXCEPTION 'definition is not an unmapped legacy reconciliation' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT requested.bu_id ORDER BY requested.bu_id),ARRAY[]::uuid[])
  INTO v_owner_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) requested(bu_id);
  IF cardinality(v_owner_ids)=0 OR cardinality(v_owner_ids)<>cardinality(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'one or more distinct owner business units are required' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
  INTO v_existing_owner_ids
  FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=_recon_id;
  IF v_existing_owner_ids IS DISTINCT FROM v_owner_ids OR cardinality(v_existing_owner_ids)<>cardinality(v_owner_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
       LEFT JOIN public.business_units owner_unit
         ON owner_unit.id=requested.bu_id AND owner_unit.tenant_id=_tenant_id
       WHERE owner_unit.id IS NULL OR owner_unit.is_archived
     ) THEN
    RAISE EXCEPTION 'owner links must exactly match active same-tenant business units' USING ERRCODE='42501';
  END IF;
  -- Serialize owner replacement and grant revocation/insertion across the
  -- validation-to-transition interval. The parent definition lock above also
  -- serializes set_recon_owners, which locks that row before changing links.
  PERFORM owner_row.bu_id
  FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=_recon_id
  ORDER BY owner_row.bu_id FOR UPDATE;
  PERFORM grant_row.id
  FROM public.recon_definition_bu_grants grant_row
  WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
  ORDER BY grant_row.id FOR SHARE;

  SELECT tm.role::text INTO v_maker_role FROM public.tenant_members tm
  WHERE tm.tenant_id=_tenant_id AND tm.user_id=_maker_user_id AND tm.active;
  SELECT tm.role::text INTO v_checker_role FROM public.tenant_members tm
  WHERE tm.tenant_id=_tenant_id AND tm.user_id=_checker_user_id AND tm.active;
  IF v_maker_role IS NULL OR v_checker_role IS NULL THEN
    RAISE EXCEPTION 'maker and checker must be active members of the same tenant' USING ERRCODE='42501';
  END IF;

  -- Each synthetic actor needs current assignment to every owner BU and a
  -- reviewed direct-user or assigned same-tenant group grant for every action.
  IF EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) owner(bu_id)
    CROSS JOIN unnest(ARRAY['view','run','edit']::text[]) needed(action_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_unit ON assigned_unit.id=assignment.bu_id
        AND assigned_unit.tenant_id=assignment.tenant_id AND NOT assigned_unit.is_archived
      JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
        AND owner_unit.tenant_id=assignment.tenant_id AND NOT owner_unit.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=_maker_user_id
        AND (assigned_unit.id=owner_unit.id OR
             (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recon_definition_bu_grants grant_row
      WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
        AND grant_row.bu_id=owner.bu_id AND grant_row.action=needed.action_name
        AND ((grant_row.principal_type='user' AND grant_row.principal_id=_maker_user_id)
          OR (grant_row.principal_type='group' AND EXISTS (
            SELECT 1 FROM public.tenant_groups group_row
            JOIN public.tenant_group_members group_member ON group_member.group_id=group_row.id
              AND group_member.user_id=_maker_user_id
            JOIN public.tenant_members active_member ON active_member.tenant_id=_tenant_id
              AND active_member.user_id=group_member.user_id AND active_member.active
            JOIN public.bu_group_assignments group_assignment ON group_assignment.tenant_id=_tenant_id
              AND group_assignment.group_id=group_row.id
            JOIN public.business_units assigned_unit ON assigned_unit.id=group_assignment.bu_id
              AND assigned_unit.tenant_id=group_assignment.tenant_id AND NOT assigned_unit.is_archived
            JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
              AND owner_unit.tenant_id=group_assignment.tenant_id AND NOT owner_unit.is_archived
            WHERE group_row.id=grant_row.principal_id AND group_row.tenant_id=_tenant_id
              AND (assigned_unit.id=owner_unit.id OR
                   (group_assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
          )))
    )
  ) OR EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) owner(bu_id)
    CROSS JOIN unnest(ARRAY['view','approve']::text[]) needed(action_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_unit ON assigned_unit.id=assignment.bu_id
        AND assigned_unit.tenant_id=assignment.tenant_id AND NOT assigned_unit.is_archived
      JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
        AND owner_unit.tenant_id=assignment.tenant_id AND NOT owner_unit.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=_checker_user_id
        AND (assigned_unit.id=owner_unit.id OR
             (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recon_definition_bu_grants grant_row
      WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
        AND grant_row.bu_id=owner.bu_id AND grant_row.action=needed.action_name
        AND ((grant_row.principal_type='user' AND grant_row.principal_id=_checker_user_id)
          OR (grant_row.principal_type='group' AND EXISTS (
            SELECT 1 FROM public.tenant_groups group_row
            JOIN public.tenant_group_members group_member ON group_member.group_id=group_row.id
              AND group_member.user_id=_checker_user_id
            JOIN public.tenant_members active_member ON active_member.tenant_id=_tenant_id
              AND active_member.user_id=group_member.user_id AND active_member.active
            JOIN public.bu_group_assignments group_assignment ON group_assignment.tenant_id=_tenant_id
              AND group_assignment.group_id=group_row.id
            JOIN public.business_units assigned_unit ON assigned_unit.id=group_assignment.bu_id
              AND assigned_unit.tenant_id=group_assignment.tenant_id AND NOT assigned_unit.is_archived
            JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
              AND owner_unit.tenant_id=group_assignment.tenant_id AND NOT owner_unit.is_archived
            WHERE group_row.id=grant_row.principal_id AND group_row.tenant_id=_tenant_id
              AND (assigned_unit.id=owner_unit.id OR
                   (group_assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
          )))
    )
  ) THEN
    RAISE EXCEPTION 'maker/checker assignments and reviewed grants are incomplete' USING ERRCODE='42501';
  END IF;

  INSERT INTO private.recon_legacy_mapping_cutover_receipts(
    tenant_id,recon_id,actor_id,owner_bu_ids,maker_user_id,checker_user_id,reason
  ) VALUES (_tenant_id,_recon_id,v_actor,v_owner_ids,_maker_user_id,_checker_user_id,btrim(_reason))
  RETURNING id INTO v_receipt_id;
  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (_tenant_id,_recon_id,'map_legacy',v_actor,btrim(_reason),jsonb_build_object(
    'receipt_id',v_receipt_id,'owner_bu_ids',v_owner_ids,'maker_user_id',_maker_user_id,
    'maker_actions',ARRAY['view','run','edit'],'checker_user_id',_checker_user_id,
    'checker_actions',ARRAY['view','approve'],'previous_access_mode',v_definition.access_mode,
    'previous_governance_state',v_definition.governance_state,'new_access_mode','mapped_exact',
    'new_governance_state','legacy_mapped','status_preserved',v_definition.status,
    'legacy_bu_id_preserved',v_definition.bu_id,'scope','owner_authorized_synthetic_assurance'
  ));
  UPDATE public.recon_definitions
  SET access_mode='mapped_exact', governance_state='legacy_mapped', multi_bu_governed=true
  WHERE id=_recon_id AND tenant_id=_tenant_id
    AND access_mode='legacy_passthrough' AND governance_state='legacy_unreviewed';
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy definition changed during mapping cutover'; END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,'workspace','recon.legacy_mapping.cutover','recon_definition',_recon_id::text,
    jsonb_build_object('receipt_id',v_receipt_id,'recon_code',v_definition.recon_code,
      'owner_bu_ids',v_owner_ids,'maker_user_id',_maker_user_id,'checker_user_id',_checker_user_id,
      'reason',btrim(_reason),'status_preserved',v_definition.status,
      'legacy_bu_id_preserved',v_definition.bu_id,'governance_state','legacy_mapped'));
  RETURN jsonb_build_object('recon_id',_recon_id,'recon_code',v_definition.recon_code,
    'access_mode','mapped_exact','governance_state','legacy_mapped','status',v_definition.status,
    'legacy_bu_id',v_definition.bu_id,'owner_bu_ids',v_owner_ids,'audit_receipt_id',v_receipt_id);
END
$function$;
REVOKE ALL ON FUNCTION public.cutover_legacy_recon_definition_mapping(uuid,uuid,uuid[],uuid,uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cutover_legacy_recon_definition_mapping(uuid,uuid,uuid[],uuid,uuid,text) TO authenticated;
COMMENT ON FUNCTION public.cutover_legacy_recon_definition_mapping(uuid,uuid,uuid[],uuid,uuid,text) IS
  'Atomically maps one legacy definition after verifying an active same-tenant tenant administrator, exact active owner BU links, actor separation, current BU assignments and direct/group action grants; preserves status, history and legacy bu_id.';

CREATE OR REPLACE FUNCTION public.cutover_assurance_synthetic_recon_mapping(
  _tenant_id uuid,
  _recon_id uuid,
  _owner_bu_ids uuid[],
  _maker_user_id uuid,
  _checker_user_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE v_code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=_tenant_id
      AND t.slug::text='falcon-veritas-assurance-lab-prod') THEN
    RAISE EXCEPTION 'definition is outside the approved synthetic Assurance tenant' USING ERRCODE='42501';
  END IF;
  SELECT d.recon_code INTO v_code FROM public.recon_definitions d
  WHERE d.id=_recon_id AND d.tenant_id=_tenant_id FOR UPDATE;
  IF v_code IS NULL OR v_code NOT IN (
    'FVI-GEN-2WAY-000008','FVI-GEN-2WAY-000007','FVI-GEN-1WAY-000003','FVI-GEN-2WAY-000006',
    'FVI-GEN-1WAY-000004','FVI-GEN-1WAY-000002','FVI-GEN-3WAY-000006','FVI-GEN-1WAY-000001',
    'FVI-GEN-2WAY-000005','FVI-GEN-2WAY-000001','FVI-GEN-2WAY-000002','FVI-GEN-2WAY-000003',
    'FVI-GEN-3WAY-000001','FVI-GEN-3WAY-000002','FVI-GEN-2WAY-000004','FVI-GEN-3WAY-000003',
    'FVI-GEN-3WAY-000004','FVI-GEN-3WAY-000005','FVI-GEN-2WAY-000009','FVI-GEN-2WAY-000010'
  ) THEN
    RAISE EXCEPTION 'definition is outside the approved synthetic Assurance mapping list' USING ERRCODE='42501';
  END IF;
  RETURN public.cutover_legacy_recon_definition_mapping(
    _tenant_id,_recon_id,_owner_bu_ids,_maker_user_id,_checker_user_id,_reason
  );
END
$function$;
REVOKE ALL ON FUNCTION public.cutover_assurance_synthetic_recon_mapping(uuid,uuid,uuid[],uuid,uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cutover_assurance_synthetic_recon_mapping(uuid,uuid,uuid[],uuid,uuid,text) TO authenticated;
COMMENT ON FUNCTION public.cutover_assurance_synthetic_recon_mapping(uuid,uuid,uuid[],uuid,uuid,text) IS
  'Assurance-only wrapper for the owner-approved synthetic PROD tenant and exact 20 public IDs; delegates all authorization and mapping work to the generic atomic cutover RPC.';
