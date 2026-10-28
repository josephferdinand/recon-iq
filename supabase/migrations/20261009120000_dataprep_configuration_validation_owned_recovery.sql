DO $dpd_full_before$ DECLARE actual jsonb;rel record;rows_before jsonb:='[]';n bigint;digest text;filter text;BEGIN
 IF current_user<>'postgres' OR current_setting('role',true)<>'none' OR current_setting('server_version_num')<>'170006' OR current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'dpd_full.native_context_drift';END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>469 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261009080000' THEN RAISE EXCEPTION 'dpd_full.current_ledger_drift';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60592'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'db5fbf22351d4c2d0744f990826dd6aa5fd58ff95c6b3d56ffc598bb8c402233' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpd_save_setup';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60798'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'a7bfea018f5d6691595d2b500b5042863946cfc033d2ca87ef9da3fdcfe6ec47' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpdi_enqueue_preview';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60903'::oid),'UTF8')),'hex')) IS DISTINCT FROM '6916987dbaef60c11dfde79fff2e7cde6779fe6717375047b8c7936784c079d8' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpdi_enqueue_approved_prepare';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60578'::oid),'UTF8')),'hex')) IS DISTINCT FROM '9d1a12f96ba26ca83e988727f0823fc9d7c9831a38ec7404711e5cde7c654aa6' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpd_issue_request_context';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60799'::oid),'UTF8')),'hex')) IS DISTINCT FROM '3009b5bb61edf1e8dfb071e24113a33868eccbbd9504af6415235d8274d2dbb7' THEN RAISE EXCEPTION 'dpd_full.exact_scope_preimage_changed:public.dpdi_get_preview_job';END IF;
 FOR rel IN SELECT c.oid,ns.nspname,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE c.relkind IN('r','p','m') AND ns.nspname NOT IN('pg_catalog','information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp%' ORDER BY c.oid LOOP
 filter:=CASE WHEN rel.nspname='storage' AND rel.relname='buckets' THEN ' WHERE id<>''data-prep-authoring-originals''' ELSE '' END;
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q' ,rel.nspname,rel.relname) INTO n,digest;
 rows_before:=rows_before||jsonb_build_array(jsonb_build_object('oid',rel.oid::text,'schema',rel.nspname,'name',rel.relname,'rows',n::text,'hash',digest));
 END LOOP;
 PERFORM set_config('fvi.dpd_recovery.rows',rows_before::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_proc q;PERFORM set_config('fvi.dpd_recovery.routines',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;PERFORM set_config('fvi.dpd_recovery.roles',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;PERFORM set_config('fvi.dpd_recovery.members',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';PERFORM set_config('fvi.dpd_recovery.namespaces',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;PERFORM set_config('fvi.dpd_recovery.defaultacl',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;PERFORM set_config('fvi.dpd_recovery.ledger',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_class q;PERFORM set_config('fvi.dpd_recovery.pg_class',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_type q;PERFORM set_config('fvi.dpd_recovery.pg_type',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_attribute q;PERFORM set_config('fvi.dpd_recovery.pg_attribute',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_constraint q;PERFORM set_config('fvi.dpd_recovery.pg_constraint',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_index q;PERFORM set_config('fvi.dpd_recovery.pg_index',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_policy q;PERFORM set_config('fvi.dpd_recovery.pg_policy',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_trigger q;PERFORM set_config('fvi.dpd_recovery.pg_trigger',actual::text,true);
 END $dpd_full_before$;
CREATE FUNCTION private.dpd_canonical_transform_catalog() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT '{"trim":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"ltrim":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"rtrim":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"collapse_whitespace":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"uppercase":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"lowercase":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"titlecase":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"remove_non_printable":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"pad_left":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"length","label":"Length","kind":"number","required":true},{"name":"char","label":"Pad char","kind":"text","placeholder":"0"}]},"pad_right":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"length","label":"Length","kind":"number","required":true},{"name":"char","label":"Pad char","kind":"text","placeholder":" "}]},"substring":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"start","label":"Start","kind":"number","required":true},{"name":"end","label":"End","kind":"number"}]},"replace":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"find","label":"Find","kind":"text","required":true},{"name":"replace","label":"Replace with","kind":"text"}]},"regex_replace":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"pattern","label":"Regex","kind":"text","required":true},{"name":"replace","label":"Replacement","kind":"text"}]},"cast_number":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"cast_int":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"cast_boolean":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"cast_date":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"parse_date_format":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"format","label":"Format","kind":"select","options":["DD/MM/YYYY","MM/DD/YYYY","YYYY-MM-DD","DD-MMM-YYYY","YYYYMMDD"],"required":true}]},"round":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"decimals","label":"Decimals","kind":"number","required":true}]},"abs":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"rename":{"params":[{"name":"field","label":"From","kind":"text","required":true},{"name":"to","label":"To","kind":"text","required":true}]},"drop_columns":{"params":[{"name":"fields","label":"Fields (comma list)","kind":"csv","required":true}]},"select_columns":{"params":[{"name":"fields","label":"Fields (comma list)","kind":"csv","required":true}]},"fill_null":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"value","label":"Default value","kind":"text","required":true}]},"coalesce":{"params":[{"name":"fields","label":"Source fields (csv)","kind":"csv","required":true},{"name":"to","label":"Target field","kind":"text","required":true}]},"dedupe":{"params":[{"name":"fields","label":"Key fields (csv)","kind":"csv","required":true}]},"sort":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"direction","label":"Direction","kind":"select","options":["asc","desc"]}]},"filter":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"pattern","label":"Regex","kind":"text","required":true}]},"filter_expr":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"expr","label":"Expression","kind":"text","placeholder":"> 100","required":true}]},"derive_concat":{"params":[{"name":"fields","label":"Source fields (csv)","kind":"csv","required":true},{"name":"to","label":"Target field","kind":"text","required":true},{"name":"separator","label":"Separator","kind":"text","placeholder":" "}]},"derive_arithmetic":{"params":[{"name":"left","label":"Left field","kind":"text","required":true},{"name":"op","label":"Op","kind":"select","options":["+","-","*","/"],"required":true},{"name":"right","label":"Right field","kind":"text","required":true},{"name":"to","label":"Target field","kind":"text","required":true}]},"split":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"delimiter","label":"Delimiter","kind":"text","required":true},{"name":"index","label":"Token #","kind":"number","required":true},{"name":"to","label":"Target field","kind":"text","required":true}]},"json_extract":{"params":[{"name":"field","label":"JSON field","kind":"text","required":true},{"name":"path","label":"Dotted path","kind":"text","placeholder":"data.amount","required":true},{"name":"to","label":"Target field","kind":"text","required":true}]},"normalize_currency_amount":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"flip_sign_when":{"params":[{"name":"amount_field","label":"Amount field","kind":"text","required":true},{"name":"indicator_field","label":"Indicator field","kind":"text","required":true},{"name":"indicator_value","label":"When equals","kind":"text","placeholder":"DR","required":true}]},"normalize_iban":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"normalize_bic":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"normalize_isin":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"normalize_country":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"mask_pii":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"show_last","label":"Show last #","kind":"number","placeholder":"4"}]},"hash_field":{"params":[{"name":"field","label":"Field","kind":"text","required":true}]},"redact":{"params":[{"name":"field","label":"Field","kind":"text","required":true},{"name":"token","label":"Token","kind":"text","placeholder":"[REDACTED]"}]}}'::jsonb$$;
REVOKE ALL ON FUNCTION private.dpd_canonical_transform_catalog() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.dpd_transform_issues(_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE entry record;step jsonb;definition jsonb;parameter jsonb;value jsonb;issues jsonb:='[]';location jsonb;
BEGIN
 IF jsonb_typeof(_payload->'steps') IS DISTINCT FROM 'array' OR jsonb_typeof(_payload->'feeds') IS DISTINCT FROM 'array' THEN
  RETURN jsonb_build_array(jsonb_build_object('path','[]'::jsonb,'code','configuration_step_arrays_required'));
 END IF;
 FOR entry IN
  SELECT x.value step,jsonb_build_array('steps',x.ordinality-1) path FROM jsonb_array_elements(_payload->'steps') WITH ORDINALITY x(value,ordinality)
  UNION ALL
  SELECT x.value,jsonb_build_array('feeds',f.ordinality-1,'steps',x.ordinality-1) FROM jsonb_array_elements(_payload->'feeds') WITH ORDINALITY f(value,ordinality)
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.value->'steps')='array' THEN f.value->'steps' ELSE '[]'::jsonb END) WITH ORDINALITY x(value,ordinality)
 LOOP
  step:=entry.step;location:=entry.path;definition:=private.dpd_canonical_transform_catalog()->(step->>'kind');
  IF jsonb_typeof(step) IS DISTINCT FROM 'object' OR definition IS NULL THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('path',location||jsonb_build_array('kind'),'code','unknown_transform_kind','kind',step->>'kind'));CONTINUE;
  END IF;
  FOR parameter IN SELECT p.value FROM jsonb_array_elements(definition->'params') p(value) LOOP
   value:=step->(parameter->>'name');IF value IS NULL OR value='null'::jsonb THEN value:=step->'params'->(parameter->>'name');END IF;
   IF coalesce((parameter->>'required')::boolean,false) AND (value IS NULL OR value='null'::jsonb OR value='""'::jsonb OR value='[]'::jsonb) THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('path',location||jsonb_build_array(parameter->>'name'),'code','required_transform_parameter'));CONTINUE;
   END IF;
   IF value IS NULL OR value='null'::jsonb OR value='""'::jsonb THEN CONTINUE;END IF;
   IF (parameter->>'kind'='csv' AND (jsonb_typeof(value)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE '[]'::jsonb END) v(cell) WHERE jsonb_typeof(v.cell)<>'string' OR btrim(v.cell#>>'{}')='')))
    OR (parameter->>'kind'='number' AND jsonb_typeof(value)<>'number')
    OR (parameter->>'kind'='select' AND (jsonb_typeof(value)<>'string' OR NOT(parameter->'options' @> jsonb_build_array(value)))) THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('path',location||jsonb_build_array(parameter->>'name'),'code','transform_parameter_domain'));
   END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_payload->'feeds') f WHERE f ? 'steps' AND jsonb_typeof(f->'steps') IS DISTINCT FROM 'array') THEN
  issues:=issues||jsonb_build_array(jsonb_build_object('path',jsonb_build_array('feeds','steps'),'code','configuration_step_arrays_required'));
 END IF;
 RETURN issues;
END $$;
CREATE FUNCTION private.dpd_assert_transform_configuration(_payload jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE issues jsonb:=private.dpd_transform_issues(_payload);
BEGIN IF jsonb_array_length(issues)>0 THEN RAISE EXCEPTION 'dpd.invalid_transform_configuration' USING ERRCODE='22023',DETAIL=issues::text,HINT='Use canonical catalog kinds and valid parameters in a new explicit configuration version; existing snapshots are immutable.';END IF;END $$;
REVOKE ALL ON FUNCTION private.dpd_transform_issues(jsonb),private.dpd_assert_transform_configuration(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.dpdi_terminal_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,setup_id uuid NOT NULL,
 job_id uuid NOT NULL UNIQUE REFERENCES private.dpdi_jobs(id),actor_id uuid NOT NULL,request_key uuid NOT NULL,
 snapshot_sha256 text NOT NULL,previous_head_event_id bigint NOT NULL,event_id bigint NOT NULL REFERENCES private.dpdi_job_events(id),
 claim_key uuid,reason_code text NOT NULL CHECK(reason_code IN('invalid_configuration','owner_cancelled')),
 phase text NOT NULL CHECK(phase IN('blocked','cancelled')),validation_issues jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(tenant_id,actor_id,request_key));
ALTER TABLE private.dpdi_terminal_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dpdi_terminal_intents FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER dpdi_terminal_intents_immutable BEFORE UPDATE OR DELETE ON private.dpdi_terminal_intents FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
CREATE FUNCTION private.dpdi_terminal_intent_dto(t private.dpdi_terminal_intents) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT to_jsonb(t)||jsonb_build_object('previous_head_event_id',t.previous_head_event_id::text,'event_id',t.event_id::text)
$$;
REVOKE ALL ON FUNCTION private.dpdi_terminal_intent_dto(private.dpdi_terminal_intents) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.dpdi_cancel_owned_job(_tenant_id uuid,_setup_id uuid,_job_id uuid,_expected_snapshot_sha256 text,_expected_head_event_id bigint,_claim_key uuid,_reason_code text,_request_key uuid,_request_context_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'preview.job.cancel',_request_context_id);
 j private.dpdi_jobs%ROWTYPE;e private.dpdi_job_events%ROWTYPE;t private.dpdi_terminal_intents%ROWTYPE;
 run public.data_prep_delivery_runs%ROWTYPE;issues jsonb;terminal_result jsonb;phase text;event_id bigint;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 IF public.user_has_permission(actor,_tenant_id,'data.prep.author',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpdi.current_author_required_for_owned_terminal_intent' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM private.dpdi_jobs WHERE id=_job_id AND tenant_id=_tenant_id AND setup_id=_setup_id AND actor_id=actor FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'dpdi.actual_owned_job_required' USING ERRCODE='42501';END IF;
 -- Read authorization retains the exact historical configuration without requiring
 -- the latest draft version. Cancellation adds current RUN and source INGEST gates.
 PERFORM private.dpdi_authorize(_tenant_id,_setup_id,j.id,actor,false);
 IF private.data_prep_pipeline_scope_allows(actor,_tenant_id,(j.snapshot->>'pipeline_id')::uuid,'run') IS DISTINCT FROM true
 OR EXISTS(SELECT 1 FROM private.dpd_preview_file_links i WHERE i.setup_id=j.setup_id AND i.draft_version=j.draft_version AND
  (private.dpw_source_allows(actor,_tenant_id,i.data_source_id,'view') IS DISTINCT FROM true OR private.dpw_source_allows(actor,_tenant_id,i.data_source_id,'ingest') IS DISTINCT FROM true))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(j.snapshot->'inputs') pin(value) WHERE NOT EXISTS(
  SELECT 1 FROM private.dpd_preview_file_links i WHERE i.setup_id=j.setup_id AND i.draft_version=j.draft_version
   AND i.id::text=pin.value->>'input_id' AND i.data_source_id::text=pin.value->>'data_source_id'
   AND i.original_file_id::text=pin.value->>'original_file_id' AND i.selection_sha256 IS NOT DISTINCT FROM pin.value->>'selection_sha256'))
 THEN RAISE EXCEPTION 'dpdi.current_snapshot_source_run_authority_required' USING ERRCODE='42501';END IF;
 IF _request_key IS NULL OR _expected_head_event_id IS NULL OR _expected_snapshot_sha256 IS DISTINCT FROM j.snapshot_sha256
 OR private.dpw_hash(j.snapshot) IS DISTINCT FROM j.snapshot_sha256 OR _reason_code IS NULL OR _reason_code NOT IN('invalid_configuration','owner_cancelled')
 THEN RAISE EXCEPTION 'dpdi.exact_terminal_snapshot_intent_required' USING ERRCODE='PT409';END IF;
 SELECT * INTO t FROM private.dpdi_terminal_intents WHERE job_id=j.id OR (tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key);
 IF FOUND THEN
  IF t.job_id<>j.id OR t.request_key<>_request_key OR t.snapshot_sha256<>_expected_snapshot_sha256 OR t.previous_head_event_id<>_expected_head_event_id
   OR t.claim_key IS DISTINCT FROM _claim_key OR t.reason_code<>_reason_code THEN RAISE EXCEPTION 'dpdi.immutable_terminal_request_conflict' USING ERRCODE='PT409';END IF;
  RETURN private.dpdi_dto(j)||jsonb_build_object('actor_id',actor,'head_event_id',t.event_id::text,'terminal_intent',private.dpdi_terminal_intent_dto(t),'request_replay',true,'released_rows','0','publish_allowed',false);
 END IF;
 e:=private.dpdi_head(j.id);
 IF e.id<>_expected_head_event_id OR e.phase NOT IN('queued','running') THEN RAISE EXCEPTION 'dpdi.terminal_head_changed_status_first' USING ERRCODE='PT409';END IF;
 IF e.phase='running' AND e.lease_expires_at>clock_timestamp() AND (e.claim_key IS DISTINCT FROM _claim_key OR _claim_key IS NULL)
 THEN RAISE EXCEPTION 'dpdi.live_owned_claim_required_for_cancellation' USING ERRCODE='42501';END IF;
 issues:=private.dpd_transform_issues(j.snapshot->'pipeline_configuration');
 IF _reason_code='invalid_configuration' AND jsonb_array_length(issues)=0 THEN RAISE EXCEPTION 'dpdi.native_invalid_configuration_evidence_required' USING ERRCODE='22023';END IF;
 phase:=CASE WHEN _reason_code='invalid_configuration' THEN 'blocked' ELSE 'cancelled' END;
 SELECT * INTO run FROM public.data_prep_delivery_runs WHERE id=j.reserved_run_id AND tenant_id=_tenant_id FOR UPDATE;
 IF run.id IS NOT NULL AND run.state<>'running' THEN RAISE EXCEPTION 'dpdi.terminal_run_state_changed' USING ERRCODE='PT409';END IF;
 INSERT INTO private.dpdi_job_events(job_id,actor_id,phase,claim_key,lease_expires_at,input_index,next_record,source_records,blocking_records,output_pages,output_root_sha256,last_page_sha256)
 VALUES(j.id,actor,phase,e.claim_key,clock_timestamp(),e.input_index,e.next_record,e.source_records,e.blocking_records,e.output_pages,e.output_root_sha256,e.last_page_sha256) RETURNING id INTO event_id;
 INSERT INTO private.dpdi_terminal_intents(tenant_id,setup_id,job_id,actor_id,request_key,snapshot_sha256,previous_head_event_id,event_id,claim_key,reason_code,phase,validation_issues)
 VALUES(_tenant_id,_setup_id,j.id,actor,_request_key,j.snapshot_sha256,e.id,event_id,_claim_key,_reason_code,phase,issues) RETURNING * INTO t;
 terminal_result:=jsonb_build_object('representation','dpdi_configuration_terminal_v1','job_id',j.id,'status',CASE WHEN phase='blocked' THEN 'failed' ELSE 'cancelled' END,
  'terminal_reason_code',_reason_code,'validation_issues',issues,'snapshot_sha256',j.snapshot_sha256,'terminal_event_id',event_id::text,
  'full_final_ack',true,'full_original_rescan',false,'source_records',e.source_records::text,'blocking_records',e.blocking_records::text,
  'configuration_blocking_failure',phase='blocked','blocking_failure',true,'accepted_records','0','preview_rows','0','released_rows','0','publication_eligible',false,'acceptedRows',NULL,'outputLineage',NULL);
 IF run.id IS NOT NULL THEN UPDATE public.data_prep_delivery_runs SET state='failed',result=terminal_result,result_sha256=private.dpw_hash(terminal_result),finished_at=clock_timestamp() WHERE id=run.id;END IF;
 IF j.snapshot->>'mode'='prepare' THEN UPDATE public.data_prep_delivery_batches SET state='failed' WHERE id=(j.snapshot->>'batch_id')::uuid AND tenant_id=_tenant_id AND state='processing';END IF;
 PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'job.terminal_intent.recorded',j.id,jsonb_build_object('intent_id',t.id,'request_key',t.request_key,'snapshot_sha256',j.snapshot_sha256,'previous_head_event_id',e.id::text,'event_id',event_id::text,'reason_code',_reason_code,'phase',phase,'validation_issues',issues,'publish_allowed',false));
 RETURN private.dpdi_dto(j)||jsonb_build_object('actor_id',actor,'head_event_id',event_id::text,'terminal_intent',private.dpdi_terminal_intent_dto(t),'request_replay',false,'released_rows','0','publish_allowed',false);
END $$;
REVOKE ALL ON FUNCTION public.dpdi_cancel_owned_job(uuid,uuid,uuid,text,bigint,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dpdi_cancel_owned_job(uuid,uuid,uuid,text,bigint,uuid,text,uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.dpd_save_setup(_tenant_id uuid, _setup_id uuid, _expected_draft_version integer, _payload jsonb, _request_key uuid, _request_context_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s private.dpd_setups%ROWTYPE:=private.dpd_scope(_tenant_id,_setup_id,true);v private.dpd_versions%ROWTYPE;head private.dpd_versions%ROWTYPE;f jsonb;file private.dpd_original_intents%ROWTYPE;schema private.dpd_schema_receipts%ROWTYPE;owners uuid[];groups uuid[];scope jsonb;
BEGIN
 PERFORM private.dpd_request_actor(_tenant_id,_setup_id,'setup.save',_request_context_id);
 PERFORM private.dpd_assert_transform_configuration(_payload);
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
END $function$;
CREATE OR REPLACE FUNCTION public.dpdi_enqueue_preview(_tenant_id uuid, _setup_id uuid, _draft_version integer, _request_key uuid, _request_context_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'preview.job.enqueue',_request_context_id);s private.dpd_setups%ROWTYPE:=private.dpd_scope(_tenant_id,_setup_id,true);l private.dpd_preview_links%ROWTYPE;v private.dpd_versions%ROWTYPE;c public.data_prep_configuration_revisions%ROWTYPE;b public.data_prep_delivery_batches%ROWTYPE;j private.dpdi_jobs%ROWTYPE;snap jsonb;inputs jsonb;
BEGIN
 PERFORM 1 FROM private.dpd_setups WHERE id=s.id FOR UPDATE;SELECT * INTO l FROM private.dpd_preview_links WHERE setup_id=s.id AND draft_version=_draft_version;SELECT * INTO v FROM private.dpd_versions WHERE setup_id=s.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO c FROM public.data_prep_configuration_revisions WHERE id=l.configuration_id;SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=l.batch_id;
 IF l.setup_id IS NULL OR v.version<>_draft_version OR _request_key IS NULL OR b.mode IS DISTINCT FROM 'preview' THEN RAISE EXCEPTION 'dpdi.actual_current_authoring_preview_required' USING ERRCODE='PT409';END IF;
 PERFORM private.dpd_validate_confirmed_mapping(_tenant_id,s.id,v.version,v.payload->'confirmed_mapping');PERFORM private.dpw_authorize(_tenant_id,l.pipeline_id,'run');
 SELECT jsonb_agg(jsonb_build_object('input_id',i.id,'original_file_id',i.original_file_id,'data_source_id',i.data_source_id,'feed_key',i.feed_key,'selection',i.selection,'selection_sha256',i.selection_sha256,'rows_count',i.rows_count::text,'dpw_file_id',NULL,'upload_id',NULL) ORDER BY i.feed_key,i.id) INTO inputs FROM private.dpd_preview_file_links i WHERE i.setup_id=s.id AND i.draft_version=v.version;
 IF inputs IS NULL OR (SELECT sum((x.value->>'rows_count')::bigint) FROM jsonb_array_elements(inputs) AS x(value))>1000000 THEN RAISE EXCEPTION 'dpdi.complete_selected_input_budget_required';END IF;
 snap:=jsonb_build_object('tenant_id',_tenant_id,'setup_id',s.id,'draft_version',v.version,'pipeline_id',l.pipeline_id,'pipeline_version',l.pipeline_version,'configuration_id',l.configuration_id,'configuration_sha256',c.payload_sha256,'batch_id',l.batch_id,'business_date',b.business_date,'mode','preview','configuration_status',(SELECT p.status FROM public.data_prep_pipelines p WHERE p.id=l.pipeline_id),'input_binding_kind','authoring_original_pinned','inputs',inputs,'input_manifest_sha256',l.input_manifest_sha256,'confirmed_mapping',v.payload->'confirmed_mapping','confirmed_mapping_sha256',private.dpw_hash(v.payload->'confirmed_mapping'),'pipeline_configuration',c.payload,'feeds',c.payload->'feeds','publish_allowed',false);
 SELECT * INTO j FROM private.dpdi_jobs WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF j.setup_id<>s.id OR j.draft_version<>v.version OR j.snapshot IS DISTINCT FROM snap THEN RAISE EXCEPTION 'dpdi.preview_request_conflict' USING ERRCODE='PT409';END IF;RETURN private.dpdi_dto(j)||jsonb_build_object('request_replay',true);END IF;
 PERFORM private.dpd_assert_transform_configuration(snap->'pipeline_configuration');
 INSERT INTO private.dpdi_jobs(tenant_id,setup_id,draft_version,actor_id,request_key,snapshot,snapshot_sha256) VALUES(_tenant_id,s.id,v.version,actor,_request_key,snap,private.dpw_hash(snap)) RETURNING * INTO j;
 PERFORM private.dpdi_authorize(_tenant_id,s.id,j.id,actor,true);INSERT INTO private.dpdi_job_events(job_id,actor_id,phase) VALUES(j.id,actor,'queued');PERFORM private.dpd_event(_tenant_id,s.id,actor,'preview.job.queued',j.id,jsonb_build_object('snapshot_sha256',j.snapshot_sha256,'mode','preview','publish_allowed',false));RETURN private.dpdi_dto(j)||jsonb_build_object('request_replay',false);
END $function$;
CREATE OR REPLACE FUNCTION public.dpdi_enqueue_approved_prepare(_tenant_id uuid, _setup_id uuid, _setup_review_decision_id uuid, _business_date date, _request_key uuid, _request_context_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'prepare.job.enqueue',_request_context_id);r private.dpdi_setup_review_requests%ROWTYPE;d private.dpdi_setup_review_decisions%ROWTYPE;preview private.dpdi_jobs%ROWTYPE;j private.dpdi_jobs%ROWTYPE;batch public.data_prep_delivery_batches%ROWTYPE;snap jsonb;pipe uuid;
BEGIN
 PERFORM 1 FROM private.dpd_setups WHERE id=_setup_id AND tenant_id=_tenant_id AND created_by=actor FOR UPDATE;
 IF NOT FOUND OR _business_date IS NULL OR _request_key IS NULL THEN RAISE EXCEPTION 'dpdi.current_prepare_creator_and_explicit_business_date_required' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM private.dpdi_setup_review_decisions WHERE id=_setup_review_decision_id AND decision='approved';SELECT * INTO r FROM private.dpdi_setup_review_requests WHERE id=d.request_id AND tenant_id=_tenant_id AND setup_id=_setup_id;
 SELECT * INTO preview FROM private.dpdi_jobs WHERE id=r.job_id;
 IF r.id IS NULL OR d.decided_by=r.requested_by OR preview.snapshot_sha256<>d.snapshot_sha256 OR (SELECT max(version) FROM private.dpd_versions WHERE setup_id=_setup_id)<>r.draft_version THEN RAISE EXCEPTION 'dpdi.exact_current_human_approved_configuration_required' USING ERRCODE='42501';END IF;
 PERFORM private.dpdi_authorize(_tenant_id,_setup_id,preview.id,actor,true);pipe:=(preview.snapshot->>'pipeline_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.data_prep_pipelines p WHERE p.id=pipe AND p.tenant_id=_tenant_id AND p.status='approved' AND p.lifecycle_state='production' AND p.version=(preview.snapshot->>'pipeline_version')::integer) OR NOT EXISTS(SELECT 1 FROM public.data_prep_approved_configurations ac WHERE ac.tenant_id=_tenant_id AND ac.pipeline_id=pipe AND ac.pipeline_version=(preview.snapshot->>'pipeline_version')::integer AND ac.configuration_id=(preview.snapshot->>'configuration_id')::uuid AND ac.approved_by<>actor) THEN RAISE EXCEPTION 'dpdi.actual_governed_approved_production_transition_required_no_private_approval_waiver' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM private.dpdi_jobs WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF j.setup_id<>_setup_id OR j.snapshot->>'mode'<>'prepare' OR j.snapshot->>'setup_review_decision_id'<>d.id::text OR j.snapshot->>'business_date'<>_business_date::text THEN RAISE EXCEPTION 'dpdi.prepare_request_conflict' USING ERRCODE='PT409';END IF;RETURN private.dpdi_dto(j)||jsonb_build_object('request_replay',true);END IF;
 PERFORM private.dpd_assert_transform_configuration(preview.snapshot->'pipeline_configuration');
 INSERT INTO public.data_prep_delivery_batches(tenant_id,pipeline_id,pipeline_version,business_date,mode,execution_mode,human_in_loop,request_key,created_by,configuration_snapshot)
 VALUES(_tenant_id,pipe,(preview.snapshot->>'pipeline_version')::integer,_business_date,'prepare',(SELECT execution_mode FROM public.data_prep_delivery_batches WHERE id=(preview.snapshot->>'batch_id')::uuid),(SELECT human_in_loop FROM public.data_prep_delivery_batches WHERE id=(preview.snapshot->>'batch_id')::uuid),_request_key,actor,preview.snapshot||jsonb_build_object('approval_origin','dpdi_setup_review_v1','setup_review_decision_id',d.id)) RETURNING * INTO batch;
 snap:=preview.snapshot||jsonb_build_object('mode','prepare','business_date',_business_date,'batch_id',batch.id,'approval_origin','dpdi_setup_review_v1','setup_review_decision_id',d.id,'configuration_status','dpdi_review_approved','pipeline_status_actual',(SELECT status FROM public.data_prep_pipelines WHERE id=pipe),'publication_eligible',false);
 INSERT INTO private.dpdi_jobs(tenant_id,setup_id,draft_version,actor_id,request_key,snapshot,snapshot_sha256) VALUES(_tenant_id,_setup_id,r.draft_version,actor,_request_key,snap,private.dpw_hash(snap)) RETURNING * INTO j;
 INSERT INTO private.dpdi_job_events(job_id,actor_id,phase) VALUES(j.id,actor,'queued');PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'approved.prepare.queued',j.id,jsonb_build_object('approval_origin','dpdi_setup_review_v1','decision_id',d.id,'business_date',_business_date,'publish_allowed',false));RETURN private.dpdi_dto(j)||jsonb_build_object('request_replay',false);
END $function$;
CREATE OR REPLACE FUNCTION public.dpd_issue_request_context(_tenant_id uuid, _verified_subject jsonb, _trusted_ip text, _ttl_seconds integer, _operation text, _setup_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid;enabled boolean;ip inet;expires timestamptz;c private.dpd_request_contexts%ROWTYPE;write boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role' OR _ttl_seconds IS NULL OR _ttl_seconds NOT BETWEEN 1 AND 60
 OR (_operation IN('setup.create','setup.read','setup.lookup','setup.save','original.authorize','original.claim','original.lookup','original.read','original.rows','source.register','preview.bind','preview.lookup','audit.read','original.confirm','original.chunk','original.schema','parser.enqueue','parser.lookup','parser.claim','parser.progress','preview.input','mapping.read','review.shared.read','review.shared.decide','preview.job.enqueue','preview.job.claim','preview.job.input','preview.job.unique','preview.job.commit','preview.job.release','preview.job.cancel','preview.job.status','preview.job.result','preview.job.next','catalogue.read','review.setup.request','review.setup.read','review.setup.decide','prepare.job.enqueue','publication.request','publication.read','publication.decide','publication.perform','publication.dataset.read','review.queue.read')) IS DISTINCT FROM true
 OR (_setup_id IS NULL AND _operation NOT IN('setup.create','setup.lookup','review.queue.read')) THEN RAISE EXCEPTION 'dpd.fixed_closed_request_context_required' USING ERRCODE='42501';END IF;
 actor:=private.dpd_peer_actor(_tenant_id,_verified_subject);IF _operation='review.queue.read' AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant_id AND tm.user_id=actor AND tm.active AND tm.role='tenant_admin') THEN RAISE EXCEPTION 'dpdi.actual_tenant_admin_queue_required' USING ERRCODE='42501';END IF;IF _operation IN('review.shared.read','review.shared.decide','review.queue.read') THEN PERFORM public.assert_data_prep_actor(_tenant_id,actor,true);END IF;write:=_operation IN('setup.create','setup.save','original.authorize','original.claim','source.register','preview.bind','original.confirm','original.chunk','original.schema','parser.enqueue','parser.claim','parser.progress','review.shared.decide','preview.job.enqueue','preview.job.claim','preview.job.unique','preview.job.commit','preview.job.release','preview.job.cancel','review.setup.request','review.setup.decide','prepare.job.enqueue','publication.request','publication.decide','publication.perform');IF write THEN PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);END IF;
 IF public.user_has_permission(actor,_tenant_id,CASE WHEN write THEN 'data.prep.author' ELSE 'data.prep.read' END,NULL) IS DISTINCT FROM true
 OR (_setup_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.dpd_setups WHERE id=_setup_id AND tenant_id=_tenant_id AND (created_by=actor OR (_operation IN('preview.job.status','preview.job.result') AND EXISTS(SELECT 1 FROM private.dpd_preview_links read_link WHERE read_link.setup_id=_setup_id AND read_link.tenant_id=_tenant_id AND private.data_prep_pipeline_scope_allows(actor,_tenant_id,read_link.pipeline_id,'view') IS TRUE)) OR _operation IN('review.shared.read','review.shared.decide') OR (_operation IN('review.setup.read','review.setup.decide','publication.read','publication.decide') AND private.dpdi_review_reader(_tenant_id,_setup_id,actor)) OR (_operation='publication.dataset.read' AND EXISTS(SELECT 1 FROM private.dpdi_published_datasets ds WHERE ds.setup_id=_setup_id AND ds.tenant_id=_tenant_id AND private.data_prep_pipeline_scope_allows(actor,_tenant_id,ds.pipeline_id,'view') IS TRUE))))) THEN RAISE EXCEPTION 'dpd.context_current_scope_denied' USING ERRCODE='42501';END IF;
 SELECT ip_allowlist_enabled INTO enabled FROM public.tenant_security_settings WHERE tenant_id=_tenant_id;IF NOT FOUND OR enabled IS NULL THEN RAISE EXCEPTION 'dpd.current_network_policy_unavailable' USING ERRCODE='42501';END IF;
 BEGIN ip:=nullif(_trusted_ip,'')::inet;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'dpd.trusted_transport_ip_invalid' USING ERRCODE='42501';END;
 IF enabled AND (ip IS NULL OR public.ip_in_tenant_allowlist(_tenant_id,host(ip)) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'dpd.current_network_denied' USING ERRCODE='42501';END IF;
 expires:=least(clock_timestamp()+_ttl_seconds*interval '1 second',to_timestamp((_verified_subject->>'exp')::double precision));IF expires<=clock_timestamp() THEN RAISE EXCEPTION 'dpd.subject_expired' USING ERRCODE='42501';END IF;
 c.id:=gen_random_uuid();
 INSERT INTO private.dpd_request_contexts(id,token_sha256,tenant_id,actor_id,verified_subject,operation,setup_id,intent_sha256,transport_kind,request_ip,transport_attestation_sha256,expires_at)
 VALUES(c.id,encode(sha256(convert_to(c.id::text,'UTF8')),'hex'),_tenant_id,actor,_verified_subject,_operation,_setup_id,private.dpw_hash(jsonb_build_object('operation',_operation,'setup_id',_setup_id)),
 'main_fixed_service_verified_middleware_CF_transport',ip,private.dpw_hash(jsonb_build_object('actor',actor,'tenant',_tenant_id,'operation',_operation,'setup',_setup_id,'issuer_role','service_role')),expires) RETURNING * INTO c;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','dpd.request_context.issued','data_prep_authoring_context',c.id::text,jsonb_build_object('operation',_operation,'setup_id',_setup_id,'expires_at',expires,'network_policy_enabled',enabled,'issuer_transport','service_role','browser_issuance_allowed',false));
 RETURN jsonb_build_object('request_context_id',c.id,'actor_id',actor,'tenant_id',_tenant_id,'operation',_operation,'setup_id',_setup_id,'expires_at',expires,'network_policy_available',true,'network_policy_enabled',enabled,'network_allowed',true,'issuer_transport','service_role','verified_subject_expires_at',to_timestamp((_verified_subject->>'exp')::double precision),'browser_issuance_allowed',false);
END $function$;
CREATE OR REPLACE FUNCTION public.dpdi_get_preview_job(_tenant_id uuid, _setup_id uuid, _job_id uuid, _request_context_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'preview.job.status',_request_context_id);j private.dpdi_jobs%ROWTYPE:=private.dpdi_authorize(_tenant_id,_setup_id,_job_id,actor,false);BEGIN RETURN private.dpdi_dto(j)||jsonb_build_object('actor_id',actor,'execution_actor_id',j.actor_id,'head_event_id',(private.dpdi_head(j.id)).id::text,'terminal_intent',(SELECT private.dpdi_terminal_intent_dto(t) FROM private.dpdi_terminal_intents t WHERE t.job_id=j.id));END $function$;

DO $dpd_full_after$ DECLARE old jsonb;actual jsonb;n bigint;digest text;BEGIN
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.rows')::jsonb) LOOP
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q',old->>'schema',old->>'name') INTO n,digest;
 IF n::text IS DISTINCT FROM old->>'rows' OR digest IS DISTINCT FROM old->>'hash' THEN RAISE EXCEPTION 'dpd_full.old_rows_changed:%',old->>'name'; END IF;END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.routines')::jsonb) LOOP
 SELECT to_jsonb(q) INTO actual FROM pg_proc q WHERE q.oid=(old->>'oid')::oid;
 IF old->>'oid'=ANY(ARRAY['60592','60798','60903','60578','60799']::text[]) THEN
  IF actual-'prosrc' IS DISTINCT FROM old-'prosrc' THEN RAISE EXCEPTION 'dpd_full.consumer_catalog_changed';END IF;
 ELSE IF actual IS DISTINCT FROM old THEN RAISE EXCEPTION 'dpd_full.old_routine_changed:%',old->>'oid';END IF;END IF;END LOOP;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60592'::oid) IS DISTINCT FROM 'f903b1d8247c47ba7ecb6d83f1a9a4215f1f4d2f13824dd7f81662fb9271ddcb' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpd_save_setup';END IF;
IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60798'::oid) IS DISTINCT FROM '76725ad10f946943e94e4159df9055f65ea2e3bce106995cf59203a24d55d32b' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpdi_enqueue_preview';END IF;
IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60903'::oid) IS DISTINCT FROM '0dd36185067fa1757ecd587e00c8517319142f285e3561444761f169388d3855' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpdi_enqueue_approved_prepare';END IF;
IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60578'::oid) IS DISTINCT FROM 'd6f7fc2489a00559cffabea2702f0fd41dbc8a109fb338c051eda2675e08062b' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpd_issue_request_context';END IF;
IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60799'::oid) IS DISTINCT FROM '38272bfaea5ae64e5fd93a040fa5449e205df682dcc58ce5dfd5b28e0e9a2aab' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpdi_get_preview_job';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_recovery.roles')::jsonb THEN RAISE EXCEPTION 'dpd_full.roles_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_recovery.members')::jsonb THEN RAISE EXCEPTION 'dpd_full.members_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';IF actual IS DISTINCT FROM current_setting('fvi.dpd_recovery.namespaces')::jsonb THEN RAISE EXCEPTION 'dpd_full.namespaces_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_recovery.defaultacl')::jsonb THEN RAISE EXCEPTION 'dpd_full.defaultacl_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_recovery.ledger')::jsonb THEN RAISE EXCEPTION 'dpd_full.ledger_changed';END IF;
 IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_class')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_class q) THEN RAISE EXCEPTION 'dpd_full.old_pg_class_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_type')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_type q) THEN RAISE EXCEPTION 'dpd_full.old_pg_type_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_attribute')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_attribute q) THEN RAISE EXCEPTION 'dpd_full.old_pg_attribute_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_constraint')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_constraint q) THEN RAISE EXCEPTION 'dpd_full.old_pg_constraint_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_index')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_index q) THEN RAISE EXCEPTION 'dpd_full.old_pg_index_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_policy')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_policy q) THEN RAISE EXCEPTION 'dpd_full.old_pg_policy_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_recovery.pg_trigger')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_trigger q) THEN RAISE EXCEPTION 'dpd_full.old_pg_trigger_changed';END IF;
 END $dpd_full_after$;
