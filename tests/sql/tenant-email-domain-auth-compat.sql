-- Disposable supabase/postgres:15 image predates managed Auth email_confirmed_at.
-- Never apply to hosted Supabase; hosted Auth owns this column.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
