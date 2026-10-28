
-- D1 Security baseline
CREATE TABLE public.tenant_security_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  mfa_required boolean NOT NULL DEFAULT false,
  ip_allowlist_enabled boolean NOT NULL DEFAULT false,
  session_max_age_minutes int NOT NULL DEFAULT 720,
  max_uploads_per_hour int NOT NULL DEFAULT 100,
  max_runs_per_hour int NOT NULL DEFAULT 200,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tenant_security_settings TO authenticated;
GRANT ALL ON public.tenant_security_settings TO service_role;
ALTER TABLE public.tenant_security_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read settings" ON public.tenant_security_settings FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "admins write settings" ON public.tenant_security_settings FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_tss_updated BEFORE UPDATE ON public.tenant_security_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.tenant_ip_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cidr text NOT NULL,
  label text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ip_allow_tenant ON public.tenant_ip_allowlist(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_ip_allowlist TO authenticated;
GRANT ALL ON public.tenant_ip_allowlist TO service_role;
ALTER TABLE public.tenant_ip_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read allowlist" ON public.tenant_ip_allowlist FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "admins write allowlist" ON public.tenant_ip_allowlist FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.rate_limit_buckets (
  id bigserial PRIMARY KEY,
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  UNIQUE (bucket_key, window_start)
);
CREATE INDEX idx_rlb_key_window ON public.rate_limit_buckets(bucket_key, window_start DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_buckets TO authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no direct access" ON public.rate_limit_buckets FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Atomic rate limit increment (security definer bypasses RLS)
CREATE OR REPLACE FUNCTION public.rate_limit_hit(_key text, _window_seconds int, _limit int)
RETURNS TABLE(allowed boolean, current_count int, retry_after_seconds int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window timestamptz;
  v_count int;
BEGIN
  v_window := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.rate_limit_buckets(bucket_key, window_start, count)
    VALUES (_key, v_window, 1)
  ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = public.rate_limit_buckets.count + 1
  RETURNING count INTO v_count;
  RETURN QUERY SELECT (v_count <= _limit), v_count,
    GREATEST(0, _window_seconds - extract(epoch FROM (now() - v_window))::int);
END $$;

-- File upload audit (magic byte + sha256 already captured; add validation table)
CREATE TABLE public.security_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  ip text,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_sec_events_tenant ON public.security_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_sec_events_type ON public.security_events(event_type, occurred_at DESC);
GRANT SELECT, INSERT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read events" ON public.security_events FOR SELECT TO authenticated
  USING (
    (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
    OR public.is_platform_admin(auth.uid())
  );
CREATE POLICY "auth insert events" ON public.security_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Seed security settings for existing tenants
INSERT INTO public.tenant_security_settings (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT DO NOTHING;
