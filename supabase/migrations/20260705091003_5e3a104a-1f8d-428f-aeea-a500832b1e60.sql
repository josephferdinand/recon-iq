
CREATE TABLE IF NOT EXISTS public.platform_backup_notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type text NOT NULL CHECK (channel_type IN ('email','webhook','slack')),
  label text NOT NULL,
  target text NOT NULL, -- email address, webhook URL, or slack webhook URL
  enabled boolean NOT NULL DEFAULT true,
  notify_on text[] NOT NULL DEFAULT ARRAY['sla_breach','backup_failed','restore_failed'],
  secret text, -- optional HMAC secret for webhook signing
  last_dispatched_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_backup_notification_channels TO authenticated;
GRANT ALL ON public.platform_backup_notification_channels TO service_role;

ALTER TABLE public.platform_backup_notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform super admins manage backup notification channels"
ON public.platform_backup_notification_channels
FOR ALL
TO authenticated
USING (public.is_platform_super_admin(auth.uid()))
WITH CHECK (public.is_platform_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_backup_notif_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_backup_notif_touch ON public.platform_backup_notification_channels;
CREATE TRIGGER trg_backup_notif_touch
BEFORE UPDATE ON public.platform_backup_notification_channels
FOR EACH ROW EXECUTE FUNCTION public.tg_backup_notif_touch();

-- Bulk SLA update RPC with a single change note in audit_log
CREATE OR REPLACE FUNCTION public.bulk_upsert_tenant_backup_slas(
  _tenant_ids uuid[],
  _snapshot_sla_hours int,
  _alerts_enabled boolean,
  _change_note text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  affected int := 0;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: platform admin required';
  END IF;

  INSERT INTO public.tenant_backup_slas (tenant_id, snapshot_sla_hours, alerts_enabled, notes, updated_by)
  SELECT tid, _snapshot_sla_hours, _alerts_enabled, _change_note, auth.uid()
  FROM unnest(_tenant_ids) AS tid
  ON CONFLICT (tenant_id) DO UPDATE
    SET snapshot_sla_hours = EXCLUDED.snapshot_sla_hours,
        alerts_enabled     = EXCLUDED.alerts_enabled,
        notes              = COALESCE(EXCLUDED.notes, public.tenant_backup_slas.notes),
        updated_by         = auth.uid(),
        updated_at         = now();

  GET DIAGNOSTICS affected = ROW_COUNT;

  INSERT INTO public.audit_log (actor_user_id, action, scope, resource_type, resource_id, context)
  VALUES (
    auth.uid(),
    'platform_backup.tenant_sla_bulk_update',
    'platform',
    'tenant_backup_slas',
    'bulk',
    jsonb_build_object(
      'tenant_ids', _tenant_ids,
      'snapshot_sla_hours', _snapshot_sla_hours,
      'alerts_enabled', _alerts_enabled,
      'change_note', _change_note,
      'affected', affected
    )
  );

  RETURN affected;
END; $$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_tenant_backup_slas(uuid[], int, boolean, text) TO authenticated;
