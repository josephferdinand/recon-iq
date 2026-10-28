CREATE TABLE IF NOT EXISTS public.mkt_site_themes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','archived')),
  scheduled_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  is_preset BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_site_themes TO authenticated;
GRANT SELECT ON public.mkt_site_themes TO anon;
GRANT ALL ON public.mkt_site_themes TO service_role;

ALTER TABLE public.mkt_site_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active theme"
  ON public.mkt_site_themes FOR SELECT
  USING (status = 'active');

CREATE POLICY "Mkt admins manage themes"
  ON public.mkt_site_themes FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mkt_admin_users u
    JOIN public.mkt_admin_roles r ON r.user_id = u.user_id
    WHERE u.user_id = auth.uid() AND r.role IN ('super_admin','marketing_admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mkt_admin_users u
    JOIN public.mkt_admin_roles r ON r.user_id = u.user_id
    WHERE u.user_id = auth.uid() AND r.role IN ('super_admin','marketing_admin')
  ));

CREATE INDEX IF NOT EXISTS mkt_site_themes_status_idx ON public.mkt_site_themes(status);
CREATE INDEX IF NOT EXISTS mkt_site_themes_scheduled_idx ON public.mkt_site_themes(scheduled_at) WHERE status = 'scheduled';

CREATE TRIGGER mkt_site_themes_updated
  BEFORE UPDATE ON public.mkt_site_themes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.mkt_site_theme_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  theme_id UUID NOT NULL REFERENCES public.mkt_site_themes(id) ON DELETE CASCADE,
  version INT NOT NULL,
  tokens JSONB NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by UUID,
  note TEXT
);
GRANT SELECT, INSERT ON public.mkt_site_theme_versions TO authenticated;
GRANT ALL ON public.mkt_site_theme_versions TO service_role;
ALTER TABLE public.mkt_site_theme_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mkt admins read theme versions"
  ON public.mkt_site_theme_versions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mkt_admin_users u
    JOIN public.mkt_admin_roles r ON r.user_id = u.user_id
    WHERE u.user_id = auth.uid() AND r.role IN ('super_admin','marketing_admin')
  ));
CREATE POLICY "Mkt admins insert theme versions"
  ON public.mkt_site_theme_versions FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mkt_admin_users u
    JOIN public.mkt_admin_roles r ON r.user_id = u.user_id
    WHERE u.user_id = auth.uid() AND r.role IN ('super_admin','marketing_admin')
  ));

CREATE OR REPLACE FUNCTION public.mkt_site_themes_enforce_single_active()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active' THEN
    UPDATE public.mkt_site_themes SET status = 'archived'
      WHERE id <> NEW.id AND status = 'active';
    IF NEW.activated_at IS NULL THEN NEW.activated_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mkt_site_themes_single_active
  BEFORE INSERT OR UPDATE OF status ON public.mkt_site_themes
  FOR EACH ROW EXECUTE FUNCTION public.mkt_site_themes_enforce_single_active();

INSERT INTO public.mkt_site_themes (name, description, tokens, status, is_preset)
SELECT 'Executive Blue',
  'Premium consulting palette — trust, intelligence, professionalism.',
  jsonb_build_object(
    'primary','#1E4E8C','secondary','#EAF4FF','accent','#4DA3FF',
    'background','#F8FBFF','foreground','#0B1F3A',
    'button_style','solid','radius','0.75rem',
    'display_font','Space Grotesk','body_font','DM Sans'
  ), 'draft', true
WHERE NOT EXISTS (SELECT 1 FROM public.mkt_site_themes WHERE name = 'Executive Blue');

INSERT INTO public.mkt_site_themes (name, description, tokens, status, is_preset)
SELECT 'Modern Platinum',
  'Global consulting-grade palette — innovation, sophistication, executive presence.',
  jsonb_build_object(
    'primary','#2D3748','secondary','#F7FAFC','accent','#38B2AC',
    'background','#FFFFFF','foreground','#1A202C',
    'button_style','solid','radius','0.5rem',
    'display_font','Space Grotesk','body_font','DM Sans'
  ), 'draft', true
WHERE NOT EXISTS (SELECT 1 FROM public.mkt_site_themes WHERE name = 'Modern Platinum');