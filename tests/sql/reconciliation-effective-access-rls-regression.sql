-- Disposable DB only. Exercises effective root/child SELECT policies after
-- 20260925120000; this transaction is rolled back and never touches hosted data.
BEGIN;

-- Use existing authoritative-access synthetic rows. Temporarily create a
-- creator-only legacy case and a governed mapped row with no valid owner set.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
UPDATE public.recon_definitions
SET visibility='restricted', created_by='f4400000-0000-4000-8000-000000000013'
WHERE id='f4400000-0000-4000-8000-000000000021';
UPDATE public.recon_definitions
SET access_mode='mapped_exact', governance_state='approved_locked',
    created_by='f4400000-0000-4000-8000-000000000013'
WHERE id='f4400000-0000-4000-8000-000000000026';
UPDATE public.recon_definitions
SET access_mode='unmapped_pending', governance_state='development_draft',
    environment='development',
    created_by='f4400000-0000-4000-8000-000000000013'
WHERE id='f4400000-0000-4000-8000-000000000025';
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;

DO $policy_inventory$
DECLARE
  v_table text;
  v_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['recon_definitions','recon_runs','recon_matches','recon_exceptions'] LOOP
    SELECT count(*) INTO v_count
    FROM pg_policies
    WHERE schemaname='public' AND tablename=v_table
      AND cmd IN ('SELECT','ALL') AND permissive='PERMISSIVE';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'expected one effective permissive SELECT policy on %, found %', v_table, v_count;
    END IF;
  END LOOP;
END
$policy_inventory$;

-- These rows are intentionally policy fixtures; keep the existing workflow
-- trigger enabled outside this transaction but bypass it for these inserts.
ALTER TABLE public.recon_runs DISABLE TRIGGER recon_runs_governance_guard;
ALTER TABLE public.recon_runs DISABLE TRIGGER recon_runs_definition_snapshot;
INSERT INTO public.recon_runs(id,tenant_id,definition_id)
VALUES
 ('61000000-0000-4000-8000-000000000061','f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021'),
 ('62000000-0000-4000-8000-000000000062','f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000026'),
 ('63000000-0000-4000-8000-000000000063','f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000026'),
 ('64000000-0000-4000-8000-000000000064','f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000021');
ALTER TABLE public.recon_runs ENABLE TRIGGER recon_runs_governance_guard;
ALTER TABLE public.recon_runs ENABLE TRIGGER recon_runs_definition_snapshot;
INSERT INTO public.recon_matches(id,run_id,tenant_id)
VALUES
 ('f4400000-0000-4000-8000-000000000071','61000000-0000-4000-8000-000000000061','f4400000-0000-4000-8000-000000000003'),
 ('f4400000-0000-4000-8000-000000000072','62000000-0000-4000-8000-000000000062','f4400000-0000-4000-8000-000000000003'),
 ('f4400000-0000-4000-8000-000000000073','63000000-0000-4000-8000-000000000063','f4400000-0000-4000-8000-000000000004'),
 ('f4400000-0000-4000-8000-000000000074','64000000-0000-4000-8000-000000000064','f4400000-0000-4000-8000-000000000004');
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,reason)
VALUES
 ('f4400000-0000-4000-8000-000000000081','61000000-0000-4000-8000-000000000061','f4400000-0000-4000-8000-000000000003','legacy synthetic'),
 ('f4400000-0000-4000-8000-000000000082','62000000-0000-4000-8000-000000000062','f4400000-0000-4000-8000-000000000003','governed synthetic'),
 ('f4400000-0000-4000-8000-000000000083','63000000-0000-4000-8000-000000000063','f4400000-0000-4000-8000-000000000004','wrong-tenant governed synthetic'),
 ('f4400000-0000-4000-8000-000000000084','64000000-0000-4000-8000-000000000064','f4400000-0000-4000-8000-000000000004','wrong-tenant legacy synthetic');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $creator_and_governed_member$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.recon_definitions
  WHERE id='f4400000-0000-4000-8000-000000000021';
  IF n <> 1 THEN
    RAISE EXCEPTION 'legacy creator-read path was not preserved';
  END IF;
  SELECT count(*) INTO n FROM public.recon_definitions
  WHERE id='f4400000-0000-4000-8000-000000000026';
  IF n <> 0 THEN
    RAISE EXCEPTION 'governed creator/member branch bypassed the root decision';
  END IF;
  SELECT count(*) INTO n FROM public.recon_definitions
  WHERE id='f4400000-0000-4000-8000-000000000025';
  IF n <> 0 THEN
    RAISE EXCEPTION 'unmapped draft creator bypassed the root decision';
  END IF;
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='61000000-0000-4000-8000-000000000061';
  IF n <> 1 THEN RAISE EXCEPTION 'legacy run read was not preserved'; END IF;
  SELECT count(*) INTO n FROM public.recon_matches WHERE id='f4400000-0000-4000-8000-000000000071';
  IF n <> 1 THEN RAISE EXCEPTION 'legacy match read was not preserved'; END IF;
  SELECT count(*) INTO n FROM public.recon_exceptions WHERE id='f4400000-0000-4000-8000-000000000081';
  IF n <> 1 THEN RAISE EXCEPTION 'legacy exception read was not preserved'; END IF;
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='62000000-0000-4000-8000-000000000062';
  IF n <> 0 THEN RAISE EXCEPTION 'broad child run SELECT bypassed governed root'; END IF;
  SELECT count(*) INTO n FROM public.recon_matches WHERE id='f4400000-0000-4000-8000-000000000072';
  IF n <> 0 THEN RAISE EXCEPTION 'broad child match SELECT bypassed governed root'; END IF;
  SELECT count(*) INTO n FROM public.recon_exceptions WHERE id='f4400000-0000-4000-8000-000000000082';
  IF n <> 0 THEN RAISE EXCEPTION 'broad child exception SELECT bypassed governed root'; END IF;
END
$creator_and_governed_member$;

-- Deactivation must remove legacy run/match/exception reads even though the
-- earlier broad is_tenant_member helper still sees the retained membership row.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
DO $inactive_legacy_child$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='61000000-0000-4000-8000-000000000061';
  IF n <> 0 THEN RAISE EXCEPTION 'inactive member read a legacy run'; END IF;
  SELECT count(*) INTO n FROM public.recon_matches WHERE id='f4400000-0000-4000-8000-000000000071';
  IF n <> 0 THEN RAISE EXCEPTION 'inactive member read a legacy match'; END IF;
  SELECT count(*) INTO n FROM public.recon_exceptions WHERE id='f4400000-0000-4000-8000-000000000081';
  IF n <> 0 THEN RAISE EXCEPTION 'inactive member read a legacy exception'; END IF;
END
$inactive_legacy_child$;

-- The historical child policy also granted a platform-only actor visibility,
-- while the same actor must not bypass a governed root's mapped decision.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
DO $platform_legacy_governed$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='61000000-0000-4000-8000-000000000061';
  IF n <> 1 THEN RAISE EXCEPTION 'legacy platform-admin child read was not preserved'; END IF;
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='62000000-0000-4000-8000-000000000062';
  IF n <> 0 THEN RAISE EXCEPTION 'platform-admin child SELECT bypassed governed root'; END IF;
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='63000000-0000-4000-8000-000000000063';
  IF n <> 0 THEN RAISE EXCEPTION 'run tenant mismatch borrowed platform child access'; END IF;
  SELECT count(*) INTO n FROM public.recon_matches WHERE id='f4400000-0000-4000-8000-000000000073';
  IF n <> 0 THEN RAISE EXCEPTION 'mismatched match tenant borrowed platform child access'; END IF;
  SELECT count(*) INTO n FROM public.recon_exceptions WHERE id='f4400000-0000-4000-8000-000000000083';
  IF n <> 0 THEN RAISE EXCEPTION 'mismatched exception tenant borrowed platform child access'; END IF;
  SELECT count(*) INTO n FROM public.recon_runs WHERE id='64000000-0000-4000-8000-000000000064';
  IF n <> 0 THEN RAISE EXCEPTION 'legacy run tenant mismatch borrowed platform child access'; END IF;
  SELECT count(*) INTO n FROM public.recon_matches WHERE id='f4400000-0000-4000-8000-000000000074';
  IF n <> 0 THEN RAISE EXCEPTION 'legacy match tenant mismatch borrowed platform child access'; END IF;
  SELECT count(*) INTO n FROM public.recon_exceptions WHERE id='f4400000-0000-4000-8000-000000000084';
  IF n <> 0 THEN RAISE EXCEPTION 'legacy exception tenant mismatch borrowed platform child access'; END IF;
END
$platform_legacy_governed$;

RESET ROLE;
ROLLBACK;
