-- Prevent a thread owner from assigning an insight to a tenant other than the
-- parent Copilot thread. Enforce this for trusted/service writes as well as RLS.

CREATE OR REPLACE FUNCTION private.enforce_copilot_insight_thread_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_tenant_id uuid;
BEGIN
  SELECT t.tenant_id
  INTO parent_tenant_id
  FROM public.copilot_threads t
  WHERE t.id = NEW.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Copilot insight parent thread does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM parent_tenant_id THEN
    RAISE EXCEPTION 'Copilot insight tenant must match parent thread tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.enforce_copilot_insight_thread_tenant() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_copilot_insight_thread_tenant
  ON public.copilot_thread_insights;
CREATE TRIGGER trg_copilot_insight_thread_tenant
  BEFORE INSERT OR UPDATE OF thread_id, tenant_id
  ON public.copilot_thread_insights
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_copilot_insight_thread_tenant();

DROP POLICY IF EXISTS cti_owner_select ON public.copilot_thread_insights;
DROP POLICY IF EXISTS cti_owner_insert ON public.copilot_thread_insights;

CREATE POLICY cti_owner_select
  ON public.copilot_thread_insights
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.copilot_threads t
      WHERE t.id = copilot_thread_insights.thread_id
        AND t.user_id = auth.uid()
        AND private.can_use_copilot_scope(auth.uid(), t.scope, t.tenant_id)
        AND copilot_thread_insights.tenant_id IS NOT DISTINCT FROM t.tenant_id
    )
  );

CREATE POLICY cti_owner_insert
  ON public.copilot_thread_insights
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.copilot_threads t
      WHERE t.id = copilot_thread_insights.thread_id
        AND t.user_id = auth.uid()
        AND private.can_use_copilot_scope(auth.uid(), t.scope, t.tenant_id)
        AND copilot_thread_insights.tenant_id IS NOT DISTINCT FROM t.tenant_id
    )
  );
