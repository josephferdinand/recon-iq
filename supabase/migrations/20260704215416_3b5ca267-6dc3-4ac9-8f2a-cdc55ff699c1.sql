
-- ============================================================================
-- Marketing admin hardening: bootstrap atomicity, MFA step-up audit, four-eyes
-- approvals, expanded audit action list.
-- ============================================================================

-- 1) Expand action check on mkt_content_audit_log to include auth/approval events
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mkt_content_audit_log_action_check'
  ) THEN
    ALTER TABLE public.mkt_content_audit_log DROP CONSTRAINT mkt_content_audit_log_action_check;
  END IF;
END$$;

ALTER TABLE public.mkt_content_audit_log
  ADD CONSTRAINT mkt_content_audit_log_action_check
  CHECK (action IN (
    'create','update','delete','reset',
    'activate','schedule','rollback','archive',
    'stepup_success','stepup_failed',
    'bootstrap_success','bootstrap_denied',
    'request','approve','reject','cancel'
  ));

-- 2) Atomic super-admin bootstrap via SECURITY DEFINER RPC + advisory lock
CREATE OR REPLACE FUNCTION public.mkt_bootstrap_super_admin(_caller uuid, _email text)
RETURNS TABLE(promoted boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _exists boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mkt_bootstrap_super_admin'));
  SELECT EXISTS(SELECT 1 FROM public.mkt_admin_roles WHERE role = 'super_admin')
    INTO _exists;
  IF _exists THEN
    RETURN QUERY SELECT false, 'super_admin_exists'::text;
    RETURN;
  END IF;
  INSERT INTO public.mkt_admin_roles(user_id, role, granted_by)
    VALUES (_caller, 'super_admin', _caller);
  INSERT INTO public.mkt_admin_users(user_id, display_name, status)
    VALUES (_caller, _email, 'active')
    ON CONFLICT (user_id) DO UPDATE SET status = 'active';
  RETURN QUERY SELECT true, 'bootstrapped'::text;
END$$;

REVOKE ALL ON FUNCTION public.mkt_bootstrap_super_admin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_bootstrap_super_admin(uuid, text) TO service_role;

-- 3) Four-eyes approvals table for destructive theme actions
CREATE TABLE IF NOT EXISTS public.mkt_theme_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('activate','rollback','archive')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','executed')),
  requested_by uuid NOT NULL,
  requested_by_email text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.mkt_theme_approvals TO authenticated;
GRANT ALL ON public.mkt_theme_approvals TO service_role;

ALTER TABLE public.mkt_theme_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mkt admins read approvals"
  ON public.mkt_theme_approvals FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.mkt_admin_roles r WHERE r.user_id = auth.uid()));

CREATE POLICY "mkt admins write approvals"
  ON public.mkt_theme_approvals FOR INSERT TO authenticated
  WITH CHECK (EXISTS(SELECT 1 FROM public.mkt_admin_roles r WHERE r.user_id = auth.uid()));

CREATE POLICY "mkt admins update approvals"
  ON public.mkt_theme_approvals FOR UPDATE TO authenticated
  USING (EXISTS(SELECT 1 FROM public.mkt_admin_roles r WHERE r.user_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.mkt_admin_roles r WHERE r.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_mkt_theme_approvals_status ON public.mkt_theme_approvals(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_theme_approvals_theme ON public.mkt_theme_approvals(theme_id);

CREATE OR REPLACE FUNCTION public.mkt_theme_approvals_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END$$;

DROP TRIGGER IF EXISTS trg_mkt_theme_approvals_touch ON public.mkt_theme_approvals;
CREATE TRIGGER trg_mkt_theme_approvals_touch
  BEFORE UPDATE ON public.mkt_theme_approvals
  FOR EACH ROW EXECUTE FUNCTION public.mkt_theme_approvals_touch();
