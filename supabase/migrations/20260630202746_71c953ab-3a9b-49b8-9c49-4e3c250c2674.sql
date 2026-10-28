
-- Immutable audit-evidence packs for reconciliation runs.
-- Captures lineage, definition version, match/exception summary,
-- per-exception closure rationale, and audit-chain anchor.

CREATE TABLE IF NOT EXISTS public.recon_run_evidence_packs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  run_id UUID NOT NULL,
  definition_id UUID,
  definition_version INTEGER,
  pack_version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID,
  payload JSONB NOT NULL,
  prev_hash BYTEA,
  row_hash BYTEA NOT NULL,
  audit_anchor_id BIGINT,
  exception_count INTEGER NOT NULL DEFAULT 0,
  match_count INTEGER NOT NULL DEFAULT 0,
  closure_count INTEGER NOT NULL DEFAULT 0,
  storage_uri TEXT,
  UNIQUE(run_id, pack_version)
);

CREATE INDEX IF NOT EXISTS idx_rrep_tenant_run ON public.recon_run_evidence_packs(tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_rrep_generated_at ON public.recon_run_evidence_packs(generated_at DESC);

GRANT SELECT ON public.recon_run_evidence_packs TO authenticated;
GRANT ALL ON public.recon_run_evidence_packs TO service_role;

ALTER TABLE public.recon_run_evidence_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read evidence packs"
  ON public.recon_run_evidence_packs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid()));

CREATE POLICY "service role manages evidence packs"
  ON public.recon_run_evidence_packs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Immutability trigger: forbid UPDATE/DELETE outside of service_role.
CREATE OR REPLACE FUNCTION public.tg_recon_run_evidence_packs_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NULL
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') <> 'service_role' THEN
    RAISE EXCEPTION 'recon_run_evidence_packs is append-only (immutable)';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS recon_run_evidence_packs_no_update ON public.recon_run_evidence_packs;
CREATE TRIGGER recon_run_evidence_packs_no_update
  BEFORE UPDATE OR DELETE ON public.recon_run_evidence_packs
  FOR EACH ROW EXECUTE FUNCTION public.tg_recon_run_evidence_packs_immutable();

-- Generator: assembles the evidence pack for a completed run, hash-chains it,
-- and emits an audit_log entry. Idempotent per (run_id, pack_version).
CREATE OR REPLACE FUNCTION public.generate_recon_run_evidence_pack(_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_def RECORD;
  v_payload JSONB;
  v_exceptions JSONB;
  v_matches JSONB;
  v_lineage JSONB;
  v_prev BYTEA;
  v_hash BYTEA;
  v_id UUID;
  v_version INTEGER;
  v_audit_id BIGINT;
  v_exc_count INTEGER;
  v_match_count INTEGER;
  v_close_count INTEGER;
BEGIN
  SELECT * INTO v_run FROM public.recon_runs WHERE id = _run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recon_run % not found', _run_id; END IF;

  SELECT * INTO v_def FROM public.recon_definitions WHERE id = v_run.definition_id;

  -- Matches summary (capped detail; full export available via separate endpoint)
  SELECT
    COUNT(*),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'rule_id', rule_id, 'cardinality', cardinality,
      'score', score, 'confidence', confidence, 'match_type', match_type
    ) ORDER BY created_at) FILTER (WHERE rn <= 500), '[]'::jsonb)
  INTO v_match_count, v_matches
  FROM (
    SELECT *, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM public.recon_matches WHERE run_id = _run_id
  ) m;

  -- Exceptions with closure rationale + state transitions
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('closed','resolved','written_off')),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'side', e.side,
      'reason', e.reason,
      'severity', e.severity,
      'status', e.status,
      'lifecycle_state', e.lifecycle_state,
      'root_cause', e.root_cause,
      'close_reason', e.close_reason,
      'resolution_note', e.resolution_note,
      'resolved_by', e.resolved_by,
      'resolved_at', e.resolved_at,
      'write_off_amount', e.write_off_amount,
      'write_off_currency', e.write_off_currency,
      'write_off_gl_account', e.write_off_gl_account,
      'write_off_approved_by', e.write_off_approved_by,
      'transitions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'from', t.from_state, 'to', t.to_state, 'type', t.transition_type,
          'reason', t.reason, 'actor', t.actor_user_id, 'at', t.occurred_at
        ) ORDER BY t.occurred_at)
        FROM public.recon_exception_transitions t WHERE t.exception_id = e.id
      ), '[]'::jsonb)
    ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_exc_count, v_close_count, v_exceptions
  FROM public.recon_exceptions e WHERE e.run_id = _run_id;

  -- Lineage edges touching this run
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_kind', source_kind, 'source_ref', source_ref, 'source_label', source_label,
    'target_kind', target_kind, 'target_ref', target_ref, 'target_label', target_label,
    'transform', transform, 'evidence_hash', evidence_hash
  )), '[]'::jsonb)
  INTO v_lineage
  FROM public.data_lineage_edges
  WHERE tenant_id = v_run.tenant_id
    AND (source_ref = _run_id::text OR target_ref = _run_id::text);

  -- Next version number
  SELECT COALESCE(MAX(pack_version), 0) + 1 INTO v_version
  FROM public.recon_run_evidence_packs WHERE run_id = _run_id;

  v_payload := jsonb_build_object(
    'pack_kind', 'recon_run_evidence',
    'pack_spec', '1.0',
    'generated_at', now(),
    'run', jsonb_build_object(
      'id', v_run.id, 'tenant_id', v_run.tenant_id, 'status', v_run.status,
      'started_at', v_run.started_at, 'completed_at', v_run.completed_at,
      'matched_count', v_run.matched_count, 'exception_count', v_run.exception_count,
      'total_rows', v_run.total_rows, 'stats', v_run.stats,
      'run_by', v_run.run_by, 'run_uid', v_run.run_uid
    ),
    'definition', CASE WHEN v_def.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_def.id, 'name', v_def.name, 'recon_type', v_def.recon_type,
      'version', COALESCE((SELECT MAX(version_number) FROM public.recon_definition_versions WHERE definition_id = v_def.id), 1),
      'rules_hash', md5(coalesce(v_def.rules::text,'')),
      'sides', v_def.sides,
      'environment', v_def.environment
    ) END,
    'matches', jsonb_build_object('total', v_match_count, 'sample', v_matches),
    'exceptions', jsonb_build_object(
      'total', v_exc_count,
      'closed', v_close_count,
      'items', v_exceptions
    ),
    'lineage', v_lineage
  );

  SELECT row_hash INTO v_prev
  FROM public.recon_run_evidence_packs
  WHERE tenant_id = v_run.tenant_id
  ORDER BY generated_at DESC LIMIT 1;

  v_hash := digest(coalesce(encode(v_prev,'hex'),'') || v_payload::text, 'sha256');

  -- Append to audit_log (hash-chain anchor)
  INSERT INTO public.audit_log (
    tenant_id, scope, action, resource_type, resource_id, context
  ) VALUES (
    v_run.tenant_id, 'tenant', 'recon.evidence_pack.generated',
    'recon_run', _run_id::text,
    jsonb_build_object('pack_version', v_version, 'row_hash', encode(v_hash,'hex'))
  ) RETURNING id INTO v_audit_id;

  INSERT INTO public.recon_run_evidence_packs (
    tenant_id, run_id, definition_id, definition_version, pack_version,
    payload, prev_hash, row_hash, audit_anchor_id,
    exception_count, match_count, closure_count
  ) VALUES (
    v_run.tenant_id, _run_id, v_run.definition_id,
    (v_payload #>> '{definition,version}')::int,
    v_version, v_payload, v_prev, v_hash, v_audit_id,
    v_exc_count, v_match_count, v_close_count
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.generate_recon_run_evidence_pack(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_recon_run_evidence_pack(UUID) TO authenticated, service_role;

-- Auto-generate on run completion
CREATE OR REPLACE FUNCTION public.tg_recon_run_autopack()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('completed','failed','cancelled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    BEGIN
      PERFORM public.generate_recon_run_evidence_pack(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- never block the run on evidence-pack errors; surface via audit_log
      INSERT INTO public.audit_log (tenant_id, scope, action, resource_type, resource_id, context)
      VALUES (NEW.tenant_id, 'tenant', 'recon.evidence_pack.failed', 'recon_run', NEW.id::text,
              jsonb_build_object('error', SQLERRM));
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS recon_runs_autopack ON public.recon_runs;
CREATE TRIGGER recon_runs_autopack
  AFTER INSERT OR UPDATE OF status ON public.recon_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_recon_run_autopack();

-- Chain verifier (read-only)
CREATE OR REPLACE FUNCTION public.verify_recon_evidence_chain(_tenant_id UUID)
RETURNS TABLE(pack_id UUID, run_id UUID, pack_version INT, ok BOOLEAN, expected_hash TEXT, actual_hash TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_prev BYTEA; v_calc BYTEA;
BEGIN
  v_prev := NULL;
  FOR r IN
    SELECT * FROM public.recon_run_evidence_packs
    WHERE tenant_id = _tenant_id ORDER BY generated_at ASC
  LOOP
    v_calc := digest(coalesce(encode(v_prev,'hex'),'') || r.payload::text, 'sha256');
    pack_id := r.id; run_id := r.run_id; pack_version := r.pack_version;
    expected_hash := encode(v_calc,'hex');
    actual_hash := encode(r.row_hash,'hex');
    ok := (v_calc = r.row_hash);
    v_prev := r.row_hash;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.verify_recon_evidence_chain(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_recon_evidence_chain(UUID) TO authenticated, service_role;
