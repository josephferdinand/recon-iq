-- Reuse the governed workflow queue for directly executable HTTP-family
-- connector schedules. Gateway-required and manual connectors remain denied.

ALTER TABLE public.workflow_api_jobs
  DROP CONSTRAINT workflow_api_jobs_job_kind_check;
ALTER TABLE public.workflow_api_jobs
  ADD CONSTRAINT workflow_api_jobs_job_kind_check
  CHECK (job_kind IN ('data_prep_run', 'recon_run', 'connector_run'));

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
  IF _job_kind NOT IN ('data_prep_run', 'recon_run', 'connector_run') THEN
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
  IF _job_kind = 'connector_run' AND NOT EXISTS (
    SELECT 1 FROM public.data_source_schedules
    WHERE id = _resource_id
      AND tenant_id = _tenant_id
      AND connector_type IN ('http', 'https', 'rest')
  ) THEN
    RAISE EXCEPTION 'Direct connector schedule not found';
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

REVOKE ALL ON FUNCTION public.enqueue_workflow_api_job(uuid, uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow_api_job(uuid, uuid, uuid, text, uuid, text)
  TO service_role;
