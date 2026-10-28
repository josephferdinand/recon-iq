-- AIDP Slice 1 hardening (Claude review): per-entity thresholds, prediction audit,
-- append-only outputs, dual-DPI rasterization, per-tenant API quotas, PNG lifecycle.

-- ---------- (2) Per-entity confidence semantics ----------
DO $$ BEGIN
  CREATE TYPE public.aidp_review_policy AS ENUM ('auto_accept','review_below','always_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.aidp_entity_types
  ADD COLUMN IF NOT EXISTS review_policy public.aidp_review_policy NOT NULL DEFAULT 'review_below';
COMMENT ON COLUMN public.aidp_entity_types.confidence_threshold IS
  'Per-entity threshold. With review_policy=review_below: confidence >= threshold auto-accepts; below routes to human review. auto_accept ignores threshold (trust model). always_review forces human review regardless of score.';

-- ---------- (3) Prediction decision audit ----------
DO $$ BEGIN
  CREATE TYPE public.aidp_prediction_decision AS ENUM
    ('pending','auto_accepted','human_accepted','human_rejected','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.aidp_predictions
  ADD COLUMN IF NOT EXISTS decision public.aidp_prediction_decision NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS aidp_predictions_decision_pending_idx
  ON public.aidp_predictions(tenant_id, decision) WHERE decision = 'pending';

-- ---------- (6) Dual-DPI rasterization marker ----------
DO $$ BEGIN
  CREATE TYPE public.aidp_page_purpose AS ENUM ('review','inference');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.aidp_pages
  ADD COLUMN IF NOT EXISTS purpose public.aidp_page_purpose NOT NULL DEFAULT 'review',
  ADD COLUMN IF NOT EXISTS dpi int NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz NOT NULL DEFAULT now();

-- ---------- (5) Append-only AIDP outputs (source-of-truth for downstream Rekon) ----------
CREATE TABLE IF NOT EXISTS public.aidp_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.aidp_documents(id) ON DELETE CASCADE,
  entity_type_id uuid NOT NULL REFERENCES public.aidp_entity_types(id) ON DELETE RESTRICT,
  prediction_field_id uuid REFERENCES public.aidp_prediction_fields(id) ON DELETE SET NULL,
  value_text text,
  value_number numeric,
  value_date date,
  value_json jsonb,
  confidence numeric(5,4),
  source_annotation_id uuid REFERENCES public.aidp_annotations(id) ON DELETE SET NULL,
  supersedes_id uuid REFERENCES public.aidp_outputs(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES public.profiles(id),
  origin text NOT NULL CHECK (origin IN ('model','human','correction')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.aidp_outputs TO authenticated;
GRANT ALL ON public.aidp_outputs TO service_role;
ALTER TABLE public.aidp_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_select_aidp_outputs"
  ON public.aidp_outputs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "tenant_members_insert_aidp_outputs"
  ON public.aidp_outputs FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

-- Append-only enforcement
CREATE OR REPLACE FUNCTION public.tg_aidp_outputs_block_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Allow superseded_at to be set once (going from NULL to non-NULL); block everything else.
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'aidp_outputs is append-only'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'aidp_outputs row already superseded'; END IF;
    IF NEW.id <> OLD.id OR NEW.value_text IS DISTINCT FROM OLD.value_text
       OR NEW.value_number IS DISTINCT FROM OLD.value_number
       OR NEW.value_date IS DISTINCT FROM OLD.value_date
       OR NEW.value_json IS DISTINCT FROM OLD.value_json
       OR NEW.confidence IS DISTINCT FROM OLD.confidence
       OR NEW.origin IS DISTINCT FROM OLD.origin THEN
      RAISE EXCEPTION 'aidp_outputs is append-only; only superseded_at may be set';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS aidp_outputs_block_mutation ON public.aidp_outputs;
CREATE TRIGGER aidp_outputs_block_mutation
  BEFORE UPDATE OR DELETE ON public.aidp_outputs
  FOR EACH ROW EXECUTE FUNCTION public.tg_aidp_outputs_block_mutation();

CREATE INDEX IF NOT EXISTS aidp_outputs_tenant_doc_idx
  ON public.aidp_outputs(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS aidp_outputs_supersedes_idx
  ON public.aidp_outputs(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS aidp_outputs_live_idx
  ON public.aidp_outputs(tenant_id, document_id, entity_type_id) WHERE superseded_at IS NULL;

-- View of currently-live (non-superseded) outputs for Rekon consumption
CREATE OR REPLACE VIEW public.aidp_outputs_live AS
  SELECT * FROM public.aidp_outputs WHERE superseded_at IS NULL;
GRANT SELECT ON public.aidp_outputs_live TO authenticated, service_role;

-- ---------- (5 cont'd) Lazy re-run queue for downstream recons ----------
CREATE TABLE IF NOT EXISTS public.aidp_output_recon_invalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  output_id uuid NOT NULL REFERENCES public.aidp_outputs(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'output_superseded',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','enqueued','processed','skipped')),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.aidp_output_recon_invalidations TO authenticated;
GRANT ALL ON public.aidp_output_recon_invalidations TO service_role;
ALTER TABLE public.aidp_output_recon_invalidations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_members_rw_aidp_invalidations"
  ON public.aidp_output_recon_invalidations FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

-- ---------- (7) Per-tenant daily quota for public extract API ----------
CREATE TABLE IF NOT EXISTS public.aidp_api_quotas (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  calls int NOT NULL DEFAULT 0,
  max_calls int NOT NULL DEFAULT 1000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);
GRANT SELECT, INSERT, UPDATE ON public.aidp_api_quotas TO authenticated;
GRANT ALL ON public.aidp_api_quotas TO service_role;
ALTER TABLE public.aidp_api_quotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_admin_select_aidp_quota"
  ON public.aidp_api_quotas FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
      OR public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.aidp_api_quota_hit(_tenant uuid)
RETURNS TABLE(allowed boolean, calls int, max_calls int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_calls int; v_max int;
BEGIN
  INSERT INTO public.aidp_api_quotas(tenant_id, day, calls)
    VALUES (_tenant, current_date, 1)
  ON CONFLICT (tenant_id, day)
    DO UPDATE SET calls = public.aidp_api_quotas.calls + 1, updated_at = now()
  RETURNING calls, max_calls INTO v_calls, v_max;
  RETURN QUERY SELECT (v_calls <= v_max), v_calls, v_max;
END $$;

-- ---------- (4) Storage lifecycle: purge AIDP PNGs older than 90 days ----------
CREATE OR REPLACE FUNCTION public.aidp_purge_stale_pages(_max_age_days int DEFAULT 90)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
DECLARE v_deleted int;
BEGIN
  WITH stale AS (
    SELECT p.id, p.storage_path
    FROM public.aidp_pages p
    WHERE p.rendered_at < now() - make_interval(days => _max_age_days)
  ),
  del_obj AS (
    DELETE FROM storage.objects o
     USING stale s
     WHERE o.bucket_id = 'aidp' AND o.name = s.storage_path
     RETURNING 1
  ),
  del_rows AS (
    DELETE FROM public.aidp_pages WHERE id IN (SELECT id FROM stale) RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del_rows;
  RETURN v_deleted;
END $$;
REVOKE EXECUTE ON FUNCTION public.aidp_purge_stale_pages(int) FROM PUBLIC, anon, authenticated;