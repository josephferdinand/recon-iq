-- Saved views & notifications for FVI workspace UX
CREATE TABLE IF NOT EXISTS public.saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL,                       -- e.g. 'exceptions', 'recons', 'data_sources'
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;
GRANT ALL ON public.saved_views TO service_role;
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_views read by tenant members"
  ON public.saved_views FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id)
         AND (user_id = auth.uid() OR is_shared = true));

CREATE POLICY "saved_views write own"
  ON public.saved_views FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (user_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id));

CREATE INDEX IF NOT EXISTS saved_views_tenant_scope_idx
  ON public.saved_views(tenant_id, scope);

CREATE TRIGGER set_saved_views_updated_at BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL,                        -- e.g. 'recon.completed', 'exception.assigned', 'ticket.updated'
  title text NOT NULL,
  body text,
  link_to text,                              -- e.g. '/acme/workspace#exceptions'
  read_at timestamptz,
  severity text NOT NULL DEFAULT 'info',     -- 'info' | 'success' | 'warning' | 'critical'
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications self read"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications self update"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications service insert"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications(user_id, read_at, created_at DESC);
