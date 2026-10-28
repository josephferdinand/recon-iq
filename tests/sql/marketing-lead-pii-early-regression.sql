-- Disposable PostgreSQL only; all synthetic fixtures roll back.
-- Run with psql -v hardened=0 before the early migration to reproduce the bug,
-- then -v hardened=1 after it to prove the same direct-role paths are closed.
-- hardened=2 tests emergency containment (all human reads denied).
BEGIN;
SELECT set_config('test.mkt_hardened', :'hardened', true);

INSERT INTO auth.users(id, email, created_at, updated_at)
SELECT ('e9020000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'mkt-early-' || n || '@example.invalid', now(), now()
FROM generate_series(1, 9) n;
INSERT INTO public.mkt_admin_users(user_id, status)
SELECT ('e9020000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'active'
FROM generate_series(1, 6) n;
INSERT INTO public.mkt_admin_users(user_id,status)
VALUES ('e9020000-0000-4000-8000-000000000008','inactive');
INSERT INTO public.mkt_admin_roles(user_id, role)
SELECT ('e9020000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (ARRAY['super_admin','sales_admin','marketing_admin','ai_admin',
              'brand_reviewer','brand_publisher'])[n]::public.mkt_admin_role
FROM generate_series(1, 6) n;
INSERT INTO public.mkt_admin_roles(user_id,role) VALUES
  ('e9020000-0000-4000-8000-000000000008','sales_admin'),
  ('e9020000-0000-4000-8000-000000000009','super_admin');

-- Exercise the real intake database principal, not postgres, for every fixture.
SET LOCAL ROLE service_role;
INSERT INTO public.mkt_leads(id,first_name,last_name,email,company,message)
VALUES ('e9020000-0000-4000-8000-000000000101','Synthetic','Lead',
        'pii-early@example.invalid','Synthetic QA','Synthetic private request');
INSERT INTO public.mkt_lead_files(id,lead_id,storage_path,filename)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','synthetic/private','private.txt');
INSERT INTO public.mkt_lead_notes(id,lead_id,body)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','Synthetic private note');
INSERT INTO public.mkt_lead_tasks(id,lead_id,title)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','Synthetic private task');
INSERT INTO public.mkt_lead_activity(id,lead_id,action,details)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','synthetic', '{"private":"synthetic"}');
INSERT INTO public.mkt_appointments(id,lead_id,type_id,start_at,end_at,attendee_email)
SELECT 'e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101',id,
       now() + interval '1 day',now() + interval '25 hours','pii-early@example.invalid'
FROM public.mkt_appointment_types WHERE slug='product_demo';
INSERT INTO public.mkt_chat_sessions(id,lead_id,metadata)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','{"private":"synthetic"}');
INSERT INTO public.mkt_chat_messages(id,session_id,role,content)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','user','Synthetic private text');
INSERT INTO public.mkt_kb_queries(id,session_id,query)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','Synthetic private question');
INSERT INTO public.mkt_llm_usage(id,session_id,error_code)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','synthetic');
INSERT INTO public.mkt_cta_events(id,lead_id,event_type,cta_id,ip,meta)
VALUES ('e9020000-0000-4000-8000-000000000101','e9020000-0000-4000-8000-000000000101','form_submit','synthetic','192.0.2.1','{"private":"synthetic"}');
INSERT INTO public.mkt_content_audit_log(entity_type,entity_key,action,before,after,summary)
SELECT entity_type,'early-pii-synthetic','update',
       '{"first_name":"Private synthetic name"}',
       '{"body":"Private synthetic note"}','Private synthetic company'
FROM unnest(ARRAY['lead','lead_note','lead_task','appointment','chat_session','future_unknown']) entity_type;
INSERT INTO public.mkt_content_audit_log(entity_type,entity_key,action,summary)
VALUES ('llm_provider','early-pii-config-synthetic','update','Synthetic configuration update');
RESET ROLE;

CREATE FUNCTION public._test_mkt_early_assert_pii_rows(expected integer) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE target text; actual integer;
        actor_suffix integer := NULLIF(right(auth.uid()::text,2),'')::integer;
        audit_allowed boolean := current_user='service_role' OR actor_suffix IN (1,2,3,4,8,9);
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'mkt_leads','mkt_lead_files','mkt_lead_notes','mkt_lead_tasks',
    'mkt_lead_activity','mkt_appointments','mkt_chat_sessions',
    'mkt_chat_messages','mkt_kb_queries','mkt_llm_usage','mkt_cta_events'
  ] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id = %L', target,
        'e9020000-0000-4000-8000-000000000101') INTO actual;
    EXCEPTION WHEN insufficient_privilege THEN
      IF current_user <> 'anon' THEN RAISE; END IF;
      actual := 0;
    END;
    IF actual <> expected THEN
      RAISE EXCEPTION 'PII role assertion failed role=% actor=% table=% expected=% actual=%',
        current_user, auth.uid(), target, expected, actual;
    END IF;
  END LOOP;
  BEGIN
    SELECT count(*) INTO actual FROM public.mkt_content_audit_log
    WHERE entity_key='early-pii-synthetic'
      AND before->>'first_name'='Private synthetic name'
      AND after->>'body'='Private synthetic note'
      AND summary='Private synthetic company';
  EXCEPTION WHEN insufficient_privilege THEN
    IF current_user <> 'anon' THEN RAISE; END IF;
    actual := 0;
  END;
  IF actual <> (CASE WHEN expected=1 AND audit_allowed THEN 6 ELSE 0 END) THEN
    RAISE EXCEPTION 'Indirect audit PII exposure/access regression actor=% actual=%',auth.uid(),actual;
  END IF;
  BEGIN
    SELECT count(*) INTO actual FROM public.mkt_content_audit_log
    WHERE entity_key='early-pii-config-synthetic';
  EXCEPTION WHEN insufficient_privilege THEN
    IF current_user <> 'anon' THEN RAISE; END IF;
    actual := 0;
  END;
  IF actual <> (CASE WHEN audit_allowed THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'Existing configuration audit access changed actor=% actual=%',auth.uid(),actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public._test_mkt_early_assert_pii_rows(integer) TO anon, authenticated, service_role;

DO $matrix$
DECLARE actor integer; mode text := current_setting('test.mkt_hardened');
BEGIN
  FOR actor IN 1..9 LOOP
    PERFORM set_config('request.jwt.claim.sub',
      'e9020000-0000-4000-8000-' || lpad(actor::text,12,'0'),true);
    SET LOCAL ROLE authenticated;
    PERFORM public._test_mkt_early_assert_pii_rows(CASE
      WHEN mode='1' AND actor <= 3 THEN 1
      WHEN mode='0' AND actor <> 7 THEN 1 ELSE 0 END);
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'PASS: 99 authenticated direct-read assertions (mode=%)', mode;
END
$matrix$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT public._test_mkt_early_assert_pii_rows(0);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public._test_mkt_early_assert_pii_rows(0);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public._test_mkt_early_assert_pii_rows(1);
RESET ROLE;

-- AI writes previously authorized by child FOR ALL policies must also stop.
DO $writes$
DECLARE blocked boolean := false; changed integer;
BEGIN
  IF current_setting('test.mkt_hardened') = '0' THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub','e9020000-0000-4000-8000-000000000004',true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.mkt_lead_notes(lead_id,body)
    VALUES ('e9020000-0000-4000-8000-000000000101','must fail');
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'AI note insert permitted'; END IF;
  UPDATE public.mkt_lead_notes SET body='must not change'
  WHERE id='e9020000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'AI note update permitted'; END IF;
  DELETE FROM public.mkt_lead_files WHERE id='e9020000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'AI file delete permitted'; END IF;
  RESET ROLE;
END
$writes$;

-- Human queue readers retain read access, without acquiring lead-write rights.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e9020000-0000-4000-8000-000000000003',true);
DO $marketing_write$
DECLARE changed integer;
BEGIN
  UPDATE public.mkt_leads SET message='must not change'
  WHERE id='e9020000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Marketing reader acquired lead-write rights'; END IF;
END
$marketing_write$;
SELECT set_config('request.jwt.claim.sub','e9020000-0000-4000-8000-000000000002',true);
DO $sales_write$
DECLARE changed integer;
BEGIN
  UPDATE public.mkt_leads SET message='Authorized synthetic update'
  WHERE id='e9020000-0000-4000-8000-000000000101';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> (CASE WHEN current_setting('test.mkt_hardened')='2' THEN 0 ELSE 1 END)
    THEN RAISE EXCEPTION 'Unexpected sales write access'; END IF;
END
$sales_write$;
RESET ROLE;

DO $shape$
DECLARE actual integer;
BEGIN
  SELECT count(*) INTO actual FROM pg_policies
  WHERE schemaname='public' AND policyname='mkt_pii_human_role_boundary'
    AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles=ARRAY['authenticated']::name[];
  IF actual <> (CASE WHEN current_setting('test.mkt_hardened')='0' THEN 0 ELSE 11 END) THEN
    RAISE EXCEPTION 'Unexpected restrictive policy count %', actual;
  END IF;
  SELECT count(*) INTO actual FROM pg_policies
  WHERE schemaname='public' AND tablename='mkt_content_audit_log'
    AND policyname='mkt_lead_pii_audit_boundary' AND permissive='RESTRICTIVE'
    AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[];
  IF actual <> (CASE WHEN current_setting('test.mkt_hardened')='0' THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'Unexpected audit boundary count %',actual;
  END IF;
END
$shape$;
ROLLBACK;
\echo marketing_lead_pii_early_regression_PASS hardened=:hardened
