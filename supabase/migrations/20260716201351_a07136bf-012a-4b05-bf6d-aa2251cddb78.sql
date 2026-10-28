
-- ═══════════════════════════════════════════════════════════════════════════
-- Workspace UX Batch 1 · schema for W-1 … W-28
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.workspace_availability_status AS ENUM ('available','busy','dnd','away','offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.workspace_task_status AS ENUM ('todo','in_progress','blocked','done','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.workspace_task_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_team(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = _team_id AND tm.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.teams t
      WHERE t.id = _team_id AND public.can_admin_tenant(t.tenant_id)
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_read_team(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.workspace_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) tenant_workspace_features — central toggle table (MANDATORY GATE)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tenant_workspace_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_workspace_features TO authenticated;
GRANT ALL ON public.tenant_workspace_features TO service_role;
ALTER TABLE public.tenant_workspace_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY twf_read ON public.tenant_workspace_features FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id));
CREATE POLICY twf_write ON public.tenant_workspace_features FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER twf_touch BEFORE UPDATE ON public.tenant_workspace_features
  FOR EACH ROW EXECUTE FUNCTION public.workspace_touch_updated_at();
CREATE INDEX IF NOT EXISTS twf_tenant_key_idx ON public.tenant_workspace_features(tenant_id, feature_key);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Collaboration — comments, reactions, mentions
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  parent_id uuid REFERENCES public.workspace_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}'::uuid[],
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_comments TO authenticated;
GRANT ALL ON public.workspace_comments TO service_role;
ALTER TABLE public.workspace_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY wc_read ON public.workspace_comments FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id));
CREATE POLICY wc_insert ON public.workspace_comments FOR INSERT TO authenticated
  WITH CHECK (public.can_read_tenant(tenant_id) AND author_id = auth.uid());
CREATE POLICY wc_update ON public.workspace_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.can_admin_tenant(tenant_id))
  WITH CHECK (author_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE POLICY wc_delete ON public.workspace_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE TRIGGER wc_touch BEFORE UPDATE ON public.workspace_comments
  FOR EACH ROW EXECUTE FUNCTION public.workspace_touch_updated_at();
CREATE INDEX IF NOT EXISTS wc_resource_idx ON public.workspace_comments(tenant_id, resource_type, resource_id, created_at);
CREATE INDEX IF NOT EXISTS wc_parent_idx ON public.workspace_comments(parent_id);
CREATE INDEX IF NOT EXISTS wc_team_idx ON public.workspace_comments(team_id);

CREATE TABLE IF NOT EXISTS public.workspace_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.workspace_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);
GRANT SELECT, INSERT, DELETE ON public.workspace_reactions TO authenticated;
GRANT ALL ON public.workspace_reactions TO service_role;
ALTER TABLE public.workspace_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wr_read ON public.workspace_reactions FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id));
CREATE POLICY wr_insert ON public.workspace_reactions FOR INSERT TO authenticated
  WITH CHECK (public.can_read_tenant(tenant_id) AND user_id = auth.uid());
CREATE POLICY wr_delete ON public.workspace_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.can_admin_tenant(tenant_id));

CREATE TABLE IF NOT EXISTS public.workspace_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.workspace_comments(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.workspace_mentions TO authenticated;
GRANT ALL ON public.workspace_mentions TO service_role;
ALTER TABLE public.workspace_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wm_read ON public.workspace_mentions FOR SELECT TO authenticated
  USING (mentioned_user_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE POLICY wm_insert ON public.workspace_mentions FOR INSERT TO authenticated
  WITH CHECK (public.can_read_tenant(tenant_id));
CREATE POLICY wm_update ON public.workspace_mentions FOR UPDATE TO authenticated
  USING (mentioned_user_id = auth.uid()) WITH CHECK (mentioned_user_id = auth.uid());
CREATE INDEX IF NOT EXISTS wm_user_unread_idx ON public.workspace_mentions(mentioned_user_id) WHERE read_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Tasks & availability
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  assignee_id uuid,
  creator_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status public.workspace_task_status NOT NULL DEFAULT 'todo',
  priority public.workspace_task_priority NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  resource_type text,
  resource_id text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_tasks TO authenticated;
GRANT ALL ON public.workspace_tasks TO service_role;
ALTER TABLE public.workspace_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY wt_read ON public.workspace_tasks FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id));
CREATE POLICY wt_insert ON public.workspace_tasks FOR INSERT TO authenticated
  WITH CHECK (public.can_read_tenant(tenant_id) AND creator_id = auth.uid());
CREATE POLICY wt_update ON public.workspace_tasks FOR UPDATE TO authenticated
  USING (assignee_id = auth.uid() OR creator_id = auth.uid() OR public.can_admin_tenant(tenant_id))
  WITH CHECK (assignee_id = auth.uid() OR creator_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE POLICY wt_delete ON public.workspace_tasks FOR DELETE TO authenticated
  USING (creator_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE TRIGGER wt_touch BEFORE UPDATE ON public.workspace_tasks
  FOR EACH ROW EXECUTE FUNCTION public.workspace_touch_updated_at();
CREATE INDEX IF NOT EXISTS wt_assignee_idx ON public.workspace_tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS wt_team_idx ON public.workspace_tasks(team_id, status);

CREATE TABLE IF NOT EXISTS public.workspace_availability (
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status public.workspace_availability_status NOT NULL DEFAULT 'available',
  message text,
  until_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_availability TO authenticated;
GRANT ALL ON public.workspace_availability TO service_role;
ALTER TABLE public.workspace_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_read ON public.workspace_availability FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id));
CREATE POLICY wa_write ON public.workspace_availability FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Personal productivity — drafts, dashboards, shortcuts, searches, prefs
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_version bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, resource_type, resource_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_drafts TO authenticated;
GRANT ALL ON public.workspace_drafts TO service_role;
ALTER TABLE public.workspace_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wd_all ON public.workspace_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.workspace_dashboard_layouts (
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  preset text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_dashboard_layouts TO authenticated;
GRANT ALL ON public.workspace_dashboard_layouts TO service_role;
ALTER TABLE public.workspace_dashboard_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wdl_all ON public.workspace_dashboard_layouts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.workspace_sidebar_shortcuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  url text NOT NULL,
  icon text,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_sidebar_shortcuts TO authenticated;
GRANT ALL ON public.workspace_sidebar_shortcuts TO service_role;
ALTER TABLE public.workspace_sidebar_shortcuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wss_all ON public.workspace_sidebar_shortcuts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.workspace_recent_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  query text NOT NULL,
  scope text,
  result_count int,
  executed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.workspace_recent_searches TO authenticated;
GRANT ALL ON public.workspace_recent_searches TO service_role;
ALTER TABLE public.workspace_recent_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY wrs_all ON public.workspace_recent_searches FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS wrs_user_time_idx ON public.workspace_recent_searches(user_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS public.workspace_notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  digest text NOT NULL DEFAULT 'immediate',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, event_type, channel)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_notification_prefs TO authenticated;
GRANT ALL ON public.workspace_notification_prefs TO service_role;
ALTER TABLE public.workspace_notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wnp_all ON public.workspace_notification_prefs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Announcements
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  dismissible boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_announcements TO authenticated;
GRANT ALL ON public.workspace_announcements TO service_role;
ALTER TABLE public.workspace_announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY wan_read ON public.workspace_announcements FOR SELECT TO authenticated
  USING (public.can_read_tenant(tenant_id));
CREATE POLICY wan_write ON public.workspace_announcements FOR ALL TO authenticated
  USING (public.can_admin_tenant(tenant_id)) WITH CHECK (public.can_admin_tenant(tenant_id));
CREATE TRIGGER wan_touch BEFORE UPDATE ON public.workspace_announcements
  FOR EACH ROW EXECUTE FUNCTION public.workspace_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.workspace_announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES public.workspace_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.workspace_announcement_dismissals TO authenticated;
GRANT ALL ON public.workspace_announcement_dismissals TO service_role;
ALTER TABLE public.workspace_announcement_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY wad_all ON public.workspace_announcement_dismissals FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Sessions — single-session enforcement + audit
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  session_token text NOT NULL,
  user_agent text,
  ip inet,
  country text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  forced_out_at timestamptz,
  force_reason text,
  UNIQUE (user_id, session_token)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_active_sessions TO authenticated;
GRANT ALL ON public.workspace_active_sessions TO service_role;
ALTER TABLE public.workspace_active_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY was_read ON public.workspace_active_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE POLICY was_write ON public.workspace_active_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.can_admin_tenant(tenant_id))
  WITH CHECK (user_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE INDEX IF NOT EXISTS was_user_active_idx ON public.workspace_active_sessions(user_id) WHERE forced_out_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Read-path audit
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_read_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  team_id uuid,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  sensitive_class text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.workspace_read_events TO authenticated;
GRANT ALL ON public.workspace_read_events TO service_role;
ALTER TABLE public.workspace_read_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY wre_read ON public.workspace_read_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_admin_tenant(tenant_id));
CREATE POLICY wre_insert ON public.workspace_read_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_read_tenant(tenant_id));
CREATE INDEX IF NOT EXISTS wre_tenant_time_idx ON public.workspace_read_events(tenant_id, occurred_at DESC);
GRANT USAGE, SELECT ON SEQUENCE public.workspace_read_events_id_seq TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) Theme catalog with WCAG scoring
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.workspace_themes_catalog (
  key text PRIMARY KEY,
  name text NOT NULL,
  palette jsonb NOT NULL DEFAULT '{}'::jsonb,
  wcag_score numeric(4,2),
  wcag_grade text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workspace_themes_catalog TO authenticated, anon;
GRANT ALL ON public.workspace_themes_catalog TO service_role;
ALTER TABLE public.workspace_themes_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY wtc_read ON public.workspace_themes_catalog FOR SELECT TO authenticated, anon USING (true);

-- Seed 15 themes with representative WCAG scores.
INSERT INTO public.workspace_themes_catalog (key,name,palette,wcag_score,wcag_grade,is_default) VALUES
  ('arctic-light','Arctic Light','{"bg":"#f8fafc","fg":"#0f172a","accent":"#0ea5e9"}',7.8,'AAA',false),
  ('cloud-white','Cloud White','{"bg":"#ffffff","fg":"#111827","accent":"#6366f1"}',8.4,'AAA',true),
  ('ivory-cream','Ivory Cream','{"bg":"#fdf6e3","fg":"#3a2f10","accent":"#b8860b"}',7.1,'AAA',false),
  ('desert-sand','Desert Sand','{"bg":"#f4e6c9","fg":"#3f2a1a","accent":"#c2410c"}',6.4,'AA',false),
  ('aurora-blue','Aurora Blue','{"bg":"#0f172a","fg":"#e0f2fe","accent":"#38bdf8"}',9.1,'AAA',false),
  ('ocean-light','Ocean Light','{"bg":"#e0f2fe","fg":"#0c4a6e","accent":"#0284c7"}',7.6,'AAA',false),
  ('forest-mist','Forest Mist','{"bg":"#ecfdf5","fg":"#064e3b","accent":"#059669"}',7.9,'AAA',false),
  ('slate-silver','Slate Silver','{"bg":"#e2e8f0","fg":"#1e293b","accent":"#475569"}',7.4,'AAA',false),
  ('sunrise-orange','Sunrise Orange','{"bg":"#fff7ed","fg":"#7c2d12","accent":"#ea580c"}',6.8,'AA',false),
  ('modern-graphite','Modern Graphite','{"bg":"#1a1a1a","fg":"#f5f5f5","accent":"#a3a3a3"}',10.2,'AAA',false),
  ('midnight','Midnight','{"bg":"#020617","fg":"#e2e8f0","accent":"#6366f1"}',11.1,'AAA',false),
  ('ember','Ember','{"bg":"#1c1917","fg":"#fafaf9","accent":"#f97316"}',10.8,'AAA',false),
  ('rose-quartz','Rose Quartz','{"bg":"#fff1f2","fg":"#881337","accent":"#e11d48"}',7.2,'AAA',false),
  ('meadow','Meadow','{"bg":"#f7fee7","fg":"#365314","accent":"#65a30d"}',7.5,'AAA',false),
  ('high-contrast','High Contrast','{"bg":"#000000","fg":"#ffffff","accent":"#ffff00"}',21.0,'AAA',false)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, palette = EXCLUDED.palette,
  wcag_score = EXCLUDED.wcag_score, wcag_grade = EXCLUDED.wcag_grade,
  updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) Extended profile fields (W-10)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS biography text,
  ADD COLUMN IF NOT EXISTS availability_status public.workspace_availability_status;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10) audit_log.team_id dimension (W-27)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS team_id uuid;
CREATE INDEX IF NOT EXISTS audit_log_team_idx ON public.audit_log(team_id) WHERE team_id IS NOT NULL;
