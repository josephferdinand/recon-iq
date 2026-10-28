-- Run after the complete ordered disposable migration replay.
DO $test$
DECLARE v_failed boolean := false;
BEGIN
  IF NOT has_function_privilege('anon','public.get_data_resource_access_summary(text,uuid[])','EXECUTE') THEN NULL;
  ELSE RAISE EXCEPTION 'anon must not execute access summary'; END IF;
  IF has_function_privilege('service_role','public.get_data_resource_access_summary(text,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'service_role direct access summary invocation must be denied';
  END IF;
  IF NOT has_function_privilege('authenticated','public.get_data_resource_access_summary(text,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated actor execute grant is missing';
  END IF;
  BEGIN
    PERFORM * FROM public.get_data_resource_access_summary('not_a_resource',ARRAY[gen_random_uuid()]);
  EXCEPTION WHEN raise_exception THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown resource type must fail closed'; END IF;
  v_failed := false;
  BEGIN
    PERFORM * FROM public.get_data_resource_access_summary('data_source',ARRAY[]::uuid[]);
  EXCEPTION WHEN raise_exception THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'empty batch must fail closed'; END IF;
  v_failed := false;
  BEGIN
    PERFORM * FROM public.get_data_resource_access_summary('data_source',ARRAY(SELECT gen_random_uuid() FROM generate_series(1,101)));
  EXCEPTION WHEN raise_exception THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'batch above 100 must fail closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.data_resource_registry'::regclass AND conname='data_resource_registry_exact_root_ck')
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.data_resource_registry'::regclass AND attname='data_source_schedule_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.data_source_schedules'::regclass AND tgname='data_resource_schedule_tenant_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'scheduled data source root constraints/tenant guard missing';
  END IF;
END
$test$;
