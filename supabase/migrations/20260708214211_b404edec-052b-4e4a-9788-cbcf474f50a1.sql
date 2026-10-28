
ALTER TABLE public.tenant_sso_configs
  ADD COLUMN IF NOT EXISTS discovery_url            text,
  ADD COLUMN IF NOT EXISTS jwks_uri                 text,
  ADD COLUMN IF NOT EXISTS authorization_endpoint   text,
  ADD COLUMN IF NOT EXISTS token_endpoint           text,
  ADD COLUMN IF NOT EXISTS userinfo_endpoint        text,
  ADD COLUMN IF NOT EXISTS end_session_endpoint     text,
  ADD COLUMN IF NOT EXISTS client_secret_enc        text,
  ADD COLUMN IF NOT EXISTS client_secret_last4      text,
  ADD COLUMN IF NOT EXISTS scopes                   text[] NOT NULL DEFAULT ARRAY['openid','profile','email']::text[],
  ADD COLUMN IF NOT EXISTS redirect_uris            text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS response_type            text   NOT NULL DEFAULT 'code',
  ADD COLUMN IF NOT EXISTS pkce_enabled             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discovery_fetched_at     timestamptz;
