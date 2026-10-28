-- Atomic, permission-bound assignment and match-review governance.

CREATE OR REPLACE FUNCTION public.pick_next_assignee(
  _rule_id uuid,
  _severity text DEFAULT NULL,
  _tags text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rule_row public.exception_assignment_rules%ROWTYPE;
  candidate uuid;
  eligible_pool uuid[];
  cursor_index integer;
BEGIN
  SELECT * INTO rule_row
  FROM public.exception_assignment_rules
  WHERE id=_rule_id AND enabled=true
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_tenant_role(auth.uid(), rule_row.tenant_id, 'tenant_admin')
    OR public.user_has_permission(auth.uid(), rule_row.tenant_id, 'break.assign', NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.assign permission required';
  END IF;

  SELECT array_agg(member.user_id ORDER BY array_position(rule_row.assignee_pool, member.user_id))
  INTO eligible_pool
  FROM public.tenant_members member
  WHERE member.tenant_id=rule_row.tenant_id
    AND member.active=true
    AND member.user_id=ANY(rule_row.assignee_pool);

  IF rule_row.strategy='by_severity' AND _severity IS NOT NULL
     AND rule_row.severity_routes ? _severity THEN
    candidate := (rule_row.severity_routes->>_severity)::uuid;
  ELSIF rule_row.strategy='by_tag' AND _tags IS NOT NULL THEN
    SELECT (rule_row.tag_routes->>tag)::uuid INTO candidate
    FROM unnest(_tags) tag
    WHERE rule_row.tag_routes ? tag
    LIMIT 1;
  ELSIF rule_row.strategy='load_balanced' THEN
    SELECT pool.user_id INTO candidate
    FROM unnest(eligible_pool) pool(user_id)
    LEFT JOIN public.recon_exceptions exception
      ON exception.tenant_id=rule_row.tenant_id
     AND exception.assignee=pool.user_id
     AND exception.status IN ('open','investigating')
    GROUP BY pool.user_id
    ORDER BY count(exception.id), array_position(eligible_pool,pool.user_id)
    LIMIT 1;
  ELSIF cardinality(eligible_pool) > 0 THEN
    cursor_index := (rule_row.last_assigned_index + 1) % cardinality(eligible_pool);
    candidate := eligible_pool[cursor_index + 1];
    UPDATE public.exception_assignment_rules
    SET last_assigned_index=cursor_index, updated_at=now()
    WHERE id=rule_row.id;
  END IF;

  IF candidate IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members member
    WHERE member.tenant_id=rule_row.tenant_id
      AND member.user_id=candidate
      AND member.active=true
  ) THEN
    RETURN NULL;
  END IF;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_exceptions_from_rule(
  _tenant_id uuid,
  _rule_id uuid,
  _exception_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
  rule_row public.exception_assignment_rules%ROWTYPE;
  exception_id uuid;
  exception_row public.recon_exceptions%ROWTYPE;
  candidate uuid;
  assigned_count integer := 0;
  skipped_count integer := 0;
BEGIN
  IF actor_id IS NULL OR NOT (
    public.has_tenant_role(actor_id,_tenant_id,'tenant_admin')
    OR public.user_has_permission(actor_id,_tenant_id,'break.assign',NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.assign permission required';
  END IF;
  SELECT * INTO rule_row FROM public.exception_assignment_rules
  WHERE id=_rule_id AND tenant_id=_tenant_id AND enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment rule not found'; END IF;

  FOREACH exception_id IN ARRAY _exception_ids LOOP
    SELECT * INTO exception_row FROM public.recon_exceptions
    WHERE id=exception_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND OR (rule_row.recon_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.recon_runs run
      WHERE run.id=exception_row.run_id AND run.tenant_id=_tenant_id
        AND run.definition_id=rule_row.recon_id
    )) THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    candidate := public.pick_next_assignee(
      _rule_id,
      exception_row.severity,
      exception_row.tags
    );
    IF candidate IS NULL THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    UPDATE public.recon_exceptions
    SET assignee=candidate, assigned_by=actor_id, assigned_at=now()
    WHERE id=exception_row.id AND tenant_id=_tenant_id;
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor_id,_tenant_id,'workspace','exception.auto_assigned','recon_exception',exception_row.id::text,
      jsonb_build_object('rule_id',_rule_id,'assignee_id',candidate));
    assigned_count := assigned_count + 1;
  END LOOP;
  RETURN jsonb_build_object('assigned',assigned_count,'skipped',skipped_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_proposed_match_atomic(
  _tenant_id uuid,
  _match_id uuid,
  _decision text,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
  proposal public.proposed_matches%ROWTYPE;
  created_match_id uuid;
BEGIN
  IF _decision NOT IN ('accepted','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  IF actor_id IS NULL OR NOT (
    public.has_tenant_role(actor_id,_tenant_id,'tenant_admin')
    OR public.user_has_permission(actor_id,_tenant_id,'recon.match.approve',NULL)
  ) THEN RAISE EXCEPTION 'forbidden: recon.match.approve permission required'; END IF;
  SELECT * INTO proposal FROM public.proposed_matches
  WHERE id=_match_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposed match not found'; END IF;
  IF proposal.status<>'pending' THEN RAISE EXCEPTION 'proposed match already decided'; END IF;
  IF proposal.run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.recon_runs run
    WHERE run.id=proposal.run_id AND run.tenant_id=_tenant_id
      AND (proposal.definition_id IS NULL OR run.definition_id=proposal.definition_id)
  ) THEN RAISE EXCEPTION 'proposed match scope mismatch'; END IF;

  IF _decision='accepted' AND proposal.run_id IS NOT NULL THEN
    INSERT INTO public.recon_matches(run_id,tenant_id,rule_id,cardinality,members,score,confidence,confidence_model,feature_vector)
    VALUES (proposal.run_id,_tenant_id,coalesce(proposal.rule_hint,'ml_proposed'),proposal.cardinality,
      proposal.members,proposal.ml_score,proposal.ml_score,'proposed_match',proposal.ml_features)
    RETURNING id INTO created_match_id;
  END IF;
  UPDATE public.proposed_matches SET status=_decision,reviewer_id=actor_id,reviewed_at=now(),review_note=_note
  WHERE id=_match_id AND tenant_id=_tenant_id;
  IF proposal.definition_id IS NOT NULL THEN
    INSERT INTO public.recon_match_feedback(tenant_id,recon_id,match_id,decision,feature_vector,predicted_confidence,notes,decided_by)
    VALUES (_tenant_id,proposal.definition_id,created_match_id,
      CASE WHEN _decision='accepted' THEN 'accept' ELSE 'reject' END,
      proposal.ml_features,proposal.ml_score,_note,actor_id);
  END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor_id,_tenant_id,'workspace','proposed_match.'||_decision,'proposed_matches',_match_id::text,
    jsonb_build_object('created_match_id',created_match_id,'confidence',proposal.ml_score));
  RETURN jsonb_build_object('ok',true,'match_id',created_match_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_proposed_matches_atomic(
  _tenant_id uuid,
  _match_ids uuid[],
  _decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE item_id uuid; processed integer := 0;
BEGIN
  FOREACH item_id IN ARRAY _match_ids LOOP
    PERFORM public.review_proposed_match_atomic(_tenant_id,item_id,_decision,NULL);
    processed := processed + 1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'count',processed);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_manual_match_atomic(
  _tenant_id uuid,
  _approval_id uuid,
  _decision text,
  _reject_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
  approval public.manual_match_approvals%ROWTYPE;
  new_match_id uuid;
  scoped_exception_count integer;
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  IF actor_id IS NULL OR NOT (
    public.has_tenant_role(actor_id,_tenant_id,'tenant_admin')
    OR public.user_has_permission(actor_id,_tenant_id,'recon.match.approve',NULL)
  ) THEN RAISE EXCEPTION 'forbidden: recon.match.approve permission required'; END IF;
  SELECT * INTO approval FROM public.manual_match_approvals
  WHERE id=_approval_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manual match approval not found'; END IF;
  IF approval.status<>'pending' THEN RAISE EXCEPTION 'manual match already decided'; END IF;
  IF approval.proposed_by=actor_id THEN RAISE EXCEPTION 'maker cannot approve own manual match'; END IF;
  IF approval.run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.recon_runs run WHERE run.id=approval.run_id AND run.tenant_id=_tenant_id
  ) THEN RAISE EXCEPTION 'manual match run scope mismatch'; END IF;
  SELECT count(*) INTO scoped_exception_count FROM public.recon_exceptions
  WHERE id=ANY(approval.exception_ids) AND tenant_id=_tenant_id
    AND (approval.run_id IS NULL OR run_id=approval.run_id);
  IF scoped_exception_count<>cardinality(approval.exception_ids) THEN
    RAISE EXCEPTION 'manual match exception scope mismatch';
  END IF;

  IF _decision='approved' AND approval.run_id IS NOT NULL THEN
    INSERT INTO public.recon_matches(run_id,tenant_id,rule_id,cardinality,members,score)
    VALUES (approval.run_id,_tenant_id,'manual_4eyes',approval.cardinality,approval.members,1)
    RETURNING id INTO new_match_id;
    UPDATE public.recon_exceptions
    SET status='resolved',resolved_by=actor_id,resolved_at=now(),resolution_note='Manual 4-eyes match approved'
    WHERE id=ANY(approval.exception_ids) AND tenant_id=_tenant_id;
  END IF;
  UPDATE public.manual_match_approvals
  SET status=_decision,approver_id=actor_id,approved_at=now(),reject_reason=_reject_reason,
      created_match_id=new_match_id
  WHERE id=_approval_id AND tenant_id=_tenant_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor_id,_tenant_id,'workspace','manual_match.'||_decision,'manual_match_approvals',_approval_id::text,
    jsonb_build_object('match_id',new_match_id,'reason',_reject_reason));
  RETURN jsonb_build_object('ok',true,'match_id',new_match_id);
END;
$$;

REVOKE UPDATE ON public.proposed_matches, public.manual_match_approvals FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pick_next_assignee(uuid,text,text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assign_exceptions_from_rule(uuid,uuid,uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_proposed_match_atomic(uuid,uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_proposed_matches_atomic(uuid,uuid[],text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_manual_match_atomic(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pick_next_assignee(uuid,text,text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_exceptions_from_rule(uuid,uuid,uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_proposed_match_atomic(uuid,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_proposed_matches_atomic(uuid,uuid[],text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_manual_match_atomic(uuid,uuid,text,text) TO authenticated, service_role;
