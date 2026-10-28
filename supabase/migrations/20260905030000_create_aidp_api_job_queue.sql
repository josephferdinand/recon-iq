-- Durable, tenant-scoped queue for expensive AIDP provider work.

CREATE TABLE public.aidp_api_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.aidp_documents(id) ON DELETE CASCADE,
  idempotency_key text,
  callback_url text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  prediction_id uuid REFERENCES public.aidp_predictions(id) ON DELETE SET NULL,
  response jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX aidp_api_jobs_idempotency_idx
  ON public.aidp_api_jobs(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX aidp_api_jobs_claim_idx
  ON public.aidp_api_jobs(status, available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX aidp_api_jobs_tenant_idx
  ON public.aidp_api_jobs(tenant_id, created_at DESC);

GRANT SELECT ON public.aidp_api_jobs TO authenticated;
GRANT ALL ON public.aidp_api_jobs TO service_role;
ALTER TABLE public.aidp_api_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY aidp_api_jobs_read ON public.aidp_api_jobs FOR SELECT TO authenticated
  USING (private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()));

CREATE TRIGGER trg_aidp_api_jobs_updated
  BEFORE UPDATE ON public.aidp_api_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_aidp_api_job(_job_id uuid DEFAULT NULL)
RETURNS TABLE(claimed boolean, job jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_row public.aidp_api_jobs%ROWTYPE;
BEGIN
  SELECT q.* INTO claimed_row
  FROM public.aidp_api_jobs q
  WHERE q.status = 'queued'
    AND q.available_at <= now()
    AND q.attempts < q.max_attempts
    AND (_job_id IS NULL OR q.id = _job_id)
  ORDER BY q.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_row.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::jsonb;
    RETURN;
  END IF;

  UPDATE public.aidp_api_jobs q
  SET status = 'running',
      attempts = q.attempts + 1,
      locked_at = now(),
      last_error = NULL
  WHERE q.id = claimed_row.id
  RETURNING q.* INTO claimed_row;

  RETURN QUERY SELECT true, to_jsonb(claimed_row);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_aidp_api_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_aidp_api_job(uuid) TO service_role;
