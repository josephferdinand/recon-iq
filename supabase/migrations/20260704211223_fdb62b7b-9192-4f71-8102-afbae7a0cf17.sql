CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.mkt_site_themes_promote_scheduled()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.mkt_site_themes
  SET status = 'active'
  WHERE status = 'scheduled'
    AND scheduled_at IS NOT NULL
    AND scheduled_at <= now();
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt_site_themes_promote_scheduled') THEN
    PERFORM cron.schedule(
      'mkt_site_themes_promote_scheduled',
      '* * * * *',
      $cron$SELECT public.mkt_site_themes_promote_scheduled();$cron$
    );
  END IF;
END $$;