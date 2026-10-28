
-- Pipeline stats: 1-minute buckets per sink
CREATE TABLE public.observability_pipeline_stats (
  bucket_ts     timestamptz NOT NULL,
  sink          text        NOT NULL CHECK (sink IN ('apm','siem')),
  ok_count      bigint      NOT NULL DEFAULT 0,
  drop_count    bigint      NOT NULL DEFAULT 0,
  error_count   bigint      NOT NULL DEFAULT 0,
  latency_sum_ms bigint     NOT NULL DEFAULT 0,
  latency_max_ms integer    NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_ts, sink)
);
GRANT SELECT ON public.observability_pipeline_stats TO authenticated;
GRANT ALL    ON public.observability_pipeline_stats TO service_role;
ALTER TABLE public.observability_pipeline_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins read pipeline stats"
  ON public.observability_pipeline_stats FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role));

-- Alert configuration
CREATE TABLE public.observability_alert_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  sink          text NOT NULL CHECK (sink IN ('apm','siem','any')),
  metric        text NOT NULL CHECK (metric IN ('drop_rate_pct','p95_latency_ms','event_volume_min','error_rate_pct')),
  threshold     numeric NOT NULL,
  window_minutes integer NOT NULL DEFAULT 5 CHECK (window_minutes BETWEEN 1 AND 1440),
  enabled       boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.observability_alert_config TO authenticated;
GRANT ALL ON public.observability_alert_config TO service_role;
ALTER TABLE public.observability_alert_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins manage alert config"
  ON public.observability_alert_config FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role))
  WITH CHECK (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role));

-- Incidents log
CREATE TABLE public.observability_alert_incidents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id   uuid NOT NULL REFERENCES public.observability_alert_config(id) ON DELETE CASCADE,
  fired_at    timestamptz NOT NULL DEFAULT now(),
  observed_value numeric NOT NULL,
  message     text NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX observability_alert_incidents_config_idx ON public.observability_alert_incidents (config_id, fired_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.observability_alert_incidents TO authenticated;
GRANT ALL ON public.observability_alert_incidents TO service_role;
ALTER TABLE public.observability_alert_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins read incidents"
  ON public.observability_alert_incidents FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role));
CREATE POLICY "platform admins update incidents"
  ON public.observability_alert_incidents FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role))
  WITH CHECK (public.has_platform_role(auth.uid(), 'platform_admin'::platform_role));

-- Upsert a sample into the minute bucket. Service role only.
CREATE OR REPLACE FUNCTION public.record_pipeline_sample(
  _sink text, _status text, _latency_ms integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bucket timestamptz := date_trunc('minute', now());
  _lat    integer := GREATEST(COALESCE(_latency_ms, 0), 0);
BEGIN
  IF _sink NOT IN ('apm','siem') THEN
    RAISE EXCEPTION 'invalid sink %', _sink;
  END IF;
  IF _status NOT IN ('ok','drop','error') THEN
    RAISE EXCEPTION 'invalid status %', _status;
  END IF;

  INSERT INTO public.observability_pipeline_stats
    (bucket_ts, sink, ok_count, drop_count, error_count, latency_sum_ms, latency_max_ms)
  VALUES (
    _bucket, _sink,
    CASE WHEN _status = 'ok'    THEN 1 ELSE 0 END,
    CASE WHEN _status = 'drop'  THEN 1 ELSE 0 END,
    CASE WHEN _status = 'error' THEN 1 ELSE 0 END,
    _lat, _lat
  )
  ON CONFLICT (bucket_ts, sink) DO UPDATE SET
    ok_count       = observability_pipeline_stats.ok_count
                     + CASE WHEN _status = 'ok' THEN 1 ELSE 0 END,
    drop_count     = observability_pipeline_stats.drop_count
                     + CASE WHEN _status = 'drop' THEN 1 ELSE 0 END,
    error_count    = observability_pipeline_stats.error_count
                     + CASE WHEN _status = 'error' THEN 1 ELSE 0 END,
    latency_sum_ms = observability_pipeline_stats.latency_sum_ms + _lat,
    latency_max_ms = GREATEST(observability_pipeline_stats.latency_max_ms, _lat);
END;
$$;
REVOKE ALL ON FUNCTION public.record_pipeline_sample(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pipeline_sample(text, text, integer) TO service_role;

-- Aggregate window helper. Returns per-sink totals over the last N minutes.
CREATE OR REPLACE FUNCTION public.pipeline_stats_window(_minutes integer DEFAULT 60)
RETURNS TABLE (
  sink           text,
  bucket_ts      timestamptz,
  ok_count       bigint,
  drop_count     bigint,
  error_count    bigint,
  latency_avg_ms numeric,
  latency_max_ms integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sink, bucket_ts, ok_count, drop_count, error_count,
    CASE WHEN (ok_count + error_count) > 0
         THEN latency_sum_ms::numeric / (ok_count + error_count)
         ELSE 0 END AS latency_avg_ms,
    latency_max_ms
  FROM public.observability_pipeline_stats
  WHERE bucket_ts >= now() - make_interval(mins => GREATEST(_minutes, 1))
  ORDER BY bucket_ts ASC, sink ASC;
$$;
REVOKE ALL ON FUNCTION public.pipeline_stats_window(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pipeline_stats_window(integer) TO authenticated, service_role;
