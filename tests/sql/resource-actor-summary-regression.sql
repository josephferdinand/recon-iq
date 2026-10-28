-- Ordered-migration disposable regression. All actor/resource fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('b3500000-0000-4000-8000-000000000011','summary-admin@example.invalid',now(),now()),
 ('b3500000-0000-4000-8000-000000000012','summary-maker@example.invalid',now(),now()),
 ('b3500000-0000-4000-8000-000000000013','summary-inactive@example.invalid',now(),now()),
 ('b3500000-0000-4000-8000-000000000014','summary-removed@example.invalid',now(),now()),
 ('b3500000-0000-4000-8000-000000000015','summary-foreign@example.invalid',now(),now());
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('b3500000-0000-4000-8000-000000000001','Actor Summary','b3500000-0000-4000-8000-000000000011','Actor Summary');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000001','actor-summary','Actor Summary','dev'),
 ('b3500000-0000-4000-8000-000000000022','b3500000-0000-4000-8000-000000000001','actor-summary-other','Actor Summary Other','dev');
INSERT INTO public.profiles(id,email,full_name) VALUES
 ('b3500000-0000-4000-8000-000000000011','summary-admin@example.invalid','Summary Admin'),
 ('b3500000-0000-4000-8000-000000000012','summary-maker@example.invalid','Verified Maker'),
 ('b3500000-0000-4000-8000-000000000013','summary-inactive@example.invalid','Inactive Private Name'),
 ('b3500000-0000-4000-8000-000000000014','summary-removed@example.invalid','Removed Private Name'),
 ('b3500000-0000-4000-8000-000000000015','summary-foreign@example.invalid','Foreign Private Name')
ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name;
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000011','tenant_admin',true),
 ('b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000012','tenant_analyst',true),
 ('b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000013','tenant_viewer',true),
 ('b3500000-0000-4000-8000-000000000022','b3500000-0000-4000-8000-000000000015','tenant_admin',true);
INSERT INTO public.business_units(id,tenant_id,name,code) VALUES
 ('b3500000-0000-4000-8000-000000000031','b3500000-0000-4000-8000-000000000021','Summary Owner BU','AS');

-- The creator is a real active member. Use the trigger's authenticated context
-- directly to focus this server-side projection regression.
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000012',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type) VALUES
 ('b3500000-0000-4000-8000-000000000101','b3500000-0000-4000-8000-000000000021','Known actor','csv');
INSERT INTO public.data_source_schedules(id,tenant_id,data_source_id,name,connector_type) VALUES
 ('b3500000-0000-4000-8000-000000000201','b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000101','Summary schedule','manual');
INSERT INTO public.rekon_db_connections(id,tenant_id,name,dialect) VALUES
 ('b3500000-0000-4000-8000-000000000202','b3500000-0000-4000-8000-000000000021','Summary DB','postgres');
INSERT INTO public.rekon_inline_api_sources(id,tenant_id,name,url) VALUES
 ('b3500000-0000-4000-8000-000000000203','b3500000-0000-4000-8000-000000000021','Summary API','https://example.invalid');
INSERT INTO public.erp_connector_configs(id,tenant_id,connector_kind,display_name,auth_method) VALUES
 ('b3500000-0000-4000-8000-000000000204','b3500000-0000-4000-8000-000000000021','sap','Summary ERP','api_key');
INSERT INTO public.data_watchers(id,tenant_id,data_source_id,name,watch_type) VALUES
 ('b3500000-0000-4000-8000-000000000205','b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000101','Summary watcher','freshness');
INSERT INTO public.aidp_templates(id,tenant_id,name) VALUES
 ('b3500000-0000-4000-8000-000000000206','b3500000-0000-4000-8000-000000000021','Summary template');
INSERT INTO public.aidp_documents(id,tenant_id,original_filename,mime) VALUES
 ('b3500000-0000-4000-8000-000000000207','b3500000-0000-4000-8000-000000000021','summary.pdf','application/pdf');
INSERT INTO public.reference_data_tables(id,tenant_id,name) VALUES
 ('b3500000-0000-4000-8000-000000000208','b3500000-0000-4000-8000-000000000021','Summary reference');
INSERT INTO public.data_prep_pipelines(id,tenant_id,name) VALUES
 ('b3500000-0000-4000-8000-000000000209','b3500000-0000-4000-8000-000000000021','Summary pipeline');
INSERT INTO public.recon_definitions(id,tenant_id,name,recon_type) VALUES
 ('b3500000-0000-4000-8000-000000000210','b3500000-0000-4000-8000-000000000021','Summary reconciliation','one_sided');

-- Map one root to a BU so the wrapper is proven to inherit view gating from the
-- existing actor-scoped access summary for non-admins.
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000011',true);
SELECT public.register_typed_data_resource(
  'data_source','b3500000-0000-4000-8000-000000000101',
  ARRAY['b3500000-0000-4000-8000-000000000031'::uuid],
  'Resource actor summary regression BU mapping');

-- Exercise explicit unattributed, inactive, and removed actor projections.
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type) VALUES
 ('b3500000-0000-4000-8000-000000000102','b3500000-0000-4000-8000-000000000021','Unattributed actor','csv');
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000013',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type) VALUES
 ('b3500000-0000-4000-8000-000000000103','b3500000-0000-4000-8000-000000000021','Inactive actor','csv');
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000014',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type) VALUES
 ('b3500000-0000-4000-8000-000000000104','b3500000-0000-4000-8000-000000000021','Removed actor','csv');
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000015',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type) VALUES
 ('b3500000-0000-4000-8000-000000000105','b3500000-0000-4000-8000-000000000022','Foreign resource','csv');
UPDATE public.tenant_members SET active=false
WHERE tenant_id='b3500000-0000-4000-8000-000000000021' AND user_id='b3500000-0000-4000-8000-000000000013';

-- Give the caller access to the pre-234000 historical fixture tenant, without
-- changing its row's NULL actor columns.
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('a3400000-0000-4000-8000-000000000001','b3500000-0000-4000-8000-000000000011','tenant_admin',true);

DO $contract$
DECLARE v_names text[];
BEGIN
  SELECT proargnames INTO v_names FROM pg_proc
  WHERE oid='public.get_resource_actor_summary(text,uuid[])'::regprocedure;
  IF cardinality(v_names) <> 8 OR NOT v_names @> ARRAY['_resource_type','_resource_ids','resource_type','resource_id',
      'created_by_label','created_by_status','updated_by_label','updated_by_status']::text[] THEN
    RAISE EXCEPTION 'actor summary API output contract changed unexpectedly';
  END IF;
  IF has_function_privilege('anon','public.get_resource_actor_summary(text,uuid[])','EXECUTE')
     OR has_function_privilege('service_role','public.get_resource_actor_summary(text,uuid[])','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_resource_actor_summary(text,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'actor summary execute grants are not least-privilege';
  END IF;
  IF has_function_privilege('authenticated','private.resource_actor_display_label(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'private actor label resolver must not be directly callable';
  END IF;
END
$contract$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000011',true);

DO $visible$
DECLARE v_count integer; v_label text; v_status text;
BEGIN
  SELECT count(*) INTO v_count FROM public.get_resource_actor_summary('data_source',ARRAY[
    'b3500000-0000-4000-8000-000000000101'::uuid,
    'b3500000-0000-4000-8000-000000000102'::uuid,
    'b3500000-0000-4000-8000-000000000103'::uuid,
    'b3500000-0000-4000-8000-000000000104'::uuid,
    'b3500000-0000-4000-8000-000000000105'::uuid,
    'a3400000-0000-4000-8000-000000000003'::uuid
  ]);
  IF v_count <> 5 THEN RAISE EXCEPTION 'foreign resource was returned or visible actor summary count mismatch'; END IF;

  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['b3500000-0000-4000-8000-000000000101'::uuid]);
  IF v_label <> 'Verified Maker' OR v_status <> 'known' THEN RAISE EXCEPTION 'same-tenant known actor label mismatch'; END IF;
  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['b3500000-0000-4000-8000-000000000102'::uuid]);
  IF v_label <> 'Unattributed' OR v_status <> 'unattributed' THEN RAISE EXCEPTION 'service actor must stay unattributed'; END IF;
  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['b3500000-0000-4000-8000-000000000103'::uuid]);
  IF v_label <> 'Inactive user' OR v_status <> 'inactive' THEN RAISE EXCEPTION 'inactive actor did not receive generic label'; END IF;
  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['b3500000-0000-4000-8000-000000000104'::uuid]);
  IF v_label <> 'Unavailable' OR v_status <> 'removed' THEN RAISE EXCEPTION 'removed actor did not receive generic label'; END IF;
  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['a3400000-0000-4000-8000-000000000003'::uuid]);
  IF v_label <> 'Unknown' OR v_status <> 'unknown' THEN RAISE EXCEPTION 'historical actor did not remain unknown'; END IF;
END
$visible$;

RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000012',true);
SET LOCAL ROLE authenticated;
DO $bu_gate$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.get_resource_actor_summary('data_source',ARRAY['b3500000-0000-4000-8000-000000000101'::uuid]);
  IF v_count <> 0 THEN RAISE EXCEPTION 'ungranted analyst saw a BU-mapped actor summary'; END IF;
END
$bu_gate$;
RESET ROLE;
INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id)
VALUES ('b3500000-0000-4000-8000-000000000021','b3500000-0000-4000-8000-000000000031','b3500000-0000-4000-8000-000000000012');
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000011',true);
SELECT public.grant_typed_data_resource_action(
  (SELECT id FROM public.data_resource_registry WHERE data_source_id='b3500000-0000-4000-8000-000000000101'),
  'b3500000-0000-4000-8000-000000000031','user','b3500000-0000-4000-8000-000000000012','view',
  'Resource actor summary regression view grant');
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000012',true);
SET LOCAL ROLE authenticated;
DO $bu_grant$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.get_resource_actor_summary('data_source',ARRAY['b3500000-0000-4000-8000-000000000101'::uuid]);
  IF v_count <> 1 THEN RAISE EXCEPTION 'valid BU-scoped view grant did not expose actor summary'; END IF;
END
$bu_grant$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b3500000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;

-- Exercise every supported resource root mapping. Upload children are explicitly
-- unsupported until a parent-source authorization contract exists.
DO $roots$
DECLARE v_type text; v_id uuid; v_count integer;
BEGIN
  FOR v_type,v_id IN SELECT * FROM (VALUES
    ('data_source_schedule','b3500000-0000-4000-8000-000000000201'::uuid),
    ('db_connection','b3500000-0000-4000-8000-000000000202'::uuid),
    ('inline_api_source','b3500000-0000-4000-8000-000000000203'::uuid),
    ('erp_connection','b3500000-0000-4000-8000-000000000204'::uuid),
    ('file_watcher','b3500000-0000-4000-8000-000000000205'::uuid),
    ('aidp_template','b3500000-0000-4000-8000-000000000206'::uuid),
    ('aidp_document','b3500000-0000-4000-8000-000000000207'::uuid),
    ('reference_table','b3500000-0000-4000-8000-000000000208'::uuid),
    ('data_prep_pipeline','b3500000-0000-4000-8000-000000000209'::uuid),
    ('reconciliation','b3500000-0000-4000-8000-000000000210'::uuid)
  ) x(resource_type,resource_id)
  LOOP
    SELECT count(*) INTO v_count FROM public.get_resource_actor_summary(v_type,ARRAY[v_id]);
    IF v_count <> 1 THEN RAISE EXCEPTION 'actor summary mapping failed for %',v_type; END IF;
  END LOOP;
  BEGIN
    PERFORM * FROM public.get_resource_actor_summary('data_source_upload',ARRAY['b3500000-0000-4000-8000-000000000301'::uuid]);
    RAISE EXCEPTION 'upload child type should be explicitly unsupported';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.get_resource_actor_summary('data_source',ARRAY(SELECT gen_random_uuid() FROM generate_series(1,101)));
    RAISE EXCEPTION 'more than 100 resource IDs should be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.get_resource_actor_summary('data_source',ARRAY[]::uuid[]);
    RAISE EXCEPTION 'empty ID batch should be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$roots$;

RESET ROLE;
ROLLBACK;
