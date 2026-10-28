-- Consolidate tenant themes to the owner-approved four canvas/four chrome catalogue.

ALTER TABLE public.tenant_theme_settings
  DROP CONSTRAINT IF EXISTS tenant_theme_settings_palette_id_check,
  DROP CONSTRAINT IF EXISTS tenant_theme_settings_side_chrome_id_check,
  DROP CONSTRAINT IF EXISTS tenant_theme_settings_top_chrome_id_check;

UPDATE public.tenant_theme_settings
SET palette_id = CASE palette_id
  WHEN 'porcelain' THEN 'porcelain'
  WHEN 'cloudy-mist' THEN 'cloudy-mist'
  WHEN 'arctic-frost' THEN 'arctic-frost'
  WHEN 'coffee-warm-sand' THEN 'coffee-warm-sand'
  WHEN 'cloud-white' THEN 'porcelain'
  WHEN 'paper-ink' THEN 'porcelain'
  WHEN 'warm-sand' THEN 'coffee-warm-sand'
  WHEN 'coffee-cream' THEN 'coffee-warm-sand'
  WHEN 'cream-amber' THEN 'coffee-warm-sand'
  WHEN 'sage-bone' THEN 'cloudy-mist'
  WHEN 'rose-quartz' THEN 'cloudy-mist'
  ELSE 'porcelain'
END;

UPDATE public.tenant_theme_settings
SET side_chrome_id = CASE side_chrome_id
  WHEN 'navy' THEN 'navy'
  WHEN 'graphite' THEN 'graphite'
  WHEN 'sapphire' THEN 'sapphire'
  WHEN 'forest' THEN 'forest'
  WHEN 'midnight' THEN 'sapphire'
  WHEN 'slate' THEN 'sapphire'
  WHEN 'sky-light' THEN 'sapphire'
  WHEN 'sage-light' THEN 'forest'
  WHEN 'mint-light' THEN 'forest'
  WHEN 'charcoal' THEN 'graphite'
  WHEN 'pearl' THEN 'graphite'
  WHEN 'mist' THEN 'graphite'
  WHEN 'crimson' THEN 'graphite'
  WHEN 'plum' THEN 'graphite'
  WHEN 'blush' THEN 'graphite'
  ELSE 'navy'
END,
top_chrome_id = CASE top_chrome_id
  WHEN 'navy' THEN 'navy'
  WHEN 'graphite' THEN 'graphite'
  WHEN 'sapphire' THEN 'sapphire'
  WHEN 'forest' THEN 'forest'
  WHEN 'midnight' THEN 'sapphire'
  WHEN 'slate' THEN 'sapphire'
  WHEN 'sky-light' THEN 'sapphire'
  WHEN 'sage-light' THEN 'forest'
  WHEN 'mint-light' THEN 'forest'
  WHEN 'charcoal' THEN 'graphite'
  WHEN 'pearl' THEN 'graphite'
  WHEN 'mist' THEN 'graphite'
  WHEN 'crimson' THEN 'graphite'
  WHEN 'plum' THEN 'graphite'
  WHEN 'blush' THEN 'graphite'
  ELSE 'navy'
END;

ALTER TABLE public.tenant_theme_settings
  ALTER COLUMN palette_id SET DEFAULT 'porcelain',
  ALTER COLUMN side_chrome_id SET DEFAULT 'navy',
  ALTER COLUMN top_chrome_id SET DEFAULT 'navy',
  ADD CONSTRAINT tenant_theme_settings_palette_id_check
    CHECK (palette_id IN ('porcelain','cloudy-mist','arctic-frost','coffee-warm-sand')),
  ADD CONSTRAINT tenant_theme_settings_side_chrome_id_check
    CHECK (side_chrome_id IN ('navy','graphite','sapphire','forest')),
  ADD CONSTRAINT tenant_theme_settings_top_chrome_id_check
    CHECK (top_chrome_id IN ('navy','graphite','sapphire','forest'));

INSERT INTO public.audit_log (
  actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
)
SELECT NULL, tts.tenant_id, 'system', 'tenant.theme.catalog_migrated',
       'tenant_theme_settings', tts.tenant_id::text,
       jsonb_build_object('palette_id', tts.palette_id,
                          'side_chrome_id', tts.side_chrome_id,
                          'top_chrome_id', tts.top_chrome_id,
                          'catalog_version', '2026-09-13')
FROM public.tenant_theme_settings tts;
