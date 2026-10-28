-- Disposable database only, after 20260925090000. No hosted execution.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at) VALUES
 ('f4500000-0000-4000-8000-000000000001','platform@fvi-fixture.invalid',now(),now(),now()),
 ('f4500000-0000-4000-8000-000000000002','admin@bank-fixture.invalid',now(),now(),now()),
 ('f4500000-0000-4000-8000-000000000003','applicant@bank-fixture.invalid',NULL,now(),now()),
 ('f4500000-0000-4000-8000-000000000004','other-admin@other-fixture.invalid',now(),now(),now()),
 ('f4500000-0000-4000-8000-000000000005','unmatched@unknown-fixture.invalid',now(),now(),now()),
 ('f4500000-0000-4000-8000-000000000006','inactive@bank-fixture.invalid',now(),now(),now());
INSERT INTO public.platform_roles(user_id,role) VALUES
 ('f4500000-0000-4000-8000-000000000001','platform_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('f4500000-0000-4000-8000-000000000011','Bank fixture','f4500000-0000-4000-8000-000000000012','Bank fixture'),
 ('f4500000-0000-4000-8000-000000000013','Other fixture','f4500000-0000-4000-8000-000000000014','Other fixture');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := public.create_tenant_with_email_domain(
    'f4500000-0000-4000-8000-000000000011','bank-domain-fixture','Bank fixture','prod',false,'bank-fixture.invalid');
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant creation failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=v_tenant
                 AND m.user_id='f4500000-0000-4000-8000-000000000001'
                 AND m.active AND m.role='tenant_admin') THEN
    RAISE EXCEPTION 'creator admin was not atomically persisted';
  END IF;
  BEGIN
    PERFORM public.create_tenant_with_email_domain(
      'f4500000-0000-4000-8000-000000000013','duplicate-domain-fixture','Other fixture','prod',false,'BANK-FIXTURE.INVALID');
    RAISE EXCEPTION 'duplicate domain allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug='duplicate-domain-fixture') THEN
    RAISE EXCEPTION 'duplicate-domain transaction left an orphan tenant';
  END IF;
END $test$;
RESET ROLE;

INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4500000-0000-4000-8000-000000000015','f4500000-0000-4000-8000-000000000013','other-domain-fixture','Other fixture','dev');
INSERT INTO public.tenant_email_domains(tenant_id,domain,status,verified_at)
VALUES ('f4500000-0000-4000-8000-000000000015','other-fixture.invalid','verified',now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4500000-0000-4000-8000-000000000015','f4500000-0000-4000-8000-000000000004','tenant_admin',true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000003',true);
SELECT public.request_tenant_admission();
RESET ROLE;
DO $test$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'unverified identity queued'; END IF;
END $test$;

UPDATE auth.users SET email_confirmed_at=now() WHERE id='f4500000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000003',true);
SELECT public.request_tenant_admission();
RESET ROLE;
DO $test$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'unverified domain queued'; END IF;
END $test$;

UPDATE public.tenant_email_domains SET status='verified',verified_at=now()
 WHERE domain='bank-fixture.invalid';
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ((SELECT id FROM public.tenants WHERE slug='bank-domain-fixture'),'f4500000-0000-4000-8000-000000000002','tenant_admin',true);
DO $test$ DECLARE v_tenant uuid := (SELECT id FROM public.tenants WHERE slug='bank-domain-fixture');
BEGIN
  BEGIN
    INSERT INTO public.tenant_members(tenant_id,user_id,role)
    VALUES (v_tenant,'f4500000-0000-4000-8000-000000000005','tenant_viewer');
    RAISE EXCEPTION 'cross domain membership allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000003',true);
SELECT public.request_tenant_admission();
SELECT public.request_tenant_admission();
RESET ROLE;
DO $test$ BEGIN
  IF (SELECT count(*) FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003') <> 1
    OR EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id='f4500000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'queue duplicate or premature membership'; END IF;
  IF (SELECT count(*) FROM public.tenant_signup_events WHERE event_name='signup.admission_requested') <> 1 THEN
    RAISE EXCEPTION 'request event missing or duplicated'; END IF;
END $test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000004',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.decide_tenant_admission(
      (SELECT tenant_id FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003'),
      (SELECT id FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003'),'approved');
    RAISE EXCEPTION 'cross tenant admin approved';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000003',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.decide_tenant_admission(
      (SELECT tenant_id FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003'),
      (SELECT id FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003'),'approved');
    RAISE EXCEPTION 'self approval succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000002',true);
SELECT public.decide_tenant_admission(
  (SELECT tenant_id FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003'),
  (SELECT id FROM public.tenant_signup_requests WHERE user_id='f4500000-0000-4000-8000-000000000003'),'approved');
RESET ROLE;
DO $test$ BEGIN
  IF (SELECT count(*) FROM public.tenant_members WHERE user_id='f4500000-0000-4000-8000-000000000003'
      AND role='tenant_viewer' AND active) <> 1 THEN RAISE EXCEPTION 'approved viewer membership missing'; END IF;
  IF (SELECT count(*) FROM public.tenant_signup_events WHERE event_name='signup.admission_approved') <> 1 THEN
    RAISE EXCEPTION 'approval event missing'; END IF;
END $test$;

DO $test$ DECLARE v_tenant uuid := (SELECT id FROM public.tenants WHERE slug='bank-domain-fixture');
BEGIN
  -- Even privileged Auth email edits cannot silently retain mismatched access.
  BEGIN
    UPDATE auth.users SET email='applicant@other-fixture.invalid'
      WHERE id='f4500000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'cross-domain Auth email change retained membership';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.tenant_email_domains SET status='suspended',verified_at=NULL
      WHERE tenant_id=v_tenant;
    RAISE EXCEPTION 'verified domain suspended with active members';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.tenants(family_id,slug,name,environment)
    VALUES ('f4500000-0000-4000-8000-000000000013','domainless-after-cutover','Domainless','uat');
    SET CONSTRAINTS tenant_requires_email_domain IMMEDIATE;
    RAISE EXCEPTION 'domainless tenant committed after cutover';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;

INSERT INTO public.tenant_signup_requests(id,tenant_id,user_id,email)
VALUES ('f4500000-0000-4000-8000-000000000061',
        (SELECT id FROM public.tenants WHERE slug='bank-domain-fixture'),
        'f4500000-0000-4000-8000-000000000006','inactive@bank-fixture.invalid');
INSERT INTO public.tenant_members(tenant_id,user_id,role,active)
VALUES ((SELECT id FROM public.tenants WHERE slug='bank-domain-fixture'),
        'f4500000-0000-4000-8000-000000000006','tenant_viewer',false);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4500000-0000-4000-8000-000000000002',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.decide_tenant_admission(
      (SELECT id FROM public.tenants WHERE slug='bank-domain-fixture'),
      'f4500000-0000-4000-8000-000000000061','approved');
    RAISE EXCEPTION 'inactive membership was approved';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
  IF (SELECT status FROM public.tenant_signup_requests
      WHERE id='f4500000-0000-4000-8000-000000000061') <> 'pending'
     OR EXISTS (SELECT 1 FROM public.tenant_signup_events
                WHERE request_id='f4500000-0000-4000-8000-000000000061') THEN
    RAISE EXCEPTION 'failed approval changed request or emitted event';
  END IF;
END $test$;
ROLLBACK;
