SELECT cron.schedule(
  'secret-rotation-executor',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--0bb09b92-4cf3-4c2c-970c-051d01656fdc.meta.app/api/public/cron/secret-rotation-executor',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', current_setting('app.sla_cron_hmac', true)),
    body := '{}'::jsonb
  );
  $$
);