
CREATE TABLE public.docs_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  repo text NOT NULL,
  branch text NOT NULL,
  path text NOT NULL,
  commit_sha text,
  commit_short_sha text,
  commit_message text,
  commit_author text,
  commit_committed_at timestamptz,
  file_count int NOT NULL DEFAULT 0,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('verified','error')),
  error_message text,
  http_status int,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.docs_sync_events TO authenticated;
GRANT ALL ON public.docs_sync_events TO service_role;

ALTER TABLE public.docs_sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_sync_events_select_platform_admin"
  ON public.docs_sync_events FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "docs_sync_events_insert_platform_admin"
  ON public.docs_sync_events FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()) AND actor_user_id = auth.uid());

CREATE INDEX idx_docs_sync_events_created_at ON public.docs_sync_events (created_at DESC);
