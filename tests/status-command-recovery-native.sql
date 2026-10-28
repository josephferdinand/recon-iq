\set ON_ERROR_STOP on
-- PREPARED, NOT EXECUTED. Parent's disposable PG17.6 fixture only, never PROD.
-- Requires reviewed base + recovery proposal and original synthetic bootstrap.
-- Authenticate below via synthetic fixture GUCs, not genuine hosted MFA.
BEGIN;
CREATE TEMP TABLE status_recovery_checks(name text);
CREATE FUNCTION pg_temp.status_recovery_assert(_name text,_condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',_name; END IF;
INSERT INTO status_recovery_checks VALUES(_name); END $$;
SELECT set_config('fvi.actor','11111111-1111-4111-8111-111111111111',true),set_config('fvi.aal','aal2',true),set_config('fvi.role','authenticated',true);
DO $checks$
DECLARE request uuid:=gen_random_uuid(); other_request uuid:=gen_random_uuid(); incident uuid; result jsonb; recovered jsonb;
  payload jsonb:=jsonb_build_object('kind','incident','severity','major','status','investigating',
    'title','Synthetic recovery qualification incident','summary','Synthetic fixture only; no production incident is represented.',
    'cell_keys',jsonb_build_array('production-current'),'component_keys',jsonb_build_array('api'),'function_keys','[]'::jsonb,
    'started_at','2025-01-01T00:00:00Z','detected_at',NULL,'resolved_at',NULL,'occurred_at','2025-01-01T00:01:00Z',
    'display_timezone','UTC','evidence_ref','Synthetic private recovery qualification evidence','public_safe',true);
BEGIN
  result:=public.status_incident_command(request,NULL,0,'save_draft',payload);incident:=(result->>'id')::uuid;
  PERFORM pg_temp.status_recovery_assert('draft committed with success receipt',result->>'workflow_state'='draft');
  recovered:=public.status_incident_command_receipt(request,NULL,0,'save_draft',payload);
  PERFORM pg_temp.status_recovery_assert('exact request recovered',recovered=result);
  PERFORM pg_temp.status_recovery_assert('exact replay has same receipt',public.status_incident_command(request,NULL,0,'save_draft',payload)=result);
  PERFORM pg_temp.status_recovery_assert('replay does not append duplicate positive audit',(SELECT count(*)=1 FROM public.status_incident_audit WHERE incident_id=incident));
  PERFORM pg_temp.status_recovery_assert('missing receipt remains unknown',public.status_incident_command_receipt(other_request,NULL,0,'save_draft',payload) IS NULL);
  BEGIN
    PERFORM public.status_incident_command_receipt(request,NULL,0,'save_draft',payload||'{"title":"Changed synthetic command"}');
    RAISE EXCEPTION 'FAIL: fingerprint mismatch accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO status_recovery_checks VALUES('receipt fingerprint mismatch refused'); END;
  result:=public.status_incident_command(other_request,incident,99,'submit','{"reason":"Synthetic stale revision submission"}');
  PERFORM pg_temp.status_recovery_assert('stale refusal is PT409 structured result',result->>'outcome'='refused' AND result->>'code'='PT409');
  PERFORM pg_temp.status_recovery_assert('stale refusal audit persists',EXISTS(SELECT 1 FROM public.status_command_denials WHERE id=(result->>'denial_id')::bigint AND request_id=other_request AND refusal_code='PT409'));
  PERFORM pg_temp.status_recovery_assert('stale refusal leaves incident unchanged',(SELECT current_revision=1 AND workflow_state='draft' FROM public.status_incident_workflows WHERE id=incident));
  PERFORM set_config('fvi.aal','aal1',true);
  result:=public.status_incident_command(gen_random_uuid(),incident,1,'submit','{"reason":"Synthetic AAL1 refusal submission"}');
  PERFORM pg_temp.status_recovery_assert('AAL1 refusal audit persists',result->>'code'='42501' AND EXISTS(SELECT 1 FROM public.status_command_denials WHERE id=(result->>'denial_id')::bigint));
  BEGIN
    PERFORM public.status_incident_command_receipt(request,NULL,0,'save_draft',payload);
    RAISE EXCEPTION 'FAIL: AAL1 receipt accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO status_recovery_checks VALUES('receipt rechecks current MFA'); END;
  PERFORM set_config('fvi.aal','aal2',true);
  result:=public.status_incident_command(gen_random_uuid(),NULL,0,'save_draft',payload||'{"resolved_at":"2024-01-01T00:00:00Z"}');
  PERFORM pg_temp.status_recovery_assert('invalid dates recorded as sanitized refusal',result->>'outcome'='refused' AND result->>'code'='P0001' AND NOT (result ? 'message'));
  PERFORM pg_temp.status_recovery_assert('internal apply function cannot bypass wrapper',NOT has_function_privilege('authenticated','public.status_incident_apply_command(uuid,uuid,integer,text,jsonb)','EXECUTE'));
  PERFORM pg_temp.status_recovery_assert('anonymous cannot recover private receipts',NOT has_function_privilege('anon','public.status_incident_command_receipt(uuid,uuid,integer,text,jsonb)','EXECUTE'));
  PERFORM pg_temp.status_recovery_assert('private denials have RLS',(SELECT relrowsecurity FROM pg_class WHERE oid='public.status_command_denials'::regclass));
  PERFORM pg_temp.status_recovery_assert('denials remain append only',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.status_command_denials'::regclass AND tgname='status_immutable'));
END $checks$;
SELECT 'PREPARED_PARENT_FIXTURE_RESULT' AS tier,count(*) AS passed FROM status_recovery_checks;
ROLLBACK;
