-- Disposable FVI database only. Exercises additive public exception IDs.
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f5300000-0000-4000-8000-000000000001','Exception IDs','f5300000-0000-4000-8000-000000000002','Exception IDs');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES ('f5300000-0000-4000-8000-000000000003','f5300000-0000-4000-8000-000000000001','exception-public-id','Exception Public IDs','dev');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f5300000-0000-4000-8000-000000000021','f5300000-0000-4000-8000-000000000003','Public ID fixture','two_sided','[]','[]','draft');
INSERT INTO public.recon_runs(id,tenant_id,definition_id,status)
VALUES ('f5300000-0000-4000-8000-000000000031','f5300000-0000-4000-8000-000000000003','f5300000-0000-4000-8000-000000000021','completed');
INSERT INTO public.recon_exceptions(id,tenant_id,run_id,reason)
VALUES ('f5300000-0000-4000-8000-000000000051','f5300000-0000-4000-8000-000000000003','f5300000-0000-4000-8000-000000000031','Unmatched: no counterpart on side B for key fixture'),
       ('f5300000-0000-4000-8000-000000000052','f5300000-0000-4000-8000-000000000003','f5300000-0000-4000-8000-000000000031','Rule failed: fixture');

DO $test$
DECLARE ids text[];
BEGIN
  SELECT array_agg(public_case_id ORDER BY public_case_id) INTO ids
  FROM public.recon_exceptions WHERE id IN (
    'f5300000-0000-4000-8000-000000000051','f5300000-0000-4000-8000-000000000052'
  );
  IF cardinality(ids) <> 2 OR ids[1] = ids[2]
     OR ids[1] !~ '^FVI-EXC-[A-F0-9]{32}$' THEN RAISE EXCEPTION 'public case IDs missing, duplicate, or malformed'; END IF;
  IF EXISTS (SELECT 1 FROM public.recon_exceptions WHERE id::text = public_case_id) THEN
    RAISE EXCEPTION 'public case ID reused an internal exception UUID';
  END IF;
  BEGIN
    UPDATE public.recon_exceptions SET public_case_id='FVI-EXC-00000000000000000000000000000001'
    WHERE id='f5300000-0000-4000-8000-000000000051';
    RAISE EXCEPTION 'public case ID mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'public case ID mutation unexpectedly succeeded' THEN RAISE; END IF;
  END;
END
$test$;

ROLLBACK;
