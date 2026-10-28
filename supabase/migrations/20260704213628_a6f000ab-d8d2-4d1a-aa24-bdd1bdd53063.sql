
-- Expand allowed actions to include theme-lifecycle events.
ALTER TABLE public.mkt_content_audit_log DROP CONSTRAINT IF EXISTS mkt_content_audit_log_action_check;
ALTER TABLE public.mkt_content_audit_log
  ADD CONSTRAINT mkt_content_audit_log_action_check
  CHECK (action IN ('create','update','delete','reset','activate','schedule','rollback','archive'));

-- Dark-mode token mapping for site themes (nullable — falls back to light tokens).
ALTER TABLE public.mkt_site_themes
  ADD COLUMN IF NOT EXISTS dark_tokens jsonb;
ALTER TABLE public.mkt_site_theme_versions
  ADD COLUMN IF NOT EXISTS dark_tokens jsonb;
