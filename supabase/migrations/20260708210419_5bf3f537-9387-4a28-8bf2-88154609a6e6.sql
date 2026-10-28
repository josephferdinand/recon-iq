CREATE TABLE IF NOT EXISTS public.mkt_brand_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('profile','asset','theme')),
  subject_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('publish','rollback','archive')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','pending_publish','rejected','cancelled','executed')),
  title text,
  notes text,
  requested_by uuid NOT NULL,
  requested_by_email text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_by_email text,
  reviewed_at timestamptz,
  review_note text,
  review_decision text CHECK (review_decision IN ('approved','rejected')),
  published_by uuid,
  published_by_email text,
  published_at timestamptz,
  publish_note text,
  publish_decision text CHECK (publish_decision IN ('approved','rejected')),
  executed_at timestamptz,
  execution_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_brand_approvals_status
  ON public.mkt_brand_approvals(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_brand_approvals_subject
  ON public.mkt_brand_approvals(subject_type, subject_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_brand_approvals TO authenticated;
GRANT ALL ON public.mkt_brand_approvals TO service_role;

ALTER TABLE public.mkt_brand_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_approvals_read"
  ON public.mkt_brand_approvals FOR SELECT TO authenticated
  USING (public.has_any_mkt_role(auth.uid()));

CREATE POLICY "brand_approvals_insert"
  ON public.mkt_brand_approvals FOR INSERT TO authenticated
  WITH CHECK (public.has_any_mkt_role(auth.uid()) AND requested_by = auth.uid());

CREATE POLICY "brand_approvals_update"
  ON public.mkt_brand_approvals FOR UPDATE TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'brand_reviewer'::mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'brand_publisher'::mkt_admin_role)
    OR requested_by = auth.uid()
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'brand_reviewer'::mkt_admin_role)
    OR public.has_mkt_role(auth.uid(), 'brand_publisher'::mkt_admin_role)
    OR requested_by = auth.uid()
  );

CREATE TRIGGER mkt_brand_approvals_updated_at
  BEFORE UPDATE ON public.mkt_brand_approvals
  FOR EACH ROW EXECUTE FUNCTION public.mkt_brand_touch_updated_at();

CREATE OR REPLACE FUNCTION public.has_brand_workflow_role(_user_id uuid, _stage text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE _stage
    WHEN 'review'  THEN public.has_mkt_role(_user_id, 'brand_reviewer'::mkt_admin_role)
                     OR public.has_mkt_role(_user_id, 'super_admin'::mkt_admin_role)
    WHEN 'publish' THEN public.has_mkt_role(_user_id, 'brand_publisher'::mkt_admin_role)
                     OR public.has_mkt_role(_user_id, 'super_admin'::mkt_admin_role)
    ELSE false
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_brand_workflow_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_brand_workflow_role(uuid, text) TO authenticated, service_role;