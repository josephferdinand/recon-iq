-- Disposable DB only. Verifies owner-bound creation and first mapping are
-- atomic, actor-bound, and usable without a creator-read RLS exception.
BEGIN;

INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type)
VALUES ('f4400000-0000-4000-8000-000000000091','f4400000-0000-4000-8000-000000000003','Atomic create source','csv'),
       ('f4400000-0000-4000-8000-000000000092','f4400000-0000-4000-8000-000000000004','Foreign create source','csv');

CREATE FUNCTION pg_temp.reject_recon_create_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action='recon.create'
     AND current_setting('fvi.test_fail_recon_create_audit',true)='1' THEN
    RAISE EXCEPTION 'synthetic audit sink failure' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER recon_create_audit_failure_fixture
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_recon_create_audit();

DO $privilege_gate$
BEGIN
  IF has_table_privilege('authenticated','public.recon_definitions','INSERT') THEN
    RAISE EXCEPTION 'authenticated role retained direct definition INSERT';
  END IF;
  IF NOT has_function_privilege('authenticated',
      'public.create_recon_definition_with_owners(uuid,text,text,text,jsonb,jsonb,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot call atomic create RPC';
  END IF;
  IF has_function_privilege('anon',
      'public.create_recon_definition_with_owners(uuid,text,text,text,jsonb,jsonb,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'anonymous role can call atomic create RPC';
  END IF;
END
$privilege_gate$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $analyst_create$
DECLARE
  v_id uuid;
  v_code text;
  v_count integer;
BEGIN
  SELECT created.id,created.recon_code INTO v_id,v_code
  FROM public.create_recon_definition_with_owners(
    'f4400000-0000-4000-8000-000000000003',
    'Atomic owner-bound draft','created in one transaction','one_sided',
    '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000091"}]'::jsonb,'[]'::jsonb,
    ARRAY['f4400000-0000-4000-8000-000000000041'::uuid]
  ) created;
  IF v_id IS NULL OR v_code IS NULL THEN
    RAISE EXCEPTION 'atomic create did not return definition identity';
  END IF;
  SELECT count(*) INTO v_count FROM public.recon_definitions WHERE id=v_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'creator could not read the mapped draft through its explicit owner grant';
  END IF;
  IF public.recon_authoritative_access_decision(v_id,'view') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision(v_id,'edit') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision(v_id,'run') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'atomic create did not bind creator capabilities to owner BU';
  END IF;
  PERFORM set_config('fvi.test_fail_recon_create_audit','1',true);
  BEGIN
    PERFORM public.create_recon_definition_with_owners(
      'f4400000-0000-4000-8000-000000000003','Audit failure rollback','must not persist','one_sided',
      '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000091"}]'::jsonb,
      '[]'::jsonb,ARRAY['f4400000-0000-4000-8000-000000000041'::uuid]
    );
    RAISE EXCEPTION 'expected audit sink failure';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM='expected audit sink failure' THEN RAISE; END IF;
  END;
  PERFORM set_config('fvi.test_fail_recon_create_audit','',true);

  BEGIN
    PERFORM public.create_recon_definition_with_owners(
      'f4400000-0000-4000-8000-000000000003','No owner','bad request','one_sided',
      '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000091"}]'::jsonb,'[]'::jsonb,ARRAY[]::uuid[]
    );
    RAISE EXCEPTION 'expected empty owner set to fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_recon_definition_with_owners(
      'f4400000-0000-4000-8000-000000000003','Cross tenant owner','bad request','one_sided',
      '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000091"}]'::jsonb,'[]'::jsonb,ARRAY['f4400000-0000-4000-8000-000000000044'::uuid]
    );
    RAISE EXCEPTION 'expected cross-tenant owner set to fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_recon_definition_with_owners(
      'f4400000-0000-4000-8000-000000000003','Unassigned owner','bad request','one_sided',
      '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000091"}]'::jsonb,'[]'::jsonb,ARRAY['f4400000-0000-4000-8000-000000000042'::uuid]
    );
    RAISE EXCEPTION 'expected unassigned owner BU to fail for analyst';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.create_recon_definition_with_owners(
      'f4400000-0000-4000-8000-000000000003','Foreign source','bad source','one_sided',
      '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000092"}]'::jsonb,
      '[]'::jsonb,ARRAY['f4400000-0000-4000-8000-000000000041'::uuid]
    );
    RAISE EXCEPTION 'expected cross-tenant source reference to fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.recon_definitions(tenant_id,name,recon_type)
    VALUES ('f4400000-0000-4000-8000-000000000003','Direct insert bypass','two_sided');
    RAISE EXCEPTION 'expected direct authenticated INSERT denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$analyst_create$;
RESET ROLE;

-- Seed an unmapped draft with an authenticated owner identity for the admin
-- transition case. The migration function, not this test fixture, owns the
-- actual first-owner binding and access-mode transition.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
INSERT INTO public.recon_definitions(
  id,tenant_id,name,recon_type,sides,rules,status,created_by
) VALUES (
  '65000000-0000-4000-8000-000000000065',
  'f4400000-0000-4000-8000-000000000003',
  'Admin mapping candidate','two_sided','[]'::jsonb,'[]'::jsonb,'draft',
  'f4400000-0000-4000-8000-000000000011'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $admin_first_mapping$
DECLARE v_owner_ids uuid[];
BEGIN
  v_owner_ids := public.map_recon_definition_owners(
    '65000000-0000-4000-8000-000000000065',
    ARRAY['f4400000-0000-4000-8000-000000000042'::uuid],
    'Owner reviewed first mapping'
  );
  IF cardinality(v_owner_ids) <> 1 OR v_owner_ids[1] <> 'f4400000-0000-4000-8000-000000000042'::uuid THEN
    RAISE EXCEPTION 'first owner mapping RPC returned the wrong set';
  END IF;
  IF public.recon_authoritative_access_decision(
       '65000000-0000-4000-8000-000000000065','view'
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'active tenant admin lost access after atomic first mapping';
  END IF;
END
$admin_first_mapping$;

DO $admin_create_without_bu_assignment$
DECLARE v_id uuid; v_code text; v_setup jsonb;
BEGIN
  SELECT created.id,created.recon_code INTO v_id,v_code
  FROM public.create_recon_definition_with_owners(
    'f4400000-0000-4000-8000-000000000003',
    'Admin owner-bound draft','admin override requires no BU assignment','one_sided',
    '[{"side_id":"A","label":"Source A","data_source_id":"f4400000-0000-4000-8000-000000000091"}]'::jsonb,'[]'::jsonb,
    ARRAY['f4400000-0000-4000-8000-000000000042'::uuid]
  ) created;
  IF v_id IS NULL OR v_code IS NULL
     OR public.recon_authoritative_access_decision(v_id,'view') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'tenant admin could not create/read owner-bound draft without BU assignment';
  END IF;
  v_setup := public.get_recon_access_setup(v_id);
  IF jsonb_array_length(v_setup->'grants') <> 0 THEN
    RAISE EXCEPTION 'tenant admin received unnecessary BU grants';
  END IF;
END
$admin_create_without_bu_assignment$;
RESET ROLE;

DO $audit_readback$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.recon_definitions WHERE name='Atomic owner-bound draft';
  IF v_id IS NULL
     OR (SELECT count(*) FROM public.recon_definition_business_units
         WHERE recon_id=v_id AND tenant_id='f4400000-0000-4000-8000-000000000003') <> 1
     OR (SELECT count(*) FROM public.recon_definition_bu_grants
         WHERE recon_id=v_id AND tenant_id='f4400000-0000-4000-8000-000000000003'
           AND principal_id='f4400000-0000-4000-8000-000000000012') <> 3
     OR (SELECT count(*) FROM public.recon_definition_bu_admin_audit
         WHERE recon_id=v_id AND operation='replace_owners') <> 1 THEN
    RAISE EXCEPTION 'atomic create owner/grant/audit persistence readback failed';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE action='recon.create'
      AND resource_id=v_id::text AND actor_user_id='f4400000-0000-4000-8000-000000000012') <> 1 THEN
    RAISE EXCEPTION 'atomic create audit event is missing';
  END IF;
  IF (SELECT count(*) FROM public.recon_definitions WHERE name='Audit failure rollback') <> 0 THEN
    RAISE EXCEPTION 'failed creation audit left a definition row';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_business_units
      WHERE recon_id='65000000-0000-4000-8000-000000000065'
        AND tenant_id='f4400000-0000-4000-8000-000000000003') <> 1
     OR (SELECT count(*) FROM public.recon_definition_bu_admin_audit
      WHERE recon_id='65000000-0000-4000-8000-000000000065' AND operation='replace_owners') <> 1 THEN
    RAISE EXCEPTION 'admin first mapping owner/audit persistence readback failed';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_bu_grants g
      JOIN public.recon_definitions d ON d.id=g.recon_id
      WHERE d.name='Admin owner-bound draft') <> 0 THEN
    RAISE EXCEPTION 'admin create unexpectedly persisted BU grants';
  END IF;
END
$audit_readback$;

ROLLBACK;
