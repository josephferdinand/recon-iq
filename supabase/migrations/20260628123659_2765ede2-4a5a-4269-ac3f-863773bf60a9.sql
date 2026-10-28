
-- 1. Lifecycle event catalog (platform-managed; readable by all authenticated)
CREATE TABLE IF NOT EXISTS public.platform_event_catalog (
  event_key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  payload_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  stability TEXT NOT NULL DEFAULT 'stable' CHECK (stability IN ('alpha','beta','stable','deprecated')),
  introduced_version TEXT,
  deprecated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_event_catalog TO authenticated;
GRANT ALL ON public.platform_event_catalog TO service_role;
ALTER TABLE public.platform_event_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY pec_read ON public.platform_event_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY pec_admin_write ON public.platform_event_catalog FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_pec_updated BEFORE UPDATE ON public.platform_event_catalog
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Tenant plugins (custom matching rules, enrichers, UI panels — sandboxed TS)
CREATE TABLE IF NOT EXISTS public.tenant_plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('matcher','enricher','panel','transformer','validator')),
  version TEXT NOT NULL DEFAULT '0.1.0',
  description TEXT,
  source_code TEXT NOT NULL DEFAULT '',
  entry_point TEXT NOT NULL DEFAULT 'default',
  sandbox_limits JSONB NOT NULL DEFAULT '{"cpu_ms":500,"mem_mb":64,"net":false,"timeout_ms":2000}'::jsonb,
  config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','enabled','disabled')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  installed_from TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_plugins TO authenticated;
GRANT ALL ON public.tenant_plugins TO service_role;
ALTER TABLE public.tenant_plugins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tp_read ON public.tenant_plugins FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY tp_write ON public.tenant_plugins FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER trg_tp_updated BEFORE UPDATE ON public.tenant_plugins
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_tp_tenant_kind ON public.tenant_plugins (tenant_id, kind);

-- 3. Plugin execution audit
CREATE TABLE IF NOT EXISTS public.tenant_plugin_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plugin_id UUID NOT NULL REFERENCES public.tenant_plugins(id) ON DELETE CASCADE,
  invoked_by UUID REFERENCES auth.users(id),
  context_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','error','timeout','denied')),
  duration_ms INTEGER,
  cpu_ms INTEGER,
  mem_mb INTEGER,
  input_size_bytes INTEGER,
  output_size_bytes INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tenant_plugin_executions TO authenticated;
GRANT ALL ON public.tenant_plugin_executions TO service_role;
ALTER TABLE public.tenant_plugin_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpe_read ON public.tenant_plugin_executions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY tpe_insert ON public.tenant_plugin_executions FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX idx_tpe_plugin_time ON public.tenant_plugin_executions (plugin_id, created_at DESC);

-- 4. Sandbox tenant links (sibling tenant auto-provisioned for CI/CD)
CREATE TABLE IF NOT EXISTS public.tenant_sandbox_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prod_tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sandbox_tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'ci-cd' CHECK (purpose IN ('ci-cd','uat','training','perf')),
  data_seed TEXT NOT NULL DEFAULT 'masked' CHECK (data_seed IN ('empty','masked','synthetic')),
  refresh_cadence TEXT NOT NULL DEFAULT 'on-demand',
  last_refreshed_at TIMESTAMPTZ,
  api_base_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prod_tenant_id, sandbox_tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_sandbox_links TO authenticated;
GRANT ALL ON public.tenant_sandbox_links TO service_role;
ALTER TABLE public.tenant_sandbox_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tsl_read ON public.tenant_sandbox_links FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), prod_tenant_id) OR public.is_tenant_member(auth.uid(), sandbox_tenant_id));
CREATE POLICY tsl_write ON public.tenant_sandbox_links FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), prod_tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), prod_tenant_id, 'tenant_admin'));
CREATE TRIGGER trg_tsl_updated BEFORE UPDATE ON public.tenant_sandbox_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. IaC export snapshots (Terraform / Pulumi)
CREATE TABLE IF NOT EXISTS public.tenant_iac_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('terraform','pulumi-ts','pulumi-py','crossplane')),
  scope TEXT NOT NULL CHECK (scope IN ('tenant','rules','users','full')),
  content TEXT NOT NULL,
  resource_count INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  generated_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.tenant_iac_exports TO authenticated;
GRANT ALL ON public.tenant_iac_exports TO service_role;
ALTER TABLE public.tenant_iac_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tie_read ON public.tenant_iac_exports FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY tie_write ON public.tenant_iac_exports FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE POLICY tie_delete ON public.tenant_iac_exports FOR DELETE TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE INDEX idx_tie_tenant_time ON public.tenant_iac_exports (tenant_id, generated_at DESC);

-- 6. API surface registry (REST / GraphQL / gRPC parity tracking)
CREATE TABLE IF NOT EXISTS public.platform_api_surfaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol TEXT NOT NULL CHECK (protocol IN ('rest','graphql','grpc','webhook','sdk')),
  resource TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ga' CHECK (status IN ('ga','beta','alpha','planned','deprecated')),
  endpoint TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (protocol, resource, operation)
);
GRANT SELECT ON public.platform_api_surfaces TO authenticated;
GRANT ALL ON public.platform_api_surfaces TO service_role;
ALTER TABLE public.platform_api_surfaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY pas_read ON public.platform_api_surfaces FOR SELECT TO authenticated USING (true);
CREATE POLICY pas_admin_write ON public.platform_api_surfaces FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER trg_pas_updated BEFORE UPDATE ON public.platform_api_surfaces
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed event catalog
INSERT INTO public.platform_event_catalog (event_key, category, description, stability) VALUES
  ('break.created','exception','Fired when a new break is recorded','stable'),
  ('break.assigned','exception','Fired when a break is assigned to a user/group','stable'),
  ('break.resolved','exception','Fired when a break is resolved','stable'),
  ('break.escalated','exception','Fired when SLA escalation occurs','stable'),
  ('recon.run.started','recon','Fired when a recon run begins','stable'),
  ('recon.run.completed','recon','Fired when a recon run completes','stable'),
  ('recon.signed_off','recon','Fired when an EOD sign-off is certified','stable'),
  ('signoff.certified','recon','Alias of recon.signed_off','stable'),
  ('agent.action.proposed','agent','Fired when an autonomous agent proposes an action','stable'),
  ('agent.action.approved','agent','Fired when an agent action is approved','stable'),
  ('agent.action_executed','agent','Fired when an agent action is executed','stable'),
  ('agent.action.reverted','agent','Fired when an agent action is reverted','stable'),
  ('aidp.extraction.completed','aidp','Fired when AIDP extraction finishes','stable'),
  ('plugin.execution.failed','platform','Fired when a tenant plugin execution fails','stable'),
  ('dlp.match.found','security','Fired when DLP scanner finds sensitive content','stable'),
  ('worm.evidence.appended','security','Fired when WORM evidence is appended','stable'),
  ('dr.drill.completed','resilience','Fired when a DR drill completes','beta'),
  ('maintenance.window.published','resilience','Fired when a maintenance window is published','stable')
ON CONFLICT (event_key) DO NOTHING;

-- Seed API surfaces (parity matrix)
INSERT INTO public.platform_api_surfaces (protocol, resource, operation, status, endpoint) VALUES
  ('rest','exceptions','list','ga','GET /api/v1/exceptions'),
  ('rest','exceptions','create','ga','POST /api/v1/exceptions'),
  ('rest','exceptions','resolve','ga','POST /api/v1/exceptions/{id}/resolve'),
  ('rest','recons','list','ga','GET /api/v1/recons'),
  ('rest','recons','run','ga','POST /api/v1/recons/{id}/run'),
  ('rest','webhooks','manage','ga','/api/v1/webhooks'),
  ('graphql','exceptions','query','beta','POST /api/v1/graphql'),
  ('graphql','recons','query','beta','POST /api/v1/graphql'),
  ('graphql','subscriptions','events','alpha','wss /api/v1/graphql'),
  ('grpc','exceptions','ListExceptions','alpha','fvi.v1.ExceptionService'),
  ('grpc','recons','RunRecon','alpha','fvi.v1.ReconService'),
  ('grpc','streaming','EventStream','planned','fvi.v1.EventService'),
  ('webhook','events','deliver','ga','POST {customer_url}'),
  ('sdk','typescript','client','ga','npm i @fvi/sdk'),
  ('sdk','python','client','beta','pip install fvi-sdk'),
  ('sdk','java','client','planned','com.fvi:sdk')
ON CONFLICT (protocol, resource, operation) DO NOTHING;
