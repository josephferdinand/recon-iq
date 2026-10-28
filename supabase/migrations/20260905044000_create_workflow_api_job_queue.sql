-- Durable public-API queue for Data Prep and reconciliation execution.

CREATE TABLE public.workflow_api_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.api_tokens(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  job_kind text NOT NULL CHECK (job_kind IN ('data_prep_run', 'recon_run')),
  resource_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_kind, resource_id, idempotency_key)
);

CREATE INDEX workflow_api_jobs_claim_idx
  ON public.workflow_api_jobs(status, available_at, created_at);
CREATE INDEX workflow_api_jobs_tenant_idx
  ON public.workflow_api_jobs(tenant_id, created_at DESC);

ALTER TABLE public.workflow_api_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.workflow_api_jobs TO authenticated;
GRANT ALL ON public.workflow_api_jobs TO service_role;

CREATE POLICY workflow_api_jobs_member_read
  ON public.workflow_api_jobs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TRIGGER workflow_api_jobs_updated_at
  BEFORE UPDATE ON public.workflow_api_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.enqueue_workflow_api_job(
  _tenant_id uuid,
  _token_id uuid,
  _actor_user_id uuid,
  _job_kind text,
  _resource_id uuid,
  _idempotency_key text
)
RETURNS TABLE(job_id uuid, job_status text, idempotent_replay boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
  existing_status text;
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'API token must have an accountable creator';
  END IF;
  IF _job_kind NOT IN ('data_prep_run', 'recon_run') THEN
    RAISE EXCEPTION 'Unsupported workflow job kind';
  END IF;
  IF length(_idempotency_key) < 1 OR length(_idempotency_key) > 128 THEN
    RAISE EXCEPTION 'Invalid idempotency key';
  END IF;
  IF _job_kind = 'data_prep_run' AND NOT EXISTS (
    SELECT 1 FROM public.data_prep_pipelines
    WHERE id = _resource_id AND tenant_id = _tenant_id AND enabled
  ) THEN
    RAISE EXCEPTION 'Data Prep pipeline not found';
  END IF;
  IF _job_kind = 'recon_run' AND NOT EXISTS (
    SELECT 1 FROM public.recon_definitions
    WHERE id = _resource_id AND tenant_id = _tenant_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Reconciliation not found';
  END IF;

  INSERT INTO public.workflow_api_jobs(
    tenant_id, token_id, actor_user_id, job_kind, resource_id, idempotency_key
  ) VALUES (
    _tenant_id, _token_id, _actor_user_id, _job_kind, _resource_id, _idempotency_key
  )
  ON CONFLICT (tenant_id, job_kind, resource_id, idempotency_key) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT id, status INTO inserted_id, existing_status
    FROM public.workflow_api_jobs
    WHERE tenant_id = _tenant_id
      AND job_kind = _job_kind
      AND resource_id = _resource_id
      AND idempotency_key = _idempotency_key;
    RETURN QUERY SELECT inserted_id, existing_status, true;
    RETURN;
  END IF;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    _actor_user_id, _tenant_id, 'workspace', 'api.workflow.enqueue',
    'workflow_api_job', inserted_id::text,
    jsonb_build_object('job_kind', _job_kind, 'resource_id', _resource_id, 'token_id', _token_id)
  );

  RETURN QUERY SELECT inserted_id, 'queued'::text, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_workflow_api_job(_job_id uuid DEFAULT NULL)
RETURNS SETOF public.workflow_api_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.workflow_api_jobs%ROWTYPE;
BEGIN
  SELECT job.* INTO claimed
  FROM public.workflow_api_jobs job
  WHERE job.status IN ('queued', 'failed')
    AND job.available_at <= now()
    AND job.attempts < job.max_attempts
    AND (_job_id IS NULL OR job.id = _job_id)
  ORDER BY job.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed.id IS NULL THEN RETURN; END IF;

  UPDATE public.workflow_api_jobs
  SET status = 'running', attempts = attempts + 1, claimed_at = now(), error_code = NULL
  WHERE id = claimed.id
  RETURNING * INTO claimed;

  RETURN NEXT claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_workflow_api_job(uuid, uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow_api_job(uuid, uuid, uuid, text, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_workflow_api_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_api_job(uuid) TO service_role;
