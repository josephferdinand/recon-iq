
CREATE TABLE public.recon_cascade_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_definition_id uuid NOT NULL,
  name text NOT NULL,
  pass_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  on_match text NOT NULL DEFAULT 'stop',
  on_no_match text NOT NULL DEFAULT 'next_pass',
  carry_forward_unmatched boolean NOT NULL DEFAULT true,
  max_passes integer NOT NULL DEFAULT 5,
  telemetry_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_cascade_policies_on_match_chk CHECK (on_match IN ('stop','continue','next_pass')),
  CONSTRAINT recon_cascade_policies_on_no_match_chk CHECK (on_no_match IN ('stop','next_pass','escalate'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_cascade_policies TO authenticated;
GRANT ALL ON public.recon_cascade_policies TO service_role;
ALTER TABLE public.recon_cascade_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cascade_policies_tenant_read" ON public.recon_cascade_policies
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = recon_cascade_policies.tenant_id
                   AND tm.user_id = auth.uid()));

CREATE POLICY "cascade_policies_admin_write" ON public.recon_cascade_policies
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = recon_cascade_policies.tenant_id
                   AND tm.user_id = auth.uid()
                   AND tm.role = 'tenant_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm
                      WHERE tm.tenant_id = recon_cascade_policies.tenant_id
                        AND tm.user_id = auth.uid()
                        AND tm.role = 'tenant_admin'));

CREATE TABLE public.recon_cascade_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  policy_id uuid REFERENCES public.recon_cascade_policies(id) ON DELETE SET NULL,
  recon_run_id uuid,
  recon_definition_id uuid NOT NULL,
  initiated_by uuid,
  status text NOT NULL DEFAULT 'running',
  passes_evaluated integer NOT NULL DEFAULT 0,
  matches_projected integer NOT NULL DEFAULT 0,
  exceptions_projected integer NOT NULL DEFAULT 0,
  carry_forward_projected integer NOT NULL DEFAULT 0,
  per_pass_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT recon_cascade_simulations_status_chk CHECK (status IN ('running','succeeded','failed','cancelled'))
);

GRANT SELECT, INSERT, UPDATE ON public.recon_cascade_simulations TO authenticated;
GRANT ALL ON public.recon_cascade_simulations TO service_role;
ALTER TABLE public.recon_cascade_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cascade_sims_tenant_read" ON public.recon_cascade_simulations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = recon_cascade_simulations.tenant_id
                   AND tm.user_id = auth.uid()));

CREATE POLICY "cascade_sims_member_insert" ON public.recon_cascade_simulations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm
                      WHERE tm.tenant_id = recon_cascade_simulations.tenant_id
                        AND tm.user_id = auth.uid()));

CREATE TABLE public.recon_cascade_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_run_id uuid NOT NULL,
  cascade_pass_id uuid REFERENCES public.recon_cascade_passes(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.recon_cascade_policies(id) ON DELETE SET NULL,
  pass_ordinal integer NOT NULL,
  pass_name text,
  candidates_in integer NOT NULL DEFAULT 0,
  matches_out integer NOT NULL DEFAULT 0,
  carry_forward_out integer NOT NULL DEFAULT 0,
  duration_ms integer,
  match_rate numeric GENERATED ALWAYS AS (
    CASE WHEN candidates_in > 0 THEN matches_out::numeric / candidates_in ELSE 0 END
  ) STORED,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.recon_cascade_telemetry TO authenticated;
GRANT ALL ON public.recon_cascade_telemetry TO service_role;
ALTER TABLE public.recon_cascade_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cascade_telemetry_tenant_read" ON public.recon_cascade_telemetry
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = recon_cascade_telemetry.tenant_id
                   AND tm.user_id = auth.uid()));

CREATE INDEX idx_cascade_telemetry_run ON public.recon_cascade_telemetry (tenant_id, recon_run_id, pass_ordinal);
CREATE INDEX idx_cascade_policies_def ON public.recon_cascade_policies (tenant_id, recon_definition_id) WHERE is_active;

CREATE TRIGGER trg_cascade_policies_updated
  BEFORE UPDATE ON public.recon_cascade_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.simulate_cascade_policy(
  _tenant_id uuid,
  _policy_id uuid,
  _recon_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_policy public.recon_cascade_policies%ROWTYPE;
  v_breakdown jsonb := '[]'::jsonb;
  v_candidates int;
  v_matches int;
  v_carry int;
  v_ordinal int := 0;
BEGIN
  SELECT * INTO v_policy FROM public.recon_cascade_policies
    WHERE id = _policy_id AND tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cascade policy % not found for tenant %', _policy_id, _tenant_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = _tenant_id AND tm.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: not a tenant member';
  END IF;

  SELECT COUNT(*) INTO v_candidates
    FROM public.recon_match_allocations a
    WHERE a.tenant_id = _tenant_id
      AND a.recon_run_id = _recon_run_id;

  FOR v_ordinal IN 1 .. LEAST(v_policy.max_passes, GREATEST(jsonb_array_length(v_policy.pass_order), 1)) LOOP
    v_matches := GREATEST(0, (v_candidates * 30) / 100);
    v_carry := v_candidates - v_matches;

    v_breakdown := v_breakdown || jsonb_build_object(
      'ordinal', v_ordinal,
      'pass_key', v_policy.pass_order -> (v_ordinal - 1),
      'candidates_in', v_candidates,
      'matches_out', v_matches,
      'carry_forward_out', CASE WHEN v_policy.carry_forward_unmatched THEN v_carry ELSE 0 END
    );

    IF v_policy.carry_forward_unmatched THEN
      v_candidates := v_carry;
    ELSE
      v_candidates := 0;
    END IF;

    EXIT WHEN v_candidates = 0;
  END LOOP;

  RETURN v_breakdown;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.simulate_cascade_policy(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulate_cascade_policy(uuid, uuid, uuid) TO authenticated;
