
CREATE TABLE public.streaming_topics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  source text not null,        -- 'kafka','kinesis','pubsub','cdc-postgres','cdc-mysql','eventbridge'
  bootstrap text,
  topic_path text,
  format text not null default 'json' check (format in ('json','avro','protobuf','cloudevents','iso20022-xml')),
  partition_key text,
  expected_tps int,
  last_offset text,
  last_seen_at timestamptz,
  status text not null default 'configured' check (status in ('configured','active','paused','error')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streaming_topics TO authenticated;
GRANT ALL ON public.streaming_topics TO service_role;
ALTER TABLE public.streaming_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stream read" ON public.streaming_topics FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "stream write" ON public.streaming_topics FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_stream_updated BEFORE UPDATE ON public.streaming_topics FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_stream_tenant ON public.streaming_topics(tenant_id);

CREATE TABLE public.streaming_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  topic_id uuid not null references public.streaming_topics(id) on delete cascade,
  recon_definition_id uuid references public.recon_definitions(id) on delete cascade,
  side_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streaming_subscriptions TO authenticated;
GRANT ALL ON public.streaming_subscriptions TO service_role;
ALTER TABLE public.streaming_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stream sub read" ON public.streaming_subscriptions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "stream sub write" ON public.streaming_subscriptions FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.dr_regions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  cloud text not null,             -- aws, gcp, azure
  geography text not null,         -- EU, US, UK, APAC
  is_active boolean not null default true,
  is_primary boolean not null default false,
  rpo_seconds int not null default 60,
  rto_seconds int not null default 900,
  created_at timestamptz not null default now()
);
GRANT SELECT ON public.dr_regions TO authenticated;
GRANT ALL ON public.dr_regions TO service_role;
ALTER TABLE public.dr_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dr read" ON public.dr_regions FOR SELECT TO authenticated USING (true);
CREATE POLICY "dr admin write" ON public.dr_regions FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE TABLE public.tenant_data_residency (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  primary_region_code text not null references public.dr_regions(code),
  secondary_region_code text references public.dr_regions(code),
  active_active boolean not null default false,
  pinned_pii boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_data_residency TO authenticated;
GRANT ALL ON public.tenant_data_residency TO service_role;
ALTER TABLE public.tenant_data_residency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "residency read" ON public.tenant_data_residency FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "residency write" ON public.tenant_data_residency FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_residency_updated BEFORE UPDATE ON public.tenant_data_residency FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.byok_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  alias text not null,
  provider text not null check (provider in ('aws-kms','gcp-kms','azure-kv','hashicorp-vault','thales-hsm')),
  key_arn text not null,
  algorithm text not null default 'AES_256',
  mode text not null default 'BYOK' check (mode in ('BYOK','HYOK')),
  status text not null default 'active' check (status in ('active','rotating','revoked')),
  last_rotated_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.byok_keys TO authenticated;
GRANT ALL ON public.byok_keys TO service_role;
ALTER TABLE public.byok_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "byok read" ON public.byok_keys FOR SELECT TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE POLICY "byok write" ON public.byok_keys FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE TRIGGER tg_byok_updated BEFORE UPDATE ON public.byok_keys FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.platform_benchmarks (
  id uuid primary key default gen_random_uuid(),
  metric text not null,
  asset_class text not null,
  percentile_25 numeric,
  percentile_50 numeric,
  percentile_75 numeric,
  percentile_95 numeric,
  unit text,
  cohort text,                    -- e.g. 'Tier-1 banks', 'Mid-size asset manager'
  window_start date,
  window_end date,
  updated_at timestamptz not null default now()
);
GRANT SELECT ON public.platform_benchmarks TO authenticated;
GRANT ALL ON public.platform_benchmarks TO service_role;
ALTER TABLE public.platform_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bench read" ON public.platform_benchmarks FOR SELECT TO authenticated USING (true);
CREATE POLICY "bench admin write" ON public.platform_benchmarks FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

INSERT INTO public.dr_regions (code, name, cloud, geography, is_primary) VALUES
 ('eu-west-1','EU (Ireland)','aws','EU',true),
 ('eu-central-1','EU (Frankfurt)','aws','EU',false),
 ('us-east-1','US East (N. Virginia)','aws','US',false),
 ('us-west-2','US West (Oregon)','aws','US',false),
 ('uk-south','UK South','azure','UK',false),
 ('ap-southeast-1','APAC (Singapore)','aws','APAC',false),
 ('ap-northeast-1','APAC (Tokyo)','aws','APAC',false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.platform_benchmarks (metric, asset_class, percentile_25, percentile_50, percentile_75, percentile_95, unit, cohort) VALUES
 ('auto_match_rate','cash',92,96.5,98.2,99.4,'percent','Tier-1 banks'),
 ('mttr_minutes','cash',45,18,9,3,'minutes','Tier-1 banks'),
 ('auto_match_rate','securities',88,94.1,97.0,99.0,'percent','Asset managers'),
 ('mttr_minutes','securities',95,38,15,6,'minutes','Asset managers'),
 ('auto_match_rate','derivatives',74,86.0,93.4,98.1,'percent','Sell-side derivs'),
 ('auto_match_rate','collateral',82,90.0,95.5,98.4,'percent','Triparty agents'),
 ('auto_match_rate','payments',91,96.8,98.6,99.5,'percent','PSPs / Payments'),
 ('auto_match_rate','cards',93,97.5,98.9,99.6,'percent','Card issuers / acquirers')
ON CONFLICT DO NOTHING;
