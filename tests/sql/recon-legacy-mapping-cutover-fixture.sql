-- Disposable replay fixture, installed before maker-checker guards so it can
-- represent pre-existing legacy definitions with their original nullable bu_id.
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name)
VALUES ('f4410000-0000-4000-8000-000000000001','Synthetic Assurance Cutover','f4410000-0000-4000-8000-000000000002','Synthetic Assurance Cutover'),
       ('f4410000-0000-4000-8000-000000000005','Synthetic Assurance Sibling','f4410000-0000-4000-8000-000000000006','Synthetic Assurance Sibling');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000001','reconiq-assurance-lab-prod','Synthetic Assurance Cutover','prod'),
 ('f4410000-0000-4000-8000-000000000004','f4410000-0000-4000-8000-000000000005','synthetic-assurance-sibling','Synthetic Assurance Sibling','prod');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4410000-0000-4000-8000-000000000011','cutover-admin@example.invalid',now(),now()),
 ('f4410000-0000-4000-8000-000000000012','cutover-maker@example.invalid',now(),now()),
 ('f4410000-0000-4000-8000-000000000013','cutover-checker@example.invalid',now(),now()),
 ('f4410000-0000-4000-8000-000000000014','cutover-sibling@example.invalid',now(),now());
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000012','tenant_analyst',true),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000013','tenant_analyst',true),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000014','tenant_analyst',true);
INSERT INTO public.business_units(id,tenant_id,name,code,parent_id,created_by) VALUES
 ('f4410000-0000-4000-8000-000000000041','f4410000-0000-4000-8000-000000000003','Assurance Lab — Synthetic QA','QA-ROOT',NULL,'f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000042','f4410000-0000-4000-8000-000000000003','Cash & Nostro','QA-CASH','f4410000-0000-4000-8000-000000000041','f4410000-0000-4000-8000-000000000011');
INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id,role,inherit_descendants,created_by) VALUES
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000041','f4410000-0000-4000-8000-000000000012','bu_member',true,'f4410000-0000-4000-8000-000000000011'),
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000041','f4410000-0000-4000-8000-000000000013','bu_member',true,'f4410000-0000-4000-8000-000000000011');
INSERT INTO public.tenant_groups(id,tenant_id,name) VALUES
 ('f4410000-0000-4000-8000-000000000045','f4410000-0000-4000-8000-000000000003','Synthetic Assurance checker group');
INSERT INTO public.tenant_group_members(group_id,user_id,added_by) VALUES
 ('f4410000-0000-4000-8000-000000000045','f4410000-0000-4000-8000-000000000013','f4410000-0000-4000-8000-000000000011');
INSERT INTO public.bu_group_assignments(tenant_id,bu_id,group_id,role,inherit_descendants,created_by) VALUES
 ('f4410000-0000-4000-8000-000000000003','f4410000-0000-4000-8000-000000000041','f4410000-0000-4000-8000-000000000045','bu_member',true,'f4410000-0000-4000-8000-000000000011');
INSERT INTO public.recon_definitions(id,tenant_id,recon_code,name,recon_type,sides,rules,status,bu_id,created_by,environment)
VALUES
 ('f4410000-0000-4000-8000-000000000021','f4410000-0000-4000-8000-000000000003','FVI-GEN-2WAY-000001','Synthetic legacy cash mapping','two_sided','[]','[]','active',NULL,'f4410000-0000-4000-8000-000000000012','production'),
 ('f4410000-0000-4000-8000-000000000022','f4410000-0000-4000-8000-000000000003','FVI-GEN-2WAY-000099','Synthetic legacy sibling mapping','two_sided','[]','[]','draft',NULL,'f4410000-0000-4000-8000-000000000012','production');
