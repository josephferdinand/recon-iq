DO $dpd_full_before$ DECLARE actual jsonb;rel record;rows_before jsonb:='[]';n bigint;digest text;filter text;BEGIN
 IF current_user<>'postgres' OR current_setting('role',true)<>'none' OR current_setting('server_version_num')<>'170006' OR current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'dpd_full.native_context_drift';END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>470 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261009120000' THEN RAISE EXCEPTION 'dpd_full.current_ledger_drift';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60595'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'b218afa978edd8a6d0f4378aeec71940e39d3ac1917c6b1e672fac3f3d59f19f' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpd_original_viewable';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60580'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'fa30be89c60391a5053d0b524dfd81824f6c24d9cdf7e36bb6676b671fd872a4' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpd_request_actor';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60795'::oid),'UTF8')),'hex')) IS DISTINCT FROM '2bef6da108728d36c05ccbb6edc94dfea8bf80124de41c051ce30b008e08130e' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpdi_authorize';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60985'::oid),'UTF8')),'hex')) IS DISTINCT FROM '8955b7f64f5cab6ce2ac11d8c7192e87b334f3e698505bbe99b9e5b87257a797' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpdi_public_dataset_current';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('55778'::oid),'UTF8')),'hex')) IS DISTINCT FROM '23f59a3d5963bcd54b304d96c64912c193eb659a8d7671a498766bfcb0f332a4' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpw_hash';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('55789'::oid),'UTF8')),'hex')) IS DISTINCT FROM '2b82dd0c9b4342c66148f973084ee9829f4e7300148dd50a595b52236f4ba1cf' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpw_pipeline_lifecycle';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('55788'::oid),'UTF8')),'hex')) IS DISTINCT FROM '205d26f2bcb03def9f997ee5c9d1234454afb512a2b17f923726ce16f6c8e994' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:private.dpw_snapshot';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('34027'::oid),'UTF8')),'hex')) IS DISTINCT FROM '7d8eb9e9a6f23aaa68ede6185965dc23bf9119b5a3add786cf6d586de7e894a1' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:public.approve_data_prep_pipeline';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('34022'::oid),'UTF8')),'hex')) IS DISTINCT FROM '554ef8468df88c6ce395a89d57763d8d821bb5cb761f4d33a031e8a243ac3621' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:public.approve_data_prep_pipeline_as';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60900'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'af9f6373abf699dc2a5e79364882a84afbd91403a4447c7ad4e5d56ca56f56c6' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:public.dpdi_decide_setup_review';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('60986'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'ab2df92e9b3b076f7d537a827f449fb766889aaa73623912530b52dc06d52c88' THEN RAISE EXCEPTION 'dpd_full.exact_capacity_dependency_changed:public.dpdi_register_public_output';END IF;
 FOR rel IN SELECT c.oid,ns.nspname,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE c.relkind IN('r','p','m') AND ns.nspname NOT IN('pg_catalog','information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp%' ORDER BY c.oid LOOP
 filter:=CASE WHEN rel.nspname='storage' AND rel.relname='buckets' THEN ' WHERE id<>''data-prep-authoring-originals''' ELSE '' END;
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q' ,rel.nspname,rel.relname) INTO n,digest;
 rows_before:=rows_before||jsonb_build_array(jsonb_build_object('oid',rel.oid::text,'schema',rel.nspname,'name',rel.relname,'rows',n::text,'hash',digest));
 END LOOP;
 PERFORM set_config('fvi.dpd_capacity.rows',rows_before::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_proc q;PERFORM set_config('fvi.dpd_capacity.routines',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;PERFORM set_config('fvi.dpd_capacity.roles',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;PERFORM set_config('fvi.dpd_capacity.members',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';PERFORM set_config('fvi.dpd_capacity.namespaces',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;PERFORM set_config('fvi.dpd_capacity.defaultacl',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;PERFORM set_config('fvi.dpd_capacity.ledger',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_class q;PERFORM set_config('fvi.dpd_capacity.pg_class',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_type q;PERFORM set_config('fvi.dpd_capacity.pg_type',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_attribute q;PERFORM set_config('fvi.dpd_capacity.pg_attribute',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_constraint q;PERFORM set_config('fvi.dpd_capacity.pg_constraint',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_index q;PERFORM set_config('fvi.dpd_capacity.pg_index',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_policy q;PERFORM set_config('fvi.dpd_capacity.pg_policy',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_trigger q;PERFORM set_config('fvi.dpd_capacity.pg_trigger',actual::text,true);
 END $dpd_full_before$;
-- New-only qualification lane. No existing actor/role/factor/helper is edited.
CREATE TABLE private.dpdi_capacity_probe_permits(backend_pid integer NOT NULL,transaction_id bigint NOT NULL,tenant_id uuid NOT NULL,setup_id uuid NOT NULL,dataset_id uuid NOT NULL,actor_id uuid NOT NULL,context_id uuid NOT NULL,source_fingerprint text NOT NULL,memory_snapshot_bytes bigint,PRIMARY KEY(backend_pid,transaction_id));
CREATE TABLE private.dpdi_capacity_probes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,setup_id uuid NOT NULL,dataset_id uuid NOT NULL,job_id uuid NOT NULL,configuration_id uuid NOT NULL,actor_id uuid NOT NULL,request_key uuid NOT NULL,backend_pid integer NOT NULL,source_fingerprint text NOT NULL,configuration_sha256 text NOT NULL,output_root_sha256 text NOT NULL,rows_count bigint NOT NULL,wire_bytes bigint NOT NULL,output_sha256 text NOT NULL,elapsed_ms numeric NOT NULL,allocated_context_snapshot_bytes bigint NOT NULL,started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL,receipt_sha256 text NOT NULL,UNIQUE(tenant_id,actor_id,request_key));
CREATE TABLE private.dpdi_capacity_certificates(qualification_id uuid PRIMARY KEY REFERENCES private.dpdi_output_registration_qualifications(id),probe_id uuid NOT NULL REFERENCES private.dpdi_capacity_probes(id),tenant_id uuid NOT NULL,actor_id uuid NOT NULL,request_key uuid NOT NULL,source_fingerprint text NOT NULL,configuration_sha256 text NOT NULL,evidence jsonb NOT NULL,evidence_sha256 text NOT NULL,request_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(tenant_id,actor_id,request_key));
ALTER TABLE private.dpdi_capacity_probe_permits ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.dpdi_capacity_probe_permits FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.dpdi_capacity_probes ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.dpdi_capacity_probes FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.dpdi_capacity_certificates ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.dpdi_capacity_certificates FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER dpdi_capacity_probes_immutable BEFORE UPDATE OR DELETE ON private.dpdi_capacity_probes FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
CREATE TRIGGER dpdi_capacity_certificates_immutable BEFORE UPDATE OR DELETE ON private.dpdi_capacity_certificates FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
CREATE FUNCTION private.dpdi_capacity_source_fingerprint() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.dpw_hash(jsonb_agg(jsonb_build_object('signature',names.signature,'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(names.signature::regprocedure),'UTF8')),'hex')) ORDER BY names.signature))
 FROM unnest(ARRAY['public.dpdi_register_public_output(uuid,uuid,uuid,uuid)','private.dpdi_authorize(uuid,uuid,uuid,uuid,boolean)','private.dpdi_public_dataset_current(uuid,uuid,uuid)','private.dpd_original_viewable(uuid)','private.dpd_request_actor(uuid,uuid,text,uuid)','private.dpw_hash(jsonb)','private.dpdi_certify_exact_two_row_output(uuid,uuid,uuid,uuid,uuid,text)','private.dpdi_capacity_source_fingerprint()','private.dpdi_capacity_probe_allowed(uuid,uuid,uuid,uuid,uuid)','private.dpdi_capacity_capture_memory(uuid,uuid,uuid,uuid,uuid)','public.dpdi_probe_output_capacity(uuid,uuid,uuid,uuid,uuid)','public.dpdi_decide_setup_review(uuid,uuid,uuid,text,text,uuid)','public.approve_data_prep_pipeline(uuid,uuid)','public.approve_data_prep_pipeline_as(uuid,uuid,uuid)','private.dpw_pipeline_lifecycle()','private.dpw_snapshot(uuid)']) AS names(signature)
$$;
CREATE FUNCTION private.dpdi_capacity_probe_allowed(_tenant uuid,_setup uuid,_dataset uuid,_actor uuid,_context uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM private.dpdi_capacity_probe_permits p WHERE p.backend_pid=pg_backend_pid() AND p.transaction_id=txid_current() AND p.tenant_id=_tenant AND p.setup_id=_setup AND p.dataset_id=_dataset AND p.actor_id=_actor AND p.context_id=_context AND p.source_fingerprint=private.dpdi_capacity_source_fingerprint())
$$;
CREATE FUNCTION private.dpdi_capacity_capture_memory(_tenant uuid,_setup uuid,_dataset uuid,_actor uuid,_context uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF private.dpdi_capacity_probe_allowed(_tenant,_setup,_dataset,_actor,_context) THEN
  UPDATE private.dpdi_capacity_probe_permits SET memory_snapshot_bytes=(SELECT sum(total_bytes) FROM pg_backend_memory_contexts) WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 END IF;
END $$;
CREATE FUNCTION public.dpdi_probe_output_capacity(_tenant_id uuid,_setup_id uuid,_private_dataset_id uuid,_request_key uuid,_request_context_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF d.rows=2 AND wire_bytes<=2097152 THEN PERFORM set_config('work_mem','4MB',true);PERFORM set_config('temp_file_limit','1024',true);END IF;
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
 PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'capacity.probe.recorded',p.id,jsonb_build_object('receipt_sha256',p.receipt_sha256,'rows',p.rows_count::text,'qualification_created',false,'rolled_back_output_writes',true,'audit_sequence_values_may_advance',true));
 RETURN to_jsonb(p)||jsonb_build_object('state','probe_recorded','request_replay',false,'qualification_created',false,'memory_metric','allocated_context_snapshot_not_peak_rss','full_registration_writes_rolled_back',true,'audit_sequence_values_may_advance',true);
END $$;
REVOKE ALL ON FUNCTION private.dpdi_capacity_source_fingerprint(),private.dpdi_capacity_probe_allowed(uuid,uuid,uuid,uuid,uuid),private.dpdi_capacity_capture_memory(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.dpdi_probe_output_capacity(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.dpdi_probe_output_capacity(uuid,uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dpdi_register_public_output(_tenant_id uuid,_setup_id uuid,_private_dataset_id uuid,_request_context_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpd_request_actor(_tenant_id,_setup_id,'publication.perform',_request_context_id);d private.dpdi_published_datasets%ROWTYPE;j private.dpdi_jobs%ROWTYPE;e private.dpdi_job_events%ROWTYPE;link private.dpdi_public_output_links%ROWTYPE;upload public.workspace_data_source_uploads%ROWTYPE;dataset public.data_prep_prepared_datasets%ROWTYPE;rowarray jsonb;content text;wire_bytes bigint;qualification private.dpdi_output_registration_qualifications%ROWTYPE;
BEGIN
 SELECT * INTO d FROM private.dpdi_published_datasets WHERE id=_private_dataset_id AND tenant_id=_tenant_id AND setup_id=_setup_id FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'dpdi.actual_published_manifest_required';END IF;j:=private.dpdi_authorize(_tenant_id,_setup_id,d.job_id,actor,true);e:=private.dpdi_head(j.id);
 SELECT * INTO link FROM private.dpdi_public_output_links WHERE private_dataset_id=d.id;
 IF FOUND THEN SELECT * INTO dataset FROM public.data_prep_prepared_datasets WHERE id=link.dataset_id;IF private.dpdi_public_dataset_current(_tenant_id,dataset.id,actor) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpdi.current_public_output_replay_evidence_denied' USING ERRCODE='42501';END IF;RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'setup_id',_setup_id,'dataset',to_jsonb(dataset),'output_upload_id',link.upload_id,'original_input_upload_id',NULL,'request_replay',true);END IF;
 IF j.snapshot->>'mode'<>'prepare' OR e.phase<>'success' OR e.blocking_records<>0 OR NOT EXISTS(SELECT 1 FROM private.dpdi_publication_decisions WHERE id=d.publication_decision_id AND decision='approved' AND output_root_sha256=e.output_root_sha256) THEN RAISE EXCEPTION 'dpdi.final_human_approved_output_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.data_prep_pipelines p WHERE p.id=d.pipeline_id AND p.tenant_id=_tenant_id AND p.version=d.pipeline_version AND p.status='approved' AND p.lifecycle_state='production' AND p.output_data_source_id=d.data_source_id) OR NOT EXISTS(SELECT 1 FROM public.data_prep_approved_configurations ac WHERE ac.tenant_id=_tenant_id AND ac.pipeline_id=d.pipeline_id AND ac.pipeline_version=d.pipeline_version AND ac.configuration_id=d.configuration_id AND ac.approved_by<>actor) THEN RAISE EXCEPTION 'dpdi.actual_governed_approved_production_transition_required_no_private_approval_waiver' USING ERRCODE='42501';END IF;
 SELECT coalesce(sum(octet_length(p.wire)),0) INTO wire_bytes FROM private.dpdi_job_pages p WHERE p.job_id=j.id;
 SELECT * INTO qualification FROM private.dpdi_output_registration_qualifications q WHERE q.tenant_id=_tenant_id AND q.configuration_id=d.configuration_id AND q.expires_at>clock_timestamp() AND q.qualified_at<=clock_timestamp() AND q.max_rows>=d.rows AND q.max_wire_bytes>=wire_bytes AND q.source_body_sha256=encode(sha256(convert_to(pg_get_functiondef('public.dpdi_register_public_output(uuid,uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex') AND NOT EXISTS(SELECT 1 FROM private.dpdi_exact_output_capacity_certificates scoped WHERE scoped.qualification_id=q.id AND (scoped.tenant_id=_tenant_id AND scoped.setup_id=_setup_id AND scoped.private_dataset_id=d.id AND scoped.source_fingerprint=private.dpdi_capacity_source_fingerprint() AND scoped.configuration_sha256=j.snapshot->>'configuration_sha256' AND scoped.output_root_sha256=d.content_sha256 AND scoped.exact_wire_bytes=wire_bytes AND q.max_rows=2) IS DISTINCT FROM true) ORDER BY q.qualified_at DESC LIMIT 1;
 IF NOT FOUND AND private.dpdi_capacity_probe_allowed(_tenant_id,_setup_id,d.id,actor,_request_context_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpdi.public_output_capacity_unqualified_preserve_published_manifest_no_fake_registration' USING ERRCODE='55000';END IF;
 -- One ordered aggregation, never per-row/per-page growing JSON copies.
 -- It still materializes the genuine legacy output array, so a real provider
 -- qualification matching exact configuration/source is mandatory above.
 WITH records AS MATERIALIZED(SELECT p.sequence,x.ordinality,x.value::jsonb record FROM private.dpdi_job_pages p CROSS JOIN LATERAL regexp_split_to_table(p.wire,E'\n') WITH ORDINALITY AS x(value,ordinality) WHERE p.job_id=j.id AND x.value<>'')
 SELECT CASE WHEN bool_or(record->'blocking' IS DISTINCT FROM 'false'::jsonb OR record->'excluded' IS DISTINCT FROM 'false'::jsonb) THEN NULL ELSE coalesce(jsonb_agg((record->'payload')||jsonb_build_object('extras_json',record->'extras_json') ORDER BY sequence,ordinality),'[]') END INTO rowarray FROM records;
 IF rowarray IS NULL THEN RAISE EXCEPTION 'dpdi.no_blocked_or_unapproved_excluded_output_registration';END IF;
 IF jsonb_array_length(rowarray)<>d.rows THEN RAISE EXCEPTION 'dpdi.complete_output_registration_count_required';END IF;content:=private.dpw_hash(rowarray);PERFORM private.dpdi_capacity_capture_memory(_tenant_id,_setup_id,d.id,actor,_request_context_id);
 INSERT INTO public.workspace_data_source_uploads(tenant_id,data_source_id,filename,mime_type,size_bytes,row_count,columns,sample_rows,content_sha256,uploaded_by,rows)
 VALUES(_tenant_id,d.data_source_id,'prepared-'||d.id::text||'.json','application/json',octet_length(rowarray::text),jsonb_array_length(rowarray),j.snapshot->'confirmed_mapping'->'output_schema','[]',content,actor,rowarray) RETURNING * INTO upload;
 INSERT INTO public.data_prep_prepared_datasets(tenant_id,pipeline_id,pipeline_version,batch_id,run_id,business_date,data_source_id,upload_id,rows,content_sha256,request_key,published_by)
 VALUES(_tenant_id,d.pipeline_id,d.pipeline_version,(j.snapshot->>'batch_id')::uuid,d.run_id,d.business_date,d.data_source_id,upload.id,d.rows::integer,content,d.request_key,actor) RETURNING * INTO dataset;
 INSERT INTO private.dpdi_public_output_links(dataset_id,private_dataset_id,upload_id,original_inputs_have_no_legacy_upload) VALUES(dataset.id,d.id,upload.id,true);
 UPDATE public.data_prep_delivery_batches SET state='published' WHERE id=dataset.batch_id AND state='prepared';
 PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'public.output.registered',dataset.id,jsonb_build_object('actual_output_upload_id',upload.id,'original_input_upload_id',NULL,'rows',dataset.rows,'content_sha256',content,'hash_kind','native_jsonb_rows_sha256','source_manifest_hash_kind','immutable_page_prefix_sha256'));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'setup_id',_setup_id,'dataset',to_jsonb(dataset),'output_upload_id',upload.id,'original_input_upload_id',NULL,'request_replay',false);
END $$;

-- Main-only native operator. Certifies the ACTUAL two-row registration probe,
-- not process peak RSS, not larger inputs, and never a fixture/runtime echo.
CREATE TABLE private.dpdi_exact_output_capacity_certificates(
 qualification_id uuid PRIMARY KEY REFERENCES private.dpdi_output_registration_qualifications(id),
 probe_id uuid NOT NULL UNIQUE REFERENCES private.dpdi_capacity_probes(id),tenant_id uuid NOT NULL,setup_id uuid NOT NULL,
 actor_id uuid NOT NULL,request_key uuid NOT NULL,private_dataset_id uuid NOT NULL,configuration_sha256 text NOT NULL,
 source_fingerprint text NOT NULL,output_root_sha256 text NOT NULL,output_sha256 text NOT NULL,
 exact_wire_bytes bigint NOT NULL,allocated_context_snapshot_bytes bigint NOT NULL,elapsed_ms numeric NOT NULL,
 evidence_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(tenant_id,actor_id,request_key));
ALTER TABLE private.dpdi_exact_output_capacity_certificates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dpdi_exact_output_capacity_certificates FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER dpdi_exact_capacity_certificate_immutable BEFORE UPDATE OR DELETE ON private.dpdi_exact_output_capacity_certificates FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();

CREATE FUNCTION private.dpdi_certify_exact_two_row_output(_tenant_id uuid,_setup_id uuid,_probe_id uuid,_request_key uuid,_request_context_id uuid,_readback_evidence_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c private.dpd_request_contexts%ROWTYPE;p private.dpdi_capacity_probes%ROWTYPE;j private.dpdi_jobs%ROWTYPE;
 d private.dpdi_published_datasets%ROWTYPE;q private.dpdi_output_registration_qualifications%ROWTYPE;
 cert private.dpdi_exact_output_capacity_certificates%ROWTYPE;actor uuid;network_enabled boolean;fp text;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_setting('role',true) IS DISTINCT FROM 'none'
 OR _request_key IS NULL OR coalesce(_readback_evidence_sha256,'')!~'^[a-f0-9]{64}$' OR _readback_evidence_sha256=repeat('0',64)
 THEN RAISE EXCEPTION 'dpdi.exact_capacity_closed_main_operator_and_readback_required' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM private.dpd_request_contexts WHERE id=_request_context_id AND tenant_id=_tenant_id AND setup_id=_setup_id AND operation='publication.perform';
 IF c.id IS NULL OR c.expires_at<=clock_timestamp() OR c.transport_kind IS DISTINCT FROM 'main_fixed_service_verified_middleware_CF_transport' THEN RAISE EXCEPTION 'dpdi.exact_capacity_current_fixed_context_required' USING ERRCODE='42501';END IF;
 actor:=private.dpd_peer_actor(_tenant_id,c.verified_subject);PERFORM public.assert_data_prep_actor(_tenant_id,actor,true);
 SELECT ip_allowlist_enabled INTO network_enabled FROM public.tenant_security_settings WHERE tenant_id=_tenant_id;
 IF actor IS DISTINCT FROM c.actor_id OR network_enabled IS NULL OR(network_enabled AND(c.request_ip IS NULL OR public.ip_in_tenant_allowlist(_tenant_id,host(c.request_ip)) IS DISTINCT FROM true))
 OR public.user_has_permission(actor,_tenant_id,'data.prep.author',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpdi.exact_capacity_current_actor_network_grants_required' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM private.dpdi_capacity_probes WHERE id=_probe_id AND tenant_id=_tenant_id AND setup_id=_setup_id AND actor_id=actor;
 IF p.id IS NULL THEN RAISE EXCEPTION 'dpdi.exact_capacity_actual_owned_native_probe_required' USING ERRCODE='42501';END IF;
 j:=private.dpdi_authorize(_tenant_id,_setup_id,p.job_id,actor,true);SELECT * INTO d FROM private.dpdi_published_datasets WHERE id=p.dataset_id;fp:=private.dpdi_capacity_source_fingerprint();
 IF p.rows_count<>2 OR d.rows<>2 OR p.wire_bytes NOT BETWEEN 1 AND 2097152 OR p.elapsed_ms NOT BETWEEN 0 AND 15000
 OR p.allocated_context_snapshot_bytes NOT BETWEEN 1 AND 67108864
 OR p.finished_at<clock_timestamp()-interval '15 minutes' OR p.finished_at>clock_timestamp()
 OR p.configuration_id IS DISTINCT FROM d.configuration_id OR p.configuration_sha256 IS DISTINCT FROM j.snapshot->>'configuration_sha256'
 OR p.source_fingerprint IS DISTINCT FROM fp OR p.output_root_sha256 IS DISTINCT FROM d.content_sha256
 OR d.content_sha256 IS DISTINCT FROM(private.dpdi_head(j.id)).output_root_sha256
 OR EXISTS(SELECT 1 FROM private.dpdi_public_output_links WHERE private_dataset_id=d.id)
 THEN RAISE EXCEPTION 'dpdi.exact_two_row_current_source_resource_envelope_required' USING ERRCODE='54000';END IF;
 SELECT * INTO cert FROM private.dpdi_exact_output_capacity_certificates WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF cert.probe_id<>p.id OR cert.evidence_sha256<>_readback_evidence_sha256 THEN RAISE EXCEPTION 'dpdi.exact_capacity_immutable_request_conflict' USING ERRCODE='PT409';END IF;
  SELECT * INTO q FROM private.dpdi_output_registration_qualifications WHERE id=cert.qualification_id;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'setup_id',_setup_id,'qualification',to_jsonb(q),'certificate',to_jsonb(cert),'request_replay',true,'currently_available',q.expires_at>clock_timestamp());END IF;
 INSERT INTO private.dpdi_output_registration_qualifications(tenant_id,configuration_id,max_rows,max_wire_bytes,provider_evidence_sha256,source_body_sha256,qualified_by,qualified_at,expires_at)
 VALUES(_tenant_id,d.configuration_id,2,p.wire_bytes,_readback_evidence_sha256,encode(sha256(convert_to(pg_get_functiondef('public.dpdi_register_public_output(uuid,uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex'),actor,clock_timestamp(),clock_timestamp()+interval '1 hour') RETURNING * INTO q;
 INSERT INTO private.dpdi_exact_output_capacity_certificates(qualification_id,probe_id,tenant_id,setup_id,actor_id,request_key,private_dataset_id,configuration_sha256,source_fingerprint,output_root_sha256,output_sha256,exact_wire_bytes,allocated_context_snapshot_bytes,elapsed_ms,evidence_sha256)
 VALUES(q.id,p.id,_tenant_id,_setup_id,actor,_request_key,d.id,p.configuration_sha256,fp,p.output_root_sha256,p.output_sha256,p.wire_bytes,p.allocated_context_snapshot_bytes,p.elapsed_ms,_readback_evidence_sha256) RETURNING * INTO cert;
 PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'capacity.exact_two_row.qualified',q.id,jsonb_build_object('dataset_id',d.id,'native_probe_id',p.id,'max_rows','2','exact_wire_bytes',p.wire_bytes::text,'source_fingerprint',fp,'measurement_kind','allocated_context_snapshot_and_guarded_exact_registration','peak_rss_proved',false,'larger_population_qualified',false,'expires_at',q.expires_at));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'setup_id',_setup_id,'qualification',to_jsonb(q),'certificate',to_jsonb(cert),'request_replay',false,'currently_available',true,'peak_rss_proved',false,'larger_population_qualified',false);
END $$;
REVOKE ALL ON FUNCTION private.dpdi_certify_exact_two_row_output(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Parent's closed native operator purpose. SECURITY INVOKER is deliberate:
-- checking current_user on a SECURITY DEFINER routine would prove its owner,
-- not the genuine executor. No authenticated/service role can certify.
CREATE FUNCTION private.dpdi_certify_output_capacity(_tenant_id uuid,_setup_id uuid,_probe_id uuid,_request_key uuid,_request_context_id uuid,_evidence jsonb,_max_rows bigint,_max_wire_bytes bigint,_max_elapsed_ms bigint,_max_peak_rss_bytes bigint,_ttl_seconds integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c private.dpd_request_contexts%ROWTYPE;p private.dpdi_capacity_probes%ROWTYPE;j private.dpdi_jobs%ROWTYPE;q private.dpdi_output_registration_qualifications%ROWTYPE;cert private.dpdi_capacity_certificates%ROWTYPE;actor uuid;request_sha text;network_enabled boolean;observed_from timestamptz;observed_to timestamptz;current_source text;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_setting('role',true) IS DISTINCT FROM 'none' OR _request_key IS NULL THEN RAISE EXCEPTION 'dpdi.capacity_closed_native_operator_required' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM private.dpd_request_contexts WHERE id=_request_context_id AND tenant_id=_tenant_id AND setup_id=_setup_id AND operation='publication.perform';
 IF c.id IS NULL OR c.expires_at<=clock_timestamp() OR c.transport_kind IS DISTINCT FROM 'main_fixed_service_verified_middleware_CF_transport' THEN RAISE EXCEPTION 'dpdi.capacity_fresh_actual_context_required' USING ERRCODE='42501';END IF;
 actor:=private.dpd_peer_actor(_tenant_id,c.verified_subject);PERFORM public.assert_data_prep_actor(_tenant_id,actor,true);
 SELECT ip_allowlist_enabled INTO network_enabled FROM public.tenant_security_settings WHERE tenant_id=_tenant_id;
 IF actor IS DISTINCT FROM c.actor_id OR network_enabled IS NULL OR (network_enabled AND (c.request_ip IS NULL OR public.ip_in_tenant_allowlist(_tenant_id,host(c.request_ip)) IS DISTINCT FROM true)) OR public.user_has_permission(actor,_tenant_id,'data.prep.author',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpdi.capacity_current_actor_network_grants_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM private.dpdi_capacity_probes WHERE id=_probe_id AND tenant_id=_tenant_id AND setup_id=_setup_id AND actor_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'dpdi.capacity_actual_owned_probe_required' USING ERRCODE='42501';END IF;j:=private.dpdi_authorize(_tenant_id,_setup_id,p.job_id,actor,true);current_source:=private.dpdi_capacity_source_fingerprint();
 IF p.source_fingerprint IS DISTINCT FROM current_source OR p.configuration_sha256 IS DISTINCT FROM j.snapshot->>'configuration_sha256' OR p.output_root_sha256 IS DISTINCT FROM (private.dpdi_head(j.id)).output_root_sha256 OR p.finished_at<clock_timestamp()-interval '24 hours' THEN RAISE EXCEPTION 'dpdi.capacity_current_probe_source_and_configuration_required' USING ERRCODE='PT409';END IF;
 IF _max_rows IS NULL OR _max_rows NOT BETWEEN 1 AND p.rows_count OR _max_wire_bytes IS NULL OR _max_wire_bytes NOT BETWEEN 1 AND p.wire_bytes OR _max_elapsed_ms IS NULL OR _max_elapsed_ms NOT BETWEEN 1 AND 60000 OR _max_peak_rss_bytes IS NULL OR _max_peak_rss_bytes NOT BETWEEN 1 AND 1073741824 OR _ttl_seconds IS NULL OR _ttl_seconds NOT BETWEEN 60 AND 86400 OR jsonb_typeof(_evidence) IS DISTINCT FROM 'object' OR octet_length(_evidence::text)>16384 THEN RAISE EXCEPTION 'dpdi.capacity_explicit_bounded_budget_required' USING ERRCODE='22023';END IF;
 -- This gate intentionally cannot turn a SQL allocation snapshot into peak RSS.
 -- Main must independently review the authenticated provider telemetry artifact.
 IF _evidence->>'protocol' IS DISTINCT FROM 'fvi_dpdi_provider_capacity_v1' OR _evidence->>'native_probe_id' IS DISTINCT FROM p.id::text OR _evidence->>'native_receipt_sha256' IS DISTINCT FROM p.receipt_sha256 OR _evidence->>'source_fingerprint' IS DISTINCT FROM current_source OR _evidence->>'backend_pid' IS DISTINCT FROM p.backend_pid::text OR _evidence->>'measurement_kind' IS DISTINCT FROM 'provider_process_peak_rss' OR _evidence->>'measurement_source' IS DISTINCT FROM 'parent_verified_provider_telemetry' OR _evidence->>'full_registration_path' IS DISTINCT FROM 'true' OR coalesce(_evidence->>'peak_rss_bytes','')!~'^[1-9][0-9]{0,15}$' OR coalesce(_evidence->>'whole_registration_ms','')!~'^[1-9][0-9]{0,8}$' OR coalesce(_evidence->>'artifact_sha256','')!~'^[a-f0-9]{64}$' OR _evidence->>'artifact_sha256'=repeat('0',64) OR coalesce(_evidence->>'observed_from','')!~'^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' OR coalesce(_evidence->>'observed_to','')!~'^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION 'dpdi.capacity_independent_full_provider_measurement_required' USING ERRCODE='22023';END IF;
 observed_from:=(_evidence->>'observed_from')::timestamptz;observed_to:=(_evidence->>'observed_to')::timestamptz;
 IF observed_from>p.started_at OR observed_to<p.finished_at OR observed_to<=observed_from OR observed_to>clock_timestamp()+interval '5 seconds' OR (_evidence->>'whole_registration_ms')::bigint<p.elapsed_ms OR (_evidence->>'whole_registration_ms')::bigint>_max_elapsed_ms OR p.elapsed_ms>_max_elapsed_ms OR (_evidence->>'peak_rss_bytes')::bigint>_max_peak_rss_bytes THEN RAISE EXCEPTION 'dpdi.capacity_actual_measurement_exceeds_explicit_budget_or_interval' USING ERRCODE='54000';END IF;
 request_sha:=private.dpw_hash(jsonb_build_object('probe_id',_probe_id,'evidence',_evidence,'max_rows',_max_rows::text,'max_wire_bytes',_max_wire_bytes::text,'max_elapsed_ms',_max_elapsed_ms::text,'max_peak_rss_bytes',_max_peak_rss_bytes::text,'ttl_seconds',_ttl_seconds));
 SELECT * INTO cert FROM private.dpdi_capacity_certificates WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF cert.request_sha256 IS DISTINCT FROM request_sha THEN RAISE EXCEPTION 'dpdi.capacity_immutable_certificate_request_conflict' USING ERRCODE='PT409';END IF;SELECT * INTO q FROM private.dpdi_output_registration_qualifications WHERE id=cert.qualification_id;RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'setup_id',_setup_id,'qualification',to_jsonb(q),'certificate',to_jsonb(cert),'request_replay',true,'currently_available',q.expires_at>clock_timestamp());END IF;
 INSERT INTO private.dpdi_output_registration_qualifications(tenant_id,configuration_id,max_rows,max_wire_bytes,provider_evidence_sha256,source_body_sha256,qualified_by,qualified_at,expires_at) VALUES(_tenant_id,p.configuration_id,_max_rows,_max_wire_bytes,_evidence->>'artifact_sha256',encode(sha256(convert_to(pg_get_functiondef('public.dpdi_register_public_output(uuid,uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex'),actor,clock_timestamp(),clock_timestamp()+_ttl_seconds*interval '1 second') RETURNING * INTO q;
 INSERT INTO private.dpdi_capacity_certificates(qualification_id,probe_id,tenant_id,actor_id,request_key,source_fingerprint,configuration_sha256,evidence,evidence_sha256,request_sha256) VALUES(q.id,p.id,_tenant_id,actor,_request_key,current_source,p.configuration_sha256,_evidence,private.dpw_hash(_evidence),request_sha) RETURNING * INTO cert;
 PERFORM private.dpd_event(_tenant_id,_setup_id,actor,'capacity.qualification.recorded',q.id,jsonb_build_object('native_probe_id',p.id,'artifact_sha256',q.provider_evidence_sha256,'source_fingerprint',current_source,'max_rows',q.max_rows::text,'max_wire_bytes',q.max_wire_bytes::text,'expires_at',q.expires_at,'measurement_kind','provider_process_peak_rss'));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'setup_id',_setup_id,'qualification',to_jsonb(q),'certificate',to_jsonb(cert),'request_replay',false,'currently_available',true);
END $$;
REVOKE ALL ON FUNCTION private.dpdi_certify_output_capacity(uuid,uuid,uuid,uuid,uuid,jsonb,bigint,bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;

DO $dpd_full_after$ DECLARE old jsonb;actual jsonb;n bigint;digest text;BEGIN
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.rows')::jsonb) LOOP
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q',old->>'schema',old->>'name') INTO n,digest;
 IF n::text IS DISTINCT FROM old->>'rows' OR digest IS DISTINCT FROM old->>'hash' THEN RAISE EXCEPTION 'dpd_full.old_rows_changed:%',old->>'name'; END IF;END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.routines')::jsonb) LOOP
 SELECT to_jsonb(q) INTO actual FROM pg_proc q WHERE q.oid=(old->>'oid')::oid;
 IF old->>'oid'=ANY(ARRAY['60986']::text[]) THEN
  IF actual-'prosrc' IS DISTINCT FROM old-'prosrc' THEN RAISE EXCEPTION 'dpd_full.consumer_catalog_changed';END IF;
 ELSE IF actual IS DISTINCT FROM old THEN RAISE EXCEPTION 'dpd_full.old_routine_changed:%',old->>'oid';END IF;END IF;END LOOP;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='60986'::oid) IS DISTINCT FROM '3011842e082a893a11b5ff0b7a6a179fced44b82772e3d3da8b0622cfac62dda' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.dpdi_register_public_output';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_capacity.roles')::jsonb THEN RAISE EXCEPTION 'dpd_full.roles_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_capacity.members')::jsonb THEN RAISE EXCEPTION 'dpd_full.members_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';IF actual IS DISTINCT FROM current_setting('fvi.dpd_capacity.namespaces')::jsonb THEN RAISE EXCEPTION 'dpd_full.namespaces_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_capacity.defaultacl')::jsonb THEN RAISE EXCEPTION 'dpd_full.defaultacl_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_capacity.ledger')::jsonb THEN RAISE EXCEPTION 'dpd_full.ledger_changed';END IF;
 IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_class')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_class q) THEN RAISE EXCEPTION 'dpd_full.old_pg_class_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_type')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_type q) THEN RAISE EXCEPTION 'dpd_full.old_pg_type_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_attribute')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_attribute q) THEN RAISE EXCEPTION 'dpd_full.old_pg_attribute_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_constraint')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_constraint q) THEN RAISE EXCEPTION 'dpd_full.old_pg_constraint_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_index')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_index q) THEN RAISE EXCEPTION 'dpd_full.old_pg_index_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_policy')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_policy q) THEN RAISE EXCEPTION 'dpd_full.old_pg_policy_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_capacity.pg_trigger')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_trigger q) THEN RAISE EXCEPTION 'dpd_full.old_pg_trigger_changed';END IF;
 END $dpd_full_after$;
