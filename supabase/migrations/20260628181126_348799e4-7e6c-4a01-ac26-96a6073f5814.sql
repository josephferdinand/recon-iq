ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

COMMENT ON COLUMN public.tenants.onboarding_state IS
  'Per-step onboarding checklist progress: {workspace:bool, data_source:bool, access_verified:bool}';