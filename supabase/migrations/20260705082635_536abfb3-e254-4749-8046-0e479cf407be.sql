
CREATE TABLE IF NOT EXISTS public.platform_backup_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pitr_enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL DEFAULT 7 CHECK (retention_days > 0 AND retention_days <= 90),
  daily_snapshot_retention_days integer NOT NULL DEFAULT 7 CHECK (daily_snapshot_retention_days > 0 AND daily_snapshot_retention_days <= 90),
  latest_snapshot_at timestamptz,
  latest_pitr_window_start timestamptz,
  latest_pitr_window_end timestamptz,
  provider text NOT NULL DEFAULT 'meta-cloud',
  provider_notes text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.platform_backup_config TO authenticated;
GRANT ALL ON public.platform_backup_config TO service_role;

ALTER TABLE public.platform_backup_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backup_config_super_admin_read" ON public.platform_backup_config
FOR SELECT TO authenticated
USING (public.is_platform_super_admin(auth.uid()));

CREATE POLICY "backup_config_super_admin_write" ON public.platform_backup_config
FOR INSERT TO authenticated
WITH CHECK (public.is_platform_super_admin(auth.uid()));

CREATE POLICY "backup_config_super_admin_update" ON public.platform_backup_config
FOR UPDATE TO authenticated
USING (public.is_platform_super_admin(auth.uid()))
WITH CHECK (public.is_platform_super_admin(auth.uid()));

INSERT INTO public.platform_backup_config (id, pitr_enabled, retention_days, daily_snapshot_retention_days, provider, provider_notes)
VALUES (true, false, 7, 7, 'meta-cloud', 'Default Meta Cloud backup posture: daily snapshots, 7-day retention, no PITR add-on.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_backup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN (
    'config_change','snapshot_recorded','restore_requested','restore_approved',
    'restore_started','restore_completed','restore_failed','pitr_enabled','pitr_disabled','test_drill'
  )),
  actor_id uuid REFERENCES auth.users(id),
  actor_email text,
  target_recovery_at timestamptz,
  restored_at timestamptz,
  scope text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_backup_events_created_at_idx
  ON public.platform_backup_events (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_backup_events_type_idx
  ON public.platform_backup_events (event_type);

GRANT SELECT, INSERT ON public.platform_backup_events TO authenticated;
GRANT ALL ON public.platform_backup_events TO service_role;

ALTER TABLE public.platform_backup_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backup_events_super_admin_read" ON public.platform_backup_events
FOR SELECT TO authenticated
USING (public.is_platform_super_admin(auth.uid()));

CREATE POLICY "backup_events_super_admin_insert" ON public.platform_backup_events
FOR INSERT TO authenticated
WITH CHECK (public.is_platform_super_admin(auth.uid()) AND actor_id = auth.uid());
