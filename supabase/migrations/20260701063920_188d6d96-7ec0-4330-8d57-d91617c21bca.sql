-- 1) Add configurable rate-limit columns
ALTER TABLE public.platform_ai_settings
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_max integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_window_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_max integer NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_window_seconds integer NOT NULL DEFAULT 60;

ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_max integer,
  ADD COLUMN IF NOT EXISTS llm_rl_per_user_window_seconds integer,
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_max integer,
  ADD COLUMN IF NOT EXISTS llm_rl_per_tenant_window_seconds integer;

-- Sensible bounds
ALTER TABLE public.platform_ai_settings
  DROP CONSTRAINT IF EXISTS platform_ai_settings_rl_bounds_chk,
  ADD  CONSTRAINT platform_ai_settings_rl_bounds_chk CHECK (
    llm_rl_per_user_max BETWEEN 1 AND 100000
    AND llm_rl_per_user_window_seconds BETWEEN 1 AND 86400
    AND llm_rl_per_tenant_max BETWEEN 1 AND 1000000
    AND llm_rl_per_tenant_window_seconds BETWEEN 1 AND 86400
  );

ALTER TABLE public.tenant_ai_settings
  DROP CONSTRAINT IF EXISTS tenant_ai_settings_rl_bounds_chk,
  ADD  CONSTRAINT tenant_ai_settings_rl_bounds_chk CHECK (
    (llm_rl_per_user_max IS NULL OR llm_rl_per_user_max BETWEEN 1 AND 100000)
    AND (llm_rl_per_user_window_seconds IS NULL OR llm_rl_per_user_window_seconds BETWEEN 1 AND 86400)
    AND (llm_rl_per_tenant_max IS NULL OR llm_rl_per_tenant_max BETWEEN 1 AND 1000000)
    AND (llm_rl_per_tenant_window_seconds IS NULL OR llm_rl_per_tenant_window_seconds BETWEEN 1 AND 86400)
  );

COMMENT ON COLUMN public.platform_ai_settings.llm_rl_per_user_max IS
  'Max LLM test/dispatch calls per user per window. Platform default; tenants may override.';
COMMENT ON COLUMN public.platform_ai_settings.llm_rl_per_tenant_max IS
  'Max LLM test/dispatch calls per tenant (global shared) per window. Platform default.';
COMMENT ON COLUMN public.tenant_ai_settings.llm_rl_per_user_max IS
  'Tenant override for per-user LLM cap. NULL inherits platform default.';
COMMENT ON COLUMN public.tenant_ai_settings.llm_rl_per_tenant_max IS
  'Tenant override for tenant-global LLM cap. NULL inherits platform default.';

-- 2) Atomic per-user + per-tenant rate-limit check
CREATE OR REPLACE FUNCTION public.try_llm_rate_limit_pair(
  _user_id uuid,
  _tenant_id uuid,
  _scope text,
  _user_max integer,
  _user_window_seconds integer,
  _tenant_max integer,
  _tenant_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts       timestamptz := now();
  user_bucket  timestamptz := date_trunc('second', now_ts) - ((extract(epoch from now_ts)::bigint % _user_window_seconds) * interval '1 second');
  tenant_bucket timestamptz := date_trunc('second', now_ts) - ((extract(epoch from now_ts)::bigint % _tenant_window_seconds) * interval '1 second');
  user_key     text := format('llm.%s.user.%s', _scope, _user_id::text);
  tenant_key   text := format('llm.%s.tenant.%s', _scope, COALESCE(_tenant_id::text, 'platform'));
  user_count   integer;
  tenant_count integer;
BEGIN
  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, count)
  VALUES (user_key, user_bucket, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE
    SET count = public.rate_limit_buckets.count + 1
  RETURNING count INTO user_count;

  IF user_count > _user_max THEN
    RETURN jsonb_build_object(
      'ok', false, 'exceeded', 'user',
      'user_count', user_count, 'user_max', _user_max,
      'user_window_seconds', _user_window_seconds
    );
  END IF;

  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, count)
  VALUES (tenant_key, tenant_bucket, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE
    SET count = public.rate_limit_buckets.count + 1
  RETURNING count INTO tenant_count;

  IF tenant_count > _tenant_max THEN
    RETURN jsonb_build_object(
      'ok', false, 'exceeded', 'tenant',
      'tenant_count', tenant_count, 'tenant_max', _tenant_max,
      'tenant_window_seconds', _tenant_window_seconds
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_count', user_count, 'user_max', _user_max,
    'tenant_count', tenant_count, 'tenant_max', _tenant_max
  );
END $$;

REVOKE ALL ON FUNCTION public.try_llm_rate_limit_pair(uuid, uuid, text, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_llm_rate_limit_pair(uuid, uuid, text, integer, integer, integer, integer) TO authenticated, service_role;
