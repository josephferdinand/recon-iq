-- Disposable database only, after 20260925091000.
BEGIN;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4510000-0000-4000-8000-000000000001','outbox@fixture.invalid',now(),now());
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f4510000-0000-4000-8000-000000000011','Outbox fixture',
        'f4510000-0000-4000-8000-000000000012','Outbox fixture');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('f4510000-0000-4000-8000-000000000013','f4510000-0000-4000-8000-000000000011',
        'signup-outbox-fixture','Outbox fixture','dev');
INSERT INTO public.tenant_email_domains(tenant_id,domain,status,verified_at)
VALUES ('f4510000-0000-4000-8000-000000000013','fixture.invalid','verified',now());
INSERT INTO public.tenant_signup_requests(id,tenant_id,user_id,email)
VALUES ('f4510000-0000-4000-8000-000000000021','f4510000-0000-4000-8000-000000000013',
        'f4510000-0000-4000-8000-000000000001','outbox@fixture.invalid');
INSERT INTO public.tenant_signup_events(id,request_id,tenant_id,user_id,event_name)
VALUES ('f4510000-0000-4000-8000-000000000031','f4510000-0000-4000-8000-000000000021',
        'f4510000-0000-4000-8000-000000000013','f4510000-0000-4000-8000-000000000001',
        'signup.admission_requested');

DO $test$ BEGIN
  IF has_function_privilege('authenticated','public.claim_tenant_signup_events(integer,integer)','EXECUTE')
     OR has_function_privilege('anon','public.ack_tenant_signup_event(uuid,uuid,text)','EXECUTE')
     OR has_table_privilege('authenticated','public.tenant_signup_events','SELECT') THEN
    RAISE EXCEPTION 'outbox client privilege leak';
  END IF;
END $test$;

SET LOCAL ROLE service_role;
DO $test$
DECLARE v_claim record; v_retry record; v_second record; v_old_token uuid; v_event uuid := 'f4510000-0000-4000-8000-000000000031';
BEGIN
  SELECT * INTO v_claim FROM public.claim_tenant_signup_events(1,120);
  IF v_claim.event_id IS DISTINCT FROM v_event OR v_claim.attempt_count <> 1
     OR v_claim.idempotency_key <> 'fvi-signup-'||v_event::text THEN
    RAISE EXCEPTION 'first claim shape or idempotency key incorrect';
  END IF;
  v_old_token := v_claim.lease_token;
  IF EXISTS (SELECT 1 FROM public.claim_tenant_signup_events(1,120)) THEN
    RAISE EXCEPTION 'leased event was claimed twice';
  END IF;
  IF public.ack_tenant_signup_event(v_event,NULL,'provider-1')
     OR public.ack_tenant_signup_event(v_event,gen_random_uuid(),'provider-1') THEN
    RAISE EXCEPTION 'ack accepted missing or wrong lease';
  END IF;
  IF public.fail_tenant_signup_event(v_event,v_old_token,'provider_timeout',30)<>'retry_scheduled' THEN
    RAISE EXCEPTION 'retry not scheduled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_tenant_signup_events(1,120)) THEN
    RAISE EXCEPTION 'backoff was bypassed';
  END IF;
  UPDATE public.tenant_signup_events SET next_attempt_at=now()-interval '1 second' WHERE id=v_event;
  SELECT * INTO v_retry FROM public.claim_tenant_signup_events(1,120);
  IF v_retry.event_id IS DISTINCT FROM v_event OR v_retry.lease_token=v_old_token
     OR v_retry.attempt_count<>2 OR v_retry.idempotency_key<>v_claim.idempotency_key THEN
    RAISE EXCEPTION 'reclaim identity, token, or attempt count incorrect';
  END IF;
  IF public.ack_tenant_signup_event(v_event,v_old_token,'provider-1') THEN
    RAISE EXCEPTION 'stale lease ack succeeded';
  END IF;
  IF NOT public.ack_tenant_signup_event(v_event,v_retry.lease_token,'provider-1')
     OR NOT public.ack_tenant_signup_event(v_event,v_retry.lease_token,'provider-1')
     OR public.ack_tenant_signup_event(v_event,v_retry.lease_token,'provider-2') THEN
    RAISE EXCEPTION 'ack idempotency or correlation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_tenant_signup_events(1,120)) THEN
    RAISE EXCEPTION 'accepted event was reclaimed';
  END IF;

  INSERT INTO public.tenant_signup_events(id,request_id,tenant_id,user_id,event_name,attempt_count)
  VALUES ('f4510000-0000-4000-8000-000000000032','f4510000-0000-4000-8000-000000000021',
          'f4510000-0000-4000-8000-000000000013','f4510000-0000-4000-8000-000000000001',
          'signup.admission_denied',7);
  SELECT * INTO v_second FROM public.claim_tenant_signup_events(1,120);
  IF v_second.attempt_count<>8 OR public.fail_tenant_signup_event(v_second.event_id,v_second.lease_token,
     'provider_rejected')<>'dead_lettered' THEN
    RAISE EXCEPTION 'dead letter threshold failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_tenant_signup_events(1,120)) THEN
    RAISE EXCEPTION 'dead letter reclaimed';
  END IF;
  IF NOT public.requeue_tenant_signup_event(v_second.event_id) THEN
    RAISE EXCEPTION 'dead letter recovery failed';
  END IF;
  SELECT * INTO v_second FROM public.claim_tenant_signup_events(1,120);
  IF v_second.attempt_count<>1 THEN RAISE EXCEPTION 'requeue did not reset attempts'; END IF;
END $test$;
RESET ROLE;
ROLLBACK;
