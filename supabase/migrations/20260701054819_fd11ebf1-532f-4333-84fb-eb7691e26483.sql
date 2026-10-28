ALTER TABLE public.platform_ai_settings
  ADD COLUMN IF NOT EXISTS meta_gateway_fallback_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.tenant_ai_settings
  ADD COLUMN IF NOT EXISTS meta_gateway_fallback_enabled boolean;

COMMENT ON COLUMN public.platform_ai_settings.meta_gateway_fallback_enabled IS
  'When true, Falcon falls through to the Meta AI Gateway after every BYO provider in the fallback chain fails. Uses Meta credits.';
COMMENT ON COLUMN public.tenant_ai_settings.meta_gateway_fallback_enabled IS
  'Tenant override for the Meta AI Gateway ultimate fallback. NULL = inherit platform setting.';