DROP FUNCTION IF EXISTS public.aidp_api_quota_hit(uuid);

CREATE OR REPLACE FUNCTION public.aidp_api_quota_hit(_tenant_id uuid)
RETURNS TABLE(allowed boolean, calls integer, max_calls integer, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_calls int;
  v_max int;
BEGIN
  INSERT INTO public.aidp_api_quotas (tenant_id, day, calls, max_calls)
  VALUES (_tenant_id, v_today, 1, 1000)
  ON CONFLICT (tenant_id, day) DO UPDATE
    SET calls = aidp_api_quotas.calls + 1,
        updated_at = now()
  RETURNING calls, max_calls INTO v_calls, v_max;

  IF v_calls > v_max THEN
    UPDATE public.aidp_api_quotas SET calls = calls - 1
      WHERE tenant_id = _tenant_id AND day = v_today;
    RETURN QUERY SELECT false, v_calls - 1, v_max,
      EXTRACT(EPOCH FROM (date_trunc('day', now() AT TIME ZONE 'utc') + INTERVAL '1 day' - now()))::int;
  ELSE
    RETURN QUERY SELECT true, v_calls, v_max, 0;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.aidp_api_quota_hit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aidp_api_quota_hit(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aidp_api_quota_hit(uuid) TO service_role;