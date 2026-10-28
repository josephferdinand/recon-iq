-- Target-stage maker is the authenticated importer. Keep the signed source
-- requester as provenance, never as the target-stage four-eyes principal.
-- Coordinated cutover: apply this migration and deploy the three-argument app
-- together in a controlled release window. Either intermediate order fails
-- package imports closed: the old two-argument RPC loses service_role access,
-- while the new RPC does not exist before migration. Do not regrant the old
-- endpoint as rollback; forward-fix by deploying the matching app/migration.
-- Inventory pending target_review rows before cutover. Legacy unbound rows
-- remain blocked from decisions/execution until reimported via the new RPC;
-- a governed recovery must retain the original source and audit history.
DO $importer_cutover_precondition$
DECLARE v_paused boolean;
BEGIN
  IF to_regclass('public.environment_change_cutover_gate') IS NULL THEN
    RAISE EXCEPTION 'Install the environment-change pause gate before importer binding'
      USING ERRCODE='55000';
  END IF;
  SELECT gate.paused INTO v_paused
  FROM public.environment_change_cutover_gate gate
  WHERE gate.singleton=true
  FOR UPDATE;
  IF NOT FOUND OR v_paused IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pause and drain environment-change imports before importer binding'
      USING ERRCODE='55000';
  END IF;
END
$importer_cutover_precondition$;

ALTER TABLE public.environment_change_requests
  ADD COLUMN IF NOT EXISTS source_requester_email_hash text
    CHECK (source_requester_email_hash IS NULL OR source_requester_email_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE public.environment_change_events
  DROP CONSTRAINT environment_change_events_event_type_check;
ALTER TABLE public.environment_change_events
  ADD CONSTRAINT environment_change_events_event_type_check CHECK (event_type IN (
    'request_created','preflight_recorded','approved','rejected',
    'package_exported','package_transmitted','transport_failed','package_received',
    'target_importer_bound','access_mapping_confirmed',
    'execution_started','execution_succeeded','execution_failed','execution_rolled_back'
  ));

-- Rows received before importer binding have no trustworthy target maker.
-- Check OLD so a status change cannot simultaneously fabricate a binding.
CREATE OR REPLACE FUNCTION public.guard_unbound_target_environment_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $$
BEGIN
  IF OLD.approval_stage='target_review'
     AND OLD.source_requester_email_hash IS NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Target importer binding required before decision or execution';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_unbound_target_environment_change
BEFORE UPDATE ON public.environment_change_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_unbound_target_environment_change();

CREATE OR REPLACE FUNCTION public.append_environment_change_event(
  _request_id uuid,_event_type text,_actor_user_id uuid,_context jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  next_sequence integer;
  previous_hash text;
  event_time timestamptz := clock_timestamp();
  calculated_hash text;
  event_id bigint;
BEGIN
  IF _event_type NOT IN (
    'request_created','preflight_recorded','approved','rejected',
    'package_exported','package_transmitted','transport_failed','package_received',
    'target_importer_bound','access_mapping_confirmed',
    'execution_started','execution_succeeded','execution_failed','execution_rolled_back'
  ) THEN RAISE EXCEPTION 'Unsupported environment-change event'; END IF;
  PERFORM public.assert_environment_payload_safe(coalesce(_context,'{}'::jsonb));
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text,0));
  SELECT event_sequence+1,row_hash INTO next_sequence,previous_hash
  FROM public.environment_change_events WHERE request_id=_request_id
  ORDER BY event_sequence DESC LIMIT 1;
  next_sequence := coalesce(next_sequence,1);
  calculated_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'request_id',_request_id,'sequence',next_sequence,'event_type',_event_type,
    'actor_user_id',_actor_user_id,'context',coalesce(_context,'{}'::jsonb),
    'occurred_at',event_time,'prev_hash',previous_hash
  )::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.environment_change_events(
    request_id,event_sequence,event_type,actor_user_id,context,occurred_at,prev_hash,row_hash
  ) VALUES (
    _request_id,next_sequence,_event_type,_actor_user_id,coalesce(_context,'{}'::jsonb),
    event_time,previous_hash,calculated_hash
  ) RETURNING id INTO event_id;
  RETURN event_id;
END;
$$;

-- The two-argument receiver retains the original tenant-family/domain checks
-- and insert logic, but only this wrapper is granted to the service role.
CREATE OR REPLACE FUNCTION public.receive_environment_change_for_api(
  _request jsonb,_requester_email text,_target_importer_id uuid
) RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  received record;
  target public.environment_change_requests%ROWTYPE;
  source_hash text;
  prior_setting text;
  importer_email text;
  importer_email_count integer;
BEGIN
  IF _target_importer_id IS NULL OR
     lower(trim(coalesce(_request->>'source_requester_email','')))
       IS DISTINCT FROM lower(trim(coalesce(_requester_email,''))) THEN
    RAISE EXCEPTION 'Signed source requester and target importer are required';
  END IF;
  PERFORM public.assert_environment_change_actor(
    nullif(_request->>'target_tenant_id','')::uuid,_target_importer_id);
  source_hash := encode(extensions.digest(
    convert_to(lower(trim(_requester_email)),'UTF8'),'sha256'),'hex');
  IF _request->>'source_requester_email_hash' IS DISTINCT FROM source_hash THEN
    RAISE EXCEPTION 'Signed source requester hash is inconsistent';
  END IF;
  SELECT count(*),min(email) INTO importer_email_count,importer_email
  FROM auth.users WHERE id=_target_importer_id;
  IF importer_email_count<>1 OR nullif(trim(importer_email),'') IS NULL THEN
    RAISE EXCEPTION 'Target importer identity is unavailable';
  END IF;
  -- The legacy receiver uses its email argument only to resolve and authorize
  -- the target-stage actor. The signed source identity stays in _request and
  -- source_hash; it need not exist or hold privileges in this project.
  SELECT * INTO received FROM public.receive_environment_change_for_api(
    _request,importer_email);
  SELECT * INTO target FROM public.environment_change_requests
    WHERE id=received.request_id FOR UPDATE;
  IF target.approval_stage<>'target_review' OR target.status<>'pending_approval'
     OR target.control_tenant_id IS DISTINCT FROM nullif(_request->>'target_tenant_id','')::uuid
     OR target.source_tenant_id IS DISTINCT FROM nullif(_request->>'source_tenant_id','')::uuid
     OR target.source_project_ref IS DISTINCT FROM _request->>'source_project_ref'
     OR target.target_project_ref IS DISTINCT FROM _request->>'target_project_ref'
     OR target.direction IS DISTINCT FROM _request->>'direction'
     OR target.manifest_hash IS DISTINCT FROM received.manifest_hash THEN
    RAISE EXCEPTION 'Imported target request is inconsistent';
  END IF;
  IF target.source_requester_email_hash IS NOT NULL THEN
    IF target.requested_by IS DISTINCT FROM _target_importer_id
       OR target.source_requester_email_hash IS DISTINCT FROM source_hash THEN
      RAISE EXCEPTION 'Incoming package is already bound to another importer or source requester';
    END IF;
  ELSE
    -- New rows already name the target importer. A legacy unbound row can
    -- still name the old source requester until this governed reimport binds it.
    IF target.requested_by IS DISTINCT FROM _target_importer_id
       AND target.requested_by IS DISTINCT FROM (
         SELECT id FROM auth.users WHERE lower(email)=lower(trim(_requester_email))) THEN
      RAISE EXCEPTION 'Incoming package requester attribution is inconsistent';
    END IF;
    prior_setting := current_setting('app.environment_change_lifecycle',true);
    PERFORM set_config('app.environment_change_lifecycle','on',true);
    UPDATE public.environment_change_requests
      SET requested_by=_target_importer_id,source_requester_email_hash=source_hash
      WHERE id=target.id;
    PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
    PERFORM public.append_environment_change_event(target.id,'target_importer_bound',
      _target_importer_id,jsonb_build_object(
        'source_requester_email_hash',source_hash,
        'upstream_change_request_uid',target.upstream_change_request_uid,
        'manifest_hash',target.manifest_hash));
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (_target_importer_id,target.control_tenant_id,'tenant',
      'environment_change.package_imported','environment_change_request',target.id::text,
      jsonb_build_object('source_request_uid',target.upstream_change_request_uid,
        'source_requester_email_hash',source_hash,'manifest_hash',target.manifest_hash,
        'tenant_binding_enforced',true));
  END IF;
  RETURN QUERY SELECT received.request_id,received.change_request_uid,
    received.request_status,received.manifest_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_environment_change_for_api(jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.receive_environment_change_for_api(jsonb,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_environment_change_for_api(jsonb,text,uuid)
  TO service_role;

-- This event records payload export from SQL before application HMAC signing;
-- it is not proof that a signed file was created or delivered.
CREATE OR REPLACE FUNCTION public.export_approved_environment_change_for_transport(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  target public.environment_change_requests%ROWTYPE;
  requester_email text;
  approver_email text;
  payload jsonb;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR target.approval_stage<>'source_review' OR target.status<>'approved'
     OR target.decided_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the source checker can transport an approved package';
  END IF;
  SELECT lower(email) INTO requester_email FROM auth.users WHERE id=target.requested_by;
  SELECT lower(email) INTO approver_email FROM auth.users WHERE id=target.decided_by;
  payload := jsonb_build_object(
    'upstream_change_request_uid',target.change_request_uid,
    'upstream_manifest_hash',target.manifest_hash,
    'source_request_status',target.status,
    'source_project_ref',target.source_project_ref,
    'source_tenant_id',target.source_tenant_id,
    'source_environment',target.source_environment,
    'target_project_ref',target.target_project_ref,
    'target_tenant_id',target.target_tenant_id,
    'target_environment',target.target_environment,
    'direction',target.direction,
    'title',target.title,
    'reason',target.reason,
    'manifest',target.manifest,
    'source_requester_email',requester_email,
    'source_approver_email',approver_email,
    'source_requester_email_hash',encode(extensions.digest(convert_to(requester_email,'UTF8'),'sha256'),'hex'),
    'source_approver_email_hash',encode(extensions.digest(convert_to(approver_email,'UTF8'),'sha256'),'hex')
  );
  PERFORM public.append_environment_change_event(_request_id,'package_exported',auth.uid(),
    jsonb_build_object('manifest_hash',target.manifest_hash,
      'upstream_change_request_uid',target.change_request_uid,
      'export_stage','payload_before_signing'));
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (auth.uid(),target.control_tenant_id,'tenant','environment_change.package_exported',
    'environment_change_request',_request_id::text,
    jsonb_build_object('manifest_hash',target.manifest_hash,
      'upstream_change_request_uid',target.change_request_uid,
      'export_stage','payload_before_signing'));
  RETURN payload;
END;
$$;
