
-- 1) Remove step_up_grants owner UPDATE policy; add SECURITY DEFINER consume fn
DROP POLICY IF EXISTS "step_up_grants owner update" ON public.step_up_grants;

CREATE OR REPLACE FUNCTION public.consume_step_up_grant(_grant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE updated int;
BEGIN
  UPDATE public.step_up_grants
     SET consumed_at = now()
   WHERE id = _grant_id
     AND user_id = auth.uid()
     AND consumed_at IS NULL
     AND expires_at > now();
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;

REVOKE EXECUTE ON FUNCTION public.consume_step_up_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_step_up_grant(uuid) TO authenticated;

-- 2) Tighten status_subscribers INSERT policy with field-level constraints
DROP POLICY IF EXISTS subscribers_anyone_insert ON public.status_subscribers;
CREATE POLICY subscribers_anyone_insert ON public.status_subscribers
  FOR INSERT TO public
  WITH CHECK (
    email IS NOT NULL
    AND length(email) <= 254
    AND email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
    AND confirmed_at IS NULL
  );
