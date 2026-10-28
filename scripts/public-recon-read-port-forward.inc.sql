CREATE FUNCTION public.read_reconciliation_runs_for_api(
 _token_id uuid,_tenant_id uuid,_tenant_slug text,_recon_id uuid,
 _mode text,_run_id uuid,_page integer,_days integer,_status text,_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth SET row_security=on AS $read$
DECLARE actor uuid; token_row public.api_tokens%ROWTYPE; payload jsonb; rows_json jsonb;
 run_json jsonb; page_json jsonb; counts_json jsonb; total bigint; audit_id bigint; since_time timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'not permitted' USING ERRCODE='42501';
 END IF;
 IF _token_id IS NULL OR _tenant_id IS NULL OR _tenant_slug IS NULL OR _recon_id IS NULL
   OR _page IS NULL OR _page NOT BETWEEN 1 AND 10000 OR _mode IS NULL OR _mode NOT IN ('history','results')
   OR _days IS NULL OR _days NOT IN (1,7,14,30,90)
   OR _status IS NULL OR _status NOT IN ('all','match','partial','missing','duplicate','invalid_key','other','unavailable')
   OR (_mode='results' AND _run_id IS NULL) OR (_mode='history' AND (_run_id IS NOT NULL OR _status<>'all')) THEN
   RAISE EXCEPTION 'invalid read input' USING ERRCODE='22023';
 END IF;
 SELECT p.actor_user_id INTO actor FROM private.qualified_user_delegated_api_token(_token_id,_tenant_id,'recons.read') p;
 SELECT t.* INTO token_row FROM public.api_tokens t WHERE t.id=_token_id;
 -- Locks serialize read-before-revoke. Revocation committed first is denied.
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant_id AND user_id=actor AND active=true FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_tenant_id AND slug=_tenant_slug FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'read not found' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.recon_definitions WHERE id=_recon_id AND tenant_id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'read not found' USING ERRCODE='P0002'; END IF;
 -- Lock current authorization inputs, always by token actor/target. No table lock,
 -- caller-selected actor, JWT override, role switch or general privileged proxy.
 PERFORM 1 FROM public.recon_definition_business_units WHERE recon_id=_recon_id FOR SHARE;
 PERFORM 1 FROM public.recon_definition_bu_grants WHERE recon_id=_recon_id FOR SHARE;
 PERFORM 1 FROM public.recon_permissions WHERE recon_id=_recon_id FOR SHARE;
 PERFORM 1 FROM public.tenant_group_members gm JOIN public.tenant_groups g ON g.id=gm.group_id
   WHERE gm.user_id=actor AND g.tenant_id=_tenant_id FOR SHARE OF gm,g;
 PERFORM 1 FROM public.bu_user_assignments WHERE tenant_id=_tenant_id AND user_id=actor FOR SHARE;
 PERFORM 1 FROM public.bu_group_assignments ga JOIN public.tenant_group_members gm ON gm.group_id=ga.group_id
   WHERE ga.tenant_id=_tenant_id AND gm.user_id=actor FOR SHARE OF ga;
 PERFORM 1 FROM public.business_units WHERE tenant_id=_tenant_id AND id IN (
   SELECT bu_id FROM public.recon_definition_business_units WHERE recon_id=_recon_id
   UNION SELECT bu_id FROM public.bu_user_assignments WHERE tenant_id=_tenant_id AND user_id=actor
   UNION SELECT ga.bu_id FROM public.bu_group_assignments ga JOIN public.tenant_group_members gm ON gm.group_id=ga.group_id
     WHERE ga.tenant_id=_tenant_id AND gm.user_id=actor) FOR SHARE;
 PERFORM 1 FROM public.platform_roles WHERE user_id=actor FOR SHARE;
 PERFORM 1 FROM public.platform_support_grants WHERE actor_id=actor AND tenant_id=_tenant_id FOR SHARE;
 IF public.recon_authoritative_access_decision_as(actor,_recon_id,'view') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'not permitted' USING ERRCODE='42501';
 END IF;
 IF _mode='history' THEN
   since_time := statement_timestamp()-make_interval(days=>_days);
   -- One statement/snapshot for total AND page so concurrent new runs cannot
   -- disagree with has_next or total. All projections remain tenant/recon scoped.
   WITH scoped AS MATERIALIZED (
     SELECT id,run_uid,definition_id,status,matched_count,exception_count,total_rows,started_at,completed_at,
       CASE WHEN jsonb_typeof(stats->'matched_records')='number' THEN stats->'matched_records' ELSE 'null'::jsonb END AS matched_input_memberships
     FROM public.recon_runs WHERE tenant_id=_tenant_id AND definition_id=_recon_id AND started_at>=since_time
   ), page_rows AS (SELECT * FROM scoped ORDER BY started_at DESC,id ASC OFFSET ((_page-1)*50) LIMIT 50)
   SELECT (SELECT count(*) FROM scoped),coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.started_at DESC,p.id ASC),'[]')
     INTO total,rows_json FROM page_rows p;
   payload := jsonb_build_object('rows',rows_json,'total',total,'page',_page,'page_size',50,'has_next',_page::bigint*50<total);
 ELSE
   PERFORM 1 FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND definition_id=_recon_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'read not found' USING ERRCODE='P0002'; END IF;
   -- Same statement snapshot for stored run metadata, result parents and counts.
   SELECT to_jsonb(r),private.recon_api_persisted_result_page(_tenant_id,_run_id,_page-1,_status),
     private.recon_api_persisted_result_counts(_tenant_id,_run_id)
   INTO run_json,page_json,counts_json FROM (
     SELECT id,run_uid,definition_id,status,matched_count,exception_count,total_rows,started_at,completed_at,
       CASE WHEN jsonb_typeof(stats->'matched_records')='number' THEN stats->'matched_records' ELSE 'null'::jsonb END AS matched_input_memberships
     FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND definition_id=_recon_id) r;
   IF page_json IS NULL OR (page_json->>'page_size')::integer IS DISTINCT FROM 50 THEN
     RAISE EXCEPTION 'result paging contract drift';
   END IF;
   payload := jsonb_build_object('run',run_json,'results',page_json->'rows','field_names',page_json->'field_names',
     'parent_count',page_json->'parent_count','page',_page,'page_size',50,'has_next',page_json->'has_next','status_counts',counts_json);
 END IF;
 IF (token_row.expires_at IS NOT NULL AND token_row.expires_at<=clock_timestamp())
   OR public.recon_authoritative_access_decision_as(actor,_recon_id,'view') IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'not permitted' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.audit_log(tenant_id,tenant_slug,actor_user_id,scope,action,resource_type,resource_id,context)
 VALUES(_tenant_id,_tenant_slug,actor,'api',
   CASE WHEN _mode='history' THEN 'api.reconciliation.run_history.read' ELSE 'api.reconciliation.run_results.read' END,
   CASE WHEN _mode='history' THEN 'recon_definition' ELSE 'recon_run' END,coalesce(_run_id,_recon_id)::text,
   jsonb_build_object('api_token_id',_token_id,'principal_kind','user_delegated','recon_id',_recon_id,
     'page',_page,'days',_days,'status',_status,'api_request_id',_request_id)) RETURNING id INTO audit_id;
 -- Insert returning includes AFTER-trigger completion. Require positive int8 receipt.
 IF audit_id IS NULL OR audit_id<=0 OR NOT EXISTS(SELECT 1 FROM public.audit_log a
   JOIN public.audit_chain_head h ON h.singleton=true AND h.last_audit_id=a.id AND h.last_hash=a.row_hash
   WHERE a.id=audit_id AND a.actor_user_id=actor AND a.tenant_id=_tenant_id
     AND a.resource_id=coalesce(_run_id,_recon_id)::text AND a.context->>'api_token_id'=_token_id::text
     AND octet_length(a.row_hash)=32)
   OR (token_row.expires_at IS NOT NULL AND token_row.expires_at<=clock_timestamp()) THEN
   RAISE EXCEPTION 'read audit receipt absent';
 END IF;
 RETURN payload||jsonb_build_object('audit_id',audit_id::text);
END $read$;
REVOKE ALL ON FUNCTION public.read_reconciliation_runs_for_api(uuid,uuid,text,uuid,text,uuid,integer,integer,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_reconciliation_runs_for_api(uuid,uuid,text,uuid,text,uuid,integer,integer,text,uuid) TO service_role;
