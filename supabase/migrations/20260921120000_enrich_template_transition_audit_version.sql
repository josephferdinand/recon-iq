-- FVI-CX-099: enrich transition audit with explicit immutable version correlation.
-- Before: transition_tenant_template_atomic logged only status in mkt_audit_log.before/after.
-- After: each transition event records version_id, semver and source_recon_definition_id
-- from the current immutable version row, so reviewers need not infer the reviewed version.
-- No historical rows are mutated; only future transition events carry the enriched payload.
-- Existing status values remain; audit IDs stay UUIDs (not chronological counters).

CREATE OR REPLACE FUNCTION public.transition_tenant_template_atomic(
  _tenant_id uuid,_tenant_template_id uuid,_action text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); row public.tenant_templates%ROWTYPE; version_row public.tenant_template_versions%ROWTYPE; next_status public.mkt_tpl_version_status;
BEGIN
  IF actor IS NULL OR NOT public.mkt_is_tenant_admin(_tenant_id) THEN RAISE EXCEPTION 'active tenant administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO row FROM public.tenant_templates WHERE id=_tenant_template_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant template not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO version_row FROM public.tenant_template_versions
  WHERE tenant_template_id=row.id AND tenant_id=_tenant_id AND semver=row.current_semver AND spec=row.spec;
  IF NOT FOUND OR version_row.created_by IS NULL THEN
    RAISE EXCEPTION 'save a governed reconciliation version before review' USING ERRCODE='22023';
  END IF;
  IF _action='submit' AND row.status='draft' THEN next_status:='review';
  ELSIF _action='approve' AND row.status='review' AND actor<>row.submitted_by AND actor<>version_row.created_by THEN next_status:='approved';
  ELSIF _action='reject' AND row.status='review' AND actor<>row.submitted_by THEN next_status:='draft';
  ELSIF _action='publish' AND row.status='approved' AND row.approved_by IS NOT NULL
    AND row.approved_by<>version_row.created_by AND row.approved_by<>row.submitted_by THEN next_status:='published';
  ELSIF _action='unpublish' AND row.status='published' THEN next_status:='approved';
  ELSE RAISE EXCEPTION 'invalid lifecycle transition or dual-control violation' USING ERRCODE='P0001';
  END IF;
  UPDATE public.tenant_templates SET status=next_status,
    submitted_by=CASE WHEN _action='submit' THEN actor WHEN _action='reject' THEN NULL ELSE submitted_by END,
    submitted_at=CASE WHEN _action='submit' THEN now() WHEN _action='reject' THEN NULL ELSE submitted_at END,
    approved_by=CASE WHEN _action='approve' THEN actor WHEN _action IN ('reject','submit') THEN NULL ELSE approved_by END,
    approved_at=CASE WHEN _action='approve' THEN now() WHEN _action IN ('reject','submit') THEN NULL ELSE approved_at END
  WHERE id=row.id;
  INSERT INTO public.mkt_audit_log(actor_id,tenant_id,entity_type,entity_id,action,before,after)
  VALUES (actor,_tenant_id,'tenant_template',row.id,_action,
    jsonb_build_object('status',row.status,'version_id',version_row.id,'semver',version_row.semver,'source_recon_definition_id',version_row.source_recon_definition_id),
    jsonb_build_object('status',next_status,'version_id',version_row.id,'semver',version_row.semver,'source_recon_definition_id',version_row.source_recon_definition_id));
  RETURN next_status::text;
END;
$$;

-- Preserve existing grants (authenticated + service_role) — function was already granted.
REVOKE ALL ON FUNCTION public.transition_tenant_template_atomic(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_tenant_template_atomic(uuid,uuid,text) TO authenticated,service_role;

COMMENT ON FUNCTION public.transition_tenant_template_atomic(uuid,uuid,text) IS 'FVI-CX-099 enriched: transition audit now carries explicit version_id/semver for regulator traceability; immutable version history unchanged.';
