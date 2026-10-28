
-- 1. Inline API source configs (saved per tenant; secret values live in vault, only references stored)
CREATE TABLE public.rekon_inline_api_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  url text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text,
  jsonpath text,
  auth_secret_ref text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rekon_inline_api_sources TO authenticated;
GRANT ALL ON public.rekon_inline_api_sources TO service_role;
ALTER TABLE public.rekon_inline_api_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read api sources" ON public.rekon_inline_api_sources
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "tenant writers manage api sources" ON public.rekon_inline_api_sources
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE TRIGGER trg_api_sources_uat BEFORE UPDATE ON public.rekon_inline_api_sources
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Saved DB connections (DSN reference; never raw creds)
CREATE TABLE public.rekon_db_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  dialect text NOT NULL,
  host text,
  port int,
  database text,
  username text,
  secret_ref text,
  ssl boolean NOT NULL DEFAULT true,
  default_sql text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rekon_db_connections TO authenticated;
GRANT ALL ON public.rekon_db_connections TO service_role;
ALTER TABLE public.rekon_db_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read db conns" ON public.rekon_db_connections
  FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "tenant writers manage db conns" ON public.rekon_db_connections
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));
CREATE TRIGGER trg_db_conns_uat BEFORE UPDATE ON public.rekon_db_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Per-user wizard drafts (autosave)
CREATE TABLE public.rekon_wizard_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'two_sided',
  step int NOT NULL DEFAULT 1,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rekon_wizard_drafts_user_idx ON public.rekon_wizard_drafts(user_id, tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rekon_wizard_drafts TO authenticated;
GRANT ALL ON public.rekon_wizard_drafts TO service_role;
ALTER TABLE public.rekon_wizard_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own draft read" ON public.rekon_wizard_drafts
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "own draft write" ON public.rekon_wizard_drafts
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE TRIGGER trg_wizard_drafts_uat BEFORE UPDATE ON public.rekon_wizard_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
