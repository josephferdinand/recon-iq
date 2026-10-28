-- Shadow-only exact reconciliation authorization for opt-in multi-BU definitions.
-- This helper is intentionally not wired into current RLS or application paths.
-- Unmapped/legacy definitions fail closed when explicitly evaluated here.

CREATE OR REPLACE FUNCTION private.recon_multi_bu_shadow_allows_actor(
  _actor uuid,
  _recon uuid,
  _action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  WITH target AS (
    SELECT d.id, d.tenant_id
    FROM public.recon_definitions d
    WHERE d.id = _recon
      AND d.multi_bu_governed
      AND _action IN ('view', 'read', 'run', 'edit', 'approve')
      AND EXISTS (
        SELECT 1 FROM public.recon_definition_business_units owner_bu
        WHERE owner_bu.tenant_id = d.tenant_id AND owner_bu.recon_id = d.id
      )
  ), active_actor AS (
    SELECT t.tenant_id, tm.role
    FROM target t
    JOIN public.tenant_members tm
      ON tm.tenant_id = t.tenant_id AND tm.user_id = _actor AND tm.active
  ), actor_owner_bu AS (
    SELECT DISTINCT t.tenant_id, t.id AS recon_id, owner_bu.bu_id
    FROM target t
    JOIN active_actor aa ON aa.tenant_id = t.tenant_id
    JOIN public.recon_definition_business_units owner_bu
      ON owner_bu.tenant_id = t.tenant_id AND owner_bu.recon_id = t.id
    JOIN public.business_units target_bu
      ON target_bu.id = owner_bu.bu_id AND target_bu.tenant_id = t.tenant_id
    WHERE
      EXISTS (
        SELECT 1
        FROM public.bu_user_assignments ua
        JOIN public.business_units assigned_bu
          ON assigned_bu.id = ua.bu_id AND assigned_bu.tenant_id = ua.tenant_id
        WHERE ua.user_id = _actor AND ua.tenant_id = t.tenant_id
          AND (target_bu.id = assigned_bu.id OR
               (ua.inherit_descendants AND target_bu.path <@ assigned_bu.path))
      )
      OR EXISTS (
        SELECT 1
        FROM public.bu_group_assignments ga
        JOIN public.business_units assigned_bu
          ON assigned_bu.id = ga.bu_id AND assigned_bu.tenant_id = ga.tenant_id
        JOIN public.tenant_groups g
          ON g.id = ga.group_id AND g.tenant_id = ga.tenant_id
        JOIN public.tenant_group_members gm ON gm.group_id = g.id AND gm.user_id = _actor
        WHERE ga.tenant_id = t.tenant_id
          AND (target_bu.id = assigned_bu.id OR
               (ga.inherit_descendants AND target_bu.path <@ assigned_bu.path))
      )
  ), matching_grant AS (
    SELECT 1
    FROM target t
    JOIN active_actor aa ON aa.tenant_id = t.tenant_id
    JOIN actor_owner_bu allowed_bu ON allowed_bu.recon_id = t.id
    JOIN public.recon_definition_bu_grants g
      ON g.tenant_id = t.tenant_id AND g.recon_id = t.id AND g.bu_id = allowed_bu.bu_id
    WHERE g.action = CASE WHEN _action = 'read' THEN 'view' ELSE _action END
      AND (
        (g.principal_type = 'user' AND g.principal_id = _actor)
        OR
        (g.principal_type = 'group' AND EXISTS (
          SELECT 1
          FROM public.tenant_groups group_row
          JOIN public.tenant_group_members member_row
            ON member_row.group_id = group_row.id AND member_row.user_id = _actor
          WHERE group_row.id = g.principal_id AND group_row.tenant_id = t.tenant_id
        ))
      )
  )
  SELECT CASE
    WHEN _actor IS NULL OR _recon IS NULL OR _action IS NULL THEN false
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM active_actor) THEN false
    WHEN EXISTS (SELECT 1 FROM active_actor WHERE role = 'tenant_admin'::public.tenant_role) THEN true
    ELSE EXISTS (SELECT 1 FROM matching_grant)
  END
$function$;

-- Internal actor parameter exists for policy composition only; callers cannot choose it.
REVOKE ALL ON FUNCTION private.recon_multi_bu_shadow_allows_actor(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recon_multi_bu_shadow_allows(_recon uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $function$
  SELECT private.recon_multi_bu_shadow_allows_actor(auth.uid(), _recon, _action)
$function$;

REVOKE ALL ON FUNCTION public.recon_multi_bu_shadow_allows(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recon_multi_bu_shadow_allows(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.recon_multi_bu_shadow_allows(uuid, text) IS
  'Shadow-only evaluator; not wired into RLS/application access. Requires an opted-in mapped multi-BU definition and active tenant membership.';
