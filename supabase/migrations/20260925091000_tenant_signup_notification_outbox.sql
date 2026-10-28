-- Durable, at-least-once delivery contract for signup notifications.
-- The stable event ID is the provider idempotency key where supported.
ALTER TABLE public.tenant_signup_events
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN provider_message_id text,
  ADD COLUMN last_error_code text,
  ADD COLUMN dead_lettered_at timestamptz,
  ADD CONSTRAINT tenant_signup_events_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  ADD CONSTRAINT tenant_signup_events_provider_id_length CHECK (provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 200),
  ADD CONSTRAINT tenant_signup_events_error_code_format CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$');
DROP INDEX tenant_signup_events_unsent_idx;
CREATE INDEX tenant_signup_events_claim_idx
  ON public.tenant_signup_events(next_attempt_at,occurred_at)
  WHERE notified_at IS NULL AND dead_lettered_at IS NULL;

CREATE FUNCTION public.claim_tenant_signup_events(_batch_size integer DEFAULT 20, _lease_seconds integer DEFAULT 120)
RETURNS TABLE (
  event_id uuid, request_id uuid, tenant_id uuid, user_id uuid, event_name text,
  occurred_at timestamptz, lease_token uuid, lease_until timestamptz,
  attempt_count integer, idempotency_key text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _batch_size IS NULL OR _batch_size NOT BETWEEN 1 AND 100
     OR _lease_seconds IS NULL OR _lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Invalid claim bounds' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH picked AS MATERIALIZED (
    SELECT e.id FROM public.tenant_signup_events e
    WHERE e.notified_at IS NULL AND e.dead_lettered_at IS NULL
      AND e.next_attempt_at <= now()
      AND (e.lease_until IS NULL OR e.lease_until <= now())
    ORDER BY e.next_attempt_at,e.occurred_at,e.id
    FOR UPDATE SKIP LOCKED LIMIT _batch_size
  )
  UPDATE public.tenant_signup_events e
    SET lease_token=pg_catalog.gen_random_uuid(),
        lease_until=now()+make_interval(secs=>_lease_seconds),
        attempt_count=e.attempt_count+1
  FROM picked p WHERE e.id=p.id
  RETURNING e.id,e.request_id,e.tenant_id,e.user_id,e.event_name,e.occurred_at,
    e.lease_token,e.lease_until,e.attempt_count,'fvi-signup-'||e.id::text;
END $$;
REVOKE ALL ON FUNCTION public.claim_tenant_signup_events(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tenant_signup_events(integer,integer) TO service_role;

-- A repeated ack for the same provider correlation is safe after a lost response.
CREATE FUNCTION public.ack_tenant_signup_event(_event_id uuid, _lease_token uuid, _provider_message_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.tenant_signup_events;
BEGIN
  IF _provider_message_id IS NULL OR length(_provider_message_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid provider correlation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_event FROM public.tenant_signup_events WHERE id=_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_event.notified_at IS NOT NULL THEN
    RETURN v_event.provider_message_id=_provider_message_id;
  END IF;
  IF _lease_token IS NULL OR v_event.lease_until IS NULL
     OR v_event.lease_token IS DISTINCT FROM _lease_token OR v_event.lease_until <= now() THEN
    RETURN false;
  END IF;
  UPDATE public.tenant_signup_events
    SET notified_at=now(),provider_message_id=_provider_message_id,
        lease_token=NULL,lease_until=NULL,last_error_code=NULL
    WHERE id=_event_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ack_tenant_signup_event(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ack_tenant_signup_event(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.fail_tenant_signup_event(
  _event_id uuid, _lease_token uuid, _error_code text,
  _retry_after_seconds integer DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.tenant_signup_events; v_delay integer;
BEGIN
  IF _error_code IS NULL OR _error_code !~ '^[a-z0-9_]{1,80}$'
     OR (_retry_after_seconds IS NOT NULL AND _retry_after_seconds NOT BETWEEN 30 AND 86400) THEN
    RAISE EXCEPTION 'Invalid retry metadata' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_event FROM public.tenant_signup_events WHERE id=_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.notified_at IS NOT NULL OR _lease_token IS NULL
     OR v_event.lease_until IS NULL OR v_event.lease_token IS DISTINCT FROM _lease_token
     OR v_event.lease_until <= now() THEN
    RETURN 'lease_lost';
  END IF;
  IF v_event.attempt_count >= 8 THEN
    UPDATE public.tenant_signup_events
      SET dead_lettered_at=now(),lease_token=NULL,lease_until=NULL,last_error_code=_error_code
      WHERE id=_event_id;
    RETURN 'dead_lettered';
  END IF;
  v_delay := coalesce(_retry_after_seconds, least(3600,(power(2,least(v_event.attempt_count,7))::integer)*30));
  UPDATE public.tenant_signup_events
    SET next_attempt_at=now()+make_interval(secs=>v_delay),
        lease_token=NULL,lease_until=NULL,last_error_code=_error_code
    WHERE id=_event_id;
  RETURN 'retry_scheduled';
END $$;
REVOKE ALL ON FUNCTION public.fail_tenant_signup_event(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_tenant_signup_event(uuid,uuid,text,integer) TO service_role;

-- Operator recovery after a dead-letter investigation; service role only.
CREATE FUNCTION public.requeue_tenant_signup_event(_event_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.tenant_signup_events
    SET dead_lettered_at=NULL,next_attempt_at=now(),attempt_count=0,
        lease_token=NULL,lease_until=NULL,last_error_code=NULL
    WHERE id=_event_id AND dead_lettered_at IS NOT NULL AND notified_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.requeue_tenant_signup_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_tenant_signup_event(uuid) TO service_role;
