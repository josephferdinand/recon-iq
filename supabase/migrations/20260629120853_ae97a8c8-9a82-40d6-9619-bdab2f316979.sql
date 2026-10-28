
ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'development';

ALTER TABLE public.recon_definitions
  DROP CONSTRAINT IF EXISTS recon_definitions_environment_check;
ALTER TABLE public.recon_definitions
  ADD CONSTRAINT recon_definitions_environment_check
  CHECK (environment IN ('development','staging','production'));

CREATE INDEX IF NOT EXISTS idx_recon_definitions_env
  ON public.recon_definitions (tenant_id, environment);
