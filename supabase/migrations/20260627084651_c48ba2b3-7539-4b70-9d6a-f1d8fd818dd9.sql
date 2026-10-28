
-- Extend recon_exceptions
ALTER TABLE public.recon_exceptions
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'new'
    CHECK (lifecycle_state IN ('new','assigned','investigating','pending_counterparty','resolved','written_off')),
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'P3'
    CHECK (priority IN ('P1','P2','P3','P4')),
  ADD COLUMN IF NOT EXISTS due_date timestamptz,
  ADD COLUMN IF NOT EXISTS root_cause text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS recon_exc_lifecycle_idx ON public.recon_exceptions(tenant_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS recon_exc_assignee_idx ON public.recon_exceptions(assignee) WHERE assignee IS NOT NULL;

-- break_comments
CREATE TABLE IF NOT EXISTS public.break_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS break_comments_exc_idx ON public.break_comments(exception_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_comments TO authenticated;
GRANT ALL ON public.break_comments TO service_role;
ALTER TABLE public.break_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bc_select" ON public.break_comments FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "bc_insert" ON public.break_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "bc_delete_own" ON public.break_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

-- break_attachments
CREATE TABLE IF NOT EXISTS public.break_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes integer,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS break_att_exc_idx ON public.break_attachments(exception_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.break_attachments TO authenticated;
GRANT ALL ON public.break_attachments TO service_role;
ALTER TABLE public.break_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ba_select" ON public.break_attachments FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "ba_write" ON public.break_attachments FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));

-- agent_runs
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'workspace',
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','cancelled','awaiting_approval')),
  summary text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_tenant_idx ON public.agent_runs(tenant_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_runs_select" ON public.agent_runs FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "agent_runs_write" ON public.agent_runs FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER trg_agent_runs_updated BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- agent_actions
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tool text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','approved','rejected','completed','failed')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_actions_run_idx ON public.agent_actions(run_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_actions TO authenticated;
GRANT ALL ON public.agent_actions TO service_role;
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_act_select" ON public.agent_actions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "agent_act_write" ON public.agent_actions FOR ALL TO authenticated
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst') OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
