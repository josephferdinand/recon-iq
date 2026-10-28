ALTER TABLE public.saved_views
  ADD COLUMN IF NOT EXISTS view_type text NOT NULL DEFAULT 'table',
  ADD COLUMN IF NOT EXISTS pivot_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS column_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_config jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.saved_views DROP CONSTRAINT IF EXISTS saved_views_view_type_chk;
ALTER TABLE public.saved_views ADD CONSTRAINT saved_views_view_type_chk
  CHECK (view_type IN ('table','pivot','board','timeline','grid'));

CREATE TABLE IF NOT EXISTS public.user_ui_preferences (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  density text NOT NULL DEFAULT 'comfortable',
  reduce_motion boolean NOT NULL DEFAULT false,
  high_contrast boolean NOT NULL DEFAULT false,
  sidebar_collapsed boolean NOT NULL DEFAULT false,
  keyboard_hints boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_ui_prefs_theme_chk CHECK (theme IN ('light','dark','system')),
  CONSTRAINT user_ui_prefs_density_chk CHECK (density IN ('compact','cozy','comfortable'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_preferences TO authenticated;
GRANT ALL ON public.user_ui_preferences TO service_role;
ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_ui_prefs own row read" ON public.user_ui_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_ui_prefs own row write" ON public.user_ui_preferences
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER tg_user_ui_prefs_updated BEFORE UPDATE ON public.user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.mobile_devices (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  push_token text NOT NULL,
  device_name text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_devices_platform_chk CHECK (platform IN ('ios','android','web')),
  CONSTRAINT mobile_devices_unique UNIQUE (user_id, push_token)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_devices TO authenticated;
GRANT ALL ON public.mobile_devices TO service_role;
ALTER TABLE public.mobile_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mobile_devices own rows" ON public.mobile_devices
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER tg_mobile_devices_updated BEFORE UPDATE ON public.mobile_devices
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
