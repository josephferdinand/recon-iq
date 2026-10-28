
CREATE OR REPLACE FUNCTION public.try_llm_test_rate_limit(_user_id uuid, _scope text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bkey text;
  wstart timestamptz;
  cur integer;
BEGIN
  wstart := date_trunc('minute', now()) - ((extract(epoch FROM now())::int % _window_seconds) * interval '1 second');
  bkey := 'llm.test:' || _scope || ':' || _user_id::text;
  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, count)
  VALUES (bkey, wstart, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = public.rate_limit_buckets.count + 1
  RETURNING count INTO cur;
  RETURN cur <= _max;
END;
$$;

REVOKE ALL ON FUNCTION public.try_llm_test_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_llm_test_rate_limit(uuid, text, integer, integer) TO authenticated, service_role;

-- Ensure unique constraint exists for ON CONFLICT
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_limit_buckets_key_window_uniq') THEN
    ALTER TABLE public.rate_limit_buckets
      ADD CONSTRAINT rate_limit_buckets_key_window_uniq UNIQUE (bucket_key, window_start);
  END IF;
END $$;
