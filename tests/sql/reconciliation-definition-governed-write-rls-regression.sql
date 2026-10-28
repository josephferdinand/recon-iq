-- Disposable DB only. Proves root UPDATE/DELETE policies use actor-bound
-- owner-BU edit access for mapped definitions and preserve legacy draft rules.
BEGIN;

-- Reuse the synthetic mapped-without-owner definition as a new, valid draft.
-- Actor 12 is assigned to BU 41; actor 13 receives view but no edit on BU 41.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by)
VALUES ('f4400000-0000-4000-8000-000000000003',
        'f4400000-0000-4000-8000-000000000026',
        'f4400000-0000-4000-8000-000000000041',
        'f4400000-0000-4000-8000-000000000011');
UPDATE public.recon_definitions
SET visibility='tenant', environment='development',
    governance_state='development_draft', access_mode='mapped_exact',
    multi_bu_governed=true
WHERE id='f4400000-0000-4000-8000-000000000026';
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;
INSERT INTO public.recon_definition_bu_grants(
  tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by
) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000026',
  'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000012','view',
  'f4400000-0000-4000-8000-000000000011'),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000026',
  'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000012','edit',
  'f4400000-0000-4000-8000-000000000011'),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000026',
  'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000013','view',
  'f4400000-0000-4000-8000-000000000011');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $owner_editor_update$
DECLARE updated_count integer;
BEGIN
  UPDATE public.recon_definitions SET name='Owner editor update'
  WHERE id='f4400000-0000-4000-8000-000000000026';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'owner-BU editor could not update an editable draft';
  END IF;
END
$owner_editor_update$;

-- This analyst can read the mapped definition and has the legacy tenant-wide
-- role, but has no owner-BU edit grant. The old UPDATE policy admitted them.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $view_only_update$
DECLARE updated_count integer;
BEGIN
  UPDATE public.recon_definitions SET name='Unauthorized analyst update'
  WHERE id='f4400000-0000-4000-8000-000000000026';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 0 OR NOT EXISTS (
    SELECT 1 FROM public.recon_definitions
    WHERE id='f4400000-0000-4000-8000-000000000026' AND name='Owner editor update'
  ) THEN
    RAISE EXCEPTION 'same-tenant analyst without owner edit changed a mapped definition';
  END IF;
END
$view_only_update$;

-- A platform-only actor and a member from a different tenant cannot mutate
-- the mapped row even though the legacy helper used to allow platform admin.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
DO $platform_only_update$
DECLARE updated_count integer;
BEGIN
  UPDATE public.recon_definitions SET name='Platform-only update'
  WHERE id='f4400000-0000-4000-8000-000000000026';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 0 THEN RAISE EXCEPTION 'platform-only user updated a tenant-mapped definition'; END IF;
END
$platform_only_update$;

SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $cross_tenant_update$
DECLARE updated_count integer;
BEGIN
  UPDATE public.recon_definitions SET name='Cross-tenant update'
  WHERE id='f4400000-0000-4000-8000-000000000024';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 0 THEN RAISE EXCEPTION 'cross-tenant analyst updated a mapped definition'; END IF;
END
$cross_tenant_update$;

-- Even an owner editor cannot physically delete a mapped draft: owner/grant
-- links and audit history are retained for governed lifecycle handling.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $view_only_delete$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000026';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 0 THEN RAISE EXCEPTION 'view-only analyst deleted a mapped draft'; END IF;
END
$view_only_delete$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $owner_editor_delete$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000026';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 0 OR NOT EXISTS (
    SELECT 1 FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000026'
  ) THEN
    RAISE EXCEPTION 'mapped draft was physically deleted despite retained owner/grant links';
  END IF;
END
$owner_editor_delete$;

-- Preserve the explicit legacy path: legacy tenant role and helper still allow
-- deletion of an unretired, unrun draft.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $legacy_delete$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM public.recon_definitions WHERE id='f4400000-0000-4000-8000-000000000027';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 1 THEN RAISE EXCEPTION 'legacy tenant analyst draft-delete path changed'; END IF;
END
$legacy_delete$;

RESET ROLE;
ROLLBACK;
