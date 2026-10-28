-- Revision 2 only: persisted server correlation, replay, receipt rejection.
CREATE SCHEMA fvi_failed_login_test;
CREATE FUNCTION fvi_failed_login_test.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed-login revision2 failed: %',label; END IF; END $$;
CREATE FUNCTION fvi_failed_login_test.denied(sql text,code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=code THEN RETURN; ELSE RAISE; END IF; END; RAISE EXCEPTION 'Expected denial'; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owned@example.test',now());

-- CASE: Actual stored server support reference is distinct from the client key.
SELECT fvi_failed_login_test.assert(public.failed_login_begin('10000000-0000-4000-8000-000000000001',repeat('a',64),'password','owned@example.test',NULL,'20000000-0000-4000-8000-000000000001')->>'requestId'='20000000-0000-4000-8000-000000000001','server correlation persisted');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000001',repeat('a',64),'invalid_credentials');
SELECT fvi_failed_login_test.assert((SELECT request_id<>id AND request_id='20000000-0000-4000-8000-000000000001'::uuid FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'),'stored reference not client key');
SELECT fvi_failed_login_test.assert((SELECT context->>'request_id'='20000000-0000-4000-8000-000000000001' FROM public.security_events WHERE context->>'attempt_id'='10000000-0000-4000-8000-000000000001'),'canonical event correlation');

-- CASE: Duplicate returns the original recorded reference without a second email.
SELECT fvi_failed_login_test.assert(public.failed_login_begin('10000000-0000-4000-8000-000000000001',repeat('a',64),'password','owned@example.test',NULL,'30000000-0000-4000-8000-000000000001')->>'requestId'='20000000-0000-4000-8000-000000000001','replay retains server reference');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000001',repeat('a',64),'invalid_credentials');
SELECT fvi_failed_login_test.assert((SELECT count(*)=1 FROM pgmq.q_transactional_emails),'duplicate email absent');

-- CASE: Claimed message exposes only the persisted support reference, not public payload data.
CREATE TABLE fvi_failed_login_test.claim AS SELECT public.failed_login_claim('10000000-0000-4000-8000-000000000001',(SELECT queue_message_id FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001')) value;
SELECT fvi_failed_login_test.assert((SELECT value->>'request_id'='20000000-0000-4000-8000-000000000001' FROM fvi_failed_login_test.claim),'claimed support reference');

-- CASE: JWS/JWT-shaped or key-shaped strings never become provider audit IDs.
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',(SELECT (value->>'lease_id')::uuid FROM fvi_failed_login_test.claim),'provider_accepted','YOUR_SUPABASE_KEY',NULL)$q$,'22023');
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',(SELECT (value->>'lease_id')::uuid FROM fvi_failed_login_test.claim),'provider_accepted','request:YOUR_SUPABASE_KEY',NULL)$q$,'22023');
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',(SELECT (value->>'lease_id')::uuid FROM fvi_failed_login_test.claim),'provider_accepted','sb_secret_fixture',NULL)$q$,'22023');
SELECT fvi_failed_login_test.assert((SELECT count(*)=0 FROM public.email_send_log),'bad receipt not persisted');
SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',(SELECT (value->>'lease_id')::uuid FROM fvi_failed_login_test.claim),'provider_accepted','request:req-123',NULL);
SELECT fvi_failed_login_test.assert((SELECT count(*)=1 AND bool_and(message_id='request:req-123') FROM public.email_send_log),'valid official receipt still accepted');
SELECT fvi_failed_login_test.assert((SELECT delivery_state='provider_accepted' FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'),'accepted not delivery');

-- CASE: New six-argument signature remains service-only, and request metadata is private.
SELECT fvi_failed_login_test.assert(NOT has_function_privilege('anon','public.failed_login_begin(uuid,text,text,text,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.failed_login_begin(uuid,text,text,text,uuid,uuid)','EXECUTE'),'new signature not public');
SELECT fvi_failed_login_test.assert(has_function_privilege('service_role','public.failed_login_begin(uuid,text,text,text,uuid,uuid)','EXECUTE'),'new signature trusted caller');
SELECT fvi_failed_login_test.assert(NOT has_table_privilege('authenticated','private.failed_login_attempts','SELECT'),'request metadata private');

-- CASE: Genuine app rate-control denial is retained without claiming a password mismatch.
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000002',repeat('a',64),'password','owned@example.test',NULL,'20000000-0000-4000-8000-000000000002');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000002',repeat('a',64),'rate_limited');
SELECT fvi_failed_login_test.assert((SELECT outcome='rate_limited' AND delivery_state='queued' FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000002'),'known genuine rate denial queued');
SELECT fvi_failed_login_test.assert((SELECT context->>'source'='server_authentication' AND context->>'outcome'='rate_limited' FROM public.security_events WHERE context->>'attempt_id'='10000000-0000-4000-8000-000000000002'),'truthful server control source');
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000003',repeat('a',64),'password','unknown@example.test');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000003',repeat('a',64),'rate_limited');
SELECT fvi_failed_login_test.assert((SELECT delivery_state='no_verified_recipient' FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000003'),'unknown rate denial no arbitrary recipient');
