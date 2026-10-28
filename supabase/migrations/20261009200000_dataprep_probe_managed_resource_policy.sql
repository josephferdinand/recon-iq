DO $dpd_full_before$ DECLARE actual jsonb;rel record;rows_before jsonb:='[]';n bigint;digest text;filter text;BEGIN
 IF current_user<>'postgres' OR current_setting('role',true)<>'none' OR current_setting('server_version_num')<>'170006' OR current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'dpd_full.native_context_drift';END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>471 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261009150000' THEN RAISE EXCEPTION 'dpd_full.current_ledger_drift';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef('61747'::oid),'UTF8')),'hex')) IS DISTINCT FROM '7253d67e8a5f07507dc6cb852d8eb858c6b6654eca93cb9f84dc361cf86a557c' THEN RAISE EXCEPTION 'dpd_full.managed_probe_preimage_changed';END IF;
 FOR rel IN SELECT c.oid,ns.nspname,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE c.relkind IN('r','p','m') AND ns.nspname NOT IN('pg_catalog','information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp%' ORDER BY c.oid LOOP
 filter:=CASE WHEN rel.nspname='storage' AND rel.relname='buckets' THEN ' WHERE id<>''data-prep-authoring-originals''' ELSE '' END;
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q' ,rel.nspname,rel.relname) INTO n,digest;
 rows_before:=rows_before||jsonb_build_array(jsonb_build_object('oid',rel.oid::text,'schema',rel.nspname,'name',rel.relname,'rows',n::text,'hash',digest));
 END LOOP;
 PERFORM set_config('fvi.dpd_managed_probe.rows',rows_before::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_proc q;PERFORM set_config('fvi.dpd_managed_probe.routines',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;PERFORM set_config('fvi.dpd_managed_probe.roles',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;PERFORM set_config('fvi.dpd_managed_probe.members',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';PERFORM set_config('fvi.dpd_managed_probe.namespaces',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;PERFORM set_config('fvi.dpd_managed_probe.defaultacl',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;PERFORM set_config('fvi.dpd_managed_probe.ledger',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_class q;PERFORM set_config('fvi.dpd_managed_probe.pg_class',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_type q;PERFORM set_config('fvi.dpd_managed_probe.pg_type',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_attribute q;PERFORM set_config('fvi.dpd_managed_probe.pg_attribute',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_constraint q;PERFORM set_config('fvi.dpd_managed_probe.pg_constraint',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_index q;PERFORM set_config('fvi.dpd_managed_probe.pg_index',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_policy q;PERFORM set_config('fvi.dpd_managed_probe.pg_policy',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_trigger q;PERFORM set_config('fvi.dpd_managed_probe.pg_trigger',actual::text,true);
 END $dpd_full_before$;
CREATE OR REPLACE FUNCTION public.dpdi_probe_output_capacity(_tenant_id uuid, _setup_id uuid, _private_dataset_id uuid, _request_key uuid, _request_context_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'publication.perform',_request_context_id);d private.dpdi_published_datasets%ROWTYPE;j private.dpdi_jobs%ROWTYPE;p private.dpdi_capacity_probes%ROWTYPE;started timestamptz;finished timestamptz;result jsonb;receipt jsonb;memory_bytes bigint;wire_bytes bigint;fingerprint text;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,true);
 IF _request_key IS NULL THEN RAISE EXCEPTION 'dpdi.capacity_request_key_required' USING ERRCODE='22023';END IF;
 SELECT * INTO d FROM private.dpdi_published_datasets WHERE id=_private_dataset_id AND tenant_id=_tenant_id AND setup_id=_setup_id FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'dpdi.capacity_actual_manifest_required' USING ERRCODE='42501';END IF;j:=private.dpdi_authorize(_tenant_id,_setup_id,d.job_id,actor,true);fingerprint:=private.dpdi_capacity_source_fingerprint();
 SELECT * INTO p FROM private.dpdi_capacity_probes WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF p.dataset_id<>d.id THEN RAISE EXCEPTION 'dpdi.capacity_request_conflict' USING ERRCODE='PT409';END IF;RETURN to_jsonb(p)||jsonb_build_object('state','probe_recorded','request_replay',true,'qualification_created',false,'memory_metric','allocated_context_snapshot_not_peak_rss','full_registration_writes_rolled_back',true);END IF;
 IF EXISTS(SELECT 1 FROM private.dpdi_public_output_links WHERE private_dataset_id=d.id) THEN RAISE EXCEPTION 'dpdi.capacity_probe_requires_not_yet_registered_output_no_cached_measurement' USING ERRCODE='PT409';END IF;
 SELECT coalesce(sum(octet_length(wire)),0) INTO wire_bytes FROM private.dpdi_job_pages WHERE job_id=j.id;
 IF d.rows NOT BETWEEN 1 AND 1000000 OR wire_bytes NOT BETWEEN 1 AND 268435456 THEN RAISE EXCEPTION 'dpdi.capacity_probe_bounded_actual_population_required' USING ERRCODE='54000';END IF;
 IF d.rows=2 AND wire_bytes<=2097152 THEN PERFORM set_config('work_mem','4MB',true); -- Managed PostgreSQL retains its existing temporary-file policy; no SET/grant/superuser change.
END IF;
 started:=clock_timestamp();
 BEGIN
  INSERT INTO private.dpdi_capacity_probe_permits VALUES(pg_backend_pid(),txid_current(),_tenant_id,_setup_id,d.id,actor,_request_context_id,fingerprint,NULL);
  -- Exact current production registration, including integrity/RLP/governance,
  -- output inserts, batch state and audit. Every row write below rolls back.
  result:=public.dpdi_register_public_output(_tenant_id,_setup_id,d.id,_request_context_id);
  IF (result->>'request_replay')::boolean IS DISTINCT FROM false OR (result->'dataset'->>'rows')::bigint IS DISTINCT FROM d.rows THEN RAISE EXCEPTION 'dpdi.capacity_actual_full_registration_required';END IF;
  SELECT memory_snapshot_bytes INTO memory_bytes FROM private.dpdi_capacity_probe_permits WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  IF memory_bytes IS NULL THEN RAISE EXCEPTION 'dpdi.capacity_native_memory_snapshot_missing';END IF;
  RAISE EXCEPTION 'dpdi.capacity_probe_intentional_subtransaction_rollback' USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 finished:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM private.dpdi_public_output_links WHERE private_dataset_id=d.id) OR EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets WHERE id=(result->'dataset'->>'id')::uuid) OR EXISTS(SELECT 1 FROM public.workspace_data_source_uploads WHERE id=(result->>'output_upload_id')::uuid) OR EXISTS(SELECT 1 FROM private.dpdi_capacity_probe_permits WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()) THEN RAISE EXCEPTION 'dpdi.capacity_probe_rollback_not_complete';END IF;
 receipt:=jsonb_build_object('tenant_id',_tenant_id,'setup_id',_setup_id,'dataset_id',d.id,'job_id',j.id,'configuration_id',d.configuration_id,'actor_id',actor,'backend_pid',pg_backend_pid(),'source_fingerprint',fingerprint,'configuration_sha256',j.snapshot->>'configuration_sha256','output_root_sha256',(private.dpdi_head(j.id)).output_root_sha256,'rows_count',d.rows::text,'wire_bytes',wire_bytes::text,'output_sha256',result->'dataset'->>'content_sha256','elapsed_ms',(extract(epoch FROM finished-started)*1000)::text,'allocated_context_snapshot_bytes',memory_bytes::text,'started_at',started,'finished_at',finished,'coverage','exact_native_registration_with_rolled_back_output_audit_and_batch_writes','memory_metric','allocated_context_snapshot_not_peak_rss');
 INSERT INTO private.dpdi_capacity_probes(tenant_id,setup_id,dataset_id,job_id,configuration_id,actor_id,request_key,backend_pid,source_fingerprint,configuration_sha256,output_root_sha256,rows_count,wire_bytes,output_sha256,elapsed_ms,allocated_context_snapshot_bytes,started_at,finished_at,receipt_sha256) VALUES(_tenant_id,_setup_id,d.id,j.id,d.configuration_id,actor,_request_key,pg_backend_pid(),fingerprint,j.snapshot->>'configuration_sha256',(private.dpdi_head(j.id)).output_root_sha256,d.rows,wire_bytes,result->'dataset'->>'content_sha256',extract(epoch FROM finished-started)*1000,memory_bytes,started,finished,private.dpw_hash(receipt)) RETURNING * INTO p;
 PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'capacity.probe.recorded',p.id,jsonb_build_object('receipt_sha256',p.receipt_sha256,'rows',p.rows_count::text,'qualification_created',false,'rolled_back_output_writes',true,'audit_sequence_values_may_advance',true,'observed_work_mem',current_setting('work_mem'),'observed_temp_file_limit',current_setting('temp_file_limit'),'temp_file_policy_changed',false));
 RETURN to_jsonb(p)||jsonb_build_object('state','probe_recorded','request_replay',false,'qualification_created',false,'memory_metric','allocated_context_snapshot_not_peak_rss','full_registration_writes_rolled_back',true,'audit_sequence_values_may_advance',true);
END $function$
;

DO $dpd_full_after$ DECLARE old jsonb;actual jsonb;n bigint;digest text;BEGIN
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.rows')::jsonb) LOOP
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q',old->>'schema',old->>'name') INTO n,digest;
 IF n::text IS DISTINCT FROM old->>'rows' OR digest IS DISTINCT FROM old->>'hash' THEN RAISE EXCEPTION 'dpd_full.old_rows_changed:%',old->>'name'; END IF;END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.routines')::jsonb) LOOP
 SELECT to_jsonb(q) INTO actual FROM pg_proc q WHERE q.oid=(old->>'oid')::oid;
 IF old->>'oid'=ANY(ARRAY['61747']::text[]) THEN
  IF actual-'prosrc' IS DISTINCT FROM old-'prosrc' THEN RAISE EXCEPTION 'dpd_full.consumer_catalog_changed';END IF;
 ELSE IF actual IS DISTINCT FROM old THEN RAISE EXCEPTION 'dpd_full.old_routine_changed:%',old->>'oid';END IF;END IF;END LOOP;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='61747'::oid) IS DISTINCT FROM 'c5434eafba6e7707aeb3ebfba0ec91d9137ab6121026a187bbba6ebb59db041a' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpdi_probe_output_capacity';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_managed_probe.roles')::jsonb THEN RAISE EXCEPTION 'dpd_full.roles_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_managed_probe.members')::jsonb THEN RAISE EXCEPTION 'dpd_full.members_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';IF actual IS DISTINCT FROM current_setting('fvi.dpd_managed_probe.namespaces')::jsonb THEN RAISE EXCEPTION 'dpd_full.namespaces_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_managed_probe.defaultacl')::jsonb THEN RAISE EXCEPTION 'dpd_full.defaultacl_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_managed_probe.ledger')::jsonb THEN RAISE EXCEPTION 'dpd_full.ledger_changed';END IF;
 IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_class')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_class q) THEN RAISE EXCEPTION 'dpd_full.old_pg_class_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_type')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_type q) THEN RAISE EXCEPTION 'dpd_full.old_pg_type_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_attribute')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_attribute q) THEN RAISE EXCEPTION 'dpd_full.old_pg_attribute_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_constraint')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_constraint q) THEN RAISE EXCEPTION 'dpd_full.old_pg_constraint_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_index')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_index q) THEN RAISE EXCEPTION 'dpd_full.old_pg_index_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_policy')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_policy q) THEN RAISE EXCEPTION 'dpd_full.old_pg_policy_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_managed_probe.pg_trigger')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_trigger q) THEN RAISE EXCEPTION 'dpd_full.old_pg_trigger_changed';END IF;
 END $dpd_full_after$;
