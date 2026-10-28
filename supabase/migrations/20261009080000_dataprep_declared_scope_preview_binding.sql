DO $dpd_full_before$ DECLARE actual jsonb;rel record;rows_before jsonb:='[]';n bigint;digest text;filter text;BEGIN
 IF current_user<>'postgres' OR current_setting('role',true)<>'none' OR current_setting('server_version_num')<>'170006' OR current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'dpd_full.native_context_drift';END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>468 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261009040000' THEN RAISE EXCEPTION 'dpd_full.current_ledger_drift';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60592'::oid),'UTF8')),'hex')) IS DISTINCT FROM '40c357dfe3f5f5c70f9a596e7f5f919734fd42214432369ca2b78c4810a9625c' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpd_save_setup';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60660'::oid),'UTF8')),'hex')) IS DISTINCT FROM '611739e5f71462e844556f04fc50448a61e6f7f70218ceb2ae49338637834768' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpd_bind_setup_preview';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60672'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'f8d3c8c88d492f97e450b59854f0eac96e143f5a193d4c965f3763d7b660d783' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dps_save_configuration';END IF;
 FOR rel IN SELECT c.oid,ns.nspname,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE c.relkind IN('r','p','m') AND ns.nspname NOT IN('pg_catalog','information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp%' ORDER BY c.oid LOOP
 filter:=CASE WHEN rel.nspname='storage' AND rel.relname='buckets' THEN ' WHERE id<>''data-prep-authoring-originals''' ELSE '' END;
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q' ,rel.nspname,rel.relname) INTO n,digest;
 rows_before:=rows_before||jsonb_build_array(jsonb_build_object('oid',rel.oid::text,'schema',rel.nspname,'name',rel.relname,'rows',n::text,'hash',digest));
 END LOOP;
 PERFORM set_config('fvi.dpd_scope.rows',rows_before::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_proc q;PERFORM set_config('fvi.dpd_scope.routines',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;PERFORM set_config('fvi.dpd_scope.roles',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;PERFORM set_config('fvi.dpd_scope.members',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';PERFORM set_config('fvi.dpd_scope.namespaces',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;PERFORM set_config('fvi.dpd_scope.defaultacl',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;PERFORM set_config('fvi.dpd_scope.ledger',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_class q;PERFORM set_config('fvi.dpd_scope.pg_class',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_type q;PERFORM set_config('fvi.dpd_scope.pg_type',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_attribute q;PERFORM set_config('fvi.dpd_scope.pg_attribute',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_constraint q;PERFORM set_config('fvi.dpd_scope.pg_constraint',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_index q;PERFORM set_config('fvi.dpd_scope.pg_index',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_policy q;PERFORM set_config('fvi.dpd_scope.pg_policy',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_trigger q;PERFORM set_config('fvi.dpd_scope.pg_trigger',actual::text,true);
 END $dpd_full_before$;
CREATE FUNCTION private.dpd_pipeline_payload(_payload jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT _payload-ARRAY['_draft_scope','owning_business_unit_ids','sharing_user_group_ids','requested_owning_business_unit_ids','shared_scope_contract']
$$;
REVOKE ALL ON FUNCTION private.dpd_pipeline_payload(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.dpd_save_setup(_tenant_id uuid,_setup_id uuid,_expected_draft_version integer,_payload jsonb,_request_key uuid,_request_context_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s private.dpd_setups%ROWTYPE:=private.dpd_scope(_tenant_id,_setup_id,true);v private.dpd_versions%ROWTYPE;head private.dpd_versions%ROWTYPE;f jsonb;file private.dpd_original_intents%ROWTYPE;schema private.dpd_schema_receipts%ROWTYPE;owners uuid[];groups uuid[];scope jsonb;
BEGIN
 PERFORM private.dpd_request_actor(_tenant_id,_setup_id,'setup.save',_request_context_id);
 IF _request_key IS NULL OR jsonb_typeof(_payload) IS DISTINCT FROM 'object' OR _payload->>'on_failure' IS DISTINCT FROM 'block' OR jsonb_typeof(_payload->'feeds') IS DISTINCT FROM 'array' OR jsonb_array_length(_payload->'feeds') NOT BETWEEN 1 AND 50 OR jsonb_typeof(_payload->'steps') IS DISTINCT FROM 'array' OR jsonb_typeof(_payload->'dq_rules') IS DISTINCT FROM 'array' OR jsonb_typeof(_payload->'business_fields') IS DISTINCT FROM 'array' OR jsonb_typeof(_payload->'required_fields') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'dpd.complete_current_configuration_required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements((_payload->'steps')||(SELECT coalesce(jsonb_agg(step.value),'[]') FROM jsonb_array_elements(_payload->'feeds') AS feed(value) CROSS JOIN LATERAL jsonb_array_elements(coalesce(feed.value->'steps','[]')) AS step(value))) AS st(value) WHERE st.value->>'kind' IN('sort','dedupe','filter','filter_expr')) OR _payload ? 'approved_exclusions' THEN RAISE EXCEPTION 'dpdi.unsupported_transform_or_exclusion_choose_supported_before_save' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM private.dpd_setups WHERE id=s.id FOR UPDATE;SELECT * INTO v FROM private.dpd_versions WHERE setup_id=s.id AND created_by=auth.uid() AND request_key=_request_key;
 IF FOUND THEN IF v.payload IS DISTINCT FROM _payload OR v.version IS DISTINCT FROM _expected_draft_version+1 THEN RAISE EXCEPTION 'dpd.configuration_request_conflict' USING ERRCODE='PT409';END IF;RETURN private.dpd_setup_result(_tenant_id,s.id,auth.uid(),true,v.version);END IF;
 SELECT * INTO head FROM private.dpd_versions WHERE setup_id=s.id ORDER BY version DESC LIMIT 1;IF head.version<>_expected_draft_version THEN RAISE EXCEPTION 'dpd.stale_draft_configuration' USING ERRCODE='PT409';END IF;
 PERFORM private.dpd_validate_confirmed_mapping(_tenant_id,s.id,head.version+1,_payload->'confirmed_mapping');
 FOR f IN SELECT value FROM jsonb_array_elements(_payload->'feeds') LOOP
  IF f->'original_ref' IS NULL THEN CONTINUE;END IF;
 SELECT * INTO file FROM private.dpd_original_intents WHERE id=(f->'original_ref'->>'file_id')::uuid AND setup_id=s.id AND feed_key=f->>'key';SELECT * INTO schema FROM private.dpd_schema_receipts WHERE file_id=file.id;
  IF file.id IS NULL OR schema.file_id IS NULL OR NOT EXISTS(SELECT 1 FROM private.dpd_original_receipts WHERE file_id=file.id) OR schema.schema_sha256 IS DISTINCT FROM f->'original_ref'->>'schema_sha256' OR private.dpd_original_viewable(file.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpd.exact_received_original_schema_pin_required' USING ERRCODE='PT409';END IF;
 END LOOP;
 owners:=head.owner_bu_ids;groups:=head.group_ids;
 IF _payload ? '_draft_scope' THEN
  PERFORM private.dps_admin(_tenant_id);scope:=_payload->'_draft_scope';
  IF jsonb_typeof(scope) IS DISTINCT FROM 'object' OR scope-ARRAY['owner_bu_ids','group_ids']<>'{}'::jsonb OR jsonb_typeof(scope->'owner_bu_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(scope->'group_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'dpd.explicit_declared_scope_required' USING ERRCODE='22023';END IF;
  owners:=private.dps_ids(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(scope->'owner_bu_ids')),100,true);groups:=private.dps_ids(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(scope->'group_ids')),100,false);
  PERFORM private.dps_selections(_tenant_id,owners,groups);
 END IF;
 INSERT INTO private.dpd_versions(setup_id,version,request_key,created_by,payload,payload_sha256,owner_bu_ids,group_ids) VALUES(s.id,head.version+1,_request_key,auth.uid(),_payload,private.dpw_hash(_payload),owners,groups);
 PERFORM private.dpd_event(_tenant_id,s.id,auth.uid(),'configuration.versioned',s.id,jsonb_build_object('draft_version',head.version+1,'configuration_sha256',private.dpw_hash(_payload),'original_refs',_payload->'original_refs'));RETURN private.dpd_setup_result(_tenant_id,s.id,auth.uid(),false);
END $$;

CREATE OR REPLACE FUNCTION public.dpd_bind_setup_preview(_tenant_id uuid,_setup_id uuid,_draft_version integer,_configuration_request_key uuid,_delivery_request_key uuid,_request_context_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'preview.bind',_request_context_id);s private.dpd_setups%ROWTYPE:=private.dpd_scope(_tenant_id,_setup_id,true);v private.dpd_versions%ROWTYPE;l private.dpd_preview_links%ROWTYPE;prior private.dpd_preview_links%ROWTYPE;feed jsonb;linked private.dpd_raw_source_links%ROWTYPE;native jsonb;delivery jsonb;manifest jsonb:='[]';input jsonb;newfeeds jsonb:='[]';payload jsonb;amount bigint;item jsonb;bound private.dpd_preview_file_links%ROWTYPE;declared jsonb;ref jsonb;
BEGIN
 PERFORM 1 FROM private.dpd_setups WHERE id=s.id FOR UPDATE;SELECT * INTO v FROM private.dpd_versions WHERE setup_id=s.id ORDER BY version DESC LIMIT 1;
 IF v.version<>_draft_version OR _configuration_request_key IS NULL OR _delivery_request_key IS NULL THEN RAISE EXCEPTION 'dpd.current_draft_version_required' USING ERRCODE='PT409';END IF;
 PERFORM private.dpd_validate_confirmed_mapping(_tenant_id,s.id,v.version,v.payload->'confirmed_mapping');
 IF (v.payload ? 'sharing_user_group_ids' AND private.dps_ids(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(v.payload->'sharing_user_group_ids')),100,false) IS DISTINCT FROM private.dps_ids(v.group_ids,100,false)) OR (v.payload ? 'owning_business_unit_ids' AND private.dps_ids(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(v.payload->'owning_business_unit_ids')),100,true) IS DISTINCT FROM private.dps_ids(v.owner_bu_ids,100,true)) THEN RAISE EXCEPTION 'dpd.authoritative_scope_revision_required_preserve_history' USING ERRCODE='PT409';END IF;

 SELECT * INTO l FROM private.dpd_preview_links WHERE setup_id=s.id AND draft_version=v.version;
 IF FOUND THEN IF l.configuration_request_key<>_configuration_request_key OR l.delivery_request_key<>_delivery_request_key THEN RAISE EXCEPTION 'dpd.preview_request_conflict' USING ERRCODE='PT409';END IF;PERFORM private.dpw_authorize(_tenant_id,l.pipeline_id,'run');RETURN private.dpd_preview_result(actor,l);END IF;
 IF jsonb_typeof(v.payload->'feeds') IS DISTINCT FROM 'array' OR jsonb_array_length(v.payload->'feeds')=0 THEN RAISE EXCEPTION 'dpd.full_received_feed_configuration_required' USING ERRCODE='PT409';END IF;
 FOR feed IN SELECT value FROM jsonb_array_elements(v.payload->'feeds') LOOP
  SELECT x.value INTO declared FROM jsonb_array_elements(v.payload->'confirmed_mapping'->'feeds') AS x(value) WHERE x.value->>'key'=feed->>'key';
  IF declared IS NULL OR feed->'mappings' IS DISTINCT FROM declared->'mappings' THEN RAISE EXCEPTION 'dpd.pipeline_feed_confirmed_mapping_conflict' USING ERRCODE='PT409';END IF;
  newfeeds:=newfeeds||jsonb_build_array(feed||jsonb_build_object('data_source_id',declared->>'data_source_id'));
  FOR ref IN SELECT value FROM jsonb_array_elements(declared->'original_refs') LOOP
   SELECT * INTO linked FROM private.dpd_raw_source_links WHERE file_id=(ref->>'file_id')::uuid AND setup_id=s.id;
   IF NOT FOUND OR linked.data_source_id::text IS DISTINCT FROM declared->>'data_source_id' OR private.dpw_source_allows(actor,_tenant_id,linked.data_source_id,'view') IS DISTINCT FROM true OR private.dpw_source_allows(actor,_tenant_id,linked.data_source_id,'ingest') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpd.registered_current_original_source_required' USING ERRCODE='42501';END IF;
   input:=private.dpd_selected_input(linked.file_id,ref);
   manifest:=manifest||jsonb_build_array(input||jsonb_build_object('original',ref,'feed_key',feed->>'key','data_source_id',linked.data_source_id,'original_ref',ref,'configuration_sha256',v.payload_sha256,'original_storage_reupload',false));
  END LOOP;
 END LOOP;
 SELECT sum((m.value->>'row_count')::bigint) INTO amount FROM jsonb_array_elements(manifest) AS m(value);IF amount>1000000 THEN RAISE EXCEPTION 'dpd.preview_selected_cohort_row_budget_exceeded' USING ERRCODE='PT409';END IF;
 SELECT * INTO prior FROM private.dpd_preview_links WHERE setup_id=s.id ORDER BY draft_version DESC LIMIT 1;payload:=private.dpd_pipeline_payload(v.payload)||jsonb_build_object('feeds',newfeeds);
 native:=public.dps_save_configuration(_tenant_id,prior.pipeline_id,payload,v.owner_bu_ids,v.group_ids,_configuration_request_key,_request_context_id,_setup_id);
 delivery:=public.dpw_create_delivery(_tenant_id,(native->'pipeline'->>'id')::uuid,(s.input->>'business_date')::date,_delivery_request_key,NULL,'preview',NULL,s.input->>'execution_mode',(s.input->>'human_in_loop')::boolean);
 INSERT INTO private.dpd_preview_links(setup_id,draft_version,tenant_id,created_by,pipeline_id,configuration_id,pipeline_version,batch_id,configuration_request_key,delivery_request_key,input_manifest,input_manifest_sha256)
 VALUES(s.id,v.version,_tenant_id,actor,(native->'pipeline'->>'id')::uuid,(native->>'configuration_id')::uuid,(native->'pipeline'->>'version')::integer,(delivery->'batch'->>'id')::uuid,_configuration_request_key,_delivery_request_key,manifest,private.dpw_hash(manifest)) RETURNING * INTO l;
 FOR item IN SELECT value FROM jsonb_array_elements(manifest) LOOP
 INSERT INTO private.dpd_preview_file_links(setup_id,draft_version,original_file_id,data_source_id,feed_key,selection,selection_sha256,rows_count) VALUES(s.id,v.version,(item->>'file_id')::uuid,(item->>'data_source_id')::uuid,item->>'feed_key',item->'original_ref',item->>'selection_sha256',(item->>'row_count')::bigint);
 END LOOP;
 PERFORM private.dpd_event(_tenant_id,s.id,actor,'preview.configuration.bound',l.batch_id,jsonb_build_object('configuration_id',l.configuration_id,'draft_version',v.version,'input_manifest_sha256',l.input_manifest_sha256,'original_reupload',false,'publish_allowed',false));RETURN private.dpd_preview_result(actor,l);
END $$;

CREATE OR REPLACE FUNCTION public.dps_save_configuration(_tenant_id uuid,_pipeline_id uuid,_payload jsonb,_owning_business_unit_ids uuid[],_sharing_user_group_ids uuid[],_request_key uuid,_request_context_id uuid DEFAULT NULL,_setup_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v private.dpd_versions%ROWTYPE;operation text;expected jsonb;feeds jsonb;
BEGIN
 IF _payload ?| ARRAY['_draft_scope','owning_business_unit_ids','sharing_user_group_ids','requested_owning_business_unit_ids','shared_scope_contract'] THEN RAISE EXCEPTION 'dps.reserved_scope_metadata' USING ERRCODE='22023';END IF;
 SELECT c.operation INTO operation FROM private.dpd_request_contexts c WHERE c.id=_request_context_id;
 IF operation NOT IN('scope.save','preview.bind') OR operation IS NULL THEN RAISE EXCEPTION 'dps.configuration_operation_required' USING ERRCODE='42501';END IF;
 PERFORM private.dps_context_actor(_tenant_id,_setup_id,operation,_request_context_id);
 SELECT * INTO v FROM private.dpd_versions WHERE setup_id=_setup_id ORDER BY version DESC LIMIT 1;
 IF v.version IS NULL OR private.dps_ids(v.owner_bu_ids,100,true) IS DISTINCT FROM private.dps_ids(_owning_business_unit_ids,100,true) OR private.dps_ids(v.group_ids,100,false) IS DISTINCT FROM private.dps_ids(_sharing_user_group_ids,100,false)
 THEN RAISE EXCEPTION 'dps.exact_saved_draft_scope_required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(f.value||jsonb_build_object('data_source_id',mapped.value->>'data_source_id') ORDER BY f.ordinality),'[]') INTO feeds
 FROM jsonb_array_elements(v.payload->'feeds') WITH ORDINALITY f(value,ordinality)
 JOIN LATERAL(SELECT x.value FROM jsonb_array_elements(v.payload->'confirmed_mapping'->'feeds') x(value) WHERE x.value->>'key'=f.value->>'key') mapped ON true;
 expected:=private.dpd_pipeline_payload(v.payload)||jsonb_build_object('feeds',feeds);
 IF expected IS DISTINCT FROM _payload THEN RAISE EXCEPTION 'dps.exact_saved_mapping_payload_required' USING ERRCODE='42501';END IF;
 IF _pipeline_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.dpd_preview_links WHERE setup_id=_setup_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id) THEN RAISE EXCEPTION 'dps.setup_pipeline_binding_required' USING ERRCODE='42501';END IF;
 RETURN private.dps_save_configuration_core(_tenant_id,_pipeline_id,_payload,_owning_business_unit_ids,_sharing_user_group_ids,_request_key);
END $$;


DO $dpd_full_after$ DECLARE old jsonb;actual jsonb;n bigint;digest text;BEGIN
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.rows')::jsonb) LOOP
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q',old->>'schema',old->>'name') INTO n,digest;
 IF n::text IS DISTINCT FROM old->>'rows' OR digest IS DISTINCT FROM old->>'hash' THEN RAISE EXCEPTION 'dpd_full.old_rows_changed:%',old->>'name'; END IF;END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.routines')::jsonb) LOOP
 SELECT to_jsonb(q) INTO actual FROM pg_proc q WHERE q.oid=(old->>'oid')::oid;
 IF old->>'oid'=ANY(ARRAY['60592','60660','60672']::text[]) THEN
  IF actual-'prosrc' IS DISTINCT FROM old-'prosrc' THEN RAISE EXCEPTION 'dpd_full.consumer_catalog_changed';END IF;
 ELSE IF actual IS DISTINCT FROM old THEN RAISE EXCEPTION 'dpd_full.old_routine_changed:%',old->>'oid';END IF;END IF;END LOOP;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60592'::oid) IS DISTINCT FROM '6b7ca794343e93150b85e0314d431b0d5071d4f586a044d5251c49a8716109a7' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpd_save_setup';END IF;
IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60660'::oid) IS DISTINCT FROM '4c0af5da6746c244eafa4e2eec85daaa43a6ff071a60960cdaeda34577ffb2ab' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpd_bind_setup_preview';END IF;
IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60672'::oid) IS DISTINCT FROM 'e330d2b19158a6e5e2a2896ab21ef3cb4c7c41e62b2903600a5d618fd5e13ce6' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dps_save_configuration';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_scope.roles')::jsonb THEN RAISE EXCEPTION 'dpd_full.roles_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_scope.members')::jsonb THEN RAISE EXCEPTION 'dpd_full.members_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';IF actual IS DISTINCT FROM current_setting('fvi.dpd_scope.namespaces')::jsonb THEN RAISE EXCEPTION 'dpd_full.namespaces_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_scope.defaultacl')::jsonb THEN RAISE EXCEPTION 'dpd_full.defaultacl_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_scope.ledger')::jsonb THEN RAISE EXCEPTION 'dpd_full.ledger_changed';END IF;
 IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_class')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_class q) THEN RAISE EXCEPTION 'dpd_full.old_pg_class_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_type')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_type q) THEN RAISE EXCEPTION 'dpd_full.old_pg_type_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_attribute')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_attribute q) THEN RAISE EXCEPTION 'dpd_full.old_pg_attribute_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_constraint')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_constraint q) THEN RAISE EXCEPTION 'dpd_full.old_pg_constraint_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_index')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_index q) THEN RAISE EXCEPTION 'dpd_full.old_pg_index_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_policy')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_policy q) THEN RAISE EXCEPTION 'dpd_full.old_pg_policy_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_scope.pg_trigger')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_trigger q) THEN RAISE EXCEPTION 'dpd_full.old_pg_trigger_changed';END IF;
 END $dpd_full_after$;
