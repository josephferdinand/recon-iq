DO $$
DECLARE
  migrated public.tenant_theme_settings%ROWTYPE;
  default_palette text;
BEGIN
  SELECT * INTO migrated
  FROM public.tenant_theme_settings
  WHERE tenant_id = 'd1000000-0000-4000-8000-000000000002'::uuid;

  IF NOT FOUND OR migrated.palette_id <> 'porcelain'
    OR migrated.side_chrome_id <> 'sapphire'
    OR migrated.top_chrome_id <> 'forest' THEN
    RAISE EXCEPTION 'legacy theme row did not migrate deterministically';
  END IF;

  SELECT column_default INTO default_palette
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tenant_theme_settings'
    AND column_name = 'palette_id';
  IF default_palette NOT LIKE '%porcelain%' THEN
    RAISE EXCEPTION 'porcelain is not the database default';
  END IF;

  BEGIN
    UPDATE public.tenant_theme_settings
    SET palette_id = 'cloud-white'
    WHERE tenant_id = migrated.tenant_id;
    RAISE EXCEPTION 'legacy palette unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.tenant_theme_settings
    SET side_chrome_id = 'midnight'
    WHERE tenant_id = migrated.tenant_id;
    RAISE EXCEPTION 'legacy chrome unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE tenant_id = migrated.tenant_id
      AND action = 'tenant.theme.catalog_migrated'
  ) THEN
    RAISE EXCEPTION 'theme migration audit evidence missing';
  END IF;
END;
$$;

SELECT 'theme_consolidation_PASS palette=porcelain side=sapphire top=forest constraints=yes audit=yes' AS result;
