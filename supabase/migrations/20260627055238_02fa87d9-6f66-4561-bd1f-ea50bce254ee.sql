
ALTER TABLE public.workspace_data_source_uploads
  ADD COLUMN IF NOT EXISTS rows jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Recon definitions
CREATE TABLE public.recon_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  recon_type text NOT NULL CHECK (recon_type IN ('one_sided','two_sided','three_sided')),
  sides jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX recon_definitions_tenant_idx ON public.recon_definitions(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_definitions TO authenticated;
GRANT ALL ON public.recon_definitions TO service_role;
ALTER TABLE public.recon_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_defs_select_member" ON public.recon_definitions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "recon_defs_write_analyst" ON public.recon_definitions FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));

CREATE TRIGGER trg_recon_defs_updated_at BEFORE UPDATE ON public.recon_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Recon runs
CREATE TABLE public.recon_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  matched_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  total_rows integer NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  run_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX recon_runs_def_idx ON public.recon_runs(definition_id, started_at DESC);
CREATE INDEX recon_runs_tenant_idx ON public.recon_runs(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_runs TO authenticated;
GRANT ALL ON public.recon_runs TO service_role;
ALTER TABLE public.recon_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_runs_select_member" ON public.recon_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "recon_runs_write_analyst" ON public.recon_runs FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));

-- Matches
CREATE TABLE public.recon_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.recon_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_key text,
  rule_id text,
  cardinality text NOT NULL DEFAULT '1:1',
  members jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recon_matches_run_idx ON public.recon_matches(run_id);

GRANT SELECT, INSERT, DELETE ON public.recon_matches TO authenticated;
GRANT ALL ON public.recon_matches TO service_role;
ALTER TABLE public.recon_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_matches_select_member" ON public.recon_matches FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "recon_matches_write_analyst" ON public.recon_matches FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));

-- Exceptions
CREATE TABLE public.recon_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.recon_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  side text,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','wont_fix')),
  assignee uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_note text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recon_exceptions_run_idx ON public.recon_exceptions(run_id);
CREATE INDEX recon_exceptions_tenant_status_idx ON public.recon_exceptions(tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_exceptions TO authenticated;
GRANT ALL ON public.recon_exceptions TO service_role;
ALTER TABLE public.recon_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_exc_select_member" ON public.recon_exceptions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "recon_exc_write_analyst" ON public.recon_exceptions FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'));

CREATE TRIGGER trg_recon_exc_updated_at BEFORE UPDATE ON public.recon_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
