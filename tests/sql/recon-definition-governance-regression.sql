-- Disposable PostgreSQL only. Never point this test at a hosted database.
BEGIN;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('f4400000-0000-4000-8000-000000000001','Governance Test','f4400000-0000-4000-8000-000000000002','Governance Test'),
 ('f4400000-0000-4000-8000-000000000005','Governance Other','f4400000-0000-4000-8000-000000000006','Governance Other');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000001','recon-governance','Recon Governance','dev'),
 ('f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000005','recon-governance-other','Recon Governance Other','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4400000-0000-4000-8000-000000000011','maker@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000012','checker@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000013','analyst@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000014','inactive-admin@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000015','other-admin@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000012','tenant_admin',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000013','tenant_analyst',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000014','tenant_admin',false),
 ('f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000015','tenant_admin',true);

-- New definitions are unmapped development drafts, not imported approvals.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status,created_by)
VALUES ('f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000003','Draft Alpha','two_sided','[]','[]','draft',
  'f4400000-0000-4000-8000-000000000011');
DO $test$
BEGIN
  BEGIN
    UPDATE public.recon_definitions SET governance_state='approved_locked'
      WHERE id='f4400000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'direct governance-state promotion unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.recon_definitions SET environment='production'
      WHERE id='f4400000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'direct environment promotion unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','running','f4400000-0000-4000-8000-000000000011');
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','running',
      'f4400000-0000-4000-8000-000000000013');
    RAISE EXCEPTION 'unmapped development analyst run unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '23514' THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recon_runs WHERE definition_id='f4400000-0000-4000-8000-000000000021'
    AND definition_snapshot->>'governance_state'='development_draft') THEN
    RAISE EXCEPTION 'new development run did not retain governance evidence';
  END IF;
  BEGIN
    INSERT INTO public.recon_runs(tenant_id,definition_id,status)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','queued');
    RAISE EXCEPTION 'actorless governed run unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '23514' THEN NULL; END;
END $test$;
DO $test$ BEGIN RAISE NOTICE 'recon-governance gate: initial draft/admin run'; END $test$;

SELECT set_config('fvi.test.promotion_request_id',
  public.submit_recon_definition_promotion('f4400000-0000-4000-8000-000000000003',
    'f4400000-0000-4000-8000-000000000021','Initial production release review')::text,true);
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $test$ BEGIN
  IF EXISTS (SELECT 1 FROM public.recon_definition_governance_requests
      WHERE id=current_setting('fvi.test.promotion_request_id')::uuid) THEN
    RAISE EXCEPTION 'non-admin actor read a frozen promotion snapshot';
  END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $test$
BEGIN
  BEGIN
    UPDATE public.recon_definitions SET rules='[{"id":"forged"}]'
      WHERE id='f4400000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'pending promotion was editable';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.decide_recon_definition_promotion(
      current_setting('fvi.test.promotion_request_id')::uuid,true,'Self approval attempt');
    RAISE EXCEPTION 'maker self-approval unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '23514' THEN NULL; END;
END $test$;
DO $test$ BEGIN RAISE NOTICE 'recon-governance gate: initial approval'; END $test$;

SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
SELECT public.decide_recon_definition_promotion(
  current_setting('fvi.test.promotion_request_id')::uuid,true,'Independent tenant-admin approval');
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000021'
    AND governance_state='approved_locked' AND environment='production' AND status='active') THEN
    RAISE EXCEPTION 'checker approval did not lock the production parent';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_approved_versions
      WHERE parent_definition_id='f4400000-0000-4000-8000-000000000021')<>1 THEN
    RAISE EXCEPTION 'initial approval version is missing';
  END IF;
  BEGIN
    UPDATE public.recon_definitions SET name='Direct mutation'
      WHERE id='f4400000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'approved parent was editable';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;

-- Production run is intentionally admin-only until multi-BU Access is authoritative.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','running','f4400000-0000-4000-8000-000000000013');
    RAISE EXCEPTION 'non-admin production run unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','running','f4400000-0000-4000-8000-000000000011');

-- Request edit -> isolated staging copy -> frozen promotion -> version 2.
SELECT set_config('fvi.test.edit_request_id',
  public.request_recon_definition_edit('f4400000-0000-4000-8000-000000000003',
    'f4400000-0000-4000-8000-000000000021','Add a settlement-date rule')::text,true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.decide_recon_definition_edit(current_setting('fvi.test.edit_request_id')::uuid,true,
      'Self approval attempt');
    RAISE EXCEPTION 'edit requester unexpectedly approved own request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','running',
  'f4400000-0000-4000-8000-000000000013');
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
SELECT set_config('fvi.test.stage_id',public.decide_recon_definition_edit(
  current_setting('fvi.test.edit_request_id')::uuid,true,'Approved isolated staging')::text,true);
DO $test$ BEGIN RAISE NOTICE 'recon-governance gate: isolated stage created'; END $test$;
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id=current_setting('fvi.test.stage_id')::uuid
    AND governance_state='staging_copy' AND environment='staging' AND governance_parent_id='f4400000-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'edit approval did not create an isolated staging copy';
  END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
UPDATE public.recon_definitions SET rules='[{"id":"settlement-date","kind":"exact","fields":{"date":"settlement_date"}}]'
  WHERE id=current_setting('fvi.test.stage_id')::uuid;
SELECT set_config('fvi.test.promotion2_id',public.submit_recon_definition_promotion(
  'f4400000-0000-4000-8000-000000000003',current_setting('fvi.test.stage_id')::uuid,
  'Promote tested settlement-date rule')::text,true);
DO $test$
BEGIN
  BEGIN
    UPDATE public.recon_definitions SET rules='[]' WHERE id=current_setting('fvi.test.stage_id')::uuid;
    RAISE EXCEPTION 'frozen staging copy remained editable';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
SELECT public.decide_recon_definition_promotion(current_setting('fvi.test.promotion2_id')::uuid,true,
  'Independent approval of exact staging hash');
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000021'
    AND governance_state='approved_locked' AND rules->0->>'id'='settlement-date') THEN
    RAISE EXCEPTION 'approved staging snapshot was not applied to parent';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_approved_versions
      WHERE parent_definition_id='f4400000-0000-4000-8000-000000000021')<>2 THEN
    RAISE EXCEPTION 'second approved version is missing';
  END IF;
END $test$;
DO $test$ BEGIN RAISE NOTICE 'recon-governance gate: promotion approved'; END $test$;

-- Rejected promotion leaves the production parent unchanged and reopens staging.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
SELECT set_config('fvi.test.edit_request_id2',public.request_recon_definition_edit(
  'f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021',
  'Test rejected promotion path')::text,true);
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
SELECT set_config('fvi.test.stage_id2',public.decide_recon_definition_edit(
  current_setting('fvi.test.edit_request_id2')::uuid,true,'Approve second isolated stage')::text,true);
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
UPDATE public.recon_definitions SET description='Candidate not approved'
  WHERE id=current_setting('fvi.test.stage_id2')::uuid;
SELECT set_config('fvi.test.promotion3_id',public.submit_recon_definition_promotion(
  'f4400000-0000-4000-8000-000000000003',current_setting('fvi.test.stage_id2')::uuid,
  'Submit candidate for rejection test')::text,true);
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
SELECT public.decide_recon_definition_promotion(current_setting('fvi.test.promotion3_id')::uuid,false,
  'Reject candidate; preserve parent version');
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000021'
      AND governance_state='approved_locked' AND description IS NULL
      AND rules->0->>'id'='settlement-date')
     OR NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id=current_setting('fvi.test.stage_id2')::uuid
      AND governance_state='staging_copy' AND description='Candidate not approved')
     OR (SELECT count(*) FROM public.recon_definition_approved_versions
      WHERE parent_definition_id='f4400000-0000-4000-8000-000000000021')<>2 THEN
    RAISE EXCEPTION 'rejected promotion changed parent, lost stage, or added an approved version';
  END IF;
END $test$;
DO $test$ BEGIN RAISE NOTICE 'recon-governance gate: promotion rejected'; END $test$;

-- Inactive and sibling-tenant admins cannot create workflow requests.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.request_recon_definition_edit('f4400000-0000-4000-8000-000000000003',
      'f4400000-0000-4000-8000-000000000021','Cannot fork another stage');
    RAISE EXCEPTION 'parallel staging copy unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000014',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.request_recon_definition_edit('f4400000-0000-4000-8000-000000000003',
      'f4400000-0000-4000-8000-000000000021','Inactive admin');
    RAISE EXCEPTION 'inactive tenant admin unexpectedly made a request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
DO $test$ BEGIN
  BEGIN
    PERFORM public.request_recon_definition_edit('f4400000-0000-4000-8000-000000000003',
      'f4400000-0000-4000-8000-000000000021','Sibling tenant admin');
    RAISE EXCEPTION 'sibling tenant admin unexpectedly made a request';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;

-- Compatibility: legacy rows keep legacy edit/run semantics and are not marked approved.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status,environment,
  governance_state,access_mode)
VALUES ('f4400000-0000-4000-8000-000000000022','f4400000-0000-4000-8000-000000000003',
  'Legacy Unreviewed','two_sided','[]','[]','draft','development','legacy_unreviewed','legacy_passthrough');
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
UPDATE public.recon_definitions SET description='Legacy edit retained'
  WHERE id='f4400000-0000-4000-8000-000000000022';
INSERT INTO public.recon_runs(tenant_id,definition_id,status)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000022','queued');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.recon_runs(tenant_id,definition_id,status)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','queued');
    RAISE EXCEPTION 'service-role actorless development run unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
END $test$;
INSERT INTO public.recon_runs(tenant_id,definition_id,status)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000022','queued');
DO $test$ BEGIN RAISE NOTICE 'recon-governance gate: service-role legacy compatibility'; END $test$;
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000022'
    AND governance_state='legacy_unreviewed' AND access_mode='legacy_passthrough'
    AND description='Legacy edit retained') THEN RAISE EXCEPTION 'legacy behavior or honest label changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recon_runs WHERE definition_id='f4400000-0000-4000-8000-000000000022'
    AND definition_snapshot->>'approved_version' IS NULL
    AND definition_snapshot->>'governance_state'='legacy_unreviewed') THEN
    RAISE EXCEPTION 'legacy run falsely claims an approved version';
  END IF;
END $test$;
RESET ROLE;
ROLLBACK;
