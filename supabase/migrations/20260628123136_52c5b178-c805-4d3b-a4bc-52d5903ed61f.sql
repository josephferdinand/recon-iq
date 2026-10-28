
-- 1) Tenant resilience tiers
CREATE TABLE public.tenant_resilience_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  tier text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard','premium','platinum','mission_critical')),
  rpo_seconds integer NOT NULL DEFAULT 900,
  rto_seconds integer NOT NULL DEFAULT 3600,
  primary_region text NOT NULL DEFAULT 'us-east-1',
  secondary_region text,
  active_active boolean NOT NULL DEFAULT false,
  failover_strategy text NOT NULL DEFAULT 'manual' CHECK (failover_strategy IN ('manual','assisted','automatic')),
  last_failover_test_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_resilience_tiers TO authenticated;
GRANT ALL ON public.tenant_resilience_tiers TO service_role;
ALTER TABLE public.tenant_resilience_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read resilience tier"
  ON public.tenant_resilience_tiers FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "platform admins manage resilience tiers"
  ON public.tenant_resilience_tiers FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- 2) DR / chaos drills
CREATE TABLE public.dr_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  drill_type text NOT NULL CHECK (drill_type IN ('failover','chaos','backup_restore','tabletop','region_evac','data_corruption')),
  title text NOT NULL,
  description text,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','passed','failed','cancelled')),
  observed_rpo_seconds integer,
  observed_rto_seconds integer,
  target_rpo_seconds integer,
  target_rto_seconds integer,
  evidence_url text,
  evidence_sha256 text,
  findings text,
  remediation text,
  conducted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dr_drills TO authenticated;
GRANT ALL ON public.dr_drills TO service_role;
ALTER TABLE public.dr_drills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant admins view drills"
  ON public.dr_drills FOR SELECT TO authenticated
  USING (
    (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
    OR public.is_platform_admin(auth.uid())
  );
CREATE POLICY "platform admins manage drills"
  ON public.dr_drills FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE INDEX idx_dr_drills_tenant ON public.dr_drills(tenant_id, scheduled_at DESC);
CREATE INDEX idx_dr_drills_status ON public.dr_drills(status, scheduled_at DESC);

-- 3) Maintenance windows
CREATE TABLE public.maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform','tenant','region','component')),
  region text,
  component text,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  impact text NOT NULL DEFAULT 'minor' CHECK (impact IN ('none','minor','major','full_outage')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  notify_customers boolean NOT NULL DEFAULT true,
  notified_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_windows TO authenticated;
GRANT SELECT ON public.maintenance_windows TO anon;
GRANT ALL ON public.maintenance_windows TO service_role;
ALTER TABLE public.maintenance_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read platform maintenance"
  ON public.maintenance_windows FOR SELECT TO anon
  USING (scope = 'platform' AND notify_customers = true);
CREATE POLICY "authenticated read relevant maintenance"
  ON public.maintenance_windows FOR SELECT TO authenticated
  USING (
    scope = 'platform'
    OR (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id))
    OR public.is_platform_admin(auth.uid())
  );
CREATE POLICY "platform admins manage maintenance"
  ON public.maintenance_windows FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE INDEX idx_maintenance_windows_starts ON public.maintenance_windows(starts_at DESC);
CREATE INDEX idx_maintenance_windows_tenant ON public.maintenance_windows(tenant_id, starts_at DESC);

-- 4) Change-freeze windows
CREATE TABLE public.change_freeze_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform','tenant')),
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  blocks_deploys boolean NOT NULL DEFAULT true,
  blocks_config_changes boolean NOT NULL DEFAULT true,
  blocks_schema_changes boolean NOT NULL DEFAULT true,
  break_glass_role text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_freeze_windows TO authenticated;
GRANT ALL ON public.change_freeze_windows TO service_role;
ALTER TABLE public.change_freeze_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read change freeze"
  ON public.change_freeze_windows FOR SELECT TO authenticated
  USING (
    scope = 'platform'
    OR (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id))
    OR public.is_platform_admin(auth.uid())
  );
CREATE POLICY "platform admins manage change freeze"
  ON public.change_freeze_windows FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE INDEX idx_change_freeze_active ON public.change_freeze_windows(active, starts_at, ends_at);

-- 5) Per-tenant SLO snapshots
CREATE TABLE public.tenant_slo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  bucket_minutes integer NOT NULL DEFAULT 60,
  uptime_pct numeric(6,3) NOT NULL DEFAULT 100,
  p50_latency_ms integer,
  p95_latency_ms integer,
  p99_latency_ms integer,
  error_rate_pct numeric(6,3) NOT NULL DEFAULT 0,
  error_budget_remaining_pct numeric(6,3),
  recon_success_pct numeric(6,3),
  ingestion_lag_seconds integer,
  status text NOT NULL DEFAULT 'operational' CHECK (status IN ('operational','degraded','partial_outage','major_outage','maintenance')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bucket_start, bucket_minutes)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_slo_snapshots TO authenticated;
GRANT ALL ON public.tenant_slo_snapshots TO service_role;
ALTER TABLE public.tenant_slo_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read SLO snapshots"
  ON public.tenant_slo_snapshots FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "platform admins write SLO snapshots"
  ON public.tenant_slo_snapshots FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE INDEX idx_tenant_slo_snapshots_lookup ON public.tenant_slo_snapshots(tenant_id, bucket_start DESC);

-- 6) updated_at triggers
CREATE TRIGGER trg_tenant_resilience_tiers_updated
  BEFORE UPDATE ON public.tenant_resilience_tiers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_dr_drills_updated
  BEFORE UPDATE ON public.dr_drills
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_maintenance_windows_updated
  BEFORE UPDATE ON public.maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_change_freeze_windows_updated
  BEFORE UPDATE ON public.change_freeze_windows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 7) Helper: is_change_freeze_active(tenant)
CREATE OR REPLACE FUNCTION public.is_change_freeze_active(p_tenant_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.change_freeze_windows
    WHERE active = true
      AND now() BETWEEN starts_at AND ends_at
      AND (scope = 'platform' OR tenant_id = p_tenant_id)
  );
$$;
REVOKE ALL ON FUNCTION public.is_change_freeze_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_change_freeze_active(uuid) TO authenticated, service_role;
