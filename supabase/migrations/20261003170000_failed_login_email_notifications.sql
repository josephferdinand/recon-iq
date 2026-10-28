-- Additive, service-only notification proposal. Parent applies with exact catalog guards.
-- Authentication stays with Supabase; no role, password, MFA, session or hook changes.
CREATE TABLE private.failed_login_attempts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  binding text NOT NULL CHECK (binding ~ '^[0-9a-f]{64}$'),
  stage text NOT NULL CHECK (stage IN ('password','mfa','policy')),
  user_id uuid,
  recipient_email text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','success','invalid_credentials','mfa_invalid','mfa_expired','account_locked','rate_limited','policy_blocked','provider_unavailable','verification_failed')),
  delivery_state text NOT NULL DEFAULT 'not_required' CHECK (delivery_state IN ('not_required','no_verified_recipient','recorded','queued','sending','retry','uncertain','provider_accepted','delivered','bounced','dead_letter','recipient_changed')),
  queue_message_id bigint UNIQUE,
  lease_id uuid,
  dispatch_started_at timestamptz,
  dispatch_count integer NOT NULL DEFAULT 0,
  provider_message_id text,
  diagnostic_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.failed_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.failed_login_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX failed_login_pending_delivery ON private.failed_login_attempts(created_at) WHERE delivery_state IN ('recorded','retry','uncertain','sending');

CREATE TABLE private.failed_login_delivery_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES private.failed_login_attempts(id),
  state text NOT NULL,
  diagnostic_code text,
  provider_message_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.failed_login_delivery_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.failed_login_delivery_audit FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.failed_login_delivery_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.failed_login_begin(_id uuid, _binding text, _stage text, _email text DEFAULT NULL, _user_id uuid DEFAULT NULL, _request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; actor uuid; recipient text;
BEGIN
  IF _binding IS NULL OR _binding !~ '^[0-9a-f]{64}$' OR _stage NOT IN ('password','mfa','policy') OR _stage IS NULL THEN RAISE EXCEPTION 'Invalid attempt' USING ERRCODE='22023'; END IF;
  IF _stage='password' THEN
    SELECT u.id,u.email INTO actor,recipient FROM auth.users u WHERE lower(u.email)=lower(trim(_email)) AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) LIMIT 1;
  ELSE
    SELECT u.id,u.email INTO actor,recipient FROM auth.users u WHERE u.id=_user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false);
  END IF;
  INSERT INTO private.failed_login_attempts(id,request_id,binding,stage,user_id,recipient_email) VALUES (_id,coalesce(_request_id,gen_random_uuid()),_binding,_stage,actor,recipient) ON CONFLICT(id) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('acquired',true,'outcome','pending','requestId',(SELECT request_id FROM private.failed_login_attempts WHERE id=_id)); END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF a.binding<>_binding OR a.stage<>_stage THEN RAISE EXCEPTION 'Attempt conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('acquired',false,'outcome',a.outcome,'requestId',a.request_id);
END;
$$;

CREATE FUNCTION public.failed_login_finish(_id uuid, _binding text, _outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; q bigint;
BEGIN
  IF _outcome NOT IN ('success','invalid_credentials','mfa_invalid','mfa_expired','account_locked','rate_limited','policy_blocked','provider_unavailable','verification_failed') OR _outcome IS NULL THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.binding<>_binding THEN RAISE EXCEPTION 'Attempt conflict' USING ERRCODE='22023'; END IF;
  IF (_outcome='invalid_credentials' AND a.stage<>'password') OR (_outcome IN ('mfa_invalid','mfa_expired') AND a.stage<>'mfa') OR (_outcome='policy_blocked' AND a.stage<>'policy') THEN RAISE EXCEPTION 'Outcome stage conflict' USING ERRCODE='22023'; END IF;
  IF a.outcome<>'pending' THEN
    IF a.outcome<>_outcome THEN RAISE EXCEPTION 'Outcome conflict' USING ERRCODE='22023'; END IF;
    RETURN true;
  END IF;
  UPDATE private.failed_login_attempts SET outcome=_outcome,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=_id;
  IF _outcome='success' THEN RETURN true; END IF;
  -- Canonical trusted event; browser security-events do not feed this pipeline.
  INSERT INTO public.security_events(user_id,event_type,severity,context) VALUES (a.user_id,'auth.failed_login.verified','warning',jsonb_build_object('attempt_id',_id,'request_id',a.request_id,'stage',a.stage,'outcome',_outcome,'source','server_authentication'));
  IF a.user_id IS NULL OR a.recipient_email IS NULL THEN
    UPDATE private.failed_login_attempts SET delivery_state='no_verified_recipient' WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'no_verified_recipient');
    RETURN true;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.user_id AND u.email=a.recipient_email AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)) THEN
    UPDATE private.failed_login_attempts SET delivery_state='recipient_changed',diagnostic_code='recipient_changed' WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'recipient_changed','recipient_changed');
    RETURN true;
  END IF;
  UPDATE private.failed_login_attempts SET delivery_state='recorded' WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'recorded');
  BEGIN
    q:=public.enqueue_email('transactional_emails',jsonb_build_object('template','auth.failed_login.verified','attempt_id',_id));
    UPDATE private.failed_login_attempts SET delivery_state='queued',queue_message_id=q WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'queued');
  EXCEPTION WHEN OTHERS THEN
    UPDATE private.failed_login_attempts SET diagnostic_code='queue_unavailable' WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'recorded','queue_unavailable');
  END;
  RETURN true;
END;
$$;

CREATE FUNCTION public.failed_login_requeue_recorded()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; q bigint; count_queued integer:=0;
BEGIN
  FOR a IN SELECT * FROM private.failed_login_attempts WHERE delivery_state='recorded' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      q:=public.enqueue_email('transactional_emails',jsonb_build_object('template','auth.failed_login.verified','attempt_id',a.id));
      UPDATE private.failed_login_attempts SET delivery_state='queued',queue_message_id=q,diagnostic_code=NULL,updated_at=clock_timestamp() WHERE id=a.id;
      INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(a.id,'queued'); count_queued:=count_queued+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.failed_login_attempts SET diagnostic_code='queue_unavailable',updated_at=clock_timestamp() WHERE id=a.id;
    END;
  END LOOP;
  RETURN count_queued;
END;
$$;

CREATE FUNCTION public.failed_login_claim(_id uuid, _queue_message_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; lease uuid;
BEGIN
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.queue_message_id IS DISTINCT FROM _queue_message_id THEN RETURN jsonb_build_object('send',false,'state','unattributed'); END IF;
  IF a.delivery_state IN ('provider_accepted','delivered','bounced') THEN PERFORM public.delete_email('transactional_emails',_queue_message_id); RETURN jsonb_build_object('send',false,'state',a.delivery_state); END IF;
  IF a.delivery_state='sending' AND a.dispatch_started_at<clock_timestamp()-interval '5 minutes' THEN
    UPDATE private.failed_login_attempts SET delivery_state='uncertain',diagnostic_code='dispatch_interrupted',updated_at=clock_timestamp() WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'uncertain','dispatch_interrupted');
    RETURN jsonb_build_object('send',false,'state','uncertain');
  END IF;
  IF a.delivery_state NOT IN ('queued','retry') THEN RETURN jsonb_build_object('send',false,'state',a.delivery_state); END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.user_id AND u.email=a.recipient_email AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)) THEN
    UPDATE private.failed_login_attempts SET delivery_state='recipient_changed',diagnostic_code='recipient_changed',updated_at=clock_timestamp() WHERE id=_id;
    INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code) VALUES(_id,'recipient_changed','recipient_changed');
    RETURN jsonb_build_object('send',false,'state','recipient_changed');
  END IF;
  lease:=gen_random_uuid();
  UPDATE private.failed_login_attempts SET delivery_state='sending',lease_id=lease,dispatch_started_at=clock_timestamp(),dispatch_count=dispatch_count+1,updated_at=clock_timestamp() WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state) VALUES(_id,'sending');
  RETURN jsonb_build_object('send',true,'lease_id',lease,'to',a.recipient_email,'occurred_at',a.created_at,'outcome',a.outcome,'attempt_id',a.id,'request_id',a.request_id);
END;
$$;

CREATE FUNCTION public.failed_login_settle(_id uuid, _lease_id uuid, _state text, _provider_message_id text DEFAULT NULL, _diagnostic_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts; final_state text;
BEGIN
  IF _state NOT IN ('provider_accepted','retry','uncertain') OR _state IS NULL OR (_provider_message_id IS NOT NULL AND (length(_provider_message_id)>200 OR _provider_message_id !~ '^[A-Za-z0-9_.:-]+$' OR _provider_message_id ~ '^(request:)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' OR _provider_message_id ~* '^(request:)?(sb_secret_|sb_publishable_|sbp_|Zoho-enczapikey)')) OR (_diagnostic_code IS NOT NULL AND _diagnostic_code NOT IN ('provider_rejected','provider_rate_limited','provider_timeout','provider_response_unknown','provider_unavailable')) THEN RAISE EXCEPTION 'Invalid delivery receipt' USING ERRCODE='22023'; END IF;
  IF _state='provider_accepted' AND _provider_message_id IS NULL THEN RAISE EXCEPTION 'Acceptance receipt required' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.lease_id IS DISTINCT FROM _lease_id OR _lease_id IS NULL THEN RETURN false; END IF;
  IF (a.delivery_state=_state OR (_state='provider_accepted' AND a.delivery_state IN ('delivered','bounced'))) AND a.provider_message_id IS NOT DISTINCT FROM _provider_message_id THEN RETURN true; END IF;
  IF a.delivery_state NOT IN ('sending','uncertain') THEN RETURN false; END IF;
  -- An interrupted/ambiguous HTTP send is never automatically replayed.
  IF a.delivery_state='uncertain' AND _state='retry' THEN RETURN false; END IF;
  final_state:=CASE WHEN _state='retry' AND a.dispatch_count>=5 THEN 'dead_letter' ELSE _state END;
  UPDATE private.failed_login_attempts SET delivery_state=final_state,provider_message_id=_provider_message_id,diagnostic_code=_diagnostic_code,updated_at=clock_timestamp() WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state,diagnostic_code,provider_message_id) VALUES(_id,final_state,_diagnostic_code,_provider_message_id);
  IF _state='provider_accepted' THEN
    INSERT INTO public.email_send_log(message_id,template_name,recipient_email,status,metadata) VALUES(_provider_message_id,'auth.failed_login.verified',a.recipient_email,'sent',jsonb_build_object('attempt_id',_id,'queue_message_id',a.queue_message_id,'delivery_state','provider_accepted'));
    PERFORM public.delete_email('transactional_emails',a.queue_message_id);
  ELSIF final_state='dead_letter' THEN
    PERFORM public.move_to_dlq('transactional_emails','transactional_emails_dlq',a.queue_message_id,jsonb_build_object('template','auth.failed_login.verified','attempt_id',_id));
  END IF;
  RETURN true;
END;
$$;

-- Delivery readback is service-only and requires exact provider correlation.
-- Parent wires this only behind an existing authenticated provider webhook or
-- a separately verified provider-log read. Browser events cannot call it.
CREATE FUNCTION public.failed_login_delivery_receipt(_id uuid, _provider_message_id text, _state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,private,public,pg_temp AS $$
DECLARE a private.failed_login_attempts;
BEGIN
  IF _state NOT IN ('delivered','bounced') OR _state IS NULL THEN RAISE EXCEPTION 'Invalid delivery state' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM private.failed_login_attempts WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR a.provider_message_id IS DISTINCT FROM _provider_message_id OR _provider_message_id IS NULL OR a.delivery_state NOT IN ('provider_accepted','delivered','bounced') THEN RETURN false; END IF;
  IF a.delivery_state=_state THEN RETURN true; END IF;
  IF a.delivery_state IN ('delivered','bounced') THEN RETURN false; END IF;
  UPDATE private.failed_login_attempts SET delivery_state=_state,updated_at=clock_timestamp() WHERE id=_id;
  INSERT INTO private.failed_login_delivery_audit(attempt_id,state,provider_message_id) VALUES(_id,_state,_provider_message_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.failed_login_begin(uuid,text,text,text,uuid,uuid),public.failed_login_finish(uuid,text,text),public.failed_login_requeue_recorded(),public.failed_login_claim(uuid,bigint),public.failed_login_settle(uuid,uuid,text,text,text),public.failed_login_delivery_receipt(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.failed_login_begin(uuid,text,text,text,uuid,uuid),public.failed_login_finish(uuid,text,text),public.failed_login_requeue_recorded(),public.failed_login_claim(uuid,bigint),public.failed_login_settle(uuid,uuid,text,text,text),public.failed_login_delivery_receipt(uuid,text,text) TO service_role;
