
-- =====================================================
-- Step 1 — Parser Schema & Registry
-- =====================================================

-- parser_definitions ---------------------------------------------------
CREATE TABLE public.parser_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'swift_mt940','swift_mt942','swift_mt950','swift_mt101',
    'iso20022_camt052','iso20022_camt053','iso20022_camt054',
    'fix44','fix50sp2','fpml','sfti',
    'ach','nacha','bai2'
  )),
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  description text,
  canonical_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, name, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parser_definitions TO authenticated;
GRANT ALL ON public.parser_definitions TO service_role;
ALTER TABLE public.parser_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parser_definitions_select_member" ON public.parser_definitions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "parser_definitions_admin_write" ON public.parser_definitions
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE INDEX idx_parser_definitions_tenant_kind ON public.parser_definitions(tenant_id, kind);
CREATE TRIGGER trg_parser_definitions_updated
  BEFORE UPDATE ON public.parser_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- parser_field_maps ----------------------------------------------------
CREATE TABLE public.parser_field_maps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.parser_definitions(id) ON DELETE CASCADE,
  source_field text NOT NULL,
  target_field text NOT NULL,
  transform text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, source_field, target_field)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parser_field_maps TO authenticated;
GRANT ALL ON public.parser_field_maps TO service_role;
ALTER TABLE public.parser_field_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parser_field_maps_select_member" ON public.parser_field_maps
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "parser_field_maps_admin_write" ON public.parser_field_maps
  FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role));

CREATE INDEX idx_parser_field_maps_def ON public.parser_field_maps(definition_id);
CREATE TRIGGER trg_parser_field_maps_updated
  BEFORE UPDATE ON public.parser_field_maps
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- parser_runs ----------------------------------------------------------
CREATE TABLE public.parser_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  definition_id uuid REFERENCES public.parser_definitions(id) ON DELETE SET NULL,
  source_filename text,
  source_sha256 text,
  bytes_in bigint NOT NULL DEFAULT 0,
  messages_out integer NOT NULL DEFAULT 0,
  errors_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','partial')),
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  initiated_by uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.parser_runs TO authenticated;
GRANT ALL ON public.parser_runs TO service_role;
ALTER TABLE public.parser_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parser_runs_select_member" ON public.parser_runs
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "parser_runs_service_write" ON public.parser_runs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_parser_runs_tenant_started ON public.parser_runs(tenant_id, started_at DESC);
CREATE INDEX idx_parser_runs_sha ON public.parser_runs(source_sha256);

-- parser_messages ------------------------------------------------------
CREATE TABLE public.parser_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.parser_runs(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  msg_type text,
  account text,
  value_date date,
  booking_date date,
  currency text,
  amount_cents bigint,
  debit_credit text CHECK (debit_credit IS NULL OR debit_credit IN ('DBIT','CRDT')),
  counterparty text,
  reference text,
  end_to_end_id text,
  description text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.parser_messages TO authenticated;
GRANT ALL ON public.parser_messages TO service_role;
ALTER TABLE public.parser_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parser_messages_select_member" ON public.parser_messages
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "parser_messages_service_write" ON public.parser_messages
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_parser_messages_run ON public.parser_messages(run_id, ordinal);
CREATE INDEX idx_parser_messages_tenant_date ON public.parser_messages(tenant_id, value_date DESC);
CREATE INDEX idx_parser_messages_ref ON public.parser_messages(tenant_id, reference);
