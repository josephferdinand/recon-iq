\set ON_ERROR_STOP on
BEGIN;

-- The full replay leaves the migration-only gate closed. Reopen explicitly
-- inside this rollback-only synthetic test, then exercise close/open behavior.
SELECT public.set_environment_change_cutover_pause(false,'Disposable two-stage fixture setup');

CREATE TEMP TABLE ep_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE ep_payload(value jsonb);
CREATE TEMP TABLE ep_rejection(security_event_id bigint,incident_id uuid,audit_id bigint,emails_queued integer);
GRANT SELECT,INSERT ON ep_ids,ep_payload,ep_rejection TO authenticated;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('a1111111-1111-4111-8111-111111111111','package-maker@invalid.test',now(),now()),
  ('a2222222-2222-4222-8222-222222222222','source-checker@invalid.test',now(),now()),
  ('a3333333-3333-4333-8333-333333333333','target-checker@invalid.test',now(),now()),
  ('a8888888-8888-4888-8888-888888888888','target-importer@invalid.test',now(),now());
INSERT INTO public.tenant_families(
  id,name,release_identity_uid,canonical_legal_name,verified_organization_domain
) VALUES
  ('a0000000-0000-4000-8000-000000000001','Package Organization',
   'a0000000-0000-4000-8000-000000000001','Package Organization','package.invalid.test'),
  ('b0000000-0000-4000-8000-000000000002','Wrong Organization',
   'b0000000-0000-4000-8000-000000000002','Wrong Organization','wrong.invalid.test');
INSERT INTO public.tenants(id,slug,name,environment,created_by,family_id) VALUES
  ('a4444444-4444-4444-8444-444444444444','package-source','Package Source','dev','a1111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001'),
  ('a5555555-5555-4555-8555-555555555555','package-target','Package Target','prod','a3333333-3333-4333-8333-333333333333','a0000000-0000-4000-8000-000000000001'),
  ('b5555555-5555-4555-8555-555555555555','wrong-target','Wrong Target','prod','a3333333-3333-4333-8333-333333333333','b0000000-0000-4000-8000-000000000002');
INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
  ('a4444444-4444-4444-8444-444444444444','a1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('a4444444-4444-4444-8444-444444444444','a2222222-2222-4222-8222-222222222222','tenant_admin'),
  ('a5555555-5555-4555-8555-555555555555','a8888888-8888-4888-8888-888888888888','tenant_admin'),
  ('a5555555-5555-4555-8555-555555555555','a3333333-3333-4333-8333-333333333333','tenant_admin'),
  ('b5555555-5555-4555-8555-555555555555','a1111111-1111-4111-8111-111111111111','tenant_admin'),
  ('b5555555-5555-4555-8555-555555555555','a8888888-8888-4888-8888-888888888888','tenant_admin'),
  ('b5555555-5555-4555-8555-555555555555','a3333333-3333-4333-8333-333333333333','tenant_admin');
UPDATE public.profiles SET email='target-checker@invalid.test'
WHERE id='a3333333-3333-4333-8333-333333333333';
INSERT INTO public.tenant_groups(id,tenant_id,name,is_system)
VALUES ('a6666666-6666-4666-8666-666666666666','a5555555-5555-4555-8555-555555555555','ABC',false);

INSERT INTO ep_ids
SELECT 'source',request_id FROM public.request_source_environment_change_as(jsonb_build_object(
  'direction','dev_to_prod','source_project_ref','YOUR_PROJECT_REF',
  'source_environment','dev','source_tenant_id','a4444444-4444-4444-8444-444444444444',
  'target_project_ref','YOUR_PROJECT_REF','target_environment','prod',
  'target_tenant_id','a5555555-5555-4555-8555-555555555555',
  'title','Promote ABC reconciliation','reason','Prove source and target approval with exact group mapping.',
  'manifest',jsonb_build_object(
    'package',jsonb_build_object('recon_definitions',jsonb_build_array(jsonb_build_object(
      'id','a7777777-7777-4777-8777-777777777777','name','ABC Cash Recon'))),
    'configuration','{}'::jsonb,
    'settings',jsonb_build_object(
      'tenant_identity',public.environment_tenant_identity('a4444444-4444-4444-8444-444444444444'),
      'access_grants',jsonb_build_array(jsonb_build_object(
        'recon_source_id','a7777777-7777-4777-8777-777777777777','recon_name','ABC Cash Recon',
        'principal_type','group','principal_name','ABC','permission','read')))),
  'validation_results','[{"check":"source_manifest","status":"pass"}]'::jsonb,
  'idempotency_key','two-stage-source-001'
),'a1111111-1111-4111-8111-111111111111');

DO $$ BEGIN
  BEGIN
    PERFORM public.decide_environment_change_as((SELECT id FROM ep_ids WHERE label='source'),true,'self approval',
      'a1111111-1111-4111-8111-111111111111');
    RAISE EXCEPTION 'source self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='source self approval unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;
SELECT public.decide_environment_change_as((SELECT id FROM ep_ids WHERE label='source'),true,
  'Independent source checker approved','a2222222-2222-4222-8222-222222222222');

SELECT public.set_environment_change_cutover_pause(true,'Disposable package export pause test');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
DO $paused_export$
DECLARE before_events integer; before_audits integer; did_export boolean := false;
BEGIN
  SELECT count(*) INTO before_events FROM public.environment_change_events
  WHERE request_id=(SELECT id FROM ep_ids WHERE label='source') AND event_type='package_exported';
  SELECT count(*) INTO before_audits FROM public.audit_log
  WHERE resource_id=(SELECT id::text FROM ep_ids WHERE label='source')
    AND action='environment_change.package_exported';
  BEGIN
    PERFORM public.export_approved_environment_change_for_transport(
      (SELECT id FROM ep_ids WHERE label='source'));
    did_export := true;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
  IF did_export THEN RAISE EXCEPTION 'source export unexpectedly passed the pause gate'; END IF;
  IF (SELECT count(*) FROM public.environment_change_events
      WHERE request_id=(SELECT id FROM ep_ids WHERE label='source') AND event_type='package_exported')<>before_events
     OR (SELECT count(*) FROM public.audit_log
         WHERE resource_id=(SELECT id::text FROM ep_ids WHERE label='source')
           AND action='environment_change.package_exported')<>before_audits THEN
    RAISE EXCEPTION 'paused source export left an event or audit side effect';
  END IF;
  IF (SELECT transport_status FROM public.environment_change_requests
      WHERE id=(SELECT id FROM ep_ids WHERE label='source')) IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'paused export changed the pending source transport state';
  END IF;
END
$paused_export$;
RESET ROLE;
SELECT public.set_environment_change_cutover_pause(false,'Disposable source export test reopen');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
INSERT INTO ep_payload SELECT public.export_approved_environment_change_for_transport(
  (SELECT id FROM ep_ids WHERE label='source'));
RESET ROLE;

DO $unauthorized_importer$
DECLARE target_rows_before integer;
BEGIN
  SELECT count(*) INTO target_rows_before FROM public.environment_change_requests
  WHERE approval_stage='target_review' AND upstream_change_request_uid=
    (SELECT change_request_uid FROM public.environment_change_requests
      WHERE id=(SELECT id FROM ep_ids WHERE label='source'));
  BEGIN
    PERFORM * FROM public.receive_environment_change_for_api(
      (SELECT value||jsonb_build_object('validation_results',
        '[{"check":"target_binding","status":"pass"}]'::jsonb) FROM ep_payload),
      'package-maker@invalid.test','a2222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'source-only checker unexpectedly bound a target importer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='source-only checker unexpectedly bound a target importer' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Environment change requires platform or tenant administrator%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.environment_change_requests
      WHERE approval_stage='target_review' AND upstream_change_request_uid=
        (SELECT change_request_uid FROM public.environment_change_requests
          WHERE id=(SELECT id FROM ep_ids WHERE label='source'))) IS DISTINCT FROM target_rows_before THEN
    RAISE EXCEPTION 'unauthorized importer created or changed a target request';
  END IF;
END
$unauthorized_importer$;

INSERT INTO ep_ids
SELECT 'target',request_id FROM public.receive_environment_change_for_api(
  (SELECT value||jsonb_build_object('validation_results','[{"check":"target_binding","status":"pass"}]'::jsonb) FROM ep_payload),
  'package-maker@invalid.test','a8888888-8888-4888-8888-888888888888'
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_members
    WHERE tenant_id='a5555555-5555-4555-8555-555555555555'
      AND user_id='a1111111-1111-4111-8111-111111111111' AND active) THEN
    RAISE EXCEPTION 'source maker unexpectedly has target tenant access';
  END IF;
END $$;

-- Simulate a pending target row received before the importer-binding migration.
-- The legacy function is callable here only by the migration/test owner; the
-- service_role grant is checked below and must remain revoked.
INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
  ('a5555555-5555-4555-8555-555555555555','a1111111-1111-4111-8111-111111111111','tenant_admin');
INSERT INTO ep_ids
SELECT 'legacy',request_id FROM public.receive_environment_change_for_api(
  (SELECT value||jsonb_build_object(
    'upstream_change_request_uid','FVI-CR-LEGACY-TEST',
    'validation_results','[{"check":"target_binding","status":"pass"}]'::jsonb
  ) FROM ep_payload),
  'package-maker@invalid.test'
);
DELETE FROM public.tenant_members
WHERE tenant_id='a5555555-5555-4555-8555-555555555555'
  AND user_id='a1111111-1111-4111-8111-111111111111';

DO $$ BEGIN
  IF (SELECT source_requester_email_hash FROM public.environment_change_requests
    WHERE id=(SELECT id FROM ep_ids WHERE label='legacy')) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy fixture unexpectedly bound';
  END IF;
  BEGIN
    PERFORM public.approve_incoming_environment_change_as((SELECT id FROM ep_ids WHERE label='legacy'),
      true,'Legacy importer self approval',true,'a8888888-8888-4888-8888-888888888888');
    RAISE EXCEPTION 'legacy target self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='legacy target self approval unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Target importer binding required%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_incoming_environment_change_as((SELECT id FROM ep_ids WHERE label='legacy'),
      true,'Legacy target checker',true,'a3333333-3333-4333-8333-333333333333');
    RAISE EXCEPTION 'unbound legacy target approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='unbound legacy target approval unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Target importer binding required%' THEN RAISE; END IF;
  END;
END $$;

-- A governed reimport binds the existing legacy row to the target importer
-- without granting the source maker any lasting target-tenant role.
DO $$
DECLARE rebound uuid;
BEGIN
  SELECT request_id INTO rebound FROM public.receive_environment_change_for_api(
    (SELECT value||jsonb_build_object(
      'upstream_change_request_uid','FVI-CR-LEGACY-TEST',
      'validation_results','[{"check":"target_binding","status":"pass"}]'::jsonb
    ) FROM ep_payload),
    'package-maker@invalid.test','a8888888-8888-4888-8888-888888888888');
  IF rebound IS DISTINCT FROM (SELECT id FROM ep_ids WHERE label='legacy') THEN
    RAISE EXCEPTION 'governed legacy reimport created a different request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.environment_change_requests
    WHERE id=rebound AND requested_by='a8888888-8888-4888-8888-888888888888'
      AND source_requester_email_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'legacy reimport failed to bind target importer';
  END IF;
END $$;

DO $$ BEGIN
  IF has_function_privilege('service_role',
    'public.receive_environment_change_for_api(jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'legacy receiver remains service-callable';
  END IF;
  BEGIN
    PERFORM * FROM public.receive_environment_change_for_api(
      (SELECT value||jsonb_build_object('validation_results',
        '[{"check":"target_binding","status":"pass"}]'::jsonb) FROM ep_payload),
      'package-maker@invalid.test','a3333333-3333-4333-8333-333333333333');
    RAISE EXCEPTION 'second importer unexpectedly claimed existing package';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='second importer unexpectedly claimed existing package' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%already bound to another importer%' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE wrong_payload jsonb;
BEGIN
  SELECT value||jsonb_build_object(
    'target_tenant_id','b5555555-5555-4555-8555-555555555555',
    'validation_results','[{"check":"target_binding","status":"pass"}]'::jsonb
  ) INTO wrong_payload FROM ep_payload;
  BEGIN
    PERFORM * FROM public.receive_environment_change_for_api(wrong_payload,
      'package-maker@invalid.test','a8888888-8888-4888-8888-888888888888');
    RAISE EXCEPTION 'cross-tenant package unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-tenant package unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not the same registered organization%' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO ep_rejection SELECT * FROM public.record_environment_package_rejection_for_api(
  'b5555555-5555-4555-8555-555555555555',
  'a3333333-3333-4333-8333-333333333333',
  jsonb_build_object(
    'reason_code','environment_package_tenant_mismatch',
    'selected_target_tenant_id','b5555555-5555-4555-8555-555555555555',
    'claimed_target_tenant_id','a5555555-5555-4555-8555-555555555555',
    'source_request_uid',(SELECT change_request_uid FROM public.environment_change_requests WHERE id=(SELECT id FROM ep_ids WHERE label='source')),
    'manifest_hash',(SELECT manifest_hash FROM public.environment_change_requests WHERE id=(SELECT id FROM ep_ids WHERE label='source')),
    'package_rejected',true
  )
);
SELECT public.record_environment_change_transport_for_api(
  (SELECT id FROM ep_ids WHERE label='source'),true,
  (SELECT change_request_uid FROM public.environment_change_requests WHERE id=(SELECT id FROM ep_ids WHERE label='target')),
  'a2222222-2222-4222-8222-222222222222'
);

DO $$ BEGIN
  IF (SELECT requested_by FROM public.environment_change_requests
    WHERE id=(SELECT id FROM ep_ids WHERE label='target'))
    IS DISTINCT FROM 'a8888888-8888-4888-8888-888888888888'::uuid THEN
    RAISE EXCEPTION 'target maker is not the authenticated importer';
  END IF;
  BEGIN
    PERFORM public.approve_incoming_environment_change_as((SELECT id FROM ep_ids WHERE label='target'),
      true,'Importer self approval',true,'a8888888-8888-4888-8888-888888888888');
    RAISE EXCEPTION 'target importer self approval unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='target importer self approval unexpectedly accepted' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Four-eyes: requester cannot approve%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_incoming_environment_change_as((SELECT id FROM ep_ids WHERE label='target'),
      true,'Target review without mappings',false,'a3333333-3333-4333-8333-333333333333');
    RAISE EXCEPTION 'target approval without mapping confirmation unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='target approval without mapping confirmation unexpectedly accepted' THEN RAISE; END IF;
  END;
END $$;
SELECT public.approve_incoming_environment_change_as((SELECT id FROM ep_ids WHERE label='target'),
  true,'Target reviewer confirmed exact ABC mapping',true,'a3333333-3333-4333-8333-333333333333');
SELECT public.start_environment_change_execution_for_api((SELECT id FROM ep_ids WHERE label='target'),
  'two-stage-exec-001','a8888888-8888-4888-8888-888888888888');
SELECT public.complete_environment_change_execution_for_api((SELECT id FROM ep_ids WHERE label='target'),
  'succeeded','[{"component":"package","status":"pass"},{"component":"configuration","status":"pass"},{"component":"settings","status":"pass"}]',
  '{"target_readback":"exact"}',null,'a8888888-8888-4888-8888-888888888888');

DO $$
DECLARE source_bad integer; target_bad integer;
BEGIN
  IF (SELECT transport_status FROM public.environment_change_requests WHERE id=(SELECT id FROM ep_ids WHERE label='source'))<>'succeeded' THEN
    RAISE EXCEPTION 'source transport outcome missing';
  END IF;
  IF (SELECT source_requester_email_hash FROM public.environment_change_requests
    WHERE id=(SELECT id FROM ep_ids WHERE label='target')) IS DISTINCT FROM
    encode(extensions.digest(convert_to('package-maker@invalid.test','UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION 'source requester provenance missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.environment_change_events
    WHERE request_id=(SELECT id FROM ep_ids WHERE label='source') AND event_type='package_exported'
      AND actor_user_id='a2222222-2222-4222-8222-222222222222'
      AND context->>'export_stage'='payload_before_signing') THEN
    RAISE EXCEPTION 'source export chain event missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log
    WHERE resource_id=(SELECT id::text FROM ep_ids WHERE label='source')
      AND action='environment_change.package_exported'
      AND actor_user_id='a2222222-2222-4222-8222-222222222222'
      AND context->>'export_stage'='payload_before_signing') THEN
    RAISE EXCEPTION 'source export audit missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.environment_change_events
    WHERE request_id=(SELECT id FROM ep_ids WHERE label='target') AND event_type='target_importer_bound'
      AND actor_user_id='a8888888-8888-4888-8888-888888888888') THEN
    RAISE EXCEPTION 'target importer chain event missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log
    WHERE resource_id=(SELECT id::text FROM ep_ids WHERE label='target')
      AND action='environment_change.package_imported'
      AND actor_user_id='a8888888-8888-4888-8888-888888888888') THEN
    RAISE EXCEPTION 'target importer audit missing';
  END IF;
  IF (SELECT access_mapping_preview->>'exact' FROM public.environment_change_requests WHERE id=(SELECT id FROM ep_ids WHERE label='target'))<>'1' THEN
    RAISE EXCEPTION 'exact ABC group mapping missing';
  END IF;
  IF (SELECT activation_status FROM public.environment_change_requests WHERE id=(SELECT id FROM ep_ids WHERE label='target'))<>'active' THEN
    RAISE EXCEPTION 'exactly mapped package did not activate';
  END IF;
  IF EXISTS (SELECT 1 FROM public.environment_change_requests
    WHERE control_tenant_id='b5555555-5555-4555-8555-555555555555') THEN
    RAISE EXCEPTION 'cross-tenant rejection created a target request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.security_events
    WHERE tenant_id='b5555555-5555-4555-8555-555555555555'
      AND event_type='environment_package_tenant_mismatch' AND severity='critical') THEN
    RAISE EXCEPTION 'cross-tenant security event missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.security_alert_incidents i
    JOIN public.security_alert_rules r ON r.id=i.rule_id
    WHERE i.tenant_id='b5555555-5555-4555-8555-555555555555'
      AND r.code='ENVIRONMENT_PACKAGE_TENANT_MISMATCH') THEN
    RAISE EXCEPTION 'cross-tenant incident missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log
    WHERE tenant_id='b5555555-5555-4555-8555-555555555555'
      AND action='environment_change.cross_tenant_import_rejected') THEN
    RAISE EXCEPTION 'cross-tenant audit record missing';
  END IF;
  IF coalesce((SELECT emails_queued FROM ep_rejection),0)<1 THEN
    RAISE EXCEPTION 'cross-tenant security email was not queued';
  END IF;
  SELECT count(*) INTO source_bad FROM (
    SELECT prev_hash,lag(row_hash) OVER (ORDER BY event_sequence) expected
    FROM public.environment_change_events WHERE request_id=(SELECT id FROM ep_ids WHERE label='source')
  ) q WHERE prev_hash IS DISTINCT FROM expected;
  SELECT count(*) INTO target_bad FROM (
    SELECT prev_hash,lag(row_hash) OVER (ORDER BY event_sequence) expected
    FROM public.environment_change_events WHERE request_id=(SELECT id FROM ep_ids WHERE label='target')
  ) q WHERE prev_hash IS DISTINCT FROM expected;
  IF source_bad<>0 OR target_bad<>0 THEN RAISE EXCEPTION 'two-stage audit chain invalid'; END IF;
END $$;

SELECT 'two_stage_environment_delivery_PASS source_four_eyes=yes importer_self_approval=rejected distinct_target_checker=approved transport=yes tenant_family=bound wrong_tenant=rejected incident=retained email=queued group_mapping=exact activation=active audit=hash_linked';
ROLLBACK;
