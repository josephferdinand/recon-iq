-- Predecessor to target-importer binding. A fail-closed, audited database
-- mutation gate covers request writes and authenticated package export calls
-- that an app/Worker pause cannot intercept. Normal migration runners install
-- it closed. The guarded cutover script may set the transaction-local flag to
-- install open and close it again before the same transaction commits.
CREATE TABLE IF NOT EXISTS public.environment_change_cutover_gate (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  paused boolean NOT NULL DEFAULT true,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.environment_change_cutover_gate FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.environment_change_cutover_gate ENABLE ROW LEVEL SECURITY;
INSERT INTO public.environment_change_cutover_gate(singleton,paused,reason)
VALUES (true,
  current_setting('fvi.importer_cutover_atomic',true) IS DISTINCT FROM 'on',
  CASE WHEN current_setting('fvi.importer_cutover_atomic',true)='on'
    THEN 'Initial open state inside the guarded importer cutover transaction'
    ELSE 'Fail-closed until the importer cutover is reviewed'
  END)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION private.environment_change_mutations_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
  SELECT coalesce((SELECT NOT gate.paused FROM public.environment_change_cutover_gate gate
    WHERE gate.singleton=true),false)
$function$;
REVOKE ALL ON FUNCTION private.environment_change_mutations_open() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_environment_change_cutover_pause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $function$
BEGIN
  IF NOT private.environment_change_mutations_open() THEN
    RAISE EXCEPTION 'Environment change intake is paused for controlled release'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_environment_change_cutover_pause() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS environment_change_cutover_pause ON public.environment_change_requests;
CREATE TRIGGER environment_change_cutover_pause
  BEFORE INSERT OR UPDATE ON public.environment_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_environment_change_cutover_pause();

CREATE OR REPLACE FUNCTION public.guard_environment_change_export_cutover_pause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private AS $function$
BEGIN
  IF NEW.event_type='package_exported'
     AND NOT private.environment_change_mutations_open() THEN
    RAISE EXCEPTION 'Environment change intake is paused for controlled release'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_environment_change_export_cutover_pause()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS environment_change_export_cutover_pause
  ON public.environment_change_events;
CREATE TRIGGER environment_change_export_cutover_pause
  BEFORE INSERT ON public.environment_change_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_environment_change_export_cutover_pause();

CREATE OR REPLACE FUNCTION public.set_environment_change_cutover_pause(
  _paused boolean, _reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE v_previous boolean;
BEGIN
  IF _paused IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'A release reason is required' USING ERRCODE='22023';
  END IF;
  SELECT gate.paused INTO v_previous
  FROM public.environment_change_cutover_gate gate WHERE gate.singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change cutover gate is unavailable' USING ERRCODE='55000'; END IF;
  IF v_previous IS DISTINCT FROM _paused THEN
    UPDATE public.environment_change_cutover_gate
    SET paused=_paused,reason=btrim(_reason),changed_at=now()
    WHERE singleton=true;
    INSERT INTO public.audit_log(scope,action,resource_type,resource_id,context)
    VALUES ('system','system.environment_change_pause_changed','environment_change_cutover_gate','global',
      jsonb_build_object('previous_paused',v_previous,'new_paused',_paused,
        'reason',btrim(_reason),'executor','governed Management SQL'));
  END IF;
  RETURN _paused;
END
$function$;
REVOKE ALL ON FUNCTION public.set_environment_change_cutover_pause(boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.environment_change_cutover_gate IS
  'Release-operation gate: request writes and package-export audit events fail closed while paused, including service-role API/RPC callers. Changed only through audited Management SQL.';
