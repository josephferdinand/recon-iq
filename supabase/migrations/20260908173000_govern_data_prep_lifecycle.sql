-- Govern Data Prep approval, staging and promotion as atomic actor-bound
-- transitions. Public API wrappers are service-role only; authenticated UI
-- wrappers derive the actor from auth.uid().

CREATE OR REPLACE FUNCTION public.assert_data_prep_actor(
  _tenant_id uuid,
  _actor_user_id uuid,
  _admin_only boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _tenant_id IS NULL OR _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Accountable Data Prep actor is required';
  END IF;
  IF public.is_platform_admin(_actor_user_id) THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = _actor_user_id
      AND tm.active = true
      AND ((_admin_only AND tm.role = 'tenant_admin')
        OR (NOT _admin_only AND tm.role IN ('tenant_admin','tenant_analyst')))
  ) THEN
    RAISE EXCEPTION 'Forbidden: active Data Prep % role required',
      CASE WHEN _admin_only THEN 'administrator' ELSE 'writer' END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_data_prep_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.data_prep_lifecycle', true) IS DISTINCT FROM 'on'
     AND (
       (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','archived'))
       OR NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state
       OR NEW.promotion_status IS DISTINCT FROM OLD.promotion_status
       OR NEW.promotion_requested_by IS DISTINCT FROM OLD.promotion_requested_by
       OR NEW.promotion_requested_at IS DISTINCT FROM OLD.promotion_requested_at
       OR NEW.promoted_from_id IS DISTINCT FROM OLD.promoted_from_id
       OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at
       OR NEW.promoted_by IS DISTINCT FROM OLD.promoted_by
     ) THEN
    RAISE EXCEPTION 'Use the governed Data Prep lifecycle functions';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_data_prep_lifecycle ON public.data_prep_pipelines;
CREATE TRIGGER guard_data_prep_lifecycle
  BEFORE UPDATE ON public.data_prep_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_data_prep_lifecycle();

CREATE OR REPLACE FUNCTION public.approve_data_prep_pipeline_as(
  _tenant_id uuid,
  _pipeline_id uuid,
  _actor_user_id uuid
)
RETURNS TABLE(pipeline_id uuid, public_uid text, pipeline_name text, pipeline_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.data_prep_pipelines%ROWTYPE;
  prior_lifecycle_setting text;
BEGIN
  PERFORM public.assert_data_prep_actor(_tenant_id, _actor_user_id, true);
  SELECT * INTO target FROM public.data_prep_pipelines
  WHERE id = _pipeline_id AND tenant_id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data Prep pipeline not found'; END IF;
  IF target.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft Data Prep pipeline can be approved'; END IF;
  IF target.created_by IS NOT DISTINCT FROM _actor_user_id THEN
    RAISE EXCEPTION 'Four-eyes: pipeline maker cannot approve';
  END IF;
  prior_lifecycle_setting := current_setting('app.data_prep_lifecycle', true);
  PERFORM set_config('app.data_prep_lifecycle', 'on', true);
  UPDATE public.data_prep_pipelines
  SET status = 'approved', approved_at = now(), approved_by = _actor_user_id
  WHERE id = _pipeline_id AND tenant_id = _tenant_id;
  PERFORM set_config('app.data_prep_lifecycle', coalesce(prior_lifecycle_setting,''), true);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,_tenant_id,'workspace','data_prep.approve','data_prep_pipeline',_pipeline_id,
    jsonb_build_object('public_uid',target.public_uid,'name',target.name,'four_eyes',true));
  RETURN QUERY SELECT target.id, target.public_uid, target.name, 'approved'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.clone_data_prep_staging_as(
  _tenant_id uuid,
  _pipeline_id uuid,
  _actor_user_id uuid
)
RETURNS TABLE(staging_pipeline_id uuid, staging_public_uid text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source public.data_prep_pipelines%ROWTYPE;
  created public.data_prep_pipelines%ROWTYPE;
BEGIN
  PERFORM public.assert_data_prep_actor(_tenant_id, _actor_user_id, false);
  SELECT * INTO source FROM public.data_prep_pipelines
  WHERE id = _pipeline_id AND tenant_id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data Prep pipeline not found'; END IF;
  IF source.lifecycle_state <> 'production' OR source.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved production pipeline can be cloned as staging';
  END IF;
  IF EXISTS (SELECT 1 FROM public.data_prep_pipelines
    WHERE tenant_id=_tenant_id AND parent_pipeline_id=_pipeline_id AND lifecycle_state='staging') THEN
    RAISE EXCEPTION 'A staging copy already exists for this pipeline';
  END IF;
  INSERT INTO public.data_prep_pipelines(
    tenant_id,name,description,source_data_source_id,output_data_source_id,steps,dq_rules,
    on_failure,enabled,status,version,lifecycle_state,parent_pipeline_id,bu_id,created_by
  ) VALUES (
    source.tenant_id,left(source.name || ' (staging)',120),source.description,
    source.source_data_source_id,NULL,source.steps,source.dq_rules,source.on_failure,true,
    'draft',1,'staging',source.id,source.bu_id,_actor_user_id
  ) RETURNING * INTO created;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,_tenant_id,'workspace','data_prep.clone_as_staging','data_prep_pipeline',created.id,
    jsonb_build_object('parent_id',source.id,'parent_name',source.name));
  RETURN QUERY SELECT created.id, created.public_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_data_prep_promotion_as(
  _tenant_id uuid,
  _staging_id uuid,
  _note text,
  _actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.data_prep_pipelines%ROWTYPE;
  prior_lifecycle_setting text;
BEGIN
  PERFORM public.assert_data_prep_actor(_tenant_id, _actor_user_id, false);
  SELECT * INTO target FROM public.data_prep_pipelines
  WHERE id=_staging_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND OR target.lifecycle_state <> 'staging' OR target.parent_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Staging Data Prep pipeline not found';
  END IF;
  IF target.status <> 'approved' THEN RAISE EXCEPTION 'Approve the staging pipeline before promotion'; END IF;
  IF target.promotion_status = 'pending' THEN RAISE EXCEPTION 'Data Prep promotion is already pending'; END IF;
  IF length(coalesce(_note,'')) > 500 THEN RAISE EXCEPTION 'Promotion note exceeds 500 characters'; END IF;
  prior_lifecycle_setting := current_setting('app.data_prep_lifecycle', true);
  PERFORM set_config('app.data_prep_lifecycle', 'on', true);
  UPDATE public.data_prep_pipelines SET promotion_status='pending',
    promotion_requested_by=_actor_user_id,promotion_requested_at=now(),promotion_note=nullif(trim(_note),'')
  WHERE id=_staging_id AND tenant_id=_tenant_id;
  PERFORM set_config('app.data_prep_lifecycle', coalesce(prior_lifecycle_setting,''), true);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,_tenant_id,'workspace','data_prep.request_promotion','data_prep_pipeline',_staging_id,
    jsonb_build_object('note',nullif(trim(_note),''),'four_eyes_required',true));
  RETURN 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_data_prep_promotion_as(
  _tenant_id uuid,
  _staging_id uuid,
  _approve boolean,
  _comment text,
  _actor_user_id uuid
)
RETURNS TABLE(decision text, production_pipeline_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staging public.data_prep_pipelines%ROWTYPE;
  production public.data_prep_pipelines%ROWTYPE;
  prior_lifecycle_setting text;
BEGIN
  PERFORM public.assert_data_prep_actor(_tenant_id, _actor_user_id, true);
  SELECT * INTO staging FROM public.data_prep_pipelines
  WHERE id=_staging_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND OR staging.lifecycle_state <> 'staging' OR staging.promotion_status <> 'pending' THEN
    RAISE EXCEPTION 'Data Prep pipeline is not pending promotion';
  END IF;
  IF staging.promotion_requested_by IS NOT DISTINCT FROM _actor_user_id THEN
    RAISE EXCEPTION 'Four-eyes: promotion requester cannot decide';
  END IF;
  IF length(coalesce(_comment,'')) > 500 THEN RAISE EXCEPTION 'Promotion comment exceeds 500 characters'; END IF;
  INSERT INTO public.dp_promotion_approvals(staging_pipeline_id,tenant_id,approver_id,decision,comment)
  VALUES (_staging_id,_tenant_id,_actor_user_id,CASE WHEN _approve THEN 'approve' ELSE 'reject' END,
    nullif(trim(_comment),''));
  prior_lifecycle_setting := current_setting('app.data_prep_lifecycle', true);
  PERFORM set_config('app.data_prep_lifecycle', 'on', true);
  IF NOT _approve THEN
    UPDATE public.data_prep_pipelines SET promotion_status='rejected'
    WHERE id=_staging_id AND tenant_id=_tenant_id;
    PERFORM set_config('app.data_prep_lifecycle', coalesce(prior_lifecycle_setting,''), true);
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (_actor_user_id,_tenant_id,'workspace','data_prep.reject_promotion','data_prep_pipeline',_staging_id,
      jsonb_build_object('comment',nullif(trim(_comment),''),'four_eyes',true));
    RETURN QUERY SELECT 'rejected'::text, staging.parent_pipeline_id;
    RETURN;
  END IF;
  SELECT * INTO production FROM public.data_prep_pipelines
  WHERE id=staging.parent_pipeline_id AND tenant_id=_tenant_id AND lifecycle_state='production' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production Data Prep pipeline not found'; END IF;
  UPDATE public.data_prep_pipelines SET
    steps=staging.steps,dq_rules=staging.dq_rules,on_failure=staging.on_failure,
    description=staging.description,version=coalesce(production.version,1)+1,status='approved',
    approved_at=now(),approved_by=_actor_user_id,promoted_from_id=staging.id,
    promoted_at=now(),promoted_by=_actor_user_id
  WHERE id=production.id AND tenant_id=_tenant_id;
  UPDATE public.data_prep_pipelines SET lifecycle_state='archived',promotion_status='approved',
    status='archived',enabled=false WHERE id=staging.id AND tenant_id=_tenant_id;
  PERFORM set_config('app.data_prep_lifecycle', coalesce(prior_lifecycle_setting,''), true);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,_tenant_id,'workspace','data_prep.promote','data_prep_pipeline',production.id,
    jsonb_build_object('staging_id',staging.id,'comment',nullif(trim(_comment),''),'four_eyes',true));
  RETURN QUERY SELECT 'approved'::text, production.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_data_prep_pipeline_as(
  _tenant_id uuid,
  _pipeline_id uuid,
  _reason text,
  _actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.data_prep_pipelines%ROWTYPE;
  prior_lifecycle_setting text;
BEGIN
  PERFORM public.assert_data_prep_actor(_tenant_id, _actor_user_id, true);
  SELECT * INTO target FROM public.data_prep_pipelines
  WHERE id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data Prep pipeline not found'; END IF;
  IF target.lifecycle_state='archived' THEN RETURN 'archived'; END IF;
  IF target.promotion_status='pending' THEN RAISE EXCEPTION 'Pending promotion must be decided before archival'; END IF;
  IF length(trim(coalesce(_reason,''))) < 3 OR length(_reason) > 500 THEN
    RAISE EXCEPTION 'Archival reason must contain between 3 and 500 characters';
  END IF;
  prior_lifecycle_setting := current_setting('app.data_prep_lifecycle', true);
  PERFORM set_config('app.data_prep_lifecycle', 'on', true);
  UPDATE public.data_prep_pipelines SET lifecycle_state='archived',status='archived',enabled=false
  WHERE id=_pipeline_id AND tenant_id=_tenant_id;
  PERFORM set_config('app.data_prep_lifecycle', coalesce(prior_lifecycle_setting,''), true);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,_tenant_id,'workspace','data_prep.archive','data_prep_pipeline',_pipeline_id,
    jsonb_build_object('reason',trim(_reason),'prior_lifecycle',target.lifecycle_state,'prior_status',target.status));
  RETURN 'archived';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_data_prep_pipeline(_tenant_id uuid,_pipeline_id uuid)
RETURNS TABLE(pipeline_id uuid,public_uid text,pipeline_name text,pipeline_status text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.approve_data_prep_pipeline_as(_tenant_id,_pipeline_id,auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.clone_data_prep_staging(_tenant_id uuid,_pipeline_id uuid)
RETURNS TABLE(staging_pipeline_id uuid,staging_public_uid text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.clone_data_prep_staging_as(_tenant_id,_pipeline_id,auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.request_data_prep_promotion(_tenant_id uuid,_staging_id uuid,_note text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.request_data_prep_promotion_as(_tenant_id,_staging_id,_note,auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.decide_data_prep_promotion(_tenant_id uuid,_staging_id uuid,_approve boolean,_comment text)
RETURNS TABLE(decision text,production_pipeline_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.decide_data_prep_promotion_as(_tenant_id,_staging_id,_approve,_comment,auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.archive_data_prep_pipeline(_tenant_id uuid,_pipeline_id uuid,_reason text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.archive_data_prep_pipeline_as(_tenant_id,_pipeline_id,_reason,auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.approve_data_prep_pipeline_for_api(_tenant_id uuid,_pipeline_id uuid,_actor_user_id uuid)
RETURNS TABLE(pipeline_id uuid,public_uid text,pipeline_name text,pipeline_status text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.approve_data_prep_pipeline_as(_tenant_id,_pipeline_id,_actor_user_id) $$;
CREATE OR REPLACE FUNCTION public.upsert_data_prep_pipeline_for_api(
  _tenant_id uuid,_pipeline_id uuid,_payload jsonb,_actor_user_id uuid
)
RETURNS TABLE(pipeline_id uuid,public_uid text,pipeline_status text,pipeline_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  target public.data_prep_pipelines%ROWTYPE;
  created public.data_prep_pipelines%ROWTYPE;
BEGIN
  PERFORM public.assert_data_prep_actor(_tenant_id,_actor_user_id,false);
  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' THEN RAISE EXCEPTION 'Data Prep payload is required'; END IF;
  IF _pipeline_id IS NULL THEN
    INSERT INTO public.data_prep_pipelines(
      tenant_id,name,description,source_data_source_id,output_data_source_id,steps,dq_rules,
      on_failure,enabled,status,lifecycle_state,created_by
    ) VALUES (
      _tenant_id,_payload->>'name',nullif(_payload->>'description',''),
      nullif(_payload->>'source_data_source_id','')::uuid,nullif(_payload->>'output_data_source_id','')::uuid,
      coalesce(_payload->'steps','[]'::jsonb),coalesce(_payload->'dq_rules','[]'::jsonb),
      coalesce(_payload->>'on_failure','block'),coalesce((_payload->>'enabled')::boolean,true),
      'draft','production',_actor_user_id
    ) RETURNING * INTO created;
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (_actor_user_id,_tenant_id,'api','data_prep.create','data_prep_pipeline',created.id,
      jsonb_build_object('public_uid',created.public_uid,'version',created.version));
    RETURN QUERY SELECT created.id,created.public_uid,created.status,created.version;
    RETURN;
  END IF;
  SELECT * INTO target FROM public.data_prep_pipelines
  WHERE id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data Prep pipeline not found'; END IF;
  IF target.lifecycle_state='archived' THEN RAISE EXCEPTION 'Archived Data Prep pipeline cannot be edited'; END IF;
  IF target.promotion_status='pending' THEN RAISE EXCEPTION 'Pending promotion pipeline cannot be edited'; END IF;
  UPDATE public.data_prep_pipelines SET
    name=coalesce(_payload->>'name',target.name),
    description=CASE WHEN _payload ? 'description' THEN nullif(_payload->>'description','') ELSE target.description END,
    source_data_source_id=CASE WHEN _payload ? 'source_data_source_id' THEN nullif(_payload->>'source_data_source_id','')::uuid ELSE target.source_data_source_id END,
    output_data_source_id=CASE WHEN _payload ? 'output_data_source_id' THEN nullif(_payload->>'output_data_source_id','')::uuid ELSE target.output_data_source_id END,
    steps=coalesce(_payload->'steps',target.steps),dq_rules=coalesce(_payload->'dq_rules',target.dq_rules),
    on_failure=coalesce(_payload->>'on_failure',target.on_failure),
    enabled=coalesce((_payload->>'enabled')::boolean,target.enabled),
    status=CASE WHEN target.status='approved' THEN 'draft' ELSE target.status END,
    version=CASE WHEN target.status='approved' THEN coalesce(target.version,1)+1 ELSE target.version END,
    approved_at=CASE WHEN target.status='approved' THEN NULL ELSE target.approved_at END,
    approved_by=CASE WHEN target.status='approved' THEN NULL ELSE target.approved_by END
  WHERE id=_pipeline_id AND tenant_id=_tenant_id RETURNING * INTO created;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (_actor_user_id,_tenant_id,'api','data_prep.update','data_prep_pipeline',created.id,
    jsonb_build_object('public_uid',created.public_uid,'version',created.version,'reapproval_required',target.status='approved'));
  RETURN QUERY SELECT created.id,created.public_uid,created.status,created.version;
END;
$$;
CREATE OR REPLACE FUNCTION public.clone_data_prep_staging_for_api(_tenant_id uuid,_pipeline_id uuid,_actor_user_id uuid)
RETURNS TABLE(staging_pipeline_id uuid,staging_public_uid text)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.clone_data_prep_staging_as(_tenant_id,_pipeline_id,_actor_user_id) $$;
CREATE OR REPLACE FUNCTION public.request_data_prep_promotion_for_api(_tenant_id uuid,_staging_id uuid,_note text,_actor_user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.request_data_prep_promotion_as(_tenant_id,_staging_id,_note,_actor_user_id) $$;
CREATE OR REPLACE FUNCTION public.decide_data_prep_promotion_for_api(_tenant_id uuid,_staging_id uuid,_approve boolean,_comment text,_actor_user_id uuid)
RETURNS TABLE(decision text,production_pipeline_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.decide_data_prep_promotion_as(_tenant_id,_staging_id,_approve,_comment,_actor_user_id) $$;
CREATE OR REPLACE FUNCTION public.archive_data_prep_pipeline_for_api(_tenant_id uuid,_pipeline_id uuid,_reason text,_actor_user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT public.archive_data_prep_pipeline_as(_tenant_id,_pipeline_id,_reason,_actor_user_id) $$;

REVOKE ALL ON FUNCTION public.assert_data_prep_actor(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_data_prep_lifecycle() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_data_prep_pipeline_as(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clone_data_prep_staging_as(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_data_prep_promotion_as(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_data_prep_promotion_as(uuid,uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.archive_data_prep_pipeline_as(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.upsert_data_prep_pipeline_for_api(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.clone_data_prep_staging_for_api(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_data_prep_promotion_for_api(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_data_prep_promotion_for_api(uuid,uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.archive_data_prep_pipeline_for_api(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_data_prep_pipeline(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clone_data_prep_staging(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_data_prep_promotion(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_data_prep_promotion(uuid,uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_data_prep_pipeline(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_data_prep_pipeline_for_api(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_data_prep_pipeline_for_api(uuid,uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clone_data_prep_staging_for_api(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_data_prep_promotion_for_api(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_data_prep_promotion_for_api(uuid,uuid,boolean,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_data_prep_pipeline_for_api(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_data_prep_actor(uuid,uuid,boolean) TO service_role;
