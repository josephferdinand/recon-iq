
DROP POLICY IF EXISTS prr_update_own_cancel ON public.platform_role_requests;

CREATE POLICY prr_update_own_cancel ON public.platform_role_requests
FOR UPDATE
USING (requester_id = auth.uid() AND status = 'pending')
WITH CHECK (
  requester_id = auth.uid()
  AND status = 'cancelled'
  AND decided_by IS NULL
  AND decided_at IS NULL
);
