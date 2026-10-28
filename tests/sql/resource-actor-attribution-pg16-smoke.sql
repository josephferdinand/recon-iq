\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
 ('c1600000-0000-4000-8000-000000000011','pg16-maker@example.invalid',now(),now()),
 ('c1600000-0000-4000-8000-000000000012','pg16-editor@example.invalid',now(),now()),
 ('c1600000-0000-4000-8000-000000000013','pg16-spoof@example.invalid',now(),now()),
 ('c1600000-0000-4000-8000-000000000014','pg16-foreign@example.invalid',now(),now());
INSERT INTO public.profiles(id,email,full_name) VALUES
 ('c1600000-0000-4000-8000-000000000011','pg16-maker@example.invalid','PG16 Maker'),
 ('c1600000-0000-4000-8000-000000000012','pg16-editor@example.invalid','PG16 Editor'),
 ('c1600000-0000-4000-8000-000000000013','pg16-spoof@example.invalid','Do Not Attribute'),
 ('c1600000-0000-4000-8000-000000000014','pg16-foreign@example.invalid','Foreign Member');
INSERT INTO public.tenant_members(tenant_id,user_id,active) VALUES
 ('c1600000-0000-4000-8000-000000000201','c1600000-0000-4000-8000-000000000011',true),
 ('c1600000-0000-4000-8000-000000000201','c1600000-0000-4000-8000-000000000012',true),
 ('c1600000-0000-4000-8000-000000000201','c1600000-0000-4000-8000-000000000013',true),
 ('c1600000-0000-4000-8000-000000000202','c1600000-0000-4000-8000-000000000014',true),
 ('c1600000-0000-4000-8000-000000000201','c1600000-0000-4000-8000-000000000001',true);

-- Authenticated INSERT must stamp the verified request subject, not spoofed IDs.
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c1600000-0000-4000-8000-000000000011',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,created_by,
  created_by_actor_id,created_by_actor_status,updated_by_actor_id,updated_by_actor_status)
VALUES ('c1600000-0000-4000-8000-000000000111','c1600000-0000-4000-8000-000000000201',
  'c1600000-0000-4000-8000-000000000013',
  'c1600000-0000-4000-8000-000000000013','unattributed',
  'c1600000-0000-4000-8000-000000000013','unattributed');

-- Authenticated UPDATE preserves creation provenance and attributes editor.
SELECT set_config('request.jwt.claim.sub','c1600000-0000-4000-8000-000000000012',true);
UPDATE public.workspace_data_sources SET created_by_actor_id='c1600000-0000-4000-8000-000000000013',
  created_by_actor_status='unattributed',updated_by_actor_id='c1600000-0000-4000-8000-000000000013',
  updated_by_actor_status='unattributed'
WHERE id='c1600000-0000-4000-8000-000000000111';

-- A service action remains explicitly unattributed.
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.workspace_data_sources(id,tenant_id,created_by_actor_id,created_by_actor_status,updated_by_actor_id,updated_by_actor_status)
VALUES ('c1600000-0000-4000-8000-000000000112','c1600000-0000-4000-8000-000000000201',
  'c1600000-0000-4000-8000-000000000011','authenticated_user',
  'c1600000-0000-4000-8000-000000000011','authenticated_user');

-- A real row in another tenant must be omitted by the isolated visibility stub.
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c1600000-0000-4000-8000-000000000014',true);
INSERT INTO public.workspace_data_sources(id,tenant_id)
VALUES ('c1600000-0000-4000-8000-000000000113','c1600000-0000-4000-8000-000000000202');

DO $verify$
DECLARE v_actor uuid; v_actor_status text; v_label text; v_status text; v_count integer;
BEGIN
  SELECT created_by_actor_id,created_by_actor_status INTO v_actor,v_actor_status
  FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000111';
  IF v_actor <> 'c1600000-0000-4000-8000-000000000011' OR v_actor_status <> 'authenticated_user'
    OR (SELECT created_by FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000111') <> 'c1600000-0000-4000-8000-000000000013' THEN
    RAISE EXCEPTION 'authenticated insert attribution/spoof resistance failed or legacy created_by changed';
  END IF;
  IF (SELECT created_by_actor_id FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000111') <> 'c1600000-0000-4000-8000-000000000011'
    OR (SELECT updated_by_actor_id FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000111') <> 'c1600000-0000-4000-8000-000000000012'
    OR (SELECT updated_by_actor_status FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000111') <> 'authenticated_user'
    OR (SELECT updated_at FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000111') <> transaction_timestamp() THEN
    RAISE EXCEPTION 'authenticated update/editor or existing updated_at trigger alignment failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000112'
    AND created_by_actor_id IS NULL AND created_by_actor_status='unattributed'
    AND updated_by_actor_id IS NULL AND updated_by_actor_status='unattributed') THEN
    RAISE EXCEPTION 'service write was attributed to a human';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_data_sources WHERE id='c1600000-0000-4000-8000-000000000101'
    AND created_by_actor_id IS NULL AND created_by_actor_status IS NULL
    AND updated_by_actor_id IS NULL AND updated_by_actor_status IS NULL) THEN
    RAISE EXCEPTION 'historical unknown actor row was backfilled';
  END IF;
END
$verify$;

-- The profile projection returns safe labels/statuses only; no actor UUID/email.
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c1600000-0000-4000-8000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $projection$
DECLARE v_count integer; v_label text; v_status text; v_updated text; v_updated_status text;
BEGIN
  SELECT count(*) INTO v_count FROM public.get_resource_actor_summary('data_source',ARRAY[
    'c1600000-0000-4000-8000-000000000101'::uuid,
    'c1600000-0000-4000-8000-000000000111'::uuid,
    'c1600000-0000-4000-8000-000000000112'::uuid,
    'c1600000-0000-4000-8000-000000000113'::uuid
  ]);
  IF v_count <> 3 THEN RAISE EXCEPTION 'cross-tenant actor summary visibility gate failed'; END IF;
  SELECT created_by_label,created_by_status,updated_by_label,updated_by_status
  INTO v_label,v_status,v_updated,v_updated_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['c1600000-0000-4000-8000-000000000111'::uuid]);
  IF v_label <> 'PG16 Maker' OR v_status <> 'known' OR v_updated <> 'PG16 Editor' OR v_updated_status <> 'known' THEN
    RAISE EXCEPTION 'safe same-tenant actor labels/statuses failed';
  END IF;
  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['c1600000-0000-4000-8000-000000000112'::uuid]);
  IF v_label <> 'Unattributed' OR v_status <> 'unattributed' THEN
    RAISE EXCEPTION 'unattributed service status was not projected safely';
  END IF;
  SELECT created_by_label,created_by_status INTO v_label,v_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['c1600000-0000-4000-8000-000000000101'::uuid]);
  IF v_label <> 'Unknown' OR v_status <> 'unknown' THEN
    RAISE EXCEPTION 'historical NULL status was not projected as unknown';
  END IF;
END
$projection$;
RESET ROLE;

-- A profile full_name that is itself an email or UUID is not a safe display
-- name; the definer must suppress it even though the actor is authorized.
UPDATE public.profiles SET full_name='maker@example.invalid'
WHERE id='c1600000-0000-4000-8000-000000000011';
UPDATE public.profiles SET full_name='c1600000-0000-4000-8000-000000000012'
WHERE id='c1600000-0000-4000-8000-000000000012';
SET LOCAL ROLE authenticated;
DO $private_name$
DECLARE v_created text; v_created_status text; v_updated text; v_updated_status text;
BEGIN
  SELECT created_by_label,created_by_status,updated_by_label,updated_by_status
  INTO v_created,v_created_status,v_updated,v_updated_status
  FROM public.get_resource_actor_summary('data_source',ARRAY['c1600000-0000-4000-8000-000000000111'::uuid]);
  IF v_created <> 'Unknown' OR v_created_status <> 'unknown'
     OR v_updated <> 'Unknown' OR v_updated_status <> 'unknown' THEN
    RAISE EXCEPTION 'email/UUID-shaped profile names leaked through actor summary';
  END IF;
END
$private_name$;
RESET ROLE;
ROLLBACK;
