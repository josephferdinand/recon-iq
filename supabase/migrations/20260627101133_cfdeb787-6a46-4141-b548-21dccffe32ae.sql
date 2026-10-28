
ALTER TABLE public.data_source_schedules
  DROP CONSTRAINT IF EXISTS data_source_schedules_connector_type_check;

ALTER TABLE public.data_source_schedules
  ADD CONSTRAINT data_source_schedules_connector_type_check
  CHECK (connector_type = ANY (ARRAY[
    'sftp','ftp','s3','azure_blob','gcs','bigquery','snowflake','databricks',
    'http','https','rest','local','network_drive','manual'
  ]));
