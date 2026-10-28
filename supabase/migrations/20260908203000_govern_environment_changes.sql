-- Govern cross-project FVI DEV <-> PROD delivery through a PROD-authoritative
-- change request, independent checker and append-only hash-linked event history.

CREATE TABLE IF NOT EXISTS public.environment_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_uid text NOT NULL UNIQUE,
  control_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('dev_to_prod','prod_to_dev')),
  source_project_ref text NOT NULL,
  source_tenant_id uuid NOT NULL,
  source_environment text NOT NULL CHECK (source_environment IN ('dev','prod')),
  target_project_ref text NOT NULL,
  target_tenant_id uuid NOT NULL,
  target_environment text NOT NULL CHECK (target_environment IN ('dev','prod')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  package_hash text NOT NULL CHECK (package_hash ~ '^[0-9a-f]{64}$'),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  settings_hash text NOT NULL CHECK (settings_hash ~ '^[0-9a-f]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','rejected','executing','succeeded','failed','rolled_back')),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_comment text,
  validation_results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_results) = 'array'),
  component_results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(component_results) = 'array'),
  failed_components text[] NOT NULL DEFAULT '{}'::text[],
  execution_id text,
  executed_by uuid REFERENCES auth.users(id),
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  deployment_outcome text,
  rollback_reason text,
  final_readback jsonb,
  final_readback_hash text CHECK (final_readback_hash IS NULL OR final_readback_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT environment_change_direction_ck CHECK (
    source_environment <> target_environment
    AND (
      (direction='dev_to_prod' AND source_environment='dev' AND target_environment='prod')
      OR (direction='prod_to_dev' AND source_environment='prod' AND target_environment='dev')
    )
  ),
  CONSTRAINT environment_change_four_eyes_ck CHECK (
    decided_by IS NULL OR decided_by IS DISTINCT FROM requested_by
  ),
  UNIQUE (control_tenant_id,requested_by,idempotency_key)
);

CREATE INDEX IF NOT EXISTS environment_change_requests_status_idx
  ON public.environment_change_requests(control_tenant_id,status,requested_at DESC);

CREATE TABLE IF NOT EXISTS public.environment_change_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.environment_change_requests(id) ON DELETE RESTRICT,
  event_sequence integer NOT NULL CHECK (event_sequence > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'request_created','preflight_recorded','approved','rejected',
    'execution_started','execution_succeeded','execution_failed','execution_rolled_back'
  )),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  occurred_at timestamptz NOT NULL,
  prev_hash text,
  row_hash text NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (request_id,event_sequence)
);

CREATE INDEX IF NOT EXISTS environment_change_events_request_idx
  ON public.environment_change_events(request_id,event_sequence);

ALTER TABLE public.environment_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.environment_change_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.environment_change_requests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.environment_change_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.environment_change_requests FROM service_role;
REVOKE ALL ON public.environment_change_events FROM service_role;
GRANT SELECT ON public.environment_change_requests,public.environment_change_events TO authenticated;
GRANT SELECT ON public.environment_change_requests,public.environment_change_events TO service_role;

DROP POLICY IF EXISTS environment_change_requests_read ON public.environment_change_requests;
CREATE POLICY environment_change_requests_read ON public.environment_change_requests
FOR SELECT TO authenticated USING (
  public.is_platform_admin(auth.uid())
  OR public.is_tenant_member(auth.uid(),control_tenant_id)
);

DROP POLICY IF EXISTS environment_change_events_read ON public.environment_change_events;
CREATE POLICY environment_change_events_read ON public.environment_change_events
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.environment_change_requests r
    WHERE r.id=request_id
      AND (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(),r.control_tenant_id))
  )
);

CREATE OR REPLACE FUNCTION public.assert_environment_change_actor(
  _control_tenant_id uuid,
  _actor_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF _actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Active environment-change actor is required';
  END IF;
  IF NOT public.is_platform_admin(_actor_user_id)
     AND NOT public.has_tenant_role(_actor_user_id,_control_tenant_id,'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Environment change requires platform or tenant administrator';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_environment_payload_safe(_payload jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $$
DECLARE raw text;
BEGIN
  IF _payload IS NULL THEN RETURN; END IF;
  raw := _payload::text;
  IF raw ~* '"[^"]*(password|secret|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|service[_ -]?role|connection[_ -]?string)[^"]*"[[:space:]]*:'
     OR raw ~* '(sbp_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})'
     OR raw ~* '://[^/@[:space:]]+:[^/@[:space:]]+@' THEN
    RAISE EXCEPTION 'Payload contains forbidden credential-shaped material';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_environment_manifest_safe(_manifest jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $$
BEGIN
  IF _manifest IS NULL OR jsonb_typeof(_manifest) <> 'object'
     OR NOT (_manifest ? 'package' AND _manifest ? 'configuration' AND _manifest ? 'settings') THEN
    RAISE EXCEPTION 'Manifest must contain package, configuration and settings objects';
  END IF;
  IF jsonb_typeof(_manifest->'package') <> 'object'
     OR jsonb_typeof(_manifest->'configuration') <> 'object'
     OR jsonb_typeof(_manifest->'settings') <> 'object' THEN
    RAISE EXCEPTION 'Manifest sections must be objects';
  END IF;
  PERFORM public.assert_environment_payload_safe(_manifest);
END;
$$;

CREATE OR REPLACE FUNCTION public.append_environment_change_event(
  _request_id uuid,
  _event_type text,
  _actor_user_id uuid,
  _context jsonb
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

CREATE OR REPLACE FUNCTION public.guard_environment_change_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $$
BEGIN
  IF current_setting('app.environment_change_lifecycle',true) <> 'on' THEN
    RAISE EXCEPTION 'Use governed environment change functions';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS guard_environment_change_requests ON public.environment_change_requests;
CREATE TRIGGER guard_environment_change_requests
BEFORE UPDATE OR DELETE ON public.environment_change_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_environment_change_mutation();

DROP TRIGGER IF EXISTS guard_environment_change_events ON public.environment_change_events;
CREATE TRIGGER guard_environment_change_events
BEFORE UPDATE OR DELETE ON public.environment_change_events
FOR EACH ROW EXECUTE FUNCTION public.guard_environment_change_mutation();

CREATE OR REPLACE FUNCTION public.request_environment_change_as(
  _request jsonb,
  _actor_user_id uuid
) RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  control_id uuid := nullif(_request->>'control_tenant_id','')::uuid;
  direction_value text := _request->>'direction';
  source_ref text := _request->>'source_project_ref';
  source_tenant uuid := nullif(_request->>'source_tenant_id','')::uuid;
  target_ref text := _request->>'target_project_ref';
  target_tenant uuid := nullif(_request->>'target_tenant_id','')::uuid;
  requested_manifest jsonb := _request->'manifest';
  request_key text := nullif(trim(_request->>'idempotency_key'),'');
  package_digest text;
  configuration_digest text;
  settings_digest text;
  aggregate_digest text;
  created public.environment_change_requests%ROWTYPE;
BEGIN
  PERFORM public.assert_environment_change_actor(control_id,_actor_user_id);
  PERFORM public.assert_environment_manifest_safe(requested_manifest);
  IF direction_value NOT IN ('dev_to_prod','prod_to_dev') THEN RAISE EXCEPTION 'Unsupported environment direction'; END IF;
  IF source_ref NOT IN ('YOUR_PROJECT_REF','YOUR_PROJECT_REF')
     OR target_ref NOT IN ('YOUR_PROJECT_REF','YOUR_PROJECT_REF')
     OR source_ref=target_ref THEN RAISE EXCEPTION 'Only registered FVI DEV and PROD projects are allowed'; END IF;
  IF direction_value='dev_to_prod'
     AND (source_ref<>'YOUR_PROJECT_REF' OR target_ref<>'YOUR_PROJECT_REF' OR target_tenant<>control_id) THEN
    RAISE EXCEPTION 'DEV to PROD request is not bound to the PROD control tenant';
  END IF;
  IF direction_value='prod_to_dev'
     AND (source_ref<>'YOUR_PROJECT_REF' OR target_ref<>'YOUR_PROJECT_REF' OR source_tenant<>control_id) THEN
    RAISE EXCEPTION 'PROD to DEV request is not bound to the PROD control tenant';
  END IF;
  IF source_tenant IS NULL OR target_tenant IS NULL THEN RAISE EXCEPTION 'Source and target tenants are required'; END IF;
  IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Invalid idempotency key'; END IF;
  IF length(trim(coalesce(_request->>'title',''))) NOT BETWEEN 3 AND 120
     OR length(trim(coalesce(_request->>'reason',''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Valid title and reason are required';
  END IF;
  package_digest := encode(extensions.digest(convert_to((requested_manifest->'package')::text,'UTF8'),'sha256'),'hex');
  configuration_digest := encode(extensions.digest(convert_to((requested_manifest->'configuration')::text,'UTF8'),'sha256'),'hex');
  settings_digest := encode(extensions.digest(convert_to((requested_manifest->'settings')::text,'UTF8'),'sha256'),'hex');
  aggregate_digest := encode(extensions.digest(convert_to(requested_manifest::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO created FROM public.environment_change_requests
  WHERE control_tenant_id=control_id AND requested_by=_actor_user_id AND idempotency_key=request_key;
  IF FOUND THEN
    IF created.manifest_hash<>aggregate_digest OR created.direction<>direction_value THEN
      RAISE EXCEPTION 'Idempotency key is already bound to a different environment change';
    END IF;
    RETURN QUERY SELECT created.id,created.change_request_uid,created.status,created.manifest_hash;
    RETURN;
  END IF;
  INSERT INTO public.environment_change_requests(
    change_request_uid,control_tenant_id,direction,
    source_project_ref,source_tenant_id,source_environment,
    target_project_ref,target_tenant_id,target_environment,
    title,reason,manifest,package_hash,configuration_hash,settings_hash,manifest_hash,
    requested_by,idempotency_key
  ) VALUES (
    'FVI-CR-'||to_char(current_date,'YYYYMMDD')||'-'||upper(encode(extensions.gen_random_bytes(4),'hex')),
    control_id,direction_value,source_ref,source_tenant,
    CASE WHEN direction_value='dev_to_prod' THEN 'dev' ELSE 'prod' END,
    target_ref,target_tenant,CASE WHEN direction_value='dev_to_prod' THEN 'prod' ELSE 'dev' END,
    trim(_request->>'title'),trim(_request->>'reason'),requested_manifest,
    package_digest,configuration_digest,settings_digest,aggregate_digest,_actor_user_id,request_key
  ) RETURNING * INTO created;
  PERFORM public.append_environment_change_event(created.id,'request_created',_actor_user_id,
    jsonb_build_object(
      'change_request_uid',created.change_request_uid,'direction',created.direction,
      'source_project_ref',created.source_project_ref,'source_tenant_id',created.source_tenant_id,
      'target_project_ref',created.target_project_ref,'target_tenant_id',created.target_tenant_id,
      'package_hash',created.package_hash,'configuration_hash',created.configuration_hash,
      'settings_hash',created.settings_hash,'manifest_hash',created.manifest_hash
    ));
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,control_id,'platform','environment_change.request','environment_change_request',created.id::text,
    jsonb_build_object('change_request_uid',created.change_request_uid,'direction',created.direction,'manifest_hash',created.manifest_hash));
  RETURN QUERY SELECT created.id,created.change_request_uid,created.status,created.manifest_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_environment_change_preflight_for_api(
  _request_id uuid,
  _validation_results jsonb,
  _actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE; prior_setting text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change request not found'; END IF;
  PERFORM public.assert_environment_change_actor(target.control_tenant_id,_actor_user_id);
  IF target.status<>'pending_approval' THEN RAISE EXCEPTION 'Preflight requires a pending request'; END IF;
  IF jsonb_typeof(_validation_results)<>'array' OR jsonb_array_length(_validation_results)=0 THEN
    RAISE EXCEPTION 'Non-empty validation results are required';
  END IF;
  PERFORM public.assert_environment_payload_safe(_validation_results);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_validation_results) item
    WHERE item->>'status' NOT IN ('pass','fail','skipped') OR nullif(item->>'check','') IS NULL) THEN
    RAISE EXCEPTION 'Invalid validation result';
  END IF;
  prior_setting := current_setting('app.environment_change_lifecycle',true);
  PERFORM set_config('app.environment_change_lifecycle','on',true);
  UPDATE public.environment_change_requests SET validation_results=_validation_results
  WHERE id=_request_id;
  PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
  PERFORM public.append_environment_change_event(_request_id,'preflight_recorded',_actor_user_id,
    jsonb_build_object('validation_results',_validation_results));
  RETURN 'recorded';
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_environment_change_as(
  _request_id uuid,
  _approve boolean,
  _comment text,
  _actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE; prior_setting text; decision text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change request not found'; END IF;
  PERFORM public.assert_environment_change_actor(target.control_tenant_id,_actor_user_id);
  IF target.status<>'pending_approval' THEN RAISE EXCEPTION 'Environment change request is not pending approval'; END IF;
  IF target.requested_by IS NOT DISTINCT FROM _actor_user_id THEN RAISE EXCEPTION 'Four-eyes: requester cannot approve'; END IF;
  IF length(coalesce(_comment,''))>500 THEN RAISE EXCEPTION 'Decision comment exceeds 500 characters'; END IF;
  IF _approve AND (
    jsonb_array_length(target.validation_results)=0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(target.validation_results) item WHERE item->>'status'<>'pass')
  ) THEN RAISE EXCEPTION 'All preflight validations must pass before approval'; END IF;
  decision := CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
  prior_setting := current_setting('app.environment_change_lifecycle',true);
  PERFORM set_config('app.environment_change_lifecycle','on',true);
  UPDATE public.environment_change_requests SET status=decision,decided_by=_actor_user_id,
    decided_at=now(),decision_comment=nullif(trim(_comment),'') WHERE id=_request_id;
  PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
  PERFORM public.append_environment_change_event(_request_id,
    CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,_actor_user_id,
    jsonb_build_object('comment',nullif(trim(_comment),''),'four_eyes',true));
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,target.control_tenant_id,'platform','environment_change.'||decision,
    'environment_change_request',_request_id::text,jsonb_build_object('four_eyes',true,'comment',nullif(trim(_comment),'')));
  RETURN decision;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_environment_change_execution_for_api(
  _request_id uuid,
  _execution_id text,
  _actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE; prior_setting text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change request not found'; END IF;
  PERFORM public.assert_environment_change_actor(target.control_tenant_id,_actor_user_id);
  IF target.status<>'approved' THEN RAISE EXCEPTION 'Only an approved request can execute'; END IF;
  IF target.decided_by IS NOT DISTINCT FROM _actor_user_id THEN
    RAISE EXCEPTION 'Execution actor must differ from checker';
  END IF;
  IF length(trim(coalesce(_execution_id,''))) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Valid execution ID is required'; END IF;
  prior_setting := current_setting('app.environment_change_lifecycle',true);
  PERFORM set_config('app.environment_change_lifecycle','on',true);
  UPDATE public.environment_change_requests SET status='executing',execution_id=trim(_execution_id),
    executed_by=_actor_user_id,execution_started_at=now() WHERE id=_request_id;
  PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
  PERFORM public.append_environment_change_event(_request_id,'execution_started',_actor_user_id,
    jsonb_build_object('execution_id',trim(_execution_id),'manifest_hash',target.manifest_hash));
  RETURN 'executing';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_environment_change_execution_for_api(
  _request_id uuid,
  _outcome text,
  _component_results jsonb,
  _final_readback jsonb,
  _rollback_reason text,
  _actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  target public.environment_change_requests%ROWTYPE;
  prior_setting text;
  failed text[];
  readback_digest text;
  final_status text;
  final_event text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change request not found'; END IF;
  PERFORM public.assert_environment_change_actor(target.control_tenant_id,_actor_user_id);
  IF target.status<>'executing' OR target.executed_by IS DISTINCT FROM _actor_user_id THEN
    RAISE EXCEPTION 'Execution is not active for this actor';
  END IF;
  IF _outcome NOT IN ('succeeded','failed','rolled_back') THEN RAISE EXCEPTION 'Invalid execution outcome'; END IF;
  IF jsonb_typeof(_component_results)<>'array' OR jsonb_array_length(_component_results)<>3 THEN
    RAISE EXCEPTION 'Exactly three component results are required';
  END IF;
  PERFORM public.assert_environment_payload_safe(_component_results);
  PERFORM public.assert_environment_payload_safe(_final_readback);
  IF (SELECT count(distinct item->>'component') FROM jsonb_array_elements(_component_results) item
      WHERE item->>'component' IN ('package','configuration','settings'))<>3
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_component_results) item
       WHERE item->>'status' NOT IN ('pass','fail','skipped')) THEN
    RAISE EXCEPTION 'Invalid component results';
  END IF;
  SELECT coalesce(array_agg(item->>'component' ORDER BY item->>'component'),ARRAY[]::text[]) INTO failed
  FROM jsonb_array_elements(_component_results) item WHERE item->>'status'='fail';
  IF _outcome='succeeded' AND cardinality(failed)>0 THEN RAISE EXCEPTION 'Successful outcome cannot contain failed components'; END IF;
  IF _outcome='succeeded' AND (_final_readback IS NULL OR jsonb_typeof(_final_readback)<>'object') THEN
    RAISE EXCEPTION 'Successful outcome requires final readback';
  END IF;
  IF _outcome='failed' AND cardinality(failed)=0 THEN RAISE EXCEPTION 'Failed outcome requires a failed component'; END IF;
  IF _outcome='rolled_back' AND length(trim(coalesce(_rollback_reason,'')))<10 THEN
    RAISE EXCEPTION 'Rollback requires a reason';
  END IF;
  readback_digest := CASE WHEN _final_readback IS NULL THEN NULL
    ELSE encode(extensions.digest(convert_to(_final_readback::text,'UTF8'),'sha256'),'hex') END;
  final_status := _outcome;
  final_event := CASE _outcome WHEN 'succeeded' THEN 'execution_succeeded'
    WHEN 'failed' THEN 'execution_failed' ELSE 'execution_rolled_back' END;
  prior_setting := current_setting('app.environment_change_lifecycle',true);
  PERFORM set_config('app.environment_change_lifecycle','on',true);
  UPDATE public.environment_change_requests SET status=final_status,component_results=_component_results,
    failed_components=failed,execution_completed_at=now(),deployment_outcome=_outcome,
    rollback_reason=nullif(trim(_rollback_reason),''),final_readback=_final_readback,
    final_readback_hash=readback_digest WHERE id=_request_id;
  PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
  PERFORM public.append_environment_change_event(_request_id,final_event,_actor_user_id,
    jsonb_build_object('execution_id',target.execution_id,'outcome',_outcome,
      'component_results',_component_results,'failed_components',failed,
      'rollback_reason',nullif(trim(_rollback_reason),''),'final_readback_hash',readback_digest));
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,target.control_tenant_id,'platform','environment_change.'||_outcome,
    'environment_change_request',_request_id::text,
    jsonb_build_object('execution_id',target.execution_id,'manifest_hash',target.manifest_hash,
      'failed_components',failed,'final_readback_hash',readback_digest,'rollback_reason',nullif(trim(_rollback_reason),'')));
  RETURN final_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_environment_change(_request jsonb)
RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.request_environment_change_as(_request,auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.request_environment_change_for_api(_request jsonb,_actor_user_id uuid)
RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.request_environment_change_as(_request,_actor_user_id) $$;

CREATE OR REPLACE FUNCTION public.decide_environment_change(
  _request_id uuid,_approve boolean,_comment text
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.decide_environment_change_as(_request_id,_approve,_comment,auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.decide_environment_change_for_api(
  _request_id uuid,_approve boolean,_comment text,_actor_user_id uuid
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.decide_environment_change_as(_request_id,_approve,_comment,_actor_user_id) $$;

REVOKE ALL ON FUNCTION public.assert_environment_change_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assert_environment_payload_safe(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assert_environment_manifest_safe(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.append_environment_change_event(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_environment_change_as(jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_environment_change_as(uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_environment_change(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.request_environment_change_for_api(jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_environment_change(uuid,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.decide_environment_change_for_api(uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_environment_change_preflight_for_api(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.start_environment_change_execution_for_api(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_environment_change_execution_for_api(uuid,text,jsonb,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.request_environment_change(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_environment_change(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_environment_change_for_api(uuid,boolean,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_environment_change_for_api(jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_environment_change_preflight_for_api(uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_environment_change_execution_for_api(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_environment_change_execution_for_api(uuid,text,jsonb,jsonb,text,uuid) TO service_role;
