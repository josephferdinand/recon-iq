-- Outbound-poll connector agent queue for SFTP, FTPS, local-folder and network-drive sources.
-- Agents never receive Supabase credentials and cannot claim another tenant or agent identity.

ALTER TABLE public.workflow_api_jobs
  DROP CONSTRAINT workflow_api_jobs_job_kind_check;
ALTER TABLE public.workflow_api_jobs
  ADD CONSTRAINT workflow_api_jobs_job_kind_check
  CHECK (job_kind IN ('data_prep_run', 'recon_run', 'connector_run', 'connector_agent_run'));

ALTER TABLE public.workflow_api_jobs
  ADD COLUMN IF NOT EXISTS lease_token_id uuid REFERENCES public.api_tokens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lease_agent_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS workflow_api_jobs_agent_claim_idx
  ON public.workflow_api_jobs(tenant_id, status, available_at, created_at)
  WHERE job_kind = 'connector_agent_run';

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
  stored_kind text := _job_kind;
  schedule_type text;
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
  IF _job_kind = 'connector_run' THEN
    SELECT connector_type INTO schedule_type
    FROM public.data_source_schedules
    WHERE id = _resource_id
      AND tenant_id = _tenant_id
      AND connector_type IN (
        'http', 'https', 'rest', 's3', 'azure_blob', 'gcs', 'bigquery', 'snowflake',
        'databricks', 'sftp', 'ftp', 'local', 'network_drive'
      );
    IF schedule_type IS NULL THEN
      RAISE EXCEPTION 'Executable connector schedule not found';
    END IF;
    IF schedule_type IN ('sftp', 'ftp', 'local', 'network_drive') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.data_source_schedules
        WHERE id = _resource_id
          AND tenant_id = _tenant_id
          AND config->>'agent_id' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
      ) THEN
        RAISE EXCEPTION 'Approved connector agent identifier is required';
      END IF;
      stored_kind := 'connector_agent_run';
    END IF;
  END IF;

  INSERT INTO public.workflow_api_jobs(
    tenant_id, token_id, actor_user_id, job_kind, resource_id, idempotency_key
  ) VALUES (
    _tenant_id, _token_id, _actor_user_id, stored_kind, _resource_id, _idempotency_key
  )
  ON CONFLICT (tenant_id, job_kind, resource_id, idempotency_key) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT id, status INTO inserted_id, existing_status
    FROM public.workflow_api_jobs
    WHERE tenant_id = _tenant_id
      AND job_kind = stored_kind
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
    jsonb_build_object('job_kind', stored_kind, 'resource_id', _resource_id, 'token_id', _token_id)
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
    AND job.job_kind <> 'connector_agent_run'
    AND job.available_at <= now()
    AND job.attempts < job.max_attempts
    AND (_job_id IS NULL OR job.id = _job_id)
  ORDER BY job.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed.id IS NULL THEN RETURN; END IF;

  UPDATE public.workflow_api_jobs AS expired
  SET status = 'running', attempts = attempts + 1, claimed_at = now(), error_code = NULL
  WHERE id = claimed.id
  RETURNING * INTO claimed;

  RETURN NEXT claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_connector_agent_job(
  _tenant_id uuid,
  _token_id uuid,
  _agent_id text,
  _lease_seconds integer DEFAULT 120
)
RETURNS TABLE(
  job_id uuid,
  schedule_id uuid,
  connector_type text,
  config jsonb,
  attempt integer,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.workflow_api_jobs%ROWTYPE;
  schedule public.data_source_schedules%ROWTYPE;
BEGIN
  IF _agent_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' THEN
    RAISE EXCEPTION 'Invalid agent identifier';
  END IF;
  IF _lease_seconds < 30 OR _lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid lease duration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.api_tokens token
    WHERE token.id = _token_id
      AND token.tenant_id = _tenant_id
      AND token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at > now())
      AND ('connectors.agent' = ANY(token.scopes) OR '*' = ANY(token.scopes))
  ) THEN
    RAISE EXCEPTION 'Connector agent token is not authorized';
  END IF;

  WITH expired AS (
    UPDATE public.workflow_api_jobs AS job
    SET status = CASE WHEN job.attempts < job.max_attempts THEN 'failed' ELSE 'dead' END,
        available_at = now(),
        completed_at = CASE WHEN job.attempts < job.max_attempts THEN NULL ELSE now() END,
        lease_token_id = NULL,
        lease_agent_id = NULL,
        lease_expires_at = NULL,
        error_code = 'connector_agent_lease_expired'
    WHERE job.tenant_id = _tenant_id
      AND job.job_kind = 'connector_agent_run'
      AND job.status = 'running'
      AND job.lease_expires_at < now()
    RETURNING job.id, job.actor_user_id, job.tenant_id, job.resource_id,
      job.attempts, job.attempts < job.max_attempts AS retryable
  )
  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  )
  SELECT actor_user_id, tenant_id, 'workspace',
    CASE WHEN retryable THEN 'connector.agent.lease_expired' ELSE 'connector.agent.dead' END,
    'workflow_api_job', id::text,
    jsonb_build_object('schedule_id', resource_id, 'attempt', attempts,
      'error_code', 'connector_agent_lease_expired')
  FROM expired;

  SELECT job.* INTO claimed
  FROM public.workflow_api_jobs job
  JOIN public.data_source_schedules candidate ON candidate.id = job.resource_id
  WHERE job.tenant_id = _tenant_id
    AND job.job_kind = 'connector_agent_run'
    AND job.status IN ('queued', 'failed')
    AND job.available_at <= now()
    AND job.attempts < job.max_attempts
    AND candidate.tenant_id = _tenant_id
    AND candidate.connector_type IN ('sftp', 'ftp', 'local', 'network_drive')
    AND candidate.config->>'agent_id' = _agent_id
  ORDER BY job.created_at
  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;

  IF claimed.id IS NULL THEN RETURN; END IF;

  UPDATE public.workflow_api_jobs
  SET status = 'running',
      attempts = attempts + 1,
      claimed_at = now(),
      lease_token_id = _token_id,
      lease_agent_id = _agent_id,
      lease_expires_at = now() + make_interval(secs => _lease_seconds),
      error_code = NULL
  WHERE id = claimed.id
  RETURNING * INTO claimed;

  SELECT * INTO schedule
  FROM public.data_source_schedules
  WHERE id = claimed.resource_id AND tenant_id = _tenant_id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    claimed.actor_user_id, _tenant_id, 'workspace', 'connector.agent.lease',
    'workflow_api_job', claimed.id::text,
    jsonb_build_object('agent_id', _agent_id, 'connector_type', schedule.connector_type,
      'schedule_id', schedule.id, 'attempt', claimed.attempts, 'lease_token_id', _token_id)
  );

  RETURN QUERY SELECT
    claimed.id,
    schedule.id,
    schedule.connector_type,
    CASE schedule.connector_type
      WHEN 'sftp' THEN jsonb_build_object(
        'host', schedule.config->'host', 'port', schedule.config->'port',
        'remote_path', COALESCE(schedule.config->'remote_path', schedule.config->'path'),
        'file_pattern', schedule.config->'file_pattern',
        'credential_ref', COALESCE(schedule.config->'credential_ref', schedule.config->'secret_key'),
        'host_key_sha256', schedule.config->'host_key_sha256', 'format', schedule.config->'format',
        'max_files', schedule.config->'max_files', 'max_bytes', schedule.config->'max_bytes')
      WHEN 'ftp' THEN jsonb_build_object(
        'host', schedule.config->'host', 'port', schedule.config->'port',
        'remote_path', COALESCE(schedule.config->'remote_path', schedule.config->'path'),
        'file_pattern', schedule.config->'file_pattern',
        'credential_ref', COALESCE(schedule.config->'credential_ref', schedule.config->'secret_key'),
        'secure', schedule.config->'secure', 'format', schedule.config->'format',
        'max_files', schedule.config->'max_files', 'max_bytes', schedule.config->'max_bytes')
      WHEN 'local' THEN jsonb_build_object(
        'root_alias', schedule.config->'root_alias',
        'relative_path', COALESCE(schedule.config->'relative_path', schedule.config->'path'),
        'file_pattern', schedule.config->'file_pattern', 'format', schedule.config->'format',
        'max_files', schedule.config->'max_files', 'max_bytes', schedule.config->'max_bytes')
      ELSE jsonb_build_object(
        'root_alias', schedule.config->'root_alias',
        'relative_path', COALESCE(schedule.config->'relative_path', schedule.config->'unc_path'),
        'file_pattern', schedule.config->'file_pattern',
        'credential_ref', COALESCE(schedule.config->'credential_ref', schedule.config->'secret_key'),
        'format', schedule.config->'format', 'max_files', schedule.config->'max_files',
        'max_bytes', schedule.config->'max_bytes')
    END,
    claimed.attempts,
    claimed.lease_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_connector_agent_job(
  _tenant_id uuid,
  _token_id uuid,
  _agent_id text,
  _job_id uuid,
  _rows jsonb,
  _columns jsonb,
  _filename text,
  _content_sha256 text,
  _size_bytes bigint
)
RETURNS TABLE(job_status text, upload_id uuid, row_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.workflow_api_jobs%ROWTYPE;
  schedule public.data_source_schedules%ROWTYPE;
  created_upload uuid;
  rows_count integer;
  run_id bigint;
BEGIN
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_typeof(_columns) <> 'array' THEN
    RAISE EXCEPTION 'Invalid connector rows';
  END IF;
  rows_count := jsonb_array_length(_rows);
  IF rows_count > 50000 OR jsonb_array_length(_columns) > 500 OR _size_bytes < 0
     OR _size_bytes > 10485760 OR length(_filename) < 1 OR length(_filename) > 255
     OR _content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Connector result exceeds limits';
  END IF;

  SELECT * INTO job FROM public.workflow_api_jobs
  WHERE id = _job_id AND tenant_id = _tenant_id AND job_kind = 'connector_agent_run'
  FOR UPDATE;
  IF job.id IS NULL OR job.status <> 'running' OR job.lease_token_id <> _token_id
     OR job.lease_agent_id <> _agent_id OR job.lease_expires_at < now() THEN
    RAISE EXCEPTION 'Connector agent lease is not valid';
  END IF;

  SELECT * INTO schedule FROM public.data_source_schedules
  WHERE id = job.resource_id AND tenant_id = _tenant_id
    AND connector_type IN ('sftp', 'ftp', 'local', 'network_drive');
  IF schedule.id IS NULL THEN RAISE EXCEPTION 'Connector schedule not found'; END IF;

  INSERT INTO public.workspace_data_source_uploads(
    data_source_id, tenant_id, filename, mime_type, size_bytes, row_count,
    columns, sample_rows, rows, content_sha256, uploaded_by
  ) VALUES (
    schedule.data_source_id, _tenant_id, _filename, 'application/json', _size_bytes, rows_count,
    _columns, (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      FROM (SELECT value FROM jsonb_array_elements(_rows) LIMIT 10) sample),
    _rows, _content_sha256, job.actor_user_id
  ) RETURNING id INTO created_upload;

  INSERT INTO public.data_source_runs(
    schedule_id, tenant_id, finished_at, status, rows_ingested, trigger
  ) VALUES (
    schedule.id, _tenant_id, now(), 'success', rows_count, 'agent'
  ) RETURNING id INTO run_id;

  UPDATE public.workspace_data_sources SET
    inferred_schema = _columns,
    sample_rows = (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      FROM (SELECT value FROM jsonb_array_elements(_rows) LIMIT 10) sample),
    row_count = rows_count,
    status = 'ready',
    last_error = NULL
  WHERE id = schedule.data_source_id AND tenant_id = _tenant_id;

  UPDATE public.data_source_schedules SET
    last_run_at = now(), last_status = 'success', last_rows_ingested = rows_count, last_error = NULL
  WHERE id = schedule.id;

  UPDATE public.workflow_api_jobs SET
    status = 'succeeded', completed_at = now(), error_code = NULL,
    result = jsonb_build_object('workflow_status', 'success', 'schedule_id', schedule.id,
      'rows', rows_count, 'upload_id', created_upload, 'run_id', run_id,
      'agent_id', _agent_id, 'connector_type', schedule.connector_type),
    lease_expires_at = NULL
  WHERE id = job.id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    job.actor_user_id, _tenant_id, 'workspace', 'connector.agent.complete',
    'workflow_api_job', job.id::text,
    jsonb_build_object('agent_id', _agent_id, 'connector_type', schedule.connector_type,
      'schedule_id', schedule.id, 'rows', rows_count, 'upload_id', created_upload,
      'run_id', run_id, 'lease_token_id', _token_id)
  );

  RETURN QUERY SELECT 'succeeded'::text, created_upload, rows_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_connector_agent_job(
  _tenant_id uuid,
  _token_id uuid,
  _agent_id text,
  _job_id uuid,
  _error_code text
)
RETURNS TABLE(job_status text, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.workflow_api_jobs%ROWTYPE;
  schedule public.data_source_schedules%ROWTYPE;
  retryable boolean;
  delay_seconds integer;
BEGIN
  IF _error_code !~ '^connector_agent_[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'Invalid connector agent error code';
  END IF;
  SELECT * INTO job FROM public.workflow_api_jobs
  WHERE id = _job_id AND tenant_id = _tenant_id AND job_kind = 'connector_agent_run'
  FOR UPDATE;
  IF job.id IS NULL OR job.status <> 'running' OR job.lease_token_id <> _token_id
     OR job.lease_agent_id <> _agent_id OR job.lease_expires_at < now() THEN
    RAISE EXCEPTION 'Connector agent lease is not valid';
  END IF;
  SELECT * INTO schedule FROM public.data_source_schedules
  WHERE id = job.resource_id AND tenant_id = _tenant_id;
  retryable := job.attempts < job.max_attempts;
  delay_seconds := LEAST(900, 30 * (2 ^ GREATEST(0, job.attempts - 1))::integer);

  UPDATE public.workflow_api_jobs SET
    status = CASE WHEN retryable THEN 'failed' ELSE 'dead' END,
    available_at = CASE WHEN retryable THEN now() + make_interval(secs => delay_seconds) ELSE now() END,
    completed_at = CASE WHEN retryable THEN NULL ELSE now() END,
    error_code = _error_code, lease_expires_at = NULL
  WHERE id = job.id;

  INSERT INTO public.data_source_runs(
    schedule_id, tenant_id, finished_at, status, error, trigger
  ) VALUES (schedule.id, _tenant_id, now(), 'failed', _error_code, 'agent');
  UPDATE public.data_source_schedules SET
    last_run_at = now(), last_status = 'failed', last_error = _error_code
  WHERE id = schedule.id;
  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    job.actor_user_id, _tenant_id, 'workspace',
    CASE WHEN retryable THEN 'connector.agent.retry_scheduled' ELSE 'connector.agent.dead' END,
    'workflow_api_job', job.id::text,
    jsonb_build_object('agent_id', _agent_id, 'connector_type', schedule.connector_type,
      'schedule_id', schedule.id, 'attempt', job.attempts, 'error_code', _error_code,
      'retry_after_seconds', CASE WHEN retryable THEN delay_seconds ELSE 0 END,
      'lease_token_id', _token_id)
  );
  RETURN QUERY SELECT CASE WHEN retryable THEN 'failed' ELSE 'dead' END,
    CASE WHEN retryable THEN delay_seconds ELSE 0 END;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_workflow_api_job(uuid, uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow_api_job(uuid, uuid, uuid, text, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_workflow_api_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_api_job(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_connector_agent_job(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_connector_agent_job(uuid, uuid, text, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_connector_agent_job(uuid, uuid, text, uuid, jsonb, jsonb, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_connector_agent_job(uuid, uuid, text, uuid, jsonb, jsonb, text, text, bigint)
  TO service_role;
REVOKE ALL ON FUNCTION public.fail_connector_agent_job(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_connector_agent_job(uuid, uuid, text, uuid, text)
  TO service_role;
