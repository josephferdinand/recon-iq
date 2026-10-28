-- Disposable database only. Prove the Workspace personal-audit policy after
-- 20260927104500; all fixture rows roll back. Do not run on hosted projects.
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES
  ('e7000000-0000-4000-8000-000000000001','Audit RLS A','e7000000-0000-4000-8000-000000000002','Audit RLS A'),
  ('e7000000-0000-4000-8000-000000000003','Audit RLS B','e7000000-0000-4000-8000-000000000004','Audit RLS B');
INSERT INTO public.tenants(id,family_id,slug,name,environment)
VALUES
  ('e7000000-0000-4000-8000-000000000011','e7000000-0000-4000-8000-000000000001','personal-audit-rls-a','Audit RLS A','dev'),
  ('e7000000-0000-4000-8000-000000000012','e7000000-0000-4000-8000-000000000003','personal-audit-rls-b','Audit RLS B','dev');
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES
  ('e7000000-0000-4000-8000-000000000021','audit-self@example.invalid',now(),now()),
  ('e7000000-0000-4000-8000-000000000022','audit-peer@example.invalid',now(),now()),
  ('e7000000-0000-4000-8000-000000000023','audit-admin@example.invalid',now(),now()),
  ('e7000000-0000-4000-8000-000000000024','audit-inactive@example.invalid',now(),now()),
  ('e7000000-0000-4000-8000-000000000025','audit-foreign@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active)
VALUES
  ('e7000000-0000-4000-8000-000000000011','e7000000-0000-4000-8000-000000000021','tenant_viewer',true),
  ('e7000000-0000-4000-8000-000000000011','e7000000-0000-4000-8000-000000000022','tenant_viewer',true),
  ('e7000000-0000-4000-8000-000000000011','e7000000-0000-4000-8000-000000000023','tenant_admin',true),
  ('e7000000-0000-4000-8000-000000000011','e7000000-0000-4000-8000-000000000024','tenant_viewer',false),
  ('e7000000-0000-4000-8000-000000000012','e7000000-0000-4000-8000-000000000025','tenant_viewer',true);
INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
VALUES
  ('e7000000-0000-4000-8000-000000000021','e7000000-0000-4000-8000-000000000011','tenant','audit.rls.self','test','self','{}'),
  ('e7000000-0000-4000-8000-000000000022','e7000000-0000-4000-8000-000000000011','tenant','audit.rls.peer','test','peer','{}'),
  ('e7000000-0000-4000-8000-000000000024','e7000000-0000-4000-8000-000000000011','tenant','audit.rls.inactive','test','inactive','{}'),
  ('e7000000-0000-4000-8000-000000000025','e7000000-0000-4000-8000-000000000012','tenant','audit.rls.foreign','test','foreign','{}');

DO $policy_shape$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname='public' AND tablename='audit_log' AND cmd IN ('SELECT','ALL')
    AND permissive='PERMISSIVE';
  IF n <> 2 THEN
    RAISE EXCEPTION 'audit_log must have exactly tenant and platform permissive SELECT policies; found %', n;
  END IF;
END
$policy_shape$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e7000000-0000-4000-8000-000000000021',true);
DO $self$
DECLARE own_count integer; peer_count integer; foreign_count integer;
BEGIN
  SELECT count(*) INTO own_count FROM public.audit_log WHERE action='audit.rls.self';
  SELECT count(*) INTO peer_count FROM public.audit_log WHERE action='audit.rls.peer';
  SELECT count(*) INTO foreign_count FROM public.audit_log WHERE action='audit.rls.foreign';
  IF own_count <> 1 OR peer_count <> 0 OR foreign_count <> 0 THEN
    RAISE EXCEPTION 'ordinary actor scope failed own=% peer=% foreign=%', own_count, peer_count, foreign_count;
  END IF;
END
$self$;

SELECT set_config('request.jwt.claim.sub','e7000000-0000-4000-8000-000000000023',true);
DO $tenant_admin$
DECLARE local_count integer; foreign_count integer;
BEGIN
  SELECT count(*) INTO local_count FROM public.audit_log
  WHERE action IN ('audit.rls.self','audit.rls.peer','audit.rls.inactive');
  SELECT count(*) INTO foreign_count FROM public.audit_log WHERE action='audit.rls.foreign';
  IF local_count <> 3 OR foreign_count <> 0 THEN
    RAISE EXCEPTION 'tenant admin forensic scope failed local=% foreign=%', local_count, foreign_count;
  END IF;
END
$tenant_admin$;

SELECT set_config('request.jwt.claim.sub','e7000000-0000-4000-8000-000000000024',true);
DO $inactive$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.audit_log WHERE action='audit.rls.inactive';
  IF n <> 0 THEN RAISE EXCEPTION 'inactive membership read own audit'; END IF;
END
$inactive$;

SELECT set_config('request.jwt.claim.sub','e7000000-0000-4000-8000-000000000025',true);
DO $foreign$
DECLARE own_count integer; tenant_a_count integer;
BEGIN
  SELECT count(*) INTO own_count FROM public.audit_log WHERE action='audit.rls.foreign';
  SELECT count(*) INTO tenant_a_count FROM public.audit_log WHERE tenant_id='e7000000-0000-4000-8000-000000000011';
  IF own_count <> 1 OR tenant_a_count <> 0 THEN
    RAISE EXCEPTION 'foreign tenant scope failed own=% tenant_a=%', own_count, tenant_a_count;
  END IF;
END
$foreign$;
RESET ROLE;
ROLLBACK;
