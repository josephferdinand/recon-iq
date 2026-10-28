
CREATE TABLE public.trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  device_label text,
  user_agent text,
  ip_address inet,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);
CREATE INDEX idx_trusted_devices_user ON public.trusted_devices(user_id, revoked_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trusted_devices TO authenticated;
GRANT ALL ON public.trusted_devices TO service_role;
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trusted_devices own" ON public.trusted_devices FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "trusted_devices admin read" ON public.trusted_devices FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE TABLE public.login_anomaly_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  ip_address inet,
  user_agent text,
  geo_country text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_anomaly_user ON public.login_anomaly_events(user_id, created_at DESC);
CREATE INDEX idx_login_anomaly_tenant ON public.login_anomaly_events(tenant_id, severity, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.login_anomaly_events TO authenticated;
GRANT ALL ON public.login_anomaly_events TO service_role;
ALTER TABLE public.login_anomaly_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "login_anomaly own read" ON public.login_anomaly_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY "login_anomaly admin update" ON public.login_anomaly_events FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX idx_mfa_recovery_user ON public.mfa_recovery_codes(user_id, used_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfa_recovery_codes TO authenticated;
GRANT ALL ON public.mfa_recovery_codes TO service_role;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recovery_codes own" ON public.mfa_recovery_codes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
