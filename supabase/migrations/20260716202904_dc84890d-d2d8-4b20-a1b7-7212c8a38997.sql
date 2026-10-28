-- MFA SMS OTP: add pending-code fields for challenge/verify flow
ALTER TABLE public.platform_mfa_sms
  ADD COLUMN IF NOT EXISTS code_hash TEXT,
  ADD COLUMN IF NOT EXISTS code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS code_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'twilio';

-- Recovery codes: allow user self-service
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfa_recovery_codes TO authenticated;
GRANT ALL ON public.mfa_recovery_codes TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mfa_recovery_codes'
      AND policyname = 'mfa_recovery_codes_owner_all'
  ) THEN
    CREATE POLICY mfa_recovery_codes_owner_all ON public.mfa_recovery_codes
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;