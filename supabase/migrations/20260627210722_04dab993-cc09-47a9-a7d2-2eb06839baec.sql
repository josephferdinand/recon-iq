
ALTER TABLE public.data_prep_pipelines
  ADD COLUMN IF NOT EXISTS parent_pipeline_id uuid REFERENCES public.data_prep_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS promotion_status text,
  ADD COLUMN IF NOT EXISTS promotion_requested_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS promotion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_note text,
  ADD COLUMN IF NOT EXISTS promoted_from_id uuid REFERENCES public.data_prep_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by uuid REFERENCES auth.users(id);

ALTER TABLE public.data_prep_pipelines
  DROP CONSTRAINT IF EXISTS dpp_lifecycle_state_check;
ALTER TABLE public.data_prep_pipelines
  ADD CONSTRAINT dpp_lifecycle_state_check CHECK (lifecycle_state IN ('production','staging','archived'));

ALTER TABLE public.data_prep_pipelines
  DROP CONSTRAINT IF EXISTS dpp_promotion_status_check;
ALTER TABLE public.data_prep_pipelines
  ADD CONSTRAINT dpp_promotion_status_check CHECK (promotion_status IS NULL OR promotion_status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_dpp_parent ON public.data_prep_pipelines(parent_pipeline_id);
CREATE INDEX IF NOT EXISTS idx_dpp_lifecycle ON public.data_prep_pipelines(tenant_id, lifecycle_state);

CREATE TABLE IF NOT EXISTS public.dp_promotion_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  comment text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staging_pipeline_id, approver_id)
);

GRANT SELECT, INSERT ON public.dp_promotion_approvals TO authenticated;
GRANT ALL ON public.dp_promotion_approvals TO service_role;

ALTER TABLE public.dp_promotion_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dp_promo_read"
  ON public.dp_promotion_approvals FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE POLICY "dp_promo_insert"
  ON public.dp_promotion_approvals FOR INSERT TO authenticated
  WITH CHECK (
    approver_id = auth.uid()
    AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    AND EXISTS (
      SELECT 1 FROM public.data_prep_pipelines p
      WHERE p.id = staging_pipeline_id
        AND p.tenant_id = dp_promotion_approvals.tenant_id
        AND p.lifecycle_state = 'staging'
        AND p.promotion_status = 'pending'
        AND p.promotion_requested_by IS DISTINCT FROM auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_dp_promo_staging ON public.dp_promotion_approvals(staging_pipeline_id);
