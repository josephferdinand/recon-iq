
-- =====================================================================
-- TENANT INVITATIONS
-- =====================================================================
CREATE TABLE public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role tenant_role NOT NULL DEFAULT 'tenant_analyst',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  invited_by uuid REFERENCES auth.users(id),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tenant_invitations (tenant_id);
CREATE INDEX ON public.tenant_invitations (email);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_invitations TO authenticated;
GRANT ALL ON public.tenant_invitations TO service_role;
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant admins manage invitations" ON public.tenant_invitations FOR ALL
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));
CREATE POLICY "invitee can read own by token" ON public.tenant_invitations FOR SELECT
  USING (lower(email) = lower(coalesce((auth.jwt()->>'email'), '')));

-- =====================================================================
-- LLM PROVIDERS (BYO)
-- =====================================================================
CREATE TYPE llm_scope AS ENUM ('platform','tenant');
CREATE TYPE llm_provider_kind AS ENUM ('anthropic','muse','custom_muse_compatible','meta');

CREATE TABLE public.llm_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope llm_scope NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider llm_provider_kind NOT NULL,
  display_name text NOT NULL,
  base_url text,
  model text NOT NULL,
  key_secret_name text,           -- name of the stored secret (NEVER the value)
  key_fingerprint text,           -- sha256 hex of the key
  key_last4 text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_scope_tenant_ck CHECK ((scope='platform' AND tenant_id IS NULL) OR (scope='tenant' AND tenant_id IS NOT NULL))
);
CREATE INDEX ON public.llm_providers (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.llm_providers TO authenticated;
GRANT ALL ON public.llm_providers TO service_role;
ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins manage platform llm" ON public.llm_providers FOR ALL
  USING ((scope='platform' AND public.is_platform_admin(auth.uid())))
  WITH CHECK ((scope='platform' AND public.is_platform_admin(auth.uid())));
CREATE POLICY "tenant admins manage tenant llm" ON public.llm_providers FOR ALL
  USING (scope='tenant' AND (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())))
  WITH CHECK (scope='tenant' AND (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())));
CREATE POLICY "tenant members read tenant llm" ON public.llm_providers FOR SELECT
  USING (scope='tenant' AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE TRIGGER llm_providers_updated BEFORE UPDATE ON public.llm_providers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- COPILOT THREADS + MESSAGES
-- =====================================================================
CREATE TYPE copilot_scope AS ENUM ('platform','tenant','workspace');

CREATE TABLE public.copilot_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope copilot_scope NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.copilot_threads (user_id, scope);
CREATE INDEX ON public.copilot_threads (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_threads TO authenticated;
GRANT ALL ON public.copilot_threads TO service_role;
ALTER TABLE public.copilot_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own threads" ON public.copilot_threads FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER copilot_threads_updated BEFORE UPDATE ON public.copilot_threads FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.copilot_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.copilot_messages (thread_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_messages TO authenticated;
GRANT ALL ON public.copilot_messages TO service_role;
ALTER TABLE public.copilot_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own thread messages" ON public.copilot_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.copilot_threads t WHERE t.id = thread_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.copilot_threads t WHERE t.id = thread_id AND t.user_id = auth.uid()));

-- =====================================================================
-- KNOWLEDGE BASE
-- =====================================================================
CREATE TYPE kb_scope AS ENUM ('platform','tenant');
CREATE TYPE kb_status AS ENUM ('draft','published','archived');

CREATE TABLE public.kb_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope kb_scope NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, tenant_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_categories TO authenticated;
GRANT ALL ON public.kb_categories TO service_role;
ALTER TABLE public.kb_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb cat read platform" ON public.kb_categories FOR SELECT
  USING (scope='platform' OR (scope='tenant' AND public.is_tenant_member(auth.uid(), tenant_id)) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "kb cat manage platform" ON public.kb_categories FOR ALL
  USING (scope='platform' AND public.is_platform_admin(auth.uid()))
  WITH CHECK (scope='platform' AND public.is_platform_admin(auth.uid()));
CREATE POLICY "kb cat manage tenant" ON public.kb_categories FOR ALL
  USING (scope='tenant' AND (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())))
  WITH CHECK (scope='tenant' AND (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())));

CREATE TABLE public.kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope kb_scope NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.kb_categories(id) ON DELETE SET NULL,
  slug text NOT NULL,
  title text NOT NULL,
  body_md text NOT NULL DEFAULT '',
  status kb_status NOT NULL DEFAULT 'draft',
  author_id uuid REFERENCES auth.users(id),
  views int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, tenant_id, slug)
);
CREATE INDEX ON public.kb_articles (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_articles TO authenticated;
GRANT ALL ON public.kb_articles TO service_role;
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kb art read" ON public.kb_articles FOR SELECT
  USING (
    (scope='platform' AND status='published')
    OR (scope='tenant' AND status='published' AND public.is_tenant_member(auth.uid(), tenant_id))
    OR public.is_platform_admin(auth.uid())
    OR (scope='tenant' AND public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  );
CREATE POLICY "kb art manage platform" ON public.kb_articles FOR ALL
  USING (scope='platform' AND public.is_platform_admin(auth.uid()))
  WITH CHECK (scope='platform' AND public.is_platform_admin(auth.uid()));
CREATE POLICY "kb art manage tenant" ON public.kb_articles FOR ALL
  USING (scope='tenant' AND (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())))
  WITH CHECK (scope='tenant' AND (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid())));
CREATE TRIGGER kb_articles_updated BEFORE UPDATE ON public.kb_articles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- SUPPORT TICKETS + SLA
-- =====================================================================
CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE ticket_status AS ENUM ('open','in_progress','waiting_customer','resolved','closed');
CREATE TYPE ticket_queue AS ENUM ('tenant','platform');

CREATE TABLE public.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority ticket_priority NOT NULL,
  first_response_mins int NOT NULL,
  resolution_mins int NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, priority)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sla_policies TO authenticated;
GRANT ALL ON public.sla_policies TO service_role;
ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla read" ON public.sla_policies FOR SELECT
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "sla manage" ON public.sla_policies FOR ALL
  USING (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ref text NOT NULL UNIQUE DEFAULT ('FVI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  subject text NOT NULL,
  body text NOT NULL,
  priority ticket_priority NOT NULL DEFAULT 'normal',
  status ticket_status NOT NULL DEFAULT 'open',
  queue ticket_queue NOT NULL DEFAULT 'tenant',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  assignee_id uuid REFERENCES auth.users(id),
  sla_policy_id uuid REFERENCES public.sla_policies(id),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  escalated_at timestamptz,
  escalated_reason text,
  csat_score int CHECK (csat_score BETWEEN 1 AND 5),
  csat_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.support_tickets (tenant_id, status);
CREATE INDEX ON public.support_tickets (queue, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket read" ON public.support_tickets FOR SELECT
  USING (
    created_by = auth.uid()
    OR public.is_tenant_member(auth.uid(), tenant_id)
    OR public.is_platform_admin(auth.uid())
  );
CREATE POLICY "ticket create as member" ON public.support_tickets FOR INSERT
  WITH CHECK (created_by = auth.uid() AND public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "ticket update tenant or platform" ON public.support_tickets FOR UPDATE
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.is_platform_admin(auth.uid())
    OR (created_by = auth.uid())
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin')
    OR public.is_platform_admin(auth.uid())
    OR (created_by = auth.uid())
  );
CREATE TRIGGER support_tickets_updated BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ticket_messages (ticket_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_messages TO authenticated;
GRANT ALL ON public.ticket_messages TO service_role;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msg read" ON public.ticket_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
    AND (
      t.created_by = auth.uid()
      OR public.is_tenant_member(auth.uid(), t.tenant_id)
      OR public.is_platform_admin(auth.uid())
    )
    AND (NOT internal_note OR public.has_tenant_role(auth.uid(), t.tenant_id, 'tenant_admin') OR public.is_platform_admin(auth.uid()))
  ));
CREATE POLICY "msg insert" ON public.ticket_messages FOR INSERT
  WITH CHECK (author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
    AND (
      t.created_by = auth.uid()
      OR public.is_tenant_member(auth.uid(), t.tenant_id)
      OR public.is_platform_admin(auth.uid())
    )
  ));

-- =====================================================================
-- ENVIRONMENT PROMOTION (Dev -> UAT -> Prod)
-- =====================================================================
CREATE TYPE promotion_status AS ENUM ('draft','pending_approval','approved','promoted','rejected','rolled_back');

CREATE TABLE public.promotion_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.tenant_families(id) ON DELETE CASCADE,
  source_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  target_environment text NOT NULL CHECK (target_environment IN ('dev','uat','prod')),
  name text NOT NULL,
  notes text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  status promotion_status NOT NULL DEFAULT 'draft',
  required_approvals int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  promoted_at timestamptz,
  promoted_by uuid REFERENCES auth.users(id),
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.promotion_packages (family_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotion_packages TO authenticated;
GRANT ALL ON public.promotion_packages TO service_role;
ALTER TABLE public.promotion_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo read family member" ON public.promotion_packages FOR SELECT
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = source_tenant_id AND public.is_tenant_member(auth.uid(), t.id))
  );
CREATE POLICY "promo manage tenant admin" ON public.promotion_packages FOR ALL
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), source_tenant_id, 'tenant_admin')
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_tenant_role(auth.uid(), source_tenant_id, 'tenant_admin')
  );
CREATE TRIGGER promotion_packages_updated BEFORE UPDATE ON public.promotion_packages FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.promotion_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.promotion_packages(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  comment text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, approver_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotion_approvals TO authenticated;
GRANT ALL ON public.promotion_approvals TO service_role;
ALTER TABLE public.promotion_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval read" ON public.promotion_approvals FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.promotion_packages p WHERE p.id = package_id
    AND (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), p.source_tenant_id))));
CREATE POLICY "approval insert" ON public.promotion_approvals FOR INSERT
  WITH CHECK (approver_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.promotion_packages p WHERE p.id = package_id
    AND (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), p.source_tenant_id, 'tenant_admin'))
  ));

CREATE TABLE public.promotion_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.promotion_packages(id) ON DELETE CASCADE,
  target_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotion_snapshots TO authenticated;
GRANT ALL ON public.promotion_snapshots TO service_role;
ALTER TABLE public.promotion_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snap read" ON public.promotion_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.promotion_packages p WHERE p.id = package_id
    AND (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), p.source_tenant_id))));

-- =====================================================================
-- TENANTS: add domain verify token
-- =====================================================================
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS domain_verify_token text DEFAULT encode(gen_random_bytes(16),'hex');
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS domain_verified_at timestamptz;
