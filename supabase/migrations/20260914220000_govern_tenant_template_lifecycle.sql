-- Govern My Templates as real, versioned reconciliation snapshots.

ALTER TABLE public.tenant_templates
  ADD COLUMN IF NOT EXISTS source_recon_definition_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.tenant_template_versions
  ADD COLUMN IF NOT EXISTS status public.mkt_tpl_version_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source_recon_definition_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL;

ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS tenant_template_id uuid REFERENCES public.tenant_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS recon_definitions_tenant_template_idx
  ON public.recon_definitions(tenant_id,tenant_template_id) WHERE tenant_template_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mkt_is_tenant_admin(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id=_tenant_id AND tm.user_id=auth.uid()
      AND tm.role='tenant_admin'::public.tenant_role AND tm.active
  ) OR public.is_platform_admin(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.mkt_is_tenant_member(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id=_tenant_id AND tm.user_id=auth.uid() AND tm.active
  ) OR public.is_platform_admin(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.guard_tenant_template_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND (
    TG_OP <> 'INSERT' OR NEW.status <> 'draft' OR NEW.created_by IS DISTINCT FROM auth.uid()
    OR NEW.submitted_by IS NOT NULL OR NEW.submitted_at IS NOT NULL
    OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
    OR NEW.source_recon_definition_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'tenant template lifecycle requires governed action' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_tenant_template_lifecycle ON public.tenant_templates;
CREATE TRIGGER guard_tenant_template_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_template_lifecycle();

-- Draft marketplace imports remain possible. All later edits and version
-- creation must use the atomic functions; RLS alone does not enforce approval.
REVOKE UPDATE,DELETE ON public.tenant_templates FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.tenant_template_versions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guard_tenant_template_version_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'tenant template versions are immutable' USING ERRCODE='42501';
END;
$$;
DROP TRIGGER IF EXISTS guard_tenant_template_version_immutable ON public.tenant_template_versions;
CREATE TRIGGER guard_tenant_template_version_immutable
  BEFORE UPDATE OR DELETE ON public.tenant_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_template_version_immutable();

CREATE OR REPLACE FUNCTION public.save_tenant_template_from_recon_atomic(
  _tenant_id uuid,
  _recon_definition_id uuid,
  _title text,
  _description text DEFAULT NULL,
  _tenant_template_id uuid DEFAULT NULL,
  _semver text DEFAULT '1.0.0',
  _changelog text DEFAULT NULL
) RETURNS TABLE(tenant_template_id uuid, version_id uuid, saved_semver text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor uuid:=auth.uid();
  recon_row public.recon_definitions%ROWTYPE;
  template_row public.tenant_templates%ROWTYPE;
  version_row public.tenant_template_versions%ROWTYPE;
  snapshot jsonb;
BEGIN
  IF actor IS NULL OR NOT public.mkt_is_tenant_admin(_tenant_id) THEN
    RAISE EXCEPTION 'active tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 2 AND 120
     OR _semver !~ '^[0-9]+\.[0-9]+\.[0-9]+$' THEN
    RAISE EXCEPTION 'invalid template title or semantic version' USING ERRCODE='22023';
  END IF;
  SELECT * INTO recon_row FROM public.recon_definitions
  WHERE id=_recon_definition_id AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant reconciliation not found' USING ERRCODE='P0002'; END IF;
  snapshot:=jsonb_build_object(
    'kind','reconciliation','schema_version',1,'source_recon_definition_id',recon_row.id,
    'source_recon_code',recon_row.recon_code,'recon_type',recon_row.recon_type,
    'description',recon_row.description,'sides',recon_row.sides,'rules',recon_row.rules
  );

  IF _tenant_template_id IS NULL THEN
    INSERT INTO public.tenant_templates(
      tenant_id,title,description,spec,current_semver,status,created_by,source_recon_definition_id
    ) VALUES (_tenant_id,btrim(_title),_description,snapshot,_semver,'draft',actor,recon_row.id)
    RETURNING * INTO template_row;
  ELSE
    SELECT * INTO template_row FROM public.tenant_templates
    WHERE id=_tenant_template_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'tenant template not found' USING ERRCODE='P0002'; END IF;
    UPDATE public.tenant_templates SET
      title=btrim(_title),description=_description,spec=snapshot,current_semver=_semver,status='draft',
      source_recon_definition_id=recon_row.id,submitted_by=NULL,submitted_at=NULL,approved_by=NULL,approved_at=NULL
    WHERE id=template_row.id RETURNING * INTO template_row;
  END IF;

  INSERT INTO public.tenant_template_versions(
    tenant_template_id,tenant_id,semver,spec,changelog,created_by,status,source_recon_definition_id
  ) VALUES (template_row.id,_tenant_id,_semver,snapshot,_changelog,actor,'draft',recon_row.id)
  RETURNING * INTO version_row;
  INSERT INTO public.mkt_audit_log(actor_id,tenant_id,entity_type,entity_id,action,after)
  VALUES (actor,_tenant_id,'tenant_template',template_row.id,
    CASE WHEN _tenant_template_id IS NULL THEN 'create' ELSE 'version' END,
    jsonb_build_object('semver',_semver,'version_id',version_row.id,'source_recon_id',recon_row.id));
  RETURN QUERY SELECT template_row.id,version_row.id,_semver;
END;
$$;

CREATE OR REPLACE FUNCTION public.clone_tenant_template_atomic(
  _tenant_id uuid,_source_template_id uuid,_title text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); source_row public.tenant_templates%ROWTYPE; clone_row public.tenant_templates%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.mkt_is_tenant_admin(_tenant_id) THEN RAISE EXCEPTION 'active tenant administrator required' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'invalid template title' USING ERRCODE='22023'; END IF;
  SELECT * INTO source_row FROM public.tenant_templates WHERE id=_source_template_id AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant template not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.tenant_templates(tenant_id,title,description,spec,current_semver,status,created_by,source_recon_definition_id)
  VALUES (_tenant_id,btrim(_title),source_row.description,source_row.spec,'1.0.0','draft',actor,source_row.source_recon_definition_id)
  RETURNING * INTO clone_row;
  INSERT INTO public.tenant_template_versions(tenant_template_id,tenant_id,semver,spec,changelog,created_by,status,source_recon_definition_id)
  VALUES (clone_row.id,_tenant_id,'1.0.0',source_row.spec,'Cloned from tenant template '||source_row.id::text,actor,'draft',source_row.source_recon_definition_id);
  INSERT INTO public.mkt_audit_log(actor_id,tenant_id,entity_type,entity_id,action,after)
  VALUES (actor,_tenant_id,'tenant_template',clone_row.id,'clone',jsonb_build_object('source_template_id',source_row.id));
  RETURN clone_row.id;
END;
$$;

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
    jsonb_build_object('status',row.status),jsonb_build_object('status',next_status));
  RETURN next_status::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.instantiate_tenant_template_atomic(
  _tenant_id uuid,_tenant_template_id uuid,_name text
) RETURNS TABLE(recon_definition_id uuid,recon_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); template_row public.tenant_templates%ROWTYPE; definition_row public.recon_definitions%ROWTYPE; source_count integer; leg_count integer;
BEGIN
  IF actor IS NULL OR NOT (
    public.is_platform_admin(actor) OR public.has_tenant_role(actor,_tenant_id,'tenant_admin') OR public.has_tenant_role(actor,_tenant_id,'tenant_analyst')
  ) THEN RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO template_row FROM public.tenant_templates WHERE id=_tenant_template_id AND tenant_id=_tenant_id AND status='published' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published tenant template not found' USING ERRCODE='P0002'; END IF;
  IF template_row.spec->>'kind'<>'reconciliation' OR jsonb_typeof(template_row.spec->'sides')<>'array' OR jsonb_typeof(template_row.spec->'rules')<>'array' THEN
    RAISE EXCEPTION 'tenant template is not runnable' USING ERRCODE='22023';
  END IF;
  leg_count:=jsonb_array_length(template_row.spec->'sides');
  SELECT count(*) INTO source_count FROM jsonb_array_elements(template_row.spec->'sides') side
  JOIN public.workspace_data_sources source ON source.id=(side->>'data_source_id')::uuid AND source.tenant_id=_tenant_id;
  IF source_count<>leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'template sources are unavailable in tenant' USING ERRCODE='42501'; END IF;
  INSERT INTO public.recon_definitions(tenant_id,name,description,recon_type,sides,rules,status,created_by,tenant_template_id)
  VALUES (_tenant_id,btrim(_name),template_row.description,template_row.spec->>'recon_type',template_row.spec->'sides',template_row.spec->'rules','draft',actor,template_row.id)
  RETURNING * INTO definition_row;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.tenant_template.instantiate','recon_definition',definition_row.id,
    jsonb_build_object('recon_code',definition_row.recon_code,'tenant_template_id',template_row.id,'semver',template_row.current_semver));
  INSERT INTO public.mkt_audit_log(actor_id,tenant_id,entity_type,entity_id,action,after)
  VALUES (actor,_tenant_id,'tenant_template',template_row.id,'instantiate',jsonb_build_object('recon_definition_id',definition_row.id,'recon_code',definition_row.recon_code));
  RETURN QUERY SELECT definition_row.id,definition_row.recon_code;
END;
$$;

REVOKE ALL ON FUNCTION public.save_tenant_template_from_recon_atomic(uuid,uuid,text,text,uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.clone_tenant_template_atomic(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.transition_tenant_template_atomic(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.instantiate_tenant_template_atomic(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_tenant_template_from_recon_atomic(uuid,uuid,text,text,uuid,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.clone_tenant_template_atomic(uuid,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.transition_tenant_template_atomic(uuid,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.instantiate_tenant_template_atomic(uuid,uuid,text) TO authenticated,service_role;
