
-- ============================================================
-- Brand profile (singleton — is_active = true for the active row)
-- ============================================================
CREATE TABLE public.mkt_brand_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active BOOLEAN NOT NULL DEFAULT false,

  company_name TEXT,
  trading_name TEXT,
  brand_name TEXT,
  short_name TEXT,
  platform_name TEXT,
  product_name TEXT,
  product_suite_name TEXT,

  tagline TEXT,
  motto TEXT,
  mission_statement TEXT,
  vision_statement TEXT,

  website_url TEXT,
  support_url TEXT,
  help_center_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Application identity
  browser_tab_name TEXT,
  page_title_template TEXT,
  application_name TEXT,
  header_branding TEXT,
  footer_branding TEXT,
  copyright_text TEXT,
  legal_notices TEXT,
  powered_by_text TEXT,
  show_version BOOLEAN NOT NULL DEFAULT false,

  -- Login / auth branding
  login_welcome_message TEXT,
  login_background_url TEXT,
  login_page_theme TEXT,
  password_reset_message TEXT,
  registration_message TEXT,

  -- Communications branding
  email_signature_html TEXT,
  email_legal_disclaimer TEXT,
  email_footer_text TEXT,

  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TIMESTAMPTZ,
  published_by UUID,

  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mkt_brand_profile_one_active
  ON public.mkt_brand_profile (is_active) WHERE is_active = true;

GRANT SELECT ON public.mkt_brand_profile TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_brand_profile TO authenticated;
GRANT ALL ON public.mkt_brand_profile TO service_role;

ALTER TABLE public.mkt_brand_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_profile_public_read ON public.mkt_brand_profile
  FOR SELECT USING (is_active = true AND status = 'published');

CREATE POLICY brand_profile_admin_read ON public.mkt_brand_profile
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY brand_profile_admin_write ON public.mkt_brand_profile
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- ============================================================
-- Brand assets — versioned logo/asset library keyed by slot
-- ============================================================
CREATE TABLE public.mkt_brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot TEXT NOT NULL CHECK (slot IN (
    'primary_logo','secondary_logo','dark_logo','light_logo',
    'login_logo','mobile_logo','favicon','email_header_logo',
    'email_footer_logo','document_watermark','partner_logo','white_label_logo'
  )),
  variant TEXT,                          -- optional (e.g. "mobile-2x")
  storage_path TEXT NOT NULL,            -- key inside brand-assets bucket
  public_url TEXT NOT NULL,              -- full URL used at render time
  content_type TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  is_published BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mkt_brand_assets_slot ON public.mkt_brand_assets(slot);
CREATE UNIQUE INDEX mkt_brand_assets_one_published_per_slot
  ON public.mkt_brand_assets(slot) WHERE is_published = true;

GRANT SELECT ON public.mkt_brand_assets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_brand_assets TO authenticated;
GRANT ALL ON public.mkt_brand_assets TO service_role;

ALTER TABLE public.mkt_brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_assets_public_read ON public.mkt_brand_assets
  FOR SELECT USING (is_published = true);

CREATE POLICY brand_assets_admin_all ON public.mkt_brand_assets
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- ============================================================
-- Brand history — every mutation logged for audit + rollback
-- ============================================================
CREATE TABLE public.mkt_brand_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity TEXT NOT NULL CHECK (entity IN ('profile','asset','identity','communications','login','white_label')),
  entity_id UUID,
  action TEXT NOT NULL CHECK (action IN ('create','update','publish','rollback','delete','upload')),
  actor_user_id UUID,
  actor_email TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mkt_brand_history_entity ON public.mkt_brand_history(entity, created_at DESC);

GRANT SELECT, INSERT ON public.mkt_brand_history TO authenticated;
GRANT ALL ON public.mkt_brand_history TO service_role;

ALTER TABLE public.mkt_brand_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_history_admin_read ON public.mkt_brand_history
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY brand_history_admin_write ON public.mkt_brand_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- ============================================================
-- Storage policies for brand-assets bucket (private bucket, public read via RLS)
-- ============================================================
CREATE POLICY brand_assets_storage_read ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-assets');

CREATE POLICY brand_assets_storage_admin_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-assets' AND public.is_platform_admin(auth.uid()));

CREATE POLICY brand_assets_storage_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_platform_admin(auth.uid()))
  WITH CHECK (bucket_id = 'brand-assets' AND public.is_platform_admin(auth.uid()));

CREATE POLICY brand_assets_storage_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_platform_admin(auth.uid()));

-- ============================================================
-- updated_at trigger (reuse or define locally)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mkt_brand_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_mkt_brand_profile_touch
  BEFORE UPDATE ON public.mkt_brand_profile
  FOR EACH ROW EXECUTE FUNCTION public.mkt_brand_touch_updated_at();

CREATE TRIGGER trg_mkt_brand_assets_touch
  BEFORE UPDATE ON public.mkt_brand_assets
  FOR EACH ROW EXECUTE FUNCTION public.mkt_brand_touch_updated_at();

-- Seed one empty active draft so admin UI has a row to edit.
INSERT INTO public.mkt_brand_profile (is_active, status, product_name, application_name)
VALUES (true, 'draft', 'FVI', 'FVI Platform');
