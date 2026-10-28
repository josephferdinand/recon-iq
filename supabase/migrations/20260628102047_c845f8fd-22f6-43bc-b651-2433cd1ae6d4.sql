
CREATE TABLE public.balance_substantiations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  signoff_id UUID NOT NULL REFERENCES public.eod_signoffs(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  account_name TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  gl_balance NUMERIC(20,4) NOT NULL DEFAULT 0,
  sub_ledger_balance NUMERIC(20,4) NOT NULL DEFAULT 0,
  variance NUMERIC(20,4) GENERATED ALWAYS AS (gl_balance - sub_ledger_balance) STORED,
  tolerance NUMERIC(20,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reconciled','exception','approved')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  prepared_by UUID,
  prepared_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.balance_substantiations TO authenticated;
GRANT ALL ON public.balance_substantiations TO service_role;
ALTER TABLE public.balance_substantiations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read substantiations"
  ON public.balance_substantiations FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "analysts write substantiations"
  ON public.balance_substantiations FOR ALL TO authenticated
  USING (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  )
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
    )
  );

CREATE INDEX idx_balance_sub_signoff ON public.balance_substantiations(signoff_id);
CREATE INDEX idx_balance_sub_tenant ON public.balance_substantiations(tenant_id);

CREATE TRIGGER balance_sub_updated
  BEFORE UPDATE ON public.balance_substantiations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.exception_assignment_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  recon_id UUID REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('round_robin','load_balanced','by_tag','by_severity')),
  assignee_pool UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  tag_routes JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity_routes JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_assigned_index INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exception_assignment_rules TO authenticated;
GRANT ALL ON public.exception_assignment_rules TO service_role;
ALTER TABLE public.exception_assignment_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read assignment rules"
  ON public.exception_assignment_rules FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "admins write assignment rules"
  ON public.exception_assignment_rules FOR ALL TO authenticated
  USING (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_tenant_member(auth.uid(), tenant_id)
    AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
  );

CREATE INDEX idx_assign_rules_tenant ON public.exception_assignment_rules(tenant_id);
CREATE INDEX idx_assign_rules_recon ON public.exception_assignment_rules(recon_id);

CREATE TRIGGER assign_rules_updated
  BEFORE UPDATE ON public.exception_assignment_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

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

REVOKE EXECUTE ON FUNCTION public.pick_next_assignee(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pick_next_assignee(UUID, TEXT, TEXT[]) TO authenticated;
