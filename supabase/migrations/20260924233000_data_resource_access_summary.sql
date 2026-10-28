-- Batched, tenant-bound metadata read for resource tables. This is not an
-- authorization predicate for the resource list itself; existing RLS remains
-- authoritative until reviewed mapping and a separate cutover.

ALTER TABLE public.data_resource_registry
  ADD COLUMN data_source_schedule_id uuid REFERENCES public.data_source_schedules(id) ON DELETE RESTRICT;
ALTER TABLE public.data_resource_registry DROP CONSTRAINT data_resource_registry_resource_type_check;
ALTER TABLE public.data_resource_registry ADD CONSTRAINT data_resource_registry_resource_type_check
  CHECK (resource_type IN ('data_source','db_connection','inline_api_source','erp_connection','file_watcher',
    'aidp_template','aidp_document','reference_table','data_prep_pipeline','data_source_schedule'));
ALTER TABLE public.data_resource_registry DROP CONSTRAINT data_resource_registry_exact_root_ck;
ALTER TABLE public.data_resource_registry ADD CONSTRAINT data_resource_registry_exact_root_ck CHECK (
  (resource_type='data_source' AND data_source_id IS NOT NULL AND num_nonnulls(db_connection_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_template_id,aidp_document_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='db_connection' AND db_connection_id IS NOT NULL AND num_nonnulls(data_source_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_template_id,aidp_document_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='inline_api_source' AND inline_api_source_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,erp_connection_id,file_watcher_id,aidp_template_id,aidp_document_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='erp_connection' AND erp_connection_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,file_watcher_id,aidp_template_id,aidp_document_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='file_watcher' AND file_watcher_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,erp_connection_id,aidp_template_id,aidp_document_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='aidp_template' AND aidp_template_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_document_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='aidp_document' AND aidp_document_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_template_id,reference_table_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='reference_table' AND reference_table_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_template_id,aidp_document_id,data_prep_pipeline_id,data_source_schedule_id)=0) OR
  (resource_type='data_prep_pipeline' AND data_prep_pipeline_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_template_id,aidp_document_id,reference_table_id,data_source_schedule_id)=0) OR
  (resource_type='data_source_schedule' AND data_source_schedule_id IS NOT NULL AND num_nonnulls(data_source_id,db_connection_id,inline_api_source_id,erp_connection_id,file_watcher_id,aidp_template_id,aidp_document_id,reference_table_id,data_prep_pipeline_id)=0)
);
CREATE UNIQUE INDEX data_resource_registry_schedule_uq ON public.data_resource_registry(data_source_schedule_id) WHERE data_source_schedule_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_data_resource_registry_root()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_root_tenant uuid; v_resource_uuid uuid;
BEGIN
  v_resource_uuid := CASE NEW.resource_type
    WHEN 'data_source' THEN NEW.data_source_id WHEN 'db_connection' THEN NEW.db_connection_id
    WHEN 'inline_api_source' THEN NEW.inline_api_source_id WHEN 'erp_connection' THEN NEW.erp_connection_id
    WHEN 'file_watcher' THEN NEW.file_watcher_id WHEN 'aidp_template' THEN NEW.aidp_template_id
    WHEN 'aidp_document' THEN NEW.aidp_document_id WHEN 'reference_table' THEN NEW.reference_table_id
    WHEN 'data_prep_pipeline' THEN NEW.data_prep_pipeline_id WHEN 'data_source_schedule' THEN NEW.data_source_schedule_id END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fvi-resource:'||NEW.resource_type||':'||v_resource_uuid::text,0));
  CASE NEW.resource_type
    WHEN 'data_source' THEN SELECT tenant_id INTO v_root_tenant FROM public.workspace_data_sources WHERE id=NEW.data_source_id FOR SHARE;
    WHEN 'db_connection' THEN SELECT tenant_id INTO v_root_tenant FROM public.rekon_db_connections WHERE id=NEW.db_connection_id FOR SHARE;
    WHEN 'inline_api_source' THEN SELECT tenant_id INTO v_root_tenant FROM public.rekon_inline_api_sources WHERE id=NEW.inline_api_source_id FOR SHARE;
    WHEN 'erp_connection' THEN SELECT tenant_id INTO v_root_tenant FROM public.erp_connector_configs WHERE id=NEW.erp_connection_id FOR SHARE;
    WHEN 'file_watcher' THEN SELECT tenant_id INTO v_root_tenant FROM public.data_watchers WHERE id=NEW.file_watcher_id FOR SHARE;
    WHEN 'aidp_template' THEN SELECT tenant_id INTO v_root_tenant FROM public.aidp_templates WHERE id=NEW.aidp_template_id FOR SHARE;
    WHEN 'aidp_document' THEN SELECT tenant_id INTO v_root_tenant FROM public.aidp_documents WHERE id=NEW.aidp_document_id FOR SHARE;
    WHEN 'reference_table' THEN SELECT tenant_id INTO v_root_tenant FROM public.reference_data_tables WHERE id=NEW.reference_table_id FOR SHARE;
    WHEN 'data_prep_pipeline' THEN SELECT tenant_id INTO v_root_tenant FROM public.data_prep_pipelines WHERE id=NEW.data_prep_pipeline_id FOR SHARE;
    WHEN 'data_source_schedule' THEN
      SELECT s.tenant_id INTO v_root_tenant FROM public.data_source_schedules s
      JOIN public.workspace_data_sources d ON d.id=s.data_source_id AND d.tenant_id=s.tenant_id
      WHERE s.id=NEW.data_source_schedule_id FOR SHARE OF s,d;
  END CASE;
  IF v_root_tenant IS NULL OR v_root_tenant<>NEW.tenant_id THEN RAISE EXCEPTION 'resource root must exist in the declared tenant'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_registered_schedule_tenant_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fvi-resource:data_source_schedule:'||OLD.id::text,0));
  IF EXISTS(SELECT 1 FROM public.data_resource_registry r WHERE r.data_source_schedule_id=OLD.id) THEN
    RAISE EXCEPTION 'tenant cannot change for a registered resource';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_schedule_tenant_guard BEFORE UPDATE OF tenant_id ON public.data_source_schedules
  FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_schedule_tenant_change();

CREATE OR REPLACE FUNCTION public.register_typed_data_source_schedule(
  _schedule_id uuid, _owner_bu_ids uuid[], _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $$
DECLARE v_actor uuid:=auth.uid(); v_tenant uuid; v_registry uuid; v_bu_ids uuid[];
BEGIN
  IF v_actor IS NULL OR _schedule_id IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'invalid schedule registration request'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.data_source_schedules WHERE id=_schedule_id FOR SHARE;
  IF v_tenant IS NULL OR NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=v_tenant AND tm.user_id=v_actor AND tm.active AND tm.role='tenant_admin'::public.tenant_role) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_bu_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) x;
  IF cardinality(v_bu_ids)=0 OR EXISTS(SELECT 1 FROM unnest(v_bu_ids) x LEFT JOIN public.business_units b ON b.id=x AND b.tenant_id=v_tenant AND NOT b.is_archived WHERE b.id IS NULL) THEN RAISE EXCEPTION 'active owner business units in the schedule tenant are required'; END IF;
  INSERT INTO public.data_resource_registry(tenant_id,resource_type,data_source_schedule_id,created_by) VALUES(v_tenant,'data_source_schedule',_schedule_id,v_actor) RETURNING id INTO v_registry;
  INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id,created_by) SELECT v_tenant,v_registry,x,v_actor FROM unnest(v_bu_ids) x;
  INSERT INTO public.data_resource_registry_admin_audit(tenant_id,registry_id,operation,actor_id,reason,details) VALUES(v_tenant,v_registry,'REGISTER',v_actor,btrim(_reason),jsonb_build_object('resource_type','data_source_schedule','resource_id',_schedule_id,'owner_bu_ids',v_bu_ids));
  RETURN v_registry;
END $$;
REVOKE ALL ON FUNCTION public.register_typed_data_source_schedule(uuid,uuid[],text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.register_typed_data_source_schedule(uuid,uuid[],text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_data_resource_access_summary(_resource_type text, _resource_ids uuid[])
RETURNS TABLE(resource_type text, resource_id uuid, public_id text, access_state text,
  business_unit_names text[], business_unit_count integer, user_group_names text[], user_group_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $$
DECLARE v_actor uuid:=auth.uid(); v_ids uuid[]; v_id uuid; v_tenant uuid; v_admin boolean; v_registry uuid;
  v_public text; v_owners text[]; v_groups text[];
BEGIN
  IF v_actor IS NULL OR _resource_type NOT IN ('data_source','data_source_schedule','db_connection','inline_api_source','erp_connection','file_watcher','aidp_template','aidp_document','reference_table','data_prep_pipeline','reconciliation') THEN RAISE EXCEPTION 'invalid access summary request'; END IF;
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
      WHEN 'data_prep_pipeline' THEN SELECT s.tenant_id,s.uid::text INTO v_tenant,v_public FROM public.data_prep_pipelines s WHERE s.id=v_id;
      WHEN 'reconciliation' THEN SELECT s.tenant_id,s.recon_code INTO v_tenant,v_public FROM public.recon_definitions s WHERE s.id=v_id;
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
        WHEN 'data_source' THEN r.data_source_id WHEN 'data_source_schedule' THEN r.data_source_schedule_id WHEN 'db_connection' THEN r.db_connection_id WHEN 'inline_api_source' THEN r.inline_api_source_id WHEN 'erp_connection' THEN r.erp_connection_id WHEN 'file_watcher' THEN r.file_watcher_id WHEN 'aidp_template' THEN r.aidp_template_id WHEN 'aidp_document' THEN r.aidp_document_id WHEN 'reference_table' THEN r.reference_table_id WHEN 'data_prep_pipeline' THEN r.data_prep_pipeline_id END=v_id;
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
END $$;
REVOKE ALL ON FUNCTION public.get_data_resource_access_summary(text,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_data_resource_access_summary(text,uuid[]) TO authenticated;
COMMENT ON FUNCTION public.get_data_resource_access_summary(text,uuid[]) IS 'Batched metadata for already-authorized table rows only. It is not an authorization proof; existing RLS remains authoritative.';
COMMENT ON TABLE public.data_resource_registry IS 'Shadow-only typed FK-backed registry including scheduled source connectors; legacy rows remain unmapped.';
