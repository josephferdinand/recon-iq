INSERT INTO public.tenant_families (id, name, release_identity_uid, canonical_legal_name)
VALUES (
  'd1000000-0000-4000-8000-000000000001',
  'Theme Migration Evidence Family',
  'd1000000-0000-4000-8000-000000000003',
  'Theme Migration Evidence Family'
);

INSERT INTO public.tenants (id, family_id, slug, name, environment)
VALUES (
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'theme-migration-evidence',
  'Theme Migration Evidence',
  'dev'
);

INSERT INTO public.tenant_theme_settings (
  tenant_id, palette_id, side_chrome_id, top_chrome_id, dual_mode
)
VALUES (
  'd1000000-0000-4000-8000-000000000002',
  'cloud-white',
  'midnight',
  'mint-light',
  true
);
