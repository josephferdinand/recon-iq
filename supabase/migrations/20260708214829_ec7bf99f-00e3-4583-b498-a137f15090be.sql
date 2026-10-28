
ALTER TABLE public.tenant_security_settings
  ADD COLUMN IF NOT EXISTS passkeys_enabled                     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS passkeys_required                    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS passkeys_user_verification           text    NOT NULL DEFAULT 'preferred',
  ADD COLUMN IF NOT EXISTS passkeys_allow_platform_authenticators   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS passkeys_allow_roaming_authenticators    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS passkeys_policy_updated_at           timestamptz,
  ADD COLUMN IF NOT EXISTS passkeys_policy_updated_by           uuid REFERENCES auth.users(id);

ALTER TABLE public.tenant_security_settings
  DROP CONSTRAINT IF EXISTS tss_passkeys_uv_check;
ALTER TABLE public.tenant_security_settings
  ADD CONSTRAINT tss_passkeys_uv_check
  CHECK (passkeys_user_verification IN ('required','preferred','discouraged'));
