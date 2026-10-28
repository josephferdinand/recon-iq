
CREATE OR REPLACE FUNCTION public.mkt_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.mkt_site_logos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'customer',
  logo_url TEXT,
  website_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mkt_site_logos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_site_logos TO authenticated;
GRANT ALL ON public.mkt_site_logos TO service_role;

ALTER TABLE public.mkt_site_logos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public can read published logos" ON public.mkt_site_logos
  FOR SELECT USING (published = true);

CREATE POLICY "mkt admins can manage logos" ON public.mkt_site_logos
  FOR ALL TO authenticated
  USING (
    public.has_mkt_role(auth.uid(), 'super_admin') OR
    public.has_mkt_role(auth.uid(), 'marketing_admin')
  )
  WITH CHECK (
    public.has_mkt_role(auth.uid(), 'super_admin') OR
    public.has_mkt_role(auth.uid(), 'marketing_admin')
  );

DROP TRIGGER IF EXISTS mkt_site_logos_touch ON public.mkt_site_logos;
CREATE TRIGGER mkt_site_logos_touch
  BEFORE UPDATE ON public.mkt_site_logos
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();

INSERT INTO public.mkt_site_logos (name, category, display_order, published)
SELECT 'Recon Spark', 'self', 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.mkt_site_logos);
