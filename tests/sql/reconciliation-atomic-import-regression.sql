-- Disposable DB only. Verifies explicit tenant/BU ownership and all-or-nothing
-- behavior for bulk definition import after the owner-binding cutover.
BEGIN;

INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type)
VALUES ('f4400000-0000-4000-8000-000000000201','f4400000-0000-4000-8000-000000000003','Import source','csv'),
       ('f4400000-0000-4000-8000-000000000202','f4400000-0000-4000-8000-000000000004','Foreign import source','csv');

DO $privilege_gate$
BEGIN
  IF has_function_privilege('anon',
      'public.import_recon_definitions_with_owners(uuid,jsonb,uuid[],text)','EXECUTE') THEN
    RAISE EXCEPTION 'anonymous role can call the owner-bound import RPC';
  END IF;
  IF NOT has_function_privilege('authenticated',
      'public.import_recon_definitions_with_owners(uuid,jsonb,uuid[],text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot call the owner-bound import RPC';
  END IF;
END
$privilege_gate$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $import_contract$
DECLARE
  result jsonb;
  created_id uuid;
BEGIN
  result := public.import_recon_definitions_with_owners(
    'f4400000-0000-4000-8000-000000000003',
    '[{"name":"Atomic import A","description":"Imported draft","recon_type":"one_sided","status":"active","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]},{"name":"Atomic import B","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]}]'::jsonb,
    ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'skip'
  );
  IF result IS DISTINCT FROM '{"inserted":2,"updated":0,"skipped":0}'::jsonb THEN
    RAISE EXCEPTION 'initial import returned unexpected counts: %',result;
  END IF;
  SELECT id INTO created_id FROM public.recon_definitions WHERE tenant_id='f4400000-0000-4000-8000-000000000003'
    AND name='Atomic import A';
  IF created_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.recon_definitions WHERE id=created_id AND status='draft'
      AND governance_state='development_draft' AND access_mode='mapped_exact'
      AND environment='development' AND multi_bu_governed
  ) THEN
    RAISE EXCEPTION 'import trusted exported status or failed to create a governed draft';
  END IF;
  IF public.recon_authoritative_access_decision(created_id,'read') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision(created_id,'edit') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision(created_id,'run') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'owner BU or creator access grants were not persisted';
  END IF;

  result := public.import_recon_definitions_with_owners(
    'f4400000-0000-4000-8000-000000000003',
    '[{"name":"Atomic import A","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]}]'::jsonb,
    ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'skip'
  );
  IF result IS DISTINCT FROM '{"inserted":0,"updated":0,"skipped":1}'::jsonb THEN
    RAISE EXCEPTION 'skip-existing import returned unexpected counts: %',result;
  END IF;

  result := public.import_recon_definitions_with_owners(
    'f4400000-0000-4000-8000-000000000003',
    '[{"name":"Atomic import A","description":"Reviewed draft update","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]}]'::jsonb,
    ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'overwrite'
  );
  IF result IS DISTINCT FROM '{"inserted":0,"updated":1,"skipped":0}'::jsonb
     OR NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE id=created_id
       AND description='Reviewed draft update' AND status='draft') THEN
    RAISE EXCEPTION 'owner-identical draft overwrite did not update only draft content';
  END IF;

  BEGIN
    PERFORM public.import_recon_definitions_with_owners(
      'f4400000-0000-4000-8000-000000000003',
      '[{"name":"Rollback import A","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]},{"name":"Rollback import B","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000202"}],"rules":[]}]'::jsonb,
      ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'skip'
    );
    RAISE EXCEPTION 'expected cross-tenant source import to fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.recon_definitions WHERE tenant_id='f4400000-0000-4000-8000-000000000003'
      AND name='Rollback import A') THEN
    RAISE EXCEPTION 'failed import left the earlier definition committed';
  END IF;

  BEGIN
    PERFORM public.import_recon_definitions_with_owners(
      'f4400000-0000-4000-8000-000000000003',
      '[{"name":"Legacy passthrough","description":"Should not replace existing history","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]}]'::jsonb,
      ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'overwrite'
    );
    RAISE EXCEPTION 'expected active legacy definition overwrite to fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.import_recon_definitions_with_owners(
      'f4400000-0000-4000-8000-000000000003',
      '[{"name":"Foreign owner import","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]}]'::jsonb,
      ARRAY['f4400000-0000-4000-8000-000000000044'::uuid], 'skip'
    );
    RAISE EXCEPTION 'expected cross-tenant owner BU to fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.import_recon_definitions_with_owners(
      'f4400000-0000-4000-8000-000000000003',
      '[{"name":"Duplicate import","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]},{"name":" duplicate import ","recon_type":"one_sided","sides":[{"side_id":"A","data_source_id":"f4400000-0000-4000-8000-000000000201"}],"rules":[]}]'::jsonb,
      ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'skip'
    );
    RAISE EXCEPTION 'expected duplicate names to fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$import_contract$;
RESET ROLE;

DO $audit_readback$
DECLARE imported_id uuid;
BEGIN
  SELECT id INTO imported_id FROM public.recon_definitions
  WHERE tenant_id='f4400000-0000-4000-8000-000000000003' AND name='Atomic import A';
  IF imported_id IS NULL
     OR (SELECT count(*) FROM public.audit_log WHERE actor_user_id='f4400000-0000-4000-8000-000000000012'
       AND tenant_id='f4400000-0000-4000-8000-000000000003' AND action='recon.bulk_import') <> 3
     OR (SELECT count(*) FROM public.audit_log WHERE actor_user_id='f4400000-0000-4000-8000-000000000012'
       AND tenant_id='f4400000-0000-4000-8000-000000000003' AND action='recon.bulk_import.overwrite'
       AND resource_id=imported_id::text) <> 1 THEN
    RAISE EXCEPTION 'bulk import audit events are missing or not attributable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recon_definitions WHERE tenant_id='f4400000-0000-4000-8000-000000000003'
      AND name='Legacy passthrough' AND status='active' AND recon_type='two_sided' AND sides='[]'::jsonb) THEN
    RAISE EXCEPTION 'overwrite modified an existing active legacy definition';
  END IF;
END
$audit_readback$;

ROLLBACK;
