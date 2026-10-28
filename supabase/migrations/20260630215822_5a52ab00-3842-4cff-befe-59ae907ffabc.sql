
-- ============================================================================
-- C-3 — step_up_grant_lifecycle audit table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.step_up_grant_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.step_up_grants(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('granted','consumed','expired')),
  actor_user_id uuid REFERENCES public.profiles(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS step_up_grant_lifecycle_grant_idx
  ON public.step_up_grant_lifecycle (grant_id, occurred_at DESC);

GRANT ALL ON public.step_up_grant_lifecycle TO service_role;
-- No anon/authenticated grants — audit table, service-role only.

ALTER TABLE public.step_up_grant_lifecycle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access step_up_grant_lifecycle"
  ON public.step_up_grant_lifecycle
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- BEFORE INSERT trigger: every new step_up_grants row writes a 'granted' lifecycle entry.
CREATE OR REPLACE FUNCTION public.step_up_grant_lifecycle_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.step_up_grant_lifecycle (grant_id, action, actor_user_id)
  VALUES (NEW.id, 'granted', NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_step_up_grant_lifecycle_insert ON public.step_up_grants;
CREATE TRIGGER trg_step_up_grant_lifecycle_insert
  AFTER INSERT ON public.step_up_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.step_up_grant_lifecycle_on_insert();

-- Daily expiration sweep — marks grants that have expired unconsumed.
CREATE OR REPLACE FUNCTION public.step_up_grants_mark_expired()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH expired AS (
    SELECT g.id, g.user_id
    FROM public.step_up_grants g
    LEFT JOIN LATERAL (
      SELECT 1 FROM public.step_up_grant_lifecycle l
       WHERE l.grant_id = g.id AND l.action IN ('consumed','expired')
       LIMIT 1
    ) seen ON true
    WHERE g.consumed_at IS NULL
      AND g.expires_at < now()
      AND seen IS NULL
  ),
  ins AS (
    INSERT INTO public.step_up_grant_lifecycle (grant_id, action, actor_user_id)
    SELECT id, 'expired', user_id FROM expired
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.step_up_grants_mark_expired() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.step_up_grants_mark_expired() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'step-up-grants-expire';
    PERFORM cron.schedule(
      'step-up-grants-expire',
      '7 3 * * *',
      $cron$SELECT public.step_up_grants_mark_expired();$cron$
    );
  END IF;
END $$;

-- ============================================================================
-- D-1 — aidp_outputs live uniqueness
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS aidp_outputs_live_idx
  ON public.aidp_outputs (document_id, entity_type_id)
  WHERE superseded_at IS NULL;

-- ============================================================================
-- D-2 — recon_match_deletions audit
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.recon_match_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  tenant_id uuid,
  run_id uuid,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  snapshot jsonb
);

CREATE INDEX IF NOT EXISTS recon_match_deletions_tenant_idx
  ON public.recon_match_deletions (tenant_id, deleted_at DESC);

GRANT ALL ON public.recon_match_deletions TO service_role;
ALTER TABLE public.recon_match_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access recon_match_deletions"
  ON public.recon_match_deletions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.recon_matches_audit_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_by uuid;
  v_reason text;
BEGIN
  BEGIN
    v_deleted_by := NULLIF(current_setting('app.deleted_by', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_deleted_by := NULL;
  END;
  BEGIN
    v_reason := NULLIF(current_setting('app.delete_reason', true), '');
  EXCEPTION WHEN others THEN
    v_reason := NULL;
  END;

  INSERT INTO public.recon_match_deletions (
    match_id, tenant_id, run_id, deleted_by, reason, snapshot
  )
  VALUES (
    OLD.id, OLD.tenant_id, OLD.run_id, v_deleted_by, v_reason,
    to_jsonb(OLD)
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_recon_matches_audit_delete ON public.recon_matches;
CREATE TRIGGER trg_recon_matches_audit_delete
  BEFORE DELETE ON public.recon_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.recon_matches_audit_delete();
