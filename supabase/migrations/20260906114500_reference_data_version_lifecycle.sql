-- Governed Reference Data lifecycle: stage, submit, four-eyes decision,
-- effective-date resolution, published projection and rollback-as-new-version.

CREATE OR REPLACE FUNCTION public.stage_reference_data_version(
  _tenant_id uuid,
  _table_id uuid,
  _rows jsonb,
  _effective_from date,
  _effective_to date,
  _change_note text
)
RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor uuid := auth.uid();
  v_version_id uuid;
  v_version_number integer;
  v_row_count integer;
  v_content_sha256 text;
BEGIN
  IF actor IS NULL OR NOT (
    public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
    OR public.is_platform_admin(actor)
  ) THEN
    RAISE EXCEPTION 'Forbidden: analyst or admin required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reference_data_tables
    WHERE id = _table_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Reference table not found';
  END IF;
  IF _effective_from IS NULL OR (_effective_to IS NOT NULL AND _effective_to < _effective_from) THEN
    RAISE EXCEPTION 'Invalid effective date range';
  END IF;
  IF length(btrim(coalesce(_change_note, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Change note must contain between 3 and 1000 characters';
  END IF;
  IF jsonb_typeof(_rows) <> 'array'
     OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Reference version must contain between 1 and 10000 rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rows) AS item
    WHERE jsonb_typeof(item) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Every reference version row must be a JSON object';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_table_id::text, 0));
  SELECT coalesce(max(rdv.version_number), 0) + 1
  INTO v_version_number
  FROM public.reference_data_versions rdv
  WHERE rdv.table_id = _table_id;

  INSERT INTO public.reference_data_versions(
    tenant_id, table_id, version_number, effective_from, effective_to,
    change_note, created_by
  ) VALUES (
    _tenant_id, _table_id, v_version_number, _effective_from, _effective_to,
    btrim(_change_note), actor
  ) RETURNING id INTO v_version_id;

  INSERT INTO public.reference_data_version_rows(
    version_id, tenant_id, table_id, row_data, key_hash
  )
  SELECT v_version_id, _tenant_id, _table_id, item, repeat('0', 64)
  FROM jsonb_array_elements(_rows) AS item;

  SELECT count(*)::integer,
         encode(digest(string_agg(r.key_hash || ':' || r.row_data::text, '|' ORDER BY r.key_hash), 'sha256'), 'hex')
  INTO v_row_count, v_content_sha256
  FROM public.reference_data_version_rows r
  WHERE r.version_id = v_version_id;

  UPDATE public.reference_data_versions rdv
  SET row_count = v_row_count, content_sha256 = v_content_sha256
  WHERE rdv.id = v_version_id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    actor, _tenant_id, 'tenant', 'reference_data.version.stage',
    'reference_data_versions', v_version_id::text,
    jsonb_build_object('table_id', _table_id, 'version', v_version_number,
      'rows', v_row_count, 'content_sha256', v_content_sha256,
      'effective_from', _effective_from, 'effective_to', _effective_to)
  );

  version_id := v_version_id;
  version_number := v_version_number;
  row_count := v_row_count;
  content_sha256 := v_content_sha256;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_reference_data_version(
  _tenant_id uuid,
  _version_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  v_version public.reference_data_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_version
  FROM public.reference_data_versions
  WHERE id = _version_id AND tenant_id = _tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reference version not found'; END IF;
  IF actor IS NULL OR actor <> v_version.created_by THEN
    RAISE EXCEPTION 'Only the version maker may submit it' USING ERRCODE = '42501';
  END IF;
  IF v_version.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft may be submitted'; END IF;
  IF v_version.row_count < 1 OR v_version.content_sha256 IS NULL THEN
    RAISE EXCEPTION 'Reference version has no verified content';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_version.table_id::text, 0));
  UPDATE public.reference_data_versions
  SET status = 'pending_approval', submitted_by = actor, submitted_at = now()
  WHERE id = _version_id;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    actor, _tenant_id, 'tenant', 'reference_data.version.submit',
    'reference_data_versions', _version_id::text,
    jsonb_build_object('table_id', v_version.table_id, 'version', v_version.version_number,
      'content_sha256', v_version.content_sha256)
  );
  RETURN 'pending_approval';
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_reference_data_version(
  _tenant_id uuid,
  _version_id uuid,
  _approve boolean,
  _reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor uuid := auth.uid();
  v_version public.reference_data_versions%ROWTYPE;
  v_prior public.reference_data_versions%ROWTYPE;
  v_is_effective_now boolean;
BEGIN
  SELECT * INTO v_version
  FROM public.reference_data_versions
  WHERE id = _version_id AND tenant_id = _tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reference version not found'; END IF;
  IF actor IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = actor AND tm.tenant_id = _tenant_id
        AND tm.role = 'tenant_admin' AND tm.active
    ) OR public.is_platform_admin(actor)
  ) THEN
    RAISE EXCEPTION 'Forbidden: active tenant administrator required' USING ERRCODE = '42501';
  END IF;
  IF actor = v_version.created_by OR actor = v_version.submitted_by THEN
    RAISE EXCEPTION 'Maker cannot approve or reject their own version' USING ERRCODE = '42501';
  END IF;
  IF v_version.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Only a pending version may be decided';
  END IF;
  IF NOT _approve AND length(btrim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Rejection reason must contain at least 3 characters';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_version.table_id::text, 0));
  IF NOT _approve THEN
    UPDATE public.reference_data_versions
    SET status = 'rejected', decided_by = actor, decided_at = now(),
        decision_reason = btrim(_reason)
    WHERE id = _version_id;
    INSERT INTO public.audit_log(
      actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
    ) VALUES (
      actor, _tenant_id, 'tenant', 'reference_data.version.reject',
      'reference_data_versions', _version_id::text,
      jsonb_build_object('table_id', v_version.table_id, 'version', v_version.version_number,
        'reason', btrim(_reason), 'content_sha256', v_version.content_sha256)
    );
    RETURN 'rejected';
  END IF;

  SELECT * INTO v_prior
  FROM public.reference_data_versions rdv
  WHERE rdv.table_id = v_version.table_id
    AND rdv.status IN ('published','superseded')
  ORDER BY rdv.effective_from DESC, rdv.version_number DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_version.effective_from <= v_prior.effective_from THEN
    RAISE EXCEPTION 'Approved versions must advance the effective date';
  END IF;
  IF FOUND AND (v_prior.effective_to IS NULL OR v_prior.effective_to >= v_version.effective_from) THEN
    UPDATE public.reference_data_versions
    SET effective_to = v_version.effective_from - 1
    WHERE id = v_prior.id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reference_data_versions rdv
    WHERE rdv.table_id = v_version.table_id
      AND rdv.id <> v_version.id
      AND rdv.id <> v_prior.id
      AND rdv.status IN ('published','superseded')
      AND daterange(rdv.effective_from, coalesce(rdv.effective_to, 'infinity'::date), '[]')
          && daterange(v_version.effective_from, coalesce(v_version.effective_to, 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'Published reference version effective dates overlap';
  END IF;

  UPDATE public.reference_data_versions
  SET status = 'published', decided_by = actor, decided_at = now(),
      decision_reason = nullif(btrim(coalesce(_reason, '')), ''), published_at = now()
  WHERE id = _version_id;

  v_is_effective_now := v_version.effective_from <= current_date
    AND (v_version.effective_to IS NULL OR v_version.effective_to >= current_date);
  IF v_is_effective_now THEN
    UPDATE public.reference_data_versions
    SET status = 'superseded'
    WHERE table_id = v_version.table_id AND id <> v_version.id AND status = 'published'
      AND effective_from <= current_date
      AND (effective_to IS NULL OR effective_to >= current_date);

    DELETE FROM public.reference_data_rows
    WHERE table_id = v_version.table_id AND tenant_id = _tenant_id;
    INSERT INTO public.reference_data_rows(table_id, tenant_id, row_data, version_id)
    SELECT v_version.table_id, _tenant_id, r.row_data, v_version.id
    FROM public.reference_data_version_rows r
    WHERE r.version_id = v_version.id;
    UPDATE public.reference_data_tables
    SET row_count = v_version.row_count, published_version_id = v_version.id
    WHERE id = v_version.table_id AND tenant_id = _tenant_id;
  END IF;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    actor, _tenant_id, 'tenant', 'reference_data.version.publish',
    'reference_data_versions', _version_id::text,
    jsonb_build_object('table_id', v_version.table_id, 'version', v_version.version_number,
      'rows', v_version.row_count, 'content_sha256', v_version.content_sha256,
      'effective_from', v_version.effective_from, 'effective_to', v_version.effective_to,
      'projection_updated', v_is_effective_now)
  );
  RETURN 'published';
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_reference_data_version(
  _tenant_id uuid,
  _table_id uuid,
  _as_of date DEFAULT current_date
)
RETURNS TABLE(
  resolved_version_id uuid,
  resolved_version_number integer,
  resolved_content_sha256 text,
  resolved_rows jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  matches integer;
BEGIN
  IF actor IS NULL OR NOT (
    public.is_tenant_member(actor, _tenant_id) OR public.is_platform_admin(actor)
  ) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reference_data_tables
    WHERE id = _table_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Reference table not found';
  END IF;

  SELECT count(*)::integer INTO matches
  FROM public.reference_data_versions rdv
  WHERE rdv.table_id = _table_id AND rdv.tenant_id = _tenant_id
    AND rdv.status IN ('published','superseded')
    AND rdv.effective_from <= _as_of
    AND (rdv.effective_to IS NULL OR rdv.effective_to >= _as_of);
  IF matches = 0 THEN RAISE EXCEPTION 'No published reference version for requested date'; END IF;
  IF matches > 1 THEN RAISE EXCEPTION 'Ambiguous published reference versions for requested date'; END IF;

  RETURN QUERY
  SELECT rdv.id, rdv.version_number, rdv.content_sha256,
         coalesce(jsonb_agg(r.row_data ORDER BY r.key_hash), '[]'::jsonb)
  FROM public.reference_data_versions rdv
  JOIN public.reference_data_version_rows r ON r.version_id = rdv.id
  WHERE rdv.table_id = _table_id AND rdv.tenant_id = _tenant_id
    AND rdv.status IN ('published','superseded')
    AND rdv.effective_from <= _as_of
    AND (rdv.effective_to IS NULL OR rdv.effective_to >= _as_of)
  GROUP BY rdv.id, rdv.version_number, rdv.content_sha256;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_reference_data_rollback(
  _tenant_id uuid,
  _table_id uuid,
  _source_version_id uuid,
  _effective_from date,
  _reason text
)
RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  source_version public.reference_data_versions%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = actor AND tm.tenant_id = _tenant_id
        AND tm.role = 'tenant_admin' AND tm.active
    ) OR public.is_platform_admin(actor)
  ) THEN
    RAISE EXCEPTION 'Forbidden: active tenant administrator required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Rollback reason must contain at least 3 characters';
  END IF;
  SELECT * INTO source_version
  FROM public.reference_data_versions
  WHERE id = _source_version_id AND table_id = _table_id AND tenant_id = _tenant_id
    AND status IN ('published','superseded');
  IF NOT FOUND THEN RAISE EXCEPTION 'Published source version not found'; END IF;

  RETURN QUERY
  SELECT staged.version_id, staged.version_number, staged.row_count, staged.content_sha256
  FROM public.stage_reference_data_version(
    _tenant_id,
    _table_id,
    (SELECT jsonb_agg(r.row_data ORDER BY r.key_hash)
     FROM public.reference_data_version_rows r WHERE r.version_id = _source_version_id),
    _effective_from,
    NULL,
    format('Rollback to version %s: %s', source_version.version_number, btrim(_reason))
  ) staged;

  INSERT INTO public.audit_log(
    actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    actor, _tenant_id, 'tenant', 'reference_data.version.rollback_requested',
    'reference_data_versions', _source_version_id::text,
    jsonb_build_object('table_id', _table_id, 'source_version', source_version.version_number,
      'effective_from', _effective_from, 'reason', btrim(_reason))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_reference_data_version_for_execution(
  _tenant_id uuid,
  _table_id uuid,
  _as_of date DEFAULT current_date
)
RETURNS TABLE(
  resolved_version_id uuid,
  resolved_version_number integer,
  resolved_content_sha256 text,
  resolved_rows jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matches integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.reference_data_tables
    WHERE id = _table_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Reference table not found';
  END IF;
  SELECT count(*)::integer INTO matches
  FROM public.reference_data_versions rdv
  WHERE rdv.table_id = _table_id AND rdv.tenant_id = _tenant_id
    AND rdv.status IN ('published','superseded')
    AND rdv.effective_from <= _as_of
    AND (rdv.effective_to IS NULL OR rdv.effective_to >= _as_of);
  IF matches = 0 THEN RAISE EXCEPTION 'No published reference version for requested date'; END IF;
  IF matches > 1 THEN RAISE EXCEPTION 'Ambiguous published reference versions for requested date'; END IF;

  RETURN QUERY
  SELECT rdv.id, rdv.version_number, rdv.content_sha256,
         coalesce(jsonb_agg(r.row_data ORDER BY r.key_hash), '[]'::jsonb)
  FROM public.reference_data_versions rdv
  JOIN public.reference_data_version_rows r ON r.version_id = rdv.id
  WHERE rdv.table_id = _table_id AND rdv.tenant_id = _tenant_id
    AND rdv.status IN ('published','superseded')
    AND rdv.effective_from <= _as_of
    AND (rdv.effective_to IS NULL OR rdv.effective_to >= _as_of)
  GROUP BY rdv.id, rdv.version_number, rdv.content_sha256;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_reference_data_version_for_api(
  _tenant_id uuid,
  _table_id uuid,
  _rows jsonb,
  _effective_from date,
  _effective_to date,
  _change_note text,
  _actor_user_id uuid
)
RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN RAISE EXCEPTION 'Accountable actor is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  RETURN QUERY SELECT * FROM public.stage_reference_data_version(
    _tenant_id, _table_id, _rows, _effective_from, _effective_to, _change_note
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_reference_data_version_for_api(
  _tenant_id uuid,
  _version_id uuid,
  _actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN RAISE EXCEPTION 'Accountable actor is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  RETURN public.submit_reference_data_version(_tenant_id, _version_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_reference_data_version_for_api(
  _tenant_id uuid,
  _version_id uuid,
  _approve boolean,
  _reason text,
  _actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN RAISE EXCEPTION 'Accountable actor is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  RETURN public.decide_reference_data_version(_tenant_id, _version_id, _approve, _reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_reference_data_rollback_for_api(
  _tenant_id uuid,
  _table_id uuid,
  _source_version_id uuid,
  _effective_from date,
  _reason text,
  _actor_user_id uuid
)
RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN RAISE EXCEPTION 'Accountable actor is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _actor_user_id::text, true);
  RETURN QUERY SELECT * FROM public.request_reference_data_rollback(
    _tenant_id, _table_id, _source_version_id, _effective_from, _reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_reference_data_version(uuid,uuid,jsonb,date,date,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_reference_data_version(uuid,uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_reference_data_version(uuid,uuid,boolean,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_reference_data_version(uuid,uuid,date)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_reference_data_rollback(uuid,uuid,uuid,date,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_reference_data_version_for_execution(uuid,uuid,date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_reference_data_version_for_api(uuid,uuid,jsonb,date,date,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_reference_data_version_for_api(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_reference_data_version_for_api(uuid,uuid,boolean,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_reference_data_rollback_for_api(uuid,uuid,uuid,date,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_reference_data_version(uuid,uuid,jsonb,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reference_data_version(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_reference_data_version(uuid,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_reference_data_version(uuid,uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_reference_data_rollback(uuid,uuid,uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_reference_data_version_for_execution(uuid,uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_reference_data_version_for_api(uuid,uuid,jsonb,date,date,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_reference_data_version_for_api(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_reference_data_version_for_api(uuid,uuid,boolean,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_reference_data_rollback_for_api(uuid,uuid,uuid,date,text,uuid) TO service_role;

-- Published projection and versioned table schema are controlled only by the
-- governed lifecycle. Retain the earlier bulk RPC as a service-only backfill.
DROP POLICY IF EXISTS "rdr_write" ON public.reference_data_rows;
REVOKE INSERT, UPDATE, DELETE ON public.reference_data_rows FROM authenticated;
REVOKE ALL ON FUNCTION public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_reference_data(uuid,uuid,jsonb,boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_reference_data_table_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reference_data_versions rdv WHERE rdv.table_id = OLD.id
  ) AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.key_columns IS DISTINCT FROM OLD.key_columns
    OR NEW.value_columns IS DISTINCT FROM OLD.value_columns
  ) THEN
    RAISE EXCEPTION 'Versioned reference table tenant and columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_reference_data_table_version_guard()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reference_data_table_version_guard
  BEFORE UPDATE OF tenant_id, key_columns, value_columns
  ON public.reference_data_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_reference_data_table_version_guard();
