-- Run against a disposable migrated database with psql -v ON_ERROR_STOP=1.
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('e2400000-0000-4000-8000-000000000001','Run Snapshot A','e2400000-0000-4000-8000-000000000002','Run Snapshot A'),
       ('e2400000-0000-4000-8000-000000000003','Run Snapshot B','e2400000-0000-4000-8000-000000000004','Run Snapshot B');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('e2400000-0000-4000-8000-000000000011','e2400000-0000-4000-8000-000000000001','run-snapshot-a','Run Snapshot A','dev'),
       ('e2400000-0000-4000-8000-000000000012','e2400000-0000-4000-8000-000000000003','run-snapshot-b','Run Snapshot B','dev');

INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type)
VALUES ('e2400000-0000-4000-8000-000000000021','e2400000-0000-4000-8000-000000000011','Bank original','csv');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('e2400000-0000-4000-8000-000000000031','e2400000-0000-4000-8000-000000000011',
        'Cash original','one_sided',
        '[{"side_id":"A","data_source_id":"e2400000-0000-4000-8000-000000000021","label":"Bank side"}]',
        '[{"rule_id":"original"}]','active');

-- A supplied snapshot must be overwritten with the same-tenant definition.
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status,definition_snapshot)
VALUES ('e2400000-0000-4000-8000-000000000041','e2400000-0000-4000-8000-000000000011',
        'e2400000-0000-4000-8000-000000000031','running','{"name":"forged"}');

DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT definition_snapshot INTO snapshot FROM public.recon_runs
    WHERE id='e2400000-0000-4000-8000-000000000041';
  IF snapshot->>'name' <> 'Cash original'
     OR snapshot->>'recon_type' <> 'one_sided'
     OR snapshot->'rules'->0->>'rule_id' <> 'original'
     OR snapshot->'sides'->0->>'label' <> 'Bank side'
     OR snapshot->'sources'->0->>'name' <> 'Bank original' THEN
    RAISE EXCEPTION 'run creation did not capture definition and source labels: %', snapshot;
  END IF;
END $$;

UPDATE public.recon_definitions SET name='Cash renamed', sides='[]', rules='[]'
  WHERE id='e2400000-0000-4000-8000-000000000031';
UPDATE public.workspace_data_sources SET name='Bank renamed'
  WHERE id='e2400000-0000-4000-8000-000000000021';
UPDATE public.recon_runs SET status='completed'
  WHERE id='e2400000-0000-4000-8000-000000000041';

DO $$
DECLARE snapshot jsonb;
BEGIN
  SELECT definition_snapshot INTO snapshot FROM public.recon_runs
    WHERE id='e2400000-0000-4000-8000-000000000041';
  IF snapshot->>'name' <> 'Cash original'
     OR snapshot->'sources'->0->>'name' <> 'Bank original'
     OR snapshot->'rules'->0->>'rule_id' <> 'original'
     OR snapshot->'sides'->0->>'label' <> 'Bank side' THEN
    RAISE EXCEPTION 'later edits changed run snapshot: %', snapshot;
  END IF;

  BEGIN
    UPDATE public.recon_runs SET definition_snapshot='{"name":"tampered"}'
      WHERE id='e2400000-0000-4000-8000-000000000041';
    RAISE EXCEPTION 'snapshot update was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.recon_runs(id,tenant_id,definition_id)
    VALUES ('e2400000-0000-4000-8000-000000000042',
            'e2400000-0000-4000-8000-000000000012',
            'e2400000-0000-4000-8000-000000000031');
    RAISE EXCEPTION 'cross-tenant definition was accepted';
  EXCEPTION WHEN SQLSTATE '23503' THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.recon_runs
             WHERE id='e2400000-0000-4000-8000-000000000042') THEN
    RAISE EXCEPTION 'cross-tenant run survived';
  END IF;
END $$;

ROLLBACK;
