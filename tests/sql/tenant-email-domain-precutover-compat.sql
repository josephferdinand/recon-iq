-- Disposable stage-one check: additive schema permits the old tenant writer.
BEGIN;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f4520000-0000-4000-8000-000000000001','Precutover fixture',
        'f4520000-0000-4000-8000-000000000002','Precutover fixture');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('f4520000-0000-4000-8000-000000000003',
        'f4520000-0000-4000-8000-000000000001','precutover-domain-fixture','Precutover fixture','dev');
DO $test$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug='precutover-domain-fixture') THEN
    RAISE EXCEPTION 'old tenant creation failed before cutover';
  END IF;
END $test$;
ROLLBACK;
