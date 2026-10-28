-- Disposable only: the gate must block direct table mutations for both
-- authenticated/service callers while permitting audited operator reopen.
BEGIN;
DO $initial$
BEGIN
  IF (SELECT paused FROM public.environment_change_cutover_gate WHERE singleton=true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'migration-only pause gate must install fail-closed';
  END IF;
  IF has_function_privilege('authenticated',
      'public.set_environment_change_cutover_pause(boolean,text)','EXECUTE')
     OR has_function_privilege('service_role',
      'public.set_environment_change_cutover_pause(boolean,text)','EXECUTE') THEN
    RAISE EXCEPTION 'operator pause setter is callable by a runtime role';
  END IF;
END $initial$;

SELECT public.set_environment_change_cutover_pause(true,'Disposable importer release freeze');
DO $paused$
BEGIN
  IF (SELECT paused FROM public.environment_change_cutover_gate WHERE singleton=true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'pause state was not persisted';
  END IF;
  BEGIN
    INSERT INTO public.environment_change_requests DEFAULT VALUES;
    RAISE EXCEPTION 'direct insert unexpectedly passed the pause gate';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM NOT LIKE '%paused for controlled release%' THEN RAISE; END IF;
  END;
END $paused$;

SET LOCAL ROLE service_role;
DO $service_paused$
BEGIN
  -- Runtime service_role has SELECT only; its SECURITY DEFINER receiver
  -- writes as the function owner and is caught by the trigger tested above.
  IF has_table_privilege(current_user,'public.environment_change_requests','INSERT') THEN
    RAISE EXCEPTION 'service role unexpectedly has direct environment-change INSERT';
  END IF;
END $service_paused$;
RESET ROLE;

SELECT public.set_environment_change_cutover_pause(false,'Disposable importer release reopen');
DO $reopened$
DECLARE v_state text;
BEGIN
  IF (SELECT paused FROM public.environment_change_cutover_gate WHERE singleton=true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'reopen state was not persisted';
  END IF;
  BEGIN
    INSERT INTO public.environment_change_requests DEFAULT VALUES;
    RAISE EXCEPTION 'invalid fixture insert unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '55000' THEN RAISE EXCEPTION 'gate remained closed after reopen'; END IF;
  END;
END $reopened$;

SELECT public.set_environment_change_cutover_pause(true,'Disposable importer release re-pause');
DO $repause$
BEGIN
  IF (SELECT paused FROM public.environment_change_cutover_gate WHERE singleton=true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cutover gate did not close after reopen';
  END IF;
END $repause$;

SELECT public.set_environment_change_cutover_pause(false,'Disposable importer release final reopen');
DO $audit$
BEGIN
  IF (SELECT count(*) FROM public.audit_log WHERE action='system.environment_change_pause_changed'
      AND context->>'reason' LIKE 'Disposable importer release %') <> 3 THEN
    RAISE EXCEPTION 'pause/reopen audit receipts are missing';
  END IF;
END $audit$;
ROLLBACK;
