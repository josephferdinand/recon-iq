
ALTER TABLE public.platform_ai_settings
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
