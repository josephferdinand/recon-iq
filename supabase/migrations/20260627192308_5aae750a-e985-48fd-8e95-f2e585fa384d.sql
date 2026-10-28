
ALTER TABLE public.recon_exceptions
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_state IN ('unreviewed','under_review','reviewed')),
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopen_reason text,
  ADD COLUMN IF NOT EXISTS write_off_amount numeric(20,4),
  ADD COLUMN IF NOT EXISTS write_off_currency text,
  ADD COLUMN IF NOT EXISTS write_off_gl_account text,
  ADD COLUMN IF NOT EXISTS write_off_reason text,
  ADD COLUMN IF NOT EXISTS write_off_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS write_off_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS predicted_label text,
  ADD COLUMN IF NOT EXISTS predicted_label_confidence numeric(5,4);

CREATE INDEX IF NOT EXISTS recon_exc_review_idx ON public.recon_exceptions(tenant_id, review_state);
CREATE INDEX IF NOT EXISTS recon_exc_labels_idx ON public.recon_exceptions USING gin(labels);

CREATE TABLE IF NOT EXISTS public.recon_exception_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_state text,
  to_state text NOT NULL,
  transition_type text NOT NULL,
  reason text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.recon_exception_transitions TO authenticated;
GRANT ALL ON public.recon_exception_transitions TO service_role;
ALTER TABLE public.recon_exception_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rxt_select_member ON public.recon_exception_transitions FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()));
CREATE POLICY rxt_insert_member ON public.recon_exception_transitions FOR INSERT TO authenticated
  WITH CHECK (private.is_tenant_member(auth.uid(), tenant_id) AND actor_user_id = auth.uid());
CREATE INDEX IF NOT EXISTS rxt_exception_idx ON public.recon_exception_transitions(exception_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.recon_nrl_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  nrl_source text NOT NULL,
  compiled_rule jsonb NOT NULL,
  pass_order int NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_nrl_rules TO authenticated;
GRANT ALL ON public.recon_nrl_rules TO service_role;
ALTER TABLE public.recon_nrl_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY nrl_select_member ON public.recon_nrl_rules FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()));
CREATE POLICY nrl_write_analyst ON public.recon_nrl_rules FOR ALL TO authenticated
  USING (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR private.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR private.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE INDEX IF NOT EXISTS nrl_def_idx ON public.recon_nrl_rules(definition_id, pass_order);
CREATE TRIGGER tg_nrl_updated_at BEFORE UPDATE ON public.recon_nrl_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE VIEW public.v_recon_matches_consolidated AS
SELECT
  m.id            AS match_id,
  m.tenant_id,
  m.run_id,
  m.match_key,
  m.rule_id,
  m.cardinality,
  m.confidence,
  m.score,
  m.created_at,
  (m.members->'A') AS side_a,
  (m.members->'B') AS side_b,
  (m.members->'C') AS side_c,
  jsonb_build_object(
    'amount_delta',
      COALESCE(((m.members->'A'->>'amount')::numeric) - ((m.members->'B'->>'amount')::numeric), 0),
    'has_diff',
      (m.members->'A'->>'amount') IS DISTINCT FROM (m.members->'B'->>'amount')
  ) AS deltas
FROM public.recon_matches m;

GRANT SELECT ON public.v_recon_matches_consolidated TO authenticated;
