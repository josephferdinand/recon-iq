
ALTER TABLE public.marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_kind_check;
ALTER TABLE public.marketplace_listings ADD CONSTRAINT marketplace_listings_kind_check
  CHECK (kind = ANY (ARRAY[
    'recon_template','data_prep_pipeline','connector_config','rule_pack','dashboard',
    'regulatory_pack','aml_pack','compliance_pack','workflow','report','persona',
    'parser','runbook','preset','email_template','industry_pack','starter_kit'
  ]));

ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'public';
ALTER TABLE public.marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_channel_check;
ALTER TABLE public.marketplace_listings ADD CONSTRAINT marketplace_listings_channel_check
  CHECK (channel = ANY (ARRAY['public','private','enterprise']));
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS tenant_scope uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.marketplace_listings ADD COLUMN IF NOT EXISTS legacy_mkt_template_id uuid;
CREATE INDEX IF NOT EXISTS idx_marketplace_channel ON public.marketplace_listings(channel);
CREATE INDEX IF NOT EXISTS idx_marketplace_tenant_scope ON public.marketplace_listings USING gin(tenant_scope);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_legacy_mkt ON public.marketplace_listings(legacy_mkt_template_id) WHERE legacy_mkt_template_id IS NOT NULL;

INSERT INTO public.marketplace_listings (
  slug, title, kind, tier, publisher, summary, description, version, payload,
  tags, status, install_count, rating_avg, rating_count, published_at,
  publisher_verified, moderation_state, channel, legacy_mkt_template_id
)
SELECT
  'mkt-' || t.slug,
  t.title,
  CASE
    WHEN t.pack_type::text IN ('industry','industry_pack') THEN 'industry_pack'
    WHEN t.pack_type::text IN ('regulatory','regulatory_pack') THEN 'regulatory_pack'
    WHEN t.pack_type::text IN ('aml','aml_pack') THEN 'aml_pack'
    WHEN t.pack_type::text IN ('compliance','compliance_pack') THEN 'compliance_pack'
    WHEN t.pack_type::text IN ('recon','reconciliation','recon_template') THEN 'recon_template'
    WHEN t.pack_type::text IN ('workflow') THEN 'workflow'
    WHEN t.pack_type::text IN ('report','reporting') THEN 'report'
    WHEN t.pack_type::text IN ('persona','copilot','copilot_persona') THEN 'persona'
    WHEN t.pack_type::text IN ('parser') THEN 'parser'
    WHEN t.pack_type::text IN ('runbook') THEN 'runbook'
    WHEN t.pack_type::text IN ('preset') THEN 'preset'
    WHEN t.pack_type::text IN ('email','email_template') THEN 'email_template'
    ELSE 'starter_kit'
  END,
  CASE t.certification::text
    WHEN 'certified' THEN 'official'
    WHEN 'partner' THEN 'partner'
    ELSE 'community'
  END,
  'FVI Marketplace',
  t.summary, t.description, '1.0.0',
  jsonb_build_object(
    'industries', t.industries, 'regions', t.regions, 'standards', t.standards,
    'pack_type', t.pack_type, 'certification_score', t.certification_score,
    'ai_score', t.ai_score, 'governance_score', t.governance_score
  ),
  COALESCE(t.tags, '{}'),
  CASE
    WHEN t.retired_at IS NOT NULL THEN 'deprecated'
    WHEN t.certification::text = 'draft' THEN 'draft'
    ELSE 'published'
  END,
  COALESCE(t.install_count, 0),
  NULLIF(t.avg_rating, 0),
  0,
  t.created_at,
  (t.certification::text IN ('certified','partner')),
  'visible', 'public', t.id
FROM public.mkt_templates t
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketplace_listings ml WHERE ml.legacy_mkt_template_id = t.id
)
ON CONFLICT (slug) DO NOTHING;

DROP VIEW IF EXISTS public.v_marketplace_analytics;
DROP VIEW IF EXISTS public.v_marketplace_ratings_unified;

CREATE VIEW public.v_marketplace_ratings_unified
WITH (security_invoker = true) AS
SELECT mr.id, mr.listing_id, mr.tenant_id, mr.user_id,
       mr.rating AS stars, mr.review, mr.created_at, 'canonical'::text AS source
FROM public.marketplace_ratings mr
UNION ALL
SELECT mtr.id, ml.id AS listing_id, mtr.tenant_id, mtr.user_id,
       mtr.stars, mtr.review, mtr.created_at, 'legacy_mkt'::text AS source
FROM public.mkt_template_ratings mtr
JOIN public.marketplace_listings ml ON ml.legacy_mkt_template_id = mtr.template_id;

GRANT SELECT ON public.v_marketplace_ratings_unified TO authenticated;

CREATE VIEW public.v_marketplace_analytics
WITH (security_invoker = true) AS
SELECT
  ml.id                                          AS listing_id,
  ml.slug, ml.title, ml.kind, ml.tier, ml.channel, ml.status, ml.install_count,
  COUNT(DISTINCT mi.tenant_id)                   AS installed_tenants,
  COUNT(DISTINCT wtu.workspace_id)               AS active_workspaces,
  COUNT(wtu.id)                                  AS usage_events,
  COALESCE(AVG(vru.stars)::numeric(3,2), NULL)   AS rating_avg,
  COUNT(vru.id)                                  AS rating_count,
  MAX(mi.installed_at)                           AS last_installed_at,
  MAX(wtu.created_at)                            AS last_used_at
FROM public.marketplace_listings ml
LEFT JOIN public.marketplace_installs mi
  ON mi.listing_id = ml.id
LEFT JOIN public.tenant_templates tt
  ON tt.source_template_id = ml.legacy_mkt_template_id
LEFT JOIN public.workspace_template_usage wtu
  ON wtu.tenant_template_id = tt.id
LEFT JOIN public.v_marketplace_ratings_unified vru
  ON vru.listing_id = ml.id
GROUP BY ml.id, ml.slug, ml.title, ml.kind, ml.tier, ml.channel, ml.status, ml.install_count;

GRANT SELECT ON public.v_marketplace_analytics TO authenticated;
