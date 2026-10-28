\set ON_ERROR_STOP on
CREATE TABLE public.status_fixture_checks(name text);
CREATE FUNCTION public.status_fixture_assert(_name text,_condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',_name; END IF; INSERT INTO status_fixture_checks VALUES (_name); END $$;
CREATE FUNCTION public.status_fixture_denial(_name text,_sql text,_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE success boolean:=false;
BEGIN
  BEGIN EXECUTE _sql; success:=true; EXCEPTION WHEN others THEN IF SQLSTATE<>_state THEN RAISE; END IF; END;
  IF success THEN RAISE EXCEPTION 'FAIL: denial %',_name; END IF;
  INSERT INTO status_fixture_checks VALUES (_name);
END $$;
CREATE FUNCTION public.status_fixture_payload() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'kind','incident','severity','major','status','investigating','title','Synthetic qualification incident',
  'summary','Synthetic fixture only; this event did not occur in FVI production.','impact',NULL,
  'cell_keys',jsonb_build_array('production-current'),'component_keys',jsonb_build_array('api'),'function_keys','[]'::jsonb,
  'started_at','2025-01-01T00:00:00Z','detected_at','2025-01-01T00:01:00Z','resolved_at',NULL,
  'occurred_at','2025-01-01T00:02:00Z','display_timezone','UTC','correction_reason',NULL,'root_cause',NULL,'remediation',NULL,
  'evidence_ref','private synthetic evidence; excluded from public output','public_safe',true) $$;
SELECT set_config('fvi.actor','11111111-1111-4111-8111-111111111111',false),set_config('fvi.aal','aal1',false),set_config('fvi.role','authenticated',false);
SELECT status_fixture_denial('AAL1 denied', $cmd$ SELECT status_incident_command(gen_random_uuid(),NULL,0,'save_draft',status_fixture_payload()) $cmd$,'42501');
SELECT set_config('fvi.aal','aal2',false);
CREATE TABLE public.status_fixture_receipt AS SELECT status_incident_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,0,'save_draft',status_fixture_payload()) AS receipt;
SELECT status_fixture_assert('draft stored', (SELECT receipt->>'workflow_state'='draft' FROM status_fixture_receipt));
SELECT status_fixture_assert('idempotent draft receipt',status_incident_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,0,'save_draft',status_fixture_payload())=(SELECT receipt FROM status_fixture_receipt));
SELECT status_fixture_assert('one draft version after retry',(SELECT count(*)=1 FROM status_incident_versions));
SELECT status_fixture_denial('same key changed payload denied',$cmd$ SELECT status_incident_command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,0,'save_draft',status_fixture_payload()||'{"title":"Changed synthetic title"}') $cmd$,'P0001');
SELECT status_fixture_assert('draft not public',jsonb_array_length(status_public_snapshot()->'incidents')=0);
SELECT status_fixture_denial('missing arrays denied',$cmd$ SELECT status_incident_command(gen_random_uuid(),NULL,0,'save_draft',status_fixture_payload()-'cell_keys') $cmd$,'P0001');
SELECT status_fixture_denial('unregistered cell denied',$cmd$ SELECT status_incident_command(gen_random_uuid(),NULL,0,'save_draft',status_fixture_payload()||'{"cell_keys":["unregistered-uat"]}') $cmd$,'P0001');
SELECT status_fixture_denial('invalid dates denied',$cmd$ SELECT status_incident_command(gen_random_uuid(),NULL,0,'save_draft',status_fixture_payload()||'{"resolved_at":"2024-01-01T00:00:00Z"}') $cmd$,'P0001');
SELECT status_fixture_denial('unregistered function denied',$cmd$ SELECT status_incident_command(gen_random_uuid(),NULL,0,'save_draft',status_fixture_payload()||'{"function_keys":["unregistered.function"]}') $cmd$,'P0001');
SELECT status_fixture_denial('stale revision denied',$cmd$ SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),99,'submit','{"reason":"Synthetic review submission"}') $cmd$,'40001');
SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'submit','{"reason":"Synthetic review submission"}');
SELECT status_fixture_denial('self review denied',$cmd$ SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'review','{"reason":"Synthetic self approval"}') $cmd$,'42501');
SELECT set_config('fvi.actor','22222222-2222-4222-8222-222222222222',false);
SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'review','{"reason":"Synthetic independent review"}');
SELECT status_fixture_assert('reviewed draft still private',jsonb_array_length(status_public_snapshot()->'incidents')=0);
DELETE FROM status_fixture_admins WHERE id='22222222-2222-4222-8222-222222222222';
SELECT set_config('fvi.actor','11111111-1111-4111-8111-111111111111',false);
SELECT status_fixture_denial('revoked reviewer cannot support publication',$cmd$ SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'publish','{"reason":"Synthetic attempted publish"}') $cmd$,'42501');
INSERT INTO status_fixture_admins VALUES('22222222-2222-4222-8222-222222222222');
SELECT set_config('fvi.actor','22222222-2222-4222-8222-222222222222',false);
SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'publish','{"reason":"Synthetic verified publication"}');
SELECT status_fixture_assert('published version visible',jsonb_array_length(status_public_snapshot()->'incidents')=1);
SELECT status_fixture_assert('private evidence excluded',position('private synthetic evidence' IN status_public_snapshot()::text)=0);
SELECT status_fixture_assert('private actor excluded',position('22222222-2222-4222-8222-222222222222' IN status_public_snapshot()::text)=0);
SELECT status_fixture_assert('actual date distinct from entry date',(SELECT (public_payload->>'started_at')::timestamptz<entered_at FROM status_incident_versions LIMIT 1));
SELECT status_fixture_denial('published record cannot be silently overwritten',$cmd$ SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'save_draft',status_fixture_payload()) $cmd$,'42501');
SELECT set_config('fvi.actor','11111111-1111-4111-8111-111111111111',false);
SELECT status_incident_command(gen_random_uuid(),(SELECT (receipt->>'id')::uuid FROM status_fixture_receipt),1,'append_correction',status_fixture_payload()||'{"correction_reason":"Synthetic correction preserves earlier publication"}');
SELECT status_fixture_assert('old publication remains visible while correction drafted',jsonb_array_length(status_public_snapshot()->'incidents')=1);
SELECT status_fixture_assert('correction creates new immutable revision',(SELECT count(*)=2 FROM status_incident_versions));
SELECT status_fixture_denial('version overwrite denied',$cmd$ UPDATE status_incident_versions SET public_payload='{}' $cmd$,'P0001');
SELECT status_fixture_denial('audit delete denied',$cmd$ DELETE FROM status_incident_audit $cmd$,'P0001');
SELECT status_fixture_assert('no fabricated health',jsonb_array_length(status_public_snapshot()->'health')=0 AND jsonb_array_length(status_public_snapshot()->'history')=0);
INSERT INTO status_function_registry(cell_key,component_key,function_key,function_label,availability,probe_kind,probe_enabled,expected_interval_seconds,registration_evidence)
VALUES('production-current','api','fixture.api','Synthetic API function','deployed','functional',true,60,'Synthetic registration; not live proof');
SELECT set_config('fvi.role','authenticated',false);
SELECT status_fixture_denial('ordinary actor cannot record probe',$cmd$ SELECT status_record_probe(gen_random_uuid(),'production-current','fixture.api',now(),'healthy',12) $cmd$,'42501');
SELECT set_config('fvi.role','service_role',false);
SELECT status_record_probe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','production-current','fixture.api',now(),'healthy',12);
SELECT status_fixture_assert('instantaneous check does not invent uptime',(status_public_snapshot()->'history'->0->>'uptime_pct') IS NULL);
SELECT status_fixture_denial('future sample denied',$cmd$ SELECT status_record_probe(gen_random_uuid(),'production-current','fixture.api',now()+interval '1 hour','healthy',12) $cmd$,'P0001');
SELECT status_record_probe(gen_random_uuid(),'production-current','fixture.api',now()-interval '60 seconds','healthy',12,now()-interval '120 seconds',now()-interval '90 seconds',30);
SELECT status_record_probe(gen_random_uuid(),'production-current','fixture.api',now()-interval '30 seconds','outage',12,now()-interval '90 seconds',now()-interval '60 seconds',0);
SELECT status_fixture_assert('measured interval ratio is 50 percent',(status_public_snapshot()->'history'->0->>'uptime_pct')::numeric=50);
SELECT status_fixture_denial('overlapping observation rejected',$cmd$ SELECT status_record_probe(gen_random_uuid(),'production-current','fixture.api',now(),'healthy',12,now()-interval '100 seconds',now()-interval '70 seconds',30) $cmd$,'P0001');
UPDATE status_function_registry SET probe_kind='availability' WHERE function_key='fixture.api';
SELECT status_record_probe(gen_random_uuid(),'production-current','fixture.api',now(),'healthy',12);
SELECT status_fixture_assert('old functional evidence cannot be relabelled as availability',(SELECT count(*)=3 FROM status_probe_samples WHERE probe_kind='functional'));
SELECT status_fixture_assert('history only uses original functional samples',(status_public_snapshot()->'history'->0->>'sample_count')::integer=3);
SELECT status_fixture_assert('legacy component preimage unchanged',(SELECT components FROM status_fixture_preimages)=(SELECT md5(string_agg(row_to_json(x)::text,'|' ORDER BY id)) FROM status_components x));
SELECT status_fixture_assert('legacy incident preimage unchanged',(SELECT incidents FROM status_fixture_preimages)=(SELECT md5(string_agg(row_to_json(x)::text,'|' ORDER BY id)) FROM status_incidents x));
SELECT status_fixture_assert('legacy seeded history preserved and excluded',(SELECT history FROM status_fixture_preimages)=(SELECT md5(string_agg(row_to_json(x)::text,'|' ORDER BY id)) FROM status_component_history x));
SELECT count(*) AS source_fixture_checks_passed FROM status_fixture_checks;
SELECT 'STATUS_NATIVE_FIXTURE_PASS' AS result;
