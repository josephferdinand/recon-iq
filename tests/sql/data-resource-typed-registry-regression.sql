-- Disposable ordered-migration replay only; all synthetic fixtures are rolled back.
BEGIN;
INSERT INTO public.tenant_families(id,name,release_identity_uid,canonical_legal_name) VALUES
 ('f4400000-0000-4000-8000-000000000001','Typed Registry','f4400000-0000-4000-8000-000000000002','Typed Registry'),
 ('f4400000-0000-4000-8000-000000000005','Typed Registry Other','f4400000-0000-4000-8000-000000000006','Typed Registry Other');
INSERT INTO public.tenants(id,family_id,slug,name,environment) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000001','typed-registry','Typed Registry','dev'),
 ('f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000005','typed-registry-other','Typed Registry Other','dev');
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('f4400000-0000-4000-8000-000000000011','typed-admin@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000012','typed-member@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000013','typed-group-member@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000014','typed-inactive@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000015','typed-foreign@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000016','typed-platform-only@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000017','typed-viewer@example.invalid',now(),now()),
 ('f4400000-0000-4000-8000-000000000018','typed-group-only@example.invalid',now(),now());
INSERT INTO public.platform_roles(user_id,role)
VALUES ('f4400000-0000-4000-8000-000000000016','platform_admin');
INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000011','tenant_admin',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000012','tenant_viewer',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000013','tenant_analyst',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000014','tenant_admin',false),
 ('f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000015','tenant_admin',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000017','tenant_viewer',true),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000018','tenant_analyst',true);
INSERT INTO public.tenant_groups(id,tenant_id,name) VALUES
 ('f4400000-0000-4000-8000-000000000031','f4400000-0000-4000-8000-000000000003','Typed local'),
 ('f4400000-0000-4000-8000-000000000033','f4400000-0000-4000-8000-000000000003','Typed secondary group'),
 ('f4400000-0000-4000-8000-000000000032','f4400000-0000-4000-8000-000000000004','Typed foreign');
INSERT INTO public.tenant_group_members(group_id,user_id)
VALUES ('f4400000-0000-4000-8000-000000000031','f4400000-0000-4000-8000-000000000013'),
       ('f4400000-0000-4000-8000-000000000031','f4400000-0000-4000-8000-000000000018'),
       ('f4400000-0000-4000-8000-000000000033','f4400000-0000-4000-8000-000000000018');
INSERT INTO public.business_units(id,tenant_id,name,code) VALUES
 ('f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000003','Typed Owner BU','TR'),
 ('f4400000-0000-4000-8000-000000000043','f4400000-0000-4000-8000-000000000003','Typed Secondary BU','TS'),
 ('f4400000-0000-4000-8000-000000000042','f4400000-0000-4000-8000-000000000004','Typed Foreign BU','TF');
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type)
VALUES ('f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000003','Typed source','csv'),
       ('f4400000-0000-4000-8000-000000000022','f4400000-0000-4000-8000-000000000003','Unowned typed source','csv'),
       ('f4400000-0000-4000-8000-000000000023','f4400000-0000-4000-8000-000000000003','RPC typed source','csv');
INSERT INTO public.data_source_schedules(id,tenant_id,data_source_id,name,connector_type)
VALUES ('f4400000-0000-4000-8000-000000000025','f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000021','Typed schedule','manual'),
       ('f4400000-0000-4000-8000-000000000026','f4400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000021','Mismatched schedule','manual');
INSERT INTO public.data_resource_registry(id,tenant_id,resource_type,data_source_id,created_by)
VALUES ('f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000003','data_source','f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000011'),
       ('f4400000-0000-4000-8000-000000000052','f4400000-0000-4000-8000-000000000003','data_source','f4400000-0000-4000-8000-000000000022','f4400000-0000-4000-8000-000000000011');
INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id,created_by)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000011');
INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000012'),
       ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000011');
INSERT INTO public.bu_group_assignments(tenant_id,bu_id,group_id)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000031'),
       ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000033');
INSERT INTO public.data_resource_registry_grants(tenant_id,registry_id,bu_id,principal_type,principal_user_id,action,granted_by) VALUES
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000012','run','f4400000-0000-4000-8000-000000000011'),
 ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000012','approve','f4400000-0000-4000-8000-000000000011');
INSERT INTO public.data_resource_registry_grants(tenant_id,registry_id,bu_id,principal_type,principal_group_id,action,granted_by)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000041','group','f4400000-0000-4000-8000-000000000031','view','f4400000-0000-4000-8000-000000000011');

DO $$ BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.data_resource_registry'::regclass AND contype='f') <> 11 THEN
    RAISE EXCEPTION 'typed registry root/tenant FKs incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.data_resource_registry'::regclass AND conname='data_resource_registry_data_source_schedule_id_fkey') THEN
    RAISE EXCEPTION 'scheduled connector root FK missing';
  END IF;
  IF has_table_privilege('authenticated','public.data_resource_registry','SELECT')
     OR has_table_privilege('anon','public.data_resource_registry','SELECT')
     OR NOT has_table_privilege('service_role','public.data_resource_registry','SELECT') THEN
    RAISE EXCEPTION 'shadow registry table exposure differs from expected service-only posture';
  END IF;
  IF has_table_privilege('service_role','public.data_resource_registry_owner_audit','SELECT')
     OR has_table_privilege('service_role','public.data_resource_registry_grant_audit','SELECT') THEN
    RAISE EXCEPTION 'service role has direct access to retained audit tables';
  END IF;
  BEGIN
    INSERT INTO public.data_resource_registry(id,tenant_id,resource_type,data_source_id)
    VALUES ('f4400000-0000-4000-8000-000000000053','f4400000-0000-4000-8000-000000000004','data_source','f4400000-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'cross-tenant typed resource accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant typed resource accepted' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.data_resource_registry(id,tenant_id,resource_type,data_source_id,db_connection_id)
    VALUES ('f4400000-0000-4000-8000-000000000054','f4400000-0000-4000-8000-000000000003','data_source','f4400000-0000-4000-8000-000000000021','f4400000-0000-4000-8000-000000000021');
    RAISE EXCEPTION 'typed discriminator accepted multiple roots';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.workspace_data_sources SET tenant_id='f4400000-0000-4000-8000-000000000004' WHERE id='f4400000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'registered resource tenant reparent accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='registered resource tenant reparent accepted' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.workspace_data_sources WHERE id='f4400000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'registered resource root deletion accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000042');
    RAISE EXCEPTION 'cross-tenant BU owner accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant BU owner accepted' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.data_resource_registry_grants(tenant_id,registry_id,bu_id,principal_type,principal_user_id,action)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000015','run');
    RAISE EXCEPTION 'cross-tenant user grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant user grant accepted' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.data_resource_registry_grants(tenant_id,registry_id,bu_id,principal_type,principal_group_id,action)
    VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000051','f4400000-0000-4000-8000-000000000041','group','f4400000-0000-4000-8000-000000000032','run');
    RAISE EXCEPTION 'cross-tenant group grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant group grant accepted' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.data_resource_registry SET created_at=now() WHERE id='f4400000-0000-4000-8000-000000000051';
    RAISE EXCEPTION 'registry identity mutation accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='registry identity mutation accepted' THEN RAISE; END IF; END;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $$ BEGIN
  IF NOT public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','run') THEN RAISE EXCEPTION 'direct grant denied'; END IF;
  IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','view') THEN RAISE EXCEPTION 'group grant leaked to non-member'; END IF;
  IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','approve') THEN RAISE EXCEPTION 'generic SoD bypass allowed approval'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $$ BEGIN
  IF NOT public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','view') THEN RAISE EXCEPTION 'group grant denied'; END IF;
  IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','run') THEN RAISE EXCEPTION 'ungranted group action allowed'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.tenant_group_members WHERE group_id='f4400000-0000-4000-8000-000000000031' AND user_id='f4400000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $$ BEGIN IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','view') THEN RAISE EXCEPTION 'removed group membership remained effective'; END IF; END $$;
RESET ROLE;
UPDATE public.tenant_members SET active=false WHERE tenant_id='f4400000-0000-4000-8000-000000000003' AND user_id='f4400000-0000-4000-8000-000000000012';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $$ BEGIN
  IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','run') THEN RAISE EXCEPTION 'inactive tenant membership remained effective'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000017',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.register_typed_data_resource('data_source','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'viewer attempt');
    RAISE EXCEPTION 'tenant viewer registered typed resource';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='tenant viewer registered typed resource' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.register_typed_data_resource('data_source','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'foreign tenant admin attempt');
    RAISE EXCEPTION 'cross-tenant admin registered resource';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant admin registered resource' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','view') THEN RAISE EXCEPTION 'active same-tenant admin override denied'; END IF;
  IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000052','view') THEN RAISE EXCEPTION 'unowned resource allowed'; END IF;
  IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','approve') THEN RAISE EXCEPTION 'admin override bypassed workflow SoD'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000014',true);
DO $$ BEGIN IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','view') THEN RAISE EXCEPTION 'inactive tenant admin allowed'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
DO $$ BEGIN IF public.data_resource_shadow_allows('f4400000-0000-4000-8000-000000000051','view') THEN RAISE EXCEPTION 'foreign tenant admin allowed'; END IF; END $$;
RESET ROLE;

DELETE FROM public.data_resource_registry_grants WHERE registry_id='f4400000-0000-4000-8000-000000000051' AND action='run';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.data_resource_registry_grant_audit WHERE registry_id='f4400000-0000-4000-8000-000000000051' AND operation='REVOKE' AND action='run') <> 1 THEN RAISE EXCEPTION 'grant revoke audit was not retained'; END IF;
  IF (SELECT count(*) FROM public.data_resource_registry_owner_audit WHERE registry_id='f4400000-0000-4000-8000-000000000051' AND operation='INSERT') <> 1 THEN RAISE EXCEPTION 'owner insert audit was not retained'; END IF;
  BEGIN
    UPDATE public.data_resource_registry_grant_audit SET changed_at=now() WHERE registry_id='f4400000-0000-4000-8000-000000000051';
    RAISE EXCEPTION 'grant audit mutation accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='grant audit mutation accepted' THEN RAISE; END IF; END;
END $$;
-- Tenant-admin-only setup RPC surface, exercised against the other synthetic source.
INSERT INTO public.tenant_group_members(group_id,user_id)
VALUES ('f4400000-0000-4000-8000-000000000031','f4400000-0000-4000-8000-000000000013') ON CONFLICT DO NOTHING;
INSERT INTO public.bu_user_assignments(tenant_id,bu_id,user_id)
VALUES ('f4400000-0000-4000-8000-000000000003','f4400000-0000-4000-8000-000000000041','f4400000-0000-4000-8000-000000000013') ON CONFLICT DO NOTHING;
CREATE TEMP TABLE typed_rpc_context(registry_id uuid);
CREATE TEMP TABLE typed_rpc_grants(action text, grant_id uuid);
GRANT SELECT, INSERT ON typed_rpc_context TO authenticated;
GRANT SELECT, INSERT ON typed_rpc_grants TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.register_typed_data_resource('data_source','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'unauthorized registration');
    RAISE EXCEPTION 'analyst registered typed resource';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='analyst registered typed resource' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.register_typed_data_resource('data_source','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'platform-only attempt');
    RAISE EXCEPTION 'platform-only user registered tenant resource';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='platform-only user registered tenant resource' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.register_typed_data_resource('arbitrary_table','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'invalid type');
    RAISE EXCEPTION 'arbitrary resource type accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='arbitrary resource type accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.register_typed_data_resource('data_source','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000042'::uuid],'cross tenant BU');
    RAISE EXCEPTION 'cross-tenant owner BU accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant owner BU accepted' THEN RAISE; END IF; END;
  INSERT INTO pg_temp.typed_rpc_context(registry_id)
    VALUES (public.register_typed_data_resource('data_source','f4400000-0000-4000-8000-000000000023',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'explicit synthetic owner mapping'));
  BEGIN
    PERFORM public.grant_typed_data_resource_action((SELECT registry_id FROM pg_temp.typed_rpc_context),'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000015','view','cross tenant user attempt');
    RAISE EXCEPTION 'cross-tenant user grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant user grant accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.grant_typed_data_resource_action((SELECT registry_id FROM pg_temp.typed_rpc_context),'f4400000-0000-4000-8000-000000000041','group','f4400000-0000-4000-8000-000000000032','view','cross tenant group attempt');
    RAISE EXCEPTION 'cross-tenant group grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-tenant group grant accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_registry uuid;
BEGIN
  SELECT registry_id INTO v_registry FROM pg_temp.typed_rpc_context;
  BEGIN
    PERFORM public.grant_typed_data_resource_action(v_registry,'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000013','view','analyst cannot grant');
    RAISE EXCEPTION 'analyst grant RPC accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='analyst grant RPC accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_registry uuid; v_grant uuid;
BEGIN
  SELECT registry_id INTO v_registry FROM pg_temp.typed_rpc_context;
  CREATE TEMP TABLE typed_schedule_registry AS
    SELECT public.register_typed_data_source_schedule('f4400000-0000-4000-8000-000000000025',ARRAY['f4400000-0000-4000-8000-000000000041'::uuid],'explicit schedule scope') AS registry_id;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
    PERFORM public.register_typed_data_source_schedule('f4400000-0000-4000-8000-000000000026',ARRAY['f4400000-0000-4000-8000-000000000042'::uuid],'cross-root schedule attempt');
    RAISE EXCEPTION 'schedule referencing foreign-tenant source was registered';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='schedule referencing foreign-tenant source was registered' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
  v_grant := public.grant_typed_data_resource_action(v_registry,'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000013','view','explicit direct viewer grant');
  IF v_grant IS NULL THEN RAISE EXCEPTION 'direct grant RPC returned no id'; END IF;
  INSERT INTO pg_temp.typed_rpc_grants VALUES('direct',v_grant);
  v_grant := public.grant_typed_data_resource_action(v_registry,'f4400000-0000-4000-8000-000000000041','group','f4400000-0000-4000-8000-000000000031','view','explicit group viewer grant');
  IF v_grant IS NULL THEN RAISE EXCEPTION 'group grant RPC returned no id'; END IF;
  INSERT INTO pg_temp.typed_rpc_grants VALUES('group',v_grant);
  v_grant := public.grant_typed_data_resource_action(v_registry,'f4400000-0000-4000-8000-000000000041','group','f4400000-0000-4000-8000-000000000033','view','explicit second group viewer grant');
  IF v_grant IS NULL THEN RAISE EXCEPTION 'second group grant RPC returned no id'; END IF;
  INSERT INTO pg_temp.typed_rpc_grants VALUES('second_group',v_grant);
  PERFORM public.set_typed_data_resource_owners(v_registry,ARRAY['f4400000-0000-4000-8000-000000000041'::uuid,'f4400000-0000-4000-8000-000000000043'::uuid],'add explicit secondary owner');
  BEGIN
    PERFORM public.grant_typed_data_resource_action(v_registry,'f4400000-0000-4000-8000-000000000041','user','f4400000-0000-4000-8000-000000000011','approve','self approval attempt');
    RAISE EXCEPTION 'self-approval grant accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='self-approval grant accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Deliberately insert an out-of-contract grant as the database owner. The read
-- summary must still require current BU membership when evaluating it.
UPDATE public.tenant_members SET active=true WHERE tenant_id='f4400000-0000-4000-8000-000000000003' AND user_id='f4400000-0000-4000-8000-000000000012';
INSERT INTO public.data_resource_registry_grants(tenant_id,registry_id,bu_id,principal_type,principal_user_id,action,granted_by)
SELECT 'f4400000-0000-4000-8000-000000000003',registry_id,'f4400000-0000-4000-8000-000000000043','user','f4400000-0000-4000-8000-000000000012','view','f4400000-0000-4000-8000-000000000011'
FROM pg_temp.typed_rpc_context;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $$ DECLARE v_registry uuid;
BEGIN
  SELECT registry_id INTO v_registry FROM pg_temp.typed_rpc_context;
  IF NOT public.data_resource_shadow_allows(v_registry,'view') THEN RAISE EXCEPTION 'RPC direct grant did not authorize shadow view'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000018',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_registry uuid;
BEGIN
  SELECT registry_id INTO v_registry FROM pg_temp.typed_rpc_context;
  IF NOT public.data_resource_shadow_allows(v_registry,'view') THEN RAISE EXCEPTION 'RPC group grant did not authorize group-only member'; END IF;
  IF (SELECT count(*) FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000023'::uuid])) <> 1 THEN RAISE EXCEPTION 'group member access summary missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000023'::uuid]) s WHERE s.access_state='mapped' AND s.business_unit_names=ARRAY['Typed Owner BU']::text[] AND s.business_unit_count=1 AND s.user_group_names=ARRAY['Typed local','Typed secondary group']::text[] AND s.user_group_count=2) THEN RAISE EXCEPTION 'group summary leaked sibling scope or lost counts'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000023'::uuid])) THEN RAISE EXCEPTION 'sibling BU grant without BU membership exposed resource'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000021'::uuid])) THEN RAISE EXCEPTION 'user with non-view actions saw mapped resource summary'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000022'::uuid]) s WHERE s.access_state='unmapped' AND s.business_unit_count=0 AND s.user_group_count=0) THEN RAISE EXCEPTION 'legacy unmapped resource state missing'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000014',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000021'::uuid])) THEN RAISE EXCEPTION 'inactive tenant member saw resource summary'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000021'::uuid])) THEN RAISE EXCEPTION 'cross-tenant member saw resource summary'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000021'::uuid])) THEN RAISE EXCEPTION 'platform-only actor saw resource summary'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000021'::uuid]) s WHERE s.access_state='mapped' AND s.business_unit_count=1 AND s.user_group_names=ARRAY['Typed local']::text[]) THEN RAISE EXCEPTION 'tenant admin did not see mapped resource summary'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000023'::uuid]) s WHERE s.access_state='mapped' AND s.business_unit_names=ARRAY['Typed Owner BU','Typed Secondary BU']::text[] AND s.business_unit_count=2 AND s.user_group_names=ARRAY['Typed local','Typed secondary group']::text[] AND s.user_group_count=2) THEN RAISE EXCEPTION 'tenant admin did not see all owners and groups'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source',ARRAY['f4400000-0000-4000-8000-000000000022'::uuid]) s WHERE s.access_state='unmapped' AND s.business_unit_count=0) THEN RAISE EXCEPTION 'tenant admin did not see unmapped resource'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_data_resource_access_summary('data_source_schedule',ARRAY['f4400000-0000-4000-8000-000000000025'::uuid]) s WHERE s.access_state='mapped' AND s.public_id LIKE 'FVI-SCH-%' AND s.business_unit_names=ARRAY['Typed Owner BU']::text[]) THEN RAISE EXCEPTION 'tenant admin did not read typed schedule summary'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT public.revoke_typed_data_resource_action((SELECT grant_id FROM pg_temp.typed_rpc_grants WHERE action='group'),'revoke explicit group grant') THEN
    RAISE EXCEPTION 'group grant revoke RPC returned false';
  END IF;
END $$;
RESET ROLE;
DO $$ DECLARE v_registry uuid;
BEGIN
  SELECT registry_id INTO v_registry FROM pg_temp.typed_rpc_context;
  IF (SELECT count(*) FROM public.data_resource_registry_owner_audit WHERE registry_id=v_registry AND operation='INSERT' AND changed_by='f4400000-0000-4000-8000-000000000011') <> 2
     OR (SELECT count(*) FROM public.data_resource_registry_owner_audit WHERE registry_id=v_registry AND operation='DELETE' AND changed_by='f4400000-0000-4000-8000-000000000011') <> 0 THEN RAISE EXCEPTION 'admin owner audit mismatch'; END IF;
  IF (SELECT count(*) FROM public.data_resource_registry_grant_audit WHERE registry_id=v_registry AND operation IN ('GRANT','REVOKE') AND changed_by='f4400000-0000-4000-8000-000000000011') <> 5 THEN RAISE EXCEPTION 'admin grant/revoke audit readback mismatch'; END IF;
  IF (SELECT count(*) FROM public.data_resource_registry_admin_audit WHERE registry_id=v_registry AND actor_id='f4400000-0000-4000-8000-000000000011' AND length(reason)>=3 AND operation IN ('REGISTER','REPLACE_OWNERS','GRANT_ACTION','REVOKE_ACTION')) <> 6 THEN RAISE EXCEPTION 'reasoned admin audit readback mismatch'; END IF;
END $$;
ROLLBACK;
