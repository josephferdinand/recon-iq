
-- BYOK columns on providers
ALTER TABLE public.mkt_llm_providers
  ADD COLUMN IF NOT EXISTS api_key text,
  ADD COLUMN IF NOT EXISTS notes text;

-- FX rate storage (single-row settings for mkt)
CREATE TABLE IF NOT EXISTS public.mkt_fx_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  usd_to_inr numeric(12,4) NOT NULL DEFAULT 83.5,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE ON public.mkt_fx_settings TO authenticated;
GRANT ALL ON public.mkt_fx_settings TO service_role;
ALTER TABLE public.mkt_fx_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY mkt_fx_settings_read ON public.mkt_fx_settings
  FOR SELECT TO authenticated USING (public.has_any_mkt_role(auth.uid()));
CREATE POLICY mkt_fx_settings_write ON public.mkt_fx_settings
  FOR ALL TO authenticated
  USING (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'))
  WITH CHECK (public.has_mkt_role(auth.uid(),'super_admin') OR public.has_mkt_role(auth.uid(),'ai_admin'));

INSERT INTO public.mkt_fx_settings (id, usd_to_inr) VALUES (true, 83.5)
ON CONFLICT (id) DO NOTHING;
