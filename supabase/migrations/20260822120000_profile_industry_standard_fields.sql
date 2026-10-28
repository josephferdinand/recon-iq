-- 2026-08-22 — User profile page + change-password feature.
-- Adds industry-standard profile fields and a server-persisted email-digest cadence.
-- Idempotent: safe to re-apply. Existing RLS policies already cover the new columns.

-- ─── profiles ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;

-- ─── user_ui_preferences ──────────────────────────────────────────────────────
ALTER TABLE public.user_ui_preferences
  ADD COLUMN IF NOT EXISTS email_digest text NOT NULL DEFAULT 'off'
    CHECK (email_digest IN ('off','daily','weekly'));