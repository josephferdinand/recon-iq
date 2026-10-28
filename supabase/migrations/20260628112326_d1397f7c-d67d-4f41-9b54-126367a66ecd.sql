
-- =====================================================================
-- 1) recon_match_allocations  (N-to-M proportional split tracking)
-- =====================================================================
CREATE TABLE public.recon_match_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  match_id uuid NOT NULL REFERENCES public.recon_matches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('left','right')),
  original_amount numeric(28,8) NOT NULL,
  allocated_amount numeric(28,8) NOT NULL,
  ratio numeric(18,12) NOT NULL,
  residual numeric(28,8) NOT NULL DEFAULT 0,
  currency text,
  method text NOT NULL DEFAULT 'proportional' CHECK (method IN ('proportional','weighted','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_alloc_match ON public.recon_match_allocations(match_id);
CREATE INDEX idx_match_alloc_tenant ON public.recon_match_allocations(tenant_id);
CREATE INDEX idx_match_alloc_item ON public.recon_match_allocations(item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_match_allocations TO authenticated;
GRANT ALL ON public.recon_match_allocations TO service_role;

ALTER TABLE public.recon_match_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read allocations"
  ON public.recon_match_allocations FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant admins write allocations"
  ON public.recon_match_allocations FOR ALL TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_member(auth.uid(), tenant_id));

-- =====================================================================
-- 2) fx_rates  (pluggable FX feed; locked rates prevent retroactive drift)
-- =====================================================================
CREATE TABLE public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric(28,12) NOT NULL CHECK (rate > 0),
  as_of_date date NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  locked boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, base_currency, quote_currency, as_of_date)
);
CREATE INDEX idx_fx_rates_lookup ON public.fx_rates(tenant_id, base_currency, quote_currency, as_of_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read fx_rates"
  ON public.fx_rates FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant admins write fx_rates"
  ON public.fx_rates FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

-- =====================================================================
-- 3) Extend recon_tolerance_ladders (multi-dimensional)
-- =====================================================================
ALTER TABLE public.recon_tolerance_ladders
  ADD COLUMN IF NOT EXISTS counterparty text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS normalize_currency text,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_to date;

CREATE INDEX IF NOT EXISTS idx_tol_ladder_resolution
  ON public.recon_tolerance_ladders(recon_id, field_name, priority DESC);

-- =====================================================================
-- 4) market_calendars + market_holidays  (T+n settlement awareness)
-- =====================================================================
CREATE TABLE public.market_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,  -- NULL = platform-global preset
  mic_code text NOT NULL,
  name text NOT NULL,
  weekends integer[] NOT NULL DEFAULT ARRAY[0,6],  -- 0=Sun, 6=Sat
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mic_code)
);
CREATE INDEX idx_market_cal_mic ON public.market_calendars(mic_code);

GRANT SELECT ON public.market_calendars TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_calendars TO authenticated;
GRANT ALL ON public.market_calendars TO service_role;
ALTER TABLE public.market_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all read market_calendars (global + tenant)"
  ON public.market_calendars FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant admins write market_calendars"
  ON public.market_calendars FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

CREATE TABLE public.market_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES public.market_calendars(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, holiday_date)
);
CREATE INDEX idx_market_holiday_cal ON public.market_holidays(calendar_id, holiday_date);

GRANT SELECT ON public.market_holidays TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_holidays TO authenticated;
GRANT ALL ON public.market_holidays TO service_role;
ALTER TABLE public.market_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read market_holidays via calendar"
  ON public.market_holidays FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.market_calendars c
    WHERE c.id = calendar_id
      AND (c.tenant_id IS NULL OR public.is_tenant_member(auth.uid(), c.tenant_id))
  ));

CREATE POLICY "tenant admins write market_holidays"
  ON public.market_holidays FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.market_calendars c
    WHERE c.id = calendar_id
      AND c.tenant_id IS NOT NULL
      AND public.has_tenant_role(auth.uid(), c.tenant_id, 'tenant_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.market_calendars c
    WHERE c.id = calendar_id
      AND c.tenant_id IS NOT NULL
      AND public.has_tenant_role(auth.uid(), c.tenant_id, 'tenant_admin')
  ));

-- =====================================================================
-- 5) recon_ml_models  (per-recon logistic regression with versions)
-- =====================================================================
CREATE TABLE public.recon_ml_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  version integer NOT NULL,
  algorithm text NOT NULL DEFAULT 'logistic_regression',
  weights jsonb NOT NULL,
  bias numeric NOT NULL DEFAULT 0,
  feature_names text[] NOT NULL,
  training_rows integer NOT NULL DEFAULT 0,
  accuracy numeric(5,4),
  precision_score numeric(5,4),
  recall_score numeric(5,4),
  auto_above numeric(3,2) NOT NULL DEFAULT 0.85,
  propose_above numeric(3,2) NOT NULL DEFAULT 0.55,
  reject_below numeric(3,2) NOT NULL DEFAULT 0.20,
  is_active boolean NOT NULL DEFAULT false,
  trained_at timestamptz NOT NULL DEFAULT now(),
  trained_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recon_id, version)
);
CREATE INDEX idx_ml_models_active ON public.recon_ml_models(recon_id) WHERE is_active = true;
CREATE INDEX idx_ml_models_tenant ON public.recon_ml_models(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_ml_models TO authenticated;
GRANT ALL ON public.recon_ml_models TO service_role;
ALTER TABLE public.recon_ml_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read ml_models"
  ON public.recon_ml_models FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant admins write ml_models"
  ON public.recon_ml_models FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

-- =====================================================================
-- 6) recon_carry_forward  (unmatched item aging across cycles)
-- =====================================================================
CREATE TABLE public.recon_carry_forward (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  item_hash text NOT NULL,
  side text NOT NULL CHECK (side IN ('left','right')),
  first_seen_run_id uuid,
  last_seen_run_id uuid,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  carry_count integer NOT NULL DEFAULT 1,
  aging_bucket text NOT NULL DEFAULT '0-1d',
  escalated boolean NOT NULL DEFAULT false,
  escalation_level integer NOT NULL DEFAULT 0,
  payload_snapshot jsonb,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recon_id, item_hash, side)
);
CREATE INDEX idx_carry_fwd_tenant ON public.recon_carry_forward(tenant_id);
CREATE INDEX idx_carry_fwd_recon ON public.recon_carry_forward(recon_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_carry_fwd_bucket ON public.recon_carry_forward(aging_bucket) WHERE resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_carry_forward TO authenticated;
GRANT ALL ON public.recon_carry_forward TO service_role;
ALTER TABLE public.recon_carry_forward ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read carry_forward"
  ON public.recon_carry_forward FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant admins write carry_forward"
  ON public.recon_carry_forward FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

-- =====================================================================
-- 7) Extend recon_matches & recon_runs
-- =====================================================================
ALTER TABLE public.recon_matches
  ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'one_to_one'
    CHECK (match_type IN ('one_to_one','one_to_many','many_to_one','many_to_many')),
  ADD COLUMN IF NOT EXISTS tolerance_trace jsonb,
  ADD COLUMN IF NOT EXISTS ml_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS ml_model_version integer,
  ADD COLUMN IF NOT EXISTS pass_path integer[];

ALTER TABLE public.recon_runs
  ADD COLUMN IF NOT EXISTS cascade_telemetry jsonb;

ALTER TABLE public.recon_cascade_passes
  ADD COLUMN IF NOT EXISTS outcome_policy text NOT NULL DEFAULT 'auto_match'
    CHECK (outcome_policy IN ('auto_match','propose_for_review','tag_only','route_to_exception'));

-- =====================================================================
-- 8) updated_at triggers
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_market_calendars_touch
  BEFORE UPDATE ON public.market_calendars
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TRIGGER trg_carry_forward_touch
  BEFORE UPDATE ON public.recon_carry_forward
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =====================================================================
-- 9) Seed G10 platform-global calendars (tenant_id = NULL)
-- =====================================================================
INSERT INTO public.market_calendars (tenant_id, mic_code, name, timezone) VALUES
  (NULL, 'XNYS', 'New York Stock Exchange', 'America/New_York'),
  (NULL, 'XLON', 'London Stock Exchange',   'Europe/London'),
  (NULL, 'XPAR', 'Euronext Paris',          'Europe/Paris'),
  (NULL, 'XFRA', 'Deutsche Boerse',         'Europe/Berlin'),
  (NULL, 'XTKS', 'Tokyo Stock Exchange',    'Asia/Tokyo'),
  (NULL, 'XHKG', 'Hong Kong Exchange',      'Asia/Hong_Kong'),
  (NULL, 'XSWX', 'SIX Swiss Exchange',      'Europe/Zurich'),
  (NULL, 'XTSE', 'Toronto Stock Exchange',  'America/Toronto'),
  (NULL, 'XASX', 'Australian Securities Exchange', 'Australia/Sydney'),
  (NULL, 'XSTO', 'Nasdaq Stockholm',        'Europe/Stockholm')
ON CONFLICT DO NOTHING;

-- US (XNYS) 2026-2027
INSERT INTO public.market_holidays (calendar_id, holiday_date, name)
SELECT id, d::date, n FROM public.market_calendars,
  LATERAL (VALUES
    ('2026-01-01','New Year''s Day'),
    ('2026-01-19','Martin Luther King Jr. Day'),
    ('2026-02-16','Presidents'' Day'),
    ('2026-04-03','Good Friday'),
    ('2026-05-25','Memorial Day'),
    ('2026-06-19','Juneteenth'),
    ('2026-07-03','Independence Day (observed)'),
    ('2026-09-07','Labor Day'),
    ('2026-11-26','Thanksgiving'),
    ('2026-12-25','Christmas Day'),
    ('2027-01-01','New Year''s Day'),
    ('2027-01-18','Martin Luther King Jr. Day'),
    ('2027-02-15','Presidents'' Day'),
    ('2027-03-26','Good Friday'),
    ('2027-05-31','Memorial Day'),
    ('2027-06-18','Juneteenth (observed)'),
    ('2027-07-05','Independence Day (observed)'),
    ('2027-09-06','Labor Day'),
    ('2027-11-25','Thanksgiving'),
    ('2027-12-24','Christmas Day (observed)')
  ) AS h(d,n)
WHERE mic_code='XNYS' AND tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- UK (XLON) 2026-2027
INSERT INTO public.market_holidays (calendar_id, holiday_date, name)
SELECT id, d::date, n FROM public.market_calendars,
  LATERAL (VALUES
    ('2026-01-01','New Year''s Day'),
    ('2026-04-03','Good Friday'),
    ('2026-04-06','Easter Monday'),
    ('2026-05-04','Early May Bank Holiday'),
    ('2026-05-25','Spring Bank Holiday'),
    ('2026-08-31','Summer Bank Holiday'),
    ('2026-12-25','Christmas Day'),
    ('2026-12-28','Boxing Day (observed)'),
    ('2027-01-01','New Year''s Day'),
    ('2027-03-26','Good Friday'),
    ('2027-03-29','Easter Monday'),
    ('2027-05-03','Early May Bank Holiday'),
    ('2027-05-31','Spring Bank Holiday'),
    ('2027-08-30','Summer Bank Holiday'),
    ('2027-12-27','Christmas Day (observed)'),
    ('2027-12-28','Boxing Day (observed)')
  ) AS h(d,n)
WHERE mic_code='XLON' AND tenant_id IS NULL
ON CONFLICT DO NOTHING;

-- EU TARGET (XPAR/XFRA) — share common Eurosystem holidays
INSERT INTO public.market_holidays (calendar_id, holiday_date, name)
SELECT id, d::date, n FROM public.market_calendars,
  LATERAL (VALUES
    ('2026-01-01','New Year''s Day'),
    ('2026-04-03','Good Friday'),
    ('2026-04-06','Easter Monday'),
    ('2026-05-01','Labour Day'),
    ('2026-12-25','Christmas Day'),
    ('2026-12-26','Boxing Day'),
    ('2027-01-01','New Year''s Day'),
    ('2027-03-26','Good Friday'),
    ('2027-03-29','Easter Monday'),
    ('2027-05-01','Labour Day'),
    ('2027-12-27','Christmas Day (observed)'),
    ('2027-12-28','Boxing Day (observed)')
  ) AS h(d,n)
WHERE mic_code IN ('XPAR','XFRA') AND tenant_id IS NULL
ON CONFLICT DO NOTHING;
