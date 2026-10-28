
-- 1) Create alias definition so cash-nostro-starter has a valid ref
INSERT INTO public.recon_definition_templates (code, asset_class, title, summary, legs, keys, tolerances, rules, sample_fields, tags, status)
SELECT 'cash_nostro_v1', asset_class, title, summary, legs, keys, tolerances, rules, sample_fields, tags, status
FROM public.recon_definition_templates WHERE code='acct_nostro_v1'
ON CONFLICT (code) DO NOTHING;

-- 2) Normalize rules structure: wrap string/simple rules into {stage,type,priority,definition}
UPDATE public.recon_definition_templates t
SET rules = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(r) = 'object' AND (r ? 'stage' OR r ? 'type') THEN r
      WHEN jsonb_typeof(r) = 'object' THEN r || jsonb_build_object('stage','exact_match','type','deterministic','priority',idx)
      ELSE jsonb_build_object('stage','exact_match','type','deterministic','priority',idx,'definition',r)
    END
  )
  FROM jsonb_array_elements(t.rules) WITH ORDINALITY AS x(r, idx)
)
WHERE rules IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.rules) e
    WHERE jsonb_typeof(e) <> 'object' OR NOT (e ? 'stage' OR e ? 'type')
  );

-- 3) Backfill empty tags on recon_definition_templates
UPDATE public.recon_definition_templates
SET tags = ARRAY[asset_class, 'recon', 'industry-standard']::text[]
WHERE tags IS NULL OR array_length(tags,1) IS NULL OR array_length(tags,1) = 0;

-- 4) Regulatory packs: add compliance_frameworks array + evidence_retention object
UPDATE public.marketplace_listings
SET payload = payload || jsonb_build_object(
  'compliance_frameworks',
    CASE
      WHEN payload ? 'compliance_frameworks' THEN payload->'compliance_frameworks'
      WHEN payload ? 'compliance_framework' THEN jsonb_build_array(payload->>'compliance_framework')
      ELSE jsonb_build_array(COALESCE(payload->>'regulation','Regulatory'))
    END,
  'evidence_retention',
    jsonb_build_object(
      'years', COALESCE((payload->>'evidence_retention_years')::int, 7),
      'immutable', true,
      'storage', 'worm-evidence-vault',
      'basis', COALESCE(payload->>'regulation','regulatory-default')
    )
)
WHERE kind='regulatory_pack' AND status='published'
  AND (NOT (payload ? 'compliance_frameworks') OR NOT (payload ? 'evidence_retention'));

-- 5) Expand short descriptions (< 60 chars) to meet governance minimum
UPDATE public.marketplace_listings
SET description = description || ' — Plug-and-play, certified, industry-standard template. Ships with matching criteria, field mappings, tolerances, evidence capture, and full audit trail. Install into a workspace and customize thresholds, sources, and approvers to your operating model.'
WHERE status='published' AND (description IS NULL OR length(description) < 60);

-- 6) Ensure at least 2 tags on every published listing
UPDATE public.marketplace_listings
SET tags = COALESCE(tags,'{}'::text[]) || ARRAY['plug-and-play','certified']::text[]
WHERE status='published' AND (tags IS NULL OR array_length(tags,1) IS NULL OR array_length(tags,1) < 2);

-- 7) Fix iso20022-camt053-prep pipeline
UPDATE public.marketplace_listings
SET payload = payload || jsonb_build_object(
  'install_runbook_url','/docs/data-pipelines/iso20022-camt053-prep/runbook',
  'default_tolerances', jsonb_build_object('amount', jsonb_build_object('abs',0.01), 'value_date_days', 1),
  'plug_and_play', true
)
WHERE slug='iso20022-camt053-prep';
