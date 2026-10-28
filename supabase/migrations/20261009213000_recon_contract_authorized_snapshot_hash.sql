DO $dpd_full_before$ DECLARE actual jsonb;rel record;rows_before jsonb:='[]';n bigint;digest text;filter text;BEGIN
 IF current_user<>'postgres' OR current_setting('role',true)<>'none' OR current_setting('server_version_num')<>'170006' OR current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'dpd_full.native_context_drift';END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>472 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20261009200000' THEN RAISE EXCEPTION 'dpd_full.current_ledger_drift';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef('39219'::oid),'UTF8')),'hex')) IS DISTINCT FROM '41cd1b3af40f45aa969960edc219b501f3ad2c7c801bbaa2e9463f86b3366c96' THEN RAISE EXCEPTION 'dpd_full.contract_exact_dependency_changed:private.recon_definition_config_snapshot';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('56423'::oid),'UTF8')),'hex')) IS DISTINCT FROM '29ec38a6ec4b324449ada00e781ebc8fc9b3a74fa0387dc075312a2d16f40c45' THEN RAISE EXCEPTION 'dpd_full.contract_exact_dependency_changed:private.rs_actor';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('56574'::oid),'UTF8')),'hex')) IS DISTINCT FROM 'b4ea2f2d2a07a595195ae0ece4f53551672297bf571eafbdb9212e59f950c247' THEN RAISE EXCEPTION 'dpd_full.contract_exact_dependency_changed:private.rs_recon_input_contracts';END IF;
IF (SELECT encode(sha256(convert_to(pg_get_functiondef('56575'::oid),'UTF8')),'hex')) IS DISTINCT FROM '39a9c76bb919565b758e30773248b3b86bb51e90870fc16ba5f9c7231bf90968' THEN RAISE EXCEPTION 'dpd_full.contract_exact_dependency_changed:public.read_recon_contract';END IF;
 FOR rel IN SELECT c.oid,ns.nspname,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE c.relkind IN('r','p','m') AND ns.nspname NOT IN('pg_catalog','information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp%' ORDER BY c.oid LOOP
 filter:=CASE WHEN rel.nspname='storage' AND rel.relname='buckets' THEN ' WHERE id<>''data-prep-authoring-originals''' ELSE '' END;
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q' ,rel.nspname,rel.relname) INTO n,digest;
 rows_before:=rows_before||jsonb_build_array(jsonb_build_object('oid',rel.oid::text,'schema',rel.nspname,'name',rel.relname,'rows',n::text,'hash',digest));
 END LOOP;
 PERFORM set_config('fvi.dpd_contract_hash.rows',rows_before::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_proc q;PERFORM set_config('fvi.dpd_contract_hash.routines',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;PERFORM set_config('fvi.dpd_contract_hash.roles',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;PERFORM set_config('fvi.dpd_contract_hash.members',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';PERFORM set_config('fvi.dpd_contract_hash.namespaces',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;PERFORM set_config('fvi.dpd_contract_hash.defaultacl',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;PERFORM set_config('fvi.dpd_contract_hash.ledger',actual::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_class q;PERFORM set_config('fvi.dpd_contract_hash.pg_class',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_type q;PERFORM set_config('fvi.dpd_contract_hash.pg_type',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_attribute q;PERFORM set_config('fvi.dpd_contract_hash.pg_attribute',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_constraint q;PERFORM set_config('fvi.dpd_contract_hash.pg_constraint',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_index q;PERFORM set_config('fvi.dpd_contract_hash.pg_index',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_policy q;PERFORM set_config('fvi.dpd_contract_hash.pg_policy',actual::text,true);
SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]') INTO actual FROM pg_trigger q;PERFORM set_config('fvi.dpd_contract_hash.pg_trigger',actual::text,true);
 END $dpd_full_before$;
CREATE FUNCTION private.rs_current_definition_sha(_tenant uuid,_definition uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $hash_bridge$
DECLARE d public.recon_definitions%ROWTYPE;
BEGIN
 PERFORM private.rs_actor(_tenant,_definition,'read');
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_contract_definition_required' USING ERRCODE='42501';END IF;
 RETURN encode(sha256(convert_to(private.recon_definition_config_snapshot(d)::text,'UTF8')),'hex');
END $hash_bridge$;
REVOKE ALL ON FUNCTION private.rs_current_definition_sha(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.rs_current_definition_sha(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.read_recon_contract(_tenant_id uuid, _definition_id uuid, _revision_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
 SET row_security TO 'on'
AS $function$
DECLARE d public.recon_definitions%ROWTYPE;v public.recon_definition_approved_versions%ROWTYPE;contracts jsonb;current_sha text;
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'read');
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_contract_definition_required' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=_definition_id
 AND (_revision_id IS NULL OR id=_revision_id) ORDER BY version_number DESC LIMIT 1;
 current_sha:=private.rs_current_definition_sha(_tenant_id,_definition_id);
 IF v.id IS NULL THEN RETURN jsonb_build_object('tenant_id',_tenant_id,'definition_id',_definition_id,'approved',false,
 'contract_available',false,'snapshot_sha256',NULL,'expected_definition_sha256',NULL,'current_definition_sha256',current_sha,
 'sides',d.sides,'pins',(SELECT jsonb_agg(jsonb_build_object('side_id',x->>'side_id','upload_id',x->>'upload_id')) FROM jsonb_array_elements(d.sides) x),
 'input_contracts','[]'::jsonb,'reason','approved_revision_unavailable','native_hash_algorithm','sha256_pg_jsonb_text');END IF;
 contracts:=private.rs_recon_input_contracts(_tenant_id,_definition_id,v.id);
 RETURN contracts||jsonb_build_object('tenant_id',_tenant_id,'definition_id',_definition_id,'approved',true,'revision_id',v.id,'revision_number',v.version_number,
 'snapshot_sha256',v.snapshot_sha256,'expected_definition_sha256',v.snapshot_sha256,'current_definition_sha256',current_sha,
 'current_revision',current_sha=v.snapshot_sha256,'approved_snapshot',v.snapshot,'sides',v.snapshot->'sides',
 'pins',(SELECT jsonb_agg(jsonb_build_object('side_id',x->>'side_id','upload_id',x->>'upload_id')) FROM jsonb_array_elements(v.snapshot->'sides') x),
 'native_hash_algorithm','sha256_pg_jsonb_text','historical_approved_snapshot_rewritten',false);
END $function$
;

DO $dpd_full_after$ DECLARE old jsonb;actual jsonb;n bigint;digest text;BEGIN
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.rows')::jsonb) LOOP
 EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(full_row,E''\n'' ORDER BY full_row),''''),''UTF8'')),''hex'') FROM (SELECT to_jsonb(t)::text full_row FROM %I.%I t) q',old->>'schema',old->>'name') INTO n,digest;
 IF n::text IS DISTINCT FROM old->>'rows' OR digest IS DISTINCT FROM old->>'hash' THEN RAISE EXCEPTION 'dpd_full.old_rows_changed:%',old->>'name'; END IF;END LOOP;
 FOR old IN SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.routines')::jsonb) LOOP
 SELECT to_jsonb(q) INTO actual FROM pg_proc q WHERE q.oid=(old->>'oid')::oid;
 IF old->>'oid'=ANY(ARRAY['56575']::text[]) THEN
  IF actual-'prosrc' IS DISTINCT FROM old-'prosrc' THEN RAISE EXCEPTION 'dpd_full.consumer_catalog_changed';END IF;
 ELSE IF actual IS DISTINCT FROM old THEN RAISE EXCEPTION 'dpd_full.old_routine_changed:%',old->>'oid';END IF;END IF;END LOOP;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='56575'::oid) IS DISTINCT FROM '8ddf2c10ddcde654f4188efd83dca4ceed389623b00ff76a306b86515de063fc' THEN RAISE EXCEPTION 'dpd_full.exact_consumer_postimage_changed:public.read_recon_contract';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_roles q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_contract_hash.roles')::jsonb THEN RAISE EXCEPTION 'dpd_full.roles_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.roleid,q.member),'[]') INTO actual FROM pg_auth_members q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_contract_hash.members')::jsonb THEN RAISE EXCEPTION 'dpd_full.members_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_namespace q WHERE q.nspname NOT LIKE 'pg_temp%' AND q.nspname NOT LIKE 'pg_toast_temp%';IF actual IS DISTINCT FROM current_setting('fvi.dpd_contract_hash.namespaces')::jsonb THEN RAISE EXCEPTION 'dpd_full.namespaces_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.oid),'[]') INTO actual FROM pg_default_acl q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_contract_hash.defaultacl')::jsonb THEN RAISE EXCEPTION 'dpd_full.defaultacl_changed';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.version),'[]') INTO actual FROM supabase_migrations.schema_migrations q;IF actual IS DISTINCT FROM current_setting('fvi.dpd_contract_hash.ledger')::jsonb THEN RAISE EXCEPTION 'dpd_full.ledger_changed';END IF;
 IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_class')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_class q) THEN RAISE EXCEPTION 'dpd_full.old_pg_class_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_type')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_type q) THEN RAISE EXCEPTION 'dpd_full.old_pg_type_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_attribute')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_attribute q) THEN RAISE EXCEPTION 'dpd_full.old_pg_attribute_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_constraint')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_constraint q) THEN RAISE EXCEPTION 'dpd_full.old_pg_constraint_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_index')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_index q) THEN RAISE EXCEPTION 'dpd_full.old_pg_index_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_policy')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_policy q) THEN RAISE EXCEPTION 'dpd_full.old_pg_policy_changed';END IF;
IF EXISTS(SELECT value FROM jsonb_array_elements(current_setting('fvi.dpd_contract_hash.pg_trigger')::jsonb) EXCEPT ALL SELECT to_jsonb(q) FROM pg_trigger q) THEN RAISE EXCEPTION 'dpd_full.old_pg_trigger_changed';END IF;
 END $dpd_full_after$;
