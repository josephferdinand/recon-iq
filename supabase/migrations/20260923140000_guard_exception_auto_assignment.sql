-- Assignment batches must not take ownership of already assigned or closed
-- exceptions. The row lock and UPDATE predicate close a stale-selection race.
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
  affected integer;
  assigned_count integer := 0;
  skipped_count integer := 0;
BEGIN
  IF actor_id IS NULL OR NOT (
    public.has_tenant_role(actor_id,_tenant_id,'tenant_admin')
    OR public.user_has_permission(actor_id,_tenant_id,'break.assign',NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.assign permission required';
  END IF;
  IF _exception_ids IS NULL OR cardinality(_exception_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'assignment batch must contain 1 to 500 exception IDs';
  END IF;
  IF (SELECT count(DISTINCT selected.id) FROM unnest(_exception_ids) AS selected(id))
     <> cardinality(_exception_ids) THEN
    RAISE EXCEPTION 'assignment batch IDs must be non-null and unique';
  END IF;
  SELECT * INTO rule_row FROM public.exception_assignment_rules
  WHERE id=_rule_id AND tenant_id=_tenant_id AND enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment rule not found'; END IF;

  FOREACH exception_id IN ARRAY _exception_ids LOOP
    SELECT * INTO exception_row FROM public.recon_exceptions
    WHERE id=exception_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND OR exception_row.status<>'open' OR exception_row.assignee IS NOT NULL
       OR exception_row.lifecycle_state IN ('resolved','written_off')
       OR (rule_row.recon_id IS NOT NULL AND NOT EXISTS (
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
    WHERE id=exception_row.id AND tenant_id=_tenant_id
      AND status='open' AND assignee IS NULL
      AND lifecycle_state NOT IN ('resolved','written_off');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>1 THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor_id,_tenant_id,'workspace','exception.auto_assigned','recon_exception',exception_row.id::text,
      jsonb_build_object('rule_id',_rule_id,'assignee_id',candidate));
    assigned_count := assigned_count + 1;
  END LOOP;
  RETURN jsonb_build_object('assigned',assigned_count,'skipped',skipped_count);
END;
$$;
