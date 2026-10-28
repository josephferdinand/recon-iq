-- Execute in the disposable replay after migration 20260924210000 and before
-- 20260924235200 introduces recon_exceptions.public_case_id.
BEGIN;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f2100000-0000-4000-8000-000000000001','Run Result Staged QA','f2100000-0000-4000-8000-000000000002','Run Result Staged QA');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('f2100000-0000-4000-8000-000000000011','f2100000-0000-4000-8000-000000000001','run-result-staged','Run Result Staged QA','dev');
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('f2100000-0000-4000-8000-000000000021','run-result-staged@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active)
VALUES ('f2100000-0000-4000-8000-000000000011','f2100000-0000-4000-8000-000000000021','tenant_admin',true);
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f2100000-0000-4000-8000-000000000031','f2100000-0000-4000-8000-000000000011','Staged run','one_sided','[{"side_id":"A"}]','[]','active');
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status)
VALUES ('f2100000-0000-4000-8000-000000000041','f2100000-0000-4000-8000-000000000011','f2100000-0000-4000-8000-000000000031','completed');
INSERT INTO public.recon_exceptions(id,run_id,tenant_id,side,reason,payload)
VALUES ('f2100000-0000-4000-8000-000000000051','f2100000-0000-4000-8000-000000000041','f2100000-0000-4000-8000-000000000011','A','Staged item','{"row":{"account":"legacy"}}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f2100000-0000-4000-8000-000000000021',true);
DO $$
DECLARE result jsonb;
BEGIN
  result := public.get_recon_run_result_page(
    'f2100000-0000-4000-8000-000000000011',
    'f2100000-0000-4000-8000-000000000041', 0, 'all'
  );
  IF result IS NULL
    OR result->>'parent_count' <> '1'
    OR jsonb_array_length(result#>'{rows,0,exception_items}') <> 1
    OR result#>'{rows,0,exception_items,0}' ? 'public_case_id' THEN
    RAISE EXCEPTION 'Run Results RPC failed before public case IDs migration: %',result;
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
