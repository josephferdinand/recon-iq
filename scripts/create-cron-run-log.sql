CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id BIGSERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'ok',
  detail JSONB DEFAULT '{}'::jsonb,
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_cron_run_log_job_ran ON public.cron_run_log(job, ran_at DESC);

GRANT INSERT, SELECT ON public.cron_run_log TO service_role;

ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_run_log admin read" ON public.cron_run_log;
CREATE POLICY "cron_run_log admin read"
  ON public.cron_run_log FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
