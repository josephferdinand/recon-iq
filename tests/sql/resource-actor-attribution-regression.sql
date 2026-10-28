-- Run after the ordered migration replay; fixtures are synthetic and rolled back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('a3400000-0000-4000-8000-000000000011','actor-maker@example.invalid',now(),now()),
  ('a3400000-0000-4000-8000-000000000012','actor-editor@example.invalid',now(),now()),
  ('a3400000-0000-4000-8000-000000000013','actor-spoof@example.invalid',now(),now());
INSERT INTO public.tenants(id,slug,name) VALUES
  ('a3400000-0000-4000-8000-000000000021','actor-tenant','Actor tenant'),
  ('a3400000-0000-4000-8000-000000000022','actor-other-tenant','Actor other tenant');
INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
  ('a3400000-0000-4000-8000-000000000021','a3400000-0000-4000-8000-000000000011','tenant_admin'),
  ('a3400000-0000-4000-8000-000000000021','a3400000-0000-4000-8000-000000000012','tenant_admin'),
  ('a3400000-0000-4000-8000-000000000022','a3400000-0000-4000-8000-000000000013','tenant_admin');

DO $check$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'workspace_data_sources','workspace_data_source_uploads','data_source_schedules',
    'rekon_db_connections','rekon_inline_api_sources','erp_connector_configs',
    'data_watchers','aidp_templates','aidp_documents','reference_data_tables',
    'data_prep_pipelines','recon_definitions'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=format('public.%I',v_table)::regclass
                   AND tgname='zz_resource_actor_attribution' AND NOT tgisinternal)
       OR (SELECT count(*) FROM pg_attribute WHERE attrelid=format('public.%I',v_table)::regclass
            AND attname IN ('created_by_actor_id','created_by_actor_status','updated_by_actor_id','updated_by_actor_status')
            AND NOT attisdropped) <> 4 THEN
      RAISE EXCEPTION 'resource actor attribution absent or incomplete on %',v_table;
    END IF;
  END LOOP;
END
$check$;

-- Signed user insert: spoofed actor UUIDs are overwritten with auth.uid().
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','a3400000-0000-4000-8000-000000000011',true);
INSERT INTO public.workspace_data_sources(
  id,tenant_id,name,source_type,created_by,created_by_actor_id,created_by_actor_status,
  updated_by_actor_id,updated_by_actor_status
) VALUES (
  'a3400000-0000-4000-8000-000000000031','a3400000-0000-4000-8000-000000000021',
  'Actor insert','csv','a3400000-0000-4000-8000-000000000013',
  'a3400000-0000-4000-8000-000000000013','unattributed',
  'a3400000-0000-4000-8000-000000000013','unattributed'
);
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_data_sources
    WHERE id='a3400000-0000-4000-8000-000000000031'
      AND created_by='a3400000-0000-4000-8000-000000000013'
      AND created_by_actor_id='a3400000-0000-4000-8000-000000000011'
      AND created_by_actor_status='authenticated_user'
      AND updated_by_actor_id='a3400000-0000-4000-8000-000000000011'
      AND updated_by_actor_status='authenticated_user') THEN
    RAISE EXCEPTION 'authenticated insert attribution/spoof resistance failed or legacy created_by changed';
  END IF;
END
$check$;

-- Different authenticated editor cannot rewrite creator provenance or spoof self.
SELECT set_config('request.jwt.claim.sub','a3400000-0000-4000-8000-000000000012',true);
UPDATE public.workspace_data_sources SET description='edited',
  created_by_actor_id='a3400000-0000-4000-8000-000000000013',
  created_by_actor_status='unattributed',
  updated_by_actor_id='a3400000-0000-4000-8000-000000000013',
  updated_by_actor_status='unattributed'
WHERE id='a3400000-0000-4000-8000-000000000031';
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_data_sources
    WHERE id='a3400000-0000-4000-8000-000000000031'
      AND created_by_actor_id='a3400000-0000-4000-8000-000000000011'
      AND created_by_actor_status='authenticated_user'
      AND updated_by_actor_id='a3400000-0000-4000-8000-000000000012'
      AND updated_by_actor_status='authenticated_user'
      AND updated_at=transaction_timestamp()) THEN
    RAISE EXCEPTION 'authenticated update attribution, creator preservation, or updated_at alignment failed';
  END IF;
END
$check$;

-- RLS remains tenant-authoritative: a member cannot update another tenant's row.
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type)
VALUES ('a3400000-0000-4000-8000-000000000041','a3400000-0000-4000-8000-000000000022','Foreign row','csv');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','a3400000-0000-4000-8000-000000000011',true);
UPDATE public.workspace_data_sources SET description='foreign write'
WHERE id='a3400000-0000-4000-8000-000000000041';
RESET ROLE;
DO $check$
BEGIN
  IF (SELECT description FROM public.workspace_data_sources WHERE id='a3400000-0000-4000-8000-000000000041') IS NOT NULL THEN
    RAISE EXCEPTION 'tenant RLS allowed cross-tenant resource update';
  END IF;
END
$check$;

-- Service-role writes are explicitly unattributed, with no claimed human actor.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,
  created_by_actor_id,created_by_actor_status,updated_by_actor_id,updated_by_actor_status)
VALUES ('a3400000-0000-4000-8000-000000000051','a3400000-0000-4000-8000-000000000021',
  'Service insert','csv','a3400000-0000-4000-8000-000000000011','authenticated_user',
  'a3400000-0000-4000-8000-000000000011','authenticated_user');
RESET ROLE;
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_data_sources
    WHERE id='a3400000-0000-4000-8000-000000000051'
      AND created_by_actor_id IS NULL AND created_by_actor_status='unattributed'
      AND updated_by_actor_id IS NULL AND updated_by_actor_status='unattributed') THEN
    RAISE EXCEPTION 'service-role event was not recorded as unattributed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_data_sources
    WHERE id='a3400000-0000-4000-8000-000000000003'
      AND created_by_actor_id IS NULL AND created_by_actor_status IS NULL
      AND updated_by_actor_id IS NULL AND updated_by_actor_status IS NULL) THEN
    RAISE EXCEPTION 'historical row was backfilled or not retained as unknown';
  END IF;
END
$check$;

ROLLBACK;
