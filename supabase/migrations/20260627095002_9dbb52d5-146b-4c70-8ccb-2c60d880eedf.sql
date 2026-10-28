
CREATE TABLE IF NOT EXISTS public.recon_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  cron_expression text NOT NULL DEFAULT '0 * * * *',
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_status text,
  last_run_id uuid,
  last_error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, definition_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_schedules TO authenticated;
GRANT ALL ON public.recon_schedules TO service_role;
ALTER TABLE public.recon_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY recon_schedules_read ON public.recon_schedules FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY recon_schedules_write ON public.recon_schedules FOR ALL TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst')
  );
CREATE TRIGGER trg_recon_schedules_updated BEFORE UPDATE ON public.recon_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_recon_schedules_enabled ON public.recon_schedules(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_recon_schedules_tenant ON public.recon_schedules(tenant_id);

-- Append-only log of every orchestrator trigger (manual or cron)
CREATE TABLE IF NOT EXISTS public.recon_schedule_runs (
  id bigserial PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES public.recon_schedules(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recon_run_id uuid,
  trigger text NOT NULL DEFAULT 'cron',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  matched_count integer,
  exception_count integer,
  total_rows integer,
  error text
);
GRANT SELECT, INSERT ON public.recon_schedule_runs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recon_schedule_runs_id_seq TO authenticated;
GRANT ALL ON public.recon_schedule_runs TO service_role;
GRANT ALL ON SEQUENCE public.recon_schedule_runs_id_seq TO service_role;
ALTER TABLE public.recon_schedule_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY recon_schedule_runs_read ON public.recon_schedule_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_recon_schedule_runs_schedule ON public.recon_schedule_runs(schedule_id, started_at DESC);
