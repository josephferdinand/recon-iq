-- Qualify quota columns so PL/pgSQL output variables `calls` and `max_calls`
-- cannot collide with table columns at runtime.

CREATE OR REPLACE FUNCTION public.aidp_api_quota_hit(_tenant_id uuid)
RETURNS TABLE(allowed boolean, calls integer, max_calls integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_calls integer;
  v_max integer;
BEGIN
  INSERT INTO public.aidp_api_quotas AS quota (tenant_id, day, calls, max_calls)
  VALUES (_tenant_id, v_today, 1, 1000)
  ON CONFLICT (tenant_id, day) DO UPDATE
    SET calls = quota.calls + 1,
        updated_at = now()
  RETURNING quota.calls, quota.max_calls INTO v_calls, v_max;

  IF v_calls > v_max THEN
    UPDATE public.aidp_api_quotas AS quota
      SET calls = quota.calls - 1
      WHERE quota.tenant_id = _tenant_id AND quota.day = v_today;
    RETURN QUERY SELECT false, v_calls - 1, v_max,
      EXTRACT(EPOCH FROM (
        date_trunc('day', now() AT TIME ZONE 'utc')
        + INTERVAL '1 day'
        - now()
      ))::integer;
  ELSE
    RETURN QUERY SELECT true, v_calls, v_max, 0;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aidp_api_quota_hit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aidp_api_quota_hit(uuid) TO service_role;
