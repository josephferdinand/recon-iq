-- Phase-2, actor-bound reconciliation access decision candidate.
-- This function is intentionally not wired to RLS, APIs, or workers in this
-- migration. It preserves the legacy helper for pre-cutover rows and evaluates
-- owner-BU grants only for explicitly mapped_exact definitions.

CREATE OR REPLACE FUNCTION private.recon_authoritative_access_decision(
  _recon uuid,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_definition public.recon_definitions%ROWTYPE;
  v_member_role text;
  v_owner_count integer;
  v_action text;
BEGIN
  IF v_actor IS NULL OR _recon IS NULL OR _action IS NULL
     OR _action NOT IN ('view','read','run','edit','approve') THEN
    RETURN false;
  END IF;

  SELECT d.* INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id = _recon;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Preserve the existing helper decision for legacy rows. Root creator-read
  -- and child-table legacy RLS policies are additional paths and must be
  -- reconciled before this evaluator can replace any live policy.
  -- The old helper takes an actor argument; only this function supplies auth.uid().
  IF v_definition.access_mode = 'legacy_passthrough' THEN
    RETURN private.user_can_access_recon(
      v_actor,
      v_definition.id,
      CASE WHEN _action = 'view' THEN 'read' ELSE _action END
    );
  END IF;

  SELECT tm.role::text INTO v_member_role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_definition.tenant_id
    AND tm.user_id = v_actor
    AND tm.active = true
  LIMIT 1;
  IF v_member_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_definition.retired_at IS NOT NULL OR v_definition.status = 'archived' THEN
    RETURN false;
  END IF;

  IF v_definition.access_mode = 'unmapped_pending' THEN
    IF v_member_role <> 'tenant_admin' THEN
      RETURN false;
    END IF;

    -- Read is needed for tenant-admin mapping/setup. Development drafts and
    -- staging copies retain only the existing safe admin workflow. Production
    -- run/edit and all approval remain unavailable until mapping is reviewed.
    IF _action IN ('view','read') THEN
      RETURN true;
    END IF;
    RETURN _action IN ('edit','run')
      AND v_definition.environment IN ('development','staging')
      AND v_definition.governance_state IN ('development_draft','staging_copy');
  END IF;

  IF v_definition.access_mode <> 'mapped_exact' THEN
    RETURN false;
  END IF;

  -- A mapped decision is valid only with a non-empty, tenant-local, active
  -- owner set. The composite foreign keys protect writes; this check also
  -- fails closed if historical/imported data violates that invariant.
  SELECT count(*) INTO v_owner_count
  FROM public.recon_definition_business_units owner_bu
  WHERE owner_bu.tenant_id = v_definition.tenant_id
    AND owner_bu.recon_id = v_definition.id;
  IF v_owner_count = 0 OR EXISTS (
    SELECT 1
    FROM public.recon_definition_business_units owner_bu
    LEFT JOIN public.business_units owner_unit
      ON owner_unit.id = owner_bu.bu_id
     AND owner_unit.tenant_id = owner_bu.tenant_id
    WHERE owner_bu.recon_id = v_definition.id
      AND (owner_bu.tenant_id IS DISTINCT FROM v_definition.tenant_id
        OR owner_unit.id IS NULL
        OR owner_unit.is_archived)
  ) THEN
    RETURN false;
  END IF;

  -- Tenant-admin capability is in-tenant only. Separation of duties remains
  -- a separate mandatory check at the approval/request decision call site.
  IF v_member_role = 'tenant_admin' THEN
    RETURN true;
  END IF;

  v_action := CASE WHEN _action IN ('view','read') THEN 'view' ELSE _action END;

  -- Direct-user and group grants are unioned, but only where the principal is
  -- currently assigned to the exact owner BU or an ancestor with inheritance.
  -- tenant_group_members has no active flag; membership is active while its row
  -- exists, and the actor's active tenant membership was checked above.
  RETURN EXISTS (
    SELECT 1
    FROM public.recon_definition_bu_grants grant_row
    JOIN public.recon_definition_business_units owner_bu
      ON owner_bu.tenant_id = grant_row.tenant_id
     AND owner_bu.recon_id = grant_row.recon_id
     AND owner_bu.bu_id = grant_row.bu_id
    JOIN public.business_units owner_unit
      ON owner_unit.id = owner_bu.bu_id
     AND owner_unit.tenant_id = owner_bu.tenant_id
     AND NOT owner_unit.is_archived
    WHERE grant_row.tenant_id = v_definition.tenant_id
      AND grant_row.recon_id = v_definition.id
      AND grant_row.action = v_action
      AND grant_row.principal_type = 'user'
      AND grant_row.principal_id = v_actor
      AND EXISTS (
        SELECT 1
        FROM public.bu_user_assignments assignment
        JOIN public.business_units assigned_unit
          ON assigned_unit.id = assignment.bu_id
         AND assigned_unit.tenant_id = assignment.tenant_id
         AND NOT assigned_unit.is_archived
        WHERE assignment.tenant_id = v_definition.tenant_id
          AND assignment.user_id = v_actor
          AND (owner_unit.id = assigned_unit.id
            OR (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.recon_definition_bu_grants grant_row
    JOIN public.recon_definition_business_units owner_bu
      ON owner_bu.tenant_id = grant_row.tenant_id
     AND owner_bu.recon_id = grant_row.recon_id
     AND owner_bu.bu_id = grant_row.bu_id
    JOIN public.business_units owner_unit
      ON owner_unit.id = owner_bu.bu_id
     AND owner_unit.tenant_id = owner_bu.tenant_id
     AND NOT owner_unit.is_archived
    JOIN public.tenant_groups grant_group
      ON grant_group.id = grant_row.principal_id
     AND grant_group.tenant_id = grant_row.tenant_id
    JOIN public.tenant_group_members group_member
      ON group_member.group_id = grant_group.id
     AND group_member.user_id = v_actor
    JOIN public.bu_group_assignments assignment
      ON assignment.group_id = grant_group.id
     AND assignment.tenant_id = v_definition.tenant_id
    JOIN public.business_units assigned_unit
      ON assigned_unit.id = assignment.bu_id
     AND assigned_unit.tenant_id = assignment.tenant_id
     AND NOT assigned_unit.is_archived
    WHERE grant_row.tenant_id = v_definition.tenant_id
      AND grant_row.recon_id = v_definition.id
      AND grant_row.action = v_action
      AND grant_row.principal_type = 'group'
      AND (owner_unit.id = assigned_unit.id
        OR (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
  );
END
$function$;

REVOKE ALL ON FUNCTION private.recon_authoritative_access_decision(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.recon_authoritative_access_decision(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.recon_authoritative_access_decision(
  _recon uuid,
  _action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.recon_authoritative_access_decision(_recon, _action)
$function$;

REVOKE ALL ON FUNCTION public.recon_authoritative_access_decision(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recon_authoritative_access_decision(uuid,text) TO authenticated;

COMMENT ON FUNCTION public.recon_authoritative_access_decision(uuid,text) IS
  'Phase-2 disposable/source candidate. Binds user-facing decisions to auth.uid(); not yet wired into RLS, application APIs, or service-role workers. Approval callers must separately enforce requester/approver separation of duties.';
