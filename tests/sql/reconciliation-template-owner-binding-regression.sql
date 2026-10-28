-- Disposable DB only. Exercises owner-bound Starter Kit and tenant-template
-- creators after direct authenticated reconciliation INSERT is revoked.
BEGIN;

INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type)
VALUES ('f4400000-0000-4000-8000-000000000191','f4400000-0000-4000-8000-000000000003','Template owner source','csv'),
       ('f4400000-0000-4000-8000-000000000192','f4400000-0000-4000-8000-000000000004','Foreign template source','csv');

INSERT INTO public.recon_definition_templates(
  id,code,asset_class,title,summary,legs,keys,rules,status
) VALUES (
  'f4400000-0000-4000-8000-000000000181','owner_binding_replay','cash','Owner binding replay kit',
  'Disposable owner-binding replay fixture',
  '[{"name":"Ledger"}]'::jsonb,'["reference"]'::jsonb,'[{"kind":"exact_match","fields":{"left":"reference","right":"reference"}}]'::jsonb,'published'
);

INSERT INTO public.tenant_templates(id,tenant_id,title,description,spec,current_semver,status,created_by)
VALUES
 ('f4400000-0000-4000-8000-000000000182','f4400000-0000-4000-8000-000000000003',
  'Owner binding replay template','Disposable tenant template',
  jsonb_build_object('kind','reconciliation','schema_version',1,'recon_type','one_sided',
    'sides','[{"side_id":"A","label":"Ledger","data_source_id":"f4400000-0000-4000-8000-000000000191"}]'::jsonb,
    'rules','[{"kind":"exact_match","fields":{"left":"reference","right":"reference"}}]'::jsonb),
  '1.0.0','published','f4400000-0000-4000-8000-000000000011'),
 ('f4400000-0000-4000-8000-000000000183','f4400000-0000-4000-8000-000000000003',
  'Foreign source replay template','Must fail tenant source check',
  jsonb_build_object('kind','reconciliation','schema_version',1,'recon_type','one_sided',
    'sides','[{"side_id":"A","label":"Foreign","data_source_id":"f4400000-0000-4000-8000-000000000192"}]'::jsonb,
    'rules','[{"kind":"exact_match","fields":{"left":"reference","right":"reference"}}]'::jsonb),
  '1.0.0','published','f4400000-0000-4000-8000-000000000011');

DO $signature_privileges$
BEGIN
  IF has_function_privilege('authenticated',
      'public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.instantiate_tenant_template_atomic(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role retained an ownerless template creator signature';
  END IF;
  IF NOT has_function_privilege('authenticated',
      'public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb,uuid[])','EXECUTE')
     OR NOT has_function_privilege('authenticated',
      'public.instantiate_tenant_template_atomic(uuid,uuid,text,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot execute owner-bound template creators';
  END IF;
END
$signature_privileges$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $owner_bound_creators$
DECLARE
  starter_id uuid;
  starter_code text;
  template_id uuid;
  template_code text;
BEGIN
  SELECT created.recon_definition_id,created.recon_code INTO starter_id,starter_code
  FROM public.install_recon_starter_template_atomic(
    'f4400000-0000-4000-8000-000000000003',
    'f4400000-0000-4000-8000-000000000181',
    'Starter owner-bound replay',
    '[{"side_id":"A","label":"Ledger","data_source_id":"f4400000-0000-4000-8000-000000000191"}]'::jsonb,
    '[{"kind":"exact_match","fields":{"left":"reference","right":"reference"}}]'::jsonb,
    ARRAY['f4400000-0000-4000-8000-000000000041'::uuid]
  ) created;
  IF starter_id IS NULL OR starter_code IS NULL THEN RAISE EXCEPTION 'starter creator returned no identity'; END IF;

  SELECT created.recon_definition_id,created.recon_code INTO template_id,template_code
  FROM public.instantiate_tenant_template_atomic(
    'f4400000-0000-4000-8000-000000000003',
    'f4400000-0000-4000-8000-000000000182',
    'Tenant template owner-bound replay',
    ARRAY['f4400000-0000-4000-8000-000000000042'::uuid]
  ) created;
  IF template_id IS NULL OR template_code IS NULL THEN RAISE EXCEPTION 'tenant template creator returned no identity'; END IF;

  BEGIN
    PERFORM public.install_recon_starter_template_atomic(
      'f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000181',
      'No owner selection',
      '[{"side_id":"A","label":"Ledger","data_source_id":"f4400000-0000-4000-8000-000000000191"}]'::jsonb,
      '[{"kind":"exact_match","fields":{"left":"reference","right":"reference"}}]'::jsonb,
      ARRAY[]::uuid[]
    );
    RAISE EXCEPTION 'expected empty Starter Kit owner selection to fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.instantiate_tenant_template_atomic(
      'f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000182',
      'Cross-tenant owner selection',ARRAY['f4400000-0000-4000-8000-000000000044'::uuid]
    );
    RAISE EXCEPTION 'expected cross-tenant owner selection to fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.instantiate_tenant_template_atomic(
      'f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000183',
      'Foreign source rejected',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid]
    );
    RAISE EXCEPTION 'expected cross-tenant template source to fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$owner_bound_creators$;

-- Global platform authority alone does not satisfy the tenant-bound creator
-- role requirement for reconciliation data creation.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
DO $platform_admin_is_not_tenant_member$
BEGIN
  BEGIN
    PERFORM public.instantiate_tenant_template_atomic(
      'f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000182',
      'Platform-only creator denied',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid]
    );
    RAISE EXCEPTION 'expected platform-only cross-tenant creation to fail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END
$platform_admin_is_not_tenant_member$;
RESET ROLE;

DO $owner_and_audit_readback$
DECLARE
  starter_id uuid;
  template_id uuid;
BEGIN
  SELECT id INTO starter_id FROM public.recon_definitions WHERE name='Starter owner-bound replay';
  SELECT id INTO template_id FROM public.recon_definitions WHERE name='Tenant template owner-bound replay';
  IF starter_id IS NULL OR template_id IS NULL THEN RAISE EXCEPTION 'a template reconciliation did not persist'; END IF;
  IF (SELECT count(*) FROM public.recon_definition_business_units
      WHERE tenant_id='f4400000-0000-4000-8000-000000000003' AND recon_id=starter_id
        AND bu_id='f4400000-0000-4000-8000-000000000041') <> 1
     OR (SELECT count(*) FROM public.recon_definition_business_units
      WHERE tenant_id='f4400000-0000-4000-8000-000000000003' AND recon_id=template_id
        AND bu_id='f4400000-0000-4000-8000-000000000042') <> 1 THEN
    RAISE EXCEPTION 'owner BU mappings were not persisted atomically';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_bu_admin_audit
      WHERE recon_id IN (starter_id,template_id) AND operation='replace_owners') <> 2 THEN
    RAISE EXCEPTION 'owner mapping audit records are missing';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE resource_type='recon_definition'
      AND resource_id IN (starter_id::text,template_id::text)
      AND action IN ('recon.template.install','recon.tenant_template.instantiate')) <> 2 THEN
    RAISE EXCEPTION 'template-specific reconciliation audit records are missing';
  END IF;
  IF (SELECT count(*) FROM public.mkt_audit_log WHERE entity_type='tenant_template'
      AND entity_id='f4400000-0000-4000-8000-000000000182' AND action='instantiate') <> 1 THEN
    RAISE EXCEPTION 'tenant-template lifecycle audit is missing';
  END IF;
  IF (SELECT install_count FROM public.recon_definition_templates
      WHERE id='f4400000-0000-4000-8000-000000000181') <> 1 THEN
    RAISE EXCEPTION 'failed Starter Kit attempts changed its install count';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recon_definitions WHERE name IN (
      'No owner selection','Cross-tenant owner selection','Foreign source rejected','Platform-only creator denied')) THEN
    RAISE EXCEPTION 'a rejected template request left a reconciliation behind';
  END IF;
END
$owner_and_audit_readback$;

ROLLBACK;
