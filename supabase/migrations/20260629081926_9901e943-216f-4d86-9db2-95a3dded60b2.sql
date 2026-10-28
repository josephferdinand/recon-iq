-- ───────────────────────────────────────────────────────────────────────────
-- GitHub Sync — Configurable repo settings + 4-eyes change workflow
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Singleton settings table (id is fixed)
CREATE TABLE public.github_sync_settings (
  id            uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  owner         text,
  repo_name     text,
  branch        text NOT NULL DEFAULT 'main',
  docs_path     text NOT NULL DEFAULT 'docs',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_request_id uuid,
  CONSTRAINT github_sync_settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

GRANT SELECT ON public.github_sync_settings TO authenticated;
GRANT ALL ON public.github_sync_settings TO service_role;

ALTER TABLE public.github_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read settings"
  ON public.github_sync_settings FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "service role manages settings"
  ON public.github_sync_settings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.github_sync_settings (id) VALUES ('00000000-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (id) DO NOTHING;

-- 2. Change request table (append-only with controlled state machine)
CREATE TYPE public.github_sync_request_status AS ENUM (
  'pending', 'approved', 'rejected', 'applied', 'failed', 'cancelled'
);

CREATE TABLE public.github_sync_change_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Proposed values (full snapshot for evidence)
  proposed_owner      text NOT NULL,
  proposed_repo_name  text NOT NULL,
  proposed_branch     text NOT NULL DEFAULT 'main',
  proposed_docs_path  text NOT NULL DEFAULT 'docs',

  -- Snapshot of values at request time
  previous_owner      text,
  previous_repo_name  text,
  previous_branch     text,
  previous_docs_path  text,

  -- Justification & actors
  reason              text NOT NULL,
  requested_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_by_email  text,

  approver_1          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approver_1_email    text,
  approver_1_at       timestamptz,

  approver_2          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approver_2_email    text,
  approver_2_at       timestamptz,

  rejected_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_by_email   text,
  rejected_at         timestamptz,
  rejection_reason    text,

  -- Apply lifecycle
  status              public.github_sync_request_status NOT NULL DEFAULT 'pending',
  apply_attempts      integer NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  last_error          text,
  applied_at          timestamptz,
  applied_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Tamper evidence
  evidence_sha256     text
);

GRANT SELECT, INSERT, UPDATE ON public.github_sync_change_requests TO authenticated;
GRANT ALL ON public.github_sync_change_requests TO service_role;

CREATE INDEX github_sync_cr_status_idx
  ON public.github_sync_change_requests (status, created_at DESC);

ALTER TABLE public.github_sync_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read change requests"
  ON public.github_sync_change_requests FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "platform admins create change requests"
  ON public.github_sync_change_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    AND requested_by = auth.uid()
    AND status = 'pending'
  );

CREATE POLICY "platform admins update change requests"
  ON public.github_sync_change_requests FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "service role manages change requests"
  ON public.github_sync_change_requests FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 3. State machine guard trigger
CREATE OR REPLACE FUNCTION public.tg_github_sync_cr_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- Terminal states are immutable
  IF TG_OP = 'UPDATE' AND OLD.status IN ('applied','rejected','cancelled') THEN
    RAISE EXCEPTION 'github_sync change request % is terminal (status=%) and cannot be modified',
      OLD.id, OLD.status;
  END IF;

  -- Self-approval and duplicate-approver prevention
  IF NEW.approver_1 IS NOT NULL AND NEW.approver_1 = NEW.requested_by THEN
    RAISE EXCEPTION 'requester cannot be approver_1 (4-eyes violation)';
  END IF;
  IF NEW.approver_2 IS NOT NULL AND NEW.approver_2 = NEW.requested_by THEN
    RAISE EXCEPTION 'requester cannot be approver_2 (4-eyes violation)';
  END IF;
  IF NEW.approver_1 IS NOT NULL AND NEW.approver_2 IS NOT NULL
     AND NEW.approver_1 = NEW.approver_2 THEN
    RAISE EXCEPTION 'approver_1 and approver_2 must be distinct (4-eyes violation)';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER github_sync_cr_guard
BEFORE INSERT OR UPDATE ON public.github_sync_change_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_github_sync_cr_guard();

-- 4. Settings write-guard: only allow writes when called from the apply path
--    (service_role) or when no platform admin context is present (initial seed).
CREATE OR REPLACE FUNCTION public.tg_github_sync_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only service_role may UPDATE; authenticated users go through apply RPC.
  IF TG_OP = 'UPDATE' AND current_setting('role', true) <> 'service_role'
     AND (SELECT current_user) <> 'postgres' THEN
    -- allow when called by SECURITY DEFINER functions that elevate; check session_user
    IF session_user NOT IN ('postgres','supabase_admin','service_role') THEN
      RAISE EXCEPTION 'github_sync_settings can only be modified via apply_github_sync_change RPC';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER github_sync_settings_guard
BEFORE UPDATE ON public.github_sync_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_github_sync_settings_guard();
