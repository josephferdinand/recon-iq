-- Repair the exact live PL/pgSQL errors reported by `supabase db lint`.
-- Each replacement is guarded: schema drift aborts the migration rather than
-- silently leaving a stale function in place.

DO $repair$
DECLARE
  original text;
  fixed text;
BEGIN
  original := pg_get_functiondef('public.simulate_cascade_policy(uuid,uuid,uuid)'::regprocedure);
  fixed := replace(original,
    'FROM public.recon_match_allocations a
    WHERE a.tenant_id = _tenant_id
      AND a.recon_run_id = _recon_run_id',
    'FROM public.recon_match_allocations a
    JOIN public.recon_matches m ON m.id = a.match_id
    WHERE a.tenant_id = _tenant_id
      AND m.run_id = _recon_run_id');
  IF fixed = original THEN RAISE EXCEPTION 'simulate_cascade_policy repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.list_allowed_signoff_transitions(uuid)'::regprocedure);
  fixed := original;
  fixed := replace(fixed, 'v_out := v_out || ''reopened''', 'v_out := array_append(v_out, ''reopened'')');
  fixed := replace(fixed, 'v_out := v_out || ''prepared''', 'v_out := array_append(v_out, ''prepared'')');
  fixed := replace(fixed, 'v_out := v_out || ''reviewed''', 'v_out := array_append(v_out, ''reviewed'')');
  fixed := replace(fixed, 'v_out := v_out || ''rejected''', 'v_out := array_append(v_out, ''rejected'')');
  fixed := replace(fixed, 'v_out := v_out || ''certified''', 'v_out := array_append(v_out, ''certified'')');
  IF fixed = original THEN RAISE EXCEPTION 'list_allowed_signoff_transitions repair anchors missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.engage_ai_kill_switch(uuid,text,text)'::regprocedure);
  fixed := replace(original,
    'INSERT INTO public.audit_log(tenant_id, actor_id, action, target_table, target_id, payload)
  VALUES (p_tenant, auth.uid(), ''ai.kill_switch.engaged'', ''ai_governance_kill_switches'', r.id,',
    'INSERT INTO public.audit_log(tenant_id, actor_user_id, scope, action, resource_type, resource_id, context)
  VALUES (p_tenant, auth.uid(), ''tenant'', ''ai.kill_switch.engaged'', ''ai_governance_kill_switches'', r.id::text,');
  IF fixed = original THEN RAISE EXCEPTION 'engage_ai_kill_switch repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.release_ai_kill_switch(uuid,text)'::regprocedure);
  fixed := replace(original,
    'INSERT INTO public.audit_log(tenant_id, actor_id, action, target_table, target_id, payload)
  VALUES (p_tenant, auth.uid(), ''ai.kill_switch.released'', ''ai_governance_kill_switches'', r.id,',
    'INSERT INTO public.audit_log(tenant_id, actor_user_id, scope, action, resource_type, resource_id, context)
  VALUES (p_tenant, auth.uid(), ''tenant'', ''ai.kill_switch.released'', ''ai_governance_kill_switches'', r.id::text,');
  IF fixed = original THEN RAISE EXCEPTION 'release_ai_kill_switch repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.assert_tenant_access(uuid)'::regprocedure);
  fixed := replace(original,
    'INSERT INTO public.security_events (event_type, severity, actor_id, tenant_id, payload)',
    'INSERT INTO public.security_events (event_type, severity, user_id, tenant_id, context)');
  fixed := replace(fixed, ' STABLE SECURITY DEFINER', ' VOLATILE SECURITY DEFINER');
  IF fixed = original THEN RAISE EXCEPTION 'assert_tenant_access repair anchors missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.mkt_book_appointment(text,timestamptz,text,text,text,uuid,text)'::regprocedure);
  fixed := replace(original,
    'FROM public.mkt_appointments
    WHERE type_id = v_type.id
      AND status IN (''confirmed'',''pending'')
      AND start_at::date = _start_at::date',
    'FROM public.mkt_appointments a
    WHERE a.type_id = v_type.id
      AND a.status IN (''confirmed'',''pending'')
      AND a.start_at::date = _start_at::date');
  fixed := replace(fixed,
    'SELECT 1 FROM public.mkt_appointments
     WHERE type_id = v_type.id
       AND status IN (''confirmed'',''pending'')
       AND tstzrange(start_at, end_at, ''[)'')',
    'SELECT 1 FROM public.mkt_appointments a
     WHERE a.type_id = v_type.id
       AND a.status IN (''confirmed'',''pending'')
       AND tstzrange(a.start_at, a.end_at, ''[)'')');
  fixed := replace(fixed,
    'INSERT INTO public.mkt_appointments
      (lead_id, type_id, start_at, end_at, status,',
    'INSERT INTO public.mkt_appointments AS appointment
      (lead_id, type_id, start_at, end_at, status,');
  fixed := replace(fixed,
    'RETURNING id, status, start_at, end_at, v_type.name',
    'RETURNING appointment.id, appointment.status, appointment.start_at, appointment.end_at, v_type.name');
  IF fixed = original THEN RAISE EXCEPTION 'mkt_book_appointment repair anchors missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.hash_sandbox_client_secret(text)'::regprocedure);
  fixed := replace(replace(original, 'crypt(_plain_secret', 'extensions.crypt(_plain_secret'),
    'gen_salt(''bf'', 10)', 'extensions.gen_salt(''bf'', 10)');
  IF fixed = original THEN RAISE EXCEPTION 'hash_sandbox_client_secret repair anchors missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.verify_sandbox_client_secret(text,text)'::regprocedure);
  fixed := replace(original, 'crypt(_plain_secret, c.client_secret_hash)',
    'extensions.crypt(_plain_secret, c.client_secret_hash)');
  IF fixed = original THEN RAISE EXCEPTION 'verify_sandbox_client_secret repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.evaluate_security_alerts()'::regprocedure);
  fixed := replace(original, 'WHERE tenant_id = r.tenant_id',
    'WHERE security_events.tenant_id = r.tenant_id');
  IF fixed = original THEN RAISE EXCEPTION 'evaluate_security_alerts repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.tdv_issue_token(uuid)'::regprocedure);
  fixed := replace(original, 'gen_random_bytes(24)', 'extensions.gen_random_bytes(24)');
  IF fixed = original THEN RAISE EXCEPTION 'tdv_issue_token repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.aidp_purge_stale_pages(integer)'::regprocedure);
  fixed := replace(original, 'p.storage_path', 'p.image_uri');
  fixed := replace(fixed, 's.storage_path', 's.image_uri');
  IF fixed = original THEN RAISE EXCEPTION 'aidp_purge_stale_pages repair anchors missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.webhook_outbox_replay(uuid)'::regprocedure);
  fixed := replace(original,
    'INSERT INTO public.audit_log(tenant_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (v_tenant, auth.uid(), ''webhook.replay'', ''webhook_outbox'', p_outbox_id::text,',
    'INSERT INTO public.audit_log(tenant_id, actor_user_id, scope, action, resource_type, resource_id, context)
  VALUES (v_tenant, auth.uid(), ''tenant'', ''webhook.replay'', ''webhook_outbox'', p_outbox_id::text,');
  IF fixed = original THEN RAISE EXCEPTION 'webhook_outbox_replay repair anchor missing'; END IF;
  EXECUTE fixed;

  original := pg_get_functiondef('public.set_tenant_sandbox(uuid,boolean,timestamptz,text)'::regprocedure);
  fixed := replace(original,
    'INSERT INTO public.audit_log (actor_id, tenant_id, action, resource_type, resource_id, details)
  VALUES (_uid, _tenant_id,',
    'INSERT INTO public.audit_log (actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
  VALUES (_uid, _tenant_id, ''tenant'',');
  fixed := replace(fixed, '''tenant'', _tenant_id,
          jsonb_build_object', '''tenant'', _tenant_id::text,
          jsonb_build_object');
  IF fixed = original THEN RAISE EXCEPTION 'set_tenant_sandbox repair anchors missing'; END IF;
  EXECUTE fixed;
END
$repair$;
