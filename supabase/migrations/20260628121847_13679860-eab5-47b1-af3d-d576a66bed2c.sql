
-- Transition guard: every status change must go through advance_signoff
CREATE OR REPLACE FUNCTION public.tg_signoff_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('app.signoff_advance_ok', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'eod_signoffs.status must be changed via advance_signoff() (got %->%)',
        OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eod_signoffs_status_guard ON public.eod_signoffs;
CREATE TRIGGER trg_eod_signoffs_status_guard
  BEFORE UPDATE ON public.eod_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.tg_signoff_status_guard();

-- State machine: who can move what to where
CREATE OR REPLACE FUNCTION public.advance_signoff(
  _signoff_id uuid,
  _to_status text,
  _comment text DEFAULT NULL,
  _evidence_hash text DEFAULT NULL
)
RETURNS public.eod_signoffs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.eod_signoffs%ROWTYPE;
  v_is_admin boolean := false;
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_row FROM public.eod_signoffs WHERE id = _signoff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sign-off % not found', _signoff_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid) THEN
    RAISE EXCEPTION 'Forbidden: not a tenant member';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = v_row.tenant_id
                   AND tm.user_id = v_uid
                   AND tm.role = 'tenant_admin') INTO v_is_admin;

  IF v_row.locked AND _to_status <> 'reopened' THEN
    RAISE EXCEPTION 'Sign-off is locked; only a reopen is permitted';
  END IF;

  -- Transition matrix + role gates
  IF v_row.status = 'draft' AND _to_status = 'prepared' THEN
    v_allowed := true;
    v_row.prepared_by := v_uid;
    v_row.prepared_at := now();
  ELSIF v_row.status = 'prepared' AND _to_status = 'reviewed' THEN
    IF v_row.prepared_by = v_uid THEN
      RAISE EXCEPTION 'Separation of duties: preparer cannot review';
    END IF;
    v_allowed := true;
    v_row.reviewed_by := v_uid;
    v_row.reviewed_at := now();
  ELSIF v_row.status = 'reviewed' AND _to_status = 'certified' THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only tenant admins may certify';
    END IF;
    IF v_row.prepared_by = v_uid OR v_row.reviewed_by = v_uid THEN
      RAISE EXCEPTION 'Separation of duties: certifier must differ from preparer and reviewer';
    END IF;
    v_allowed := true;
    v_row.approved_by := v_uid;
    v_row.approved_at := now();
    v_row.certified_at := now();
    v_row.certified_hash := COALESCE(_evidence_hash, encode(digest(v_row.id::text || now()::text, 'sha256'), 'hex'));
    v_row.locked := true;
  ELSIF _to_status = 'rejected' AND v_row.status IN ('prepared','reviewed') THEN
    v_allowed := true;
    v_row.rejection_reason := _comment;
  ELSIF _to_status = 'reopened' AND v_row.status IN ('certified','rejected') THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only tenant admins may reopen a sign-off';
    END IF;
    v_allowed := true;
    v_row.locked := false;
    v_row.reopened_count := COALESCE(v_row.reopened_count, 0) + 1;
    v_row.certified_at := NULL;
    v_row.certified_hash := NULL;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Illegal transition: % -> %', v_row.status, _to_status;
  END IF;

  PERFORM set_config('app.signoff_advance_ok', 'on', true);

  UPDATE public.eod_signoffs SET
    status            = _to_status,
    prepared_by       = v_row.prepared_by,
    prepared_at       = v_row.prepared_at,
    reviewed_by       = v_row.reviewed_by,
    reviewed_at       = v_row.reviewed_at,
    approved_by       = v_row.approved_by,
    approved_at       = v_row.approved_at,
    certified_at      = v_row.certified_at,
    certified_hash    = v_row.certified_hash,
    rejection_reason  = v_row.rejection_reason,
    reopened_count    = v_row.reopened_count,
    locked            = v_row.locked,
    version           = v_row.version + 1,
    updated_at        = now()
  WHERE id = _signoff_id
  RETURNING * INTO v_row;

  PERFORM set_config('app.signoff_advance_ok', 'off', true);

  INSERT INTO public.signoff_transitions
    (tenant_id, signoff_id, from_status, to_status, actor, comment, evidence_hash)
  VALUES
    (v_row.tenant_id, _signoff_id, OLD_STATUS_VAR(), _to_status, v_uid, _comment, _evidence_hash);

  RETURN v_row;
EXCEPTION WHEN undefined_function THEN
  RAISE;
END;
$$;

-- Helper that returns the previous status; avoids relying on FOUND/OLD in non-trigger context
CREATE OR REPLACE FUNCTION public.OLD_STATUS_VAR()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;

-- Rewrite advance_signoff to pass the actual prior status to the transition log
CREATE OR REPLACE FUNCTION public.advance_signoff(
  _signoff_id uuid,
  _to_status text,
  _comment text DEFAULT NULL,
  _evidence_hash text DEFAULT NULL
)
RETURNS public.eod_signoffs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.eod_signoffs%ROWTYPE;
  v_prior_status text;
  v_is_admin boolean := false;
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_row FROM public.eod_signoffs WHERE id = _signoff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sign-off % not found', _signoff_id;
  END IF;
  v_prior_status := v_row.status;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid) THEN
    RAISE EXCEPTION 'Forbidden: not a tenant member';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = v_row.tenant_id
                   AND tm.user_id = v_uid
                   AND tm.role = 'tenant_admin') INTO v_is_admin;

  IF v_row.locked AND _to_status <> 'reopened' THEN
    RAISE EXCEPTION 'Sign-off is locked; only a reopen is permitted';
  END IF;

  IF v_row.status = 'draft' AND _to_status = 'prepared' THEN
    v_allowed := true;
    v_row.prepared_by := v_uid;
    v_row.prepared_at := now();
  ELSIF v_row.status = 'prepared' AND _to_status = 'reviewed' THEN
    IF v_row.prepared_by = v_uid THEN
      RAISE EXCEPTION 'Separation of duties: preparer cannot review';
    END IF;
    v_allowed := true;
    v_row.reviewed_by := v_uid;
    v_row.reviewed_at := now();
  ELSIF v_row.status = 'reviewed' AND _to_status = 'certified' THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only tenant admins may certify';
    END IF;
    IF v_row.prepared_by = v_uid OR v_row.reviewed_by = v_uid THEN
      RAISE EXCEPTION 'Separation of duties: certifier must differ from preparer and reviewer';
    END IF;
    v_allowed := true;
    v_row.approved_by := v_uid;
    v_row.approved_at := now();
    v_row.certified_at := now();
    v_row.certified_hash := COALESCE(_evidence_hash, encode(digest(v_row.id::text || now()::text, 'sha256'), 'hex'));
    v_row.locked := true;
  ELSIF _to_status = 'rejected' AND v_row.status IN ('prepared','reviewed') THEN
    v_allowed := true;
    v_row.rejection_reason := _comment;
  ELSIF _to_status = 'reopened' AND v_row.status IN ('certified','rejected') THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only tenant admins may reopen a sign-off';
    END IF;
    v_allowed := true;
    v_row.locked := false;
    v_row.reopened_count := COALESCE(v_row.reopened_count, 0) + 1;
    v_row.certified_at := NULL;
    v_row.certified_hash := NULL;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Illegal transition: % -> %', v_row.status, _to_status;
  END IF;

  PERFORM set_config('app.signoff_advance_ok', 'on', true);

  UPDATE public.eod_signoffs SET
    status            = _to_status,
    prepared_by       = v_row.prepared_by,
    prepared_at       = v_row.prepared_at,
    reviewed_by       = v_row.reviewed_by,
    reviewed_at       = v_row.reviewed_at,
    approved_by       = v_row.approved_by,
    approved_at       = v_row.approved_at,
    certified_at      = v_row.certified_at,
    certified_hash    = v_row.certified_hash,
    rejection_reason  = v_row.rejection_reason,
    reopened_count    = v_row.reopened_count,
    locked            = v_row.locked,
    version           = v_row.version + 1,
    updated_at        = now()
  WHERE id = _signoff_id
  RETURNING * INTO v_row;

  PERFORM set_config('app.signoff_advance_ok', 'off', true);

  INSERT INTO public.signoff_transitions
    (tenant_id, signoff_id, from_status, to_status, actor, comment, evidence_hash)
  VALUES
    (v_row.tenant_id, _signoff_id, v_prior_status, _to_status, v_uid, _comment, _evidence_hash);

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.advance_signoff(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_signoff(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_allowed_signoff_transitions(_signoff_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.eod_signoffs%ROWTYPE;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_out text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_row FROM public.eod_signoffs WHERE id = _signoff_id;
  IF NOT FOUND THEN RETURN v_out; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid) THEN
    RETURN v_out;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.tenant_members tm
                 WHERE tm.tenant_id = v_row.tenant_id
                   AND tm.user_id = v_uid
                   AND tm.role = 'tenant_admin') INTO v_is_admin;

  IF v_row.locked THEN
    IF v_is_admin THEN v_out := v_out || 'reopened'; END IF;
    RETURN v_out;
  END IF;

  IF v_row.status = 'draft' THEN
    v_out := v_out || 'prepared';
  ELSIF v_row.status = 'prepared' THEN
    IF v_row.prepared_by IS DISTINCT FROM v_uid THEN
      v_out := v_out || 'reviewed';
    END IF;
    v_out := v_out || 'rejected';
  ELSIF v_row.status = 'reviewed' THEN
    IF v_is_admin AND v_row.prepared_by IS DISTINCT FROM v_uid AND v_row.reviewed_by IS DISTINCT FROM v_uid THEN
      v_out := v_out || 'certified';
    END IF;
    v_out := v_out || 'rejected';
  ELSIF v_row.status = 'rejected' THEN
    IF v_is_admin THEN v_out := v_out || 'reopened'; END IF;
  END IF;

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_allowed_signoff_transitions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_allowed_signoff_transitions(uuid) TO authenticated;
