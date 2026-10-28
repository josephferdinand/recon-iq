CREATE TABLE IF NOT EXISTS public.break_write_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_id uuid NOT NULL REFERENCES public.recon_exceptions(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(20,4) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gl_account text NOT NULL CHECK (length(gl_account) BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 4000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS break_write_off_one_pending
  ON public.break_write_off_requests(exception_id) WHERE status = 'pending';

ALTER TABLE public.break_write_off_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS break_write_off_requests_select ON public.break_write_off_requests;
CREATE POLICY break_write_off_requests_select ON public.break_write_off_requests
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = break_write_off_requests.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active
  )
);

DROP POLICY IF EXISTS break_write_off_requests_insert ON public.break_write_off_requests;
CREATE POLICY break_write_off_requests_insert ON public.break_write_off_requests
FOR INSERT TO authenticated WITH CHECK (
  requested_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = break_write_off_requests.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active
      AND tm.role IN ('tenant_admin','tenant_analyst')
  )
  AND EXISTS (
    SELECT 1 FROM public.recon_exceptions re
    WHERE re.id = break_write_off_requests.exception_id
      AND re.tenant_id = break_write_off_requests.tenant_id
  )
);

CREATE OR REPLACE FUNCTION public.request_break_write_off(
  _tenant_id uuid,
  _exception_id uuid,
  _requester_id uuid,
  _amount numeric,
  _currency text,
  _gl_account text,
  _reason text
) RETURNS TABLE (request_id uuid, request_status text, requested_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prior_state text;
  created public.break_write_off_requests%ROWTYPE;
BEGIN
  IF _amount < 0 OR _currency !~ '^[A-Z]{3}$'
    OR length(_gl_account) NOT BETWEEN 1 AND 100
    OR length(_reason) NOT BETWEEN 3 AND 4000 THEN
    RAISE EXCEPTION 'Invalid write-off request';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM _requester_id THEN
    RAISE EXCEPTION 'Requester identity mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = _requester_id
      AND tm.active AND tm.role IN ('tenant_admin','tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'Active analyst or administrator required';
  END IF;
  SELECT lifecycle_state INTO prior_state FROM public.recon_exceptions
  WHERE id = _exception_id AND tenant_id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Break not found in active tenant scope'; END IF;

  INSERT INTO public.break_write_off_requests(
    tenant_id, exception_id, requested_by, amount, currency, gl_account, reason
  ) VALUES (
    _tenant_id, _exception_id, _requester_id, _amount, _currency, _gl_account, _reason
  ) RETURNING * INTO created;

  INSERT INTO public.recon_exception_transitions(
    tenant_id, exception_id, actor_user_id, from_state, to_state,
    transition_type, reason, context
  ) VALUES (
    _tenant_id, _exception_id, _requester_id, prior_state, 'pending_write_off',
    'write_off_requested', _reason,
    jsonb_build_object('request_id', created.id, 'amount', _amount, 'currency', _currency, 'gl_account', _gl_account)
  );

  RETURN QUERY SELECT created.id, created.status, created.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_break_write_off(
  _tenant_id uuid,
  _request_id uuid,
  _approver_id uuid,
  _decision text,
  _decision_note text DEFAULT NULL
) RETURNS TABLE (request_id uuid, exception_id uuid, decision_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  req public.break_write_off_requests%ROWTYPE;
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid write-off decision';
  END IF;
  SELECT * INTO req FROM public.break_write_off_requests
  WHERE id = _request_id AND tenant_id = _tenant_id
  FOR UPDATE;
  IF NOT FOUND OR req.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending write-off request not found';
  END IF;
  IF req.requested_by = _approver_id THEN
    RAISE EXCEPTION 'Maker cannot approve or reject their own write-off request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = _approver_id
      AND tm.active
      AND tm.role = 'tenant_admin'
  ) THEN
    RAISE EXCEPTION 'Active tenant administrator approval required';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM _approver_id THEN
    RAISE EXCEPTION 'Approver identity mismatch';
  END IF;

  UPDATE public.break_write_off_requests
  SET status = _decision,
      decided_by = _approver_id,
      decided_at = now(),
      decision_note = nullif(trim(_decision_note), ''),
      updated_at = now()
  WHERE id = req.id;

  IF _decision = 'approved' THEN
    UPDATE public.recon_exceptions
    SET write_off_amount = req.amount,
        write_off_currency = req.currency,
        write_off_gl_account = req.gl_account,
        write_off_reason = req.reason,
        write_off_approved_by = _approver_id,
        write_off_approved_at = now(),
        lifecycle_state = 'written_off',
        status = 'resolved',
        resolved_by = _approver_id,
        resolved_at = now()
    WHERE id = req.exception_id AND tenant_id = _tenant_id;
  END IF;

  INSERT INTO public.recon_exception_transitions(
    tenant_id, exception_id, actor_user_id, from_state, to_state,
    transition_type, reason, context
  ) VALUES (
    _tenant_id, req.exception_id, _approver_id, NULL,
    CASE WHEN _decision = 'approved' THEN 'written_off' ELSE 'pending_write_off' END,
    'write_off_' || _decision, coalesce(_decision_note, req.reason),
    jsonb_build_object('request_id', req.id, 'amount', req.amount, 'currency', req.currency, 'gl_account', req.gl_account)
  );

  RETURN QUERY SELECT req.id, req.exception_id, _decision;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_break_write_off(uuid,uuid,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_break_write_off(uuid,uuid,uuid,numeric,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_break_write_off(uuid,uuid,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_break_write_off(uuid,uuid,uuid,numeric,text,text,text) TO authenticated, service_role;
