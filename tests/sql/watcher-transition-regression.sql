\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('11111111-1111-4111-8111-111111111111','watcher-probe@invalid.test',now(),now());
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('55555555-5555-4555-8555-555555555555','watcher-foreign@invalid.test',now(),now());
INSERT INTO public.tenants(id,slug,name,created_by)
VALUES ('22222222-2222-4222-8222-222222222222','watcher-probe','Watcher Probe','11111111-1111-4111-8111-111111111111');
INSERT INTO public.tenants(id,slug,name,created_by)
VALUES ('66666666-6666-4666-8666-666666666666','watcher-foreign','Watcher Foreign','55555555-5555-4555-8555-555555555555');
INSERT INTO public.tenant_members(tenant_id,user_id,role)
VALUES
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','tenant_admin'),
  ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','tenant_admin');
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,status,created_by)
VALUES ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Probe source','csv','ready','11111111-1111-4111-8111-111111111111');
INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,status,created_by)
VALUES ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666','Foreign source','csv','ready','55555555-5555-4555-8555-555555555555');
INSERT INTO public.data_watchers(id,tenant_id,data_source_id,name,watch_type,config,severity,enabled,created_by)
VALUES ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','Probe watcher','freshness','{"max_age_hours":1,"reminder_hours":24,"quarantine_on_alert":true}','warning',true,'11111111-1111-4111-8111-111111111111');

SELECT notification_created, source_quarantined
FROM public.record_data_watcher_evaluation('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','alert','upload_stale','{}','schedule',NULL,24,true,'2026-09-06T00:00:00Z');
SELECT notification_created, source_quarantined
FROM public.record_data_watcher_evaluation('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','alert','upload_stale','{}','schedule',NULL,24,true,'2026-09-06T01:00:00Z');
SELECT notification_created, source_quarantined
FROM public.record_data_watcher_evaluation('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','ok','within_freshness_window','{}','schedule',NULL,24,true,'2026-09-06T02:00:00Z');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.data_watchers(tenant_id,data_source_id,name,watch_type,config,severity,enabled,created_by)
    VALUES ('22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777','Cross tenant','freshness','{}','warning',true,'11111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'cross-tenant watcher unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-tenant watcher unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.data_watcher_events WHERE watcher_id='44444444-4444-4444-8444-444444444444') <> 3 THEN RAISE EXCEPTION 'event count mismatch'; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE tenant_id='22222222-2222-4222-8222-222222222222' AND kind IN ('watcher.alert','watcher.recovered')) <> 2 THEN RAISE EXCEPTION 'notification dedup mismatch'; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE tenant_id='22222222-2222-4222-8222-222222222222' AND action='watcher.evaluated') <> 3 THEN RAISE EXCEPTION 'audit count mismatch'; END IF;
  IF (SELECT last_state FROM public.data_watchers WHERE id='44444444-4444-4444-8444-444444444444') <> 'ok' THEN RAISE EXCEPTION 'recovery state mismatch'; END IF;
  IF (SELECT status FROM public.workspace_data_sources WHERE id='33333333-3333-4333-8333-333333333333') <> 'error' THEN RAISE EXCEPTION 'quarantine mismatch'; END IF;
  IF has_function_privilege('authenticated','public.record_data_watcher_evaluation(uuid,uuid,text,text,jsonb,text,uuid,numeric,boolean,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'authenticated privilege leak'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.data_watcher_events WHERE watcher_id='44444444-4444-4444-8444-444444444444') <> 0 THEN RAISE EXCEPTION 'foreign tenant event leak'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.data_watcher_events WHERE watcher_id='44444444-4444-4444-8444-444444444444') <> 3 THEN RAISE EXCEPTION 'own tenant event hidden'; END IF;
END $$;
RESET ROLE;

SELECT 'watcher_transition_PASS events=3 notifications=2 audits=3 final=ok quarantine=retained rls=isolated';
ROLLBACK;
