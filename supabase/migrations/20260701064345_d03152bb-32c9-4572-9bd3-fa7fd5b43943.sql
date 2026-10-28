
-- Configurable LLM rate limits
ALTER TABLE public.platform_ai_settings
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_max integer NOT NULL DEFAULT 20 CHECK (llm_rl_per_user_max >= 1),
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_window_seconds integer NOT NULL DEFAULT 60 CHECK (llm_rl_per_user_window_seconds >= 1),
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_max integer NOT NULL DEFAULT 200 CHECK (llm_rl_per_tenant_max >= 1),
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_window_seconds integer NOT NULL DEFAULT 60 CHECK (llm_rl_per_tenant_window_seconds >= 1);

ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_max integer CHECK (llm_rl_per_user_max IS NULL OR llm_rl_per_user_max >= 1),
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_window_seconds integer CHECK (llm_rl_per_user_window_seconds IS NULL OR llm_rl_per_user_window_seconds >= 1),
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_max integer CHECK (llm_rl_per_tenant_max IS NULL OR llm_rl_per_tenant_max >= 1),
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_window_seconds integer CHECK (llm_rl_per_tenant_window_seconds IS NULL OR llm_rl_per_tenant_window_seconds >= 1);

-- Atomic dual-bucket rate limiter. Reuses the existing llm_test_rate_limit table
-- if present; otherwise creates a minimal sliding-window store.
CREATE TABLE IF NOT EXISTS private.llm_test_rate_bucket (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.try_llm_rate_limit_pair(
  _user_id uuid,
  _tenant_id uuid,
  _scope text,
  _user_max integer,
  _user_window_seconds integer,
  _tenant_max integer,
  _tenant_window_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  user_key text;
  tenant_key text;
  user_row private.llm_test_rate_bucket%ROWTYPE;
  tenant_row private.llm_test_rate_bucket%ROWTYPE;
  now_ts timestamptz := now();
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'exceeded', 'user', 'reason', 'missing user');
  END IF;

  user_key := 'u:' || _user_id::text || ':' || coalesce(_scope, 'platform') || ':' || coalesce(_tenant_id::text, '-');
  tenant_key := 't:' || coalesce(_scope, 'platform') || ':' || coalesce(_tenant_id::text, 'platform');

  -- USER BUCKET
  SELECT * INTO user_row FROM private.llm_test_rate_bucket WHERE bucket_key = user_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO private.llm_test_rate_bucket(bucket_key, window_started_at, count)
      VALUES (user_key, now_ts, 0)
      RETURNING * INTO user_row;
  END IF;
  IF now_ts - user_row.window_started_at >= make_interval(secs => _user_window_seconds) THEN
    UPDATE private.llm_test_rate_bucket
      SET window_started_at = now_ts, count = 0
      WHERE bucket_key = user_key
      RETURNING * INTO user_row;
  END IF;
  IF user_row.count >= _user_max THEN
    RETURN jsonb_build_object(
      'ok', false, 'exceeded', 'user',
      'user_max', _user_max, 'user_window_seconds', _user_window_seconds,
      'tenant_max', _tenant_max, 'tenant_window_seconds', _tenant_window_seconds
    );
  END IF;

  -- TENANT/GLOBAL BUCKET
  SELECT * INTO tenant_row FROM private.llm_test_rate_bucket WHERE bucket_key = tenant_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO private.llm_test_rate_bucket(bucket_key, window_started_at, count)
      VALUES (tenant_key, now_ts, 0)
      RETURNING * INTO tenant_row;
  END IF;
  IF now_ts - tenant_row.window_started_at >= make_interval(secs => _tenant_window_seconds) THEN
    UPDATE private.llm_test_rate_bucket
      SET window_started_at = now_ts, count = 0
      WHERE bucket_key = tenant_key
      RETURNING * INTO tenant_row;
  END IF;
  IF tenant_row.count >= _tenant_max THEN
    RETURN jsonb_build_object(
      'ok', false, 'exceeded', 'tenant',
      'user_max', _user_max, 'user_window_seconds', _user_window_seconds,
      'tenant_max', _tenant_max, 'tenant_window_seconds', _tenant_window_seconds
    );
  END IF;

  -- Both buckets have room — increment atomically.
  UPDATE private.llm_test_rate_bucket SET count = count + 1 WHERE bucket_key = user_key;
  UPDATE private.llm_test_rate_bucket SET count = count + 1 WHERE bucket_key = tenant_key;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.try_llm_rate_limit_pair(uuid, uuid, text, integer, integer, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.try_llm_rate_limit_pair(uuid, uuid, text, integer, integer, integer, integer) TO authenticated, service_role;
