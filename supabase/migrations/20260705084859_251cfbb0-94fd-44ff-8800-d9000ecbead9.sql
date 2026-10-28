
ALTER TABLE public.platform_backup_config
  ADD COLUMN IF NOT EXISTS snapshot_sla_hours integer NOT NULL DEFAULT 26,
  ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true;
