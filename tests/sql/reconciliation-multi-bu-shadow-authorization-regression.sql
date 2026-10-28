-- Disposable DB only. Exercises the auth.uid-bound shadow helper, never changes live access.
BEGIN;

INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f4300000-0000-4000-8000-000000000001','Multi BU Shadow','f4300000-0000-4000-8000-000000000002','Multi BU Shadow'),
       ('f4300000-0000-4000-8000-000000000005','Multi BU Shadow Other','f4300000-0000-4000-8000-000000000006','Multi BU Shadow Other');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000001','multi-bu-shadow','Multi BU Shadow','dev'),
 ('f4300000-0000-4000-8000-000000000004','f4300000-0000-4000-8000-000000000005','multi-bu-shadow-other','Multi BU Shadow Other','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4300000-0000-4000-8000-000000000011','shadow-admin@example.invalid',now(),now()),
 ('f4300000-0000-4000-8000-000000000012','shadow-direct@example.invalid',now(),now()),
 ('f4300000-0000-4000-8000-000000000013','shadow-group@example.invalid',now(),now()),
 ('f4300000-0000-4000-8000-000000000014','shadow-inactive@example.invalid',now(),now()),
 ('f4300000-0000-4000-8000-000000000015','shadow-platform-only@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000012','tenant_analyst',true),
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000013','tenant_analyst',true),
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000014','tenant_analyst',false),
 ('f4300000-0000-4000-8000-000000000004','f4300000-0000-4000-8000-000000000015','tenant_admin',true);
INSERT INTO public.platform_roles(user_id,role) VALUES ('f4300000-0000-4000-8000-000000000015','platform_admin');
INSERT INTO public.tenant_groups(id,tenant_id,name) VALUES
 ('f4300000-0000-4000-8000-000000000031','f4300000-0000-4000-8000-000000000003','Shadow group');
INSERT INTO public.tenant_group_members(group_id,user_id) VALUES
 ('f4300000-0000-4000-8000-000000000031','f4300000-0000-4000-8000-000000000013'),
 ('f4300000-0000-4000-8000-000000000031','f4300000-0000-4000-8000-000000000012');
INSERT INTO public.business_units(id,tenant_id,name,code) VALUES
 ('f4300000-0000-4000-8000-000000000041','f4300000-0000-4000-8000-000000000003','Fund Accounting','FA'),
 ('f4300000-0000-4000-8000-000000000042','f4300000-0000-4000-8000-000000000003','Transfer Agency','TA'),
 ('f4300000-0000-4000-8000-000000000043','f4300000-0000-4000-8000-000000000004','Foreign BU','FB');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type,sides,rules,status)
VALUES ('f4300000-0000-4000-8000-000000000021','f4300000-0000-4000-8000-000000000003','Governed multi owner','two_sided','[]','[]','draft'),
       ('f4300000-0000-4000-8000-000000000022','f4300000-0000-4000-8000-000000000003','Unmapped legacy','two_sided','[]','[]','draft'),
       ('f4300000-0000-4000-8000-000000000023','f4300000-0000-4000-8000-000000000003','Not opted in','two_sided','[]','[]','draft');
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id) VALUES
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000021','f4300000-0000-4000-8000-000000000041'),
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000021','f4300000-0000-4000-8000-000000000042');
UPDATE public.recon_definitions SET multi_bu_governed=true WHERE id='f4300000-0000-4000-8000-000000000021';
INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id,inherit_descendants) VALUES
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000041','f4300000-0000-4000-8000-000000000012',true),
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000042','f4300000-0000-4000-8000-000000000013',true);
INSERT INTO public.bu_group_assignments(tenant_id,bu_id,group_id,inherit_descendants) VALUES
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000042','f4300000-0000-4000-8000-000000000031',true);
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action) VALUES
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000021','f4300000-0000-4000-8000-000000000041','user','f4300000-0000-4000-8000-000000000012','run'),
 ('f4300000-0000-4000-8000-000000000003','f4300000-0000-4000-8000-000000000021','f4300000-0000-4000-8000-000000000042','group','f4300000-0000-4000-8000-000000000031','view');

-- Exercise only the authenticated wrapper, proving callers cannot select another actor.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4300000-0000-4000-8000-000000000012',true);
DO $test$
BEGIN
  IF NOT public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','run') THEN RAISE EXCEPTION 'direct user grant denied'; END IF;
  IF NOT public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','view') THEN RAISE EXCEPTION 'group grant did not union with direct grant'; END IF;
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000022','run') THEN RAISE EXCEPTION 'unmapped governed recon allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('reconciliation',ARRAY['f4300000-0000-4000-8000-000000000021'::uuid]) s WHERE s.access_state='mapped' AND s.business_unit_names=ARRAY['Transfer Agency']::text[] AND s.business_unit_count=1 AND s.user_group_names=ARRAY['Shadow group']::text[] AND s.user_group_count=1) THEN RAISE EXCEPTION 'reconciliation summary did not restrict names to effective group scope'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('reconciliation',ARRAY['f4300000-0000-4000-8000-000000000022'::uuid]) s WHERE s.access_state='unmapped' AND s.business_unit_count=0 AND s.user_group_count=0) THEN RAISE EXCEPTION 'unmapped legacy reconciliation state missing'; END IF;
END
$test$;
RESET ROLE;
DELETE FROM public.recon_definition_bu_grants
WHERE recon_id='f4300000-0000-4000-8000-000000000021' AND principal_type='user'
  AND principal_id='f4300000-0000-4000-8000-000000000012' AND action='run';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4300000-0000-4000-8000-000000000012',true);
DO $test$ BEGIN
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','run') THEN RAISE EXCEPTION 'revoked direct grant remained effective'; END IF;
END $test$;
RESET ROLE;
DELETE FROM public.recon_definition_bu_grants
WHERE recon_id='f4300000-0000-4000-8000-000000000021' AND principal_type='group'
  AND principal_id='f4300000-0000-4000-8000-000000000031' AND action='view';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4300000-0000-4000-8000-000000000013',true);
DO $test$
BEGIN
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','view') THEN RAISE EXCEPTION 'revoked group grant remained effective'; END IF;
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','edit') THEN RAISE EXCEPTION 'ungranted action allowed'; END IF;
END
$test$;
SELECT set_config('request.jwt.claim.sub','f4300000-0000-4000-8000-000000000014',true);
DO $test$ BEGIN
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','run') THEN RAISE EXCEPTION 'inactive membership allowed'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4300000-0000-4000-8000-000000000015',true);
DO $test$ BEGIN
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','view') THEN RAISE EXCEPTION 'platform-only actor allowed'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','f4300000-0000-4000-8000-000000000011',true);
DO $test$ BEGIN
  IF NOT public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','approve') THEN RAISE EXCEPTION 'active tenant admin should be automatic'; END IF;
  IF public.recon_multi_bu_shadow_allows('f4300000-0000-4000-8000-000000000021','unknown') THEN RAISE EXCEPTION 'unknown action allowed'; END IF;
END $test$;
RESET ROLE;
ROLLBACK;
