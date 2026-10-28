-- Disposable DB only. Exercises authenticated RPC boundaries, audit, and readback.
BEGIN;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('f4400000-0000-4000-8000-000000000001','RPC Tenant','f4400000-0000-4000-8000-000000000002','RPC Tenant'),
 ('f4400000-0000-4000-8000-000000000005','RPC Other','f4400000-0000-4000-8000-000000000006','RPC Other');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000001','multi-bu-rpc','RPC Tenant','dev'),
 ('f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000005','multi-bu-rpc-other','RPC Other','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4400000-0000-4000-8000-000000000011','rpc-admin@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000012','rpc-viewer@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000013','rpc-outsider@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000012','tenant_analyst',true),
 ('f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000013','tenant_admin',true);
INSERT INTO public.business_units(id,tenant_id,name,code) VALUES
 ('f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000003','Fund Accounting','FA'),
 ('f4400000-0000-4000-8000-000000000042','f4400000-0000-4000-8000-000000000003','Transfer Agency','TA'),
 ('f4400000-0000-4000-8000-000000000043','f4400000-0000-4000-8000-000000000004','Other BU','OB');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000003','Governed setup','two_sided','[]','[]','draft');
INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id,inherit_descendants) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000012',true);
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000041');
UPDATE public.recon_definitions SET multi_bu_governed=true WHERE id='f4400000-0000-4000-8000-000000000021';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $test$
DECLARE v_id uuid; v_duplicate uuid; v_setup jsonb;
BEGIN
  PERFORM public.set_recon_owners('f4400000-0000-4000-8000-000000000021',
    ARRAY['f4400000-0000-4000-8000-000000000041'::uuid,'f4400000-0000-4000-8000-000000000042'::uuid], 'approved BU mapping');
  v_setup := public.get_recon_access_setup('f4400000-0000-4000-8000-000000000021');
  IF jsonb_array_length(v_setup->'owners') <> 2 THEN RAISE EXCEPTION 'atomic owner replacement failed'; END IF;
  BEGIN
    PERFORM public.set_recon_owners('f4400000-0000-4000-8000-000000000021',
      ARRAY['f4400000-0000-4000-8000-000000000043'::uuid], 'cross tenant rejection');
    RAISE EXCEPTION 'expected cross-tenant owner rejection';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'expected cross-tenant owner rejection' THEN RAISE; END IF;
  END;
  v_id := public.grant_recon_bu_action('f4400000-0000-4000-8000-000000000021',
    'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000012','view','viewer access');
  v_duplicate := public.grant_recon_bu_action('f4400000-0000-4000-8000-000000000021',
    'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000012','view','duplicate request');
  IF v_id IS DISTINCT FROM v_duplicate THEN RAISE EXCEPTION 'grant was not idempotent'; END IF;
  v_setup := public.get_recon_access_setup('f4400000-0000-4000-8000-000000000021');
  IF v_setup->>'multi_bu_governed' <> 'true' OR jsonb_array_length(v_setup->'owners') <> 2
     OR v_setup->>'is_tenant_admin' <> 'true' OR jsonb_array_length(v_setup->'available_business_units') <> 2 THEN
    RAISE EXCEPTION 'admin readback shape incorrect: %', v_setup;
  END IF;
END
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF (SELECT count(*) FROM public.recon_definition_bu_admin_audit
      WHERE recon_id='f4400000-0000-4000-8000-000000000021' AND operation='replace_owners') <> 1 THEN
    RAISE EXCEPTION 'owner audit missing';
  END IF;
  IF (SELECT count(*) FROM public.recon_definition_bu_admin_audit
      WHERE recon_id='f4400000-0000-4000-8000-000000000021' AND operation='grant_action') <> 1 THEN
    RAISE EXCEPTION 'grant audit missing or duplicated';
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $test$
DECLARE v_setup jsonb;
BEGIN
  v_setup := public.get_recon_access_setup('f4400000-0000-4000-8000-000000000021');
  IF v_setup->>'is_tenant_admin' <> 'false' OR jsonb_array_length(v_setup->'owners') <> 2
     OR v_setup->'available_principals' <> '[]'::jsonb THEN RAISE EXCEPTION 'viewer readback policy failed: %', v_setup; END IF;
  BEGIN
    PERFORM public.set_recon_owners('f4400000-0000-4000-8000-000000000021',
      ARRAY['f4400000-0000-4000-8000-000000000041'::uuid], 'must be denied');
    RAISE EXCEPTION 'expected non-admin owner mutation rejection';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'expected non-admin owner mutation rejection' THEN RAISE; END IF;
  END;
END
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $test$
DECLARE v_id uuid; v_setup jsonb;
BEGIN
  v_setup := public.get_recon_access_setup('f4400000-0000-4000-8000-000000000021');
  v_id := (v_setup->'grants'->0->>'grant_id')::uuid;
  PERFORM public.revoke_recon_bu_action(v_id, 'remove viewer access');
END
$test$;
RESET ROLE;
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.recon_definition_bu_admin_audit
      WHERE recon_id='f4400000-0000-4000-8000-000000000021' AND operation='revoke_action') <> 1 THEN
    RAISE EXCEPTION 'revoke audit missing';
  END IF;
END
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.get_recon_access_setup('f4400000-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'expected cross-tenant read rejection';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'expected cross-tenant read rejection' THEN RAISE; END IF;
  END;
END
$test$;
RESET ROLE;
ROLLBACK;
