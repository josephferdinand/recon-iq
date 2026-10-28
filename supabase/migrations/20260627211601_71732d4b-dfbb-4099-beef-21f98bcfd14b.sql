
-- 1. Components catalog
CREATE TABLE public.status_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  state text NOT NULL DEFAULT 'operational'
    CHECK (state IN ('operational','degraded_performance','partial_outage','major_outage','maintenance')),
  group_name text,
  display_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.status_components TO anon, authenticated;
GRANT ALL    ON public.status_components TO service_role;
ALTER TABLE public.status_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "components_public_select" ON public.status_components FOR SELECT USING (true);
CREATE POLICY "components_admin_write"   ON public.status_components FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));

-- 2. 90-day history (daily roll-up of worst state)
CREATE TABLE public.status_component_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES public.status_components(id) ON DELETE CASCADE,
  day date NOT NULL,
  worst_state text NOT NULL DEFAULT 'operational'
    CHECK (worst_state IN ('operational','degraded_performance','partial_outage','major_outage','maintenance')),
  uptime_pct numeric(6,3) NOT NULL DEFAULT 100.000,
  incident_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (component_id, day)
);
GRANT SELECT ON public.status_component_history TO anon, authenticated;
GRANT ALL    ON public.status_component_history TO service_role;
ALTER TABLE public.status_component_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_public_select" ON public.status_component_history FOR SELECT USING (true);
CREATE POLICY "history_admin_write"   ON public.status_component_history FOR ALL TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));
CREATE INDEX status_history_component_day_idx ON public.status_component_history (component_id, day DESC);

-- 3. Subscribers (double opt-in)
CREATE TABLE public.status_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  confirm_token uuid NOT NULL DEFAULT gen_random_uuid(),
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  confirmed_at timestamptz,
  component_keys text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.status_subscribers TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.status_subscribers TO service_role;
ALTER TABLE public.status_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscribers_anyone_insert" ON public.status_subscribers FOR INSERT WITH CHECK (true);
CREATE POLICY "subscribers_admin_read"    ON public.status_subscribers FOR SELECT TO authenticated
  USING (is_platform_admin(auth.uid()));
CREATE POLICY "subscribers_admin_write"   ON public.status_subscribers FOR UPDATE TO authenticated
  USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid()));
CREATE POLICY "subscribers_admin_delete"  ON public.status_subscribers FOR DELETE TO authenticated
  USING (is_platform_admin(auth.uid()));

-- 4. Extend incidents with component link + impact
ALTER TABLE public.status_incidents
  ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES public.status_components(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impact text;
CREATE INDEX IF NOT EXISTS status_incidents_started_at_idx ON public.status_incidents (started_at DESC);

-- 5. Token-based confirm / unsubscribe (no auth required)
CREATE OR REPLACE FUNCTION public.status_confirm_subscriber(_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE updated int;
BEGIN
  UPDATE public.status_subscribers
     SET confirmed_at = now()
   WHERE confirm_token = _token AND confirmed_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.status_confirm_subscriber(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.status_confirm_subscriber(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.status_unsubscribe(_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted int;
BEGIN
  DELETE FROM public.status_subscribers WHERE unsubscribe_token = _token;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.status_unsubscribe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.status_unsubscribe(uuid) TO anon, authenticated;

-- 6. Aggregated overall status (worst component state)
CREATE OR REPLACE FUNCTION public.status_overall()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
      WHEN bool_or(state = 'major_outage')         THEN 'major_outage'
      WHEN bool_or(state = 'partial_outage')       THEN 'partial_outage'
      WHEN bool_or(state = 'degraded_performance') THEN 'degraded_performance'
      WHEN bool_or(state = 'maintenance')          THEN 'maintenance'
      ELSE 'operational'
     END
     FROM public.status_components),
    'operational'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.status_overall() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.status_overall() TO anon, authenticated;

-- 7. updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_status_components()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_status_components_touch
  BEFORE UPDATE ON public.status_components
  FOR EACH ROW EXECUTE FUNCTION public.touch_status_components();

-- 8. Seed default components
INSERT INTO public.status_components (key, name, description, group_name, display_order) VALUES
  ('auth',        'Authentication & SSO',     'Sign-in, SAML, SCIM, MFA, step-up',          'Identity',    10),
  ('api',         'Core API',                  'Tenant-scoped REST and server functions',    'Application', 20),
  ('workspace',   'Workspace UI',              'Web application and routing',                'Application', 30),
  ('recon',       'Reconciliation Engine',     'Matching, exceptions, batch processing',     'Application', 40),
  ('aidp',        'Adaptive Document Processing', 'PDF extraction and template processing','Application', 50),
  ('connectors',  'Ingestion Connectors',      'SFTP, S3, GCS, Azure, DB, webhooks',         'Data',        60),
  ('reporting',   'Reporting DB',              'Read-replica exports for BI tools',          'Data',        70),
  ('email',       'Email Delivery',            'Transactional notifications and digests',    'Platform',    80)
ON CONFLICT (key) DO NOTHING;

-- 9. Backfill 90 days of "operational" history for each component
INSERT INTO public.status_component_history (component_id, day, worst_state, uptime_pct)
SELECT c.id, d::date, 'operational', 100.000
  FROM public.status_components c
  CROSS JOIN generate_series((CURRENT_DATE - INTERVAL '89 days'), CURRENT_DATE, INTERVAL '1 day') d
ON CONFLICT (component_id, day) DO NOTHING;
