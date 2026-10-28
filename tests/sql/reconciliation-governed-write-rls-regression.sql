-- Disposable DB only. Exercises governed write RLS, tenant ancestry,
-- INSERT ... RETURNING and retained legacy tenant-role writes.
BEGIN;

-- Opt one fully owned synthetic definition into governed access. The fixture
-- has a direct-user run+read actor, a group view-only actor, an edit-only
-- actor, and an active tenant administrator.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
UPDATE public.recon_definitions
SET access_mode='mapped_exact', governance_state='approved_locked',
    environment='production', status='active'
WHERE id='f4400000-0000-4000-8000-000000000022';
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;

-- Normal governed run ancestry, plus a legacy run for compatibility checks.
INSERT INTO public.recon_runs(id,tenant_id,definition_id,run_by)
VALUES
 ('71000000-0000-4000-8000-000000000071','f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000022','f4400000-0000-4000-8000-000000000011'),
 ('72000000-0000-4000-8000-000000000072','f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000013');
INSERT INTO public.recon_matches(id,run_id,tenant_id)
VALUES
 ('f4400000-0000-4000-8000-000000000091','71000000-0000-4000-8000-000000000071','f4400000-0000-4000-8000-000000000003'),
 ('f4400000-0000-4000-8000-000000000092','72000000-0000-4000-8000-000000000072','f4400000-0000-4000-8000-000000000003');
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason)
VALUES
 ('f4400000-0000-4000-8000-000000000093','71000000-0000-4000-8000-000000000071','f4400000-0000-4000-8000-000000000003','governed write fixture'),
 ('f4400000-0000-4000-8000-000000000094','72000000-0000-4000-8000-000000000072','f4400000-0000-4000-8000-000000000003','legacy write fixture');

-- The root helper must reject bad actions and mismatched tenant chains before
-- applying either legacy compatibility or a governed decision.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $helper_contract$
BEGIN
  IF private.recon_root_write_allowed('f4400000-0000-4000-8000-000000000022',
       'f4400000-0000-4000-8000-000000000003',NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'NULL action was not denied';
  END IF;
  IF private.recon_root_write_allowed('f4400000-0000-4000-8000-000000000022',
       'f4400000-0000-4000-8000-000000000004','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'root tenant mismatch was not denied';
  END IF;
  IF private.recon_child_write_allowed('71000000-0000-4000-8000-000000000071',
       'f4400000-0000-4000-8000-000000000004','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'child/run tenant mismatch was not denied';
  END IF;
END
$helper_contract$;

-- A governed run+read actor can create children and receive their ids through
-- RETURNING. That same actor has no edit grant and cannot update/delete them.
DO $run_actor$
DECLARE
  returned_id uuid;
  affected integer;
BEGIN
  INSERT INTO public.recon_matches(id,run_id,tenant_id)
  VALUES ('f4400000-0000-4000-8000-000000000095',
          '71000000-0000-4000-8000-000000000071',
          'f4400000-0000-4000-8000-000000000003')
  RETURNING id INTO returned_id;
  IF returned_id IS DISTINCT FROM 'f4400000-0000-4000-8000-000000000095' THEN
    RAISE EXCEPTION 'governed match INSERT RETURNING did not return the inserted id';
  END IF;
  INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason)
  VALUES ('f4400000-0000-4000-8000-000000000096',
          '71000000-0000-4000-8000-000000000071',
          'f4400000-0000-4000-8000-000000000003','governed returned insert')
  RETURNING id INTO returned_id;
  IF returned_id IS DISTINCT FROM 'f4400000-0000-4000-8000-000000000096' THEN
    RAISE EXCEPTION 'governed exception INSERT RETURNING did not return the inserted id';
  END IF;
  UPDATE public.recon_exceptions SET reason='unauthorized edit'
  WHERE id='f4400000-0000-4000-8000-000000000093';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'run-only actor updated a governed exception'; END IF;
  DELETE FROM public.recon_exceptions WHERE id='f4400000-0000-4000-8000-000000000093';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'run-only actor deleted a governed exception'; END IF;
  DELETE FROM public.recon_runs WHERE id='71000000-0000-4000-8000-000000000071';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'run-only actor deleted a governed run'; END IF;
END
$run_actor$;

-- View-only group access does not authorize run/edit writes. Tenant mismatch
-- is rejected even when the caller is an administrator of the child tenant.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $view_only_actor$
BEGIN
  BEGIN
    INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason)
    VALUES ('f4400000-0000-4000-8000-000000000097',
            '71000000-0000-4000-8000-000000000071',
            'f4400000-0000-4000-8000-000000000003','view-only denied');
    RAISE EXCEPTION 'view-only actor inserted governed exception';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$view_only_actor$;

SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
DO $wrong_child_tenant$
BEGIN
  BEGIN
    INSERT INTO public.recon_matches(id,run_id,tenant_id)
    VALUES ('f4400000-0000-4000-8000-000000000098',
            '71000000-0000-4000-8000-000000000071',
            'f4400000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'cross-tenant child INSERT was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$wrong_child_tenant$;

-- Bypass only the normal run triggers so this case proves that RLS itself
-- rejects a tenant-B run pointing at a tenant-A definition.
RESET ROLE;
ALTER TABLE public.recon_runs DISABLE TRIGGER recon_runs_governance_guard;
ALTER TABLE public.recon_runs DISABLE TRIGGER recon_runs_definition_snapshot;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
DO $wrong_run_root_tenant$
BEGIN
  BEGIN
    INSERT INTO public.recon_runs(id,tenant_id,definition_id)
    VALUES ('74000000-0000-4000-8000-000000000074',
            'f4400000-0000-4000-8000-000000000004',
            'f4400000-0000-4000-8000-000000000022');
    RAISE EXCEPTION 'cross-tenant run/root INSERT was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$wrong_run_root_tenant$;
RESET ROLE;
ALTER TABLE public.recon_runs ENABLE TRIGGER recon_runs_governance_guard;
ALTER TABLE public.recon_runs ENABLE TRIGGER recon_runs_definition_snapshot;

-- Exercise run INSERT ... RETURNING with an actor whose run and read actions
-- both pass and whose existing run-governance trigger accepts the row.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $admin_insert_decision$
BEGIN
  IF private.recon_root_write_allowed('f4400000-0000-4000-8000-000000000022',
       'f4400000-0000-4000-8000-000000000003','run') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'tenant admin failed governed root run+read write decision';
  END IF;
  IF private.recon_run_read_allowed('f4400000-0000-4000-8000-000000000022',
       'f4400000-0000-4000-8000-000000000003') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'tenant admin failed direct governed run read decision';
  END IF;
  IF private.recon_child_read_allowed('73000000-0000-4000-8000-000000000073',
       'f4400000-0000-4000-8000-000000000003') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'nonexistent run unexpectedly passed child read lookup';
  END IF;
END
$admin_insert_decision$;
DO $run_returning$
DECLARE returned_id uuid;
BEGIN
  INSERT INTO public.recon_runs(id,tenant_id,definition_id,run_by)
  VALUES ('73000000-0000-4000-8000-000000000073',
          'f4400000-0000-4000-8000-000000000003',
          'f4400000-0000-4000-8000-000000000022',
          'f4400000-0000-4000-8000-000000000011')
  RETURNING id INTO returned_id;
  IF returned_id IS DISTINCT FROM '73000000-0000-4000-8000-000000000073' THEN
    RAISE EXCEPTION 'governed run INSERT RETURNING did not return the inserted id';
  END IF;
END
$run_returning$;

-- The SECURITY DEFINER lookup supports authorized DELETE decisions without
-- depending on a caller-controlled join to the run/root. Tenant admin is
-- authorized for this tenant; the run deletion cascades its child fixture.
DELETE FROM public.recon_runs WHERE id='73000000-0000-4000-8000-000000000073';
DO $delete_readback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.recon_runs WHERE id='73000000-0000-4000-8000-000000000073') THEN
    RAISE EXCEPTION 'authorized governed run DELETE did not complete';
  END IF;
END
$delete_readback$;

-- Legacy tenant-role writes, including INSERT RETURNING and cascade DELETE,
-- remain usable for valid same-tenant ancestry.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $legacy_analyst$
DECLARE returned_id uuid;
BEGIN
  INSERT INTO public.recon_runs(id,tenant_id,definition_id,run_by)
  VALUES ('75000000-0000-4000-8000-000000000075',
          'f4400000-0000-4000-8000-000000000003',
          'f4400000-0000-4000-8000-000000000021',
          'f4400000-0000-4000-8000-000000000013')
  RETURNING id INTO returned_id;
  IF returned_id IS DISTINCT FROM '75000000-0000-4000-8000-000000000075' THEN
    RAISE EXCEPTION 'legacy run INSERT RETURNING regressed';
  END IF;

  INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason)
  VALUES ('f4400000-0000-4000-8000-000000000099',
          '72000000-0000-4000-8000-000000000072',
          'f4400000-0000-4000-8000-000000000003','legacy returned insert')
  RETURNING id INTO returned_id;
  IF returned_id IS DISTINCT FROM 'f4400000-0000-4000-8000-000000000099' THEN
    RAISE EXCEPTION 'legacy exception INSERT RETURNING regressed';
  END IF;
  UPDATE public.recon_exceptions SET reason='legacy edit retained'
  WHERE id='f4400000-0000-4000-8000-000000000094';
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy tenant-role exception UPDATE regressed'; END IF;
  DELETE FROM public.recon_runs WHERE id='72000000-0000-4000-8000-000000000072';
  IF EXISTS (SELECT 1 FROM public.recon_runs WHERE id='72000000-0000-4000-8000-000000000072') THEN
    RAISE EXCEPTION 'legacy tenant-role run DELETE regressed';
  END IF;
END
$legacy_analyst$;

RESET ROLE;
ROLLBACK;
