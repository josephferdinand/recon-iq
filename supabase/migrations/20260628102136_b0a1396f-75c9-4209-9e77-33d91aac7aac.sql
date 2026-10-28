
CREATE OR REPLACE FUNCTION public.pick_next_assignee(
  _rule_id UUID,
  _severity TEXT DEFAULT NULL,
  _tags TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.exception_assignment_rules%ROWTYPE;
  v_pool UUID[];
  v_idx INT;
  v_pick UUID;
  v_min_load INT := 2147483647;
  v_candidate UUID;
  v_load INT;
BEGIN
  SELECT * INTO v_rule FROM public.exception_assignment_rules
    WHERE id = _rule_id AND enabled = true FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Caller must belong to the rule's tenant
  IF NOT public.is_tenant_member(auth.uid(), v_rule.tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_pool := v_rule.assignee_pool;

  IF v_rule.strategy = 'by_severity' AND _severity IS NOT NULL
     AND v_rule.severity_routes ? _severity THEN
    RETURN (v_rule.severity_routes ->> _severity)::UUID;
  END IF;

  IF v_rule.strategy = 'by_tag' AND _tags IS NOT NULL THEN
    FOR i IN 1 .. array_length(_tags, 1) LOOP
      IF v_rule.tag_routes ? _tags[i] THEN
        RETURN (v_rule.tag_routes ->> _tags[i])::UUID;
      END IF;
    END LOOP;
  END IF;

  IF array_length(v_pool,1) IS NULL THEN RETURN NULL; END IF;

  IF v_rule.strategy = 'load_balanced' THEN
    FOREACH v_candidate IN ARRAY v_pool LOOP
      SELECT COUNT(*) INTO v_load FROM public.recon_exceptions
        WHERE tenant_id = v_rule.tenant_id
          AND assignee = v_candidate
          AND status IN ('open','in_progress');
      IF v_load < v_min_load THEN
        v_min_load := v_load;
        v_pick := v_candidate;
      END IF;
    END LOOP;
    RETURN v_pick;
  END IF;

  v_idx := (v_rule.last_assigned_index + 1) % array_length(v_pool,1);
  v_pick := v_pool[v_idx + 1];
  UPDATE public.exception_assignment_rules
    SET last_assigned_index = v_idx, updated_at = now()
    WHERE id = _rule_id;
  RETURN v_pick;
END;
$$;
