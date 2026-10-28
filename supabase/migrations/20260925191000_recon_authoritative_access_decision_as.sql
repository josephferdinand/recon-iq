-- Add a service-role-only actor-explicit entry point while keeping one
-- authoritative evaluator for both JWT-bound and persisted worker actors.
CREATE OR REPLACE FUNCTION private.recon_authoritative_access_decision_as(
  _actor uuid,
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
  v_definition public.recon_definitions%ROWTYPE;
  v_member_role text;
  v_owner_count integer;
  v_action text;
BEGIN
  IF _actor IS NULL OR _recon IS NULL OR _action IS NULL
     OR _action NOT IN ('view','read','run','edit','approve') THEN
    RETURN false;
  END IF;

  SELECT d.* INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id = _recon;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Keep exact legacy parity with the auth.uid()-bound evaluator.
  IF v_definition.access_mode = 'legacy_passthrough' THEN
    RETURN private.user_can_access_recon(
      _actor,
      v_definition.id,
      CASE WHEN _action = 'view' THEN 'read' ELSE _action END
    );
  END IF;

  SELECT tm.role::text INTO v_member_role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_definition.tenant_id
    AND tm.user_id = _actor
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

  -- A mapped definition requires at least one valid, tenant-local owner BU.
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

  -- Tenant-admin override is deliberately tenant-scoped. Approval separation
  -- of duties remains the responsibility of its calling workflow.
  IF v_member_role = 'tenant_admin' THEN
    RETURN true;
  END IF;

  v_action := CASE WHEN _action IN ('view','read') THEN 'view' ELSE _action END;

  -- Direct grants require a current assignment to the owner BU, or to an
  -- ancestor whose assignment explicitly inherits descendants.
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
      AND grant_row.principal_id = _actor
      AND EXISTS (
        SELECT 1
        FROM public.bu_user_assignments assignment
        JOIN public.business_units assigned_unit
          ON assigned_unit.id = assignment.bu_id
         AND assigned_unit.tenant_id = assignment.tenant_id
         AND NOT assigned_unit.is_archived
        WHERE assignment.tenant_id = v_definition.tenant_id
          AND assignment.user_id = _actor
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
     AND group_member.user_id = _actor
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

REVOKE ALL ON FUNCTION private.recon_authoritative_access_decision_as(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the original entry point auth.uid()-bound, delegating to the same
-- evaluator so authenticated RLS callers and service workers cannot drift.
CREATE OR REPLACE FUNCTION private.recon_authoritative_access_decision(
  _recon uuid,
  _action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private, auth
AS $function$
  SELECT private.recon_authoritative_access_decision_as(auth.uid(), _recon, _action)
$function$;

REVOKE ALL ON FUNCTION private.recon_authoritative_access_decision(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.recon_authoritative_access_decision(uuid,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.recon_authoritative_access_decision_as(
  _actor uuid,
  _recon uuid,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private, auth
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN false;
  END IF;
  RETURN private.recon_authoritative_access_decision_as(_actor, _recon, _action);
END
$function$;

REVOKE ALL ON FUNCTION public.recon_authoritative_access_decision_as(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recon_authoritative_access_decision_as(uuid,uuid,text)
  TO service_role;

COMMENT ON FUNCTION public.recon_authoritative_access_decision_as(uuid,uuid,text) IS
  'Service-role-only actor-explicit reconciliation access decision. Uses the same private evaluator as the auth.uid()-bound entry point; actor context must be persisted and authorized by the calling worker.';
