-- Extend the existing typed-resource display ABI for CSA agreements and add
-- purpose-bound schedule group actions. This migration does not change data,
-- ownership, lifecycle decisions, table ACLs, RLS policies, or existing mappings.
DO $guard$
DECLARE v_hash text;
BEGIN
  SELECT md5(replace(pg_get_functiondef('public.get_data_resource_access_summary(text,uuid[])'::regprocedure), E'\r\n', E'\n')) INTO v_hash;
  IF v_hash NOT IN ('f9a42790a28714317805758633c26baa', '3160a47335fa22b57ee5609586a9819a') THEN
    RAISE EXCEPTION 'guarded collateral summary ABI preimage mismatch';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_data_resource_access_summary(_resource_type text, _resource_ids uuid[])
 RETURNS TABLE(resource_type text, resource_id uuid, public_id text, access_state text, business_unit_names text[], business_unit_count integer, user_group_names text[], user_group_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_ids uuid[]; v_id uuid; v_tenant uuid; v_admin boolean; v_registry uuid;
  v_public text; v_owners text[]; v_groups text[];
BEGIN
  IF v_actor IS NULL OR _resource_type NOT IN ('data_source','data_source_schedule','db_connection','inline_api_source','erp_connection','file_watcher','aidp_template','aidp_document','reference_table','data_prep_pipeline','tenant_template','collateral_schedule','reconciliation','collateral_csa_agreement') THEN RAISE EXCEPTION 'invalid access summary request'; END IF;
  IF _resource_ids IS NULL OR cardinality(_resource_ids)>100 OR cardinality(_resource_ids)=0 OR array_position(_resource_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'between 1 and 100 resource IDs are required'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_ids FROM unnest(_resource_ids) x;
  IF cardinality(v_ids)>100 THEN RAISE EXCEPTION 'at most 100 unique resource IDs are allowed'; END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    v_tenant:=NULL; v_public:=NULL; v_registry:=NULL; v_owners:=ARRAY[]::text[]; v_groups:=ARRAY[]::text[];
    CASE _resource_type
      WHEN 'data_source' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.workspace_data_sources s WHERE s.id=v_id;
      WHEN 'data_source_schedule' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.data_source_schedules s WHERE s.id=v_id;
      WHEN 'db_connection' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.rekon_db_connections s WHERE s.id=v_id;
      WHEN 'inline_api_source' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.rekon_inline_api_sources s WHERE s.id=v_id;
      WHEN 'erp_connection' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.erp_connector_configs s WHERE s.id=v_id;
      WHEN 'file_watcher' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.data_watchers s WHERE s.id=v_id;
      WHEN 'aidp_template' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.aidp_templates s WHERE s.id=v_id;
      WHEN 'aidp_document' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.aidp_documents s WHERE s.id=v_id;
      WHEN 'reference_table' THEN SELECT s.tenant_id,s.public_id INTO v_tenant,v_public FROM public.reference_data_tables s WHERE s.id=v_id;
      WHEN 'data_prep_pipeline' THEN SELECT s.tenant_id,s.public_uid::text INTO v_tenant,v_public FROM public.data_prep_pipelines s WHERE s.id=v_id;
      WHEN 'tenant_template' THEN SELECT s.tenant_id,NULL::text INTO v_tenant,v_public FROM public.tenant_templates s WHERE s.id=v_id;
      WHEN 'collateral_schedule' THEN SELECT s.tenant_id,NULL::text INTO v_tenant,v_public FROM public.collateral_schedules s WHERE s.id=v_id;
      WHEN 'reconciliation' THEN SELECT s.tenant_id,s.recon_code INTO v_tenant,v_public FROM public.recon_definitions s WHERE s.id=v_id;
      WHEN 'collateral_csa_agreement' THEN SELECT s.tenant_id,s.agreement_key INTO v_tenant,v_public FROM public.collateral_csa_agreements s WHERE s.id=v_id;
    END CASE;
    IF v_tenant IS NULL OR NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=v_tenant AND tm.user_id=v_actor AND tm.active) THEN CONTINUE; END IF;
    SELECT tm.role='tenant_admin' INTO v_admin FROM public.tenant_members tm WHERE tm.tenant_id=v_tenant AND tm.user_id=v_actor AND tm.active;
    IF _resource_type='reconciliation' THEN
      IF NOT EXISTS(SELECT 1 FROM public.recon_definition_business_units o WHERE o.tenant_id=v_tenant AND o.recon_id=v_id) THEN access_state:='unmapped';
      ELSE access_state:='mapped'; END IF;
      IF v_admin THEN
        SELECT coalesce(array_agg(DISTINCT b.name ORDER BY b.name),ARRAY[]::text[]) INTO v_owners FROM public.recon_definition_business_units o JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived WHERE o.tenant_id=v_tenant AND o.recon_id=v_id;
        SELECT coalesce(array_agg(DISTINCT g.name ORDER BY g.name),ARRAY[]::text[]) INTO v_groups FROM public.recon_definition_bu_grants x JOIN public.tenant_groups g ON g.id=x.principal_id AND g.tenant_id=x.tenant_id WHERE x.tenant_id=v_tenant AND x.recon_id=v_id AND x.principal_type='group';
      ELSE
        IF access_state='mapped' AND NOT (
          EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g JOIN public.recon_definition_business_units o USING(tenant_id,recon_id,bu_id)
            WHERE g.tenant_id=v_tenant AND g.recon_id=v_id AND g.action IN ('view','read') AND g.principal_type='user' AND g.principal_id=v_actor
              AND EXISTS(SELECT 1 FROM public.bu_user_assignments ua JOIN public.business_units assigned ON assigned.id=ua.bu_id AND assigned.tenant_id=ua.tenant_id
                JOIN public.business_units owner ON owner.id=o.bu_id AND owner.tenant_id=o.tenant_id
                WHERE ua.tenant_id=v_tenant AND ua.user_id=v_actor AND (ua.bu_id=o.bu_id OR (ua.inherit_descendants AND owner.path <@ assigned.path))))
          OR EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g JOIN public.recon_definition_business_units o USING(tenant_id,recon_id,bu_id)
            WHERE g.tenant_id=v_tenant AND g.recon_id=v_id AND g.action IN ('view','read') AND g.principal_type='group'
              AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=g.principal_id AND gm.user_id=v_actor)
              AND EXISTS(SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned ON assigned.id=ga.bu_id AND assigned.tenant_id=ga.tenant_id
                JOIN public.business_units owner ON owner.id=o.bu_id AND owner.tenant_id=o.tenant_id
                WHERE ga.tenant_id=v_tenant AND ga.group_id=g.principal_id AND (ga.bu_id=o.bu_id OR (ga.inherit_descendants AND owner.path <@ assigned.path))))
        ) THEN CONTINUE; END IF;
        SELECT coalesce(array_agg(DISTINCT b.name ORDER BY b.name),ARRAY[]::text[]) INTO v_owners FROM public.recon_definition_business_units o JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived JOIN public.recon_definition_bu_grants g ON g.tenant_id=o.tenant_id AND g.recon_id=o.recon_id AND g.bu_id=o.bu_id WHERE o.tenant_id=v_tenant AND o.recon_id=v_id AND g.action IN ('view','read') AND ((g.principal_type='user' AND g.principal_id=v_actor AND EXISTS(SELECT 1 FROM public.bu_user_assignments ua JOIN public.business_units assigned ON assigned.id=ua.bu_id AND assigned.tenant_id=ua.tenant_id WHERE ua.tenant_id=v_tenant AND ua.user_id=v_actor AND (ua.bu_id=o.bu_id OR (ua.inherit_descendants AND b.path <@ assigned.path)))) OR (g.principal_type='group' AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=g.principal_id AND gm.user_id=v_actor) AND EXISTS(SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned ON assigned.id=ga.bu_id AND assigned.tenant_id=ga.tenant_id WHERE ga.tenant_id=v_tenant AND ga.group_id=g.principal_id AND (ga.bu_id=o.bu_id OR (ga.inherit_descendants AND b.path <@ assigned.path)))));
        SELECT coalesce(array_agg(DISTINCT tg.name ORDER BY tg.name),ARRAY[]::text[]) INTO v_groups FROM public.recon_definition_bu_grants g JOIN public.tenant_groups tg ON tg.id=g.principal_id AND tg.tenant_id=g.tenant_id JOIN public.recon_definition_business_units o ON o.tenant_id=g.tenant_id AND o.recon_id=g.recon_id AND o.bu_id=g.bu_id JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived WHERE g.tenant_id=v_tenant AND g.recon_id=v_id AND g.principal_type='group' AND g.action IN ('view','read') AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=tg.id AND gm.user_id=v_actor) AND EXISTS(SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned ON assigned.id=ga.bu_id AND assigned.tenant_id=ga.tenant_id WHERE ga.tenant_id=v_tenant AND ga.group_id=tg.id AND (ga.bu_id=o.bu_id OR (ga.inherit_descendants AND b.path <@ assigned.path)));
      END IF;
    ELSE
      SELECT r.id INTO v_registry FROM public.data_resource_registry r WHERE r.tenant_id=v_tenant AND r.resource_type=_resource_type AND CASE _resource_type
        WHEN 'data_source' THEN r.data_source_id WHEN 'data_source_schedule' THEN r.data_source_schedule_id WHEN 'db_connection' THEN r.db_connection_id WHEN 'inline_api_source' THEN r.inline_api_source_id WHEN 'erp_connection' THEN r.erp_connection_id WHEN 'file_watcher' THEN r.file_watcher_id WHEN 'aidp_template' THEN r.aidp_template_id WHEN 'aidp_document' THEN r.aidp_document_id WHEN 'reference_table' THEN r.reference_table_id WHEN 'data_prep_pipeline' THEN r.data_prep_pipeline_id WHEN 'tenant_template' THEN r.tenant_template_id WHEN 'collateral_schedule' THEN r.collateral_schedule_id WHEN 'collateral_csa_agreement' THEN r.collateral_csa_agreement_id END=v_id;
      IF v_registry IS NULL OR NOT EXISTS(SELECT 1 FROM public.data_resource_registry_owner_bu o WHERE o.tenant_id=v_tenant AND o.registry_id=v_registry) THEN access_state:='unmapped';
      ELSE access_state:='mapped'; END IF;
      IF v_admin THEN
        SELECT coalesce(array_agg(DISTINCT b.name ORDER BY b.name),ARRAY[]::text[]) INTO v_owners FROM public.data_resource_registry_owner_bu o JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived WHERE o.tenant_id=v_tenant AND o.registry_id=v_registry;
        SELECT coalesce(array_agg(DISTINCT g.name ORDER BY g.name),ARRAY[]::text[]) INTO v_groups FROM public.data_resource_registry_grants x JOIN public.tenant_groups g ON g.id=x.principal_group_id AND g.tenant_id=x.tenant_id WHERE x.tenant_id=v_tenant AND x.registry_id=v_registry AND x.principal_type='group';
      ELSIF access_state='mapped' THEN
        IF NOT private.data_resource_shadow_allows_actor(v_actor,v_registry,'view'::text) THEN CONTINUE; END IF;
        SELECT coalesce(array_agg(DISTINCT b.name ORDER BY b.name),ARRAY[]::text[]) INTO v_owners FROM public.data_resource_registry_owner_bu o JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived JOIN public.data_resource_registry_grants g ON g.tenant_id=o.tenant_id AND g.registry_id=o.registry_id AND g.bu_id=o.bu_id AND g.action='view' WHERE o.tenant_id=v_tenant AND o.registry_id=v_registry AND ((g.principal_type='user' AND g.principal_user_id=v_actor AND EXISTS(SELECT 1 FROM public.bu_user_assignments ua JOIN public.business_units assigned ON assigned.id=ua.bu_id AND assigned.tenant_id=ua.tenant_id WHERE ua.tenant_id=v_tenant AND ua.user_id=v_actor AND (ua.bu_id=o.bu_id OR (ua.inherit_descendants AND b.path <@ assigned.path)))) OR (g.principal_type='group' AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=g.principal_group_id AND gm.user_id=v_actor) AND EXISTS(SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned ON assigned.id=ga.bu_id AND assigned.tenant_id=ga.tenant_id WHERE ga.tenant_id=v_tenant AND ga.group_id=g.principal_group_id AND (ga.bu_id=o.bu_id OR (ga.inherit_descendants AND b.path <@ assigned.path)))));
        SELECT coalesce(array_agg(DISTINCT tg.name ORDER BY tg.name),ARRAY[]::text[]) INTO v_groups FROM public.data_resource_registry_grants g JOIN public.tenant_groups tg ON tg.id=g.principal_group_id AND tg.tenant_id=g.tenant_id JOIN public.data_resource_registry_owner_bu o ON o.tenant_id=g.tenant_id AND o.registry_id=g.registry_id AND o.bu_id=g.bu_id JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND NOT b.is_archived WHERE g.tenant_id=v_tenant AND g.registry_id=v_registry AND g.action='view' AND g.principal_type='group' AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=tg.id AND gm.user_id=v_actor) AND EXISTS(SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned ON assigned.id=ga.bu_id AND assigned.tenant_id=ga.tenant_id WHERE ga.tenant_id=v_tenant AND ga.group_id=tg.id AND (ga.bu_id=o.bu_id OR (ga.inherit_descendants AND b.path <@ assigned.path)));
      END IF;
    END IF;
    resource_type:=_resource_type; resource_id:=v_id; public_id:=v_public; business_unit_names:=v_owners; business_unit_count:=cardinality(v_owners); user_group_names:=v_groups; user_group_count:=cardinality(v_groups); RETURN NEXT;
  END LOOP;
END $function$


CREATE OR REPLACE FUNCTION public.grant_collateral_schedule_group_action(
  _tenant_id uuid, _schedule_id uuid, _bu_id uuid, _group_id uuid, _action text, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $function$
DECLARE v_actor uuid:=auth.uid(); v_registry uuid; v_root_tenant uuid;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _schedule_id IS NULL OR _bu_id IS NULL OR _group_id IS NULL
    OR _action IS NULL OR _action NOT IN ('view','ingest','run','edit') OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid collateral schedule grant request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant_id AND tm.user_id=v_actor AND tm.active AND tm.role='tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT tenant_id INTO v_root_tenant FROM public.collateral_schedules WHERE id=_schedule_id FOR SHARE;
  IF v_root_tenant IS DISTINCT FROM _tenant_id THEN RAISE EXCEPTION 'schedule tenant mismatch'; END IF;
  SELECT id INTO v_registry FROM public.data_resource_registry WHERE tenant_id=_tenant_id AND resource_type='collateral_schedule' AND collateral_schedule_id=_schedule_id;
  IF v_registry IS NULL THEN RAISE EXCEPTION 'schedule must be explicitly registered first'; END IF;
  RETURN public.grant_typed_data_resource_action(v_registry,_bu_id,'group',_group_id,_action,_reason);
END
$function$;

CREATE OR REPLACE FUNCTION public.revoke_collateral_schedule_group_action(
  _tenant_id uuid, _schedule_id uuid, _grant_id uuid, _reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $function$
DECLARE v_actor uuid:=auth.uid(); v_registry uuid; v_target uuid;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _schedule_id IS NULL OR _grant_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid collateral schedule revoke request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant_id AND tm.user_id=v_actor AND tm.active AND tm.role='tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT id INTO v_registry FROM public.data_resource_registry WHERE tenant_id=_tenant_id AND resource_type='collateral_schedule' AND collateral_schedule_id=_schedule_id;
  SELECT registry_id INTO v_target FROM public.data_resource_registry_grants
    WHERE id=_grant_id AND tenant_id=_tenant_id AND principal_type='group' AND action IN ('view','ingest','run','edit');
  IF v_registry IS NULL OR v_target IS DISTINCT FROM v_registry THEN RAISE EXCEPTION 'grant does not belong to this schedule'; END IF;
  RETURN public.revoke_typed_data_resource_action(_grant_id,_reason);
END
$function$;

REVOKE ALL ON FUNCTION public.get_data_resource_access_summary(text,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_data_resource_access_summary(text,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.grant_collateral_schedule_group_action(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.revoke_collateral_schedule_group_action(uuid,uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.grant_collateral_schedule_group_action(uuid,uuid,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_collateral_schedule_group_action(uuid,uuid,uuid,text) TO authenticated;
