-- Tenant-admin-only setup RPCs for the typed shadow registry.
-- These write shadow metadata only; existing RLS and callers remain authoritative.

CREATE TABLE public.data_resource_registry_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  registry_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('REGISTER','REPLACE_OWNERS','GRANT_ACTION','REVOKE_ACTION')),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  FOREIGN KEY (tenant_id,registry_id) REFERENCES public.data_resource_registry(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX data_resource_registry_admin_audit_idx
  ON public.data_resource_registry_admin_audit(tenant_id,registry_id,changed_at DESC);
ALTER TABLE public.data_resource_registry_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_resource_registry_admin_audit FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.reject_data_resource_registry_admin_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'typed resource admin audit is immutable'; END $$;
CREATE TRIGGER data_resource_registry_admin_audit_immutable
  BEFORE UPDATE OR DELETE ON public.data_resource_registry_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_registry_admin_audit_mutation();

CREATE OR REPLACE FUNCTION public.register_typed_data_resource(
  _resource_type text, _resource_id uuid, _owner_bu_ids uuid[], _reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_registry_id uuid;
  v_bu_ids uuid[];
BEGIN
  IF v_actor IS NULL OR _resource_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid typed resource registration request';
  END IF;
  IF _resource_type NOT IN ('data_source','db_connection','inline_api_source','erp_connection',
      'file_watcher','aidp_template','aidp_document','reference_table','data_prep_pipeline') THEN
    RAISE EXCEPTION 'unsupported typed resource';
  END IF;
  v_bu_ids := (SELECT coalesce(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(coalesce(_owner_bu_ids, ARRAY[]::uuid[])) x);
  IF cardinality(v_bu_ids) = 0 THEN RAISE EXCEPTION 'at least one explicit owner business unit is required'; END IF;

  CASE _resource_type
    WHEN 'data_source' THEN SELECT tenant_id INTO v_tenant FROM public.workspace_data_sources WHERE id = _resource_id FOR SHARE;
    WHEN 'db_connection' THEN SELECT tenant_id INTO v_tenant FROM public.rekon_db_connections WHERE id = _resource_id FOR SHARE;
    WHEN 'inline_api_source' THEN SELECT tenant_id INTO v_tenant FROM public.rekon_inline_api_sources WHERE id = _resource_id FOR SHARE;
    WHEN 'erp_connection' THEN SELECT tenant_id INTO v_tenant FROM public.erp_connector_configs WHERE id = _resource_id FOR SHARE;
    WHEN 'file_watcher' THEN SELECT tenant_id INTO v_tenant FROM public.data_watchers WHERE id = _resource_id FOR SHARE;
    WHEN 'aidp_template' THEN SELECT tenant_id INTO v_tenant FROM public.aidp_templates WHERE id = _resource_id FOR SHARE;
    WHEN 'aidp_document' THEN SELECT tenant_id INTO v_tenant FROM public.aidp_documents WHERE id = _resource_id FOR SHARE;
    WHEN 'reference_table' THEN SELECT tenant_id INTO v_tenant FROM public.reference_data_tables WHERE id = _resource_id FOR SHARE;
    WHEN 'data_prep_pipeline' THEN SELECT tenant_id INTO v_tenant FROM public.data_prep_pipelines WHERE id = _resource_id FOR SHARE;
  END CASE;
  IF v_tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = v_tenant AND tm.user_id = v_actor
      AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role
  ) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) x LEFT JOIN public.business_units b
      ON b.id = x AND b.tenant_id = v_tenant AND NOT b.is_archived
    WHERE b.id IS NULL
  ) THEN RAISE EXCEPTION 'owner business units must be active in the resource tenant'; END IF;

  -- Use exact typed FK columns; no caller-supplied table or column name is interpolated.
  IF _resource_type = 'data_source' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,data_source_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'db_connection' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,db_connection_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'inline_api_source' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,inline_api_source_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'erp_connection' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,erp_connection_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'file_watcher' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,file_watcher_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'aidp_template' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,aidp_template_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'aidp_document' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,aidp_document_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'reference_table' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,reference_table_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  ELSIF _resource_type = 'data_prep_pipeline' THEN
    INSERT INTO public.data_resource_registry(tenant_id,resource_type,data_prep_pipeline_id,created_by) VALUES(v_tenant,_resource_type,_resource_id,v_actor) RETURNING id INTO v_registry_id;
  END IF;
  IF v_registry_id IS NULL THEN RAISE EXCEPTION 'resource already registered or could not be registered'; END IF;
  INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id,created_by)
  SELECT v_tenant,v_registry_id,x,v_actor FROM unnest(v_bu_ids) x;
  INSERT INTO public.data_resource_registry_admin_audit(tenant_id,registry_id,operation,actor_id,reason,details)
  VALUES(v_tenant,v_registry_id,'REGISTER',v_actor,btrim(_reason),jsonb_build_object('resource_type',_resource_type,'resource_id',_resource_id,'owner_bu_ids',v_bu_ids));
  RETURN v_registry_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_typed_data_resource_owners(
  _registry_id uuid, _owner_bu_ids uuid[], _reason text
)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE v_actor uuid := auth.uid(); v_tenant uuid; v_new uuid[]; v_old uuid[];
BEGIN
  IF v_actor IS NULL OR _registry_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid typed resource owner request';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.data_resource_registry WHERE id=_registry_id FOR UPDATE;
  IF v_tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=v_tenant AND tm.user_id=v_actor
      AND tm.active AND tm.role='tenant_admin'::public.tenant_role
  ) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_new
    FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) x;
  IF EXISTS (SELECT 1 FROM unnest(v_new) x LEFT JOIN public.business_units b
      ON b.id=x AND b.tenant_id=v_tenant AND NOT b.is_archived WHERE b.id IS NULL) THEN
    RAISE EXCEPTION 'owner business units must be active in the resource tenant';
  END IF;
  SELECT coalesce(array_agg(bu_id ORDER BY bu_id),ARRAY[]::uuid[]) INTO v_old
    FROM public.data_resource_registry_owner_bu WHERE tenant_id=v_tenant AND registry_id=_registry_id;
  IF EXISTS (SELECT 1 FROM public.data_resource_registry_grants g WHERE g.tenant_id=v_tenant
      AND g.registry_id=_registry_id AND NOT (g.bu_id=ANY(v_new))) THEN
    RAISE EXCEPTION 'revoke grants for removed owner business units first';
  END IF;
  DELETE FROM public.data_resource_registry_owner_bu o WHERE o.tenant_id=v_tenant AND o.registry_id=_registry_id
    AND NOT (o.bu_id=ANY(v_new));
  INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id,created_by)
  SELECT v_tenant,_registry_id,x,v_actor FROM unnest(v_new) x
  ON CONFLICT (tenant_id,registry_id,bu_id) DO NOTHING;
  INSERT INTO public.data_resource_registry_admin_audit(tenant_id,registry_id,operation,actor_id,reason,details)
  VALUES(v_tenant,_registry_id,'REPLACE_OWNERS',v_actor,btrim(_reason),jsonb_build_object('previous_owner_bu_ids',v_old,'new_owner_bu_ids',v_new));
  RETURN v_new;
END
$function$;

CREATE OR REPLACE FUNCTION public.grant_typed_data_resource_action(
  _registry_id uuid, _bu_id uuid, _principal_type text, _principal_id uuid, _action text, _reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE v_actor uuid := auth.uid(); v_tenant uuid; v_grant_id uuid;
BEGIN
  IF v_actor IS NULL OR _registry_id IS NULL OR _bu_id IS NULL OR _principal_id IS NULL
    OR _principal_type IS NULL OR _principal_type NOT IN ('user','group')
    OR _action IS NULL OR _action NOT IN ('view','ingest','run','edit','manage','approve')
    OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid typed resource grant request';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.data_resource_registry WHERE id=_registry_id;
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=v_tenant
      AND tm.user_id=v_actor AND tm.active AND tm.role='tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.data_resource_registry_owner_bu o JOIN public.business_units b
      ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived
      WHERE o.tenant_id=v_tenant AND o.registry_id=_registry_id AND o.bu_id=_bu_id) THEN
    RAISE EXCEPTION 'grant business unit must actively own the typed resource';
  END IF;
  IF _principal_type='user' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=v_tenant AND tm.user_id=_principal_id AND tm.active)
      OR NOT EXISTS (SELECT 1 FROM public.bu_user_assignments a JOIN public.business_units assigned
        ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id AND NOT assigned.is_archived
        JOIN public.business_units target ON target.id=_bu_id AND target.tenant_id=v_tenant AND NOT target.is_archived
        WHERE a.tenant_id=v_tenant AND a.user_id=_principal_id
          AND (assigned.id=target.id OR (a.inherit_descendants AND target.path <@ assigned.path))) THEN
      RAISE EXCEPTION 'grant user must be active and assigned to the owner business unit';
    END IF;
    IF _action='approve' AND _principal_id=v_actor THEN RAISE EXCEPTION 'self-approval grant is forbidden'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.tenant_groups g WHERE g.id=_principal_id AND g.tenant_id=v_tenant)
      OR NOT EXISTS (SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units assigned
        ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id AND NOT assigned.is_archived
        JOIN public.business_units target ON target.id=_bu_id AND target.tenant_id=v_tenant AND NOT target.is_archived
        WHERE a.tenant_id=v_tenant AND a.group_id=_principal_id
          AND (assigned.id=target.id OR (a.inherit_descendants AND target.path <@ assigned.path))) THEN
      RAISE EXCEPTION 'grant group must be active in the tenant and assigned to the owner business unit';
    END IF;
    IF _action='approve' AND EXISTS (SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=_principal_id AND gm.user_id=v_actor) THEN
      RAISE EXCEPTION 'self-approval group grant is forbidden';
    END IF;
  END IF;
  INSERT INTO public.data_resource_registry_grants(tenant_id,registry_id,bu_id,principal_type,principal_user_id,principal_group_id,action,granted_by)
  VALUES(v_tenant,_registry_id,_bu_id,_principal_type,
    CASE WHEN _principal_type='user' THEN _principal_id END,
    CASE WHEN _principal_type='group' THEN _principal_id END,_action,v_actor)
  ON CONFLICT DO NOTHING RETURNING id INTO v_grant_id;
  IF v_grant_id IS NULL THEN
    SELECT id INTO v_grant_id FROM public.data_resource_registry_grants WHERE tenant_id=v_tenant AND registry_id=_registry_id
      AND bu_id=_bu_id AND principal_type=_principal_type AND action=_action
      AND ((_principal_type='user' AND principal_user_id=_principal_id) OR (_principal_type='group' AND principal_group_id=_principal_id));
  END IF;
  INSERT INTO public.data_resource_registry_admin_audit(tenant_id,registry_id,operation,actor_id,reason,details)
  VALUES(v_tenant,_registry_id,'GRANT_ACTION',v_actor,btrim(_reason),jsonb_build_object('grant_id',v_grant_id,'bu_id',_bu_id,'principal_type',_principal_type,'principal_id',_principal_id,'action',_action));
  RETURN v_grant_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.revoke_typed_data_resource_action(_grant_id uuid, _reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE v_actor uuid := auth.uid(); v_grant public.data_resource_registry_grants%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR _grant_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid typed resource revoke request';
  END IF;
  SELECT * INTO v_grant FROM public.data_resource_registry_grants WHERE id=_grant_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=v_grant.tenant_id
      AND tm.user_id=v_actor AND tm.active AND tm.role='tenant_admin'::public.tenant_role) THEN RAISE EXCEPTION 'not authorized'; END IF;
  DELETE FROM public.data_resource_registry_grants WHERE id=_grant_id;
  INSERT INTO public.data_resource_registry_admin_audit(tenant_id,registry_id,operation,actor_id,reason,details)
  VALUES(v_grant.tenant_id,v_grant.registry_id,'REVOKE_ACTION',v_actor,btrim(_reason),jsonb_build_object('grant_id',v_grant.id,'bu_id',v_grant.bu_id,'principal_type',v_grant.principal_type,'principal_id',coalesce(v_grant.principal_user_id,v_grant.principal_group_id),'action',v_grant.action));
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.register_typed_data_resource(text,uuid,uuid[],text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_typed_data_resource_owners(uuid,uuid[],text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.grant_typed_data_resource_action(uuid,uuid,text,uuid,text,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revoke_typed_data_resource_action(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_typed_data_resource(text,uuid,uuid[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_typed_data_resource_owners(uuid,uuid[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_typed_data_resource_action(uuid,uuid,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_typed_data_resource_action(uuid,text) TO authenticated;

COMMENT ON FUNCTION public.register_typed_data_resource(text,uuid,uuid[],text) IS 'Tenant-admin-only explicit registration of an exact typed resource and its supplied owner BUs; shadow metadata only.';
COMMENT ON FUNCTION public.set_typed_data_resource_owners(uuid,uuid[],text) IS 'Tenant-admin-only audited owner-BU replacement; shadow metadata only and grants must be revoked before removing their BU.';
COMMENT ON FUNCTION public.grant_typed_data_resource_action(uuid,uuid,text,uuid,text,text) IS 'Tenant-admin-only direct/group action grant for an explicitly mapped typed resource; platform roles do not authorize access.';
COMMENT ON FUNCTION public.revoke_typed_data_resource_action(uuid,text) IS 'Tenant-admin-only action grant revocation; trigger retains immutable audit.';
