
-- 1. Tenant region for data residency
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'eu-west-1';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS residency_locked boolean NOT NULL DEFAULT false;

-- 2. SSO configs
CREATE TABLE IF NOT EXISTS public.tenant_sso_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (provider_type IN ('saml','oidc')),
  display_name text NOT NULL,
  metadata_url text,
  entity_id text,
  acs_url text,
  client_id text,
  issuer_url text,
  email_domains text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_sso_configs TO authenticated;
GRANT ALL ON public.tenant_sso_configs TO service_role;
ALTER TABLE public.tenant_sso_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sso_read ON public.tenant_sso_configs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY sso_write ON public.tenant_sso_configs FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_sso_updated BEFORE UPDATE ON public.tenant_sso_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Scheduled data source connectors
CREATE TABLE IF NOT EXISTS public.data_source_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  connector_type text NOT NULL CHECK (connector_type IN ('sftp','s3','http','manual')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  transformation jsonb NOT NULL DEFAULT '[]'::jsonb,
  cron_expression text NOT NULL DEFAULT '0 * * * *',
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_status text,
  last_rows_ingested integer,
  last_error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_source_schedules TO authenticated;
GRANT ALL ON public.data_source_schedules TO service_role;
ALTER TABLE public.data_source_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY dss_read ON public.data_source_schedules FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY dss_write ON public.data_source_schedules FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_dss_updated BEFORE UPDATE ON public.data_source_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.data_source_runs (
  id bigserial PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES public.data_source_schedules(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  rows_ingested integer,
  error text,
  trigger text NOT NULL DEFAULT 'cron'
);
GRANT SELECT, INSERT ON public.data_source_runs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.data_source_runs_id_seq TO authenticated;
GRANT ALL ON public.data_source_runs TO service_role;
GRANT ALL ON SEQUENCE public.data_source_runs_id_seq TO service_role;
ALTER TABLE public.data_source_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsr_read ON public.data_source_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

-- 4. Notification channels (Slack/Teams/Email)
CREATE TABLE IF NOT EXISTS public.notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('slack','teams','email','webhook')),
  name text NOT NULL,
  target text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY['recon.completed','ticket.escalated','exception.created'],
  enabled boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,
  last_delivery_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_channels TO authenticated;
GRANT ALL ON public.notification_channels TO service_role;
ALTER TABLE public.notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY nc_read ON public.notification_channels FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY nc_write ON public.notification_channels FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_nc_updated BEFORE UPDATE ON public.notification_channels
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. Recon presence (realtime collaboration)
CREATE TABLE IF NOT EXISTS public.recon_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, resource_type, resource_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_presence TO authenticated;
GRANT ALL ON public.recon_presence TO service_role;
ALTER TABLE public.recon_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY rp_read ON public.recon_presence FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY rp_write ON public.recon_presence FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id));
ALTER PUBLICATION supabase_realtime ADD TABLE public.recon_presence;

-- 6. Email digest preferences
CREATE TABLE IF NOT EXISTS public.email_digest_subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('off','daily','weekly')),
  last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_digest_subscriptions TO authenticated;
GRANT ALL ON public.email_digest_subscriptions TO service_role;
ALTER TABLE public.email_digest_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY eds_own ON public.email_digest_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
