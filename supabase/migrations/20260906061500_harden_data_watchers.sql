-- Deterministic watcher catalogue, atomic state transitions, notification deduplication and audit evidence.

ALTER TABLE public.data_watchers
  DROP CONSTRAINT IF EXISTS data_watchers_watch_type_check;
ALTER TABLE public.data_watchers
  ADD CONSTRAINT data_watchers_watch_type_check CHECK (watch_type IN (
    'freshness', 'raw_data', 'row_count_delta', 'schema_change', 'dq_failure', 'no_upload',
    'late_file', 'duplicate_file', 'filename_pattern', 'control_total', 'checksum_integrity'
  ));

CREATE OR REPLACE FUNCTION public.tg_validate_data_watcher_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_data_sources
    WHERE id = NEW.data_source_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Watcher source must belong to the same tenant';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_validate_data_watcher_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS data_watchers_validate_tenant ON public.data_watchers;
CREATE TRIGGER data_watchers_validate_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, data_source_id ON public.data_watchers
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_data_watcher_tenant();

CREATE TABLE public.data_watcher_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  watcher_id uuid NOT NULL REFERENCES public.data_watchers(id),
  previous_state text,
  new_state text NOT NULL CHECK (new_state IN ('ok', 'alert', 'insufficient_data')),
  outcome_code text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  trigger text NOT NULL CHECK (trigger IN ('browser', 'api', 'schedule')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_created boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_watcher_events_tenant_time_idx
  ON public.data_watcher_events(tenant_id, occurred_at DESC);
CREATE INDEX data_watcher_events_watcher_time_idx
  ON public.data_watcher_events(watcher_id, occurred_at DESC);

ALTER TABLE public.data_watcher_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.data_watcher_events TO authenticated;
GRANT ALL ON public.data_watcher_events TO service_role;
CREATE POLICY data_watcher_events_member_read
  ON public.data_watcher_events FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.record_data_watcher_evaluation(
  _tenant_id uuid,
  _watcher_id uuid,
  _new_state text,
  _outcome_code text,
  _detail jsonb,
  _trigger text,
  _actor_user_id uuid,
  _reminder_hours numeric,
  _quarantine_on_alert boolean,
  _checked_at timestamptz
)
RETURNS TABLE(event_id uuid, previous_state text, notification_created boolean, source_quarantined boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.data_watchers%ROWTYPE;
  event_uuid uuid;
  should_notify boolean := false;
  notification_kind text;
  notification_title text;
  quarantined boolean := false;
BEGIN
  IF _new_state NOT IN ('ok', 'alert', 'insufficient_data') THEN
    RAISE EXCEPTION 'Invalid watcher state';
  END IF;
  IF _trigger NOT IN ('browser', 'api', 'schedule') THEN
    RAISE EXCEPTION 'Invalid watcher trigger';
  END IF;
  IF _outcome_code !~ '^[a-z][a-z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'Invalid watcher outcome';
  END IF;
  IF _reminder_hours < 1 OR _reminder_hours > 720 THEN
    RAISE EXCEPTION 'Invalid watcher reminder interval';
  END IF;

  SELECT * INTO w
  FROM public.data_watchers
  WHERE id = _watcher_id AND tenant_id = _tenant_id AND enabled
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Watcher not found or disabled'; END IF;

  IF _new_state = 'alert' AND (
    w.last_state IS DISTINCT FROM 'alert'
    OR w.last_alerted_at IS NULL
    OR w.last_alerted_at + make_interval(secs => (_reminder_hours * 3600)::double precision) <= _checked_at
  ) THEN
    should_notify := true;
    notification_kind := 'watcher.alert';
    notification_title := 'Watcher alert: ' || w.name;
  ELSIF _new_state = 'ok' AND w.last_state = 'alert' THEN
    should_notify := true;
    notification_kind := 'watcher.recovered';
    notification_title := 'Watcher recovered: ' || w.name;
  END IF;

  UPDATE public.data_watchers SET
    last_checked_at = _checked_at,
    last_state = _new_state,
    last_alerted_at = CASE WHEN should_notify AND _new_state = 'alert' THEN _checked_at ELSE last_alerted_at END
  WHERE id = _watcher_id AND tenant_id = _tenant_id;

  IF _new_state = 'alert' AND _quarantine_on_alert THEN
    UPDATE public.workspace_data_sources
    SET status = 'error', last_error = 'Watcher quarantine: ' || _outcome_code
    WHERE id = w.data_source_id AND tenant_id = _tenant_id AND status <> 'archived'
      AND (status <> 'error' OR last_error IS DISTINCT FROM 'Watcher quarantine: ' || _outcome_code);
    quarantined := FOUND;
  END IF;

  INSERT INTO public.data_watcher_events(
    tenant_id, watcher_id, previous_state, new_state, outcome_code, detail,
    trigger, actor_user_id, notification_created, occurred_at
  ) VALUES (
    _tenant_id, _watcher_id, w.last_state, _new_state, _outcome_code,
    COALESCE(_detail, '{}'::jsonb), _trigger, _actor_user_id, should_notify, _checked_at
  ) RETURNING id INTO event_uuid;

  IF should_notify AND w.created_by IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, tenant_id, kind, severity, title, body, context)
    VALUES (
      w.created_by, _tenant_id, notification_kind,
      CASE WHEN _new_state = 'alert' AND w.severity = 'critical' THEN 'error'
           WHEN _new_state = 'alert' THEN w.severity ELSE 'info' END,
      notification_title, _outcome_code,
      jsonb_build_object('watcher_id', _watcher_id, 'event_id', event_uuid, 'outcome_code', _outcome_code)
    );
  ELSE
    should_notify := false;
  END IF;

  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (
    _actor_user_id, _tenant_id,
    CASE WHEN _trigger = 'schedule' THEN 'system' ELSE 'workspace' END,
    'watcher.evaluated', 'data_watcher', _watcher_id::text,
    jsonb_build_object(
      'event_id', event_uuid, 'previous_state', w.last_state, 'new_state', _new_state,
      'outcome_code', _outcome_code, 'trigger', _trigger, 'notification_created', should_notify,
      'source_quarantined', quarantined
    )
  );

  RETURN QUERY SELECT event_uuid, w.last_state, should_notify, quarantined;
END;
$$;

REVOKE ALL ON FUNCTION public.record_data_watcher_evaluation(uuid,uuid,text,text,jsonb,text,uuid,numeric,boolean,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_data_watcher_evaluation(uuid,uuid,text,text,jsonb,text,uuid,numeric,boolean,timestamptz) TO service_role;
