CREATE TABLE IF NOT EXISTS public.mkt_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('image','video','reel')),
  title TEXT NOT NULL,
  alt TEXT,
  storage_path TEXT,
  external_url TEXT,
  poster_url TEXT,
  duration_sec INTEGER,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  size_bytes BIGINT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mkt_media_assets TO authenticated;
GRANT SELECT ON public.mkt_media_assets TO anon;
GRANT ALL ON public.mkt_media_assets TO service_role;

ALTER TABLE public.mkt_media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read enabled media"
  ON public.mkt_media_assets FOR SELECT
  USING (enabled = TRUE);

CREATE POLICY "mkt admins manage media"
  ON public.mkt_media_assets FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.mkt_admin_roles r
            WHERE r.user_id = auth.uid()
              AND r.role IN ('super_admin','marketing_admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.mkt_admin_roles r
            WHERE r.user_id = auth.uid()
              AND r.role IN ('super_admin','marketing_admin'))
  );

CREATE OR REPLACE FUNCTION public.mkt_media_touch_updated()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS mkt_media_updated ON public.mkt_media_assets;
CREATE TRIGGER mkt_media_updated
  BEFORE UPDATE ON public.mkt_media_assets
  FOR EACH ROW EXECUTE FUNCTION public.mkt_media_touch_updated();

DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='mkt_media_public_read';
  IF NOT FOUND THEN
    CREATE POLICY "mkt_media_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'mkt-media');
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='mkt_media_admin_write';
  IF NOT FOUND THEN
    CREATE POLICY "mkt_media_admin_write" ON storage.objects
      FOR ALL TO authenticated
      USING (
        bucket_id = 'mkt-media' AND EXISTS (
          SELECT 1 FROM public.mkt_admin_roles r
          WHERE r.user_id = auth.uid()
            AND r.role IN ('super_admin','marketing_admin')
        )
      )
      WITH CHECK (
        bucket_id = 'mkt-media' AND EXISTS (
          SELECT 1 FROM public.mkt_admin_roles r
          WHERE r.user_id = auth.uid()
            AND r.role IN ('super_admin','marketing_admin')
        )
      );
  END IF;
END $$;