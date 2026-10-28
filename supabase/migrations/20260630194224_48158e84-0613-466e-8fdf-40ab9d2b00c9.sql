
-- =========================================================================
-- Phase 8 (P3) — Scale & enterprise tiering
-- =========================================================================

-- 1) Sharded match executor -----------------------------------------------

CREATE TABLE IF NOT EXISTS public.shard_executor_registry (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  max_shards  integer NOT NULL DEFAULT 64,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shard_executor_registry TO authenticated, anon;
GRANT ALL    ON public.shard_executor_registry TO service_role;
ALTER TABLE public.shard_executor_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY ser_read ON public.shard_executor_registry FOR SELECT USING (true);

INSERT INTO public.shard_executor_registry(code,name,description,max_shards) VALUES
  ('hash_account_v1','Hash-by-account v1','Hash partition by account_id; balanced across workers.',128),
  ('range_trade_date_v1','Range-by-trade-date v1','Range partition by trade_date; favours hot windows.',64),
  ('composite_isin_book_v1','Composite ISIN+book v1','Composite hash on (isin, book_id).',64)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, max_shards=EXCLUDED.max_shards;

CREATE TABLE IF NOT EXISTS public.recon_shard_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recon_run_id          uuid,
  executor_code         text NOT NULL REFERENCES public.shard_executor_registry(code),
  shard_index           integer NOT NULL,
  shard_count           integer NOT NULL,
  status                text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  rows_in               bigint NOT NULL DEFAULT 0,
  rows_matched          bigint NOT NULL DEFAULT 0,
  rows_unmatched        bigint NOT NULL DEFAULT 0,
  started_at            timestamptz,
  ended_at              timestamptz,
  error_text            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rsr_tenant_run_idx ON public.recon_shard_runs(tenant_id, recon_run_id);
CREATE INDEX IF NOT EXISTS rsr_status_idx     ON public.recon_shard_runs(tenant_id, status);
GRANT SELECT, INSERT, UPDATE ON public.recon_shard_runs TO authenticated;
GRANT ALL ON public.recon_shard_runs TO service_role;
ALTER TABLE public.recon_shard_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY rsr_read  ON public.recon_shard_runs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_shard_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY rsr_write ON public.recon_shard_runs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_shard_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY rsr_update ON public.recon_shard_runs FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = recon_shard_runs.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- 2) Silo tier catalog + assignments --------------------------------------

CREATE TABLE IF NOT EXISTS public.silo_tier_catalog (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  isolation_kind text NOT NULL CHECK (isolation_kind IN ('schema_per_tenant','database_per_tenant','region_per_tenant','dedicated_compute')),
  enabled     boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.silo_tier_catalog TO authenticated, anon;
GRANT ALL    ON public.silo_tier_catalog TO service_role;
ALTER TABLE public.silo_tier_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY stc_read ON public.silo_tier_catalog FOR SELECT USING (true);

INSERT INTO public.silo_tier_catalog(code,name,description,isolation_kind) VALUES
  ('silo_schema_v1','Schema-per-tenant','Dedicated Postgres schema inside the shared cluster. Sales-led, regulated clients only.','schema_per_tenant'),
  ('silo_db_v1','Database-per-tenant','Dedicated Postgres database. Strong blast-radius isolation.','database_per_tenant'),
  ('silo_region_v1','Region-per-tenant','Dedicated control + data plane in a chosen region.','region_per_tenant'),
  ('silo_compute_v1','Dedicated compute','Shared DB, dedicated worker pool with reserved capacity.','dedicated_compute')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, isolation_kind=EXCLUDED.isolation_kind;

CREATE TABLE IF NOT EXISTS public.tenant_silo_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  silo_tier_code  text NOT NULL REFERENCES public.silo_tier_catalog(code),
  region          text,
  cluster_handle  text,
  status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','provisioning','active','retiring','retired')),
  notes           text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  retired_at      timestamptz,
  created_by      uuid REFERENCES auth.users(id),
  UNIQUE(tenant_id, silo_tier_code)
);
CREATE INDEX IF NOT EXISTS tsa_tenant_idx ON public.tenant_silo_assignments(tenant_id);
GRANT SELECT, INSERT, UPDATE ON public.tenant_silo_assignments TO authenticated;
GRANT ALL ON public.tenant_silo_assignments TO service_role;
ALTER TABLE public.tenant_silo_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tsa_read  ON public.tenant_silo_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = tenant_silo_assignments.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY tsa_write ON public.tenant_silo_assignments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = tenant_silo_assignments.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY tsa_update ON public.tenant_silo_assignments FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = tenant_silo_assignments.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- Schema-per-tenant request workflow (sales-led, lightweight)
CREATE TABLE IF NOT EXISTS public.schema_per_tenant_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by    uuid REFERENCES auth.users(id),
  regulator_ref   text,
  justification   text NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','provisioned')),
  decided_by      uuid REFERENCES auth.users(id),
  decided_at      timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sptr_tenant_idx ON public.schema_per_tenant_requests(tenant_id);
GRANT SELECT, INSERT, UPDATE ON public.schema_per_tenant_requests TO authenticated;
GRANT ALL ON public.schema_per_tenant_requests TO service_role;
ALTER TABLE public.schema_per_tenant_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY sptr_read  ON public.schema_per_tenant_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = schema_per_tenant_requests.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY sptr_write ON public.schema_per_tenant_requests FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = schema_per_tenant_requests.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY sptr_update ON public.schema_per_tenant_requests FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = schema_per_tenant_requests.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- 3) Loan / collateral / sec-lending vertical -----------------------------

DO $$ BEGIN
  CREATE TYPE public.loan_facility_status AS ENUM ('draft','active','prepaid','matured','defaulted','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.loan_facilities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  facility_ref        text NOT NULL,
  borrower            text NOT NULL,
  currency            text NOT NULL,
  principal_amount    numeric(20,2) NOT NULL,
  outstanding_amount  numeric(20,2) NOT NULL DEFAULT 0,
  interest_rate_bps   integer,
  start_date          date NOT NULL,
  maturity_date       date,
  status              public.loan_facility_status NOT NULL DEFAULT 'draft',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, facility_ref)
);
CREATE INDEX IF NOT EXISTS lf_tenant_status_idx ON public.loan_facilities(tenant_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_facilities TO authenticated;
GRANT ALL ON public.loan_facilities TO service_role;
ALTER TABLE public.loan_facilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY lf_rw ON public.loan_facilities FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = loan_facilities.tenant_id AND tm.user_id = auth.uid() AND tm.active)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = loan_facilities.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE IF NOT EXISTS public.collateral_pledges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  facility_id         uuid REFERENCES public.loan_facilities(id) ON DELETE SET NULL,
  collateral_type     text NOT NULL,
  isin                text,
  quantity            numeric(20,6),
  market_value        numeric(20,2),
  currency            text,
  haircut_pct         numeric(7,4),
  effective_value     numeric(20,2),
  as_of               date NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_tenant_facility_idx ON public.collateral_pledges(tenant_id, facility_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collateral_pledges TO authenticated;
GRANT ALL ON public.collateral_pledges TO service_role;
ALTER TABLE public.collateral_pledges ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_rw ON public.collateral_pledges FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = collateral_pledges.tenant_id AND tm.user_id = auth.uid() AND tm.active)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = collateral_pledges.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE IF NOT EXISTS public.sec_lending_loans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trade_ref           text NOT NULL,
  isin                text NOT NULL,
  quantity            numeric(20,6) NOT NULL,
  counterparty_lei    text,
  loan_value          numeric(20,2),
  fee_bps             integer,
  rebate_bps          integer,
  open_date           date NOT NULL,
  close_date          date,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','recalled','closed','failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, trade_ref)
);
CREATE INDEX IF NOT EXISTS sll_tenant_status_idx ON public.sec_lending_loans(tenant_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_lending_loans TO authenticated;
GRANT ALL ON public.sec_lending_loans TO service_role;
ALTER TABLE public.sec_lending_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY sll_rw ON public.sec_lending_loans FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = sec_lending_loans.tenant_id AND tm.user_id = auth.uid() AND tm.active)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = sec_lending_loans.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- 4) Digital twin of operations -------------------------------------------

CREATE TABLE IF NOT EXISTS public.digital_twin_nodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  node_type   text NOT NULL CHECK (node_type IN ('source','cutoff','sla','control','escalation','workflow','recon')),
  node_key    text NOT NULL,
  label       text NOT NULL,
  status      text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warning','breached','unknown')),
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, node_type, node_key)
);
CREATE INDEX IF NOT EXISTS dtn_tenant_type_idx ON public.digital_twin_nodes(tenant_id, node_type);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.digital_twin_nodes TO authenticated;
GRANT ALL ON public.digital_twin_nodes TO service_role;
ALTER TABLE public.digital_twin_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY dtn_rw ON public.digital_twin_nodes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = digital_twin_nodes.tenant_id AND tm.user_id = auth.uid() AND tm.active)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = digital_twin_nodes.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE IF NOT EXISTS public.digital_twin_edges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  src_node_id  uuid NOT NULL REFERENCES public.digital_twin_nodes(id) ON DELETE CASCADE,
  dst_node_id  uuid NOT NULL REFERENCES public.digital_twin_nodes(id) ON DELETE CASCADE,
  rel          text NOT NULL,
  weight       numeric(8,4) NOT NULL DEFAULT 1.0,
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dte_tenant_src_idx ON public.digital_twin_edges(tenant_id, src_node_id);
CREATE INDEX IF NOT EXISTS dte_tenant_dst_idx ON public.digital_twin_edges(tenant_id, dst_node_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.digital_twin_edges TO authenticated;
GRANT ALL ON public.digital_twin_edges TO service_role;
ALTER TABLE public.digital_twin_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY dte_rw ON public.digital_twin_edges FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = digital_twin_edges.tenant_id AND tm.user_id = auth.uid() AND tm.active)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = digital_twin_edges.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE OR REPLACE FUNCTION public.get_digital_twin_subgraph(_tenant_id uuid, _root_node_id uuid, _max_depth integer DEFAULT 2)
RETURNS TABLE(node_id uuid, depth integer, parent_id uuid, rel text, label text, node_type text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE walk AS (
    SELECT n.id AS node_id, 0 AS depth, NULL::uuid AS parent_id, NULL::text AS rel, n.label, n.node_type, n.status
      FROM public.digital_twin_nodes n
      WHERE n.tenant_id = _tenant_id AND n.id = _root_node_id
    UNION ALL
    SELECT n.id, w.depth + 1, e.src_node_id, e.rel, n.label, n.node_type, n.status
      FROM walk w
      JOIN public.digital_twin_edges e ON e.tenant_id = _tenant_id AND e.src_node_id = w.node_id
      JOIN public.digital_twin_nodes n ON n.id = e.dst_node_id AND n.tenant_id = _tenant_id
      WHERE w.depth < LEAST(_max_depth, 5)
  )
  SELECT node_id, depth, parent_id, rel, label, node_type, status FROM walk;
$$;
REVOKE EXECUTE ON FUNCTION public.get_digital_twin_subgraph(uuid, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_digital_twin_subgraph(uuid, uuid, integer) TO authenticated, service_role;

-- 5) Chaos drills ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chaos_drill_catalog (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  category    text NOT NULL CHECK (category IN ('infra','data','security','app','region')),
  enabled     boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.chaos_drill_catalog TO authenticated, anon;
GRANT ALL    ON public.chaos_drill_catalog TO service_role;
ALTER TABLE public.chaos_drill_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY cdc_read ON public.chaos_drill_catalog FOR SELECT USING (true);

INSERT INTO public.chaos_drill_catalog(code,name,description,category) VALUES
  ('cd_db_failover_v1','Database failover','Trigger primary failover and measure RTO/RPO.','infra'),
  ('cd_region_blackout_v1','Region blackout','Cut a single region and validate cross-region recovery.','region'),
  ('cd_worker_kill_v1','Worker pool kill','Terminate worker pool mid-recon; verify retries + DLQ.','app'),
  ('cd_data_poison_v1','Data poison drill','Inject malformed payloads at ingestion boundary.','data'),
  ('cd_credential_rotate_v1','Forced credential rotation','Rotate BYOK/KMS keys with no warning.','security')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category;

CREATE TABLE IF NOT EXISTS public.chaos_drills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  drill_code      text NOT NULL REFERENCES public.chaos_drill_catalog(code),
  scheduled_for   timestamptz NOT NULL,
  started_at      timestamptz,
  ended_at        timestamptz,
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','running','passed','failed','cancelled')),
  rto_seconds     integer,
  rpo_seconds     integer,
  summary         text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cd_tenant_status_idx ON public.chaos_drills(tenant_id, status);
GRANT SELECT, INSERT, UPDATE ON public.chaos_drills TO authenticated;
GRANT ALL ON public.chaos_drills TO service_role;
ALTER TABLE public.chaos_drills ENABLE ROW LEVEL SECURITY;
CREATE POLICY cd_read  ON public.chaos_drills FOR SELECT USING (
  tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = chaos_drills.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY cd_write ON public.chaos_drills FOR INSERT WITH CHECK (
  tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = chaos_drills.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY cd_update ON public.chaos_drills FOR UPDATE USING (
  tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = chaos_drills.tenant_id AND tm.user_id = auth.uid() AND tm.active));

CREATE TABLE IF NOT EXISTS public.chaos_drill_findings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id    uuid NOT NULL REFERENCES public.chaos_drills(id) ON DELETE CASCADE,
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  severity    text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  title       text NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cdf_drill_idx ON public.chaos_drill_findings(drill_id);
GRANT SELECT, INSERT ON public.chaos_drill_findings TO authenticated;
GRANT ALL ON public.chaos_drill_findings TO service_role;
ALTER TABLE public.chaos_drill_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cdf_read  ON public.chaos_drill_findings FOR SELECT USING (
  tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = chaos_drill_findings.tenant_id AND tm.user_id = auth.uid() AND tm.active));
CREATE POLICY cdf_write ON public.chaos_drill_findings FOR INSERT WITH CHECK (
  tenant_id IS NULL OR EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = chaos_drill_findings.tenant_id AND tm.user_id = auth.uid() AND tm.active));

-- Touch updated_at on loan facility updates
CREATE OR REPLACE FUNCTION public.phase8_touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS lf_touch ON public.loan_facilities;
CREATE TRIGGER lf_touch BEFORE UPDATE ON public.loan_facilities FOR EACH ROW EXECUTE FUNCTION public.phase8_touch_updated_at();

DROP TRIGGER IF EXISTS dtn_touch ON public.digital_twin_nodes;
CREATE TRIGGER dtn_touch BEFORE UPDATE ON public.digital_twin_nodes FOR EACH ROW EXECUTE FUNCTION public.phase8_touch_updated_at();
