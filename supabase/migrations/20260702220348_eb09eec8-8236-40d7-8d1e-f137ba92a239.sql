
CREATE TABLE public.mkt_homepage_sections (
  section_key TEXT NOT NULL PRIMARY KEY,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT ON public.mkt_homepage_sections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_homepage_sections TO authenticated;
GRANT ALL ON public.mkt_homepage_sections TO service_role;

ALTER TABLE public.mkt_homepage_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read homepage sections"
  ON public.mkt_homepage_sections FOR SELECT
  USING (true);

CREATE POLICY "Mkt admins can manage homepage sections"
  ON public.mkt_homepage_sections FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mkt_admin_roles r
    WHERE r.user_id = auth.uid()
      AND r.role IN ('super_admin','marketing_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mkt_admin_roles r
    WHERE r.user_id = auth.uid()
      AND r.role IN ('super_admin','marketing_admin')
  ));

CREATE OR REPLACE FUNCTION public.mkt_homepage_sections_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mkt_homepage_sections_updated_at
  BEFORE UPDATE ON public.mkt_homepage_sections
  FOR EACH ROW EXECUTE FUNCTION public.mkt_homepage_sections_touch();
