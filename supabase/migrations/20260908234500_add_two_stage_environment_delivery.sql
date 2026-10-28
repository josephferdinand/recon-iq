-- Two-stage environment delivery: source maker/checker, then target review.
-- UAT is registered but disabled until its independent project is provisioned.

CREATE TABLE IF NOT EXISTS public.environment_release_registry (
  environment text PRIMARY KEY CHECK (environment IN ('dev','uat','prod')),
  project_ref text UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  release_rank smallint NOT NULL CHECK (release_rank BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((enabled AND project_ref IS NOT NULL) OR NOT enabled)
);

INSERT INTO public.environment_release_registry(environment,project_ref,enabled,release_rank)
VALUES
  ('dev','YOUR_PROJECT_REF',true,10),
  ('uat',null,false,20),
  ('prod','YOUR_PROJECT_REF',true,30)
ON CONFLICT (environment) DO UPDATE SET
  project_ref=excluded.project_ref,
  enabled=excluded.enabled,
  release_rank=excluded.release_rank,
  updated_at=now();

REVOKE ALL ON public.environment_release_registry FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.environment_release_registry TO authenticated,service_role;
ALTER TABLE public.environment_release_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS environment_release_registry_read ON public.environment_release_registry;
CREATE POLICY environment_release_registry_read ON public.environment_release_registry
FOR SELECT TO authenticated USING (true);

ALTER TABLE public.environment_change_requests
  DROP CONSTRAINT IF EXISTS environment_change_requests_direction_check,
  DROP CONSTRAINT IF EXISTS environment_change_requests_source_environment_check,
  DROP CONSTRAINT IF EXISTS environment_change_requests_target_environment_check,
  DROP CONSTRAINT IF EXISTS environment_change_direction_check,
  DROP CONSTRAINT IF EXISTS environment_change_source_environment_check,
  DROP CONSTRAINT IF EXISTS environment_change_target_environment_check,
  DROP CONSTRAINT IF EXISTS environment_change_direction_ck;

ALTER TABLE public.environment_change_requests
  ADD CONSTRAINT environment_change_direction_check
    CHECK (direction IN ('dev_to_uat','uat_to_prod','prod_to_uat','uat_to_dev','dev_to_prod','prod_to_dev')),
  ADD CONSTRAINT environment_change_source_environment_check
    CHECK (source_environment IN ('dev','uat','prod')),
  ADD CONSTRAINT environment_change_target_environment_check
    CHECK (target_environment IN ('dev','uat','prod')),
  ADD CONSTRAINT environment_change_direction_ck CHECK (
    source_environment<>target_environment
    AND direction=source_environment||'_to_'||target_environment
  );

ALTER TABLE public.environment_change_requests
  ADD COLUMN IF NOT EXISTS approval_stage text NOT NULL DEFAULT 'target_review'
    CHECK (approval_stage IN ('source_review','target_review')),
  ADD COLUMN IF NOT EXISTS upstream_change_request_uid text,
  ADD COLUMN IF NOT EXISTS upstream_manifest_hash text
    CHECK (upstream_manifest_hash IS NULL OR upstream_manifest_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS transport_status text NOT NULL DEFAULT 'not_required'
    CHECK (transport_status IN ('not_required','pending','succeeded','failed')),
  ADD COLUMN IF NOT EXISTS transport_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_change_request_uid text,
  ADD COLUMN IF NOT EXISTS access_mapping_preview jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(access_mapping_preview)='object'),
  ADD COLUMN IF NOT EXISTS access_mapping_confirmed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS access_mapping_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (activation_status IN ('not_applicable','pending_install','pending_access','active'));

CREATE UNIQUE INDEX IF NOT EXISTS environment_change_upstream_uid_uq
  ON public.environment_change_requests(upstream_change_request_uid)
  WHERE approval_stage='target_review' AND upstream_change_request_uid IS NOT NULL;

ALTER TABLE public.environment_change_events
  DROP CONSTRAINT IF EXISTS environment_change_events_event_type_check;
ALTER TABLE public.environment_change_events
  ADD CONSTRAINT environment_change_events_event_type_check CHECK (event_type IN (
    'request_created','preflight_recorded','approved','rejected',
    'package_transmitted','transport_failed','package_received','access_mapping_confirmed',
    'execution_started','execution_succeeded','execution_failed','execution_rolled_back'
  ));

CREATE OR REPLACE FUNCTION public.guard_environment_change_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $$
BEGIN
  IF current_setting('app.environment_change_lifecycle',true) <> 'on' THEN
    RAISE EXCEPTION 'Use governed environment change functions';
  END IF;
  IF TG_TABLE_NAME='environment_change_requests' AND TG_OP='UPDATE' THEN
    IF NEW.status='executing' AND OLD.status<>'executing' AND NEW.approval_stage<>'target_review' THEN
      RAISE EXCEPTION 'Only a target-approved package can execute';
    END IF;
    IF NEW.status='succeeded' AND OLD.status='executing' AND NEW.approval_stage='target_review' THEN
      NEW.activation_status := CASE
        WHEN coalesce((NEW.access_mapping_preview->>'missing')::integer,0)=0
         AND coalesce((NEW.access_mapping_preview->>'ambiguous')::integer,0)=0
        THEN 'active'
        ELSE 'pending_access'
      END;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
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
    'package_transmitted','transport_failed','package_received','access_mapping_confirmed',
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

CREATE OR REPLACE FUNCTION public.request_source_environment_change_as(
  _request jsonb,
  _actor_user_id uuid
) RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  source_tenant uuid := nullif(_request->>'source_tenant_id','')::uuid;
  target_tenant uuid := nullif(_request->>'target_tenant_id','')::uuid;
  source_ref text := _request->>'source_project_ref';
  target_ref text := _request->>'target_project_ref';
  source_env text := _request->>'source_environment';
  target_env text := _request->>'target_environment';
  direction_value text := _request->>'direction';
  requested_manifest jsonb := _request->'manifest';
  validations jsonb := coalesce(_request->'validation_results','[]'::jsonb);
  request_key text := nullif(trim(_request->>'idempotency_key'),'');
  package_digest text;
  configuration_digest text;
  settings_digest text;
  aggregate_digest text;
  created public.environment_change_requests%ROWTYPE;
BEGIN
  PERFORM public.assert_environment_change_actor(source_tenant,_actor_user_id);
  PERFORM public.assert_environment_manifest_safe(requested_manifest);
  PERFORM public.assert_environment_payload_safe(validations);
  IF direction_value<>source_env||'_to_'||target_env THEN RAISE EXCEPTION 'Direction does not match source and target'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.environment_release_registry
    WHERE environment=source_env AND project_ref=source_ref AND enabled) THEN
    RAISE EXCEPTION 'Source environment is not registered and enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.environment_release_registry
    WHERE environment=target_env AND project_ref=target_ref AND enabled) THEN
    RAISE EXCEPTION 'Target environment is not registered and enabled';
  END IF;
  IF source_tenant IS NULL OR target_tenant IS NULL THEN RAISE EXCEPTION 'Source and target tenants are required'; END IF;
  IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Invalid idempotency key'; END IF;
  IF length(trim(coalesce(_request->>'title',''))) NOT BETWEEN 3 AND 120
     OR length(trim(coalesce(_request->>'reason',''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Valid title and reason are required';
  END IF;
  IF jsonb_typeof(validations)<>'array' OR jsonb_array_length(validations)=0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(validations) item
       WHERE item->>'status' NOT IN ('pass','fail') OR nullif(item->>'check','') IS NULL) THEN
    RAISE EXCEPTION 'Valid source preflight results are required';
  END IF;
  package_digest := encode(extensions.digest(convert_to((requested_manifest->'package')::text,'UTF8'),'sha256'),'hex');
  configuration_digest := encode(extensions.digest(convert_to((requested_manifest->'configuration')::text,'UTF8'),'sha256'),'hex');
  settings_digest := encode(extensions.digest(convert_to((requested_manifest->'settings')::text,'UTF8'),'sha256'),'hex');
  aggregate_digest := encode(extensions.digest(convert_to(requested_manifest::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO created FROM public.environment_change_requests
  WHERE control_tenant_id=source_tenant AND requested_by=_actor_user_id AND idempotency_key=request_key;
  IF FOUND THEN
    IF created.manifest_hash<>aggregate_digest OR created.direction<>direction_value THEN
      RAISE EXCEPTION 'Idempotency key is already bound to another package';
    END IF;
    RETURN QUERY SELECT created.id,created.change_request_uid,created.status,created.manifest_hash;
    RETURN;
  END IF;
  INSERT INTO public.environment_change_requests(
    change_request_uid,control_tenant_id,direction,source_project_ref,source_tenant_id,
    source_environment,target_project_ref,target_tenant_id,target_environment,title,reason,
    manifest,package_hash,configuration_hash,settings_hash,manifest_hash,requested_by,
    idempotency_key,validation_results,approval_stage,transport_status,activation_status
  ) VALUES (
    'FVI-CR-'||to_char(current_date,'YYYYMMDD')||'-'||upper(encode(extensions.gen_random_bytes(4),'hex')),
    source_tenant,direction_value,source_ref,source_tenant,source_env,target_ref,target_tenant,target_env,
    trim(_request->>'title'),trim(_request->>'reason'),requested_manifest,package_digest,
    configuration_digest,settings_digest,aggregate_digest,_actor_user_id,request_key,validations,
    'source_review','pending','not_applicable'
  ) RETURNING * INTO created;
  PERFORM public.append_environment_change_event(created.id,'request_created',_actor_user_id,
    jsonb_build_object('approval_stage','source_review','direction',direction_value,
      'source_project_ref',source_ref,'target_project_ref',target_ref,'manifest_hash',aggregate_digest));
  PERFORM public.append_environment_change_event(created.id,'preflight_recorded',_actor_user_id,
    jsonb_build_object('validation_results',validations));
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,source_tenant,'tenant','environment_change.source_requested',
    'environment_change_request',created.id::text,
    jsonb_build_object('direction',direction_value,'manifest_hash',aggregate_digest));
  RETURN QUERY SELECT created.id,created.change_request_uid,created.status,created.manifest_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_environment_change_for_api(
  _request jsonb,
  _requester_email text
) RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  target_tenant uuid := nullif(_request->>'target_tenant_id','')::uuid;
  source_ref text := _request->>'source_project_ref';
  target_ref text := _request->>'target_project_ref';
  source_env text := _request->>'source_environment';
  target_env text := _request->>'target_environment';
  direction_value text := _request->>'direction';
  upstream_uid text := nullif(trim(_request->>'upstream_change_request_uid'),'');
  requested_manifest jsonb := _request->'manifest';
  validations jsonb := coalesce(_request->'validation_results','[]'::jsonb);
  mapping_preview jsonb := coalesce(_request->'access_mapping_preview','{}'::jsonb);
  mapped_requester_id uuid;
  mapped_requester_count integer;
  grant_item jsonb;
  matched_principal_id uuid;
  matched_principal_count integer;
  mapping_state text;
  computed_mappings jsonb := '[]'::jsonb;
  aggregate_digest text;
  created public.environment_change_requests%ROWTYPE;
BEGIN
  SELECT count(*),(array_agg(id ORDER BY id))[1] INTO mapped_requester_count,mapped_requester_id
  FROM auth.users WHERE lower(email)=lower(trim(_requester_email));
  IF mapped_requester_count<>1 THEN RAISE EXCEPTION 'Source requester does not map exactly once in target'; END IF;
  PERFORM public.assert_environment_change_actor(target_tenant,mapped_requester_id);
  PERFORM public.assert_environment_manifest_safe(requested_manifest);
  PERFORM public.assert_environment_payload_safe(validations);
  PERFORM public.assert_environment_payload_safe(mapping_preview);
  IF direction_value<>source_env||'_to_'||target_env THEN RAISE EXCEPTION 'Direction does not match source and target'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.environment_release_registry
    WHERE environment=target_env AND project_ref=target_ref AND enabled) THEN
    RAISE EXCEPTION 'Receiving environment is not registered and enabled';
  END IF;
  IF coalesce(_request->>'source_request_status','')<>'approved'
     OR upstream_uid IS NULL OR length(upstream_uid)>80 THEN
    RAISE EXCEPTION 'An approved source request is required';
  END IF;
  IF coalesce(_request->>'source_requester_email_hash','')=
     coalesce(_request->>'source_approver_email_hash','') THEN
    RAISE EXCEPTION 'Source maker/checker separation proof is invalid';
  END IF;
  IF jsonb_typeof(validations)<>'array' OR jsonb_array_length(validations)=0 THEN
    RAISE EXCEPTION 'Target preflight results are required';
  END IF;
  aggregate_digest := encode(extensions.digest(convert_to(requested_manifest::text,'UTF8'),'sha256'),'hex');
  IF aggregate_digest<>coalesce(_request->>'upstream_manifest_hash','') THEN
    RAISE EXCEPTION 'Transported manifest hash does not match source approval';
  END IF;
  IF jsonb_typeof(requested_manifest->'settings'->'access_grants')='array' THEN
    FOR grant_item IN SELECT value FROM jsonb_array_elements(requested_manifest->'settings'->'access_grants')
    LOOP
      matched_principal_id := NULL;
      matched_principal_count := 0;
      IF grant_item->>'principal_type'='group' THEN
        SELECT count(*),(array_agg(id ORDER BY id))[1] INTO matched_principal_count,matched_principal_id
        FROM public.tenant_groups
        WHERE tenant_id=target_tenant AND lower(name)=lower(grant_item->>'principal_name');
      ELSIF grant_item->>'principal_type'='user' THEN
        SELECT count(*),(array_agg(m.user_id ORDER BY m.user_id))[1] INTO matched_principal_count,matched_principal_id
        FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
        WHERE m.tenant_id=target_tenant AND m.active
          AND lower(u.email)=lower(grant_item->>'principal_name');
      ELSE
        RAISE EXCEPTION 'Unsupported access principal type';
      END IF;
      mapping_state := CASE matched_principal_count WHEN 1 THEN 'exact'
        WHEN 0 THEN 'missing' ELSE 'ambiguous' END;
      computed_mappings := computed_mappings || jsonb_build_array(jsonb_build_object(
        'recon_source_id',grant_item->>'recon_source_id',
        'recon_name',grant_item->>'recon_name',
        'principal_type',grant_item->>'principal_type',
        'principal_name',grant_item->>'principal_name',
        'permission',grant_item->>'permission',
        'target_principal_id',matched_principal_id,
        'state',mapping_state
      ));
    END LOOP;
  END IF;
  mapping_preview := jsonb_build_object(
    'mappings',computed_mappings,
    'exact',(SELECT count(*) FROM jsonb_array_elements(computed_mappings) item WHERE item->>'state'='exact'),
    'missing',(SELECT count(*) FROM jsonb_array_elements(computed_mappings) item WHERE item->>'state'='missing'),
    'ambiguous',(SELECT count(*) FROM jsonb_array_elements(computed_mappings) item WHERE item->>'state'='ambiguous')
  );
  SELECT * INTO created FROM public.environment_change_requests
  WHERE approval_stage='target_review' AND upstream_change_request_uid=upstream_uid;
  IF FOUND THEN
    IF created.manifest_hash<>aggregate_digest THEN RAISE EXCEPTION 'Upstream request is bound to another manifest'; END IF;
    RETURN QUERY SELECT created.id,created.change_request_uid,created.status,created.manifest_hash;
    RETURN;
  END IF;
  INSERT INTO public.environment_change_requests(
    change_request_uid,control_tenant_id,direction,source_project_ref,source_tenant_id,
    source_environment,target_project_ref,target_tenant_id,target_environment,title,reason,
    manifest,package_hash,configuration_hash,settings_hash,manifest_hash,requested_by,
    idempotency_key,validation_results,approval_stage,upstream_change_request_uid,
    upstream_manifest_hash,transport_status,access_mapping_preview,activation_status
  ) VALUES (
    'FVI-CR-'||to_char(current_date,'YYYYMMDD')||'-'||upper(encode(extensions.gen_random_bytes(4),'hex')),
    target_tenant,direction_value,source_ref,nullif(_request->>'source_tenant_id','')::uuid,
    source_env,target_ref,target_tenant,target_env,trim(_request->>'title'),trim(_request->>'reason'),
    requested_manifest,
    encode(extensions.digest(convert_to((requested_manifest->'package')::text,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to((requested_manifest->'configuration')::text,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to((requested_manifest->'settings')::text,'UTF8'),'sha256'),'hex'),
    aggregate_digest,mapped_requester_id,'incoming:'||upstream_uid,validations,'target_review',
    upstream_uid,aggregate_digest,'not_required',mapping_preview,'pending_install'
  ) RETURNING * INTO created;
  PERFORM public.append_environment_change_event(created.id,'package_received',mapped_requester_id,
    jsonb_build_object('upstream_change_request_uid',upstream_uid,'manifest_hash',aggregate_digest,
      'source_maker_checker_separated',true));
  PERFORM public.append_environment_change_event(created.id,'preflight_recorded',mapped_requester_id,
    jsonb_build_object('validation_results',validations,'access_mapping_preview',mapping_preview));
  RETURN QUERY SELECT created.id,created.change_request_uid,created.status,created.manifest_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_approved_environment_change_for_transport(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE; requester_email text; approver_email text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id;
  IF NOT FOUND OR target.approval_stage<>'source_review' OR target.status<>'approved'
     OR target.decided_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the source checker can transport an approved package';
  END IF;
  SELECT lower(email) INTO requester_email FROM auth.users WHERE id=target.requested_by;
  SELECT lower(email) INTO approver_email FROM auth.users WHERE id=target.decided_by;
  RETURN jsonb_build_object(
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
END;
$$;

CREATE OR REPLACE FUNCTION public.record_environment_change_transport_for_api(
  _request_id uuid,
  _succeeded boolean,
  _target_change_request_uid text,
  _actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE; prior_setting text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR target.approval_stage<>'source_review' OR target.status<>'approved' THEN
    RAISE EXCEPTION 'Approved source request is required';
  END IF;
  IF target.decided_by IS DISTINCT FROM _actor_user_id THEN RAISE EXCEPTION 'Only the source checker can record transport'; END IF;
  prior_setting := current_setting('app.environment_change_lifecycle',true);
  PERFORM set_config('app.environment_change_lifecycle','on',true);
  UPDATE public.environment_change_requests SET
    transport_status=CASE WHEN _succeeded THEN 'succeeded' ELSE 'failed' END,
    transport_attempted_at=now(),
    target_change_request_uid=CASE WHEN _succeeded THEN nullif(trim(_target_change_request_uid),'') ELSE NULL END
  WHERE id=_request_id;
  PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
  PERFORM public.append_environment_change_event(_request_id,
    CASE WHEN _succeeded THEN 'package_transmitted' ELSE 'transport_failed' END,_actor_user_id,
    jsonb_build_object('target_change_request_uid',CASE WHEN _succeeded THEN nullif(trim(_target_change_request_uid),'') ELSE NULL END));
  RETURN CASE WHEN _succeeded THEN 'succeeded' ELSE 'failed' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_incoming_environment_change_as(
  _request_id uuid,
  _approve boolean,
  _comment text,
  _confirm_access_mapping boolean,
  _actor_user_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE; result text; prior_setting text;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND OR target.approval_stage<>'target_review' THEN RAISE EXCEPTION 'Incoming target review is required'; END IF;
  IF _approve AND NOT _confirm_access_mapping THEN RAISE EXCEPTION 'Target approver must confirm user/group mappings'; END IF;
  result := public.decide_environment_change_as(_request_id,_approve,_comment,_actor_user_id);
  IF _approve THEN
    prior_setting := current_setting('app.environment_change_lifecycle',true);
    PERFORM set_config('app.environment_change_lifecycle','on',true);
    UPDATE public.environment_change_requests SET access_mapping_confirmed_by=_actor_user_id,
      access_mapping_confirmed_at=now() WHERE id=_request_id;
    PERFORM set_config('app.environment_change_lifecycle',coalesce(prior_setting,''),true);
    PERFORM public.append_environment_change_event(_request_id,'access_mapping_confirmed',_actor_user_id,
      jsonb_build_object('confirmed',true,'preview_hash',
        encode(extensions.digest(convert_to(target.access_mapping_preview::text,'UTF8'),'sha256'),'hex')));
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_source_environment_change(_request jsonb)
RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.request_source_environment_change_as(_request,auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.approve_incoming_environment_change(
  _request_id uuid,_approve boolean,_comment text,_confirm_access_mapping boolean
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.approve_incoming_environment_change_as(
  _request_id,_approve,_comment,_confirm_access_mapping,auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.record_environment_change_transport(
  _request_id uuid,_succeeded boolean,_target_change_request_uid text
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.record_environment_change_transport_for_api(
  _request_id,_succeeded,_target_change_request_uid,auth.uid()) $$;

REVOKE ALL ON FUNCTION public.request_source_environment_change_as(jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.receive_environment_change_for_api(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_environment_change_transport_for_api(uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_incoming_environment_change_as(uuid,boolean,text,boolean,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_source_environment_change(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_incoming_environment_change(uuid,boolean,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.export_approved_environment_change_for_transport(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_environment_change_transport(uuid,boolean,text) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.request_source_environment_change(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_incoming_environment_change(uuid,boolean,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_approved_environment_change_for_transport(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_environment_change_transport(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_environment_change_for_api(jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_environment_change_transport_for_api(uuid,boolean,text,uuid) TO service_role;

COMMENT ON TABLE public.environment_release_registry IS
  'Registered FVI release environments. UAT remains disabled until provisioned.';
COMMENT ON COLUMN public.environment_change_requests.approval_stage IS
  'source_review requires local maker/checker; target_review is the receiving tenant approval.';
COMMENT ON COLUMN public.environment_change_requests.access_mapping_preview IS
  'Proposed exact user/group mappings computed in the target before approval.';
