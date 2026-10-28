
ALTER TABLE public.platform_backup_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pbe_tenant_time
  ON public.platform_backup_events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tenant_backup_slas (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot_sla_hours integer NOT NULL DEFAULT 26,
  alerts_enabled boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_backup_slas TO authenticated;
GRANT ALL ON public.tenant_backup_slas TO service_role;

ALTER TABLE public.tenant_backup_slas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read tenant_backup_slas"
  ON public.tenant_backup_slas FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "platform admins write tenant_backup_slas"
  ON public.tenant_backup_slas FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tenant_backup_slas_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_tenant_backup_slas_touch ON public.tenant_backup_slas;
CREATE TRIGGER trg_tenant_backup_slas_touch
  BEFORE UPDATE ON public.tenant_backup_slas
  FOR EACH ROW EXECUTE FUNCTION public.tenant_backup_slas_touch();
