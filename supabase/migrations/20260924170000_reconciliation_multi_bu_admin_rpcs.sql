-- Admin-governed setup RPCs for the additive multi-BU reconciliation model.
-- They do not opt definitions into multi_bu_governed and do not change RLS.

CREATE TABLE public.recon_definition_bu_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('replace_owners', 'grant_action', 'revoke_action')),
  target_id uuid,
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recon_definition_bu_admin_audit_recon_idx
  ON public.recon_definition_bu_admin_audit(tenant_id, recon_id, created_at DESC);
ALTER TABLE public.recon_definition_bu_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recon_definition_bu_admin_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.recon_definition_bu_admin_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.recon_definition_bu_admin_audit_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.reject_recon_bu_admin_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
BEGIN
  RAISE EXCEPTION 'reconciliation access audit is immutable';
END
$function$;
CREATE TRIGGER recon_definition_bu_admin_audit_immutable
  BEFORE UPDATE OR DELETE ON public.recon_definition_bu_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_recon_bu_admin_audit_mutation();

CREATE OR REPLACE FUNCTION public.get_recon_access_setup(_recon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_admin boolean;
  v_owners jsonb;
  v_grants jsonb;
  v_effective jsonb;
  v_bu_choices jsonb;
  v_principal_choices jsonb;
BEGIN
  IF v_actor IS NULL OR _recon_id IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT d.tenant_id INTO v_tenant
  FROM public.recon_definitions d WHERE d.id = _recon_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_tenant AND tm.user_id = v_actor AND tm.active
      AND tm.role = 'tenant_admin'::public.tenant_role
  ) INTO v_admin;
  IF NOT v_admin AND NOT private.recon_multi_bu_shadow_allows_actor(v_actor, _recon_id, 'view') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('bu_id', m.bu_id, 'created_at', m.created_at)
                            ORDER BY m.bu_id), '[]'::jsonb)
    INTO v_owners
  FROM public.recon_definition_business_units m
  WHERE m.tenant_id = v_tenant AND m.recon_id = _recon_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
             'grant_id', g.id, 'bu_id', g.bu_id, 'principal_type', g.principal_type,
             'principal_id', g.principal_id, 'action', g.action, 'granted_at', g.granted_at
           ) ORDER BY g.bu_id, g.principal_type, g.principal_id, g.action), '[]'::jsonb)
    INTO v_grants
  FROM public.recon_definition_bu_grants g
  WHERE g.tenant_id = v_tenant AND g.recon_id = _recon_id;
  SELECT jsonb_build_object(
    'view', private.recon_multi_bu_shadow_allows_actor(v_actor, _recon_id, 'view'),
    'run', private.recon_multi_bu_shadow_allows_actor(v_actor, _recon_id, 'run'),
    'edit', private.recon_multi_bu_shadow_allows_actor(v_actor, _recon_id, 'edit'),
    'approve', private.recon_multi_bu_shadow_allows_actor(v_actor, _recon_id, 'approve')
  ) INTO v_effective;
  IF v_admin THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('bu_id', b.id, 'name', b.name, 'code', b.code)
                              ORDER BY b.name, b.id), '[]'::jsonb)
      INTO v_bu_choices
    FROM public.business_units b WHERE b.tenant_id = v_tenant AND NOT b.is_archived;
    SELECT coalesce(jsonb_agg(choice ORDER BY choice->>'principal_type', choice->>'label'), '[]'::jsonb)
      INTO v_principal_choices
    FROM (
      SELECT jsonb_build_object('principal_type', 'user', 'principal_id', tm.user_id,
             'label', coalesce(nullif(u.email, ''), tm.user_id::text), 'bu_ids',
             coalesce((SELECT jsonb_agg(DISTINCT a.bu_id ORDER BY a.bu_id)
                       FROM public.bu_user_assignments a
                       WHERE a.tenant_id = v_tenant AND a.user_id = tm.user_id), '[]'::jsonb)) AS choice
      FROM public.tenant_members tm JOIN auth.users u ON u.id = tm.user_id
      WHERE tm.tenant_id = v_tenant AND tm.active
      UNION ALL
      SELECT jsonb_build_object('principal_type', 'group', 'principal_id', g.id,
             'label', g.name, 'bu_ids',
             coalesce((SELECT jsonb_agg(DISTINCT a.bu_id ORDER BY a.bu_id)
                       FROM public.bu_group_assignments a
                       WHERE a.tenant_id = v_tenant AND a.group_id = g.id), '[]'::jsonb)) AS choice
      FROM public.tenant_groups g WHERE g.tenant_id = v_tenant
    ) choices;
  ELSE
    v_bu_choices := '[]'::jsonb;
    v_principal_choices := '[]'::jsonb;
  END IF;
  RETURN jsonb_build_object('recon_id', _recon_id, 'tenant_id', v_tenant,
    'multi_bu_governed', (SELECT d.multi_bu_governed FROM public.recon_definitions d WHERE d.id = _recon_id),
    'is_tenant_admin', v_admin, 'owners', v_owners, 'grants', v_grants, 'effective_access', v_effective,
    'available_business_units', v_bu_choices, 'available_principals', v_principal_choices);
END
$function$;

CREATE OR REPLACE FUNCTION public.set_recon_owners(_recon_id uuid, _bu_ids uuid[], _reason text)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_old uuid[];
  v_new uuid[];
  v_governed boolean;
BEGIN
  IF v_actor IS NULL OR _recon_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid access setup request';
  END IF;
  SELECT d.tenant_id, d.multi_bu_governed INTO v_tenant, v_governed
  FROM public.recon_definitions d WHERE d.id = _recon_id FOR UPDATE;
  IF v_tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = v_tenant AND tm.user_id = v_actor
      AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role
  ) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_new
  FROM unnest(coalesce(_bu_ids, ARRAY[]::uuid[])) x;
  IF v_governed AND cardinality(v_new) = 0 THEN RAISE EXCEPTION 'governed reconciliation requires an owner'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_new) x
    LEFT JOIN public.business_units b ON b.id = x AND b.tenant_id = v_tenant
    WHERE b.id IS NULL
  ) THEN RAISE EXCEPTION 'owners must be business units in the reconciliation tenant'; END IF;
  SELECT coalesce(array_agg(m.bu_id ORDER BY m.bu_id), ARRAY[]::uuid[]) INTO v_old
  FROM public.recon_definition_business_units m WHERE m.tenant_id = v_tenant AND m.recon_id = _recon_id;
  IF EXISTS (
    SELECT 1 FROM public.recon_definition_bu_grants g
    WHERE g.tenant_id = v_tenant AND g.recon_id = _recon_id AND NOT (g.bu_id = ANY(v_new))
  ) THEN
    RAISE EXCEPTION 'revoke grants for removed owner business units before replacing ownership';
  END IF;
  DELETE FROM public.recon_definition_business_units m
  WHERE m.tenant_id = v_tenant AND m.recon_id = _recon_id AND NOT (m.bu_id = ANY(v_new));
  INSERT INTO public.recon_definition_business_units(tenant_id, recon_id, bu_id, created_by)
  SELECT v_tenant, _recon_id, x, v_actor FROM unnest(v_new) x
  ON CONFLICT (tenant_id, recon_id, bu_id) DO NOTHING;
  INSERT INTO public.recon_definition_bu_admin_audit(tenant_id, recon_id, operation, actor_id, reason, details)
  VALUES (v_tenant, _recon_id, 'replace_owners', v_actor, btrim(_reason),
          jsonb_build_object('previous_bu_ids', v_old, 'new_bu_ids', v_new));
  RETURN v_new;
END
$function$;

CREATE OR REPLACE FUNCTION public.grant_recon_bu_action(
  _recon_id uuid, _bu_id uuid, _principal_type text, _principal_id uuid, _action text, _reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_grant_id uuid;
  v_created boolean := false;
BEGIN
  IF v_actor IS NULL OR _recon_id IS NULL OR _bu_id IS NULL OR _principal_id IS NULL
     OR _principal_type IS NULL OR _principal_type NOT IN ('user', 'group')
     OR _action IS NULL OR _action NOT IN ('view', 'read', 'run', 'edit', 'approve')
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid access setup request';
  END IF;
  SELECT d.tenant_id INTO v_tenant FROM public.recon_definitions d
  WHERE d.id = _recon_id;
  IF v_tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = v_tenant AND tm.user_id = v_actor
      AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role
  ) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recon_definition_business_units m
                 WHERE m.tenant_id = v_tenant AND m.recon_id = _recon_id AND m.bu_id = _bu_id) THEN
    RAISE EXCEPTION 'grant business unit must own this governed reconciliation';
  END IF;
  IF _principal_type = 'user' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = v_tenant
                   AND tm.user_id = _principal_id AND tm.active)
       OR NOT EXISTS (
         SELECT 1 FROM public.business_units target_bu
         JOIN public.bu_user_assignments a ON a.tenant_id = target_bu.tenant_id AND a.user_id = _principal_id
         JOIN public.business_units assigned_bu ON assigned_bu.id = a.bu_id AND assigned_bu.tenant_id = a.tenant_id
         WHERE target_bu.id = _bu_id AND target_bu.tenant_id = v_tenant
           AND (target_bu.id = assigned_bu.id OR (a.inherit_descendants AND target_bu.path <@ assigned_bu.path))
       ) THEN
      RAISE EXCEPTION 'grant user must be active and assigned to the owner business unit';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id = _principal_id AND g.tenant_id = v_tenant)
       OR NOT EXISTS (
         SELECT 1 FROM public.business_units target_bu
         JOIN public.bu_group_assignments a ON a.tenant_id = target_bu.tenant_id AND a.group_id = _principal_id
         JOIN public.business_units assigned_bu ON assigned_bu.id = a.bu_id AND assigned_bu.tenant_id = a.tenant_id
         WHERE target_bu.id = _bu_id AND target_bu.tenant_id = v_tenant
           AND (target_bu.id = assigned_bu.id OR (a.inherit_descendants AND target_bu.path <@ assigned_bu.path))
       ) THEN
      RAISE EXCEPTION 'grant group must be in the tenant and assigned to the owner business unit';
    END IF;
  END IF;
  INSERT INTO public.recon_definition_bu_grants(tenant_id, recon_id, bu_id, principal_type, principal_id, action, granted_by)
  VALUES (v_tenant, _recon_id, _bu_id, _principal_type, _principal_id,
          CASE WHEN _action = 'read' THEN 'view' ELSE _action END, v_actor)
  ON CONFLICT (tenant_id, recon_id, bu_id, principal_type, principal_id, action) DO NOTHING
  RETURNING id INTO v_grant_id;
  v_created := v_grant_id IS NOT NULL;
  IF NOT v_created THEN
    SELECT g.id INTO v_grant_id FROM public.recon_definition_bu_grants g
    WHERE g.tenant_id = v_tenant AND g.recon_id = _recon_id AND g.bu_id = _bu_id
      AND g.principal_type = _principal_type AND g.principal_id = _principal_id
      AND g.action = CASE WHEN _action = 'read' THEN 'view' ELSE _action END;
  ELSE
    INSERT INTO public.recon_definition_bu_admin_audit(tenant_id, recon_id, operation, target_id, actor_id, reason, details)
    VALUES (v_tenant, _recon_id, 'grant_action', v_grant_id, v_actor, btrim(_reason),
      jsonb_build_object('bu_id', _bu_id, 'principal_type', _principal_type,
                         'principal_id', _principal_id, 'action', CASE WHEN _action = 'read' THEN 'view' ELSE _action END));
  END IF;
  RETURN v_grant_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.revoke_recon_bu_action(_grant_id uuid, _reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_grant public.recon_definition_bu_grants%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR _grant_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid access setup request';
  END IF;
  SELECT g.* INTO v_grant FROM public.recon_definition_bu_grants g WHERE g.id = _grant_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = v_grant.tenant_id AND tm.user_id = v_actor
      AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role
  ) THEN RAISE EXCEPTION 'not authorized'; END IF;
  DELETE FROM public.recon_definition_bu_grants WHERE id = _grant_id;
  INSERT INTO public.recon_definition_bu_admin_audit(tenant_id, recon_id, operation, target_id, actor_id, reason, details)
  VALUES (v_grant.tenant_id, v_grant.recon_id, 'revoke_action', _grant_id, v_actor, btrim(_reason),
    jsonb_build_object('bu_id', v_grant.bu_id, 'principal_type', v_grant.principal_type,
                       'principal_id', v_grant.principal_id, 'action', v_grant.action));
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.get_recon_access_setup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_recon_owners(uuid, uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_recon_bu_action(uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_recon_bu_action(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recon_access_setup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_recon_owners(uuid, uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_recon_bu_action(uuid, uuid, text, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_recon_bu_action(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_recon_access_setup(uuid) IS 'Read-only multi-BU access setup for active tenant admins and authorized recon viewers; does not change RLS.';
COMMENT ON FUNCTION public.set_recon_owners(uuid, uuid[], text) IS 'Tenant-admin owner mapping replacement with same-tenant validation and audit; does not opt in multi-BU enforcement.';
  COMMENT ON FUNCTION public.grant_recon_bu_action(uuid, uuid, text, uuid, text, text) IS 'Tenant-admin grant setup for mapped reconciliations; grants remain shadow data until separately governed.';
COMMENT ON FUNCTION public.revoke_recon_bu_action(uuid, text) IS 'Tenant-admin grant revocation with immutable audit for opted-in reconciliations; does not change current RLS.';
