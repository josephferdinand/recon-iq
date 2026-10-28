
-- ============================================================
-- Fix 1: email_unsubscribe_tokens — remove plaintext token + email
-- Table is currently empty; safe to restructure in place.
-- ============================================================
ALTER TABLE public.email_unsubscribe_tokens
  DROP CONSTRAINT IF EXISTS email_unsubscribe_tokens_token_key,
  DROP CONSTRAINT IF EXISTS email_unsubscribe_tokens_email_key;

DROP INDEX IF EXISTS public.idx_unsubscribe_tokens_token;

ALTER TABLE public.email_unsubscribe_tokens
  DROP COLUMN IF EXISTS token,
  DROP COLUMN IF EXISTS email;

ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN token_hash bytea NOT NULL,
  ADD COLUMN email_hash bytea NOT NULL;

ALTER TABLE public.email_unsubscribe_tokens
  ADD CONSTRAINT email_unsubscribe_tokens_token_hash_key UNIQUE (token_hash),
  ADD CONSTRAINT email_unsubscribe_tokens_email_hash_key UNIQUE (email_hash),
  ADD CONSTRAINT email_unsubscribe_tokens_token_hash_sha256_chk
    CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT email_unsubscribe_tokens_email_hash_sha256_chk
    CHECK (octet_length(email_hash) = 32);

CREATE INDEX idx_unsubscribe_tokens_token_hash
  ON public.email_unsubscribe_tokens (token_hash);

-- ============================================================
-- Fix 2: tenant_invitations.token_hash — require SHA-256 hash
-- Table is currently empty; NOT NULL backfill is unnecessary.
-- ============================================================
ALTER TABLE public.tenant_invitations
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE public.tenant_invitations
  ADD CONSTRAINT tenant_invitations_token_hash_sha256_chk
    CHECK (octet_length(token_hash) = 32);
