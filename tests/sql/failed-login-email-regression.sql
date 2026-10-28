CREATE SCHEMA fvi_failed_login_test;
CREATE FUNCTION fvi_failed_login_test.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed-login case failed: %',label; END IF; END $$;
CREATE FUNCTION fvi_failed_login_test.denied(sql text,code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=code THEN RETURN; ELSE RAISE; END IF; END; RAISE EXCEPTION 'Expected denial'; END $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owned@example.test',now()),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','unverified@example.test',NULL);
INSERT INTO public.email_send_log(template_name,recipient_email,status,message_id) VALUES('prior.fixture','retained@example.test','sent','prior-message');
INSERT INTO public.security_events(event_type,context) VALUES('prior.fixture','{"retained":true}');
CREATE TABLE fvi_failed_login_test.original_hashes AS SELECT (SELECT md5(string_agg(to_jsonb(l)::text,'' ORDER BY id)) FROM public.email_send_log l) mail_hash,(SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY id)) FROM public.security_events s) security_hash,(SELECT md5(string_agg(to_jsonb(u)::text,'' ORDER BY id)) FROM auth.users u) auth_hash;

-- CASE: Verified existing account provider mismatch queued, no session mutation.
SELECT fvi_failed_login_test.assert((public.failed_login_begin('10000000-0000-4000-8000-000000000001',repeat('a',64),'password','owned@example.test')->>'acquired')::boolean,'first acquisition');
SELECT fvi_failed_login_test.assert((SELECT request_id IS NOT NULL AND request_id<>id FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'),'server support correlation is separate');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000001',repeat('a',64),'invalid_credentials');
SELECT fvi_failed_login_test.assert((SELECT delivery_state='queued' AND outcome='invalid_credentials' FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'),'failure queued');
SELECT fvi_failed_login_test.assert((SELECT count(*)=1 FROM pgmq.q_transactional_emails),'one queue event');
SELECT fvi_failed_login_test.assert((SELECT message=jsonb_build_object('template','auth.failed_login.verified','attempt_id','10000000-0000-4000-8000-000000000001') FROM pgmq.q_transactional_emails LIMIT 1),'payload contains no recipient or secrets');

-- CASE: Duplicate capture/finish idempotent; every distinct failure retained.
SELECT fvi_failed_login_test.assert(NOT(public.failed_login_begin('10000000-0000-4000-8000-000000000001',repeat('a',64),'password','owned@example.test')->>'acquired')::boolean,'duplicate not acquired');
SELECT fvi_failed_login_test.assert((public.failed_login_begin('10000000-0000-4000-8000-000000000001',repeat('a',64),'password','owned@example.test')->>'requestId')::uuid=(SELECT request_id FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'),'duplicate returns persisted support reference');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000001',repeat('a',64),'invalid_credentials');
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000002',repeat('a',64),'password','owned@example.test');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000002',repeat('a',64),'invalid_credentials');
SELECT fvi_failed_login_test.assert((SELECT count(*)=2 FROM pgmq.q_transactional_emails),'distinct not per-email dropped');
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000001',repeat('a',64),'success')$q$,'22023');
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000001',repeat('b',64),'password','other@example.test')$q$,'22023');

-- CASE: Correct login no failure event/mail.
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000003',repeat('a',64),'password','owned@example.test');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000003',repeat('a',64),'success');
SELECT fvi_failed_login_test.assert((SELECT count(*)=2 FROM pgmq.q_transactional_emails),'success no queue');

-- CASE: Nonexistent and unverified recipients recorded without arbitrary mail.
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000004',repeat('a',64),'password','nonexistent@example.test');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000004',repeat('a',64),'invalid_credentials');
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000005',repeat('a',64),'password','unverified@example.test');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000005',repeat('a',64),'verification_failed');
SELECT fvi_failed_login_test.assert((SELECT count(*)=2 FROM private.failed_login_attempts WHERE delivery_state='no_verified_recipient'),'both no recipient');
SELECT fvi_failed_login_test.assert((SELECT count(*)=2 FROM pgmq.q_transactional_emails),'no arbitrary sends');

-- CASE: Browser security event cannot cause queue email.
INSERT INTO public.security_events(event_type,user_id,context) VALUES('auth.failed_login','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"email":"attacker@example.test","outcome":"invalid_credentials"}');
SELECT fvi_failed_login_test.assert((SELECT count(*)=2 FROM pgmq.q_transactional_emails),'browser spoof ignored');

-- CASE: MFA and conditional policy are truthful, separate trusted stages.
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000006',repeat('a',64),'mfa',NULL,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000006',repeat('a',64),'mfa_expired');
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000007',repeat('a',64),'policy',NULL,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000007',repeat('a',64),'policy_blocked');
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000002',repeat('a',64),'mfa_invalid')$q$,'22023');

-- CASE: Queue outage retains failure and recovers without replaying auth.
BEGIN;
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text,payload jsonb) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Native queue outage'; END $$;
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000008',repeat('a',64),'password','owned@example.test');
SELECT public.failed_login_finish('10000000-0000-4000-8000-000000000008',repeat('a',64),'provider_unavailable');
SELECT fvi_failed_login_test.assert((SELECT outcome='provider_unavailable' AND delivery_state='recorded' AND diagnostic_code='queue_unavailable' FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000008'),'outage retained');
ROLLBACK;
SELECT public.failed_login_begin('10000000-0000-4000-8000-000000000008',repeat('a',64),'password','owned@example.test');
UPDATE private.failed_login_attempts SET outcome='provider_unavailable',finished_at=now(),delivery_state='recorded' WHERE id='10000000-0000-4000-8000-000000000008';
SELECT fvi_failed_login_test.assert(public.failed_login_requeue_recorded()=1,'outage recovery queues one');
SELECT fvi_failed_login_test.assert(public.failed_login_requeue_recorded()=0,'outage recovery replay empty');

-- CASE: Claim enforces exact queue attribution and current verified recipient.
SELECT fvi_failed_login_test.assert(NOT(public.failed_login_claim('10000000-0000-4000-8000-000000000001',999999)->>'send')::boolean,'forged queue denied');
CREATE TABLE fvi_failed_login_test.claim AS SELECT public.failed_login_claim('10000000-0000-4000-8000-000000000001',(SELECT queue_message_id FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001')) value;
SELECT fvi_failed_login_test.assert((SELECT (value->>'send')::boolean AND value->>'to'='owned@example.test' FROM fvi_failed_login_test.claim),'authoritative destination');
SELECT fvi_failed_login_test.assert(NOT(public.failed_login_claim('10000000-0000-4000-8000-000000000001',(SELECT queue_message_id FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'))->>'send')::boolean,'concurrent duplicate no send');

-- CASE: Acceptance receipt idempotent and provider acceptance is not delivery.
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',gen_random_uuid(),'provider_accepted','YOUR_SUPABASE_KEY',NULL)$q$,'22023');
SELECT fvi_failed_login_test.denied($q$SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',gen_random_uuid(),'provider_accepted','sb_secret_fixture',NULL)$q$,'22023');
SELECT fvi_failed_login_test.assert(NOT public.failed_login_settle('10000000-0000-4000-8000-000000000001',gen_random_uuid(),'provider_accepted','receipt-1',NULL),'wrong lease denied');
SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',(SELECT (value->>'lease_id')::uuid FROM fvi_failed_login_test.claim),'provider_accepted','receipt-1',NULL);
SELECT public.failed_login_settle('10000000-0000-4000-8000-000000000001',(SELECT (value->>'lease_id')::uuid FROM fvi_failed_login_test.claim),'provider_accepted','receipt-1',NULL);
SELECT fvi_failed_login_test.assert((SELECT count(*)=1 FROM public.email_send_log WHERE message_id='receipt-1'),'one acceptance log');
SELECT fvi_failed_login_test.assert((SELECT delivery_state='provider_accepted' FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000001'),'not delivered by acceptance');
SELECT fvi_failed_login_test.assert(NOT public.failed_login_delivery_receipt('10000000-0000-4000-8000-000000000001','wrong-receipt','delivered'),'unmatched delivery ignored');
SELECT fvi_failed_login_test.assert(public.failed_login_delivery_receipt('10000000-0000-4000-8000-000000000001','receipt-1','delivered'),'trusted matching delivery');
SELECT fvi_failed_login_test.assert(public.failed_login_delivery_receipt('10000000-0000-4000-8000-000000000001','receipt-1','delivered'),'duplicate delivery idempotent');
SELECT fvi_failed_login_test.assert(NOT public.failed_login_delivery_receipt('10000000-0000-4000-8000-000000000001','receipt-1','bounced'),'terminal delivery conflict refused');

-- CASE: Definite provider rejection retries one alert with new lease.
DO $$ DECLARE a private.failed_login_attempts; c jsonb; BEGIN
  SELECT * INTO a FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000002';
  c:=public.failed_login_claim(a.id,a.queue_message_id);
  PERFORM public.failed_login_settle(a.id,(c->>'lease_id')::uuid,'retry',NULL,'provider_rate_limited');
  c:=public.failed_login_claim(a.id,a.queue_message_id);
  PERFORM fvi_failed_login_test.assert((c->>'send')::boolean,'retry sends same attempt');
  PERFORM public.failed_login_settle(a.id,(c->>'lease_id')::uuid,'uncertain',NULL,'provider_timeout');
  PERFORM fvi_failed_login_test.assert(NOT(public.failed_login_claim(a.id,a.queue_message_id)->>'send')::boolean,'uncertain not retried');
  PERFORM fvi_failed_login_test.assert(NOT public.failed_login_settle(a.id,(c->>'lease_id')::uuid,'retry',NULL,'provider_rejected'),'cannot turn uncertain into automatic retry');
END $$;

-- CASE: Expired send lease becomes visible uncertainty, no duplicate dispatch.
DO $$ DECLARE a private.failed_login_attempts; c jsonb; BEGIN
  SELECT * INTO a FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000006';
  c:=public.failed_login_claim(a.id,a.queue_message_id);
  UPDATE private.failed_login_attempts SET dispatch_started_at=now()-interval '10 minutes' WHERE id=a.id;
  PERFORM fvi_failed_login_test.assert(NOT(public.failed_login_claim(a.id,a.queue_message_id)->>'send')::boolean,'expired lease not resent');
  PERFORM fvi_failed_login_test.assert((SELECT delivery_state='uncertain' FROM private.failed_login_attempts WHERE id=a.id),'interrupted send visible');
END $$;

-- CASE: Changed authoritative email never becomes mail to an unverified address.
BEGIN;
UPDATE auth.users SET email='changed@example.test',email_confirmed_at=NULL WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT fvi_failed_login_test.assert(NOT(public.failed_login_claim('10000000-0000-4000-8000-000000000007',(SELECT queue_message_id FROM private.failed_login_attempts WHERE id='10000000-0000-4000-8000-000000000007'))->>'send')::boolean,'changed address refused');
ROLLBACK;

-- CASE: Nonprivileged users cannot invoke directory/queue/delivery functions.
SELECT fvi_failed_login_test.assert(NOT has_function_privilege('anon','public.failed_login_begin(uuid,text,text,text,uuid,uuid)','EXECUTE'),'anon begin denied');
SELECT fvi_failed_login_test.assert(NOT has_function_privilege('authenticated','public.failed_login_claim(uuid,bigint)','EXECUTE'),'authenticated claim denied');
SELECT fvi_failed_login_test.assert(NOT has_function_privilege('authenticated','public.failed_login_delivery_receipt(uuid,text,text)','EXECUTE'),'forged browser delivery denied');
SELECT fvi_failed_login_test.assert(has_function_privilege('service_role','public.failed_login_finish(uuid,text,text)','EXECUTE'),'trusted finish allowed');
SELECT fvi_failed_login_test.assert(NOT has_table_privilege('authenticated','private.failed_login_attempts','SELECT'),'private directory hidden');
SELECT fvi_failed_login_test.assert(NOT has_table_privilege('service_role','private.failed_login_attempts','UPDATE'),'direct state edit hidden');
GRANT USAGE ON SCHEMA fvi_failed_login_test TO anon,authenticated;
GRANT EXECUTE ON FUNCTION fvi_failed_login_test.denied(text,text) TO anon,authenticated;
SET ROLE anon;
SELECT fvi_failed_login_test.denied('SELECT public.failed_login_requeue_recorded()','42501');
RESET ROLE;
SET ROLE authenticated;
SELECT fvi_failed_login_test.denied('SELECT public.failed_login_claim(gen_random_uuid(),1)','42501');
SELECT fvi_failed_login_test.denied('SELECT * FROM private.failed_login_attempts','42501');
RESET ROLE;

-- CASE: Existing auth and prior audit/mail rows unchanged.
SELECT fvi_failed_login_test.assert((SELECT auth_hash FROM fvi_failed_login_test.original_hashes)=(SELECT md5(string_agg(to_jsonb(u)::text,'' ORDER BY id)) FROM auth.users u),'auth identities unchanged');
SELECT fvi_failed_login_test.assert((SELECT mail_hash FROM fvi_failed_login_test.original_hashes)=(SELECT md5(string_agg(to_jsonb(l)::text,'' ORDER BY id)) FROM public.email_send_log l WHERE template_name='prior.fixture'),'prior mail unchanged');
SELECT fvi_failed_login_test.assert((SELECT security_hash FROM fvi_failed_login_test.original_hashes)=(SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY id)) FROM public.security_events s WHERE event_type='prior.fixture'),'prior audit unchanged');
