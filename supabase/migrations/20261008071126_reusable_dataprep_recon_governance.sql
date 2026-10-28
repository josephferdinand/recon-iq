-- FROZEN INPUT BODY.sql SHA256 043fdd4e3dff977e08f192d551f569c0bf012e71158dc0d269f7fe94b6e51586
-- PROPOSED BODY ONLY. No transaction/ledger version/provider apply here.
-- Main must qualify full consumed fences and replace the CLOSED factor attestor
-- only with reviewed actual native provenance. Old RPC bodies are untouched.

CREATE TABLE public.data_prep_configuration_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), pipeline_version integer NOT NULL CHECK(pipeline_version>0),
 request_key uuid NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,created_by,request_key)
);
CREATE TABLE public.data_prep_input_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), configuration_id uuid NOT NULL REFERENCES public.data_prep_configuration_revisions(id),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id),
 pipeline_version integer NOT NULL, feed_key text NOT NULL CHECK(length(feed_key) BETWEEN 1 AND 120),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), vendor text NOT NULL CHECK(length(vendor) BETWEEN 1 AND 120),
 layout_id text NOT NULL, business_side text NOT NULL, record_type text NOT NULL,
 data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id), required boolean NOT NULL, allow_empty boolean NOT NULL,
 mappings jsonb NOT NULL CHECK(jsonb_typeof(mappings)='object'), steps jsonb NOT NULL CHECK(jsonb_typeof(steps)='array'),
 UNIQUE(configuration_id,feed_key)
);
CREATE TABLE private.dpw_configuration_heads (
 pipeline_id uuid PRIMARY KEY REFERENCES public.data_prep_pipelines(id), configuration_id uuid NOT NULL REFERENCES public.data_prep_configuration_revisions(id)
);
CREATE TABLE public.data_prep_approved_configurations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), pipeline_version integer NOT NULL,
 configuration_id uuid NOT NULL REFERENCES public.data_prep_configuration_revisions(id), snapshot jsonb NOT NULL,
 approved_by uuid NOT NULL REFERENCES auth.users(id), approved_at timestamptz NOT NULL,
 UNIQUE(pipeline_id,pipeline_version)
);
CREATE TABLE public.data_prep_delivery_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), pipeline_version integer NOT NULL,
 business_date date NOT NULL, mode text NOT NULL CHECK(mode IN('preview','prepare')),
 execution_mode text NOT NULL DEFAULT 'manual' CHECK(execution_mode IN('manual','assisted','agentic')), human_in_loop boolean NOT NULL DEFAULT true,
 request_key uuid NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id),
 correction_of uuid REFERENCES public.data_prep_delivery_batches(id), configuration_snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'collecting' CHECK(state IN('collecting','processing','blocked','prepared','published','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,created_by,request_key)
);
CREATE TABLE public.data_prep_delivery_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), batch_id uuid NOT NULL REFERENCES public.data_prep_delivery_batches(id),
 pipeline_version integer NOT NULL, feed_key text NOT NULL, data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id),
 created_by uuid NOT NULL REFERENCES auth.users(id), descriptor jsonb NOT NULL, request_key uuid NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 original_path text NOT NULL UNIQUE, correction_of uuid REFERENCES public.data_prep_delivery_files(id),
 upload_id uuid UNIQUE REFERENCES public.workspace_data_source_uploads(id),
 structured_rows_sha256 text, state text NOT NULL DEFAULT 'uploading' CHECK(state IN('uploading','received','rejected','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), received_at timestamptz,
 UNIQUE(batch_id,feed_key,request_key), UNIQUE(batch_id,feed_key,content_sha256)
);
CREATE TABLE public.data_prep_delivery_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), batch_id uuid NOT NULL REFERENCES public.data_prep_delivery_batches(id),
 pipeline_version integer NOT NULL, request_key uuid NOT NULL, started_by uuid NOT NULL REFERENCES auth.users(id),
 snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'running' CHECK(state IN('running','success','warn','failed')),
 result jsonb, result_sha256 text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(batch_id,request_key)
);
CREATE TABLE public.data_prep_file_requests (
 batch_id uuid NOT NULL REFERENCES public.data_prep_delivery_batches(id), feed_key text NOT NULL, request_key uuid NOT NULL,
 file_id uuid NOT NULL REFERENCES public.data_prep_delivery_files(id), requested_descriptor jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,feed_key,request_key)
);
CREATE TABLE public.data_prep_run_inputs (
 run_id uuid NOT NULL REFERENCES public.data_prep_delivery_runs(id), file_id uuid NOT NULL REFERENCES public.data_prep_delivery_files(id),
 upload_id uuid NOT NULL REFERENCES public.workspace_data_source_uploads(id), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 feed_key text NOT NULL, content_sha256 text NOT NULL, row_count integer NOT NULL CHECK(row_count>=0),
 PRIMARY KEY(run_id,file_id)
);
CREATE TABLE public.data_prep_record_lineage (
 run_id uuid NOT NULL REFERENCES public.data_prep_delivery_runs(id), output_index integer NOT NULL CHECK(output_index>=0),
 file_id uuid NOT NULL REFERENCES public.data_prep_delivery_files(id), source_index integer NOT NULL CHECK(source_index>=0),
 PRIMARY KEY(run_id,output_index,file_id,source_index)
);
CREATE TABLE public.data_prep_reject_lineage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 run_id uuid NOT NULL REFERENCES public.data_prep_delivery_runs(id), file_id uuid NOT NULL REFERENCES public.data_prep_delivery_files(id),
 source_index integer NOT NULL CHECK(source_index>=0), disposition text NOT NULL CHECK(disposition IN('dropped','retained','blocked')),
 original_row jsonb NOT NULL, prepared_row jsonb NOT NULL, reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array' AND jsonb_array_length(reasons)>0)
);
CREATE TABLE public.data_prep_prepared_datasets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), pipeline_version integer NOT NULL,
 batch_id uuid NOT NULL REFERENCES public.data_prep_delivery_batches(id), run_id uuid NOT NULL UNIQUE REFERENCES public.data_prep_delivery_runs(id),
 business_date date NOT NULL, data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id),
 upload_id uuid NOT NULL UNIQUE REFERENCES public.workspace_data_source_uploads(id), rows integer NOT NULL CHECK(rows>=0),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'), request_key uuid NOT NULL,
 published_by uuid NOT NULL REFERENCES auth.users(id), published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,request_key)
);
CREATE TABLE public.data_prep_exclusion_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), pipeline_version integer NOT NULL,
 batch_id uuid NOT NULL REFERENCES public.data_prep_delivery_batches(id), run_id uuid NOT NULL REFERENCES public.data_prep_delivery_runs(id),
 entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='array' AND jsonb_array_length(entries)>0), reason text NOT NULL,
 request_key uuid NOT NULL, requested_by uuid NOT NULL REFERENCES auth.users(id), requested_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,requested_by,request_key)
);
CREATE TABLE public.data_prep_exclusion_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE REFERENCES public.data_prep_exclusion_requests(id),
 decision text NOT NULL CHECK(decision IN('approved','rejected')), decided_by uuid NOT NULL REFERENCES auth.users(id),
 comment text NOT NULL, decided_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_prep_delivery_batches ADD COLUMN exclusion_approval_id uuid REFERENCES public.data_prep_exclusion_decisions(id);
CREATE TABLE public.data_prep_release_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id), batch_id uuid NOT NULL REFERENCES public.data_prep_delivery_batches(id),
 run_id uuid NOT NULL REFERENCES public.data_prep_delivery_runs(id), pipeline_version integer NOT NULL, result_sha256 text NOT NULL,
 request_key uuid NOT NULL, requested_by uuid NOT NULL REFERENCES auth.users(id), requested_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,requested_by,request_key)
);
CREATE TABLE public.data_prep_release_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE REFERENCES public.data_prep_release_requests(id),
 decision text NOT NULL CHECK(decision IN('approved','rejected')), decided_by uuid NOT NULL REFERENCES auth.users(id),
 comment text NOT NULL, decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION private.dpw_hash(_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $$ SELECT encode(sha256(convert_to(_value::text,'UTF8')),'hex') $$;

-- Qualified from same-write PROD07289fb4 / DEV317955c8 captures. The native
-- peer lifecycle predicate deliberately does not read a peer's JWT AAL. Keep
-- the real upstream verified AAL separate; preserve unmanaged legacy accounts.
CREATE FUNCTION private.dpw_native_factor_attest(_actor uuid,_tenant uuid,_aal text,_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE security public.tenant_security_settings%ROWTYPE;
BEGIN
 IF _actor IS NULL OR _tenant IS NULL OR _aal IS NULL OR _aal NOT IN('aal1','aal2')
 OR _expires_at IS NULL OR _expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor)
 OR EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor AND u.banned_until>clock_timestamp())
 OR private.rlnext_account_allowed(_actor,NULL) IS DISTINCT FROM true
 OR private.rlnext_account_allowed(_actor,_tenant) IS DISTINCT FROM true THEN RETURN false; END IF;
 SELECT * INTO security FROM public.tenant_security_settings WHERE tenant_id=_tenant;
 IF NOT FOUND THEN RETURN false; END IF;
 IF (security.mfa_required OR EXISTS(SELECT 1 FROM private.rlnext_accounts a
 WHERE a.user_id=_actor AND a.mfa_required)) AND (_aal IS DISTINCT FROM 'aal2'
 OR private.rlnext_has_verified_mfa(_actor) IS DISTINCT FROM true) THEN RETURN false; END IF;
 -- Managed MFA-required accounts are additionally checked by the unmodified
 -- native predicate for mfa_verified_at and the current verified TOTP factor.
 -- An unmanaged owner is not assigned a fictional rlnext row/factor history.
 RETURN true;
END $$;

CREATE FUNCTION private.dpw_account_actor(_tenant uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL
 OR public.rlnext_actor_allowed() IS DISTINCT FROM true
 OR private.dpw_native_factor_attest(actor,_tenant,claims->>'aal',to_timestamp((claims->>'exp')::double precision)) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dpw.account_denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active)
 THEN RAISE EXCEPTION 'dpw.membership_denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION private.dpw_actor(_tenant uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_account_actor(_tenant);
BEGIN
 IF private.dpw_workspace_feature_attest(actor,_tenant) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.tenant_data_prep_feature_disabled' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION private.dpw_source_allows(_actor uuid,_tenant uuid,_source uuid,_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_data_sources s
 WHERE s.id=_source AND s.tenant_id=_tenant AND s.status<>'archived'
 AND private.registered_typed_resource_allows(_actor,_tenant,'data_source',_source,_action) IS TRUE)
$$;

CREATE FUNCTION private.dpw_authorize(_tenant uuid,_pipeline uuid,_action text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant);
BEGIN
 IF private.data_prep_pipeline_scope_allows(actor,_tenant,_pipeline,_action) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dpw.pipeline_denied' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;

CREATE FUNCTION private.dpw_processor_actor(_tenant uuid,_pipeline uuid,_subject jsonb,_action text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role'
 OR _subject->>'role' IS DISTINCT FROM 'authenticated' OR _subject->>'sub' IS NULL OR _subject->>'exp' IS NULL
 OR to_timestamp((_subject->>'exp')::double precision)<=clock_timestamp()
 THEN RAISE EXCEPTION 'dpw.closed_processor_verified_subject_required' USING ERRCODE='42501'; END IF;
 actor:=(_subject->>'sub')::uuid;
 IF private.dpw_native_factor_attest(actor,_tenant,_subject->>'aal',to_timestamp((_subject->>'exp')::double precision)) IS DISTINCT FROM true
 OR private.dpw_workspace_feature_attest(actor,_tenant) IS DISTINCT FROM true
 OR private.data_prep_pipeline_scope_allows(actor,_tenant,_pipeline,_action) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dpw.processor_actor_denied' USING ERRCODE='42501'; END IF;
 PERFORM public.assert_data_prep_actor(_tenant,actor,false);
 RETURN actor;
END $$;

CREATE FUNCTION private.dpw_audit(_actor uuid,_tenant uuid,_action text,_id uuid,_details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(_actor,_tenant,'workspace',_action,'data_prep_delivery',_id::text,_details)
$$;

CREATE FUNCTION private.dpw_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'dpw.immutable_history' USING ERRCODE='42501'; END $$;

CREATE FUNCTION private.dpw_feeds(_pipeline uuid,_version integer) RETURNS jsonb LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb; p public.data_prep_pipelines%ROWTYPE;
 BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',f.feed_key,'name',f.name,'vendor',f.vendor,'layout_id',f.layout_id,
 'business_side',f.business_side,'record_type',f.record_type,'data_source_id',f.data_source_id,'required',f.required,
 'allow_empty',f.allow_empty,'mappings',f.mappings,'steps',f.steps,'pipeline_version',f.pipeline_version) ORDER BY f.feed_key),'[]') INTO v
 FROM public.data_prep_input_profiles f JOIN private.dpw_configuration_heads h ON h.configuration_id=f.configuration_id
 WHERE h.pipeline_id=_pipeline AND f.pipeline_version=_version;
 IF jsonb_array_length(v)>0 THEN RETURN v; END IF;
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=_pipeline AND version=_version;
 IF p.source_data_source_id IS NULL THEN RETURN '[]'::jsonb; END IF;
 RETURN jsonb_build_array(jsonb_build_object('key','legacy:'||p.source_data_source_id::text,'name','Legacy single input',
 'vendor','Legacy','layout_id','legacy','business_side','legacy','record_type','legacy','data_source_id',p.source_data_source_id,
 'required',true,'allow_empty',false,'mappings','{}'::jsonb,'steps','[]'::jsonb,'pipeline_version',_version,'virtual',true));
END $$;

CREATE FUNCTION private.dpw_snapshot(_pipeline uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE p public.data_prep_pipelines%ROWTYPE; cfg public.data_prep_configuration_revisions%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=_pipeline;
 SELECT c.* INTO cfg FROM public.data_prep_configuration_revisions c JOIN private.dpw_configuration_heads h ON h.configuration_id=c.id
 WHERE h.pipeline_id=p.id AND c.pipeline_version=p.version;
 RETURN jsonb_build_object('pipeline_id',p.id,'pipeline_version',p.version,'configuration_status',p.status,
 'configuration_id',cfg.id,'legacy_virtual',cfg.id IS NULL,'source_data_source_id',p.source_data_source_id,
 'output_data_source_id',p.output_data_source_id,'steps',p.steps,'dq_rules',p.dq_rules,'on_failure',p.on_failure,
 'business_fields',coalesce(cfg.payload->'business_fields','[]'::jsonb),'required_fields',coalesce(cfg.payload->'required_fields','[]'::jsonb),
 'policy',coalesce(cfg.payload->'policy',jsonb_build_object('allow_warn',false,'allow_drop_rows',false)),
 'feeds',private.dpw_feeds(p.id,p.version));
END $$;

-- Only new saved configurations are managed. No fabricated legacy profile rows.
CREATE FUNCTION private.dpw_pipeline_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE src public.data_prep_configuration_revisions%ROWTYPE; cid uuid; f record;
BEGIN
 IF TG_OP='INSERT' AND NEW.lifecycle_state='staging' AND NEW.parent_pipeline_id IS NOT NULL THEN
  SELECT c.* INTO src FROM public.data_prep_configuration_revisions c JOIN private.dpw_configuration_heads h ON h.configuration_id=c.id
  WHERE h.pipeline_id=NEW.parent_pipeline_id;
 ELSIF TG_OP='UPDATE' AND NEW.version IS DISTINCT FROM OLD.version AND NEW.promoted_from_id IS NOT NULL
 AND NEW.promoted_from_id IS DISTINCT FROM OLD.promoted_from_id THEN
  SELECT c.* INTO src FROM public.data_prep_configuration_revisions c JOIN private.dpw_configuration_heads h ON h.configuration_id=c.id
  WHERE h.pipeline_id=NEW.promoted_from_id;
  IF src.id IS NULL AND EXISTS(SELECT 1 FROM private.dpw_configuration_heads WHERE pipeline_id=NEW.id)
  THEN RAISE EXCEPTION 'dpw.promotion_profiles_missing'; END IF;
 END IF;
 IF src.id IS NOT NULL THEN
  INSERT INTO public.data_prep_configuration_revisions(tenant_id,pipeline_id,pipeline_version,request_key,created_by,payload,payload_sha256)
  VALUES(NEW.tenant_id,NEW.id,NEW.version,gen_random_uuid(),coalesce(NEW.promoted_by,NEW.created_by),
  src.payload||jsonb_build_object('source_data_source_id',NEW.source_data_source_id,'output_data_source_id',NEW.output_data_source_id),
  private.dpw_hash(src.payload||jsonb_build_object('source_data_source_id',NEW.source_data_source_id,'output_data_source_id',NEW.output_data_source_id))) RETURNING id INTO cid;
  INSERT INTO public.data_prep_input_profiles(configuration_id,tenant_id,pipeline_id,pipeline_version,feed_key,name,vendor,layout_id,business_side,record_type,data_source_id,required,allow_empty,mappings,steps)
  SELECT cid,NEW.tenant_id,NEW.id,NEW.version,feed_key,name,vendor,layout_id,business_side,record_type,data_source_id,required,allow_empty,mappings,steps
  FROM public.data_prep_input_profiles WHERE configuration_id=src.id;
  INSERT INTO private.dpw_configuration_heads VALUES(NEW.id,cid) ON CONFLICT(pipeline_id) DO UPDATE SET configuration_id=excluded.configuration_id;
 END IF;
 IF NEW.status='approved' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.version IS DISTINCT FROM NEW.version) THEN
  SELECT h.configuration_id INTO cid FROM private.dpw_configuration_heads h JOIN public.data_prep_configuration_revisions c ON c.id=h.configuration_id
  WHERE h.pipeline_id=NEW.id AND c.pipeline_version=NEW.version;
  IF cid IS NOT NULL THEN
   SELECT * INTO src FROM public.data_prep_configuration_revisions WHERE id=cid;
   IF src.payload->'steps' IS DISTINCT FROM NEW.steps OR src.payload->'dq_rules' IS DISTINCT FROM NEW.dq_rules
   OR src.payload->>'on_failure' IS DISTINCT FROM NEW.on_failure
   OR nullif(src.payload->>'output_data_source_id','')::uuid IS DISTINCT FROM NEW.output_data_source_id
   OR nullif(src.payload->>'source_data_source_id','')::uuid IS DISTINCT FROM NEW.source_data_source_id
   THEN RAISE EXCEPTION 'dpw.configuration_profile_snapshot_stale'; END IF;
   INSERT INTO public.data_prep_approved_configurations(tenant_id,pipeline_id,pipeline_version,configuration_id,snapshot,approved_by,approved_at)
   VALUES(NEW.tenant_id,NEW.id,NEW.version,cid,private.dpw_snapshot(NEW.id),NEW.approved_by,NEW.approved_at);
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- The old upsert can edit approved rows. Its body/ABI stays intact, but governed
-- profiles require explicit staging; this trigger prevents approved edits even
-- when an old RPC is called directly. Native promotion remains allowed.
CREATE FUNCTION private.dpw_guard_pipeline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stage public.data_prep_pipelines%ROWTYPE;
BEGIN
 IF NEW.version=OLD.version+1 AND NEW.status='approved' AND NEW.promoted_from_id IS DISTINCT FROM OLD.promoted_from_id THEN
  SELECT * INTO stage FROM public.data_prep_pipelines WHERE id=NEW.promoted_from_id AND tenant_id=NEW.tenant_id
  AND parent_pipeline_id=OLD.id AND lifecycle_state='staging' AND promotion_status='pending';
  IF FOUND AND EXISTS(SELECT 1 FROM private.dpw_configuration_heads WHERE pipeline_id=stage.id) THEN
   -- The original body promotes steps/DQ. Add the same staged source/output
   -- configuration so an explicitly changed output source is never discarded.
   NEW.source_data_source_id:=stage.source_data_source_id;
   NEW.output_data_source_id:=coalesce(stage.output_data_source_id,OLD.output_data_source_id);
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM private.dpw_configuration_heads WHERE pipeline_id=OLD.id) AND OLD.status='approved'
 AND (NEW.name,NEW.description,NEW.source_data_source_id,NEW.output_data_source_id,NEW.steps,NEW.dq_rules,NEW.on_failure,NEW.version)
 IS DISTINCT FROM (OLD.name,OLD.description,OLD.source_data_source_id,OLD.output_data_source_id,OLD.steps,OLD.dq_rules,OLD.on_failure,OLD.version)
 AND NOT(NEW.version=OLD.version+1 AND NEW.status='approved' AND NEW.promoted_from_id IS DISTINCT FROM OLD.promoted_from_id
 AND EXISTS(SELECT 1 FROM public.data_prep_pipelines s WHERE s.id=NEW.promoted_from_id AND s.tenant_id=NEW.tenant_id
 AND s.parent_pipeline_id=OLD.id AND s.lifecycle_state='staging' AND s.promotion_status='pending'
 AND s.steps=NEW.steps AND s.dq_rules=NEW.dq_rules AND s.on_failure=NEW.on_failure))
 THEN RAISE EXCEPTION 'dpw.approved_configuration_immutable_use_staging' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dpw_guard_pipeline BEFORE UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION private.dpw_guard_pipeline();
CREATE TRIGGER dpw_pipeline_lifecycle AFTER INSERT OR UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION private.dpw_pipeline_lifecycle();

CREATE FUNCTION public.dpw_save_configuration(_tenant_id uuid,_pipeline_id uuid,_payload jsonb,_owning_business_unit_ids uuid[],_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant_id); p public.data_prep_pipelines%ROWTYPE; oldcfg public.data_prep_configuration_revisions%ROWTYPE;
 cid uuid; rid uuid; f jsonb; src uuid; outsrc uuid; native jsonb; identity jsonb;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 IF _request_key IS NULL OR _payload IS NULL OR jsonb_typeof(_payload)<>'object' OR length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 120
 OR jsonb_typeof(_payload->'feeds') IS DISTINCT FROM 'array' OR jsonb_array_length(_payload->'feeds') NOT BETWEEN 1 AND 50
 OR jsonb_typeof(_payload->'steps') IS DISTINCT FROM 'array' OR jsonb_typeof(_payload->'dq_rules') IS DISTINCT FROM 'array'
 OR jsonb_typeof(_payload->'business_fields') IS DISTINCT FROM 'array' OR jsonb_typeof(_payload->'required_fields') IS DISTINCT FROM 'array'
 OR _payload->>'on_failure' IS DISTINCT FROM 'block'
 OR jsonb_typeof(_payload->'policy'->'allow_warn') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(_payload->'policy'->'allow_drop_rows') IS DISTINCT FROM 'boolean'
 OR cardinality(_owning_business_unit_ids) IS NULL OR cardinality(_owning_business_unit_ids)=0
 THEN RAISE EXCEPTION 'dpw.invalid_configuration'; END IF;
 IF public.user_has_permission(actor,_tenant_id,'data.prep.author',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.configuration_author_permission_required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(_payload->'business_fields') WHERE value ~ '^extras_json($|[.\[])')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(_payload->'feeds') feed,jsonb_each_text(feed->'mappings') mapping
 WHERE mapping.value ~ '^extras_json($|[.\[])')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements((_payload->'steps')||(_payload->'dq_rules')) item WHERE item->>'field' ~ '^extras_json($|[.\[])')
 THEN RAISE EXCEPTION 'dpw.reserved_extras_namespace'; END IF;
 identity:=jsonb_build_object('payload',_payload,'pipeline_id',_pipeline_id,'owners',to_jsonb(_owning_business_unit_ids));
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||actor::text||_request_key::text,0));
 SELECT * INTO oldcfg FROM public.data_prep_configuration_revisions WHERE tenant_id=_tenant_id AND created_by=actor AND request_key=_request_key;
 IF FOUND THEN
  PERFORM private.dpw_authorize(_tenant_id,oldcfg.pipeline_id,'edit');
  IF oldcfg.payload->'_save_identity' IS DISTINCT FROM identity THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  SELECT * INTO p FROM public.data_prep_pipelines WHERE id=oldcfg.pipeline_id;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'pipeline',to_jsonb(p),'configuration_id',oldcfg.id,'is_new',false);
 END IF;
 IF _pipeline_id IS NOT NULL THEN
  SELECT * INTO p FROM public.data_prep_pipelines WHERE id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dpw.pipeline_not_found'; END IF;
  IF p.created_by=actor AND NOT EXISTS(SELECT 1 FROM public.data_resource_registry WHERE tenant_id=_tenant_id AND data_prep_pipeline_id=p.id) THEN
   PERFORM public.register_typed_data_resource('data_prep_pipeline',p.id,_owning_business_unit_ids,'Reusable Data Prep staging ownership');
  END IF;
  PERFORM private.dpw_authorize(_tenant_id,_pipeline_id,'edit');
  IF p.status IS DISTINCT FROM 'draft' OR p.lifecycle_state='archived' OR p.promotion_status='pending' THEN RAISE EXCEPTION 'dpw.draft_required'; END IF;
 END IF;
 IF (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(_payload->'feeds')) <> jsonb_array_length(_payload->'feeds')
 THEN RAISE EXCEPTION 'dpw.duplicate_feed_key'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(_payload->'feeds') LOOP
  src:=(f->>'data_source_id')::uuid;
  IF private.dpw_source_allows(actor,_tenant_id,src,'view') IS DISTINCT FROM true
  OR private.dpw_source_allows(actor,_tenant_id,src,'ingest') IS DISTINCT FROM true
  OR jsonb_typeof(f->'mappings') IS DISTINCT FROM 'object' OR jsonb_typeof(f->'steps') IS DISTINCT FROM 'array'
  OR jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' OR jsonb_typeof(f->'allow_empty') IS DISTINCT FROM 'boolean'
  OR length(coalesce(f->>'key','')) NOT BETWEEN 1 AND 120 OR f->>'key' LIKE 'legacy:%'
  OR coalesce(f->>'layout_id','')='' OR coalesce(f->>'business_side','')='' OR coalesce(f->>'record_type','')=''
  THEN RAISE EXCEPTION 'dpw.feed_source_denied'; END IF;
 END LOOP;
 outsrc:=nullif(_payload->>'output_data_source_id','')::uuid;
 IF outsrc IS NULL THEN
  outsrc:=gen_random_uuid();
  INSERT INTO public.workspace_data_sources(id,tenant_id,name,source_type,created_by)
  VALUES(outsrc,_tenant_id,left(_payload->>'name',70)||' prepared '||outsrc::text,'json',actor);
  PERFORM public.register_typed_data_resource('data_source',outsrc,_owning_business_unit_ids,'Reusable Data Prep output ownership');
 ELSIF private.dpw_source_allows(actor,_tenant_id,outsrc,'ingest') IS DISTINCT FROM true
 OR private.dpw_source_allows(actor,_tenant_id,outsrc,'edit') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dpw.output_source_denied'; END IF;
 native:=_payload||jsonb_build_object('source_data_source_id',(_payload->'feeds'->0->>'data_source_id')::uuid,'output_data_source_id',outsrc);
 SELECT x.pipeline_id INTO rid FROM public.upsert_data_prep_pipeline(_tenant_id,_pipeline_id,native) x;
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=rid AND tenant_id=_tenant_id FOR UPDATE;
 SELECT id INTO cid FROM public.data_resource_registry WHERE tenant_id=_tenant_id AND data_prep_pipeline_id=rid;
 IF cid IS NULL THEN PERFORM public.register_typed_data_resource('data_prep_pipeline',rid,_owning_business_unit_ids,'Reusable Data Prep pipeline ownership');
 ELSE PERFORM public.set_typed_data_resource_owners(cid,_owning_business_unit_ids,'Reusable Data Prep configuration ownership'); END IF;
 native:=native||jsonb_build_object('_save_identity',identity);
 INSERT INTO public.data_prep_configuration_revisions(tenant_id,pipeline_id,pipeline_version,request_key,created_by,payload,payload_sha256)
 VALUES(_tenant_id,rid,p.version,_request_key,actor,native,private.dpw_hash(native)) RETURNING id INTO cid;
 FOR f IN SELECT value FROM jsonb_array_elements(_payload->'feeds') LOOP
  INSERT INTO public.data_prep_input_profiles(configuration_id,tenant_id,pipeline_id,pipeline_version,feed_key,name,vendor,layout_id,business_side,record_type,data_source_id,required,allow_empty,mappings,steps)
  VALUES(cid,_tenant_id,rid,p.version,f->>'key',f->>'name',f->>'vendor',f->>'layout_id',f->>'business_side',f->>'record_type',
  (f->>'data_source_id')::uuid,(f->>'required')::boolean,(f->>'allow_empty')::boolean,f->'mappings',f->'steps');
 END LOOP;
 INSERT INTO private.dpw_configuration_heads VALUES(rid,cid) ON CONFLICT(pipeline_id) DO UPDATE SET configuration_id=excluded.configuration_id;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.configuration.save',rid,jsonb_build_object('configuration_id',cid,'version',p.version));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'pipeline',to_jsonb(p),'configuration_id',cid,'is_new',true);
END $$;

CREATE FUNCTION public.dpw_create_delivery(_tenant_id uuid,_pipeline_id uuid,_business_date date,_request_key uuid,_correction_of uuid,_mode text DEFAULT 'prepare',_exclusion_approval_id uuid DEFAULT NULL,_execution_mode text DEFAULT 'manual',_human_in_loop boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); p public.data_prep_pipelines%ROWTYPE;
 b public.data_prep_delivery_batches%ROWTYPE; snap jsonb; f jsonb; exclusion public.data_prep_exclusion_requests%ROWTYPE; prior_run public.data_prep_delivery_runs%ROWTYPE;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 IF _execution_mode IS NULL OR _execution_mode NOT IN('manual','assisted','agentic') OR _human_in_loop IS NULL
 OR private.dpw_mode_attest(actor,_tenant_id,_pipeline_id,_execution_mode,_human_in_loop) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.mode_denied'; END IF;
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
 IF _business_date IS NULL OR _request_key IS NULL OR _mode IS NULL OR _mode NOT IN('preview','prepare') OR NOT p.enabled
 OR (_mode='prepare' AND (p.status<>'approved' OR p.lifecycle_state<>'production'))
 OR (_mode='preview' AND (p.status NOT IN('draft','approved') OR p.lifecycle_state='archived'))
 THEN RAISE EXCEPTION 'dpw.approved_production_required'; END IF;
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE tenant_id=_tenant_id AND created_by=actor AND request_key=_request_key;
 IF FOUND THEN
  IF b.pipeline_id<>_pipeline_id OR b.business_date<>_business_date OR b.correction_of IS DISTINCT FROM _correction_of OR b.mode<>_mode
  OR b.exclusion_approval_id IS DISTINCT FROM _exclusion_approval_id
  OR b.execution_mode<>_execution_mode OR b.human_in_loop<>_human_in_loop
  THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'batch',to_jsonb(b),'is_new',false);
 END IF;
 IF _correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_batches
 WHERE id=_correction_of AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id AND business_date=_business_date)
 THEN RAISE EXCEPTION 'dpw.correction_predecessor_mismatch'; END IF;
 snap:=private.dpw_snapshot(_pipeline_id)||jsonb_build_object('quality_gate','strict');
 IF _correction_of IS NOT NULL THEN
  SELECT * INTO prior_run FROM public.data_prep_delivery_runs WHERE batch_id=_correction_of AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id ORDER BY started_at DESC,id LIMIT 1;
  IF FOUND THEN
   snap:=snap||jsonb_build_object('correction_source_run_id',prior_run.id,'correction_source_files',prior_run.snapshot->'files','correction_manifest_origin','persisted_predecessor_run_inputs');
  ELSE
   -- A correction may precede the predecessor's first preparation. Freeze the
   -- actual received cohort now, under the predecessor batch lock; never use
   -- today's profiles to manufacture a historical processing snapshot.
   PERFORM 1 FROM public.data_prep_delivery_batches WHERE id=_correction_of FOR UPDATE;
   snap:=snap||jsonb_build_object('correction_source_run_id',NULL,'correction_manifest_origin','persisted_predecessor_received_files',
   'correction_source_files',coalesce((SELECT jsonb_agg(jsonb_build_object('file_id',x.id,'upload_id',x.upload_id,
   'feed_key',x.feed_key,'data_source_id',x.data_source_id,'pipeline_version',x.pipeline_version,'content_sha256',x.content_sha256,
   'original_path',x.original_path,'rows_count',u.row_count,'filename',x.descriptor->>'filename','correction_of',x.correction_of) ORDER BY x.created_at,x.id)
   FROM public.data_prep_delivery_files x JOIN public.workspace_data_source_uploads u ON u.id=x.upload_id
   WHERE x.batch_id=_correction_of AND x.tenant_id=_tenant_id AND x.state='received'),'[]'::jsonb));
  END IF;
 END IF;
 IF jsonb_array_length(snap->'feeds')=0 THEN RAISE EXCEPTION 'dpw.no_input_configuration'; END IF;
 IF _exclusion_approval_id IS NOT NULL THEN
  SELECT e.* INTO exclusion FROM public.data_prep_exclusion_requests e JOIN public.data_prep_exclusion_decisions d ON d.request_id=e.id
  WHERE d.id=_exclusion_approval_id AND d.decision='approved' AND e.tenant_id=_tenant_id AND e.pipeline_id=_pipeline_id
  AND e.pipeline_version=p.version AND e.batch_id=_correction_of;
  IF NOT FOUND THEN RAISE EXCEPTION 'dpw.approved_exclusion_correction_required'; END IF;
  snap:=snap||jsonb_build_object('exclusion_approval_id',_exclusion_approval_id,'approved_exclusions',exclusion.entries,'exclusion_source_run_id',exclusion.run_id);
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(snap->'feeds') LOOP
  IF private.dpw_source_allows(actor,_tenant_id,(f->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'dpw.source_denied'; END IF;
 END LOOP;
 INSERT INTO public.data_prep_delivery_batches(tenant_id,pipeline_id,pipeline_version,business_date,mode,execution_mode,human_in_loop,request_key,created_by,correction_of,configuration_snapshot,exclusion_approval_id)
 VALUES(_tenant_id,_pipeline_id,p.version,_business_date,_mode,_execution_mode,_human_in_loop,_request_key,actor,_correction_of,snap,_exclusion_approval_id) RETURNING * INTO b;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.delivery.create',b.id,jsonb_build_object('version',p.version,'correction_of',_correction_of));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'batch',to_jsonb(b),'is_new',true);
END $$;

CREATE FUNCTION private.dpw_lock_batch(_tenant uuid,_pipeline uuid,_batch uuid,_actor uuid,_collecting boolean)
RETURNS public.data_prep_delivery_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.data_prep_delivery_batches%ROWTYPE; p public.data_prep_pipelines%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=_pipeline AND tenant_id=_tenant FOR UPDATE;
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=_batch AND tenant_id=_tenant AND pipeline_id=_pipeline FOR UPDATE;
 IF private.dpw_mode_attest(_actor,_tenant,_pipeline,b.execution_mode,b.human_in_loop) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.mode_revoked'; END IF;
 IF NOT FOUND OR (_collecting AND b.state<>'collecting')
 OR p.version<>b.pipeline_version OR (b.mode='prepare' AND (p.status<>'approved' OR p.lifecycle_state<>'production'))
 OR (b.mode='preview' AND (p.status NOT IN('draft','approved') OR p.lifecycle_state='archived'))
 OR private.dpw_snapshot(_pipeline) IS DISTINCT FROM (b.configuration_snapshot-ARRAY['quality_gate','exclusion_approval_id','approved_exclusions','exclusion_source_run_id','correction_source_run_id','correction_source_files','correction_manifest_origin'])
 THEN RAISE EXCEPTION 'dpw.batch_binding_unavailable' USING ERRCODE='42501'; END IF;
 RETURN b;
END $$;

CREATE FUNCTION public.dpw_open_file_intent(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_feed_key text,_descriptor jsonb,_request_key uuid,_correction_of uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 f public.data_prep_delivery_files%ROWTYPE; profile jsonb; fid uuid:=gen_random_uuid(); newfile boolean:=true;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT value INTO profile FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=_feed_key;
 IF profile IS NULL OR private.dpw_source_allows(actor,_tenant_id,(profile->>'data_source_id')::uuid,'ingest') IS DISTINCT FROM true
 OR _request_key IS NULL OR jsonb_typeof(_descriptor) IS DISTINCT FROM 'object'
 OR (_descriptor->>'content_sha256') IS NULL OR (_descriptor->>'content_sha256') !~ '^[a-f0-9]{64}$'
 OR (_descriptor->>'parsed_sha256') IS NULL OR (_descriptor->>'parsed_sha256') !~ '^[a-f0-9]{64}$'
 OR (_descriptor->>'size_bytes') IS NULL OR (_descriptor->>'size_bytes')::bigint NOT BETWEEN 1 AND 52428800
 OR (_descriptor->>'parsed_bytes') IS NULL OR (_descriptor->>'parsed_bytes')::bigint NOT BETWEEN 2 AND 52428800
 OR (_descriptor->>'row_count') IS NULL OR (_descriptor->>'row_count')::integer NOT BETWEEN 0 AND 50000
 OR jsonb_typeof(_descriptor->'columns') IS DISTINCT FROM 'array' OR jsonb_array_length(_descriptor->'columns') NOT BETWEEN 1 AND 500
 OR length(coalesce(_descriptor->>'filename','')) NOT BETWEEN 1 AND 255 OR length(coalesce(_descriptor->>'mime_type','')) NOT BETWEEN 1 AND 255
 THEN RAISE EXCEPTION 'dpw.invalid_file_intent'; END IF;
 SELECT x.* INTO f FROM public.data_prep_delivery_files x JOIN public.data_prep_file_requests a ON a.file_id=x.id
 WHERE a.batch_id=b.id AND a.feed_key=_feed_key AND a.request_key=_request_key;
 IF FOUND THEN
  IF f.descriptor IS DISTINCT FROM _descriptor OR f.correction_of IS DISTINCT FROM _correction_of THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  newfile:=false;
 ELSE
  SELECT * INTO f FROM public.data_prep_delivery_files WHERE batch_id=b.id AND feed_key=_feed_key AND content_sha256=_descriptor->>'content_sha256';
  IF FOUND THEN
   IF f.descriptor IS DISTINCT FROM _descriptor THEN RAISE EXCEPTION 'dpw.same_file_descriptor_conflict'; END IF;
   newfile:=false;
  ELSE
   IF b.state<>'collecting' THEN RAISE EXCEPTION 'dpw.late_file_requires_correction'; END IF;
   IF _correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_files
   WHERE id=_correction_of AND batch_id=b.correction_of AND feed_key=_feed_key AND tenant_id=_tenant_id)
   THEN RAISE EXCEPTION 'dpw.file_correction_mismatch'; END IF;
   INSERT INTO public.data_prep_delivery_files(id,tenant_id,pipeline_id,batch_id,pipeline_version,feed_key,data_source_id,created_by,descriptor,request_key,content_sha256,original_path,correction_of)
   VALUES(fid,_tenant_id,_pipeline_id,b.id,b.pipeline_version,_feed_key,(profile->>'data_source_id')::uuid,actor,_descriptor,_request_key,
   _descriptor->>'content_sha256',_tenant_id::text||'/'||b.id::text||'/'||fid::text||'/original',_correction_of) RETURNING * INTO f;
  END IF;
 END IF;
 INSERT INTO public.data_prep_file_requests(batch_id,feed_key,request_key,file_id,requested_descriptor,created_by)
 VALUES(b.id,_feed_key,_request_key,f.id,_descriptor,actor) ON CONFLICT(batch_id,feed_key,request_key) DO NOTHING;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',private.dpw_file_metadata(f),'intent',private.dpw_file_metadata(f),'created',newfile,
 'storage_capability',jsonb_build_object('bucket_id','data-prep-inputs','public',false,'max_original_bytes',52428800,
 'max_expanded_bytes',52428800,'max_parsed_bytes',52428800,'max_rows',50000,'max_columns',500));
END $$;

CREATE FUNCTION public.dpw_commit_input_file(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_file_id uuid,_rows jsonb,_request_key uuid,_verified_subject jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_processor_actor(_tenant_id,_pipeline_id,_verified_subject,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 f public.data_prep_delivery_files%ROWTYPE; up uuid; profile jsonb;
BEGIN
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file_id AND batch_id=b.id AND tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR f.created_by<>actor OR NOT EXISTS(SELECT 1 FROM public.data_prep_file_requests WHERE batch_id=b.id AND file_id=f.id AND request_key=_request_key)
 OR private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'ingest') IS DISTINCT FROM true
 OR jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows)<>(f.descriptor->>'row_count')::integer
 OR octet_length(_rows::text)>52428800
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(_rows) WHERE jsonb_typeof(value)<>'object')
 THEN RAISE EXCEPTION 'dpw.complete_input_mismatch'; END IF;
 IF f.state='received' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workspace_data_source_uploads WHERE id=f.upload_id AND rows=_rows AND row_count=jsonb_array_length(_rows))
  THEN RAISE EXCEPTION 'dpw.immutable_upload_mismatch'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',to_jsonb(f),'is_new',false);
 END IF;
 IF f.state<>'uploading' OR b.state<>'collecting' THEN RAISE EXCEPTION 'dpw.intake_closed'; END IF;
 SELECT value INTO profile FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=f.feed_key;
 IF jsonb_array_length(_rows)=0 AND (profile->>'allow_empty')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.empty_input_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='data-prep-inputs' AND o.name=f.original_path
 AND (o.metadata->>'size')::bigint=(f.descriptor->>'size_bytes')::bigint)
 THEN RAISE EXCEPTION 'dpw.original_object_unconfirmed'; END IF;
 INSERT INTO public.workspace_data_source_uploads(data_source_id,tenant_id,filename,mime_type,size_bytes,row_count,columns,sample_rows,content_sha256,uploaded_by,rows)
 VALUES(f.data_source_id,_tenant_id,f.descriptor->>'filename',f.descriptor->>'mime_type',(f.descriptor->>'size_bytes')::bigint,
 jsonb_array_length(_rows),f.descriptor->'columns','[]'::jsonb,f.content_sha256,actor,_rows) RETURNING id INTO up;
 UPDATE public.data_prep_delivery_files SET state='received',upload_id=up,received_at=now(),structured_rows_sha256=private.dpw_hash(_rows) WHERE id=f.id RETURNING * INTO f;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.input.received',f.id,jsonb_build_object('batch_id',b.id,'upload_id',up,'row_count',jsonb_array_length(_rows),'sha256',f.content_sha256));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',to_jsonb(f),'transport_role','service_role','is_new',true);
END $$;

CREATE FUNCTION public.dpw_start_preparation(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_file_ids uuid[],_request_key uuid,_mode text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 r public.data_prep_delivery_runs%ROWTYPE; snap jsonb; bindings jsonb; profile jsonb;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 IF _mode IS NOT NULL AND _mode IS DISTINCT FROM b.mode THEN RAISE EXCEPTION 'dpw.delivery_mode_mismatch'; END IF;
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE batch_id=b.id AND request_key=_request_key;
 IF FOUND THEN
  IF r.started_by<>actor OR (SELECT array_agg(file_id ORDER BY file_id) FROM public.data_prep_run_inputs WHERE run_id=r.id)
  IS DISTINCT FROM (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(_file_ids) x) THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
   RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'run',to_jsonb(r)-'result','snapshot',r.snapshot,'is_new',false)||private.dpw_run_readback_metadata(r.id,actor);
 END IF;
 IF b.state<>'collecting' OR _request_key IS NULL OR cardinality(_file_ids) IS NULL OR cardinality(_file_ids)=0
 OR cardinality(_file_ids)<>(SELECT count(DISTINCT x) FROM unnest(_file_ids) x)
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_files WHERE batch_id=b.id AND state<>'received')
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_files WHERE id=ANY(_file_ids) AND private.dpw_attachment_viewable(id) IS DISTINCT FROM true)
 OR (SELECT count(*) FROM public.data_prep_delivery_files WHERE id=ANY(_file_ids) AND batch_id=b.id AND state='received')<>cardinality(_file_ids)
 THEN RAISE EXCEPTION 'dpw.inputs_incomplete'; END IF;
 IF (SELECT sum((descriptor->>'row_count')::integer) FROM public.data_prep_delivery_files WHERE id=ANY(_file_ids))>50000
 THEN RAISE EXCEPTION 'dpw.delivery_row_limit_exceeded_no_truncation'; END IF;
 IF b.exclusion_approval_id IS NOT NULL AND (
 cardinality(_file_ids)<>(SELECT count(*) FROM public.data_prep_run_inputs WHERE run_id=(b.configuration_snapshot->>'exclusion_source_run_id')::uuid)
 OR EXISTS(SELECT 1 FROM public.data_prep_run_inputs oldinput
 WHERE oldinput.run_id=(b.configuration_snapshot->>'exclusion_source_run_id')::uuid AND NOT EXISTS(
 SELECT 1 FROM public.data_prep_delivery_files newfile JOIN public.workspace_data_source_uploads newupload ON newupload.id=newfile.upload_id
 WHERE newfile.id=ANY(_file_ids) AND newfile.correction_of=oldinput.file_id AND newfile.content_sha256=oldinput.content_sha256
 AND newupload.row_count=oldinput.row_count AND newfile.feed_key=oldinput.feed_key)))
 THEN RAISE EXCEPTION 'dpw.exclusion_requires_complete_original_file_delivery_rerun'; END IF;
 FOR profile IN SELECT value FROM jsonb_array_elements(b.configuration_snapshot->'feeds') LOOP
  IF private.dpw_source_allows(actor,_tenant_id,(profile->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'dpw.source_denied'; END IF;
  IF (profile->>'required')::boolean AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_files
  WHERE id=ANY(_file_ids) AND batch_id=b.id AND feed_key=profile->>'key' AND state='received') THEN RAISE EXCEPTION 'dpw.required_feed_missing'; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('file_id',f.id,'upload_id',f.upload_id,'content_sha256',f.content_sha256,'original_path',f.original_path,'correction_of',f.correction_of,
 'feed_key',f.feed_key,'profile_version',f.pipeline_version,'data_source_id',f.data_source_id,
 'layout_id',(SELECT value->>'layout_id' FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=f.feed_key),
 'business_date',b.business_date,'rows_count',u.row_count)) ORDER BY f.feed_key,f.id) INTO bindings
 FROM public.data_prep_delivery_files f JOIN public.workspace_data_source_uploads u ON u.id=f.upload_id
 WHERE f.id=ANY(_file_ids) AND f.batch_id=b.id AND f.state='received';
 snap:=b.configuration_snapshot||jsonb_build_object('batch_id',b.id,'business_date',b.business_date,'mode',b.mode,'files',bindings);
 IF b.correction_of IS NOT NULL THEN snap:=snap||jsonb_build_object('correction_of',b.correction_of); END IF;
 IF b.exclusion_approval_id IS NOT NULL THEN
  snap:=snap||jsonb_build_object('correction_source_files',(SELECT snapshot->'files' FROM public.data_prep_delivery_runs WHERE id=(b.configuration_snapshot->>'exclusion_source_run_id')::uuid));
 END IF;
 INSERT INTO public.data_prep_delivery_runs(tenant_id,pipeline_id,batch_id,pipeline_version,request_key,started_by,snapshot,snapshot_sha256)
 VALUES(_tenant_id,_pipeline_id,b.id,b.pipeline_version,_request_key,actor,snap,private.dpw_hash(snap)) RETURNING * INTO r;
 INSERT INTO public.data_prep_run_inputs(run_id,file_id,upload_id,tenant_id,feed_key,content_sha256,row_count)
 SELECT r.id,f.id,f.upload_id,_tenant_id,f.feed_key,f.content_sha256,u.row_count FROM public.data_prep_delivery_files f
 JOIN public.workspace_data_source_uploads u ON u.id=f.upload_id WHERE f.id=ANY(_file_ids);
 UPDATE public.data_prep_delivery_batches SET state='processing' WHERE id=b.id;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.preparation.start',r.id,jsonb_build_object('snapshot_sha256',r.snapshot_sha256,'batch_id',b.id));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'run',to_jsonb(r)-'result','snapshot',snap,'is_new',true)||private.dpw_run_readback_metadata(r.id,actor);
END $$;

CREATE FUNCTION public.dpw_request_exclusion(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_run_id uuid,_entries jsonb,_reason text,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); r public.data_prep_delivery_runs%ROWTYPE;
 e public.data_prep_exclusion_requests%ROWTYPE; item jsonb;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id AND batch_id=_batch_id FOR SHARE;
 IF NOT FOUND OR r.finished_at IS NULL OR _request_key IS NULL OR length(coalesce(btrim(_reason),'')) NOT BETWEEN 3 AND 1000
 OR jsonb_typeof(_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(_entries) NOT BETWEEN 1 AND 50000
 OR (SELECT count(DISTINCT (value->>'file_id',value->>'record_index')) FROM jsonb_array_elements(_entries))<>jsonb_array_length(_entries)
 THEN RAISE EXCEPTION 'dpw.invalid_exclusion_request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||actor::text||_request_key::text,41));
 SELECT * INTO e FROM public.data_prep_exclusion_requests WHERE tenant_id=_tenant_id AND requested_by=actor AND request_key=_request_key;
 IF FOUND THEN
  IF e.run_id<>r.id OR e.entries IS DISTINCT FROM _entries OR e.reason<>btrim(_reason) THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'exclusion_request',to_jsonb(e),'is_new',false);
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_entries) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_delivery_files f ON f.id=i.file_id
  WHERE i.run_id=r.id AND i.file_id=(item->>'file_id')::uuid AND i.content_sha256=item->>'content_sha256'
  AND (item->>'record_index')::integer BETWEEN 0 AND i.row_count-1
  AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS TRUE)
  THEN RAISE EXCEPTION 'dpw.exclusion_original_binding_mismatch'; END IF;
 END LOOP;
 INSERT INTO public.data_prep_exclusion_requests(tenant_id,pipeline_id,pipeline_version,batch_id,run_id,entries,reason,request_key,requested_by)
 VALUES(_tenant_id,_pipeline_id,r.pipeline_version,_batch_id,r.id,_entries,btrim(_reason),_request_key,actor) RETURNING * INTO e;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.exclusion.request',e.id,jsonb_build_object('run_id',r.id,'entries',_entries,'reason',btrim(_reason)));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'exclusion_request',to_jsonb(e),'is_new',true);
END $$;

CREATE FUNCTION public.dpw_decide_exclusion(_tenant_id uuid,_pipeline_id uuid,_request_id uuid,_approve boolean,_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'manage'); e public.data_prep_exclusion_requests%ROWTYPE;
 d public.data_prep_exclusion_decisions%ROWTYPE; target_decision text:=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,true);
 SELECT * INTO e FROM public.data_prep_exclusion_requests WHERE id=_request_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id FOR UPDATE;
 IF public.user_has_permission(actor,_tenant_id,'data.prep.promote',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.independent_review_permission_required'; END IF;
 IF NOT FOUND OR _approve IS NULL OR length(coalesce(btrim(_comment),'')) NOT BETWEEN 3 AND 1000
 OR actor=e.requested_by OR EXISTS(SELECT 1 FROM public.data_prep_delivery_runs WHERE id=e.run_id AND started_by=actor)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.entries) x JOIN public.data_prep_delivery_files f ON f.id=(x.value->>'file_id')::uuid WHERE f.created_by=actor)
 THEN RAISE EXCEPTION 'dpw.independent_human_exclusion_checker_required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(e.entries) x JOIN public.data_prep_delivery_files f ON f.id=(x.value->>'file_id')::uuid
 WHERE private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'dpw.exclusion_source_denied'; END IF;
 SELECT * INTO d FROM public.data_prep_exclusion_decisions WHERE request_id=e.id;
 IF FOUND THEN
  IF d.decided_by<>actor OR d.decision<>target_decision OR d.comment<>btrim(_comment) THEN RAISE EXCEPTION 'dpw.immutable_exclusion_decision'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'decision',to_jsonb(d),'is_new',false);
 END IF;
 INSERT INTO public.data_prep_exclusion_decisions(request_id,decision,decided_by,comment) VALUES(e.id,target_decision,actor,btrim(_comment)) RETURNING * INTO d;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.exclusion.decide',d.id,jsonb_build_object('request_id',e.id,'decision',target_decision,'four_eyes',true,'complete_rerun_required',true));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'decision',to_jsonb(d),'is_new',true);
END $$;

CREATE FUNCTION private.dpw_input_reference(_run_id uuid,_reference jsonb) RETURNS public.workspace_data_source_uploads
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.data_prep_delivery_runs%ROWTYPE; binding jsonb; profile jsonb; u public.workspace_data_source_uploads%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id;
 SELECT value INTO binding FROM jsonb_array_elements(r.snapshot->'files') WHERE value->>'file_id'=_reference->>'file_id';
 SELECT value INTO profile FROM jsonb_array_elements(r.snapshot->'feeds') WHERE value->>'key'=binding->>'feed_key';
 IF binding IS NULL OR profile IS NULL OR _reference @> (binding||jsonb_build_object('vendor',profile->>'vendor',
 'business_side',profile->>'business_side','record_type',profile->>'record_type')) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dpw.lineage_source_binding_mismatch'; END IF;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(binding->>'upload_id')::uuid
 AND tenant_id=r.tenant_id AND data_source_id=(binding->>'data_source_id')::uuid;
 IF NOT FOUND OR (_reference->>'record_index')::integer IS NULL OR (_reference->>'record_index')::integer NOT BETWEEN 0 AND u.row_count-1
 THEN RAISE EXCEPTION 'dpw.lineage_record_index_mismatch'; END IF;
 RETURN u;
END $$;

CREATE FUNCTION public.dpw_finish_preparation(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_run_id uuid,_request_key uuid,_verified_subject jsonb,_snapshot_sha256 text,_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; b public.data_prep_delivery_batches%ROWTYPE; r public.data_prep_delivery_runs%ROWTYPE;
 status text:=_result->>'status'; expected_status text; has_failure boolean; has_critical boolean;
 eligible boolean; item jsonb; ref jsonb; u public.workspace_data_source_uploads%ROWTYPE; n integer; allinputs integer;
BEGIN
 actor:=private.dpw_processor_actor(_tenant_id,_pipeline_id,_verified_subject,'run');
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id AND batch_id=b.id AND tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR r.started_by<>actor OR r.request_key<>_request_key
 OR r.snapshot_sha256 IS DISTINCT FROM _snapshot_sha256
 OR jsonb_typeof(_result->'acceptedRows') IS DISTINCT FROM 'array' OR jsonb_array_length(_result->'acceptedRows')>50000
 OR jsonb_typeof(_result->'rejectedRecords') IS DISTINCT FROM 'array' OR jsonb_typeof(_result->'dqResults') IS DISTINCT FROM 'array'
 OR jsonb_typeof(_result->'outputLineage') IS DISTINCT FROM 'array' OR jsonb_typeof(_result->'countsPerFeed') IS DISTINCT FROM 'array'
 OR status IS NULL OR status NOT IN('success','warn','failed')
 THEN RAISE EXCEPTION 'dpw.processor_snapshot_result_mismatch'; END IF;
 _result:=(_result-ARRAY['content_sha256','lineage_sha256','snapshot_sha256'])||jsonb_build_object(
 'structured_data_sha256',private.dpw_hash(_result->'acceptedRows'),'structured_lineage_sha256',private.dpw_hash(_result->'outputLineage'),
 'native_snapshot_sha256',r.snapshot_sha256);
 FOR item IN SELECT value FROM jsonb_array_elements(r.snapshot->'feeds') LOOP
  IF private.dpw_source_allows(actor,_tenant_id,(item->>'data_source_id')::uuid,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.source_revoked'; END IF;
 END LOOP;
 IF r.finished_at IS NOT NULL THEN
  IF r.result IS DISTINCT FROM _result THEN RAISE EXCEPTION 'dpw.completion_conflict'; END IF;
  RETURN jsonb_build_object('tenant_id',_tenant_id,'run',to_jsonb(r),'processor_actor_id',actor,'transport_role','service_role','is_new',false);
 END IF;
 IF r.state<>'running' OR b.state<>'processing' THEN RAISE EXCEPTION 'dpw.processor_run_closed'; END IF;
 -- The server computes transforms. Native rejects inconsistent declared DQ,
 -- all input totals and references, and never infers ready from output presence.
 IF jsonb_array_length(_result->'dqResults')<>jsonb_array_length(r.snapshot->'dq_rules')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(_result->'dqResults') WITH ORDINALITY d(value,ord)
 WHERE jsonb_typeof(value->'failures') IS DISTINCT FROM 'number' OR jsonb_typeof(value->'total') IS DISTINCT FROM 'number'
 OR (value->>'failures')::integer<0 OR (value->>'failures')::integer>(value->>'total')::integer
 OR value->>'rule_id' IS DISTINCT FROM r.snapshot->'dq_rules'->(ord::integer-1)->>'id'
 OR value->>'field' IS DISTINCT FROM r.snapshot->'dq_rules'->(ord::integer-1)->>'field'
 OR value->>'kind' IS DISTINCT FROM r.snapshot->'dq_rules'->(ord::integer-1)->>'kind'
 OR value->>'severity' IS DISTINCT FROM coalesce(r.snapshot->'dq_rules'->(ord::integer-1)->>'severity','warning'))
 THEN RAISE EXCEPTION 'dpw.dq_evidence_incomplete'; END IF;
 SELECT coalesce(bool_or((value->>'failures')::integer>0),false),
 coalesce(bool_or((value->>'failures')::integer>0 AND value->>'severity'<>'info'),false)
 INTO has_failure,has_critical FROM jsonb_array_elements(_result->'dqResults');
 expected_status:=CASE WHEN has_critical OR (_result->>'blocking_failure')::boolean IS TRUE THEN 'failed'
 WHEN has_failure THEN 'warn' ELSE 'success' END;
 IF status IS DISTINCT FROM expected_status THEN RAISE EXCEPTION 'dpw.dq_status_mismatch'; END IF;
 eligible:=b.mode='prepare' AND status<>'failed';
 IF status<>'failed' AND EXISTS(SELECT 1 FROM jsonb_array_elements(_result->'rejectedRecords') WHERE value->>'disposition'='blocked')
 THEN RAISE EXCEPTION 'dpw.blocked_rows_cannot_release'; END IF;
 IF (_result->>'publication_eligible')::boolean IS DISTINCT FROM eligible OR (status='failed' AND jsonb_array_length(_result->'acceptedRows')<>0)
 THEN RAISE EXCEPTION 'dpw.dq_disposition_mismatch'; END IF;
 SELECT sum(row_count) INTO allinputs FROM public.data_prep_run_inputs WHERE run_id=r.id;
 IF (SELECT sum((value->>'input')::integer) FROM jsonb_array_elements(_result->'countsPerFeed')) IS DISTINCT FROM allinputs
 OR (SELECT sum((value->>'accepted')::integer) FROM jsonb_array_elements(_result->'countsPerFeed')) IS DISTINCT FROM jsonb_array_length(_result->'acceptedRows')
 THEN RAISE EXCEPTION 'dpw.full_input_totals_mismatch'; END IF;
 IF jsonb_array_length(_result->'outputLineage')<>jsonb_array_length(_result->'acceptedRows') THEN RAISE EXCEPTION 'dpw.output_lineage_incomplete'; END IF;
 n:=0;
 FOR item IN SELECT value FROM jsonb_array_elements(_result->'outputLineage') LOOP
  IF (item->>'output_index')::integer IS DISTINCT FROM n OR item->>'pipeline_id' IS DISTINCT FROM _pipeline_id::text
  OR (item->>'pipeline_version')::integer IS DISTINCT FROM r.pipeline_version OR item->>'batch_id' IS DISTINCT FROM b.id::text
  OR item->>'business_date' IS DISTINCT FROM b.business_date::text OR jsonb_typeof(item->'sources') IS DISTINCT FROM 'array'
  OR jsonb_array_length(item->'sources')=0 THEN RAISE EXCEPTION 'dpw.lineage_binding_mismatch'; END IF;
  IF (SELECT count(DISTINCT value->>'business_side') FROM jsonb_array_elements(item->'sources'))<>1
  OR (SELECT count(DISTINCT value->>'record_type') FROM jsonb_array_elements(item->'sources'))<>1
  THEN RAISE EXCEPTION 'dpw.opposing_logical_sides_or_record_types_cannot_merge'; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(item->'sources') LOOP
   u:=private.dpw_input_reference(r.id,ref);
   INSERT INTO public.data_prep_record_lineage VALUES(r.id,n,(ref->>'file_id')::uuid,(ref->>'record_index')::integer);
  END LOOP;
  n:=n+1;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(_result->'rejectedRecords') LOOP
  ref:=item->'source';
  u:=private.dpw_input_reference(r.id,ref);
  IF u.rows->((ref->>'record_index')::integer) IS DISTINCT FROM item->'original_row' THEN RAISE EXCEPTION 'dpw.reject_source_mismatch'; END IF;
  IF item->>'disposition'='dropped' AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_files f,
  jsonb_array_elements(coalesce(r.snapshot->'approved_exclusions','[]'::jsonb)) e
  WHERE f.id=(ref->>'file_id')::uuid AND f.correction_of=(e.value->>'file_id')::uuid
  AND f.content_sha256=e.value->>'content_sha256' AND (ref->>'record_index')::integer=(e.value->>'record_index')::integer
  AND b.exclusion_approval_id IS NOT NULL)
  THEN RAISE EXCEPTION 'dpw.exclusion_requires_independent_approval_and_complete_rerun'; END IF;
  INSERT INTO public.data_prep_reject_lineage(tenant_id,run_id,file_id,source_index,disposition,original_row,prepared_row,reasons)
  VALUES(_tenant_id,r.id,(ref->>'file_id')::uuid,(ref->>'record_index')::integer,item->>'disposition',item->'original_row',item->'prepared_row',item->'reasons');
 END LOOP;
 IF (SELECT count(*) FROM (SELECT file_id,source_index FROM public.data_prep_record_lineage WHERE run_id=r.id
 UNION SELECT file_id,source_index FROM public.data_prep_reject_lineage WHERE run_id=r.id) covered)<>allinputs
 THEN RAISE EXCEPTION 'dpw.full_input_lineage_coverage_required'; END IF;
 UPDATE public.data_prep_delivery_runs SET state=status,result=_result,result_sha256=private.dpw_hash(_result),finished_at=now() WHERE id=r.id RETURNING * INTO r;
 UPDATE public.data_prep_delivery_batches SET state=CASE WHEN eligible THEN 'prepared' ELSE 'failed' END WHERE id=b.id;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.preparation.finish',r.id,jsonb_build_object('status',status,'result_sha256',r.result_sha256,'transport','closed_service_processor'));
 RETURN jsonb_build_object('tenant_id',_tenant_id,'run',to_jsonb(r),'processor_actor_id',actor,'transport_role','service_role','is_new',true);
END $$;

CREATE FUNCTION public.dpw_fail_preparation(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_run_id uuid,_request_key uuid,_verified_subject jsonb,_snapshot_sha256 text,_kind text,_error text,_phase text DEFAULT 'processing',_interrupted boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_processor_actor(_tenant_id,_pipeline_id,_verified_subject,'run');
 b public.data_prep_delivery_batches%ROWTYPE; r public.data_prep_delivery_runs%ROWTYPE; failure jsonb; observed bigint;
BEGIN
 PERFORM 1 FROM public.data_prep_pipelines WHERE id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=_batch_id AND pipeline_id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id AND batch_id=_batch_id AND pipeline_id=_pipeline_id AND tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR r.started_by<>actor OR r.request_key<>_request_key OR r.snapshot_sha256 IS DISTINCT FROM _snapshot_sha256
 OR _kind IS NULL OR _kind NOT IN('validation','transformation','precision','intake','processor') OR length(coalesce(_error,'')) NOT BETWEEN 1 AND 2000
 OR _phase IS NULL OR _phase NOT IN('processing','input_validation','transformation','data_quality','output_preparation') OR _interrupted IS NULL
 THEN RAISE EXCEPTION 'dpw.failure_binding_denied'; END IF;
 IF EXISTS(SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_delivery_files f ON f.id=i.file_id WHERE i.run_id=r.id
 AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true) THEN RAISE EXCEPTION 'dpw.failure_source_revoked'; END IF;
 SELECT coalesce(sum(row_count),0) INTO observed FROM public.data_prep_run_inputs WHERE run_id=r.id;
 failure:=jsonb_build_object('status','failed','blocking_failure',true,'publication_eligible',false,'acceptedRows','[]'::jsonb,
 'outputLineage','[]'::jsonb,'dqResults',NULL,'dq_execution','unavailable_not_fabricated','error',jsonb_build_object('kind',_kind,'message',_error),
 'native_snapshot_sha256',r.snapshot_sha256,'phase',_phase,'interrupted',_interrupted,
 'rows_in_observed',observed,'input_processing_state','not_processed_or_interrupted','processed_row_count',NULL);
 IF r.finished_at IS NOT NULL THEN
  IF r.result IS DISTINCT FROM failure THEN RAISE EXCEPTION 'dpw.failure_history_immutable'; END IF;
  RETURN jsonb_build_object('tenant_id',_tenant_id,'processor_actor_id',actor,'transport_role','service_role','run',to_jsonb(r),'is_new',false);
 END IF;
 IF r.state<>'running' OR b.state<>'processing' THEN RAISE EXCEPTION 'dpw.failure_run_not_running'; END IF;
 UPDATE public.data_prep_delivery_runs SET state='failed',finished_at=now(),result=failure,result_sha256=private.dpw_hash(failure) WHERE id=r.id RETURNING * INTO r;
 UPDATE public.data_prep_delivery_batches SET state='failed' WHERE id=b.id;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.preparation.failure',r.id,jsonb_build_object('kind',_kind,'result_sha256',r.result_sha256,'snapshot_sha256',r.snapshot_sha256));
 RETURN jsonb_build_object('tenant_id',_tenant_id,'processor_actor_id',actor,'transport_role','service_role','run',to_jsonb(r),'is_new',true);
END $$;

CREATE FUNCTION public.dpw_request_release(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_run_id uuid,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); r public.data_prep_delivery_runs%ROWTYPE;
 b public.data_prep_delivery_batches%ROWTYPE; approval public.data_prep_release_requests%ROWTYPE;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id AND batch_id=b.id AND tenant_id=_tenant_id FOR SHARE;
 IF NOT FOUND OR _request_key IS NULL OR b.mode<>'prepare' OR b.state<>'prepared' OR r.state NOT IN('success','warn')
 OR r.finished_at IS NULL OR (r.result->>'publication_eligible')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.release_success_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||actor::text||_request_key::text,51));
 SELECT * INTO approval FROM public.data_prep_release_requests WHERE tenant_id=_tenant_id AND requested_by=actor AND request_key=_request_key;
 IF FOUND THEN
  IF approval.run_id<>r.id OR approval.result_sha256<>r.result_sha256 THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'release_request',to_jsonb(approval),'is_new',false);
 END IF;
 INSERT INTO public.data_prep_release_requests(tenant_id,pipeline_id,batch_id,run_id,pipeline_version,result_sha256,request_key,requested_by)
 VALUES(_tenant_id,_pipeline_id,b.id,r.id,r.pipeline_version,r.result_sha256,_request_key,actor) RETURNING * INTO approval;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.release.request',approval.id,jsonb_build_object('run_id',r.id,'result_sha256',r.result_sha256));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'release_request',to_jsonb(approval),'is_new',true);
END $$;

CREATE FUNCTION public.dpw_decide_release(_tenant_id uuid,_pipeline_id uuid,_request_id uuid,_approve boolean,_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'manage'); request public.data_prep_release_requests%ROWTYPE;
 decision public.data_prep_release_decisions%ROWTYPE; target text:=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,true);
 SELECT * INTO request FROM public.data_prep_release_requests WHERE id=_request_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id FOR UPDATE;
 IF public.user_has_permission(actor,_tenant_id,'data.prep.promote',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.independent_review_permission_required'; END IF;
 IF NOT FOUND OR _approve IS NULL OR length(coalesce(btrim(_comment),'')) NOT BETWEEN 3 AND 1000 OR request.requested_by=actor
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_runs WHERE id=request.run_id AND started_by=actor)
 OR EXISTS(SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_delivery_files f ON f.id=i.file_id WHERE i.run_id=request.run_id AND f.created_by=actor)
 THEN RAISE EXCEPTION 'dpw.independent_human_release_checker_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_runs WHERE id=request.run_id AND result_sha256=request.result_sha256
 AND pipeline_version=request.pipeline_version AND state IN('success','warn') AND (result->>'publication_eligible')::boolean IS TRUE)
 THEN RAISE EXCEPTION 'dpw.release_snapshot_stale'; END IF;
 SELECT * INTO decision FROM public.data_prep_release_decisions WHERE request_id=request.id;
 IF FOUND THEN
  IF decision.decided_by<>actor OR decision.decision<>target OR decision.comment<>btrim(_comment) THEN RAISE EXCEPTION 'dpw.immutable_release_decision'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'decision',to_jsonb(decision),'is_new',false);
 END IF;
 INSERT INTO public.data_prep_release_decisions(request_id,decision,decided_by,comment) VALUES(request.id,target,actor,btrim(_comment)) RETURNING * INTO decision;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.release.decide',decision.id,jsonb_build_object('request_id',request.id,'result_sha256',request.result_sha256,'decision',target,'four_eyes',true));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'decision',to_jsonb(decision),'is_new',true);
END $$;

CREATE FUNCTION public.dpw_publish_dataset(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_run_id uuid,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 r public.data_prep_delivery_runs%ROWTYPE; d public.data_prep_prepared_datasets%ROWTYPE; up uuid; src uuid; f jsonb;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id AND batch_id=b.id AND tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR r.started_by<>actor OR _request_key IS NULL THEN RAISE EXCEPTION 'dpw.publish_binding_denied'; END IF;
 SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE run_id=r.id;
 IF FOUND THEN
  IF d.request_key<>_request_key THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'dataset',to_jsonb(d),'is_new',false);
 END IF;
 IF b.mode<>'prepare' OR b.state<>'prepared' OR r.state NOT IN('success','warn') OR r.finished_at IS NULL
 OR private.dpw_run_payload_available(r.id) IS DISTINCT FROM true
 OR (r.result->>'publication_eligible')::boolean IS DISTINCT FROM true OR r.pipeline_version<>b.pipeline_version
 OR private.dpw_hash(r.result) IS DISTINCT FROM r.result_sha256 THEN RAISE EXCEPTION 'dpw.current_successful_dq_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.data_prep_release_requests a JOIN public.data_prep_release_decisions decision ON decision.request_id=a.id
 WHERE a.run_id=r.id AND a.result_sha256=r.result_sha256 AND a.pipeline_version=r.pipeline_version AND decision.decision='approved')
 THEN RAISE EXCEPTION 'dpw.human_release_approval_required'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(r.snapshot->'feeds') LOOP
  IF private.dpw_source_allows(actor,_tenant_id,(f->>'data_source_id')::uuid,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.source_revoked'; END IF;
 END LOOP;
 src:=(r.snapshot->>'output_data_source_id')::uuid;
 IF private.dpw_source_allows(actor,_tenant_id,src,'ingest') IS DISTINCT FROM true OR private.dpw_source_allows(actor,_tenant_id,src,'edit') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dpw.output_source_denied'; END IF;
 INSERT INTO public.workspace_data_source_uploads(data_source_id,tenant_id,filename,mime_type,size_bytes,row_count,columns,sample_rows,content_sha256,uploaded_by,rows)
 VALUES(src,_tenant_id,'prepared-'||r.id::text||'.json','application/json',octet_length((r.result->'acceptedRows')::text),
 jsonb_array_length(r.result->'acceptedRows'),coalesce(r.result->'profile'->'columns','[]'::jsonb),'[]'::jsonb,r.result->>'structured_data_sha256',actor,r.result->'acceptedRows') RETURNING id INTO up;
 INSERT INTO public.data_prep_prepared_datasets(tenant_id,pipeline_id,pipeline_version,batch_id,run_id,business_date,data_source_id,upload_id,rows,content_sha256,request_key,published_by)
 VALUES(_tenant_id,_pipeline_id,r.pipeline_version,b.id,r.id,b.business_date,src,up,jsonb_array_length(r.result->'acceptedRows'),r.result->>'structured_data_sha256',_request_key,actor) RETURNING * INTO d;
 UPDATE public.data_prep_delivery_batches SET state='published' WHERE id=b.id;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.dataset.publish',d.id,jsonb_build_object('upload_id',up,'run_id',r.id,'version',r.pipeline_version));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'dataset',to_jsonb(d),'is_new',true);
END $$;

CREATE FUNCTION private.dpw_storage_allows(_name text,_write boolean) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE actor uuid; f public.data_prep_delivery_files%ROWTYPE; b public.data_prep_delivery_batches%ROWTYPE;
BEGIN
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE original_path=_name;
 IF NOT FOUND THEN RETURN false; END IF;
 actor:=private.dpw_actor(f.tenant_id);
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=f.batch_id;
 RETURN (NOT _write OR f.created_by=actor) AND private.dpw_attachment_viewable(f.id) IS TRUE
 AND private.data_prep_pipeline_scope_allows(actor,f.tenant_id,f.pipeline_id,'run') IS TRUE
 AND private.dpw_source_allows(actor,f.tenant_id,f.data_source_id,CASE WHEN _write THEN 'ingest' ELSE 'view' END) IS TRUE
 AND (NOT _write OR (f.state='uploading' AND b.state='collecting'));
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('data-prep-inputs','data-prep-inputs',false,52428800);
CREATE POLICY dpw_original_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='data-prep-inputs' AND private.dpw_storage_allows(name,false));
CREATE POLICY dpw_original_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='data-prep-inputs' AND private.dpw_storage_allows(name,true));
-- Restrictive fences also defeat future permissive policies for this bucket.
CREATE POLICY dpw_original_read_fence ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'data-prep-inputs' OR private.dpw_storage_allows(name,false));
CREATE POLICY dpw_original_insert_fence ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'data-prep-inputs' OR private.dpw_storage_allows(name,true));
CREATE POLICY dpw_original_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'data-prep-inputs') WITH CHECK(bucket_id<>'data-prep-inputs');
CREATE POLICY dpw_original_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'data-prep-inputs');

CREATE FUNCTION private.dpw_guard_upload_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.data_prep_delivery_files WHERE upload_id=OLD.id)
 OR EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets WHERE upload_id=OLD.id)
 THEN RAISE EXCEPTION 'dpw.immutable_upload_history' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER dpw_upload_history BEFORE UPDATE OR DELETE ON public.workspace_data_source_uploads FOR EACH ROW EXECUTE FUNCTION private.dpw_guard_upload_history();

CREATE FUNCTION private.dpw_guard_file() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'uploading' OR NEW.state<>'received' OR NEW.upload_id IS NULL OR NEW.received_at IS NULL
 OR NEW.structured_rows_sha256 IS NULL
 OR (to_jsonb(NEW)-ARRAY['state','upload_id','received_at','structured_rows_sha256']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','upload_id','received_at','structured_rows_sha256'])
 THEN RAISE EXCEPTION 'dpw.immutable_input_intent' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dpw_file_immutable BEFORE UPDATE OR DELETE ON public.data_prep_delivery_files FOR EACH ROW EXECUTE FUNCTION private.dpw_guard_file();
CREATE FUNCTION private.dpw_guard_run() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.finished_at IS NOT NULL OR OLD.state<>'running' OR NEW.finished_at IS NULL OR NEW.state='running'
 OR (to_jsonb(NEW)-ARRAY['state','result','result_sha256','finished_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result','result_sha256','finished_at'])
 THEN RAISE EXCEPTION 'dpw.immutable_preparation_run' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dpw_run_immutable BEFORE UPDATE OR DELETE ON public.data_prep_delivery_runs FOR EACH ROW EXECUTE FUNCTION private.dpw_guard_run();

CREATE FUNCTION private.dpw_guard_batch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')
 OR NOT((OLD.state='collecting' AND NEW.state='processing') OR (OLD.state='processing' AND NEW.state IN('prepared','failed'))
 OR (OLD.state='prepared' AND NEW.state='published')) THEN RAISE EXCEPTION 'dpw.immutable_delivery_binding'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dpw_batch_binding BEFORE UPDATE OR DELETE ON public.data_prep_delivery_batches FOR EACH ROW EXECUTE FUNCTION private.dpw_guard_batch();

CREATE FUNCTION private.dpw_page(_page integer,_size integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF _page IS NULL OR _size IS NULL OR _page<1 OR _page>100000 OR _size NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'dpw.invalid_page'; END IF;
 RETURN (_page-1)*_size;
END $$;

CREATE FUNCTION public.dpw_list_pipelines(_tenant_id uuid,_search text DEFAULT NULL,_status text DEFAULT NULL,_page integer DEFAULT 1,_page_size integer DEFAULT 50,_updated_from timestamptz DEFAULT NULL,_updated_through timestamptz DEFAULT NULL,_bu_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant_id); off integer:=private.dpw_page(_page,_page_size); result jsonb;
BEGIN
 IF _status IS NOT NULL AND _status NOT IN('draft','approved','archived') OR length(coalesce(_search,''))>200 THEN RAISE EXCEPTION 'dpw.invalid_filter'; END IF;
 IF _updated_from IS NOT NULL AND _updated_through IS NOT NULL AND _updated_from>_updated_through THEN RAISE EXCEPTION 'dpw.invalid_updated_period'; END IF;
 IF _bu_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_units WHERE id=_bu_id AND tenant_id=_tenant_id AND NOT is_archived) THEN RAISE EXCEPTION 'dpw.current_bu_scope_denied'; END IF;
 WITH scoped AS (SELECT p.* FROM public.data_prep_pipelines p WHERE p.tenant_id=_tenant_id
 AND private.data_prep_pipeline_scope_allows(actor,_tenant_id,p.id,'view') IS TRUE
 AND (_bu_id IS NULL OR p.bu_id=_bu_id OR EXISTS(SELECT 1 FROM public.data_resource_registry r JOIN public.data_resource_registry_owner_bu owner ON owner.registry_id=r.id
 WHERE r.tenant_id=_tenant_id AND r.data_prep_pipeline_id=p.id AND owner.tenant_id=_tenant_id AND owner.bu_id=_bu_id))),
 filtered AS (SELECT p.* FROM scoped p WHERE (_status IS NULL OR p.status=_status)
 AND (_updated_from IS NULL OR p.updated_at>=_updated_from) AND (_updated_through IS NULL OR p.updated_at<_updated_through)
 AND (_search IS NULL OR strpos(lower(concat_ws(' ',p.id::text,p.public_uid,p.name,p.description)),lower(_search))>0
 OR EXISTS(SELECT 1 FROM public.data_prep_input_profiles f JOIN private.dpw_configuration_heads h ON h.configuration_id=f.configuration_id
 WHERE h.pipeline_id=p.id AND strpos(lower(concat_ws(' ',f.feed_key,f.name,f.vendor,f.layout_id)),lower(_search))>0)
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_files f WHERE f.pipeline_id=p.id AND f.tenant_id=_tenant_id
 AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS TRUE
 AND strpos(lower(concat_ws(' ',f.id::text,f.content_sha256,f.descriptor->>'filename')),lower(_search))>0)
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_batches b WHERE b.pipeline_id=p.id AND b.tenant_id=_tenant_id AND strpos(lower(concat_ws(' ',b.id::text,b.business_date::text)),lower(_search))>0)
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_runs r WHERE r.pipeline_id=p.id AND r.tenant_id=_tenant_id AND strpos(lower(r.id::text),lower(_search))>0)
 OR EXISTS(SELECT 1 FROM public.data_prep_runs r WHERE r.pipeline_id=p.id AND r.tenant_id=_tenant_id AND strpos(lower(concat_ws(' ',r.id::text,r.run_uid)),lower(_search))>0)
 OR EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets d WHERE d.pipeline_id=p.id AND d.tenant_id=_tenant_id AND private.dpw_source_allows(actor,_tenant_id,d.data_source_id,'view') IS TRUE
 AND strpos(lower(concat_ws(' ',d.id::text,d.upload_id::text,d.content_sha256)),lower(_search))>0))),
 paged AS (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT _page_size OFFSET off)
 SELECT jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'total',(SELECT count(*) FROM filtered),'page',_page,'page_size',_page_size,
 'summary',jsonb_build_object('total',(SELECT count(*) FROM filtered),'approved',(SELECT count(*) FROM filtered WHERE status='approved'),'draft',(SELECT count(*) FROM filtered WHERE status='draft'),
 'archived',(SELECT count(*) FROM filtered WHERE status='archived'),'attention',(SELECT count(*) FROM filtered p WHERE (
 SELECT recent.state FROM (
 SELECT b.state,b.created_at at FROM public.data_prep_delivery_batches b WHERE b.pipeline_id=p.id AND b.tenant_id=_tenant_id
 UNION ALL SELECT r.state,coalesce(r.finished_at,r.started_at) FROM public.data_prep_delivery_runs r WHERE r.pipeline_id=p.id AND r.tenant_id=_tenant_id
 UNION ALL SELECT r.status,coalesce(r.finished_at,r.started_at) FROM public.data_prep_runs r WHERE r.pipeline_id=p.id AND r.tenant_id=_tenant_id
 ) recent ORDER BY recent.at DESC LIMIT 1) IN('failed','blocked')),
 'from',_updated_from,'through',_updated_through,'upper_boundary','exclusive','timezone','UTC','bu_id',_bu_id,
 'denominator_label','Authorized pipelines matching search, status, updated UTC period and current BU filters','denominator',(SELECT count(*) FROM filtered)),
 'pipelines',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('feeds',private.dpw_feeds(p.id,p.version),'latest_batch',
 (SELECT to_jsonb(b) FROM public.data_prep_delivery_batches b WHERE b.pipeline_id=p.id AND b.tenant_id=_tenant_id ORDER BY b.created_at DESC,b.id LIMIT 1))) FROM paged p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.dpw_get_pipeline(_tenant_id uuid,_pipeline_id uuid,_history_page integer DEFAULT 1,_history_page_size integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); p public.data_prep_pipelines%ROWTYPE; history jsonb; cfg public.data_prep_configuration_revisions%ROWTYPE; owners jsonb;
 off integer:=private.dpw_page(_history_page,_history_page_size);
BEGIN
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=_pipeline_id AND tenant_id=_tenant_id;
 SELECT c.* INTO cfg FROM public.data_prep_configuration_revisions c JOIN private.dpw_configuration_heads h ON h.configuration_id=c.id WHERE h.pipeline_id=p.id AND c.pipeline_version=p.version;
 SELECT coalesce(jsonb_agg(owner.bu_id ORDER BY owner.bu_id),'[]'::jsonb) INTO owners FROM public.data_resource_registry r JOIN public.data_resource_registry_owner_bu owner ON owner.registry_id=r.id AND owner.tenant_id=r.tenant_id WHERE r.tenant_id=_tenant_id AND r.data_prep_pipeline_id=p.id;
 WITH historical AS (
 SELECT r.started_at,r.id,(to_jsonb(r)-'result')||jsonb_build_object('origin','reusable_delivery','original_lineage_state','persisted_native_inputs') AS item
 FROM public.data_prep_delivery_runs r WHERE r.pipeline_id=p.id AND r.tenant_id=_tenant_id
 UNION ALL
 SELECT r.started_at,r.id,jsonb_build_object('id',r.id,'run_uid',r.run_uid,'status',r.status,'started_at',r.started_at,'finished_at',r.finished_at,
 'origin','legacy_data_prep_run','execution_protocol',r.execution_protocol,'recorded_rows_in',r.rows_in,'recorded_rows_out',r.rows_out,
 'count_evidence','recorded_legacy_not_reconstructed','native_configuration_snapshot',r.execution_snapshot,
 'original_lineage_state','not_captured','missing_originals',true)
 FROM public.data_prep_runs r WHERE r.pipeline_id=p.id AND r.tenant_id=_tenant_id)
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.started_at DESC,x.id),'[]'::jsonb) INTO history FROM (
 SELECT * FROM historical ORDER BY started_at DESC,id LIMIT _history_page_size OFFSET off) x;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'pipeline',to_jsonb(p),'feeds',private.dpw_feeds(p.id,p.version),
 'configuration',(coalesce(cfg.payload,'{}'::jsonb)-'_save_identity')||jsonb_build_object('configuration_id',cfg.id,'name',p.name,'description',p.description,'pipeline_version',p.version,
 'schema',coalesce(cfg.payload->'schema',jsonb_build_object('business_fields',cfg.payload->'business_fields','required_fields',cfg.payload->'required_fields')),
 'owning_business_unit_ids',owners,'policy',cfg.payload->'policy','feeds',private.dpw_feeds(p.id,p.version),'steps',p.steps,'dq_rules',p.dq_rules,'on_failure',p.on_failure,
 'source_data_source_id',p.source_data_source_id,'output_data_source_id',p.output_data_source_id,'origin',CASE WHEN cfg.id IS NULL THEN 'legacy_native_configuration' ELSE 'native_saved_revision' END),
 'batches',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.data_prep_delivery_batches WHERE pipeline_id=p.id ORDER BY created_at DESC,id LIMIT 100) x),'[]'::jsonb),
 'batch_total',(SELECT count(*) FROM public.data_prep_delivery_batches WHERE pipeline_id=p.id),
 'runs',history,'history_page',_history_page,'history_page_size',_history_page_size,
 'new_delivery_run_total',(SELECT count(*) FROM public.data_prep_delivery_runs WHERE pipeline_id=p.id AND tenant_id=_tenant_id),
 'legacy_run_total',(SELECT count(*) FROM public.data_prep_runs WHERE pipeline_id=p.id AND tenant_id=_tenant_id),
 'run_total',(SELECT count(*) FROM public.data_prep_delivery_runs WHERE pipeline_id=p.id AND tenant_id=_tenant_id)+(SELECT count(*) FROM public.data_prep_runs WHERE pipeline_id=p.id AND tenant_id=_tenant_id));
END $$;

CREATE FUNCTION public.dpw_get_delivery(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_page integer DEFAULT 1,_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); b public.data_prep_delivery_batches%ROWTYPE;
 off integer:=private.dpw_page(_page,_page_size); files jsonb;
BEGIN
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=_batch_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'dpw.batch_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.data_prep_delivery_files f WHERE f.batch_id=b.id AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'dpw.source_read_denied'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('rows_count',u.row_count,
 'columns',CASE WHEN private.dpw_attachment_viewable(f.id) THEN u.columns ELSE private.dpw_redact_columns(u.columns) END)
 ||jsonb_build_object('descriptor',CASE WHEN private.dpw_attachment_viewable(f.id) THEN f.descriptor ELSE private.dpw_redact_descriptor(f.descriptor) END,
 'payload_available',private.dpw_attachment_viewable(f.id),'retention',private.dpw_file_retention_metadata(f.id)) ORDER BY f.created_at,f.id),'[]'::jsonb) INTO files
 FROM public.data_prep_delivery_files f LEFT JOIN public.workspace_data_source_uploads u ON u.id=f.upload_id WHERE f.batch_id=b.id;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'batch',to_jsonb(b),'files',files,
 'current_run_id',(SELECT id FROM public.data_prep_delivery_runs WHERE batch_id=b.id ORDER BY started_at DESC,id LIMIT 1),
 'correction_input_manifest',CASE WHEN b.correction_of IS NULL THEN NULL ELSE jsonb_build_object('batch_id',b.correction_of,
 'source_run_id',coalesce(b.configuration_snapshot->'exclusion_source_run_id',b.configuration_snapshot->'correction_source_run_id'),
 'files',coalesce(b.configuration_snapshot->'correction_source_files','[]'::jsonb),
 'available',jsonb_typeof(b.configuration_snapshot->'correction_source_files')='array',
 'origin',coalesce(b.configuration_snapshot->>'correction_manifest_origin','persisted_predecessor_binding')) END,
 'runs',coalesce((SELECT jsonb_agg(to_jsonb(r)-'result') FROM public.data_prep_delivery_runs r WHERE r.batch_id=b.id),'[]'::jsonb),
 'datasets',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.data_prep_prepared_datasets d WHERE d.batch_id=b.id),'[]'::jsonb),
 'release_requests',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM public.data_prep_release_requests q WHERE q.batch_id=b.id),'[]'::jsonb),
 'release_decisions',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.data_prep_release_decisions d JOIN public.data_prep_release_requests q ON q.id=d.request_id WHERE q.batch_id=b.id),'[]'::jsonb),
 'exclusion_requests',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM public.data_prep_exclusion_requests q WHERE q.batch_id=b.id),'[]'::jsonb),
 'exclusion_decisions',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.data_prep_exclusion_decisions d JOIN public.data_prep_exclusion_requests q ON q.id=d.request_id WHERE q.batch_id=b.id),'[]'::jsonb),
 'errors',coalesce((SELECT jsonb_agg(CASE WHEN private.dpw_run_payload_available(x.run_id) THEN to_jsonb(x)
 ELSE (to_jsonb(x)-ARRAY['original_row','prepared_row','reasons'])||jsonb_build_object('payload_unavailable',true) END) FROM (SELECT e.* FROM public.data_prep_reject_lineage e JOIN public.data_prep_delivery_runs r ON r.id=e.run_id WHERE r.batch_id=b.id ORDER BY e.id LIMIT _page_size OFFSET off) x),'[]'::jsonb),
 'error_total',(SELECT count(*) FROM public.data_prep_reject_lineage e JOIN public.data_prep_delivery_runs r ON r.id=e.run_id WHERE r.batch_id=b.id),'page',_page,'page_size',_page_size);
END $$;

CREATE FUNCTION public.dpw_list_datasets(_tenant_id uuid,_pipeline_id uuid,_business_date date DEFAULT NULL,_page integer DEFAULT 1,_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); off integer:=private.dpw_page(_page,_page_size);
BEGIN
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'datasets',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT d.* FROM public.data_prep_prepared_datasets d WHERE d.tenant_id=_tenant_id AND d.pipeline_id=_pipeline_id
 AND (_business_date IS NULL OR d.business_date=_business_date) AND private.dpw_source_allows(actor,_tenant_id,d.data_source_id,'view') IS TRUE
 ORDER BY d.published_at DESC,d.id LIMIT _page_size OFFSET off) x),'[]'::jsonb),'total',
 (SELECT count(*) FROM public.data_prep_prepared_datasets d WHERE d.tenant_id=_tenant_id AND d.pipeline_id=_pipeline_id
 AND (_business_date IS NULL OR d.business_date=_business_date) AND private.dpw_source_allows(actor,_tenant_id,d.data_source_id,'view') IS TRUE),'page',_page,'page_size',_page_size);
END $$;

CREATE FUNCTION public.dpw_get_audit(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid DEFAULT NULL,_page integer DEFAULT 1,_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); off integer:=private.dpw_page(_page,_page_size);
 events jsonb; total bigint;
BEGIN
 IF public.user_has_permission(actor,_tenant_id,'audit.log.read',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.audit_read_permission_required'; END IF;
 IF _batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_batches WHERE id=_batch_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id) THEN RAISE EXCEPTION 'dpw.audit_batch_scope_denied'; END IF;
 IF EXISTS(SELECT 1 FROM public.data_prep_delivery_files f WHERE f.tenant_id=_tenant_id AND f.pipeline_id=_pipeline_id AND (_batch_id IS NULL OR f.batch_id=_batch_id)
 AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true) THEN RAISE EXCEPTION 'dpw.audit_source_read_denied'; END IF;
 WITH batches AS(SELECT * FROM public.data_prep_delivery_batches WHERE tenant_id=_tenant_id AND pipeline_id=_pipeline_id AND (_batch_id IS NULL OR id=_batch_id)),
 runs AS(SELECT r.* FROM public.data_prep_delivery_runs r JOIN batches b ON b.id=r.batch_id),
 files AS(SELECT f.* FROM public.data_prep_delivery_files f JOIN batches b ON b.id=f.batch_id),
 releases AS(SELECT q.* FROM public.data_prep_release_requests q JOIN batches b ON b.id=q.batch_id),
 exclusions AS(SELECT q.* FROM public.data_prep_exclusion_requests q JOIN batches b ON b.id=q.batch_id),
 chain AS(
 SELECT _pipeline_id::text id,NULL::uuid payload_run UNION SELECT id::text,NULL::uuid FROM batches
 UNION SELECT id::text,id FROM runs UNION SELECT f.id::text,i.run_id FROM files f LEFT JOIN public.data_prep_run_inputs i ON i.file_id=f.id
 UNION SELECT d.id::text,d.run_id FROM public.data_prep_prepared_datasets d JOIN batches b ON b.id=d.batch_id
 UNION SELECT id::text,run_id FROM releases UNION SELECT d.id::text,q.run_id FROM public.data_prep_release_decisions d JOIN releases q ON q.id=d.request_id
 UNION SELECT id::text,run_id FROM exclusions UNION SELECT d.id::text,q.run_id FROM public.data_prep_exclusion_decisions d JOIN exclusions q ON q.id=d.request_id
 UNION SELECT id::text,NULL::uuid FROM public.data_prep_configuration_revisions WHERE tenant_id=_tenant_id AND pipeline_id=_pipeline_id AND _batch_id IS NULL
 UNION SELECT id::text,NULL::uuid FROM public.data_prep_runs WHERE tenant_id=_tenant_id AND pipeline_id=_pipeline_id AND _batch_id IS NULL),
 selected AS(SELECT a.*,c.payload_run FROM public.audit_log a JOIN chain c ON c.id=a.resource_id
 WHERE a.tenant_id=_tenant_id AND (a.action LIKE 'dpw.%' OR a.action LIKE 'data_prep.%')),
 paged AS(SELECT * FROM selected ORDER BY occurred_at DESC,id DESC LIMIT _page_size OFFSET off)
 SELECT (SELECT count(*) FROM selected),coalesce((SELECT jsonb_agg(jsonb_build_object('event_id',a.id::text,'occurred_at',a.occurred_at,
 'actor_id',a.actor_user_id,'actor_email',a.actor_email,'action',a.action,'resource_type',a.resource_type,'resource_id',a.resource_id,
 'context',CASE WHEN a.payload_run IS NULL OR private.dpw_run_payload_available(a.payload_run) THEN a.context ELSE private.dpw_redact_audit_context(a.context) END,
 'artifact_payload_available',CASE WHEN a.payload_run IS NULL THEN NULL ELSE private.dpw_run_payload_available(a.payload_run) END) ORDER BY a.occurred_at DESC,a.id DESC) FROM paged a),'[]'::jsonb)
 INTO total,events;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'pipeline_id',_pipeline_id,'batch_id',_batch_id,'events',events,
 'audit_total',total,'page',_page,'page_size',_page_size,'evidence','recorded_native_events_no_external_anchor_verification_claim');
END $$;

CREATE FUNCTION public.dpw_authorize_file_intake(_tenant uuid,_pipeline uuid,_batch uuid,_feed_key text,_operation text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant,_pipeline,'run'); b public.data_prep_delivery_batches%ROWTYPE; feed jsonb;
BEGIN
 IF _operation IS NULL OR _operation NOT IN('intake','original.read') THEN RAISE EXCEPTION 'dpw.invalid_intake_operation'; END IF;
 IF _operation='intake' AND public.user_has_permission(actor,_tenant,'data.upload',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.upload_permission_required'; END IF;
 IF _operation='intake' THEN PERFORM public.assert_data_prep_actor(_tenant,actor,false); END IF;
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=_batch AND tenant_id=_tenant AND pipeline_id=_pipeline;
 IF NOT FOUND THEN RAISE EXCEPTION 'dpw.batch_read_denied'; END IF;
 SELECT value INTO feed FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=_feed_key;
 IF feed IS NULL OR private.dpw_source_allows(actor,_tenant,(feed->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
 OR (_operation='intake' AND private.dpw_source_allows(actor,_tenant,(feed->>'data_source_id')::uuid,'ingest') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'dpw.file_source_denied'; END IF;
 RETURN jsonb_build_object('actor_id',actor,'auth_role',auth.role(),'tenant_id',_tenant,'pipeline_id',_pipeline,'batch_id',_batch,
 'feed_key',_feed_key,'data_source_id',(feed->>'data_source_id')::uuid,'pipeline_version',b.pipeline_version,'configuration_id',b.configuration_snapshot->'configuration_id',
 'storage_capability',jsonb_build_object('bucket_id','data-prep-inputs','public',false,'max_original_bytes',52428800,
 'max_expanded_bytes',52428800,'max_parsed_bytes',52428800,'max_rows',50000,'max_columns',500));
END $$;

CREATE FUNCTION public.dpw_lookup_file_intent(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_feed_key text,_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority jsonb:=public.dpw_authorize_file_intake(_tenant_id,_pipeline_id,_batch_id,_feed_key,'intake');
 f public.data_prep_delivery_files%ROWTYPE;
BEGIN
 IF _identity->>'data_source_id' IS DISTINCT FROM authority->>'data_source_id'
 OR (_identity->>'pipeline_version')::integer IS DISTINCT FROM (authority->>'pipeline_version')::integer
 OR _identity->>'content_sha256' IS NULL OR _identity->>'content_sha256' !~ '^[a-f0-9]{64}$'
 OR _identity->>'request_key' IS NULL THEN RAISE EXCEPTION 'dpw.lookup_identity_mismatch'; END IF;
 SELECT x.* INTO f FROM public.data_prep_delivery_files x JOIN public.data_prep_file_requests a ON a.file_id=x.id
 WHERE a.batch_id=_batch_id AND a.feed_key=_feed_key AND a.request_key=(_identity->>'request_key')::uuid;
 IF FOUND AND (f.content_sha256<>_identity->>'content_sha256' OR f.descriptor->'selected_sheet' IS DISTINCT FROM coalesce(_identity->'selected_sheet','null'::jsonb))
 THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
 IF f.id IS NULL THEN
  SELECT * INTO f FROM public.data_prep_delivery_files WHERE batch_id=_batch_id AND feed_key=_feed_key AND content_sha256=_identity->>'content_sha256';
  IF FOUND AND f.descriptor->'selected_sheet' IS DISTINCT FROM coalesce(_identity->'selected_sheet','null'::jsonb) THEN RAISE EXCEPTION 'dpw.sheet_binding_conflict'; END IF;
 END IF;
 RETURN authority||jsonb_build_object('state',CASE WHEN f.id IS NULL THEN 'absent' ELSE 'found' END,'intent',CASE WHEN f.id IS NULL THEN NULL ELSE private.dpw_file_metadata(f) END);
END $$;

CREATE FUNCTION public.dpw_get_input_file(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); f public.data_prep_delivery_files%ROWTYPE; u public.workspace_data_source_uploads%ROWTYPE;
BEGIN
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file_id AND batch_id=_batch_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id;
 IF NOT FOUND OR private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.input_read_denied'; END IF;
 IF private.dpw_attachment_viewable(f.id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.attachment_expired_or_purged_metadata_retained'; END IF;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=f.upload_id AND tenant_id=_tenant_id AND data_source_id=f.data_source_id;
 IF f.state='received' AND (u.id IS NULL OR jsonb_typeof(u.rows) IS DISTINCT FROM 'array' OR u.row_count<>jsonb_array_length(u.rows)
 OR private.dpw_hash(u.rows) IS DISTINCT FROM f.structured_rows_sha256) THEN RAISE EXCEPTION 'dpw.immutable_input_rows_unavailable'; END IF;
 RETURN jsonb_build_object('actor_id',actor,'auth_role',auth.role(),'tenant_id',_tenant_id,'file',to_jsonb(f),
 'uploaded_by',f.created_by,'rows',u.rows,'rows_count',u.row_count,'columns',u.columns,'original_file_bytes_sha256',f.content_sha256,'structured_rows_sha256',f.structured_rows_sha256);
END $$;

-- Immutable history and deny direct DML, including the processor service role.
CREATE FUNCTION public.dpw_get_preparation(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_run_id uuid,_page integer DEFAULT 1,_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); r public.data_prep_delivery_runs%ROWTYPE;
 off integer:=private.dpw_page(_page,_page_size); payload_state jsonb;
BEGIN
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id AND batch_id=_batch_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_delivery_files f ON f.id=i.file_id WHERE i.run_id=r.id
 AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true) THEN RAISE EXCEPTION 'dpw.preparation_read_denied'; END IF;
 payload_state:=private.dpw_run_payload_state(r.id);
 IF (payload_state->>'available')::boolean IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'run',to_jsonb(r)-'result','mode',r.snapshot->>'mode',
  'payload',payload_state,'rows',NULL,'lineage',NULL,'dq',NULL,'total',NULL,'page',_page,'page_size',_page_size)||private.dpw_run_readback_metadata(r.id,actor);
 END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'run',to_jsonb(r)-'result','mode',r.snapshot->>'mode',
 'rows',coalesce((SELECT jsonb_agg(x.value ORDER BY x.ord) FROM jsonb_array_elements(coalesce(r.result->'acceptedRows','[]'::jsonb)) WITH ORDINALITY x(value,ord)
 WHERE ord>off AND ord<=off+_page_size),'[]'::jsonb),'total',jsonb_array_length(coalesce(r.result->'acceptedRows','[]'::jsonb)),
 'lineage',coalesce((SELECT jsonb_agg(x.value ORDER BY x.ord) FROM jsonb_array_elements(coalesce(r.result->'outputLineage','[]'::jsonb)) WITH ORDINALITY x(value,ord)
 WHERE ord>off AND ord<=off+_page_size),'[]'::jsonb),'dq',r.result->'dqResults','counts_per_feed',r.result->'countsPerFeed',
 'payload',payload_state,'structured_data_sha256',r.result->>'structured_data_sha256','structured_lineage_sha256',r.result->>'structured_lineage_sha256','page',_page,'page_size',_page_size)||private.dpw_run_readback_metadata(r.id,actor);
END $$;

CREATE FUNCTION private.dpw_dataset_indexes(_dataset_id uuid,_logical_side text) RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(array_agg((l.value->>'output_index')::integer ORDER BY (l.value->>'output_index')::integer),ARRAY[]::integer[])
 FROM public.data_prep_prepared_datasets d JOIN public.data_prep_delivery_runs r ON r.id=d.run_id,
 jsonb_array_elements(r.result->'outputLineage') l
 WHERE d.id=_dataset_id AND (_logical_side IS NULL OR
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements(l.value->'sources') source WHERE source.value->>'business_side' IS DISTINCT FROM _logical_side))
$$;

CREATE FUNCTION public.dpw_get_dataset(_tenant_id uuid,_pipeline_id uuid,_dataset_id uuid,_logical_side text DEFAULT NULL,_page integer DEFAULT 1,_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); d public.data_prep_prepared_datasets%ROWTYPE;
 u public.workspace_data_source_uploads%ROWTYPE; indexes integer[]; off integer:=private.dpw_page(_page,_page_size); payload_state jsonb;
BEGIN
 SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE id=_dataset_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id;
 IF NOT FOUND OR private.dpw_source_allows(actor,_tenant_id,d.data_source_id,'view') IS DISTINCT FROM true
 OR EXISTS(SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_delivery_files f ON f.id=i.file_id
 WHERE i.run_id=d.run_id AND private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'view') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'dpw.dataset_read_denied'; END IF;
 payload_state:=private.dpw_run_payload_state(d.run_id);
 IF (payload_state->>'available')::boolean IS DISTINCT FROM true THEN
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'dataset',to_jsonb(d)||jsonb_build_object('hash_kind','structured_jsonb_sha256'),
  'payload',payload_state,'rows',NULL,'total',NULL,'page',_page,'page_size',_page_size);
 END IF;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=d.upload_id AND tenant_id=_tenant_id AND data_source_id=d.data_source_id;
 IF u.id IS NULL OR u.row_count<>d.rows OR private.dpw_hash(u.rows) IS DISTINCT FROM d.content_sha256 THEN RAISE EXCEPTION 'dpw.dataset_upload_integrity_mismatch'; END IF;
 IF _logical_side IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_runs r,jsonb_array_elements(r.snapshot->'feeds') f
 WHERE r.id=d.run_id AND f.value->>'business_side'=_logical_side) THEN RAISE EXCEPTION 'dpw.dataset_logical_side_incompatible'; END IF;
 indexes:=private.dpw_dataset_indexes(d.id,_logical_side);
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'dataset',to_jsonb(d)||jsonb_build_object('hash_kind','structured_jsonb_sha256'),
 'logical_side',_logical_side,'rows',coalesce((SELECT jsonb_agg(u.rows->x.idx ORDER BY x.ord) FROM unnest(indexes) WITH ORDINALITY x(idx,ord)
 WHERE ord>off AND ord<=off+_page_size),'[]'::jsonb),'total',cardinality(indexes),'page',_page,'page_size',_page_size);
END $$;

-- Public purpose functions own mutation; no role is created/granted by this body.
DO $acl$
DECLARE t text; fn record;
BEGIN
 FOREACH t IN ARRAY ARRAY['data_prep_configuration_revisions','data_prep_input_profiles','data_prep_approved_configurations',
 'data_prep_delivery_batches','data_prep_delivery_files','data_prep_file_requests','data_prep_delivery_runs','data_prep_run_inputs',
 'data_prep_record_lineage','data_prep_reject_lineage','data_prep_prepared_datasets','data_prep_exclusion_requests','data_prep_exclusion_decisions','data_prep_release_requests','data_prep_release_decisions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  IF t NOT IN('data_prep_delivery_batches','data_prep_delivery_files','data_prep_delivery_runs') THEN
   EXECUTE format('CREATE TRIGGER dpw_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable()',t);
  END IF;
 END LOOP;
 REVOKE ALL ON private.dpw_configuration_heads FROM PUBLIC,anon,authenticated,service_role;
 FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname LIKE 'dpw\_%' ESCAPE '\' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',fn.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'dpw\_%' ESCAPE '\' LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',fn.signature,CASE WHEN fn.proname IN('dpw_finish_preparation','dpw_fail_preparation','dpw_commit_input_file') THEN 'service_role' ELSE 'authenticated' END);
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION private.dpw_storage_allows(text,boolean) TO authenticated;


-- FROZEN INPUT MODE-RETENTION-BODY.sql SHA256 802433afb6976ea39774ddceaf3699e6a5ffef6017d8bd408df5173d695fb9b9
-- Owner decisions 3-5. Source proposal only. No cron, byte deletion, legacy
-- attachment backfill or global AI/Suggest policy change is registered here.
CREATE TABLE public.data_prep_mode_choices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id),chosen_by uuid NOT NULL REFERENCES auth.users(id),
 mode text NOT NULL CHECK(mode IN('manual','assisted','agentic')),human_in_loop boolean NOT NULL,
 request_key uuid NOT NULL,chosen_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,chosen_by,request_key)
);
CREATE FUNCTION private.dpw_workspace_feature_attest(_actor uuid,_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Integration bridge to Curie's qualified tenant/page/module matrix. A
 -- hidden navigation item is not authorization; both user and service purposes
 -- recheck this native predicate. No physical workspace is inferred.
 RAISE EXCEPTION 'dpw.native_workspace_feature_dependency_unqualified' USING ERRCODE='42501';
END $$;
CREATE FUNCTION private.dpw_mode_attest(_actor uuid,_tenant uuid,_pipeline uuid,_mode text,_human_in_loop boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF _mode='manual' THEN RETURN true; END IF;
 -- Main binds actual tenant feature/module + platform/tenant/workspace AI
 -- authority. No guessed entitlement keys or unrelated Suggest override.
 RAISE EXCEPTION 'dpw.native_mode_entitlement_dependency_unqualified' USING ERRCODE='42501';
END $$;
CREATE FUNCTION public.dpw_set_execution_mode(_tenant_id uuid,_pipeline_id uuid,_mode text,_human_in_loop boolean,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'edit'); choice public.data_prep_mode_choices%ROWTYPE;
BEGIN
 IF _mode IS NULL OR _mode NOT IN('manual','assisted','agentic') OR _human_in_loop IS NULL OR _request_key IS NULL
 OR private.dpw_mode_attest(actor,_tenant_id,_pipeline_id,_mode,_human_in_loop) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.mode_denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||actor::text||_request_key::text,61));
 SELECT * INTO choice FROM public.data_prep_mode_choices WHERE tenant_id=_tenant_id AND chosen_by=actor AND request_key=_request_key;
 IF FOUND THEN
  IF choice.pipeline_id<>_pipeline_id OR choice.mode<>_mode OR choice.human_in_loop<>_human_in_loop THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'choice',to_jsonb(choice),'is_new',false);
 END IF;
 INSERT INTO public.data_prep_mode_choices(tenant_id,pipeline_id,chosen_by,mode,human_in_loop,request_key)
 VALUES(_tenant_id,_pipeline_id,actor,_mode,_human_in_loop,_request_key) RETURNING * INTO choice;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.mode.choose',choice.id,jsonb_build_object('mode',_mode,'human_in_loop',_human_in_loop,'final_human_approval_required',true));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'choice',to_jsonb(choice),'is_new',true);
END $$;

CREATE TABLE public.data_prep_attachment_retention (
 file_id uuid PRIMARY KEY REFERENCES public.data_prep_delivery_files(id),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id),bucket_id text NOT NULL CHECK(bucket_id='data-prep-inputs'),
 original_path text NOT NULL,original_file_bytes_sha256 text NOT NULL,original_size_bytes bigint NOT NULL,
 run_id uuid NOT NULL REFERENCES public.data_prep_delivery_runs(id),attached_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,policy_id uuid NOT NULL,policy_version text NOT NULL,
 period_days integer NOT NULL CHECK(period_days>0),policy_source text NOT NULL CHECK(policy_source IN('platform','tenant')),
 notice_30_at timestamptz NOT NULL,notice_10_at timestamptz NOT NULL,
 notice text NOT NULL,
 CHECK(expires_at=attached_at+period_days*interval '1 day')
);
CREATE TABLE public.data_prep_attachment_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),file_id uuid NOT NULL REFERENCES public.data_prep_attachment_retention(file_id),
 operation text NOT NULL CHECK(operation IN('hold','release')),hold_id uuid,
 actor_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((operation='hold' AND hold_id IS NULL) OR (operation='release' AND hold_id IS NOT NULL)),
 FOREIGN KEY(hold_id) REFERENCES public.data_prep_attachment_holds(id)
);
CREATE UNIQUE INDEX dpw_hold_one_release ON public.data_prep_attachment_holds(hold_id) WHERE operation='release';
CREATE TABLE public.data_prep_attachment_tombstones (
 file_id uuid PRIMARY KEY REFERENCES public.data_prep_attachment_retention(file_id),job_id uuid NOT NULL,
 transport_role text NOT NULL CHECK(transport_role='service_role'),purged_at timestamptz NOT NULL DEFAULT now(),
 object_absence_verified boolean NOT NULL CHECK(object_absence_verified),original_file_bytes_sha256 text NOT NULL,
 original_size_bytes bigint NOT NULL,notice text NOT NULL DEFAULT 'Attachment bytes expired under their immutable snapshotted policy and were purged. Immutable metadata remains.'
);
CREATE TABLE private.dpw_attachment_purge_claims (
 file_id uuid PRIMARY KEY REFERENCES public.data_prep_attachment_retention(file_id),job_id uuid NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('claimed','cancelled','completed'))
);
CREATE FUNCTION private.dpw_effective_attachment_policy(_tenant uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Native bridge to the separate platform default90 / longer tenant override
 -- control. Main qualifies Curie's real effective-policy readback/ACL/body.
 -- No fixed180 fallback, guessed policy version or retroactive expiry change.
 RAISE EXCEPTION 'dpw.native_configurable_retention_policy_dependency_unqualified' USING ERRCODE='42501';
END $$;
CREATE FUNCTION private.dpw_attachment_register() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy jsonb; days integer; input public.data_prep_delivery_files%ROWTYPE;
BEGIN
 IF NEW.finished_at IS NULL OR OLD.finished_at IS NOT NULL THEN RETURN NEW; END IF;
 policy:=private.dpw_effective_attachment_policy(NEW.tenant_id);days:=(policy->>'period_days')::integer;
 IF days IS NULL OR days<1 OR policy->>'source' NOT IN('platform','tenant') OR policy->>'policy_id' IS NULL OR policy->>'version' IS NULL THEN RAISE EXCEPTION 'dpw.retention_policy_unavailable'; END IF;
 FOR input IN SELECT f.* FROM public.data_prep_delivery_files f JOIN public.data_prep_run_inputs i ON i.file_id=f.id WHERE i.run_id=NEW.id LOOP
 INSERT INTO public.data_prep_attachment_retention(file_id,tenant_id,pipeline_id,bucket_id,original_path,original_file_bytes_sha256,original_size_bytes,run_id,attached_at,expires_at,
 policy_id,policy_version,period_days,policy_source,notice_30_at,notice_10_at,notice)
 VALUES(input.id,input.tenant_id,input.pipeline_id,'data-prep-inputs',input.original_path,input.content_sha256,(input.descriptor->>'size_bytes')::bigint,
 NEW.id,NEW.finished_at,NEW.finished_at+days*interval '1 day',(policy->>'policy_id')::uuid,policy->>'version',days,policy->>'source',
 NEW.finished_at+greatest(days-30,0)*interval '1 day',NEW.finished_at+greatest(days-10,0)*interval '1 day',
 'Data Prep attachment data is available for '||days::text||' days under its snapshotted policy. Run, configuration, count, hash and audit metadata are retained. Legal holds stop purge.');
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER dpw_register_attachment AFTER UPDATE ON public.data_prep_delivery_runs FOR EACH ROW EXECUTE FUNCTION private.dpw_attachment_register();
CREATE FUNCTION private.dpw_attachment_has_hold(_file uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.data_prep_attachment_holds h WHERE h.file_id=_file AND h.operation='hold'
 AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_holds r WHERE r.hold_id=h.id AND r.operation='release'))
$$;
CREATE FUNCTION private.dpw_attachment_viewable(_file uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.data_prep_delivery_files f LEFT JOIN public.data_prep_attachment_retention a ON a.file_id=f.id
 WHERE f.id=_file AND (a.expires_at>clock_timestamp() OR (a.file_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_delivery_runs r ON r.id=i.run_id WHERE i.file_id=f.id AND r.finished_at IS NOT NULL)))
 AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_tombstones t WHERE t.file_id=f.id))
$$;
CREATE FUNCTION private.dpw_run_payload_state(_run uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.data_prep_delivery_runs%ROWTYPE; expected bigint; recorded bigint; expiry timestamptz; purged boolean; held boolean;
BEGIN
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run;
 SELECT count(*) INTO expected FROM public.data_prep_run_inputs WHERE run_id=_run;
 SELECT count(*),min(a.expires_at),coalesce(bool_or(t.file_id IS NOT NULL),false),coalesce(bool_or(private.dpw_attachment_has_hold(a.file_id)),false)
 INTO recorded,expiry,purged,held FROM public.data_prep_attachment_retention a JOIN public.data_prep_run_inputs i ON i.file_id=a.file_id AND i.run_id=_run
 LEFT JOIN public.data_prep_attachment_tombstones t ON t.file_id=a.file_id;
 RETURN jsonb_build_object('available',r.finished_at IS NOT NULL AND expected>0 AND recorded=expected AND expiry>clock_timestamp() AND NOT purged,
 'state',CASE WHEN r.finished_at IS NULL THEN 'pending' WHEN recorded<>expected OR expected=0 THEN 'unqualified'
 WHEN purged THEN 'purged' WHEN expiry<=clock_timestamp() THEN 'expired' ELSE 'available' END,'expires_at',expiry,'legal_hold',held,
 'tombstones',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.data_prep_attachment_tombstones t JOIN public.data_prep_run_inputs i ON i.file_id=t.file_id WHERE i.run_id=_run),'[]'::jsonb));
END $$;
CREATE FUNCTION private.dpw_run_payload_available(_run uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (private.dpw_run_payload_state(_run)->>'available')::boolean IS TRUE
$$;
CREATE FUNCTION private.dpw_redact_columns(_columns jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(c.value)='string' THEN c.value ELSE coalesce(
 (SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(c.value) e WHERE e.key IN('name','type','nullable','ordinal','format')),'{}'::jsonb) END ORDER BY c.ord),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_columns)='array' THEN _columns ELSE '[]'::jsonb END) WITH ORDINALITY c(value,ord)
$$;
CREATE FUNCTION private.dpw_redact_descriptor(_descriptor jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(_descriptor) e WHERE e.key IN(
 'filename','mime_type','size_bytes','row_count','content_sha256','parsed_sha256','parsed_bytes','selected_sheet')),'{}'::jsonb)
 ||jsonb_build_object('columns',private.dpw_redact_columns(_descriptor->'columns'))
$$;
CREATE FUNCTION private.dpw_file_retention_metadata(_file uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policy_id',a.policy_id,'version',a.policy_version,'period_days',a.period_days,'source',a.policy_source,
 'expires_at',a.expires_at,'legal_hold',private.dpw_attachment_has_hold(_file),
 'state',CASE WHEN a.file_id IS NULL THEN 'pending_execution' WHEN t.file_id IS NOT NULL THEN 'purged' WHEN a.expires_at<=clock_timestamp() THEN 'expired' ELSE 'available' END,
 'tombstone',to_jsonb(t),'available',private.dpw_attachment_viewable(_file))
 FROM (SELECT _file id) requested LEFT JOIN public.data_prep_attachment_retention a ON a.file_id=requested.id LEFT JOIN public.data_prep_attachment_tombstones t ON t.file_id=requested.id
$$;
CREATE FUNCTION private.dpw_file_metadata(_file public.data_prep_delivery_files) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT to_jsonb(_file)||jsonb_build_object('descriptor',CASE WHEN private.dpw_attachment_viewable(_file.id) THEN _file.descriptor
 ELSE private.dpw_redact_descriptor(_file.descriptor) END,'payload_available',private.dpw_attachment_viewable(_file.id),'retention',private.dpw_file_retention_metadata(_file.id))
$$;
CREATE FUNCTION private.dpw_redact_audit_context(_context jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(coalesce(_context,'{}'::jsonb)) e WHERE e.key IN(
 'pipeline_id','batch_id','run_id','file_id','upload_id','configuration_id','request_id','version','result_sha256','snapshot_sha256','sha256',
 'row_count','rows_in','rows_out','status','kind','decision','transport','mode','human_in_loop','four_eyes','complete_rerun_required','final_human_approval_required')),'{}'::jsonb)
 ||jsonb_build_object('artifact_payload_unavailable',true)
$$;
CREATE FUNCTION private.dpw_run_readback_metadata(_run uuid,_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.data_prep_delivery_runs%ROWTYPE; b public.data_prep_delivery_batches%ROWTYPE; p public.data_prep_pipelines%ROWTYPE;
 eligible boolean; hash_valid boolean; human_approved boolean;
BEGIN
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run;
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=r.batch_id;
 SELECT * INTO p FROM public.data_prep_pipelines WHERE id=r.pipeline_id;
 hash_valid:=r.finished_at IS NOT NULL AND private.dpw_hash(r.result) IS NOT DISTINCT FROM r.result_sha256;
 eligible:=hash_valid AND private.dpw_run_payload_available(r.id) AND b.mode='prepare' AND r.state IN('success','warn')
 AND (r.result->>'publication_eligible')::boolean IS TRUE AND p.status='approved' AND p.lifecycle_state='production' AND p.enabled
 AND p.version=r.pipeline_version AND private.dpw_snapshot(p.id) IS NOT DISTINCT FROM (b.configuration_snapshot-ARRAY['quality_gate','exclusion_approval_id','approved_exclusions','exclusion_source_run_id','correction_source_run_id','correction_source_files','correction_manifest_origin'])
 AND private.data_prep_pipeline_scope_allows(_actor,r.tenant_id,p.id,'run') IS TRUE
 AND private.dpw_source_allows(_actor,r.tenant_id,p.output_data_source_id,'ingest') IS TRUE
 AND private.dpw_source_allows(_actor,r.tenant_id,p.output_data_source_id,'edit') IS TRUE
 AND (public.is_platform_admin(_actor) OR EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=r.tenant_id AND active AND role::text IN('tenant_admin','tenant_analyst')));
 human_approved:=EXISTS(SELECT 1 FROM public.data_prep_release_requests q JOIN public.data_prep_release_decisions d ON d.request_id=q.id
 WHERE q.run_id=r.id AND q.result_sha256=r.result_sha256 AND q.pipeline_version=r.pipeline_version AND d.decision='approved');
 RETURN jsonb_build_object('publication_eligible',coalesce(eligible,false),'production_publishable',coalesce(eligible,false) AND human_approved,
 'human_release_approved',human_approved,'result_sha256',r.result_sha256,'result_hash_valid',coalesce(hash_valid,false),'snapshot_sha256',r.snapshot_sha256,
 'dq_execution',CASE WHEN r.finished_at IS NULL THEN 'pending' ELSE coalesce(r.result->>'dq_execution','executed') END,
 'rows_in_observed',(SELECT coalesce(sum(row_count),0) FROM public.data_prep_run_inputs WHERE run_id=r.id),
 'processed_row_count',CASE WHEN r.result->>'dq_execution'='unavailable_not_fabricated' OR r.finished_at IS NULL THEN NULL
 ELSE jsonb_array_length(coalesce(r.result->'acceptedRows','[]'::jsonb)) END);
END $$;
CREATE FUNCTION private.dpw_legal_hold_attest(_actor uuid,_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'dpw.native_legal_hold_authority_dependency_unqualified' USING ERRCODE='42501'; END $$;
CREATE FUNCTION private.dpw_retention_attest() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'dpw.native_retention_storage_and_hold_dependencies_unqualified' USING ERRCODE='42501'; END $$;

CREATE FUNCTION public.dpw_set_attachment_hold(_tenant_id uuid,_pipeline_id uuid,_file_id uuid,_hold boolean,_hold_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'manage'); entry public.data_prep_attachment_holds%ROWTYPE;
BEGIN
 IF _hold IS NULL OR length(coalesce(btrim(_reason),'')) NOT BETWEEN 3 AND 1000 OR private.dpw_legal_hold_attest(actor,_tenant_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.hold_authority_denied'; END IF;
 PERFORM 1 FROM public.data_prep_attachment_retention WHERE file_id=_file_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.data_prep_attachment_tombstones WHERE file_id=_file_id) THEN RAISE EXCEPTION 'dpw.attachment_already_purged_or_unknown'; END IF;
 IF NOT _hold AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_holds h WHERE h.id=_hold_id AND h.file_id=_file_id AND h.operation='hold'
 AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_holds r WHERE r.hold_id=h.id)) THEN RAISE EXCEPTION 'dpw.active_hold_required'; END IF;
 INSERT INTO public.data_prep_attachment_holds(file_id,operation,hold_id,actor_id,reason)
 VALUES(_file_id,CASE WHEN _hold THEN 'hold' ELSE 'release' END,CASE WHEN _hold THEN NULL ELSE _hold_id END,actor,btrim(_reason)) RETURNING * INTO entry;
 IF _hold THEN UPDATE private.dpw_attachment_purge_claims SET state='cancelled' WHERE file_id=_file_id AND state='claimed'; END IF;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.attachment.hold',entry.id,jsonb_build_object('file_id',_file_id,'operation',entry.operation,'reason',entry.reason));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'hold',to_jsonb(entry));
END $$;
CREATE FUNCTION public.dpw_get_file_retention(_tenant_id uuid,_pipeline_id uuid,_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'view'); a public.data_prep_attachment_retention%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'dpw.attachment_unknown'; END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'retention',to_jsonb(a),'view_available',private.dpw_attachment_viewable(_file_id),
 'legal_hold',private.dpw_attachment_has_hold(_file_id),'tombstone',(SELECT to_jsonb(t) FROM public.data_prep_attachment_tombstones t WHERE file_id=_file_id));
END $$;
CREATE FUNCTION public.dpw_claim_attachment_purge(_file_id uuid,_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.data_prep_attachment_retention%ROWTYPE; claim private.dpw_attachment_purge_claims%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role' OR _job_id IS NULL
 OR private.dpw_retention_attest() IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.closed_retention_processor_required'; END IF;
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file_id FOR UPDATE;
 IF NOT FOUND OR a.expires_at>clock_timestamp() OR private.dpw_attachment_has_hold(_file_id) OR private.dpw_attachment_has_canonical_reference(_file_id)
 OR EXISTS(SELECT 1 FROM public.data_prep_attachment_tombstones WHERE file_id=_file_id) THEN RAISE EXCEPTION 'dpw.attachment_not_purge_eligible'; END IF;
 SELECT * INTO claim FROM private.dpw_attachment_purge_claims WHERE file_id=_file_id;
 IF FOUND AND claim.job_id<>_job_id THEN RAISE EXCEPTION 'dpw.purge_unknown_previous_outcome_requires_readback'; END IF;
 INSERT INTO private.dpw_attachment_purge_claims(file_id,job_id,expires_at,state) VALUES(_file_id,_job_id,clock_timestamp()+interval '5 minutes','claimed') ON CONFLICT(file_id) DO NOTHING;
 RETURN jsonb_build_object('file_id',a.file_id,'bucket_id',a.bucket_id,'original_path',a.original_path,'original_file_bytes_sha256',a.original_file_bytes_sha256,
 'job_id',_job_id,'expires_at',a.expires_at,'main_must_recheck_legal_hold_immediately_before_object_delete',true);
END $$;
CREATE FUNCTION public.dpw_finish_attachment_purge(_file_id uuid,_job_id uuid,_object_absence_verified boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.data_prep_attachment_retention%ROWTYPE; t public.data_prep_attachment_tombstones%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR current_setting('role',true) IS DISTINCT FROM 'service_role'
 OR _object_absence_verified IS DISTINCT FROM true OR private.dpw_retention_attest() IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.closed_retention_processor_required'; END IF;
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file_id FOR UPDATE;
 IF NOT FOUND OR a.expires_at>clock_timestamp() OR private.dpw_attachment_has_hold(_file_id) OR private.dpw_attachment_has_canonical_reference(_file_id) THEN RAISE EXCEPTION 'dpw.attachment_not_purge_eligible'; END IF;
 SELECT * INTO t FROM public.data_prep_attachment_tombstones WHERE file_id=_file_id;
 IF FOUND THEN
  IF t.job_id<>_job_id THEN RAISE EXCEPTION 'dpw.purge_job_conflict'; END IF;
  RETURN to_jsonb(t);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.dpw_attachment_purge_claims WHERE file_id=_file_id AND job_id=_job_id AND state='claimed' AND expires_at>clock_timestamp())
 OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=a.bucket_id AND name=a.original_path)
 THEN RAISE EXCEPTION 'dpw.purge_absence_and_fresh_claim_required'; END IF;
 INSERT INTO public.data_prep_attachment_tombstones(file_id,job_id,transport_role,object_absence_verified,original_file_bytes_sha256,original_size_bytes)
 VALUES(_file_id,_job_id,'service_role',true,a.original_file_bytes_sha256,a.original_size_bytes) RETURNING * INTO t;
 UPDATE private.dpw_attachment_purge_claims SET state='completed' WHERE file_id=_file_id;
 -- Only storage bytes are attested here. Shared workspace upload JSON is NOT
 -- deleted by an unqualified generic path. Main must qualify attached parsed
 -- data-only clearing and legal-hold/object-delete race before activation.
 RETURN to_jsonb(t);
END $$;
DO $acl$
DECLARE name text; fn record;
BEGIN
 FOREACH name IN ARRAY ARRAY['data_prep_mode_choices','data_prep_attachment_retention','data_prep_attachment_holds','data_prep_attachment_tombstones'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',name);
  EXECUTE format('CREATE TRIGGER dpw_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable()',name);
 END LOOP;
 REVOKE ALL ON private.dpw_attachment_purge_claims FROM PUBLIC,anon,authenticated,service_role;
 FOR fn IN SELECT p.oid::regprocedure AS signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.proname IN('dpw_workspace_feature_attest','dpw_effective_attachment_policy','dpw_mode_attest','dpw_set_execution_mode','dpw_attachment_register','dpw_attachment_has_hold','dpw_attachment_viewable',
 'dpw_file_retention_metadata','dpw_redact_audit_context','dpw_file_metadata','dpw_redact_columns','dpw_redact_descriptor','dpw_run_payload_state','dpw_run_payload_available','dpw_run_readback_metadata',
 'dpw_legal_hold_attest','dpw_retention_attest','dpw_set_attachment_hold','dpw_get_file_retention','dpw_claim_attachment_purge','dpw_finish_attachment_purge') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',fn.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
  IF fn.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',fn.signature,
  CASE WHEN fn.proname IN('dpw_claim_attachment_purge','dpw_finish_attachment_purge') THEN 'service_role' ELSE 'authenticated' END); END IF;
 END LOOP;
END $acl$;


-- FROZEN INPUT RECON-BINDING-BODY.sql SHA256 98d8d9cec8fd67a0ff7b765d305cb795d27e57967c749af2c9633e72125f5db3
-- Coupled addition, not the unrelated paused atomic recon release.
-- Normal current manual path uses authenticated INSERT public.recon_runs.
-- Missing approved-definition attestations remain closed pending main capture.
ALTER TABLE public.data_prep_prepared_datasets ADD UNIQUE(id,batch_id,run_id,upload_id,pipeline_id,pipeline_version,business_date,data_source_id);
CREATE TABLE public.data_prep_recon_run_requests (
 recon_run_id uuid PRIMARY KEY REFERENCES public.recon_runs(id), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 definition_id uuid NOT NULL REFERENCES public.recon_definitions(id), created_by uuid NOT NULL REFERENCES auth.users(id),
 request_key uuid NOT NULL, approved_snapshot jsonb NOT NULL, approved_snapshot_sha256 text NOT NULL,
 approved_revision_id uuid NOT NULL, approved_revision_number integer NOT NULL,
 input_bindings jsonb NOT NULL, business_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,created_by,request_key)
);
CREATE TABLE public.data_prep_recon_run_inputs (
 recon_run_id uuid NOT NULL REFERENCES public.data_prep_recon_run_requests(recon_run_id), side_id text NOT NULL,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), definition_id uuid NOT NULL REFERENCES public.recon_definitions(id),
 data_source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id), upload_id uuid NOT NULL REFERENCES public.workspace_data_source_uploads(id),
 dataset_id uuid, batch_id uuid, preparation_run_id uuid, pipeline_id uuid, pipeline_version integer, business_date date,
 binding_kind text NOT NULL CHECK(binding_kind IN('prepared_dataset','fixed_upload')),
 content_sha256 text NOT NULL, row_count integer NOT NULL, logical_side text, output_indexes integer[], selected_structured_sha256 text,
 PRIMARY KEY(recon_run_id,side_id),
 FOREIGN KEY(dataset_id,batch_id,preparation_run_id,upload_id,pipeline_id,pipeline_version,business_date,data_source_id)
 REFERENCES public.data_prep_prepared_datasets(id,batch_id,run_id,upload_id,pipeline_id,pipeline_version,business_date,data_source_id),
 CHECK((binding_kind='prepared_dataset' AND dataset_id IS NOT NULL AND batch_id IS NOT NULL AND preparation_run_id IS NOT NULL
 AND pipeline_id IS NOT NULL AND pipeline_version IS NOT NULL AND business_date IS NOT NULL)
 OR (binding_kind='fixed_upload' AND dataset_id IS NULL AND batch_id IS NULL AND preparation_run_id IS NULL AND pipeline_id IS NULL AND pipeline_version IS NULL))
);
CREATE TRIGGER dpw_recon_request_immutable BEFORE UPDATE OR DELETE ON public.data_prep_recon_run_requests FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
CREATE TRIGGER dpw_recon_inputs_immutable BEFORE UPDATE OR DELETE ON public.data_prep_recon_run_inputs FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
ALTER TABLE public.data_prep_recon_run_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_prep_recon_run_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_prep_recon_run_requests,public.data_prep_recon_run_inputs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.dpw_recon_schema_contract(_tenant uuid,_definition uuid,_revision uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE version public.recon_definition_approved_versions%ROWTYPE; frozen jsonb; contract jsonb; field jsonb;
BEGIN
 SELECT * INTO version FROM public.recon_definition_approved_versions WHERE id=_revision AND tenant_id=_tenant AND parent_definition_id=_definition;
 IF NOT FOUND THEN RAISE EXCEPTION 'dpw.approved_schema_revision_unknown'; END IF;
 -- New backend Save/Govern producer uses this explicitly NEW configuration
 -- property, which the unmodified native config snapshot/hash already covers.
 -- Existing frozen instances of the same qualified format are reusable. Never
 -- derive a historical revision's expected schema from current source uploads.
 frozen:=version.snapshot->'extension'->'data_prep_input_contracts';
 IF frozen IS NULL THEN RETURN jsonb_build_object('input_contracts','[]'::jsonb,'compatibility_state','governed_schema_revision_required',
 'reconciliation_feature_enabled',private.dpw_recon_feature_attest(auth.uid(),_tenant)); END IF;
 IF frozen->>'contract_version' IS NULL OR (frozen->>'contract_version')::integer NOT IN(1,2) OR jsonb_typeof(frozen->'input_contracts') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'dpw.frozen_schema_contract_invalid'; END IF;
 FOR contract IN SELECT value FROM jsonb_array_elements(frozen->'input_contracts') LOOP
  IF coalesce(contract->>'side_id','')='' OR coalesce(contract->>'logical_side','')='' OR jsonb_typeof(contract->'fields') IS DISTINCT FROM 'array'
  OR jsonb_array_length(contract->'fields')=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(version.snapshot->'sides') s WHERE s.value->>'side_id'=contract->>'side_id')
  THEN RAISE EXCEPTION 'dpw.frozen_side_contract_invalid'; END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(contract->'fields') LOOP
   IF coalesce(field->>'name','')='' OR field->>'name'='extras_json' OR jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean'
   OR (field->>'json_type' IS NULL AND (jsonb_typeof(field->'json_types') IS DISTINCT FROM 'array' OR jsonb_array_length(field->'json_types')=0))
   OR (field->>'json_type' IS NOT NULL AND field->>'json_type' NOT IN('string','number','boolean','array','object'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(field->'json_types','[]'::jsonb)) type WHERE type.value NOT IN('string','number','boolean','array','object'))
   THEN RAISE EXCEPTION 'dpw.frozen_field_contract_invalid'; END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('input_contracts',frozen->'input_contracts','compatibility_state','frozen_approved_schema',
 'reconciliation_feature_enabled',private.dpw_recon_feature_attest(auth.uid(),_tenant));
END $$;
CREATE FUNCTION private.dpw_recon_feature_attest(_actor uuid,_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'dpw.native_reconciliation_feature_dependency_unqualified' USING ERRCODE='42501'; END $$;
CREATE FUNCTION private.dpw_recon_approved_attest(_actor uuid,_tenant uuid,_definition uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.recon_definitions%ROWTYPE; v public.recon_definition_approved_versions%ROWTYPE; sources jsonb; runtime_snapshot jsonb; contracts jsonb;
BEGIN
 IF _actor IS DISTINCT FROM auth.uid() OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'dpw.real_recon_actor_required'; END IF;
 -- Reuse actual bound-version producer including independent-run-actor,
 -- approved promotion request, exact full configuration SHA and native scope.
 v:=private.recon_run_bound_approved_version(_tenant,_definition,_actor);
 IF v.id IS NULL OR private.recon_root_write_allowed(_definition,_tenant,'run') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.actual_approved_recon_required'; END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 SELECT jsonb_agg(jsonb_build_object('side_id',side.value->>'side_id','data_source_id',side.value->>'data_source_id',
 'name',ds.name,'source_type',ds.source_type) ORDER BY side.ordinality) INTO sources
 FROM jsonb_array_elements(d.sides) WITH ORDINALITY side(value,ordinality)
 LEFT JOIN public.workspace_data_sources ds ON ds.id::text=side.value->>'data_source_id' AND ds.tenant_id=_tenant;
 -- Exact runtime snapshot shape of captured tg_snapshot_recon_run_definition,
 -- distinct from the approved configuration snapshot (description/extension).
 runtime_snapshot:=jsonb_build_object('name',d.name,'recon_type',d.recon_type,'sides',d.sides,'rules',d.rules,
 'sources',coalesce(sources,'[]'::jsonb),'governance_state',d.governance_state,'access_mode',d.access_mode,
 'approved_version',v.version_number,'approved_sha256',v.snapshot_sha256);
 contracts:=private.dpw_recon_schema_contract(_tenant,_definition,v.id);
 RETURN jsonb_build_object('snapshot',runtime_snapshot,'approved_configuration_snapshot',v.snapshot,'snapshot_sha256',v.snapshot_sha256,
 'revision_id',v.id,'revision_number',v.version_number,'input_contracts',contracts->'input_contracts',
 'reconciliation_feature_enabled',contracts->'reconciliation_feature_enabled');
END $$;

CREATE FUNCTION private.dpw_recon_preflight(_tenant uuid,_definition uuid,_business_date date,_bindings jsonb,_expected_definition_sha256 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant); approved jsonb; side jsonb; input jsonb;
 d public.data_prep_prepared_datasets%ROWTYPE; u public.workspace_data_source_uploads%ROWTYPE; contract jsonb; field jsonb; indexes integer[]; row_value jsonb;resolved_logical_side text;
BEGIN
 approved:=private.dpw_recon_approved_attest(actor,_tenant,_definition);
 IF (approved->>'reconciliation_feature_enabled')::boolean IS DISTINCT FROM true
 OR _business_date IS NULL OR approved->>'snapshot_sha256' IS DISTINCT FROM _expected_definition_sha256
 OR jsonb_typeof(approved->'snapshot'->'sides') IS DISTINCT FROM 'array' OR jsonb_typeof(_bindings) IS DISTINCT FROM 'array'
 OR jsonb_array_length(_bindings)<>jsonb_array_length(approved->'snapshot'->'sides')
 OR (SELECT count(DISTINCT value->>'side_id') FROM jsonb_array_elements(_bindings))<>jsonb_array_length(_bindings)
 THEN RAISE EXCEPTION 'dpw.recon_approved_input_mismatch'; END IF;
 FOR side IN SELECT value FROM jsonb_array_elements(approved->'snapshot'->'sides') LOOP
  SELECT value INTO input FROM jsonb_array_elements(_bindings) WHERE value->>'side_id'=side->>'side_id';
  IF input IS NULL OR input->>'data_source_id' IS DISTINCT FROM side->>'data_source_id'
  OR private.dpw_source_allows(actor,_tenant,(side->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'dpw.recon_source_binding_denied'; END IF;
  IF nullif(side->>'upload_id','') IS NOT NULL THEN
   IF input->>'kind' IS DISTINCT FROM 'fixed_upload' OR input->>'upload_id' IS DISTINCT FROM side->>'upload_id'
   OR input ? 'dataset_id' THEN RAISE EXCEPTION 'dpw.fixed_definition_pin_cannot_be_overridden'; END IF;
   SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(input->>'upload_id')::uuid
   AND tenant_id=_tenant AND data_source_id=(side->>'data_source_id')::uuid;
   IF NOT FOUND OR jsonb_typeof(u.rows)<>'array' OR u.row_count<>jsonb_array_length(u.rows) THEN RAISE EXCEPTION 'dpw.fixed_input_unavailable'; END IF;
  ELSE
   SELECT value INTO contract FROM jsonb_array_elements(coalesce(approved->'input_contracts','[]'::jsonb)) WHERE value->>'side_id'=side->>'side_id';
   IF contract IS NULL OR (contract->>'logical_side' IS NOT NULL AND contract->>'logical_side' IS DISTINCT FROM input->>'logical_side')
   OR jsonb_typeof(contract->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(contract->'fields')=0
   THEN RAISE EXCEPTION 'dpw.recon_authoritative_schema_missing_governed_revision_required'; END IF;
   SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE id=(input->>'dataset_id')::uuid AND tenant_id=_tenant;
   IF NOT FOUND THEN RAISE EXCEPTION 'dpw.current_ready_dataset_required';END IF;
   resolved_logical_side:=coalesce(contract->>'logical_side',private.rs_select_compatible_logical_side(_tenant,d.id,contract));
   IF resolved_logical_side IS DISTINCT FROM input->>'logical_side' THEN RAISE EXCEPTION 'dpw.unique_approved_rule_compatible_cohort_required';END IF;
   IF NOT FOUND OR input->>'kind' IS DISTINCT FROM 'prepared_dataset' OR d.business_date<>_business_date
   OR input->>'pipeline_id' IS DISTINCT FROM d.pipeline_id::text OR (input->>'pipeline_version')::integer IS DISTINCT FROM d.pipeline_version
   OR input->>'upload_id' IS DISTINCT FROM d.upload_id::text OR d.data_source_id::text IS DISTINCT FROM side->>'data_source_id'
   OR private.data_prep_pipeline_scope_allows(actor,_tenant,d.pipeline_id,'view') IS DISTINCT FROM true
   OR private.dpw_run_payload_available(d.run_id) IS DISTINCT FROM true
   OR NOT EXISTS(SELECT 1 FROM public.data_prep_pipelines p WHERE p.id=d.pipeline_id AND p.tenant_id=_tenant AND p.status='approved'
   AND p.lifecycle_state='production' AND p.version=d.pipeline_version AND p.output_data_source_id=d.data_source_id)
   OR NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_runs r,jsonb_array_elements(r.snapshot->'feeds') f
   WHERE r.id=d.run_id AND f.value->>'business_side'=resolved_logical_side)
   OR NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_batches b JOIN public.data_prep_delivery_runs r ON r.id=d.run_id AND r.batch_id=b.id
   WHERE b.id=d.batch_id AND b.mode='prepare' AND b.state='published' AND r.pipeline_version=d.pipeline_version
   AND r.finished_at IS NOT NULL AND r.state IN('success','warn') AND (r.result->>'publication_eligible')::boolean IS TRUE)
   THEN RAISE EXCEPTION 'dpw.current_ready_dataset_required'; END IF;
   SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=d.upload_id AND tenant_id=_tenant AND data_source_id=d.data_source_id;
   IF NOT FOUND OR u.content_sha256 IS DISTINCT FROM d.content_sha256 OR u.row_count<>d.rows
   OR jsonb_typeof(u.rows)<>'array' OR jsonb_array_length(u.rows)<>d.rows OR private.dpw_hash(u.rows) IS DISTINCT FROM d.content_sha256
   THEN RAISE EXCEPTION 'dpw.prepared_upload_lineage_mismatch'; END IF;
   indexes:=private.dpw_dataset_indexes(d.id,resolved_logical_side);
   FOR row_value IN SELECT u.rows->x FROM unnest(indexes) x LOOP
    IF private.rs_contract_row_allowed(row_value,contract) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.recon_approved_field_domain_incompatible';END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN approved;
END $$;

CREATE FUNCTION private.dpw_persist_recon_binding(_tenant uuid,_definition uuid,_run uuid,_business_date date,_bindings jsonb,_request_key uuid,_expected_definition_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant); approved jsonb; r public.recon_runs%ROWTYPE; input jsonb;
 d public.data_prep_prepared_datasets%ROWTYPE; u public.workspace_data_source_uploads%ROWTYPE; indexes integer[]; selected_rows jsonb;
BEGIN
 -- No adoption of old/failed/partial runs and no status rewrite to hide errors.
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND definition_id=_definition FOR UPDATE;
 IF NOT FOUND OR r.run_by IS DISTINCT FROM actor OR r.status<>'queued' OR r.completed_at IS NOT NULL
 OR r.started_at<transaction_timestamp() OR r.matched_count<>0 OR r.exception_count<>0
 OR EXISTS(SELECT 1 FROM public.recon_matches WHERE run_id=r.id) OR EXISTS(SELECT 1 FROM public.recon_exceptions WHERE run_id=r.id)
 THEN RAISE EXCEPTION 'dpw.new_owned_recon_run_required'; END IF;
 approved:=private.dpw_recon_preflight(_tenant,_definition,_business_date,_bindings,_expected_definition_sha256);
 IF r.definition_snapshot IS DISTINCT FROM approved->'snapshot'
 OR r.approved_revision_id IS DISTINCT FROM (approved->>'revision_id')::uuid
 OR r.approved_revision_number IS DISTINCT FROM (approved->>'revision_number')::integer
 OR r.approved_revision_sha256 IS DISTINCT FROM approved->>'snapshot_sha256'
 THEN RAISE EXCEPTION 'dpw.recon_native_approval_snapshot_mismatch'; END IF;
 INSERT INTO public.data_prep_recon_run_requests(recon_run_id,tenant_id,definition_id,created_by,request_key,approved_snapshot,approved_snapshot_sha256,approved_revision_id,approved_revision_number,input_bindings,business_date)
 VALUES(r.id,_tenant,_definition,actor,_request_key,approved->'snapshot',approved->>'snapshot_sha256',(approved->>'revision_id')::uuid,
 (approved->>'revision_number')::integer,_bindings,_business_date);
 FOR input IN SELECT value FROM jsonb_array_elements(_bindings) LOOP
  SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(input->>'upload_id')::uuid;
  IF input->>'kind'='prepared_dataset' THEN
   SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE id=(input->>'dataset_id')::uuid;
   indexes:=private.dpw_dataset_indexes(d.id,input->>'logical_side');
   SELECT coalesce(jsonb_agg(u.rows->i ORDER BY i),'[]'::jsonb) INTO selected_rows FROM unnest(indexes) i;
   INSERT INTO public.data_prep_recon_run_inputs VALUES(r.id,input->>'side_id',_tenant,_definition,d.data_source_id,d.upload_id,
   d.id,d.batch_id,d.run_id,d.pipeline_id,d.pipeline_version,d.business_date,'prepared_dataset',d.content_sha256,cardinality(indexes),input->>'logical_side',indexes,private.dpw_hash(selected_rows));
  ELSE
   INSERT INTO public.data_prep_recon_run_inputs VALUES(r.id,input->>'side_id',_tenant,_definition,u.data_source_id,u.id,
   NULL,NULL,NULL,NULL,NULL,NULL,'fixed_upload',u.content_sha256,u.row_count,NULL,NULL,private.dpw_hash(u.rows));
  END IF;
 END LOOP;
 PERFORM private.dpw_audit(actor,_tenant,'dpw.recon.inputs.bind',r.id,jsonb_build_object('definition_id',_definition,'bindings',_bindings,'approved_sha256',_expected_definition_sha256));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'run_id',r.id,'run_uid',r.run_uid,'input_bindings',_bindings,'approved_snapshot',approved->'snapshot','is_new',true);
END $$;
CREATE FUNCTION public.dpw_get_recon_input_rows(_tenant_id uuid,_run_id uuid,_side_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant_id); binding public.data_prep_recon_run_inputs%ROWTYPE;
 u public.workspace_data_source_uploads%ROWTYPE; rows_value jsonb;
BEGIN
 SELECT * INTO binding FROM public.data_prep_recon_run_inputs WHERE recon_run_id=_run_id AND tenant_id=_tenant_id AND side_id=_side_id;
 IF NOT FOUND OR private.dpw_source_allows(actor,_tenant_id,binding.data_source_id,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.recon_input_read_denied'; END IF;
 PERFORM private.dpw_recon_approved_attest(actor,_tenant_id,binding.definition_id);
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=binding.upload_id AND tenant_id=_tenant_id AND data_source_id=binding.data_source_id;
 IF binding.binding_kind='fixed_upload' THEN rows_value:=u.rows;
 ELSE
  IF private.dpw_run_payload_available(binding.preparation_run_id) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'side_id',_side_id,'binding',to_jsonb(binding),
   'payload',private.dpw_run_payload_state(binding.preparation_run_id),'rows',NULL,'rows_count',binding.row_count,'structured_data_sha256',binding.selected_structured_sha256);
  END IF;
  IF private.data_prep_pipeline_scope_allows(actor,_tenant_id,binding.pipeline_id,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.recon_pipeline_read_denied'; END IF;
  SELECT coalesce(jsonb_agg(u.rows->i ORDER BY i),'[]'::jsonb) INTO rows_value FROM unnest(binding.output_indexes) i;
 END IF;
 IF jsonb_typeof(rows_value) IS DISTINCT FROM 'array' OR jsonb_array_length(rows_value)<>binding.row_count
 OR private.dpw_hash(rows_value) IS DISTINCT FROM binding.selected_structured_sha256 THEN RAISE EXCEPTION 'dpw.recon_input_hash_mismatch'; END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'side_id',_side_id,'binding',to_jsonb(binding),
 'rows',rows_value,'rows_count',binding.row_count,'structured_data_sha256',binding.selected_structured_sha256);
END $$;

CREATE FUNCTION public.dpw_create_recon_run(_tenant_id uuid,_definition_id uuid,_business_date date,_bindings jsonb,_request_key uuid,_expected_definition_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant_id); approved jsonb; runrow public.recon_runs%ROWTYPE; replay jsonb;
BEGIN
 IF _request_key IS NULL THEN RAISE EXCEPTION 'dpw.recon_request_key_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||actor::text||_request_key::text,23));
 -- Preflight before INSERT, persist rechecks after native run triggers, all in
 -- this one authenticated transaction. Matching begins only after commit ACK.
 approved:=private.dpw_recon_preflight(_tenant_id,_definition_id,_business_date,_bindings,_expected_definition_sha256);
 replay:=public.dpw_get_recon_binding(_tenant_id,_request_key);
 IF replay->>'run_id' IS NOT NULL THEN
  IF replay->>'definition_id' IS DISTINCT FROM _definition_id::text OR replay->'input_bindings' IS DISTINCT FROM _bindings
  OR replay->>'business_date' IS DISTINCT FROM _business_date::text OR replay->>'approved_snapshot_sha256' IS DISTINCT FROM _expected_definition_sha256
  THEN RAISE EXCEPTION 'dpw.recon_request_conflict'; END IF;
  RETURN replay||jsonb_build_object('is_new',false);
 END IF;
 INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by) VALUES(_tenant_id,_definition_id,'queued',actor) RETURNING * INTO runrow;
 RETURN private.dpw_persist_recon_binding(_tenant_id,_definition_id,runrow.id,_business_date,_bindings,_request_key,_expected_definition_sha256);
END $$;

CREATE FUNCTION public.dpw_get_recon_binding(_tenant_id uuid,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant_id); r public.data_prep_recon_run_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.data_prep_recon_run_requests WHERE tenant_id=_tenant_id AND created_by=actor AND request_key=_request_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'state','absent'); END IF;
 PERFORM private.dpw_recon_approved_attest(actor,_tenant_id,r.definition_id);
 IF EXISTS(SELECT 1 FROM public.data_prep_recon_run_inputs i WHERE i.recon_run_id=r.recon_run_id AND private.dpw_source_allows(actor,_tenant_id,i.data_source_id,'view') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'dpw.recon_binding_read_denied'; END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'run_id',r.recon_run_id,'definition_id',r.definition_id,'business_date',r.business_date,
 'approved_snapshot_sha256',r.approved_snapshot_sha256,'approved_snapshot',r.approved_snapshot,'input_bindings',r.input_bindings,'state','recorded');
END $$;
ALTER FUNCTION private.dpw_recon_approved_attest(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.dpw_recon_schema_contract(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.dpw_recon_feature_attest(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.dpw_recon_preflight(uuid,uuid,date,jsonb,text) OWNER TO postgres;
ALTER FUNCTION private.dpw_persist_recon_binding(uuid,uuid,uuid,date,jsonb,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.dpw_get_recon_binding(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.dpw_get_recon_input_rows(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.dpw_recon_feature_attest(uuid,uuid),private.dpw_recon_schema_contract(uuid,uuid,uuid),private.dpw_recon_approved_attest(uuid,uuid,uuid), private.dpw_recon_preflight(uuid,uuid,date,jsonb,text),
 private.dpw_persist_recon_binding(uuid,uuid,uuid,date,jsonb,uuid,text), public.dpw_create_recon_run(uuid,uuid,date,jsonb,uuid,text), public.dpw_get_recon_binding(uuid,uuid),public.dpw_get_recon_input_rows(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.dpw_actor(uuid),private.dpw_recon_preflight(uuid,uuid,date,jsonb,text),
 private.dpw_persist_recon_binding(uuid,uuid,uuid,date,jsonb,uuid,text),public.dpw_create_recon_run(uuid,uuid,date,jsonb,uuid,text),public.dpw_get_recon_binding(uuid,uuid),public.dpw_get_recon_input_rows(uuid,uuid,text) TO authenticated;


-- FROZEN INPUT GOVERNANCE-PRODUCER.sql SHA256 5a31b30fcc58eda5834ace3d4323ff65216586a5bd25087397550bd3c402bc5c
-- NEW PROPOSAL ONLY. No provider apply, ledger, ACL waiver or shared BODY edits.
-- Existing table/permission/helper names are source-confirmed. Execute CURRENT-CONTROLS.SELECT.sql before integration.
-- private.dpw_actor is the other native lane's CLOSED current-factor producer; retain that qualification gate.
CREATE TABLE private.wfm_page_catalog(key text PRIMARY KEY,label text NOT NULL,permission text,parents text[] NOT NULL,feature_keys text[] NOT NULL,navigation boolean NOT NULL);
INSERT INTO private.wfm_page_catalog VALUES
('dashboard','Dashboard',NULL,ARRAY[]::text[],ARRAY[]::text[],true),
('ingest','Ingestion hub','data.source.read',ARRAY[]::text[],ARRAY[]::text[],true),
('data','Data Prep','data.upload',ARRAY['ingest']::text[],ARRAY[]::text[],false),
('connectors','Connections','data.source.read',ARRAY['ingest']::text[],ARRAY[]::text[],true),
('watchers','File watchers','data.source.read',ARRAY['ingest']::text[],ARRAY['data_watchers']::text[],true),
('prep','Data Prep','data.prep.read',ARRAY['ingest']::text[],ARRAY['data_prep']::text[],true),
('aidp','AIDP','aidp.document.read',ARRAY['ingest']::text[],ARRAY['aidp']::text[],true),
('reference','Reference data','reference.read',ARRAY['ingest']::text[],ARRAY[]::text[],true),
('recons','Rekon Studio','recon.definition.read',ARRAY[]::text[],ARRAY[]::text[],true),
('schedules','Rekon Orchestrator','recon.run.execute',ARRAY[]::text[],ARRAY[]::text[],true),
('runs','Run history','recon.definition.read',ARRAY[]::text[],ARRAY[]::text[],true),
('templates','Starter Kits','recon.definition.read',ARRAY[]::text[],ARRAY[]::text[],true),
('collateral','Collateral / CSA','recon.definition.read',ARRAY[]::text[],ARRAY[]::text[],true),
('exception-dashboard','Exceptions dashboard','break.read',ARRAY[]::text[],ARRAY[]::text[],true),
('exceptions','Exception inbox','break.read',ARRAY[]::text[],ARRAY[]::text[],true),
('assignment','Auto-assignment','break.assign',ARRAY[]::text[],ARRAY[]::text[],true),
('breaks','Break manager','break.read',ARRAY[]::text[],ARRAY['break_manager']::text[],true),
('proposed','Proposed matches','recon.match.approve',ARRAY[]::text[],ARRAY[]::text[],true),
('matches','Matched records','recon.definition.read',ARRAY[]::text[],ARRAY[]::text[],true),
('nrl','Natural Rule Language','recon.definition.update',ARRAY[]::text[],ARRAY[]::text[],true),
('manual-approvals','Manual match approvals','recon.match.approve',ARRAY[]::text[],ARRAY[]::text[],true),
('ageing','Ageing','break.read',ARRAY[]::text[],ARRAY[]::text[],true),
('reports','Reports','recon.definition.read',ARRAY[]::text[],ARRAY['reports']::text[],true),
('agent','Agent','ai.agent.run',ARRAY[]::text[],ARRAY['agent']::text[],true),
('productivity','Productivity','recon.definition.read',ARRAY[]::text[],ARRAY[]::text[],true),
('eod','EOD sign-off','signoff.submit',ARRAY[]::text[],ARRAY[]::text[],true),
('membership-requests','Request group access',NULL,ARRAY[]::text[],ARRAY[]::text[],true),
('regulatory','Regulatory packs','compliance.evidence.read',ARRAY[]::text[],ARRAY[]::text[],true),
('lineage','Data lineage','data.lineage.read',ARRAY[]::text[],ARRAY[]::text[],true),
('audit','Audit','audit.log.read',ARRAY[]::text[],ARRAY[]::text[],true),
('tickets','Tickets','support.ticket.read',ARRAY[]::text[],ARRAY[]::text[],true),
('kb','Knowledge',NULL,ARRAY[]::text[],ARRAY[]::text[],true),
('access-explorer','Access explorer',NULL,ARRAY[]::text[],ARRAY[]::text[],false),
('my-templates','My Templates',NULL,ARRAY[]::text[],ARRAY[]::text[],true),
('training','Training',NULL,ARRAY[]::text[],ARRAY[]::text[],true),
('hub','Workspace hub',NULL,ARRAY[]::text[],ARRAY[]::text[],true);
CREATE TABLE private.wfm_feature_catalog(key text PRIMARY KEY,default_enabled boolean NOT NULL,category text NOT NULL);
INSERT INTO private.wfm_feature_catalog VALUES
('copilot',true,'AI'),
('agent',true,'AI'),
('auto_match_ai',false,'AI'),
('auto_remediation',false,'AI'),
('data_prep',true,'Data'),
('data_watchers',true,'Data'),
('scheduled_connectors',true,'Data'),
('webhooks',true,'Integrations'),
('sso_saml',false,'Security'),
('ip_allowlist',false,'Security'),
('presence',true,'Collab'),
('reports',true,'Insights'),
('break_manager',true,'Insights'),
('aidp',false,'AI'),
('byo_llm',true,'AI'),
('tenant_groups',true,'Security'),
('recon_rbac',true,'Security'),
('cost_metering',true,'AI');
CREATE TABLE private.wfm_ux_catalog(key text PRIMARY KEY);
INSERT INTO private.wfm_ux_catalog VALUES ('dashboard_layouts'),('recent_searches'),('announcement_banner'),('dual_team_context'),('sidebar_shortcuts'),('back_button_audit'),('theme_catalog_expanded'),('theme_wcag_scoring'),('notification_prefs_matrix'),('extended_profile_fields'),('teams_primitive'),('team_context_switcher'),('team_shared_workspaces'),('mentions'),('comments_reactions'),('task_assignment'),('availability_status'),('autosave_drafts'),('version_recovery'),('progressive_skeletons'),('single_session_enforcement'),('logout_all_devices'),('device_change_audit'),('universal_error_boundary'),('empty_state_library'),('perf_budgets'),('team_id_on_audit'),('read_path_audit');
CREATE TABLE private.wfm_epoch(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0));
CREATE TABLE private.wfm_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),kind text NOT NULL,key text NOT NULL,
 before_value jsonb NOT NULL,after_value jsonb NOT NULL,epoch bigint NOT NULL,UNIQUE(tenant_id,epoch));
CREATE TABLE private.wfm_global_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES auth.users(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),key text NOT NULL,before_value jsonb NOT NULL,after_value jsonb NOT NULL);
CREATE TABLE private.wfm_requests(tenant_id uuid NOT NULL,actor_id uuid NOT NULL,request_key uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,PRIMARY KEY(tenant_id,actor_id,request_key));
CREATE TABLE private.wfm_pipeline_modes(tenant_id uuid NOT NULL REFERENCES public.tenants(id),pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id),
 mode text NOT NULL CHECK(mode IN('manual','assisted','agentic')),PRIMARY KEY(tenant_id,pipeline_id));
CREATE TABLE private.wfm_draft_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id),actor_id uuid NOT NULL REFERENCES auth.users(id),mode text NOT NULL CHECK(mode IN('assisted','agentic')),
 epoch bigint NOT NULL,request_key uuid NOT NULL,draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(tenant_id,actor_id,request_key));
CREATE TABLE private.wfm_plan_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid NOT NULL REFERENCES private.wfm_draft_plans(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),event text NOT NULL CHECK(event IN('cancelled','accepted','rejected')),proposal_key text,
 control_event_id uuid REFERENCES private.wfm_events(id),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE UNIQUE INDEX wfm_plan_cancel_once ON private.wfm_plan_events(plan_id) WHERE event='cancelled';
CREATE UNIQUE INDEX wfm_proposal_decide_once ON private.wfm_plan_events(plan_id,proposal_key) WHERE event IN('accepted','rejected');
CREATE FUNCTION private.wfm_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'wfm.immutable_evidence' USING ERRCODE='42501'; END $$;
CREATE TRIGGER wfm_events_immutable BEFORE UPDATE OR DELETE ON private.wfm_events FOR EACH ROW EXECUTE FUNCTION private.wfm_immutable();
CREATE TRIGGER wfm_global_events_immutable BEFORE UPDATE OR DELETE ON private.wfm_global_events FOR EACH ROW EXECUTE FUNCTION private.wfm_immutable();
CREATE TRIGGER wfm_requests_immutable BEFORE UPDATE OR DELETE ON private.wfm_requests FOR EACH ROW EXECUTE FUNCTION private.wfm_immutable();
CREATE TRIGGER wfm_draft_immutable BEFORE UPDATE OR DELETE ON private.wfm_draft_plans FOR EACH ROW EXECUTE FUNCTION private.wfm_immutable();
CREATE TRIGGER wfm_plan_events_immutable BEFORE UPDATE OR DELETE ON private.wfm_plan_events FOR EACH ROW EXECUTE FUNCTION private.wfm_immutable();

-- Account/factor authority is independent of Data Prep availability. Raw helper bodies are hash-bound in NATIVE-QUALIFICATION.json.
CREATE FUNCTION private.wfm_actor(_tenant uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();claims jsonb:=auth.jwt();expires timestamptz;
BEGIN
 IF _tenant IS NULL OR actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated'
 OR claims->>'exp' IS NULL OR claims->>'exp' !~ '^[0-9]{1,20}$'
 OR public.rlnext_actor_allowed() IS DISTINCT FROM true OR private.rlnext_account_allowed(actor,NULL) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant) THEN RAISE EXCEPTION 'wfm.current_account_denied' USING ERRCODE='42501';END IF;
 BEGIN expires:=to_timestamp((claims->>'exp')::double precision);EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'wfm.current_account_denied' USING ERRCODE='42501';END;
 IF expires<=clock_timestamp() THEN RAISE EXCEPTION 'wfm.current_account_denied' USING ERRCODE='42501';END IF;
 IF public.is_platform_admin(actor) IS TRUE THEN
  IF private.wfm_platform_factor_attest() IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.platform_factor_denied' USING ERRCODE='42501';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active IS TRUE)
  OR private.dpw_native_factor_attest(actor,_tenant,claims->>'aal',expires) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'wfm.current_membership_or_factor_denied' USING ERRCODE='42501';END IF;
 END IF;
 RETURN actor;
END $$;
CREATE FUNCTION private.wfm_can_manage(_tenant uuid,_ai boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant);
BEGIN RETURN (public.is_platform_admin(actor) IS TRUE OR public.has_tenant_role(actor,_tenant,'tenant_admin') IS TRUE)
 AND public.user_has_permission(actor,_tenant,'tenant.settings.update',NULL) IS TRUE
 AND (NOT _ai OR public.user_has_permission(actor,_tenant,'ai.model.configure',NULL) IS TRUE); END $$;
CREATE FUNCTION private.wfm_feature_enabled(_tenant uuid,_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM private.wfm_feature_catalog c
 LEFT JOIN public.tenant_feature_flags f ON f.tenant_id=_tenant AND f.feature_key=c.key
 LEFT JOIN public.tenant_feature_entitlements e ON e.tenant_id=_tenant AND e.feature_key=c.key
 WHERE c.key=_key AND (CASE WHEN e.feature_key IS NULL THEN true ELSE e.allowed IS TRUE END) AND coalesce(f.enabled,c.default_enabled)) $$;
CREATE FUNCTION private.wfm_enabled(_tenant uuid,_key text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p private.wfm_page_catalog%ROWTYPE;k text;
BEGIN
 SELECT * INTO p FROM private.wfm_page_catalog WHERE key=_key;IF NOT FOUND THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.tenant_workspace_page_visibility WHERE tenant_id=_tenant AND page_key=_key AND enabled IS NOT TRUE) THEN RETURN false;END IF;
 FOREACH k IN ARRAY p.parents LOOP IF private.wfm_enabled(_tenant,k) IS DISTINCT FROM true THEN RETURN false;END IF; END LOOP;
 FOREACH k IN ARRAY p.feature_keys LOOP IF private.wfm_feature_enabled(_tenant,k) IS DISTINCT FROM true THEN RETURN false;END IF; END LOOP;
 RETURN true;
END $$;
-- Enabled check is PRIVATE and never grants business/resource authority. Main calls it INSIDE every native producer, including API-principal producers after their own verified subject gate.
CREATE FUNCTION private.wfm_assert_enabled(_tenant uuid,_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('wfm:'||_tenant::text,0));
 IF private.wfm_enabled(_tenant,_key) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.capability_disabled' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION private.wfm_mode_allowed(_tenant uuid,_mode text,_bu uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant);p public.platform_ai_settings%ROWTYPE;t public.tenant_ai_settings%ROWTYPE;cfg jsonb;
BEGIN
 IF private.wfm_enabled(_tenant,'prep') IS DISTINCT FROM true OR public.user_has_permission(actor,_tenant,'data.prep.read',_bu) IS DISTINCT FROM true THEN RETURN false;END IF;
 IF _mode='manual' THEN RETURN true;END IF;
 IF _mode NOT IN('assisted','agentic') THEN RETURN false;END IF;
 SELECT * INTO p FROM public.platform_ai_settings WHERE id=true;IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO t FROM public.tenant_ai_settings WHERE tenant_id=_tenant;IF NOT FOUND THEN RETURN false;END IF;
 SELECT config INTO cfg FROM public.tenant_feature_flags WHERE tenant_id=_tenant AND feature_key='data_prep';
 IF p.ai_enabled IS DISTINCT FROM true OR t.ai_enabled IS DISTINCT FROM true OR cfg->'ai_enabled' IS DISTINCT FROM 'true'::jsonb
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND ai_enabled IS TRUE)
 OR EXISTS(SELECT 1 FROM public.ai_governance_kill_switches WHERE tenant_id=_tenant AND engaged IS TRUE) THEN RETURN false;END IF;
 IF _mode='assisted' THEN RETURN cfg->'assisted_enabled'='true'::jsonb AND p.allow_copilot_global AND t.allow_copilot
 AND private.wfm_feature_enabled(_tenant,'copilot') AND public.user_has_permission(actor,_tenant,'ai.copilot.use',_bu) IS TRUE;END IF;
 RETURN cfg->'agentic_enabled'='true'::jsonb AND p.allow_agent_global AND t.allow_agent AND private.wfm_feature_enabled(_tenant,'agent')
 AND p.default_autonomy_ceiling IN('assist','auto') AND t.default_autonomy IN('supervised','autonomous')
 AND public.user_has_permission(actor,_tenant,'ai.agent.run',_bu) IS TRUE;
END $$;
CREATE FUNCTION private.wfm_record(_tenant uuid,_kind text,_key text,_before jsonb,_after jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();eid uuid;ep bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL THEN RAISE EXCEPTION 'wfm.real_actor_required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wfm:'||_tenant::text,0));
 INSERT INTO private.wfm_epoch(tenant_id,epoch) VALUES(_tenant,1) ON CONFLICT(tenant_id) DO UPDATE SET epoch=wfm_epoch.epoch+1 RETURNING epoch INTO ep;
 INSERT INTO private.wfm_events(tenant_id,actor_id,kind,key,before_value,after_value,epoch) VALUES(_tenant,actor,_kind,_key,_before,_after,ep) RETURNING id INTO eid;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(actor,_tenant,'tenant','workspace.control.change','workspace_controls',eid::text,jsonb_build_object('kind',_kind,'key',_key,'before',_before,'after',_after,'epoch',ep::text));
 INSERT INTO private.wfm_plan_events(plan_id,actor_id,event,control_event_id)
 SELECT id,actor,'cancelled',eid FROM private.wfm_draft_plans p WHERE p.tenant_id=_tenant AND NOT EXISTS(SELECT 1 FROM private.wfm_plan_events e WHERE e.plan_id=p.id AND e.event='cancelled');
 RETURN eid;
END $$;
CREATE FUNCTION private.wfm_toggle_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid;key text;isai boolean:=false;beforev jsonb:='{}';afterv jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'wfm.disable_instead_of_delete' USING ERRCODE='42501';END IF;
 tid:=NEW.tenant_id;
 IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'wfm.identity_immutable' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='tenant_workspace_page_visibility' THEN
  key:=NEW.page_key;IF NOT EXISTS(SELECT 1 FROM private.wfm_page_catalog WHERE wfm_page_catalog.key=NEW.page_key) THEN RAISE EXCEPTION 'wfm.unknown_page' USING ERRCODE='22023';END IF;
  IF TG_OP='UPDATE' AND NEW.page_key IS DISTINCT FROM OLD.page_key THEN RAISE EXCEPTION 'wfm.identity_immutable' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='tenant_workspace_features' THEN
  key:=NEW.feature_key;IF NOT EXISTS(SELECT 1 FROM private.wfm_ux_catalog WHERE wfm_ux_catalog.key=NEW.feature_key) THEN RAISE EXCEPTION 'wfm.unknown_feature' USING ERRCODE='22023';END IF;
  IF TG_OP='UPDATE' AND NEW.feature_key IS DISTINCT FROM OLD.feature_key THEN RAISE EXCEPTION 'wfm.identity_immutable' USING ERRCODE='42501';END IF;
 ELSE
  key:=NEW.feature_key;SELECT category='AI' INTO isai FROM private.wfm_feature_catalog WHERE wfm_feature_catalog.key=NEW.feature_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'wfm.unknown_feature' USING ERRCODE='22023';END IF;
  isai:=isai OR (key='data_prep' AND (TG_OP='INSERT' AND (NEW.config ?| ARRAY['ai_enabled','assisted_enabled','agentic_enabled']) OR TG_OP='UPDATE' AND (NEW.config->'ai_enabled' IS DISTINCT FROM OLD.config->'ai_enabled' OR NEW.config->'assisted_enabled' IS DISTINCT FROM OLD.config->'assisted_enabled' OR NEW.config->'agentic_enabled' IS DISTINCT FROM OLD.config->'agentic_enabled')));
  IF TG_OP='UPDATE' AND NEW.feature_key IS DISTINCT FROM OLD.feature_key THEN RAISE EXCEPTION 'wfm.identity_immutable' USING ERRCODE='42501';END IF;
  IF NEW.enabled IS TRUE AND EXISTS(SELECT 1 FROM public.tenant_feature_entitlements WHERE tenant_id=tid AND feature_key=key AND allowed IS NOT TRUE)
  THEN RAISE EXCEPTION 'wfm.platform_entitlement_denied' USING ERRCODE='42501';END IF;
 END IF;
 IF private.wfm_can_manage(tid,isai) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.admin_permission_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wfm:'||tid::text,0));
 NEW.updated_by:=auth.uid();NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE FUNCTION private.wfm_toggle_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE key text;kind text;beforev jsonb:='{}';afterv jsonb;
BEGIN
 key:=coalesce(to_jsonb(NEW)->>'page_key',to_jsonb(NEW)->>'feature_key');
 kind:=CASE TG_TABLE_NAME WHEN 'tenant_workspace_page_visibility' THEN 'page' WHEN 'tenant_workspace_features' THEN 'workspace-feature' ELSE 'feature' END;
 afterv:=jsonb_build_object('enabled',NEW.enabled);
 IF TG_OP='UPDATE' THEN beforev:=jsonb_build_object('enabled',OLD.enabled);END IF;
 IF TG_TABLE_NAME<>'tenant_workspace_page_visibility' THEN
  afterv:=afterv||jsonb_build_object('config_sha256',encode(sha256(convert_to(coalesce(to_jsonb(NEW)->'config','{}')::text,'UTF8')),'hex'));
  IF key='data_prep' THEN afterv:=afterv||jsonb_build_object('ai_enabled',NEW.config->'ai_enabled','assisted_enabled',NEW.config->'assisted_enabled','agentic_enabled',NEW.config->'agentic_enabled');END IF;
  IF TG_OP='UPDATE' THEN
   beforev:=beforev||jsonb_build_object('config_sha256',encode(sha256(convert_to(coalesce(to_jsonb(OLD)->'config','{}')::text,'UTF8')),'hex'));
   IF key='data_prep' THEN beforev:=beforev||jsonb_build_object('ai_enabled',OLD.config->'ai_enabled','assisted_enabled',OLD.config->'assisted_enabled','agentic_enabled',OLD.config->'agentic_enabled');END IF;
  END IF;
 END IF;
 PERFORM private.wfm_record(NEW.tenant_id,kind,key,beforev,afterv);RETURN NEW;
END $$;
CREATE TRIGGER wfm_page_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_workspace_page_visibility FOR EACH ROW EXECUTE FUNCTION private.wfm_toggle_guard();
CREATE TRIGGER wfm_page_audit AFTER INSERT OR UPDATE ON public.tenant_workspace_page_visibility FOR EACH ROW EXECUTE FUNCTION private.wfm_toggle_audit();
CREATE TRIGGER wfm_feature_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_feature_flags FOR EACH ROW EXECUTE FUNCTION private.wfm_toggle_guard();
CREATE TRIGGER wfm_feature_audit AFTER INSERT OR UPDATE ON public.tenant_feature_flags FOR EACH ROW EXECUTE FUNCTION private.wfm_toggle_audit();
CREATE TRIGGER wfm_ux_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_workspace_features FOR EACH ROW EXECUTE FUNCTION private.wfm_toggle_guard();
CREATE TRIGGER wfm_ux_audit AFTER INSERT OR UPDATE ON public.tenant_workspace_features FOR EACH ROW EXECUTE FUNCTION private.wfm_toggle_audit();

CREATE FUNCTION public.wfm_get_snapshot(_tenant_id uuid,_bu_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);p jsonb;t jsonb;perms jsonb;
BEGIN
 SELECT jsonb_build_object('ai_enabled',ai_enabled,'allow_copilot_global',allow_copilot_global,'allow_agent_global',allow_agent_global,'default_autonomy_ceiling',default_autonomy_ceiling) INTO p FROM public.platform_ai_settings WHERE id=true;
 SELECT jsonb_build_object('ai_enabled',ai_enabled,'allow_copilot',allow_copilot,'allow_agent',allow_agent,'default_autonomy',default_autonomy) INTO t FROM public.tenant_ai_settings WHERE tenant_id=_tenant_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO perms FROM public.permissions WHERE public.user_has_permission(actor,_tenant_id,id,_bu_id) IS TRUE;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'bu_id',_bu_id,'epoch',coalesce((SELECT epoch::text FROM private.wfm_epoch WHERE tenant_id=_tenant_id),'0'),
 'page_enabled',(SELECT jsonb_object_agg(c.key,coalesce(v.enabled,true)) FROM private.wfm_page_catalog c LEFT JOIN public.tenant_workspace_page_visibility v ON v.tenant_id=_tenant_id AND v.page_key=c.key),
 'feature_flags',(SELECT jsonb_object_agg(c.key,jsonb_build_object('enabled',coalesce(f.enabled,c.default_enabled),'config',CASE WHEN c.key='data_prep' THEN jsonb_strip_nulls(jsonb_build_object('ai_enabled',f.config->'ai_enabled','assisted_enabled',f.config->'assisted_enabled','agentic_enabled',f.config->'agentic_enabled')) ELSE '{}'::jsonb END)) FROM private.wfm_feature_catalog c LEFT JOIN public.tenant_feature_flags f ON f.tenant_id=_tenant_id AND f.feature_key=c.key),
 'workspace_features',(SELECT jsonb_object_agg(c.key,coalesce(f.enabled,false)) FROM private.wfm_ux_catalog c LEFT JOIN public.tenant_workspace_features f ON f.tenant_id=_tenant_id AND f.feature_key=c.key),
 'entitlements',(SELECT jsonb_object_agg(c.key,CASE WHEN e.feature_key IS NULL THEN true ELSE e.allowed IS TRUE END) FROM private.wfm_feature_catalog c LEFT JOIN public.tenant_feature_entitlements e ON e.feature_key=c.key AND e.tenant_id=_tenant_id),
 'permission_ids',perms,'platform_ai',p,'tenant_ai',t,'tenant_ai_enabled',coalesce((SELECT ai_enabled FROM public.tenants WHERE id=_tenant_id),false),
 'kill_switch_engaged',EXISTS(SELECT 1 FROM public.ai_governance_kill_switches WHERE tenant_id=_tenant_id AND engaged IS TRUE),'can_manage',private.wfm_can_manage(_tenant_id,false),'can_manage_ai',private.wfm_can_manage(_tenant_id,true));
END $$;
CREATE FUNCTION public.wfm_set_control(_tenant_id uuid,_kind text,_key text,_enabled boolean,_expected_epoch text,_request_key uuid,_bu_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);payload jsonb:=jsonb_build_object('kind',_kind,'key',_key,'enabled',_enabled,'bu_id',_bu_id,'expected_epoch',_expected_epoch);r private.wfm_requests%ROWTYPE;ep bigint;eid uuid;result jsonb;cfg jsonb;
BEGIN
 IF _request_key IS NULL OR _enabled IS NULL OR _expected_epoch IS NULL OR _expected_epoch!~'^(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'wfm.invalid_request' USING ERRCODE='22023';END IF;
 IF private.wfm_can_manage(_tenant_id,_kind='mode' OR (_kind='feature' AND _key IN('copilot','agent','aidp','auto_match_ai','auto_remediation','byo_llm','cost_metering'))) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.admin_permission_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wfm:'||_tenant_id::text,0));
 SELECT * INTO r FROM private.wfm_requests WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF r.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'wfm.request_conflict' USING ERRCODE='PT409';END IF;RETURN r.result;END IF;
 SELECT coalesce((SELECT epoch FROM private.wfm_epoch WHERE tenant_id=_tenant_id),0) INTO ep;
 IF ep::text<>_expected_epoch THEN RAISE EXCEPTION 'wfm.epoch_conflict' USING ERRCODE='PT409';END IF;
 IF _kind='page' THEN
  INSERT INTO public.tenant_workspace_page_visibility(tenant_id,page_key,enabled,updated_by) VALUES(_tenant_id,_key,_enabled,actor) ON CONFLICT(tenant_id,page_key) DO UPDATE SET enabled=EXCLUDED.enabled;
 ELSIF _kind='feature' THEN
  INSERT INTO public.tenant_feature_flags(tenant_id,feature_key,enabled,updated_by) VALUES(_tenant_id,_key,_enabled,actor) ON CONFLICT(tenant_id,feature_key) DO UPDATE SET enabled=EXCLUDED.enabled;
 ELSIF _kind='workspace-feature' THEN
  INSERT INTO public.tenant_workspace_features(tenant_id,feature_key,enabled,updated_by) VALUES(_tenant_id,_key,_enabled,actor) ON CONFLICT(tenant_id,feature_key) DO UPDATE SET enabled=EXCLUDED.enabled;
 ELSIF _kind='mode' AND _key IN('ai_enabled','assisted_enabled','agentic_enabled') THEN
  IF _enabled AND (NOT EXISTS(SELECT 1 FROM public.platform_ai_settings WHERE id=true AND ai_enabled IS TRUE)
   OR NOT EXISTS(SELECT 1 FROM public.tenant_ai_settings WHERE tenant_id=_tenant_id AND ai_enabled IS TRUE)
   OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant_id AND ai_enabled IS TRUE)) THEN RAISE EXCEPTION 'wfm.ai_upper_ceiling_denied' USING ERRCODE='42501';END IF;
  INSERT INTO public.tenant_feature_flags(tenant_id,feature_key,enabled,config,updated_by) VALUES(_tenant_id,'data_prep',true,jsonb_build_object(_key,_enabled),actor)
  ON CONFLICT(tenant_id,feature_key) DO UPDATE SET config=tenant_feature_flags.config||jsonb_build_object(_key,_enabled);
 ELSE RAISE EXCEPTION 'wfm.unknown_control' USING ERRCODE='22023';END IF;
 SELECT epoch INTO ep FROM private.wfm_epoch WHERE tenant_id=_tenant_id;
 SELECT id INTO eid FROM private.wfm_events WHERE tenant_id=_tenant_id AND epoch=ep;
 result:=jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'bu_id',_bu_id,'request_key',_request_key,'epoch',ep::text,'event_id',eid,'changed',true,
 'cancelled_plan_ids',coalesce((SELECT jsonb_agg(plan_id) FROM private.wfm_plan_events WHERE control_event_id=eid),'[]'));
 INSERT INTO private.wfm_requests VALUES(_tenant_id,actor,_request_key,payload,result);RETURN result;
END $$;
CREATE FUNCTION public.wfm_set_pipeline_mode(_tenant_id uuid,_pipeline_id uuid,_mode text,_expected_epoch text,_request_key uuid,_bu_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);beforemode text;ep bigint;eid uuid;r private.wfm_requests%ROWTYPE;payload jsonb;result jsonb;choice jsonb;previous_epoch bigint;
BEGIN
 IF _request_key IS NULL OR _mode IS NULL OR _expected_epoch IS NULL OR _mode NOT IN('manual','assisted','agentic') THEN RAISE EXCEPTION 'wfm.invalid_mode' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wfm:'||_tenant_id::text,0));
 IF private.wfm_mode_allowed(_tenant_id,_mode,_bu_id) IS DISTINCT FROM true OR private.data_prep_pipeline_scope_allows(actor,_tenant_id,_pipeline_id,'edit') IS DISTINCT FROM true
 OR public.user_has_permission(actor,_tenant_id,'data.prep.author',_bu_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.mode_denied' USING ERRCODE='42501';END IF;
 payload:=jsonb_build_object('pipeline_id',_pipeline_id,'mode',_mode,'expected_epoch',_expected_epoch,'bu_id',_bu_id);
 SELECT * INTO r FROM private.wfm_requests WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF r.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'wfm.request_conflict' USING ERRCODE='PT409';END IF;RETURN r.result;END IF;
 SELECT coalesce((SELECT epoch FROM private.wfm_epoch WHERE tenant_id=_tenant_id),0) INTO ep;
 IF ep::text<>_expected_epoch THEN RAISE EXCEPTION 'wfm.epoch_conflict' USING ERRCODE='PT409';END IF;
 previous_epoch:=ep;
 -- Canonical selector owns its immutable choice. The qualified bridge trigger owns the policy-index update and cancellation epoch.
 choice:=public.dpw_set_execution_mode(_tenant_id,_pipeline_id,_mode,true,_request_key);
 SELECT epoch INTO ep FROM private.wfm_epoch WHERE tenant_id=_tenant_id;
 IF ep IS NULL OR ep<=previous_epoch THEN RAISE EXCEPTION 'wfm.request_conflict' USING ERRCODE='PT409';END IF;
 SELECT id INTO eid FROM private.wfm_events WHERE tenant_id=_tenant_id AND epoch=ep AND after_value->>'choice_id'=choice->'choice'->>'id';
 IF eid IS NULL THEN RAISE EXCEPTION 'wfm.mode_choice_unqualified' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'bu_id',_bu_id,'request_key',_request_key,'epoch',ep::text,'event_id',eid,'changed',true,
 'cancelled_plan_ids',coalesce((SELECT jsonb_agg(plan_id) FROM private.wfm_plan_events WHERE control_event_id=eid),'[]'));
 INSERT INTO private.wfm_requests VALUES(_tenant_id,actor,_request_key,payload,result);RETURN result;
END $$;

-- Ordinary authenticated readback, serialized with the exact writer. Absent never means a transport failure.
CREATE FUNCTION public.wfm_get_control_request(_tenant_id uuid,_request_key uuid,_bu_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);r private.wfm_requests%ROWTYPE;ep bigint;
BEGIN
 IF _request_key IS NULL THEN RAISE EXCEPTION 'wfm.invalid_request' USING ERRCODE='22023';END IF;
 IF private.wfm_can_manage(_tenant_id,false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.admin_permission_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('wfm:'||_tenant_id::text,0));
 SELECT * INTO r FROM private.wfm_requests WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND AND (r.result->>'bu_id')::uuid IS DISTINCT FROM _bu_id THEN RAISE EXCEPTION 'wfm.request_scope_denied' USING ERRCODE='42501';END IF;
 SELECT coalesce((SELECT epoch FROM private.wfm_epoch WHERE tenant_id=_tenant_id),0) INTO ep;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'bu_id',_bu_id,'request_key',_request_key,'current_epoch',ep::text,
 'outcome',CASE WHEN r.request_key IS NULL THEN 'absent' ELSE 'recorded' END,'receipt',r.result);
END $$;

-- Dedicated NEW attachment-byte config. Never bind row-purge tables/tenants.run_retention_days or rewrite old records.
CREATE TABLE private.dpw_attachment_retention_defaults(singleton boolean PRIMARY KEY CHECK(singleton),policy_id uuid NOT NULL DEFAULT gen_random_uuid(),version bigint NOT NULL DEFAULT 1 CHECK(version>0),period_days integer NOT NULL DEFAULT 90 CHECK(period_days>0),effective_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO private.dpw_attachment_retention_defaults(singleton) VALUES(true);
CREATE TABLE private.dpw_attachment_retention_overrides(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),policy_id uuid NOT NULL DEFAULT gen_random_uuid(),version bigint NOT NULL CHECK(version>0),period_days integer CHECK(period_days>0),effective_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE private.dpw_attachment_retention_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.tenants(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_key uuid NOT NULL,payload jsonb NOT NULL,before_value jsonb NOT NULL,after_value jsonb NOT NULL);
CREATE UNIQUE INDEX dpw_retention_request_once ON private.dpw_attachment_retention_events(coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid),actor_id,request_key);
CREATE TRIGGER dpw_retention_events_immutable BEFORE UPDATE OR DELETE ON private.dpw_attachment_retention_events FOR EACH ROW EXECUTE FUNCTION private.wfm_immutable();
-- Concrete platform MFA predicate against both hash-verified current captures. No Data Prep, AI feature or inferred managed account row is consulted.
-- New bridge only; existing auth/Recovery routine bodies, roles and factors stay unchanged.
-- Consumed real PG17.6 definitions/columns from same-write captures:
-- PROD07289fb475e1004b50959a2373611237c9ff96d8dd4ee5351ace08528928bbfd
-- DEV317955c80d2ae2d903ca807f7f53df860c01d7bf0136d37f97fc62e3a3796831
CREATE OR REPLACE FUNCTION private.wfm_platform_factor_attest()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $platform_factor$
DECLARE actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); expires numeric;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
 OR claims->>'aal' IS DISTINCT FROM 'aal2'
 OR jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number'
 OR public.is_platform_admin(actor) IS DISTINCT FROM true
 OR private.rlnext_account_allowed(actor,NULL) IS DISTINCT FROM true
 OR private.rlnext_has_verified_mfa(actor) IS DISTINCT FROM true
 THEN RETURN false; END IF;
 expires:=(claims->>'exp')::numeric;
 IF expires<=extract(epoch FROM clock_timestamp()) THEN RETURN false; END IF;
 -- The native account helper intentionally tolerates unmanaged owners. Their
 -- current real user/factor is checked without creating a fictional account row.
 RETURN EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()));
END $platform_factor$;
REVOKE ALL ON FUNCTION private.wfm_platform_factor_attest() FROM PUBLIC,anon,authenticated,service_role;
-- Called by qualified SECURITY DEFINER wrappers, not as a standalone business API.

CREATE FUNCTION private.wfm_platform_actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();
BEGIN IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated' OR public.rlnext_actor_allowed() IS DISTINCT FROM true
 OR public.is_platform_admin(actor) IS DISTINCT FROM true OR private.wfm_platform_factor_attest() IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.platform_actor_denied' USING ERRCODE='42501';END IF;RETURN actor;END $$;
CREATE FUNCTION public.dpw_get_attachment_retention(_tenant_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;p jsonb;t jsonb;cv text:='0';canwrite boolean;
BEGIN
 IF _tenant_id IS NULL THEN actor:=private.wfm_platform_actor();canwrite:=true;
 ELSE actor:=private.wfm_actor(_tenant_id);canwrite:=private.wfm_can_manage(_tenant_id,false) AND public.user_has_permission(actor,_tenant_id,'compliance.retention.manage',NULL) IS TRUE;END IF;
 SELECT jsonb_build_object('policy_id',policy_id,'version',version::text,'period_days',period_days,'source','platform','effective_at',effective_at) INTO p FROM private.dpw_attachment_retention_defaults WHERE singleton=true;
 IF p IS NULL THEN RAISE EXCEPTION 'dpw.retention_default_unqualified' USING ERRCODE='42501';END IF;
 IF _tenant_id IS NOT NULL THEN
  SELECT version::text,CASE WHEN period_days IS NULL THEN NULL ELSE jsonb_build_object('policy_id',policy_id,'version',version::text,'period_days',period_days,'source','tenant','effective_at',effective_at) END INTO cv,t FROM private.dpw_attachment_retention_overrides WHERE tenant_id=_tenant_id;
 ELSE cv:=p->>'version';END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'platform',p,'override',t,'effective',CASE WHEN t IS NOT NULL AND (t->>'period_days')::integer>=(p->>'period_days')::integer THEN t ELSE p END,'control_version',coalesce(cv,'0'),'can_write',canwrite);
END $$;
CREATE FUNCTION public.dpw_set_attachment_retention(_tenant_id uuid,_period_days integer,_expected_version text,_request_key uuid,_effect text,_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;oldv jsonb;newv jsonb;cv text;payload jsonb;prior private.dpw_attachment_retention_events%ROWTYPE;eid uuid;
BEGIN
 IF _request_key IS NULL OR _expected_version IS NULL OR _effect IS DISTINCT FROM 'new_scoped_attachments' OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 500
 OR _period_days<=0 OR (_tenant_id IS NULL AND _period_days IS NULL) THEN RAISE EXCEPTION 'dpw.invalid_retention_parameter' USING ERRCODE='22023';END IF;
 IF _tenant_id IS NULL THEN actor:=private.wfm_platform_actor();
 ELSE actor:=private.wfm_actor(_tenant_id);IF private.wfm_can_manage(_tenant_id,false) IS DISTINCT FROM true OR public.user_has_permission(actor,_tenant_id,'compliance.retention.manage',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.retention_authority_denied' USING ERRCODE='42501';END IF;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dpw_attachment_retention:platform',0));
 payload:=jsonb_build_object('tenant_id',_tenant_id,'period_days',_period_days,'expected_version',_expected_version,'effect',_effect,'reason',_reason);
 SELECT * INTO prior FROM private.dpw_attachment_retention_events WHERE tenant_id IS NOT DISTINCT FROM _tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'dpw.retention_request_conflict' USING ERRCODE='PT409';END IF;RETURN public.dpw_get_attachment_retention(_tenant_id);END IF;
 IF _tenant_id IS NOT NULL AND _period_days IS NOT NULL AND _period_days<(SELECT period_days FROM private.dpw_attachment_retention_defaults WHERE singleton=true) THEN RAISE EXCEPTION 'dpw.tenant_retention_below_platform_default' USING ERRCODE='22023';END IF;
 oldv:=public.dpw_get_attachment_retention(_tenant_id);cv:=oldv->>'control_version';
 IF cv<>_expected_version THEN RAISE EXCEPTION 'dpw.retention_version_conflict' USING ERRCODE='PT409';END IF;
 IF _tenant_id IS NULL THEN UPDATE private.dpw_attachment_retention_defaults SET version=version+1,period_days=_period_days,effective_at=clock_timestamp() WHERE singleton=true;
 ELSE INSERT INTO private.dpw_attachment_retention_overrides(tenant_id,version,period_days) VALUES(_tenant_id,1,_period_days) ON CONFLICT(tenant_id) DO UPDATE SET version=dpw_attachment_retention_overrides.version+1,period_days=EXCLUDED.period_days,effective_at=clock_timestamp();END IF;
 newv:=public.dpw_get_attachment_retention(_tenant_id);
 INSERT INTO private.dpw_attachment_retention_events(tenant_id,actor_id,request_key,payload,before_value,after_value) VALUES(_tenant_id,actor,_request_key,payload,oldv,newv) RETURNING id INTO eid;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(actor,_tenant_id,CASE WHEN _tenant_id IS NULL THEN 'platform' ELSE 'tenant' END,'dataprep.attachment_retention.change','attachment_byte_policy',eid::text,
 jsonb_build_object('before',oldv,'after',newv,'effect',_effect,'physical_purge_enabled',false));
 RETURN newv;
END $$;

CREATE FUNCTION public.wfm_save_draft_plan(_tenant_id uuid,_pipeline_id uuid,_mode text,_epoch text,_draft jsonb,_request_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);p private.wfm_draft_plans%ROWTYPE;ep bigint;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('wfm:'||_tenant_id::text,0));
 IF _mode IS NULL OR _mode NOT IN('assisted','agentic') OR _request_key IS NULL OR _epoch IS NULL
 OR jsonb_typeof(_draft) IS DISTINCT FROM 'object' OR jsonb_typeof(_draft->'proposals') IS DISTINCT FROM 'array' OR jsonb_array_length(_draft->'proposals') NOT BETWEEN 1 AND 100
 OR _draft->>'draft_sha256' IS NULL OR _draft->>'draft_sha256'!~'^[a-f0-9]{64}$'
 OR _draft->>'configuration_version' IS NULL OR _draft->>'configuration_version'!~'^[1-9][0-9]{0,8}$'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_draft) k WHERE k NOT IN('proposals','draft_sha256','configuration_version'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(_draft->'proposals') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->>'key' IS NULL OR length(a->>'key') NOT BETWEEN 1 AND 120
 OR a->>'action' IS NULL OR a->>'action' NOT IN('draft_map','draft_transform','draft_dq','sandbox_test','sandbox_self_repair') OR (_mode='assisted' AND a->>'action'='sandbox_self_repair')
 OR a->>'content_sha256' IS NULL OR a->>'content_sha256'!~'^[a-f0-9]{64}$')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(_draft->'proposals') a CROSS JOIN LATERAL jsonb_object_keys(a) k WHERE k NOT IN('key','action','content_sha256'))
 OR (SELECT count(*) FROM jsonb_array_elements(_draft->'proposals'))<>(SELECT count(DISTINCT a->>'key') FROM jsonb_array_elements(_draft->'proposals') a)
 THEN RAISE EXCEPTION 'wfm.invalid_draft_plan' USING ERRCODE='22023';END IF;
 IF private.wfm_mode_allowed(_tenant_id,_mode,NULL) IS DISTINCT FROM true OR public.user_has_permission(actor,_tenant_id,'data.prep.author',NULL) IS DISTINCT FROM true
 OR private.data_prep_pipeline_scope_allows(actor,_tenant_id,_pipeline_id,'edit') IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM public.data_prep_pipelines WHERE id=_pipeline_id AND tenant_id=_tenant_id AND version=(_draft->>'configuration_version')::integer)
 OR coalesce((SELECT mode FROM private.wfm_pipeline_modes WHERE tenant_id=_tenant_id AND pipeline_id=_pipeline_id),'manual')<>_mode THEN RAISE EXCEPTION 'wfm.draft_plan_denied' USING ERRCODE='42501';END IF;
 SELECT coalesce((SELECT epoch FROM private.wfm_epoch WHERE tenant_id=_tenant_id),0) INTO ep;
 IF ep::text<>_epoch THEN RAISE EXCEPTION 'wfm.epoch_conflict' USING ERRCODE='PT409';END IF;
 SELECT * INTO p FROM private.wfm_draft_plans WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN IF p.draft IS DISTINCT FROM _draft OR p.pipeline_id IS DISTINCT FROM _pipeline_id OR p.mode IS DISTINCT FROM _mode THEN RAISE EXCEPTION 'wfm.request_conflict' USING ERRCODE='PT409';END IF;
 ELSE INSERT INTO private.wfm_draft_plans(tenant_id,pipeline_id,actor_id,mode,epoch,request_key,draft) VALUES(_tenant_id,_pipeline_id,actor,_mode,ep,_request_key,_draft) RETURNING * INTO p;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','dataprep.draft_plan.created','draft_plan',p.id::text,jsonb_build_object('mode',_mode,'epoch',ep::text,'draft_sha256',encode(sha256(convert_to(_draft::text,'UTF8')),'hex')));END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'plan_id',p.id,'epoch',ep::text,'draft_only',true);
END $$;
CREATE FUNCTION public.wfm_decide_proposal(_tenant_id uuid,_pipeline_id uuid,_plan_id uuid,_proposal_key text,_accept boolean,_epoch text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);p private.wfm_draft_plans%ROWTYPE;e private.wfm_plan_events%ROWTYPE;ep bigint;decision text:=CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('wfm:'||_tenant_id::text,0));
 SELECT * INTO p FROM private.wfm_draft_plans WHERE id=_plan_id AND tenant_id=_tenant_id AND pipeline_id=_pipeline_id FOR UPDATE;
 IF NOT FOUND OR _accept IS NULL OR _epoch IS NULL OR private.wfm_mode_allowed(_tenant_id,p.mode,NULL) IS DISTINCT FROM true
 OR public.user_has_permission(actor,_tenant_id,'data.prep.author',NULL) IS DISTINCT FROM true OR private.data_prep_pipeline_scope_allows(actor,_tenant_id,_pipeline_id,'edit') IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.draft->'proposals') a WHERE a->>'key'=_proposal_key)
 OR EXISTS(SELECT 1 FROM private.wfm_plan_events WHERE plan_id=_plan_id AND event='cancelled') THEN RAISE EXCEPTION 'wfm.proposal_denied' USING ERRCODE='42501';END IF;
 SELECT coalesce((SELECT epoch FROM private.wfm_epoch WHERE tenant_id=_tenant_id),0) INTO ep;
 IF ep::text<>_epoch OR p.epoch<>ep THEN RAISE EXCEPTION 'wfm.epoch_conflict' USING ERRCODE='PT409';END IF;
 SELECT * INTO e FROM private.wfm_plan_events WHERE plan_id=_plan_id AND proposal_key=_proposal_key AND event IN('accepted','rejected');
 IF FOUND THEN IF e.event<>decision OR e.actor_id<>actor THEN RAISE EXCEPTION 'wfm.decision_immutable' USING ERRCODE='PT409';END IF;
 ELSE INSERT INTO private.wfm_plan_events(plan_id,actor_id,event,proposal_key) VALUES(_plan_id,actor,decision,_proposal_key) RETURNING * INTO e;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','dataprep.proposal.decision','draft_plan',_plan_id::text,jsonb_build_object('proposal_key',_proposal_key,'decision',decision,'epoch',ep::text,'publication_authorized',false));END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'event_id',e.id,'decision',decision,'draft_only',true,'publication_authorized',false);
END $$;
-- Upper-ceiling changes also invalidate every pending plan. Their existing authority is preserved and strengthened by lifecycle/current-factor qualification.
CREATE FUNCTION private.wfm_upper_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tid uuid;actor uuid;beforev jsonb;afterv jsonb;r record;key text:=TG_TABLE_NAME;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'wfm.disable_instead_of_delete' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='platform_ai_settings' THEN actor:=private.wfm_platform_actor();
  beforev:=CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('ai_enabled',OLD.ai_enabled,'allow_copilot_global',OLD.allow_copilot_global,'allow_agent_global',OLD.allow_agent_global,'ceiling',OLD.default_autonomy_ceiling) ELSE '{}'::jsonb END;
  afterv:=jsonb_build_object('ai_enabled',NEW.ai_enabled,'allow_copilot_global',NEW.allow_copilot_global,'allow_agent_global',NEW.allow_agent_global,'ceiling',NEW.default_autonomy_ceiling);
  IF beforev IS DISTINCT FROM afterv THEN
   INSERT INTO private.wfm_global_events(actor_id,key,before_value,after_value) VALUES(actor,key,beforev,afterv);
   INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,NULL,'platform','workspace.control.change','workspace_controls','platform_ai_settings',jsonb_build_object('kind','platform-ceiling','key',key,'before',beforev,'after',afterv));
   FOR r IN SELECT id FROM public.tenants LOOP PERFORM private.wfm_record(r.id,'platform-ceiling',key,beforev,afterv);END LOOP;END IF;
 ELSE
  tid:=NEW.tenant_id;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'wfm.identity_immutable' USING ERRCODE='42501';END IF;
  IF TG_TABLE_NAME='tenant_feature_entitlements' THEN actor:=private.wfm_platform_actor();beforev:=CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('allowed',OLD.allowed) ELSE '{}'::jsonb END;afterv:=jsonb_build_object('allowed',NEW.allowed);key:=NEW.feature_key;
  ELSE actor:=private.wfm_actor(tid);IF private.wfm_can_manage(tid,true) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.admin_permission_denied' USING ERRCODE='42501';END IF;
   beforev:=CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('ai_enabled',OLD.ai_enabled,'allow_copilot',OLD.allow_copilot,'allow_agent',OLD.allow_agent,'ceiling',OLD.default_autonomy) ELSE '{}'::jsonb END;
   afterv:=jsonb_build_object('ai_enabled',NEW.ai_enabled,'allow_copilot',NEW.allow_copilot,'allow_agent',NEW.allow_agent,'ceiling',NEW.default_autonomy);END IF;
  IF beforev IS DISTINCT FROM afterv THEN PERFORM private.wfm_record(tid,'upper-ceiling',key,beforev,afterv);END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wfm_platform_ceiling AFTER INSERT OR UPDATE OR DELETE ON public.platform_ai_settings FOR EACH ROW EXECUTE FUNCTION private.wfm_upper_change();
CREATE TRIGGER wfm_entitlement_ceiling AFTER INSERT OR UPDATE OR DELETE ON public.tenant_feature_entitlements FOR EACH ROW EXECUTE FUNCTION private.wfm_upper_change();
CREATE TRIGGER wfm_tenant_ai_ceiling AFTER INSERT OR UPDATE OR DELETE ON public.tenant_ai_settings FOR EACH ROW EXECUTE FUNCTION private.wfm_upper_change();
CREATE FUNCTION private.wfm_tenant_ai_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF NEW.ai_enabled IS DISTINCT FROM OLD.ai_enabled THEN
 IF private.wfm_can_manage(NEW.id,true) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.admin_permission_denied' USING ERRCODE='42501';END IF;
 PERFORM private.wfm_record(NEW.id,'tenant-ai','ai_enabled',jsonb_build_object('enabled',OLD.ai_enabled),jsonb_build_object('enabled',NEW.ai_enabled));END IF;RETURN NEW;END $$;
CREATE TRIGGER wfm_tenant_master_ai AFTER UPDATE OF ai_enabled ON public.tenants FOR EACH ROW EXECUTE FUNCTION private.wfm_tenant_ai_change();
CREATE FUNCTION private.wfm_kill_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'wfm.disable_instead_of_delete' USING ERRCODE='42501';END IF;
 IF private.wfm_can_manage(NEW.tenant_id,true) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.admin_permission_denied' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.scope IS DISTINCT FROM OLD.scope) THEN RAISE EXCEPTION 'wfm.identity_immutable' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' OR NEW.engaged IS DISTINCT FROM OLD.engaged THEN PERFORM private.wfm_record(NEW.tenant_id,'ai-kill-switch',NEW.scope,
 CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('engaged',OLD.engaged) ELSE '{}'::jsonb END,jsonb_build_object('engaged',NEW.engaged));END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wfm_kill_ceiling AFTER INSERT OR UPDATE OR DELETE ON public.ai_governance_kill_switches FOR EACH ROW EXECUTE FUNCTION private.wfm_kill_change();

-- New private objects only; existing ACLs/roles/policies/bodies untouched by this proposal.
REVOKE ALL ON private.wfm_page_catalog,private.wfm_feature_catalog,private.wfm_ux_catalog,private.wfm_epoch,private.wfm_events,private.wfm_global_events,private.wfm_requests,private.wfm_pipeline_modes,private.wfm_draft_plans,private.wfm_plan_events,private.dpw_attachment_retention_defaults,private.dpw_attachment_retention_overrides,private.dpw_attachment_retention_events FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (p.proname LIKE 'wfm_%' OR p.proname='dpw_attachment_retention_events') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.wfm_get_snapshot(uuid,uuid),public.wfm_set_control(uuid,text,text,boolean,text,uuid,uuid),public.wfm_set_pipeline_mode(uuid,uuid,text,text,uuid,uuid),public.dpw_get_attachment_retention(uuid),public.dpw_set_attachment_retention(uuid,integer,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wfm_get_snapshot(uuid,uuid),public.wfm_set_control(uuid,text,text,boolean,text,uuid,uuid),public.wfm_set_pipeline_mode(uuid,uuid,text,text,uuid,uuid),public.dpw_get_attachment_retention(uuid),public.dpw_set_attachment_retention(uuid,integer,text,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.wfm_get_control_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wfm_get_control_request(uuid,uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.wfm_save_draft_plan(uuid,uuid,text,text,jsonb,uuid),public.wfm_decide_proposal(uuid,uuid,uuid,text,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wfm_save_draft_plan(uuid,uuid,text,text,jsonb,uuid),public.wfm_decide_proposal(uuid,uuid,uuid,text,boolean,text) TO authenticated;


-- FROZEN INPUT QUALIFIED-PRODUCER-BRIDGES.sql SHA256 7994b6d23c307a8f991a8d9a7ef8bd0c44450409905ca9fd7b1980e737b574a7
-- Install AFTER frozen Curie governance producer. Existing native helpers are
-- not changed; only this packet's NEW bridge functions are replaced.
CREATE OR REPLACE FUNCTION private.dpw_workspace_feature_attest(_actor uuid,_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant,'prep');
 RETURN private.rlnext_account_allowed(_actor,NULL) IS TRUE AND private.rlnext_account_allowed(_actor,_tenant) IS TRUE
 AND public.user_has_permission(_actor,_tenant,'data.prep.read',NULL) IS TRUE;
END $$;
CREATE OR REPLACE FUNCTION private.dpw_recon_feature_attest(_actor uuid,_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant,'recons');
 RETURN public.user_has_permission(_actor,_tenant,'recon.definition.read',NULL) IS TRUE;
END $$;
CREATE OR REPLACE FUNCTION private.dpw_effective_attachment_policy(_tenant uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p private.dpw_attachment_retention_defaults%ROWTYPE;t private.dpw_attachment_retention_overrides%ROWTYPE;
BEGIN
 SELECT * INTO p FROM private.dpw_attachment_retention_defaults WHERE singleton=true;
 IF NOT FOUND OR p.period_days<=0 THEN RAISE EXCEPTION 'dpw.retention_default_missing';END IF;
 SELECT * INTO t FROM private.dpw_attachment_retention_overrides WHERE tenant_id=_tenant;
 RETURN jsonb_build_object('policy_id',CASE WHEN t.period_days IS NOT NULL AND t.period_days>=p.period_days THEN t.policy_id ELSE p.policy_id END,
 'version',CASE WHEN t.period_days IS NOT NULL AND t.period_days>=p.period_days THEN t.version::text ELSE p.version::text END,
 'source',CASE WHEN t.period_days IS NOT NULL AND t.period_days>=p.period_days THEN 'tenant' ELSE 'platform' END,
 'period_days',greatest(p.period_days,coalesce(t.period_days,p.period_days)),
 'platform_version',p.version::text,'tenant_override_version',t.version::text,
 'effective_at',greatest(p.effective_at,coalesce(t.effective_at,p.effective_at)));
END $$;
CREATE OR REPLACE FUNCTION private.dpw_legal_hold_attest(_actor uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.rlnext_account_allowed(_actor,NULL) IS TRUE AND private.rlnext_account_allowed(_actor,_tenant) IS TRUE
 AND (public.is_platform_admin(_actor) IS TRUE OR public.has_tenant_role(_actor,_tenant,'tenant_admin') IS TRUE)
 AND public.user_has_permission(_actor,_tenant,'tenant.settings.update',NULL) IS TRUE
 AND public.user_has_permission(_actor,_tenant,'compliance.retention.manage',NULL) IS TRUE
$$;
CREATE FUNCTION private.dpw_attachment_has_canonical_reference(_file uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.data_prep_delivery_files f,public.recon_definitions d,jsonb_array_elements(d.sides) side
 WHERE f.id=_file AND d.tenant_id=f.tenant_id AND side.value->>'upload_id'=f.upload_id::text)
 OR EXISTS(SELECT 1 FROM public.data_prep_delivery_files f,public.recon_runs r,jsonb_array_elements(coalesce(r.definition_snapshot->'sides','[]'::jsonb)) side
 WHERE f.id=_file AND r.tenant_id=f.tenant_id AND side.value->>'upload_id'=f.upload_id::text)
 OR EXISTS(SELECT 1 FROM public.data_prep_run_inputs i JOIN public.data_prep_recon_run_inputs r ON r.preparation_run_id=i.run_id WHERE i.file_id=_file)
$$;
DO $$DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='private' AND p.proname IN('wfm_actor','wfm_platform_factor_attest','dpw_workspace_feature_attest','dpw_recon_feature_attest','dpw_mode_attest',
 'dpw_effective_attachment_policy','dpw_legal_hold_attest','dpw_retention_attest','dpw_attachment_has_canonical_reference') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.sig);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);END LOOP;END$$;


-- FROZEN INPUT RECON-ATOMIC-DEPENDENCY.sql SHA256 ef8dbccc9d3a2d9073f63a07b49a3b0ff0b5db516c2c24a81d0a8a28e7a9d561
-- Additive purpose RPC. Existing helpers, rows, table grants and RLS are unchanged.
-- Install only with the environment-specific consumed-contract guard and the
-- paired458751 caller successor. Parent registers/stamps the migration version.
CREATE FUNCTION private.recon_atomic_admit(_tenant uuid, _run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth SET row_security=on AS $atomic_admit$
DECLARE r public.recon_runs%ROWTYPE; d public.recon_definitions%ROWTYPE;
  v public.recon_definition_approved_versions%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Authenticated reconciliation actor required' USING ERRCODE='42501';
  END IF;
  IF NOT (private.rlnext_account_allowed(actor,NULL) AND private.rlnext_account_allowed(actor,_tenant)) THEN
    RAISE EXCEPTION 'Current reconciliation account lifecycle denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant;
  IF NOT FOUND OR r.run_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Owned reconciliation run unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_members
      WHERE tenant_id=_tenant AND user_id=actor AND active=true) THEN
    RAISE EXCEPTION 'Active reconciliation membership required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO d FROM public.recon_definitions WHERE id=r.definition_id AND tenant_id=_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation scope unavailable' USING ERRCODE='42501'; END IF;
  IF d.access_mode='legacy_passthrough' THEN
    IF NOT(public.has_tenant_role(actor,_tenant,'tenant_admin'::public.tenant_role)
       OR public.has_tenant_role(actor,_tenant,'tenant_analyst'::public.tenant_role)) THEN
      RAISE EXCEPTION 'Current reconciliation writer access required' USING ERRCODE='42501';
    END IF;
  ELSIF d.access_mode='mapped_exact' AND d.governance_state<>'legacy_mapped' THEN
    PERFORM private.mapped_recon_governance_run(r);
  ELSE
    IF NOT public.recon_authoritative_access_decision(d.id,'run') THEN
      RAISE EXCEPTION 'Current reconciliation run access required' USING ERRCODE='42501';
    END IF;
  END IF;
  -- Retain the selected caller's production-approved administrator admission.
  IF d.governance_state='approved_locked' AND d.environment='production'
     AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant
       AND user_id=actor AND active=true AND role='tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Active production administrator required' USING ERRCODE='42501';
  END IF;
  -- Delegate current approval integrity, configuration hash and independent
  -- runner checks to the exact existing authoritative helper, without new grants.
  v:=private.recon_run_bound_approved_version(_tenant,d.id,actor);
  IF r.approved_revision_id IS DISTINCT FROM v.id
     OR r.approved_revision_number IS DISTINCT FROM v.version_number
     OR r.approved_revision_sha256 IS DISTINCT FROM v.snapshot_sha256 THEN
    RAISE EXCEPTION 'Approved reconciliation binding changed' USING ERRCODE='PT409';
  END IF;
  IF v.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.recon_definition_run_version_snapshots s
      WHERE s.recon_run_id=r.id AND s.tenant_id=_tenant AND s.recon_definition_id=d.id
        AND s.approved_version_number=v.version_number AND s.approved_snapshot_sha256=v.snapshot_sha256
        AND s.approved_request_id=v.request_id AND s.approved_by=v.approved_by) THEN
    RAISE EXCEPTION 'Approved run audit binding differs from current approval' USING ERRCODE='23514';
  END IF;
END $atomic_admit$;

CREATE FUNCTION private.recon_atomic_self_notification(_tenant uuid, _run uuid, _commit uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth SET row_security=on AS $atomic_notify$
DECLARE r public.recon_runs%ROWTYPE; marker jsonb; nid uuid; actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Authenticated notification actor required' USING ERRCODE='42501';
  END IF;
  PERFORM private.recon_atomic_admit(_tenant,_run);
  SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND run_by=actor;
  marker:=r.stats->'_atomic_completion';
  IF NOT FOUND OR r.status<>'completed' OR marker->>'commit_id' IS DISTINCT FROM _commit::text
     OR NOT EXISTS(SELECT 1 FROM public.audit_log WHERE id=(marker->>'audit_id')::bigint
        AND actor_user_id=actor AND tenant_id=_tenant AND scope='workspace'
        AND action='recon.run.complete' AND resource_type='recon_run'
        AND resource_id=_run::text AND context->>'commit_id'=_commit::text) THEN
    RAISE EXCEPTION 'Committed owned run audit required for self notification' USING ERRCODE='42501';
  END IF;
  IF marker->>'notification_id' IS NOT NULL THEN
    SELECT id INTO nid FROM public.notifications WHERE id=(marker->>'notification_id')::uuid
      AND user_id=actor AND tenant_id=_tenant AND context->>'commit_id'=_commit::text;
    IF NOT FOUND THEN RAISE EXCEPTION 'Notification receipt unavailable' USING ERRCODE='PT409'; END IF;
    RETURN nid;
  END IF;
  -- A caller cannot select another recipient, tenant, title or arbitrary payload.
  -- This narrow writer replaces the old broad service-role client, not a policy.
  INSERT INTO public.notifications(user_id,tenant_id,kind,severity,title,body,context)
  VALUES(actor,_tenant,'recon.completed',CASE WHEN r.exception_count>0 THEN 'warning' ELSE 'success' END,
    left(COALESCE(r.definition_snapshot->>'name','Reconciliation')||' — '||r.matched_count::text
      ||' matched, '||r.exception_count::text||' exceptions',512),
    r.total_rows::text||' rows processed',jsonb_build_object('recon_run_id',_run,'commit_id',_commit))
  RETURNING id INTO nid;
  RETURN nid;
END $atomic_notify$;

CREATE FUNCTION public.complete_recon_run_atomic(
  _tenant_id uuid,_run_id uuid,_commit_id uuid,_expected_definition_snapshot jsonb,
  _expected_approved_revision_id uuid,_expected_approved_revision_number integer,
  _expected_approved_revision_sha256 text,_matches jsonb,_exceptions jsonb,_stats jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,private,auth SET row_security=on AS $atomic_complete$
DECLARE r public.recon_runs%ROWTYPE; d public.recon_definitions%ROWTYPE;
  actor uuid:=auth.uid(); definition uuid; marker jsonb; digest text;
  matches integer; exceptions integer; total integer; matched_records bigint;
  actual_matched_records bigint:=0; m jsonb; member jsonb; member_row jsonb;
  expected_sides text[]; member_sides text[]; audit_id bigint; nid uuid; changed integer;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
     OR _tenant_id IS NULL OR _run_id IS NULL OR _commit_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated owned reconciliation commit required' USING ERRCODE='42501';
  END IF;
  IF _matches IS NULL OR jsonb_typeof(_matches)<>'array'
     OR _exceptions IS NULL OR jsonb_typeof(_exceptions)<>'array'
     OR _stats IS NULL OR jsonb_typeof(_stats)<>'object' OR _stats ? '_atomic_completion'
     OR _expected_definition_snapshot IS NULL OR jsonb_typeof(_expected_definition_snapshot)<>'object'
     OR jsonb_typeof(_stats->'total_rows') IS DISTINCT FROM 'number'
     OR jsonb_typeof(_stats->'matched_records') IS DISTINCT FROM 'number'
     OR jsonb_typeof(_stats->'exception_count') IS DISTINCT FROM 'number'
     OR (_stats->>'total_rows') !~ '^[0-9]+$'
     OR (_stats->>'matched_records') !~ '^[0-9]+$'
     OR (_stats->>'exception_count') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Complete reconciliation result arrays and counts required' USING ERRCODE='22023';
  END IF;
  matches:=jsonb_array_length(_matches);exceptions:=jsonb_array_length(_exceptions);
  total:=(_stats->>'total_rows')::integer;matched_records:=(_stats->>'matched_records')::bigint;
  IF (_stats->>'exception_count')::bigint<>exceptions OR matched_records>total THEN
    RAISE EXCEPTION 'Reconciliation result totals disagree' USING ERRCODE='22023';
  END IF;
  -- Read under current invoker RLS, then use definition-before-run lock order.
  SELECT definition_id INTO definition FROM public.recon_runs
    WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned visible run required' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.recon_definitions WHERE id=definition AND tenant_id=_tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visible reconciliation configuration required' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current run update access required' USING ERRCODE='42501'; END IF;
  PERFORM private.recon_atomic_admit(_tenant_id,_run_id);
  IF r.definition_id IS DISTINCT FROM definition
     OR r.definition_snapshot IS DISTINCT FROM _expected_definition_snapshot
     OR r.approved_revision_id IS DISTINCT FROM _expected_approved_revision_id
     OR r.approved_revision_number IS DISTINCT FROM _expected_approved_revision_number
     OR r.approved_revision_sha256 IS DISTINCT FROM _expected_approved_revision_sha256
     OR d.recon_type IS DISTINCT FROM r.definition_snapshot->>'recon_type'
     OR d.sides IS DISTINCT FROM r.definition_snapshot->'sides'
     OR d.rules IS DISTINCT FROM r.definition_snapshot->'rules' THEN
    RAISE EXCEPTION 'Immutable execution configuration changed' USING ERRCODE='PT409';
  END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('tenant',_tenant_id,'run',_run_id,
    'snapshot',_expected_definition_snapshot,'revision_id',_expected_approved_revision_id,
    'revision_number',_expected_approved_revision_number,'revision_sha256',_expected_approved_revision_sha256,
    'matches',_matches,'exceptions',_exceptions,'stats',_stats)::text,'UTF8')),'hex');
  marker:=r.stats->'_atomic_completion';
  IF r.status='completed' THEN
    IF marker->>'commit_id' IS DISTINCT FROM _commit_id::text OR marker->>'result_sha256' IS DISTINCT FROM digest
       OR marker->>'audit_id' IS NULL OR marker->>'notification_id' IS NULL
       OR r.matched_count<>matches OR r.exception_count<>exceptions OR r.total_rows<>total THEN
      RAISE EXCEPTION 'Completed reconciliation commit conflicts' USING ERRCODE='PT409';
    END IF;
    RETURN marker||jsonb_build_object('status','completed','run_id',r.id,'tenant_id',r.tenant_id,
      'definition_id',r.definition_id,'matched_count',r.matched_count,'exception_count',r.exception_count,'total_rows',r.total_rows);
  END IF;
  IF r.status<>'running' OR EXISTS(SELECT 1 FROM public.recon_matches WHERE run_id=r.id)
     OR EXISTS(SELECT 1 FROM public.recon_exceptions WHERE run_id=r.id)
     OR EXISTS(SELECT 1 FROM public.recon_definition_run_version_snapshots s
       WHERE s.recon_run_id=r.id AND (s.tenant_id<>r.tenant_id OR s.recon_definition_id<>r.definition_id)) THEN
    RAISE EXCEPTION 'Run is not a clean current atomic execution' USING ERRCODE='PT409';
  END IF;
  IF r.approved_revision_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.recon_definition_run_version_snapshots s WHERE s.recon_run_id=r.id
        AND s.tenant_id=r.tenant_id AND s.recon_definition_id=r.definition_id
        AND s.approved_version_number=r.approved_revision_number
        AND s.approved_snapshot_sha256=r.approved_revision_sha256) THEN
    RAISE EXCEPTION 'Immutable run approval audit binding unavailable' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(s->>'side_id' ORDER BY s->>'side_id') INTO expected_sides
    FROM jsonb_array_elements(r.definition_snapshot->'sides') s;
  IF expected_sides IS NULL OR cardinality(expected_sides) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Configured reconciliation sides unavailable' USING ERRCODE='23514';
  END IF;
  -- Source visibility is re-evaluated under current RLS at commit time.
  FOR m IN SELECT value FROM jsonb_array_elements(r.definition_snapshot->'sides') LOOP
    PERFORM 1 FROM public.workspace_data_sources WHERE id=(m->>'data_source_id')::uuid AND tenant_id=_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current source access required' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR m IN SELECT value FROM jsonb_array_elements(_matches) LOOP
    IF jsonb_typeof(m)<>'object' OR jsonb_typeof(m->'members') IS DISTINCT FROM 'object'
       OR jsonb_typeof(m->'cardinality') IS DISTINCT FROM 'string'
       OR (m ? 'score' AND jsonb_typeof(m->'score') NOT IN ('number','null')) THEN
      RAISE EXCEPTION 'Invalid match record shape' USING ERRCODE='22023';
    END IF;
    SELECT array_agg(key ORDER BY key) INTO member_sides FROM jsonb_object_keys(m->'members') key;
    IF member_sides IS DISTINCT FROM expected_sides THEN
      RAISE EXCEPTION 'Match members differ from configured sides' USING ERRCODE='22023';
    END IF;
    FOR member IN SELECT value FROM jsonb_each(m->'members') LOOP
      IF jsonb_typeof(member)<>'array' OR jsonb_array_length(member)=0 THEN
        RAISE EXCEPTION 'Every matched side must retain members' USING ERRCODE='22023';
      END IF;
      actual_matched_records:=actual_matched_records+jsonb_array_length(member);
      FOR member_row IN SELECT value FROM jsonb_array_elements(member) LOOP
        IF jsonb_typeof(member_row)<>'object' THEN
          RAISE EXCEPTION 'Invalid matched group member' USING ERRCODE='22023';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF actual_matched_records<>matched_records THEN
    RAISE EXCEPTION 'Matched member accounting disagrees' USING ERRCODE='22023';
  END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(_exceptions) LOOP
    IF jsonb_typeof(m)<>'object' OR jsonb_typeof(m->'payload') IS DISTINCT FROM 'object'
       OR jsonb_typeof(m->'reason') IS DISTINCT FROM 'string'
       OR jsonb_typeof(m->'severity') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid exception record shape' USING ERRCODE='22023';
    END IF;
  END LOOP;
  -- These invoker writes, RLS/constraint/trigger checks and audit are ONE statement
  -- transaction. No exception handler swallows failures or leaves partial rows.
  INSERT INTO public.recon_matches(run_id,tenant_id,rule_id,cardinality,members,score)
    SELECT r.id,_tenant_id,m.rule_id,m.cardinality,m.members,m.score
    FROM jsonb_to_recordset(_matches) AS m(rule_id text,cardinality text,members jsonb,score numeric);
  INSERT INTO public.recon_exceptions(run_id,tenant_id,side,reason,severity,status,payload)
    SELECT r.id,_tenant_id,e.side,e.reason,e.severity,'open',e.payload
    FROM jsonb_to_recordset(_exceptions) AS e(side text,reason text,severity text,payload jsonb);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES(actor,_tenant_id,'workspace','recon.run.complete','recon_run',r.id::text,
      jsonb_build_object('definition_id',r.definition_id,'name',r.definition_snapshot->>'name','commit_id',_commit_id,'result_sha256',digest,
        'matched',matches,'exceptions',exceptions,'total_rows',total,
        'approved_revision_id',r.approved_revision_id,'approved_revision_number',r.approved_revision_number,
        'approved_revision_sha256',r.approved_revision_sha256,'reference_versions',_stats->'reference_versions'))
    RETURNING id INTO audit_id;
  marker:=jsonb_build_object('commit_id',_commit_id,'result_sha256',digest,'audit_id',audit_id::text,
    'status','completed','run_id',r.id,'tenant_id',_tenant_id,'definition_id',r.definition_id,
    'matched_count',matches,'exception_count',exceptions,'total_rows',total);
  UPDATE public.recon_runs SET status='completed',matched_count=matches,exception_count=exceptions,
    total_rows=total,stats=_stats||jsonb_build_object('_atomic_completion',marker),completed_at=clock_timestamp(),error=NULL
    WHERE id=r.id AND tenant_id=_tenant_id AND run_by=actor AND status='running';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Run completion update not permitted' USING ERRCODE='42501'; END IF;
  nid:=private.recon_atomic_self_notification(_tenant_id,r.id,_commit_id);
  marker:=marker||jsonb_build_object('notification_id',nid);
  UPDATE public.recon_runs SET stats=_stats||jsonb_build_object('_atomic_completion',marker)
    WHERE id=r.id AND tenant_id=_tenant_id AND run_by=actor AND status='completed';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Commit receipt update not permitted' USING ERRCODE='42501'; END IF;
  RETURN marker;
END $atomic_complete$;

ALTER FUNCTION private.recon_atomic_admit(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.recon_atomic_self_notification(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.complete_recon_run_atomic(uuid,uuid,uuid,jsonb,uuid,integer,text,jsonb,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.recon_atomic_admit(uuid,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION private.recon_atomic_self_notification(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.complete_recon_run_atomic(uuid,uuid,uuid,jsonb,uuid,integer,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.recon_atomic_admit(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.recon_atomic_self_notification(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_recon_run_atomic(uuid,uuid,uuid,jsonb,uuid,integer,text,jsonb,jsonb,jsonb) TO authenticated;


-- FROZEN INPUT RECON-EXECUTION-PRODUCER.sql SHA256 f5d4d155624edef0faa8282016bc961ca43b006eef46ae3273e23b066a1bc6ed
-- Noether NEW PURPOSE PROPOSAL. NOT REGISTERED/APPLIED. Main owns native qualification.
-- Requires exact Hooke ef8 atomic body, current RLP/source helpers and qualified
-- Einstein wfm_assert_enabled + dpw_get_attachment_retention adapters.
-- No existing routine replacement, UID rewrite, table ACL widening, purge or AI acceptance.
CREATE TABLE private.rs_policies(
 tenant_id uuid NOT NULL,definition_id uuid NOT NULL,policy_id uuid NOT NULL,version text NOT NULL,
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),qualification jsonb NOT NULL CHECK(jsonb_typeof(qualification)='object'),
 PRIMARY KEY(tenant_id,definition_id,policy_id,version));
-- Market entries require native qualification; ordinary cohorts have an authorized producer.
CREATE TABLE private.rs_requests(
 run_id uuid PRIMARY KEY REFERENCES public.recon_runs(id),tenant_id uuid NOT NULL,definition_id uuid NOT NULL,
 actor_id uuid NOT NULL,request_key uuid NOT NULL,intent jsonb NOT NULL,manifest jsonb NOT NULL,
 input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[0-9a-f]{64}$'),
 attachment_receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 phase text NOT NULL CHECK(phase IN('queued','running','completed','failed')) DEFAULT 'queued',
 claim_id uuid,completion jsonb,
 UNIQUE(tenant_id,definition_id,actor_id,request_key));
CREATE UNIQUE INDEX rs_one_active_per_definition ON private.rs_requests(tenant_id,definition_id) WHERE phase='running';
CREATE TABLE private.rs_attachments(
 run_id uuid NOT NULL REFERENCES private.rs_requests(run_id),side_id text NOT NULL,
 data_source_id uuid NOT NULL,upload_id uuid NOT NULL,arrival_at timestamptz NOT NULL,
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),selected_ordinals jsonb NOT NULL,row_lineage jsonb NOT NULL,
 submitted_rows integer NOT NULL,carried_rows integer NOT NULL,
 PRIMARY KEY(run_id,side_id));
CREATE TABLE private.rs_attachment_holds(run_id uuid NOT NULL REFERENCES private.rs_requests(run_id),hold_reference text NOT NULL,
 qualification jsonb NOT NULL CHECK(jsonb_typeof(qualification)='object'),PRIMARY KEY(run_id,hold_reference));
CREATE TABLE private.rs_groups(
 run_id uuid NOT NULL REFERENCES private.rs_requests(run_id),match_status text NOT NULL CHECK(match_status IN('matched','break')),
 ordinal integer NOT NULL CHECK(ordinal>=0),identity_key text NOT NULL,source_rows jsonb NOT NULL,
 native_id uuid NOT NULL,first_seen_at timestamptz NOT NULL,carry_forward boolean NOT NULL DEFAULT false,
 PRIMARY KEY(run_id,match_status,ordinal),UNIQUE(run_id,match_status,native_id));
CREATE TABLE private.rs_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES private.rs_requests(run_id),
 actor_id uuid NOT NULL,kind text NOT NULL,payload jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE FUNCTION private.rs_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'rs.immutable_evidence' USING ERRCODE='42501'; END $$;
CREATE TRIGGER rs_policy_immutable BEFORE UPDATE OR DELETE ON private.rs_policies FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_attachment_immutable BEFORE UPDATE OR DELETE ON private.rs_attachments FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_group_immutable BEFORE UPDATE OR DELETE ON private.rs_groups FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_event_immutable BEFORE UPDATE OR DELETE ON private.rs_events FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_hold_immutable BEFORE UPDATE OR DELETE ON private.rs_attachment_holds FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE FUNCTION private.rs_request_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['phase','claim_id','completion']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['phase','claim_id','completion'])
 OR (OLD.phase IN('completed','failed') AND NEW IS DISTINCT FROM OLD)
 OR (OLD.claim_id IS NOT NULL AND NEW.claim_id IS DISTINCT FROM OLD.claim_id)
 THEN RAISE EXCEPTION 'rs.request_identity_immutable' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rs_request_immutable BEFORE UPDATE OR DELETE ON private.rs_requests FOR EACH ROW EXECUTE FUNCTION private.rs_request_immutable();

CREATE FUNCTION private.rs_actor(_tenant uuid,_definition uuid,_action text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE a uuid:=auth.uid();d public.recon_definitions%ROWTYPE;
BEGIN
 IF a IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR _action NOT IN('read','run','edit')
 OR private.rlnext_account_allowed(a,NULL) IS DISTINCT FROM true OR private.rlnext_account_allowed(a,_tenant) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=a AND active)
 THEN RAISE EXCEPTION 'rs.current_actor_denied' USING ERRCODE='42501';END IF;
 PERFORM private.wfm_assert_enabled(_tenant,'recons');
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.scope_denied' USING ERRCODE='42501';END IF;
 IF (_action='read' AND (private.recon_run_read_allowed(d.id,_tenant) IS DISTINCT FROM true
   OR private.recon_run_effective_read_allowed(d.id,_tenant) IS DISTINCT FROM true))
 OR (_action IN('run','edit') AND private.recon_root_write_allowed(d.id,_tenant,_action) IS DISTINCT FROM true) THEN
  -- Reuse current native read/write predicates including their exact legacy
  -- ancestry rules. No role reinterpretation, alias, override or new authority.
  RAISE EXCEPTION 'rs.current_resource_action_denied' USING ERRCODE='42501';END IF;
 IF _action='run' AND d.governance_state='approved_locked' AND d.environment='production'
 AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=a AND active AND role='tenant_admin'::public.tenant_role)
 THEN RAISE EXCEPTION 'rs.production_admission_denied' USING ERRCODE='42501';END IF;
 RETURN a;
END $$;

CREATE FUNCTION private.rs_prior(_tenant uuid,_definition uuid,_key uuid,_intent jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;a uuid:=private.rs_actor(_tenant,_definition,'run');r public.recon_runs%ROWTYPE;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE tenant_id=_tenant AND definition_id=_definition AND actor_id=a AND request_key=_key;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF q.intent IS DISTINCT FROM _intent THEN RAISE EXCEPTION 'rs.request_key_conflict' USING ERRCODE='PT409';END IF;
 SELECT * INTO r FROM public.recon_runs WHERE id=q.run_id AND tenant_id=_tenant AND run_by=a;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.owned_receipt_unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('actor_id',q.actor_id,'run_id',q.run_id,'run_uid',r.run_uid,'tenant_id',q.tenant_id,'definition_id',q.definition_id,'input_manifest',q.manifest,
 'request_key',_key,'execution_kind','request_replay','status',r.status,'phase',q.phase,'input_fingerprint',q.input_fingerprint,
 'attachment_receipt',q.attachment_receipt,'completion',q.completion,'stats',r.stats,
 'matched_count',r.matched_count,'exception_count',r.exception_count,'total_rows',r.total_rows,
 'matched_records',CASE WHEN q.phase='completed' THEN r.stats->'matched_records' ELSE NULL END,
 'exception_items',CASE WHEN q.phase='completed' THEN r.stats->'exception_items' ELSE NULL END);
END $$;

CREATE FUNCTION private.rs_population(_tenant uuid,_definition uuid,_side text,_source uuid,_upload uuid,_policy jsonb,_selected_indexes integer[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE a uuid:=private.rs_actor(_tenant,_definition,'run');u public.workspace_data_source_uploads%ROWTYPE;
 b private.rs_attachments%ROWTYPE;fp jsonb:=_policy->'feed_policies'->_side;q private.rs_requests%ROWTYPE;
 population jsonb:='{}';entry jsonb;item jsonb;lineage jsonb;record_key text;key_field text;operation_field text;operation text;ordinal bigint;
 effective_rows jsonb;effective_lineage jsonb;carried integer:=0;raw_rows jsonb;raw_ordinals jsonb;
BEGIN
 IF private.data_source_child_allows(a,_tenant,_source,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.current_source_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=_upload AND tenant_id=_tenant AND data_source_id=_source;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.exact_population_upload_required' USING ERRCODE='42501';END IF;
 IF _selected_indexes IS NOT NULL AND (cardinality(_selected_indexes)=0 OR (SELECT count(DISTINCT i) FROM unnest(_selected_indexes) i)<>cardinality(_selected_indexes)
 OR EXISTS(SELECT 1 FROM unnest(_selected_indexes) i WHERE i IS NULL OR i<0 OR i>=jsonb_array_length(u.rows))) THEN RAISE EXCEPTION 'rs.prepared_logical_side_indexes_invalid' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(u.rows->i ORDER BY pos),'[]'),coalesce(jsonb_agg(i ORDER BY pos),'[]') INTO raw_rows,raw_ordinals
 FROM unnest(coalesce(_selected_indexes,ARRAY(SELECT generate_series(0,jsonb_array_length(u.rows)-1)))) WITH ORDINALITY x(i,pos);
 IF fp->>'mode'='full_snapshot' THEN
  IF fp->>'identity_field' IS NOT NULL AND ((SELECT count(DISTINCT value->>(fp->>'identity_field')) FROM jsonb_array_elements(raw_rows))<>jsonb_array_length(raw_rows)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(raw_rows) x WHERE coalesce(x->>(fp->>'identity_field'),'')='')) THEN RAISE EXCEPTION 'rs.snapshot_economic_identity_ambiguous' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('upload_id',_upload,'ordinal',raw_ordinals->(ordinality-1)::integer,'first_seen_at',u.created_at,
   'economic_record_id',CASE WHEN fp->>'identity_field' IS NOT NULL THEN value->>(fp->>'identity_field') END)) ORDER BY ordinality),'[]') INTO effective_lineage
  FROM jsonb_array_elements(raw_rows) WITH ORDINALITY;
  RETURN jsonb_build_object('rows',raw_rows,'row_lineage',effective_lineage,'submitted_rows',jsonb_array_length(raw_rows),'carried_rows',0,'amended_rows',0,'cancelled_rows',0);
 END IF;
 IF fp->>'mode' IS DISTINCT FROM 'delta' OR fp->>'identity_field' IS NULL OR fp->>'operation_field' IS NULL
 OR (fp->>'eligible_base' IN('full_population','open_breaks')) IS DISTINCT FROM true OR fp->>'base_run_id' IS NULL
 THEN RAISE EXCEPTION 'rs.explicit_feed_policy_required' USING ERRCODE='42501';END IF;
 key_field:=fp->>'identity_field';operation_field:=fp->>'operation_field';
 IF (SELECT count(DISTINCT value->>key_field) FROM jsonb_array_elements(raw_rows))<>jsonb_array_length(raw_rows)
 THEN RAISE EXCEPTION 'rs.delta_duplicate_operations_ambiguous' USING ERRCODE='22023';END IF;
 SELECT * INTO q FROM private.rs_requests WHERE run_id=(fp->>'base_run_id')::uuid AND tenant_id=_tenant AND definition_id=_definition AND phase='completed';
 IF NOT FOUND OR private.rs_actor(_tenant,_definition,'read') IS NULL THEN RAISE EXCEPTION 'rs.exact_delta_base_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM private.rs_attachments WHERE run_id=q.run_id AND side_id=_side AND data_source_id=_source;
 IF NOT FOUND OR jsonb_array_length(b.rows)<>jsonb_array_length(b.row_lineage) THEN RAISE EXCEPTION 'rs.delta_base_lineage_unavailable' USING ERRCODE='42501';END IF;
 FOR item,ordinal IN SELECT value,ordinality-1 FROM jsonb_array_elements(b.rows) WITH ORDINALITY LOOP
  lineage:=b.row_lineage->ordinal::integer;record_key:=item->>key_field;
  IF lineage->>'economic_record_id' IS DISTINCT FROM record_key THEN RAISE EXCEPTION 'rs.delta_base_record_tracking_unqualified' USING ERRCODE='42501';END IF;
  IF record_key IS NULL OR record_key='' OR population ? record_key THEN RAISE EXCEPTION 'rs.delta_economic_identity_ambiguous' USING ERRCODE='22023';END IF;
  IF fp->>'eligible_base'='open_breaks' AND NOT EXISTS(
   SELECT 1 FROM private.rs_groups g CROSS JOIN LATERAL jsonb_array_elements(g.source_rows) sr
   JOIN public.recon_exceptions e ON e.id=g.native_id AND e.run_id=g.run_id AND e.tenant_id=_tenant
   WHERE g.run_id=q.run_id AND g.match_status='break' AND sr->>'side_id'=_side
    AND sr->>'upload_id'=lineage->>'upload_id' AND sr->>'ordinal'=lineage->>'ordinal'
    AND e.status NOT IN('resolved','wont_fix') AND e.lifecycle_state NOT IN('resolved','written_off')) THEN CONTINUE;END IF;
  population:=population||jsonb_build_object(record_key,jsonb_build_object('row',item,'lineage',lineage||jsonb_build_object('economic_record_id',record_key,'carried',true)));
 END LOOP;
 FOR item,ordinal IN SELECT value,(raw_ordinals->>(ordinality-1)::integer)::bigint FROM jsonb_array_elements(raw_rows) WITH ORDINALITY LOOP
  record_key:=item->>key_field;operation:=item->>operation_field;
  IF record_key IS NULL OR record_key='' OR (operation IN('insert','update','delete')) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'rs.delta_operation_or_identity_invalid' USING ERRCODE='22023';END IF;
  IF operation='insert' AND population ? record_key OR operation IN('update','delete') AND NOT(population ? record_key)
  THEN RAISE EXCEPTION 'rs.delta_population_conflict' USING ERRCODE='PT409';END IF;
  IF operation='delete' THEN population:=population-record_key;CONTINUE;END IF;
  entry:=population->record_key;
  lineage:=jsonb_build_object('upload_id',_upload,'ordinal',ordinal,'economic_record_id',record_key,'first_seen_at',coalesce(entry->'lineage'->>'first_seen_at',u.created_at::text),
    'previous_origin',entry->'lineage','carried',false);
  population:=population||jsonb_build_object(record_key,jsonb_build_object('row',CASE WHEN fp->'strip_operation_field'='true'::jsonb THEN item-operation_field ELSE item END,'lineage',lineage));
 END LOOP;
 SELECT coalesce(jsonb_agg(value->'row' ORDER BY key),'[]'),coalesce(jsonb_agg(value->'lineage' ORDER BY key),'[]'),
 count(*) FILTER(WHERE value->'lineage'->'carried'='true'::jsonb) INTO effective_rows,effective_lineage,carried FROM jsonb_each(population);
 RETURN jsonb_build_object('rows',effective_rows,'row_lineage',effective_lineage,'submitted_rows',jsonb_array_length(raw_rows),'carried_rows',carried,
  'amended_rows',(SELECT count(*) FROM jsonb_array_elements(raw_rows) x WHERE x->>operation_field='update'),
  'cancelled_rows',(SELECT count(*) FROM jsonb_array_elements(raw_rows) x WHERE x->>operation_field='delete'));
END $$;

CREATE FUNCTION private.rs_store(_tenant uuid,_run uuid,_key uuid,_intent jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE r public.recon_runs%ROWTYPE;a uuid;p jsonb;qualified jsonb;pin jsonb;s jsonb;u public.workspace_data_source_uploads%ROWTYPE;
 manifest jsonb:='[]';attachments jsonb:='[]';selected jsonb;field text;row_item jsonb;ordinal bigint;row_date date;
 receipt jsonb;retention jsonb;fingerprint text;arrival timestamptz;opens timestamptz;closes timestamptz;cutoff timestamptz;population jsonb;effective_rows jsonb;prepared jsonb;selected_indexes integer[];
 intrinsic boolean:=false;ordinary boolean:=false;native_binding jsonb;contract jsonb;input_proof jsonb;current_definition public.recon_definitions%ROWTYPE;configuration_sha text;
BEGIN
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND run_by=auth.uid();
 IF NOT FOUND OR r.status<>'queued' THEN RAISE EXCEPTION 'rs.owned_queued_run_required' USING ERRCODE='42501';END IF;
 a:=private.rs_actor(_tenant,r.definition_id,'run');PERFORM private.recon_atomic_admit(_tenant,_run);
 SELECT policy,qualification INTO p,qualified FROM private.rs_policies WHERE tenant_id=_tenant AND definition_id=r.definition_id
 AND policy_id=(_intent->>'policy_id')::uuid AND version=_intent->>'policy_version';
 IF NOT FOUND AND _intent->>'input_kind'='prepared_bound' THEN
  native_binding:=public.dpw_get_recon_binding(_tenant,_key);
  IF native_binding->>'run_id' IS DISTINCT FROM _run::text OR native_binding->>'actor_id' IS DISTINCT FROM a::text
   OR native_binding->>'approved_snapshot_sha256' IS DISTINCT FROM r.approved_revision_sha256
   OR r.approved_revision_sha256 IS DISTINCT FROM _intent->>'expected_definition_sha256'
   OR r.approved_revision_id::text IS DISTINCT FROM _intent->>'policy_id'
   OR r.approved_revision_number::text IS DISTINCT FROM _intent->>'policy_version'
   OR native_binding->>'business_date' IS DISTINCT FROM _intent->>'business_date'
  THEN RAISE EXCEPTION 'rs.actual_approved_prepared_cohort_required' USING ERRCODE='42501';END IF;
  intrinsic:=true;
  p:=jsonb_build_object('policy_id',r.approved_revision_id,'version',r.approved_revision_number::text,'policy_kind','approved_native_input_binding',
   'business_date',native_binding->>'business_date','date_basis','prepared_delivery_metadata','as_of',(native_binding->>'business_date')||'T00:00:00Z',
   'market_calendar_available',false,'feed_timing_available',false,'no_market_cutoff_inferred',true,'approved_definition_sha256',r.approved_revision_sha256);
  qualified:=jsonb_build_object('state','native_qualified','kind','approved_native_input_binding','approved_revision_id',r.approved_revision_id,
   'approved_definition_sha256',r.approved_revision_sha256,'binding_producer','dpw_get_recon_binding');
 END IF;
 IF p->>'policy_kind'='ordinary_native_snapshot' THEN
  SELECT * INTO current_definition FROM public.recon_definitions WHERE id=r.definition_id AND tenant_id=_tenant;
  configuration_sha:=encode(sha256(convert_to(private.recon_definition_config_snapshot(current_definition)::text,'UTF8')),'hex');
  IF qualified->>'state' IS DISTINCT FROM 'native_qualified' OR qualified->>'kind' IS DISTINCT FROM 'ordinary_native_snapshot'
  OR qualified->>'producer' IS DISTINCT FROM 'resolve_recon_ordinary_cohort'
  OR p->>'configuration_sha256' IS DISTINCT FROM configuration_sha
  OR p->>'approved_revision_id' IS DISTINCT FROM r.approved_revision_id::text
  OR (p->>'configuration_authority'='native_approved_revision' AND p->>'configuration_sha256' IS DISTINCT FROM r.approved_revision_sha256)
  OR (p->>'configuration_authority' IN('native_approved_revision','native_current_configuration')) IS DISTINCT FROM true
  OR p->'pins' IS DISTINCT FROM _intent->'pins' OR p->>'cohort_mode' IS DISTINCT FROM 'explicit_snapshot_selection'
  THEN RAISE EXCEPTION 'rs.actual_approved_ordinary_cohort_required' USING ERRCODE='42501';END IF;
  ordinary:=true;intrinsic:=true;
 END IF;
 IF NOT intrinsic AND (qualified->>'state' IS DISTINCT FROM 'native_qualified' OR (qualified->>'source_sha256' ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true
 OR (qualified->>'calendar_sha256' ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true OR p->>'policy_id' IS DISTINCT FROM _intent->>'policy_id'
 OR p->>'version' IS DISTINCT FROM _intent->>'policy_version' OR p->'calendar'->>'id' IS NULL OR p->'calendar'->>'version' IS NULL
 OR p->'calendar'->>'time_zone' IS NULL OR jsonb_typeof(p->'calendar'->'open_weekdays') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p->'calendar'->'closed_dates') IS DISTINCT FROM 'array'
 OR (p->>'date_basis' IN('business_date','value_date')) IS DISTINCT FROM true OR (p->>'early_policy' IN('include','defer')) IS DISTINCT FROM true
 OR (p->>'late_policy' IN('include_until_cutoff','reject')) IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'rs.native_calendar_source_policy_unqualified' USING ERRCODE='42501';END IF;
 IF NOT intrinsic THEN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p->'calendar'->>'time_zone')
 OR p->>'business_date' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'rs.invalid_qualified_calendar' USING ERRCODE='22023';END IF;
 PERFORM (p->>'business_date')::date;
 opens:=(p->>'expected_window_opens_at')::timestamptz;closes:=(p->>'expected_window_closes_at')::timestamptz;cutoff:=(p->>'arrival_cutoff')::timestamptz;
 IF opens IS NULL OR closes IS NULL OR cutoff IS NULL OR closes<opens OR cutoff<closes THEN RAISE EXCEPTION 'rs.invalid_qualified_window' USING ERRCODE='22023';END IF;
 END IF;
 IF jsonb_typeof(_intent->'pins') IS DISTINCT FROM 'array' OR jsonb_array_length(_intent->'pins')<>jsonb_array_length(r.definition_snapshot->'sides')
 OR (SELECT count(DISTINCT x->>'side_id') FROM jsonb_array_elements(_intent->'pins') x)<>jsonb_array_length(_intent->'pins')
 THEN RAISE EXCEPTION 'rs.complete_distinct_pins_required' USING ERRCODE='22023';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(r.definition_snapshot->'sides') LOOP
  SELECT value INTO pin FROM jsonb_array_elements(_intent->'pins') WHERE value->>'side_id'=s->>'side_id';
  IF NOT FOUND OR (s->>'upload_id' IS NOT NULL AND s->>'upload_id' IS DISTINCT FROM pin->>'upload_id')
  OR private.data_source_child_allows(a,_tenant,(s->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  OR NOT has_table_privilege('authenticated','public.workspace_data_source_uploads','SELECT')
  THEN RAISE EXCEPTION 'rs.current_source_or_pin_denied' USING ERRCODE='42501';END IF;
  SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(pin->>'upload_id')::uuid AND tenant_id=_tenant AND data_source_id=(s->>'data_source_id')::uuid;
  IF NOT FOUND OR jsonb_typeof(u.rows) IS DISTINCT FROM 'array' OR u.row_count<>jsonb_array_length(u.rows) THEN RAISE EXCEPTION 'rs.observed_upload_unavailable' USING ERRCODE='42501';END IF;
  arrival:=u.created_at;
  IF NOT intrinsic AND (arrival>cutoff OR (arrival<opens AND p->>'early_policy'='defer') OR (arrival>closes AND p->>'late_policy'='reject'))
  THEN RAISE EXCEPTION 'rs.feed_timing_refused_no_fallback' USING ERRCODE='PT409';END IF;
  field:=p->'date_fields'->(s->>'side_id')->>(p->>'date_basis');
  IF NOT intrinsic AND (field IS NULL OR field='') THEN RAISE EXCEPTION 'rs.explicit_date_basis_required' USING ERRCODE='22023';END IF;
  selected_indexes:=NULL;prepared:=NULL;
  IF _intent->>'input_kind'='prepared_bound' THEN
   prepared:=public.dpw_get_recon_input_rows(_tenant,_run,s->>'side_id');
   IF prepared->>'tenant_id' IS DISTINCT FROM _tenant::text OR prepared->>'actor_id' IS DISTINCT FROM a::text
    OR prepared->'binding'->>'upload_id' IS DISTINCT FROM u.id::text OR prepared->'binding'->>'data_source_id' IS DISTINCT FROM u.data_source_id::text
    OR jsonb_typeof(prepared->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'rs.actual_prepared_logical_side_binding_required' USING ERRCODE='42501';END IF;
   IF prepared->'binding'->'output_indexes' IS NOT NULL AND prepared->'binding'->'output_indexes'<>'null'::jsonb THEN
    SELECT array_agg(x.value::integer ORDER BY x.ordinal) INTO selected_indexes FROM jsonb_array_elements_text(prepared->'binding'->'output_indexes') WITH ORDINALITY x(value,ordinal);
   END IF;
  END IF;
  IF ordinary THEN
   IF s->>'upload_id' IS NULL AND (EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets x WHERE x.tenant_id=_tenant AND x.upload_id=u.id)
    OR EXISTS(SELECT 1 FROM public.data_prep_pipelines dp WHERE dp.tenant_id=_tenant AND dp.output_data_source_id=u.data_source_id))
   THEN RAISE EXCEPTION 'rs.prepared_source_requires_native_per_run_binding' USING ERRCODE='42501';END IF;
   SELECT x.value INTO input_proof FROM jsonb_array_elements(p->'input_proofs') x WHERE x.value->>'side_id'=s->>'side_id';
   IF input_proof->>'upload_id' IS DISTINCT FROM u.id::text
   OR input_proof->>'rows_sha256' IS DISTINCT FROM encode(sha256(convert_to(u.rows::text,'UTF8')),'hex')
   THEN RAISE EXCEPTION 'rs.selected_input_changed_requires_new_intent' USING ERRCODE='PT409';END IF;
   effective_rows:=u.rows;
   SELECT jsonb_build_object('rows',effective_rows,'submitted_rows',jsonb_array_length(effective_rows),'carried_rows',0,
    'row_lineage',coalesce(jsonb_agg(jsonb_build_object('upload_id',u.id,'ordinal',ordinality-1,'first_seen_at',u.created_at) ORDER BY ordinality),'[]')) INTO population
    FROM jsonb_array_elements(effective_rows) WITH ORDINALITY;
  ELSIF intrinsic THEN
   IF prepared IS NULL OR prepared->'binding'->>'binding_kind'='prepared_dataset' AND prepared->'binding'->>'business_date' IS DISTINCT FROM p->>'business_date'
   THEN RAISE EXCEPTION 'rs.prepared_native_business_cohort_mismatch' USING ERRCODE='42501';END IF;
   effective_rows:=prepared->'rows';
   SELECT jsonb_build_object('rows',effective_rows,'submitted_rows',jsonb_array_length(effective_rows),'carried_rows',0,
    'row_lineage',coalesce(jsonb_agg(jsonb_build_object('upload_id',u.id,'ordinal',CASE WHEN selected_indexes IS NULL THEN ordinality-1 ELSE selected_indexes[ordinality::integer] END,'first_seen_at',u.created_at) ORDER BY ordinality),'[]')) INTO population
    FROM jsonb_array_elements(effective_rows) WITH ORDINALITY;
  ELSE population:=private.rs_population(_tenant,r.definition_id,s->>'side_id',u.data_source_id,u.id,p,selected_indexes);effective_rows:=population->'rows';END IF;
  IF prepared IS NOT NULL AND effective_rows IS DISTINCT FROM prepared->'rows' AND p->'feed_policies'->(s->>'side_id')->>'mode'='full_snapshot'
  THEN RAISE EXCEPTION 'rs.prepared_native_row_projection_mismatch' USING ERRCODE='PT409';END IF;
  selected:='[]';
  FOR row_item,ordinal IN SELECT value,ordinality-1 FROM jsonb_array_elements(effective_rows) WITH ORDINALITY LOOP
   IF jsonb_typeof(row_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'rs.invalid_prepared_record' USING ERRCODE='22023';END IF;
   IF intrinsic THEN selected:=selected||to_jsonb(ordinal);CONTINUE;END IF;
   IF jsonb_typeof(row_item->field) IS DISTINCT FROM 'string'
   OR row_item->>field !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'rs.invalid_source_date' USING ERRCODE='22023';END IF;
   row_date:=(row_item->>field)::date;
   IF row_date::text IS DISTINCT FROM row_item->>field THEN RAISE EXCEPTION 'rs.invalid_source_calendar_date' USING ERRCODE='22023';END IF;
   IF row_date=(p->>'business_date')::date THEN selected:=selected||to_jsonb(ordinal);END IF;
  END LOOP;
  IF jsonb_array_length(selected)=0 THEN RAISE EXCEPTION 'rs.required_cohort_empty_no_fallback' USING ERRCODE='PT409';END IF;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('side_id',s->>'side_id','data_source_id',u.data_source_id,'upload_id',u.id,
    'arrival_at',u.created_at,'input_rows',jsonb_array_length(effective_rows),'selected_ordinals',selected,
    'submitted_rows',population->'submitted_rows','carried_rows',population->'carried_rows','amended_rows',population->'amended_rows','cancelled_rows',population->'cancelled_rows',
    'feed_policy',p->'feed_policies'->(s->>'side_id'),'prepared_binding',prepared->'binding','rows_sha256',encode(sha256(convert_to(effective_rows::text,'UTF8')),'hex'),
    'submitted_rows_sha256',encode(sha256(convert_to(u.rows::text,'UTF8')),'hex'),
    'timing',CASE WHEN intrinsic THEN 'unclassified' WHEN arrival<opens THEN 'early' WHEN arrival>closes THEN 'late' ELSE 'on_time' END));
  attachments:=attachments||jsonb_build_array(jsonb_build_object('side_id',s->>'side_id','data_source_id',u.data_source_id,'upload_id',u.id,
    'arrival_at',u.created_at,'rows',effective_rows,'row_lineage',population->'row_lineage','submitted_rows',population->'submitted_rows','carried_rows',population->'carried_rows','selected_ordinals',selected));
 END LOOP;
 retention:=public.dpw_get_attachment_retention(_tenant)->'effective';
 IF retention IS NULL OR retention->>'policy_id' IS NULL OR retention->>'version' !~ '^[0-9]+$'
 OR (retention->>'period_days')::integer<1 OR retention->>'source' NOT IN('platform','tenant') THEN RAISE EXCEPTION 'rs.retention_unqualified' USING ERRCODE='42501';END IF;
 receipt:=jsonb_build_object('created_at',clock_timestamp(),'policy_id',retention->>'policy_id','policy_version',retention->>'version',
   'period_days',(retention->>'period_days')::integer,'policy_source',retention->>'source','physical_purge_enabled',false,'metadata_retained',true);
 receipt:=receipt||jsonb_build_object('expires_at',(receipt->>'created_at')::timestamptz+((retention->>'period_days')::integer*interval '1 day'));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('definition_snapshot',r.definition_snapshot,'approved_revision_id',r.approved_revision_id,
   'approved_revision_sha256',r.approved_revision_sha256,'policy',p,'manifest',manifest)::text,'UTF8')),'hex');
 INSERT INTO private.rs_requests(run_id,tenant_id,definition_id,actor_id,request_key,intent,manifest,input_fingerprint,attachment_receipt)
 VALUES(_run,_tenant,r.definition_id,a,_key,_intent,manifest,fingerprint,receipt);
 INSERT INTO private.rs_attachments(run_id,side_id,data_source_id,upload_id,arrival_at,rows,selected_ordinals,row_lineage,submitted_rows,carried_rows)
 SELECT _run,x.side_id,x.data_source_id,x.upload_id,x.arrival_at,x.rows,x.selected_ordinals,x.row_lineage,x.submitted_rows,x.carried_rows
 FROM jsonb_to_recordset(attachments) x(side_id text,data_source_id uuid,upload_id uuid,arrival_at timestamptz,rows jsonb,selected_ordinals jsonb,row_lineage jsonb,submitted_rows integer,carried_rows integer);
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,a,'request_admitted',jsonb_build_object('request_key',_key,'manifest',manifest,'input_fingerprint',fingerprint,'policy',p,'qualification',qualified,'attachment_receipt',receipt));
 RETURN (private.rs_prior(_tenant,r.definition_id,_key,_intent)-'execution_kind')||jsonb_build_object('execution_kind','fresh');
END $$;

CREATE FUNCTION public.request_recon_execution(_tenant_id uuid,_definition_id uuid,_request_key uuid,_policy_id uuid,_policy_version text,_pins jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE intent jsonb;prior jsonb;r public.recon_runs%ROWTYPE;d public.recon_definitions%ROWTYPE;pin jsonb;s jsonb;
BEGIN
 IF _request_key IS NULL OR _policy_id IS NULL OR _policy_version IS NULL OR length(_policy_version) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'rs.intent_required' USING ERRCODE='22023';END IF;
 PERFORM private.rs_actor(_tenant_id,_definition_id,'run');
 PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||_tenant_id::text||':'||_definition_id::text,0));
 intent:=jsonb_build_object('policy_id',_policy_id,'policy_version',_policy_version,'pins',_pins);
 prior:=private.rs_prior(_tenant_id,_definition_id,_request_key,intent);IF prior IS NOT NULL THEN RETURN prior;END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_definition_required' USING ERRCODE='42501';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(d.sides) LOOP
  SELECT value INTO pin FROM jsonb_array_elements(_pins) WHERE value->>'side_id'=s->>'side_id';
  PERFORM 1 FROM public.workspace_data_sources WHERE id=(s->>'data_source_id')::uuid AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_source_required' USING ERRCODE='42501';END IF;
  PERFORM 1 FROM public.workspace_data_source_uploads WHERE id=(pin->>'upload_id')::uuid AND data_source_id=(s->>'data_source_id')::uuid AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_exact_upload_required' USING ERRCODE='42501';END IF;
 END LOOP;
 -- Existing native INSERT triggers produce run_uid and immutable config/revision.
 INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by) VALUES(_tenant_id,_definition_id,'queued',auth.uid()) RETURNING * INTO r;
 RETURN private.rs_store(_tenant_id,r.id,_request_key,intent);
END $$;

-- Covers all future running transitions including existing scheduler/legacy callers;
-- no old row is changed. Existing run admission triggers and RLP remain intact.
CREATE FUNCTION private.rs_one_active_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='running' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||NEW.tenant_id::text||':'||NEW.definition_id::text,0));
  IF EXISTS(SELECT 1 FROM public.recon_runs WHERE tenant_id=NEW.tenant_id AND definition_id=NEW.definition_id AND status='running' AND id<>NEW.id)
  THEN RAISE EXCEPTION 'rs.one_active_run_required' USING ERRCODE='PT409';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER rs_one_active_guard BEFORE INSERT OR UPDATE OF status ON public.recon_runs FOR EACH ROW EXECUTE FUNCTION private.rs_one_active_guard();

CREATE FUNCTION private.rs_claim(_tenant uuid,_run uuid,_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;a uuid;r public.recon_runs%ROWTYPE;p jsonb;uploads jsonb;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR _claim IS NULL THEN RAISE EXCEPTION 'rs.owned_request_required' USING ERRCODE='42501';END IF;
 a:=private.rs_actor(_tenant,q.definition_id,'run');PERFORM private.recon_atomic_admit(_tenant,_run);
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND run_by=a;
 IF q.phase<>'queued' THEN RETURN jsonb_build_object('actor_id',a,'tenant_id',q.tenant_id,'definition_id',q.definition_id,'request_key',q.request_key,
 'run_uid',r.run_uid,'status',r.status,'input_manifest',q.manifest,'claimed',false,'phase',q.phase,'run_id',_run,'execution_kind','request_replay');END IF;
 PERFORM private.rs_validate_prepared_execution(_tenant,_run);
 IF EXISTS(SELECT 1 FROM public.recon_runs WHERE tenant_id=_tenant AND definition_id=q.definition_id AND status='running' AND id<>_run)
 OR EXISTS(SELECT 1 FROM private.rs_requests WHERE tenant_id=_tenant AND definition_id=q.definition_id AND phase IN('queued','running')
   AND (created_at,run_id)<(q.created_at,q.run_id)) THEN RETURN jsonb_build_object('actor_id',a,'tenant_id',q.tenant_id,'definition_id',q.definition_id,
 'request_key',q.request_key,'run_uid',r.run_uid,'status',r.status,'input_manifest',q.manifest,'claimed',false,'phase',q.phase,'run_id',_run,'execution_kind','fresh');END IF;
 IF private.rs_artifact_read_state(_tenant,_run,NULL)->'available' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'rs.attachment_availability_expired_or_tombstoned_metadata_retained' USING ERRCODE='PT409';END IF;
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND run_by=a;
 IF r.status<>'queued' OR r.definition_snapshot IS NULL THEN RAISE EXCEPTION 'rs.run_state_conflict' USING ERRCODE='PT409';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(q.manifest) LOOP
  IF private.data_source_child_allows(a,_tenant,(p->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'rs.current_source_denied' USING ERRCODE='42501';END IF;
 END LOOP;
 UPDATE private.rs_requests SET phase='running',claim_id=_claim WHERE run_id=_run;
 SELECT payload->'policy' INTO p FROM private.rs_events WHERE run_id=_run AND kind='request_admitted';
 SELECT jsonb_agg(jsonb_build_object('side_id',side_id,'data_source_id',data_source_id,'upload_id',upload_id,'arrival_at',arrival_at,'rows',rows,'row_lineage',row_lineage,'submitted_rows',submitted_rows,'carried_rows',carried_rows,
 'native_cohort',CASE WHEN p->>'policy_kind' IN('approved_native_input_binding','ordinary_native_snapshot') THEN jsonb_build_object('qualified_native_binding',true,'business_date',p->>'business_date',
  'binding_kind',CASE WHEN p->>'policy_kind'='ordinary_native_snapshot' THEN 'fixed_upload' ELSE (SELECT m->'prepared_binding'->>'binding_kind' FROM jsonb_array_elements(q.manifest) m WHERE m->>'side_id'=side_id) END) ELSE NULL END,
 'native_timing',jsonb_build_object('qualified_native_observation',true,'policy_id',p->>'policy_id','policy_version',p->>'version',
  'calendar_id',p->'calendar'->>'id','calendar_version',p->'calendar'->>'version','arrival_at',arrival_at,
  'timing',CASE WHEN arrival_at<(p->>'expected_window_opens_at')::timestamptz THEN 'early' WHEN arrival_at>(p->>'expected_window_closes_at')::timestamptz THEN 'late' ELSE 'on_time' END,
  'within_arrival_cutoff',arrival_at<=(p->>'arrival_cutoff')::timestamptz)) ORDER BY side_id) INTO uploads FROM private.rs_attachments WHERE run_id=_run;
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,a,'execution_claimed',jsonb_build_object('claim_id',_claim,'input_fingerprint',q.input_fingerprint));
 RETURN jsonb_build_object('actor_id',a,'claimed',true,'phase','running','execution_kind','fresh','run_id',_run,'run_uid',r.run_uid,'tenant_id',_tenant,
 'definition_id',q.definition_id,'claim_id',_claim,'input_fingerprint',q.input_fingerprint,'manifest',q.manifest,'policy',p,'uploads',uploads,
 'attachment_receipt',q.attachment_receipt,'definition_snapshot',r.definition_snapshot,'approved_revision_id',r.approved_revision_id,
 'approved_revision_number',r.approved_revision_number,'approved_revision_sha256',r.approved_revision_sha256);
END $$;

CREATE FUNCTION public.claim_recon_execution(_tenant_id uuid,_run_id uuid,_claim_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE r public.recon_runs%ROWTYPE;receipt jsonb;changed integer;m jsonb;
BEGIN
 SELECT * INTO r FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_owned_run_required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||_tenant_id::text||':'||r.definition_id::text,0));
 PERFORM 1 FROM public.recon_definitions WHERE id=r.definition_id AND tenant_id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_visible_definition_required' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=auth.uid() FOR UPDATE;
 receipt:=private.rs_claim(_tenant_id,_run_id,_claim_id);
 IF receipt->'claimed'='true'::jsonb THEN
  FOR m IN SELECT value FROM jsonb_array_elements(receipt->'manifest') LOOP
   PERFORM 1 FROM public.workspace_data_sources WHERE id=(m->>'data_source_id')::uuid AND tenant_id=_tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_visible_source_required' USING ERRCODE='42501';END IF;
   PERFORM 1 FROM public.workspace_data_source_uploads WHERE id=(m->>'upload_id')::uuid AND tenant_id=_tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_visible_upload_required' USING ERRCODE='42501';END IF;
  END LOOP;
  UPDATE public.recon_runs SET status='running',started_at=clock_timestamp() WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=auth.uid() AND status='queued';
  GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'rs.current_run_update_denied' USING ERRCODE='42501';END IF;
 END IF;RETURN receipt;
END $$;

CREATE FUNCTION private.rs_receipt(_tenant uuid,_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;
BEGIN SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;
 IF NOT FOUND THEN RETURN NULL;END IF;PERFORM private.rs_actor(_tenant,q.definition_id,'read');
 RETURN jsonb_build_object('run_id',_run,'request_key',q.request_key,'phase',q.phase,'manifest',q.manifest,'input_fingerprint',q.input_fingerprint,
   'attachment_receipt',q.attachment_receipt,'claim_id',q.claim_id,'completion',q.completion,
   'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'actor_id',actor_id,'kind',kind,'payload',payload,'occurred_at',occurred_at) ORDER BY occurred_at,id)
    FROM private.rs_events WHERE run_id=_run),'[]'));
END $$;

CREATE FUNCTION private.rs_finalize(_tenant uuid,_run uuid,_claim uuid,_completion jsonb,_groups jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;r public.recon_runs%ROWTYPE;a uuid;g jsonb;i jsonb;manifest_item jsonb;member jsonb;actual jsonb;expected jsonb;
 group_count integer;match_rows integer;break_rows integer;selected_count integer;matched_count integer;unmatched_count integer;native_rule text;native_reason text;native_identity jsonb;first_seen timestamptz;lineage jsonb;effective_ordinal integer;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR q.phase<>'running' OR q.claim_id IS DISTINCT FROM _claim THEN RAISE EXCEPTION 'rs.current_claim_required' USING ERRCODE='PT409';END IF;
 a:=private.rs_actor(_tenant,q.definition_id,'run');PERFORM private.recon_atomic_admit(_tenant,_run);
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND run_by=a;
 IF r.status<>'completed' OR r.stats->'_atomic_completion' IS DISTINCT FROM _completion THEN RAISE EXCEPTION 'rs.native_complete_receipt_required' USING ERRCODE='PT409';END IF;
 IF jsonb_typeof(_groups) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'rs.complete_groups_required' USING ERRCODE='22023';END IF;
 SELECT count(*) FILTER(WHERE value->>'match_status'='matched'),count(*) FILTER(WHERE value->>'match_status'='break') INTO match_rows,break_rows FROM jsonb_array_elements(_groups);
 IF match_rows<>r.matched_count OR break_rows<>r.exception_count OR match_rows+break_rows<>jsonb_array_length(_groups)
 THEN RAISE EXCEPTION 'rs.group_count_mismatch' USING ERRCODE='22023';END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(_groups) LOOP
  IF g->>'match_status' NOT IN('matched','break') OR g->>'identity_key' IS NULL OR g->>'native_id' IS NULL
  OR jsonb_typeof(g->'source_rows') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'source_rows')=0
  THEN RAISE EXCEPTION 'rs.group_shape_invalid' USING ERRCODE='22023';END IF;
  expected:='[]';
  FOR i IN SELECT value FROM jsonb_array_elements(g->'source_rows') LOOP
   SELECT value INTO manifest_item FROM jsonb_array_elements(q.manifest) WHERE value->>'side_id'=i->>'side_id';
   effective_ordinal:=coalesce((i->>'effective_ordinal')::integer,(i->>'ordinal')::integer);
   SELECT row_lineage->effective_ordinal INTO lineage FROM private.rs_attachments WHERE run_id=_run AND side_id=i->>'side_id';
   IF manifest_item IS NULL OR manifest_item->>'data_source_id' IS DISTINCT FROM i->>'data_source_id'
   OR lineage->>'upload_id' IS DISTINCT FROM i->>'upload_id' OR lineage->>'ordinal' IS DISTINCT FROM i->>'ordinal'
   OR lineage->>'economic_record_id' IS DISTINCT FROM i->>'economic_record_id' OR NOT (manifest_item->'selected_ordinals' @> jsonb_build_array(effective_ordinal))
   OR i->>'source_row_id' IS DISTINCT FROM replace(jsonb_build_array(i->>'data_source_id',i->>'upload_id',(i->>'ordinal')::integer)::text,', ', ',')
   THEN RAISE EXCEPTION 'rs.unobserved_source_identity' USING ERRCODE='22023';END IF;
   SELECT rows->effective_ordinal INTO member FROM private.rs_attachments WHERE run_id=_run AND side_id=i->>'side_id';
   expected:=expected||jsonb_build_array(jsonb_build_object('side',i->>'side_id','row',member));
  END LOOP;
  IF g->>'match_status'='matched' THEN
   SELECT rule_id,NULL::text INTO native_rule,native_reason FROM public.recon_matches WHERE id=(g->>'native_id')::uuid AND run_id=_run AND tenant_id=_tenant;
   SELECT coalesce(jsonb_agg(jsonb_build_object('side',kv.key,'row',v.value) ORDER BY kv.key,v.value::text),'[]') INTO actual
   FROM public.recon_matches x CROSS JOIN LATERAL jsonb_each(x.members) kv CROSS JOIN LATERAL jsonb_array_elements(kv.value) v
   WHERE x.id=(g->>'native_id')::uuid AND x.run_id=_run AND x.tenant_id=_tenant;
  ELSE
   SELECT payload->>'rule_id',reason INTO native_rule,native_reason FROM public.recon_exceptions WHERE id=(g->>'native_id')::uuid AND run_id=_run AND tenant_id=_tenant;
   SELECT payload INTO actual FROM public.recon_exceptions WHERE id=(g->>'native_id')::uuid AND run_id=_run AND tenant_id=_tenant;
   IF actual ? 'members' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('side',kv.key,'row',v.value) ORDER BY kv.key,v.value::text),'[]') INTO actual
    FROM jsonb_each(actual->'members') kv CROSS JOIN LATERAL jsonb_array_elements(kv.value) v;
   ELSIF actual ? 'row' THEN SELECT jsonb_build_array(jsonb_build_object('side',side,'row',payload->'row')) INTO actual FROM public.recon_exceptions WHERE id=(g->>'native_id')::uuid;
   ELSE RAISE EXCEPTION 'rs.native_membership_shape_unavailable' USING ERRCODE='22023';END IF;
  END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY v->>'side',(v->'row')::text),'[]') INTO expected FROM jsonb_array_elements(expected) v;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'rs.native_member_projection_mismatch' USING ERRCODE='22023';END IF;
  SELECT jsonb_build_array(g->>'match_status',native_rule,native_reason,jsonb_agg(jsonb_build_array(v->>'side_id',coalesce(v->>'economic_record_id',v->>'source_row_id')) ORDER BY v->>'side_id',coalesce(v->>'economic_record_id',v->>'source_row_id'))) INTO native_identity FROM jsonb_array_elements(g->'source_rows') v;
  IF ((g->>'identity_key')::jsonb->0) IS DISTINCT FROM native_identity->0
  OR ((g->>'identity_key')::jsonb->1) IS DISTINCT FROM native_identity->1 OR ((g->>'identity_key')::jsonb->2) IS DISTINCT FROM native_identity->2
  OR jsonb_array_length((g->>'identity_key')::jsonb->3)<>jsonb_array_length(native_identity->3)
  OR NOT((((g->>'identity_key')::jsonb)->3) @> (native_identity->3) AND (native_identity->3) @> (((g->>'identity_key')::jsonb)->3))
  THEN RAISE EXCEPTION 'rs.native_identity_key_mismatch' USING ERRCODE='22023';END IF;
  SELECT min(oldg.first_seen_at) INTO first_seen FROM private.rs_groups oldg JOIN private.rs_requests oldq ON oldq.run_id=oldg.run_id
  WHERE oldq.tenant_id=q.tenant_id AND oldq.definition_id=q.definition_id AND oldq.phase='completed'
  AND oldg.identity_key=native_identity::text AND oldg.match_status=g->>'match_status';
  SELECT least(first_seen,min((att.row_lineage->coalesce((v->>'effective_ordinal')::integer,(v->>'ordinal')::integer)->>'first_seen_at')::timestamptz))
  INTO first_seen FROM jsonb_array_elements(g->'source_rows') v JOIN private.rs_attachments att ON att.run_id=_run AND att.side_id=v->>'side_id';
  INSERT INTO private.rs_groups(run_id,match_status,ordinal,identity_key,source_rows,native_id,first_seen_at,carry_forward)
  VALUES(_run,g->>'match_status',(g->>'ordinal')::integer,native_identity::text,g->'source_rows',(g->>'native_id')::uuid,coalesce(first_seen,q.created_at),first_seen IS NOT NULL);
 END LOOP;
 SELECT sum(jsonb_array_length(v->'selected_ordinals')) INTO selected_count FROM jsonb_array_elements(q.manifest) v;
 SELECT count(DISTINCT (v->>'side_id',v->>'source_row_id')) INTO matched_count FROM private.rs_groups g CROSS JOIN LATERAL jsonb_array_elements(g.source_rows) v WHERE g.run_id=_run AND g.match_status='matched';
 SELECT count(DISTINCT (v->>'side_id',v->>'source_row_id')) INTO unmatched_count FROM private.rs_groups g CROSS JOIN LATERAL jsonb_array_elements(g.source_rows) v WHERE g.run_id=_run AND g.match_status='break';
 IF selected_count<>r.total_rows OR matched_count IS DISTINCT FROM (r.stats->>'matched_records')::integer
 OR matched_count+unmatched_count<>selected_count OR EXISTS(
  SELECT 1 FROM private.rs_groups m CROSS JOIN LATERAL jsonb_array_elements(m.source_rows) mi
  JOIN private.rs_groups b ON b.run_id=m.run_id AND b.match_status='break'
  CROSS JOIN LATERAL jsonb_array_elements(b.source_rows) bi
  WHERE m.run_id=_run AND m.match_status='matched' AND (mi->>'side_id',mi->>'source_row_id')=(bi->>'side_id',bi->>'source_row_id'))
 THEN RAISE EXCEPTION 'rs.incomplete_membership_waterfall' USING ERRCODE='22023';END IF;
 IF r.stats->'control_waterfall'->>'input_rows' IS DISTINCT FROM (SELECT sum((v->>'input_rows')::integer)::text FROM jsonb_array_elements(q.manifest) v)
 OR r.stats->'control_waterfall'->>'cohort_excluded_rows' IS DISTINCT FROM (SELECT (sum((v->>'input_rows')::integer)-selected_count)::text FROM jsonb_array_elements(q.manifest) v)
 OR r.stats->'control_waterfall'->>'selected_rows' IS DISTINCT FROM selected_count::text
 OR r.stats->'control_waterfall'->>'matched_memberships' IS DISTINCT FROM matched_count::text
 OR r.stats->'control_waterfall'->>'unmatched_memberships' IS DISTINCT FROM unmatched_count::text
 OR r.stats->'control_waterfall'->>'match_groups' IS DISTINCT FROM r.matched_count::text
 OR r.stats->'control_waterfall'->>'exception_items' IS DISTINCT FROM r.exception_count::text
 THEN RAISE EXCEPTION 'rs.persisted_controls_mismatch' USING ERRCODE='22023';END IF;
 UPDATE private.rs_requests SET phase='completed',completion=_completion||jsonb_build_object('phase','completed','actor_id',a,'input_manifest',q.manifest,'execution_kind','fresh',
  'input_fingerprint',q.input_fingerprint,'execution_fingerprint',encode(sha256(convert_to(jsonb_build_object('input_fingerprint',q.input_fingerprint,'reference_versions',r.stats->'reference_versions')::text,'UTF8')),'hex')) WHERE run_id=_run;
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,a,'execution_completed',jsonb_build_object('claim_id',_claim,'receipt',_completion,'control_waterfall',r.stats->'control_waterfall'));
 PERFORM private.rs_signal_head(_tenant,q.definition_id);
END $$;

CREATE FUNCTION private.rs_result_groups(_tenant uuid,_run uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;
BEGIN SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;
 IF NOT FOUND THEN RETURN '[]';END IF;PERFORM private.rs_actor(_tenant,q.definition_id,'read');
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY match_status,ordinal) FROM private.rs_groups g WHERE run_id=_run),'[]');END $$;

CREATE FUNCTION private.rs_carry_event(_tenant uuid,_run uuid,_case uuid,_prior_case uuid,_labels jsonb,_comments jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;old_run uuid;a uuid;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant AND actor_id=auth.uid();
 IF NOT FOUND OR q.phase<>'completed' THEN RAISE EXCEPTION 'rs.owned_completed_claim_required' USING ERRCODE='42501';END IF;
 a:=private.rs_actor(_tenant,q.definition_id,'edit');
 SELECT o.run_id INTO old_run FROM private.rs_groups n JOIN private.rs_groups o ON o.identity_key=n.identity_key AND o.match_status='break' AND o.run_id<>n.run_id
 JOIN private.rs_requests oq ON oq.run_id=o.run_id AND oq.tenant_id=q.tenant_id AND oq.definition_id=q.definition_id AND oq.phase='completed'
 WHERE n.run_id=_run AND n.native_id=_case AND o.native_id=_prior_case AND n.match_status='break';
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.exact_carry_provenance_required' USING ERRCODE='42501';END IF;
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,a,'break_metadata_carried',jsonb_build_object('new_case_id',_case,
   'source_case_id',_prior_case,'source_run_id',old_run,'labels',_labels,'comment_references',_comments,
   'workflow_status_carried',false,'approvals_carried',false));
END $$;

CREATE FUNCTION private.rs_fail(_tenant uuid,_run uuid,_claim uuid,_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;a uuid;r public.recon_runs%ROWTYPE;
BEGIN SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR q.phase<>'running' OR q.claim_id IS DISTINCT FROM _claim OR _code NOT IN('evaluation_failed','evaluation_budget_exceeded') THEN RAISE EXCEPTION 'rs.claim_failure_conflict' USING ERRCODE='PT409';END IF;
 a:=private.rs_actor(_tenant,q.definition_id,'run');SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant;
 IF r.status<>'failed' OR r.stats ? '_atomic_completion' THEN RAISE EXCEPTION 'rs.native_failure_required' USING ERRCODE='PT409';END IF;
 UPDATE private.rs_requests SET phase='failed',completion=jsonb_build_object('status','failed','error_code',_code) WHERE run_id=_run;
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,a,'execution_failed',jsonb_build_object('claim_id',_claim,'error_code',_code));
 PERFORM private.rs_signal_head(_tenant,q.definition_id);
END $$;

-- Purpose ACLs: table access is NEVER exposed; invoker writes to existing public
-- resources remain under their original native grants, triggers and current RLP.
REVOKE ALL ON private.rs_policies,private.rs_requests,private.rs_attachments,private.rs_attachment_holds,private.rs_groups,private.rs_events FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE sig regprocedure;BEGIN
 FOR sig IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'rs\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION private.rs_actor(uuid,uuid,text),private.rs_prior(uuid,uuid,uuid,jsonb),private.rs_store(uuid,uuid,uuid,jsonb),
 private.rs_claim(uuid,uuid,uuid),private.rs_receipt(uuid,uuid),private.rs_finalize(uuid,uuid,uuid,jsonb,jsonb),private.rs_result_groups(uuid,uuid),private.rs_population(uuid,uuid,text,uuid,uuid,jsonb,integer[]),
 private.rs_carry_event(uuid,uuid,uuid,uuid,jsonb,jsonb),private.rs_fail(uuid,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.request_recon_execution(uuid,uuid,uuid,uuid,text,jsonb),public.claim_recon_execution(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.request_recon_execution(uuid,uuid,uuid,uuid,text,jsonb),public.claim_recon_execution(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION private.rs_carry_candidates(_tenant uuid,_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;
BEGIN SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant AND actor_id=auth.uid();
 IF NOT FOUND OR q.phase<>'completed' THEN RAISE EXCEPTION 'rs.owned_completed_request_required' USING ERRCODE='42501';END IF;
 PERFORM private.rs_actor(_tenant,q.definition_id,'edit');
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('new_case_id',n.native_id,'source_case_id',prior.native_id,'source_run_id',prior.run_id))
 FROM private.rs_groups n CROSS JOIN LATERAL(SELECT o.native_id,o.run_id FROM private.rs_groups o
 JOIN private.rs_requests oq ON oq.run_id=o.run_id AND oq.tenant_id=q.tenant_id AND oq.definition_id=q.definition_id AND oq.phase='completed'
 WHERE o.match_status='break' AND o.identity_key=n.identity_key AND o.run_id<>_run AND oq.created_at<q.created_at
 ORDER BY oq.created_at DESC,oq.run_id DESC LIMIT 1) prior WHERE n.run_id=_run AND n.match_status='break'),'[]');
END $$;

CREATE FUNCTION public.complete_recon_execution(_tenant_id uuid,_run_id uuid,_claim_id uuid,_commit_id uuid,_matches jsonb,_exceptions jsonb,_stats jsonb,_groups jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE r public.recon_runs%ROWTYPE;receipt jsonb;g jsonb;native uuid;used uuid[]:=ARRAY[]::uuid[];bound jsonb:='[]';item jsonb;
 predecessor public.recon_exceptions%ROWTYPE;comments jsonb;carried jsonb;
BEGIN
 SELECT * INTO r FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_owned_run_required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||_tenant_id::text||':'||r.definition_id::text,0));
 -- Serialize before result submission; existing ef8 admission/hash/commit receipt
 -- remains the authoritative writer and lost-ACK provenance, unchanged.
 PERFORM private.rs_validate_prepared_execution(_tenant_id,_run_id);
 receipt:=public.complete_recon_run_atomic(_tenant_id,_run_id,_commit_id,r.definition_snapshot,
  r.approved_revision_id,r.approved_revision_number,r.approved_revision_sha256,_matches,_exceptions,_stats);
 FOR g IN SELECT value FROM jsonb_array_elements(_groups) LOOP
  native:=NULL;
  IF g->>'match_status'='matched' THEN
   item:=_matches->((g->>'ordinal')::integer);
   SELECT id INTO native FROM public.recon_matches WHERE run_id=_run_id AND tenant_id=_tenant_id AND NOT(id=ANY(used))
   AND members=item->'members' AND rule_id IS NOT DISTINCT FROM item->>'rule_id' AND cardinality=item->>'cardinality'
   ORDER BY id LIMIT 1;
  ELSIF g->>'match_status'='break' THEN
   item:=_exceptions->((g->>'ordinal')::integer);
   SELECT id INTO native FROM public.recon_exceptions WHERE run_id=_run_id AND tenant_id=_tenant_id AND NOT(id=ANY(used))
   AND payload=item->'payload' AND reason=item->>'reason' AND side IS NOT DISTINCT FROM item->>'side'
   ORDER BY id LIMIT 1;
  END IF;
  IF native IS NULL THEN RAISE EXCEPTION 'rs.native_group_binding_unavailable' USING ERRCODE='PT409';END IF;
  used:=array_append(used,native);bound:=bound||jsonb_build_array(g||jsonb_build_object('native_id',native));
 END LOOP;
 PERFORM private.rs_finalize(_tenant_id,_run_id,_claim_id,receipt,bound);
 -- Only metadata is inherited. Matching failures, workflow closure, assignment,
 -- approval, financial write-off and resolution are NEVER inferred/carried.
 FOR carried IN SELECT value FROM jsonb_array_elements(private.rs_carry_candidates(_tenant_id,_run_id)) LOOP
  SELECT * INTO predecessor FROM public.recon_exceptions WHERE id=(carried->>'source_case_id')::uuid
   AND tenant_id=_tenant_id AND run_id=(carried->>'source_run_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_predecessor_read_required' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'author_id',author_id,'internal',internal) ORDER BY created_at,id),'[]') INTO comments
   FROM public.break_comments WHERE tenant_id=_tenant_id AND exception_id=predecessor.id;
  IF cardinality(predecessor.labels)>0 THEN
   PERFORM public.apply_exception_workflow_atomic(_tenant_id,ARRAY[(carried->>'new_case_id')::uuid],jsonb_build_object('labels',to_jsonb(predecessor.labels)),NULL,true);
  END IF;
  PERFORM private.rs_carry_event(_tenant_id,_run_id,(carried->>'new_case_id')::uuid,predecessor.id,to_jsonb(predecessor.labels),comments);
 END LOOP;
 RETURN receipt||jsonb_build_object('phase','completed','actor_id',auth.uid(),'input_manifest',private.rs_receipt(_tenant_id,_run_id)->'manifest','execution_kind','fresh','execution',private.rs_receipt(_tenant_id,_run_id));
END $$;

CREATE FUNCTION public.fail_recon_execution(_tenant_id uuid,_run_id uuid,_claim_id uuid,_error_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE r public.recon_runs%ROWTYPE;changed integer;
BEGIN
 SELECT * INTO r FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_owned_run_required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||_tenant_id::text||':'||r.definition_id::text,0));
 PERFORM private.recon_atomic_admit(_tenant_id,_run_id);PERFORM private.rs_actor(_tenant_id,r.definition_id,'run');
 UPDATE public.recon_runs SET status='failed',error=_error_code,completed_at=clock_timestamp()
 WHERE id=_run_id AND tenant_id=_tenant_id AND run_by=auth.uid() AND status='running' AND NOT(stats ? '_atomic_completion');
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'rs.failure_state_not_confirmed' USING ERRCODE='PT409';END IF;
 PERFORM private.rs_fail(_tenant_id,_run_id,_claim_id,_error_code);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(auth.uid(),_tenant_id,'workspace','recon.execution.failed','recon_run',_run_id::text,jsonb_build_object('claim_id',_claim_id,'error_code',_error_code,'result_complete',false));
 RETURN jsonb_build_object('run_id',_run_id,'status','failed');
END $$;

CREATE FUNCTION public.get_recon_execution_workspace(_tenant_id uuid,_definition_id uuid,_page integer DEFAULT 0,_page_size integer DEFAULT 50,_run_id uuid DEFAULT NULL,_search text DEFAULT NULL,_status text DEFAULT 'all',_bu_id uuid DEFAULT NULL,_expected_read_context_signature text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE rows jsonb;current_run jsonb;total bigint;selected public.recon_runs%ROWTYPE;read_context jsonb;
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'read');
 read_context:=public.read_recon_authorized_context(_tenant_id,_definition_id,_bu_id);
 IF _expected_read_context_signature IS NOT NULL AND read_context->>'read_context_signature' IS DISTINCT FROM _expected_read_context_signature
 THEN RAISE EXCEPTION 'rs.authorized_read_context_changed' USING ERRCODE='PT409';END IF;
 IF _page IS NULL OR _page_size IS NULL OR _page NOT BETWEEN 0 AND 1000000 OR _page_size NOT BETWEEN 1 AND 100
 OR length(coalesce(_search,''))>120 OR (_status IN('all','queued','running','completed','failed')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.invalid_history_page' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_definition_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_definition_required' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO total FROM public.recon_runs WHERE tenant_id=_tenant_id AND definition_id=_definition_id AND (_status='all' OR status=_status)
 AND (_search IS NULL OR position(lower(_search) IN lower(coalesce(run_uid,'')||' '||id::text))>0);
 -- No rolling 90-day truncation. All retained historical runs remain pageable.
 SELECT coalesce(jsonb_agg(jsonb_build_object('run',to_jsonb(h),'execution',private.rs_receipt(_tenant_id,h.id)) ORDER BY h.started_at DESC,h.id),'[]') INTO rows
 FROM(SELECT * FROM public.recon_runs WHERE tenant_id=_tenant_id AND definition_id=_definition_id AND (_status='all' OR status=_status)
 AND (_search IS NULL OR position(lower(_search) IN lower(coalesce(run_uid,'')||' '||id::text))>0) ORDER BY started_at DESC,id
 LIMIT _page_size OFFSET (_page::bigint*_page_size)) h;
 SELECT * INTO selected FROM public.recon_runs WHERE tenant_id=_tenant_id AND definition_id=_definition_id AND (_run_id IS NULL OR id=_run_id)
 ORDER BY started_at DESC,id LIMIT 1;
 IF _run_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'rs.historical_run_not_visible' USING ERRCODE='42501';END IF;
 IF selected.id IS NOT NULL THEN current_run:=jsonb_build_object('run',to_jsonb(selected),'execution',private.rs_receipt(_tenant_id,selected.id),
 'groups',coalesce((SELECT jsonb_agg(g||jsonb_build_object('workflow_status',e.status,'lifecycle_state',e.lifecycle_state,
    'id',g->>'native_id','public_case_id',e.public_case_id,'labels',e.labels,'assignee',e.assignee,
    'allowed_actions',CASE WHEN read_context->'edit_allowed'='true'::jsonb AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(g->'source_rows') sr WHERE private.data_source_child_allows(auth.uid(),_tenant_id,(sr.value->>'data_source_id')::uuid,'view') IS DISTINCT FROM true)
      THEN '["comment","label","accept","rematch","carry_forward","exclude_request"]'::jsonb ELSE '[]'::jsonb END,
    'action_requests',private.rs_read_group_intents(_tenant_id,_definition_id,selected.id,(g->>'native_id')::uuid),
    'match_score',m.score,'confidence',m.confidence,'confidence_model',m.confidence_model,'rule_id',m.rule_id,
    'settlement_status',NULL,'settlement_status_available',false,
    'source_lifecycle',private.rs_lifecycle_source(_tenant_id,selected.id,g->'source_rows')) ORDER BY g->>'match_status',(g->>'ordinal')::integer)
 FROM jsonb_array_elements(private.rs_result_groups(_tenant_id,selected.id)) g
 LEFT JOIN public.recon_exceptions e ON e.id=(g->>'native_id')::uuid AND e.run_id=selected.id AND e.tenant_id=_tenant_id AND g->>'match_status'='break'
 LEFT JOIN public.recon_matches m ON m.id=(g->>'native_id')::uuid AND m.run_id=selected.id AND m.tenant_id=_tenant_id AND g->>'match_status'='matched'),'[]'));END IF;
 RETURN jsonb_build_object('tenant_id',_tenant_id,'definition_id',_definition_id,'authorized_read_context',read_context,'selected_run_id',selected.id,'current',current_run,
 'history',rows,'history_count',total::text,'page',_page,'page_size',_page_size,'has_next',((_page::bigint+1)*_page_size<total),
 'history_complete',((_page::bigint+1)*_page_size>=total),'evidence_tier','persisted_native');
END $$;
REVOKE ALL ON FUNCTION private.rs_carry_candidates(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_carry_candidates(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_recon_execution(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),public.fail_recon_execution(uuid,uuid,uuid,text),
 public.get_recon_execution_workspace(uuid,uuid,integer,integer,uuid,text,text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.complete_recon_execution(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),public.fail_recon_execution(uuid,uuid,uuid,text),
 public.get_recon_execution_workspace(uuid,uuid,integer,integer,uuid,text,text,uuid,text) TO authenticated;

-- Affirmation/settlement is a separate SOURCE ACKNOWLEDGEMENT producer. These
-- sealed catalogs start EMPTY. No endpoint accepts a user-supplied final state.
-- Main must bind actual authenticated intake/execution proofs to this append-only
-- attestation port. An empty/missing/unqualified producer never yields a positive.
CREATE TABLE private.rs_source_bindings(binding_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,definition_id uuid NOT NULL,side_id text NOT NULL,
 data_source_id uuid NOT NULL,profile_id text NOT NULL,profile_version text NOT NULL,fields jsonb NOT NULL,qualification jsonb NOT NULL);
CREATE TABLE private.rs_source_attestations(proof_id uuid PRIMARY KEY,binding_id uuid NOT NULL REFERENCES private.rs_source_bindings(binding_id),
 upload_id uuid NOT NULL,rows_sha256 text NOT NULL CHECK(rows_sha256 ~ '^[0-9a-f]{64}$'),authenticated_actor uuid NOT NULL,
 authenticated_at timestamptz NOT NULL,provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'));
CREATE TABLE private.rs_lifecycle_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES private.rs_requests(run_id),
 tenant_id uuid NOT NULL,side_id text NOT NULL,effective_ordinal integer NOT NULL CHECK(effective_ordinal>=0),facet text NOT NULL CHECK(facet IN('affirmation','settlement')),
 state text NOT NULL CHECK(state IN('affirmed','rejected','settled','failed')),source_binding_id uuid NOT NULL REFERENCES private.rs_source_bindings(binding_id),
 proof_id uuid NOT NULL REFERENCES private.rs_source_attestations(proof_id),source_ack_id text NOT NULL,evidence_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),actor_id uuid NOT NULL,
 CHECK((facet='affirmation' AND state IN('affirmed','rejected')) OR (facet='settlement' AND state IN('settled','failed'))),
 UNIQUE(run_id,side_id,effective_ordinal,facet,proof_id));
CREATE TABLE private.rs_lifecycle_requests(tenant_id uuid NOT NULL,actor_id uuid NOT NULL,request_key uuid NOT NULL,intent jsonb NOT NULL,
 event_id uuid NOT NULL REFERENCES private.rs_lifecycle_events(id),PRIMARY KEY(tenant_id,actor_id,request_key));
CREATE TRIGGER rs_binding_immutable BEFORE UPDATE OR DELETE ON private.rs_source_bindings FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_attestation_immutable BEFORE UPDATE OR DELETE ON private.rs_source_attestations FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_lifecycle_event_immutable BEFORE UPDATE OR DELETE ON private.rs_lifecycle_events FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
CREATE TRIGGER rs_lifecycle_request_immutable BEFORE UPDATE OR DELETE ON private.rs_lifecycle_requests FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();

CREATE FUNCTION private.rs_record_lifecycle(_tenant uuid,_run uuid,_side text,_ordinal integer,_facet text,_proof uuid,_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;a uuid;b private.rs_source_bindings%ROWTYPE;proof private.rs_source_attestations%ROWTYPE;
 att private.rs_attachments%ROWTYPE;prior private.rs_lifecycle_requests%ROWTYPE;event private.rs_lifecycle_events%ROWTYPE;
 lineage jsonb;u public.workspace_data_source_uploads%ROWTYPE;row_item jsonb;profile jsonb;state text;ack text;evidence_at timestamptz;intent jsonb;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;
 IF NOT FOUND OR _ordinal IS NULL OR _ordinal<0 OR _key IS NULL OR (_facet IN('affirmation','settlement')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.lifecycle_scope_invalid' USING ERRCODE='22023';END IF;
 a:=private.rs_actor(_tenant,q.definition_id,'edit');
 PERFORM pg_advisory_xact_lock(hashtextextended('rs-lifecycle:'||_tenant::text||':'||a::text||':'||_key::text,0));
 intent:=jsonb_build_object('run_id',_run,'side_id',_side,'ordinal',_ordinal,'facet',_facet,'proof_id',_proof);
 SELECT * INTO prior FROM private.rs_lifecycle_requests WHERE tenant_id=_tenant AND actor_id=a AND request_key=_key;
 IF FOUND THEN IF prior.intent IS DISTINCT FROM intent THEN RAISE EXCEPTION 'rs.lifecycle_request_key_conflict' USING ERRCODE='PT409';END IF;
  SELECT * INTO event FROM private.rs_lifecycle_events WHERE id=prior.event_id;
  RETURN to_jsonb(event)||jsonb_build_object('authenticated_source',true,'request_replay',true,'request_actor_id',a);END IF;
 SELECT * INTO att FROM private.rs_attachments WHERE run_id=_run AND side_id=_side;
 IF NOT FOUND OR NOT(att.selected_ordinals @> jsonb_build_array(_ordinal)) THEN RAISE EXCEPTION 'rs.lifecycle_input_membership_unavailable' USING ERRCODE='42501';END IF;
 lineage:=att.row_lineage->_ordinal;
 SELECT * INTO proof FROM private.rs_source_attestations WHERE proof_id=_proof AND upload_id=(lineage->>'upload_id')::uuid;
 IF NOT FOUND OR proof.provenance->>'state' IS DISTINCT FROM 'authenticated_native_source'
 OR (proof.provenance->>'producer_source_sha256' ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'rs.authenticated_source_proof_required' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM private.rs_source_bindings WHERE binding_id=proof.binding_id AND tenant_id=_tenant AND definition_id=q.definition_id AND side_id=_side AND data_source_id=att.data_source_id;
 IF NOT FOUND OR b.qualification->>'state' IS DISTINCT FROM 'native_qualified'
 OR (b.qualification->>'producer_source_sha256' ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'rs.lifecycle_binding_unqualified' USING ERRCODE='42501';END IF;
 SELECT payload->'policy'->'lifecycle_profiles'->_side INTO profile FROM private.rs_events WHERE run_id=_run AND kind='request_admitted';
 IF profile IS NULL OR profile='null'::jsonb THEN SELECT payload->'profile' INTO profile FROM private.rs_events WHERE run_id=_run
  AND kind='original_source_attested' AND payload->>'proof_id'=_proof::text;END IF;
 IF profile->>'id' IS DISTINCT FROM b.profile_id OR profile->>'version' IS DISTINCT FROM b.profile_version
 OR private.data_source_child_allows(a,_tenant,att.data_source_id,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.pinned_lifecycle_profile_or_source_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=proof.upload_id AND tenant_id=_tenant AND data_source_id=att.data_source_id;
 IF NOT FOUND OR proof.rows_sha256 IS DISTINCT FROM encode(sha256(convert_to(u.rows::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'rs.source_acknowledgement_hash_mismatch' USING ERRCODE='PT409';END IF;
 row_item:=u.rows->((lineage->>'ordinal')::integer);
 state:=row_item->>(b.fields->_facet->>'state_field');ack:=row_item->>(b.fields->_facet->>'ack_id_field');
 evidence_at:=(row_item->>(b.fields->_facet->>'ack_at_field'))::timestamptz;
 IF (_facet='affirmation' AND state IN('affirmed','rejected') OR _facet='settlement' AND state IN('settled','failed')) IS DISTINCT FROM true
 OR ack IS NULL OR length(ack) NOT BETWEEN 1 AND 200 OR evidence_at IS NULL OR evidence_at>proof.authenticated_at OR evidence_at>clock_timestamp()
 THEN RAISE EXCEPTION 'rs.positive_authenticated_acknowledgement_required' USING ERRCODE='42501';END IF;
 -- No deadline can select state='failed'. State comes only from the authenticated
 -- immutable source row. Manual workflow closure/matching has no setter here.
 INSERT INTO private.rs_lifecycle_events(run_id,tenant_id,side_id,effective_ordinal,facet,state,source_binding_id,proof_id,source_ack_id,evidence_at,actor_id)
 VALUES(_run,_tenant,_side,_ordinal,_facet,state,b.binding_id,_proof,ack,evidence_at,a)
 ON CONFLICT(run_id,side_id,effective_ordinal,facet,proof_id) DO NOTHING;
 SELECT * INTO event FROM private.rs_lifecycle_events WHERE run_id=_run AND side_id=_side AND effective_ordinal=_ordinal AND facet=_facet AND proof_id=_proof;
 INSERT INTO private.rs_lifecycle_requests VALUES(_tenant,a,_key,intent,event.id);
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,a,'lifecycle_source_acknowledged',jsonb_build_object('event_id',event.id,'facet',_facet,'state',state,
   'source_binding_id',b.binding_id,'source_ack_id',ack,'proof_id',_proof,'profile_id',b.profile_id,'profile_version',b.profile_version));
 RETURN to_jsonb(event)||jsonb_build_object('authenticated_source',true,'request_replay',false,'request_actor_id',a);
END $$;

CREATE FUNCTION public.record_recon_lifecycle_evidence(_tenant_id uuid,_run_id uuid,_side_id text,_effective_ordinal integer,_facet text,_proof_id uuid,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE result jsonb;upload uuid;
BEGIN
 PERFORM 1 FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_lifecycle_run_required' USING ERRCODE='42501';END IF;
 result:=private.rs_record_lifecycle(_tenant_id,_run_id,_side_id,_effective_ordinal,_facet,_proof_id,_request_key);
 -- The purpose returns only an event, never provider secrets or arbitrary state.
 IF result->'request_replay' IS DISTINCT FROM 'true'::jsonb THEN
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(auth.uid(),_tenant_id,'workspace','recon.lifecycle.source_evidence','recon_run',_run_id::text,result);
 END IF;RETURN result;
END $$;

CREATE FUNCTION private.rs_lifecycle_source(_tenant uuid,_run uuid,_source_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;profile jsonb;policy jsonb;v jsonb;att private.rs_attachments%ROWTYPE;row_item jsonb;ordinal integer;
 result jsonb:='[]';events jsonb;fields jsonb;observed timestamptz:=clock_timestamp();native_timing jsonb;artifact_state jsonb;arrival timestamptz;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;IF NOT FOUND THEN RETURN '[]';END IF;
 PERFORM private.rs_actor(_tenant,q.definition_id,'read');
 SELECT payload->'policy' INTO policy FROM private.rs_events WHERE run_id=_run AND kind='request_admitted';
 FOR v IN SELECT value FROM jsonb_array_elements(_source_rows) LOOP
  ordinal:=coalesce((v->>'effective_ordinal')::integer,(v->>'ordinal')::integer);
  artifact_state:=private.rs_artifact_read_state(_tenant,_run,v->>'side_id');
  row_item:=NULL;arrival:=NULL;
  IF artifact_state->'available'='true'::jsonb THEN
   SELECT * INTO att FROM private.rs_attachments WHERE run_id=_run AND side_id=v->>'side_id';row_item:=att.rows->ordinal;arrival:=att.arrival_at;
  ELSE
   SELECT arrival_at INTO arrival FROM private.rs_attachments WHERE run_id=_run AND side_id=v->>'side_id';
  END IF;
  profile:=policy->'lifecycle_profiles'->(v->>'side_id');
  IF profile IS NULL OR profile='null'::jsonb THEN SELECT payload->'profile' INTO profile FROM private.rs_events WHERE run_id=_run
   AND kind='original_source_attested' AND payload->'profile'->>'id'='approved-mapping-lifecycle:'||(v->>'side_id') ORDER BY occurred_at DESC LIMIT 1;END IF;
  fields:=profile->'date_fields';
  SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('authenticated_source',true) ORDER BY e.recorded_at,e.id),'[]') INTO events
   FROM private.rs_lifecycle_events e WHERE e.run_id=_run AND e.side_id=v->>'side_id' AND e.effective_ordinal=ordinal;
  native_timing:=NULL;
  IF profile->>'id' IS NOT NULL AND profile->>'version' IS NOT NULL AND profile->>'affirmation_cutoff_at' IS NOT NULL AND profile->>'settlement_due_at' IS NOT NULL THEN
   native_timing:=jsonb_build_object('profile_id',profile->>'id','profile_version',profile->>'version','observed_at',observed,'qualified_native_observation',true,
    'affirmation_deadline',CASE WHEN observed<(profile->>'affirmation_cutoff_at')::timestamptz THEN 'not_due' WHEN observed=(profile->>'affirmation_cutoff_at')::timestamptz THEN 'at_cutoff' ELSE 'past_due' END,
    'settlement_deadline',CASE WHEN observed<(profile->>'settlement_due_at')::timestamptz THEN 'not_due' WHEN observed=(profile->>'settlement_due_at')::timestamptz THEN 'at_cutoff' ELSE 'past_due' END,
    'evidence_timings',coalesce((SELECT jsonb_object_agg(id::text,CASE WHEN evidence_at>(profile->>'affirmation_cutoff_at')::timestamptz THEN 'late' ELSE 'on_time' END)
     FROM private.rs_lifecycle_events WHERE run_id=_run AND side_id=v->>'side_id' AND effective_ordinal=ordinal AND facet='affirmation'),'{}'));
  END IF;
  result:=result||jsonb_build_array(jsonb_build_object('side_id',v->>'side_id','source_row_id',v->>'source_row_id',
   'profile',CASE WHEN profile->>'id' IS NOT NULL AND profile->>'version' IS NOT NULL THEN profile ELSE NULL END,
   'observed_at',observed,'native_timing',native_timing,'events',events,'trade_date',row_item->>(fields->>'trade_date'),'value_date',row_item->>(fields->>'value_date'),
   'business_date',coalesce(row_item->>(fields->>'business_date'),row_item->>(policy->'date_fields'->(v->>'side_id')->>(policy->>'date_basis'))),
   'original_source_record',row_item,'artifact_read',artifact_state,'arrival_at',arrival));
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON private.rs_source_bindings,private.rs_source_attestations,private.rs_lifecycle_events,private.rs_lifecycle_requests FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.rs_record_lifecycle(uuid,uuid,text,integer,text,uuid,uuid),private.rs_lifecycle_source(uuid,uuid,jsonb),public.record_recon_lifecycle_evidence(uuid,uuid,text,integer,text,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_record_lifecycle(uuid,uuid,text,integer,text,uuid,uuid),private.rs_lifecycle_source(uuid,uuid,jsonb),public.record_recon_lifecycle_evidence(uuid,uuid,text,integer,text,uuid,uuid) TO authenticated;


-- FROZEN INPUT RECON-READ-CONTEXT.sql SHA256 1decf0c68c474984d928bdd2b9a42f7ab4465e916325c44c4cf7020d2a946460
-- Real authorized-read observation; NOT a permission epoch or a control epoch.
-- Current native account/MFA/resource/feature predicates are the authority.
CREATE FUNCTION public.read_recon_authorized_context(_tenant_id uuid,_definition_id uuid,_bu_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $read_context$
DECLARE actor uuid;definition public.recon_definitions%ROWTYPE;binding jsonb;observed timestamptz:=statement_timestamp();
BEGIN
 actor:=private.rs_actor(_tenant_id,_definition_id,'read');
 SELECT * INTO definition FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_visible_read_definition_required' USING ERRCODE='42501';END IF;
 IF _bu_id IS NOT NULL THEN
  PERFORM 1 FROM public.business_units WHERE id=_bu_id AND tenant_id=_tenant_id AND is_archived IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_visible_bu_context_required' USING ERRCODE='42501';END IF;
 END IF;
 binding:=jsonb_build_object('actor_id',actor,'tenant_id',definition.tenant_id,'definition_id',definition.id,'bu_id',_bu_id,
  'read_allowed',private.recon_run_read_allowed(definition.id,definition.tenant_id) AND private.recon_run_effective_read_allowed(definition.id,definition.tenant_id),
  'run_allowed',private.recon_root_write_allowed(definition.id,definition.tenant_id,'run'),
  'edit_allowed',private.recon_root_write_allowed(definition.id,definition.tenant_id,'edit'),
  'definition_access_mode',definition.access_mode,'governance_state',definition.governance_state,
  'environment',definition.environment,'definition_status',definition.status);
 IF binding->'read_allowed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'rs.current_native_read_denied' USING ERRCODE='42501';END IF;
 RETURN binding||jsonb_build_object('protocol','recon_authorized_read_context_v1','read_context_id',gen_random_uuid(),
  'observed_at',observed,'read_context_signature',encode(sha256(convert_to(binding::text,'UTF8')),'hex'),
  'authority','current_native_reconciliation_read','permission_epoch_available',false,'control_epoch_used_as_permission_epoch',false);
END $read_context$;
REVOKE ALL ON FUNCTION public.read_recon_authorized_context(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_recon_authorized_context(uuid,uuid,uuid) TO authenticated;

-- No raw artifact bytes are returned after the exact run's expiry/tombstone.
-- Original receipt, native group identity, audit and source ACK events remain.
CREATE FUNCTION private.rs_artifact_read_state(_tenant uuid,_run uuid,_side text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $artifact_state$
DECLARE q private.rs_requests%ROWTYPE;expiry timestamptz;held boolean;tombstoned boolean;available boolean;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.exact_artifact_run_unavailable' USING ERRCODE='42501';END IF;
 PERFORM private.rs_actor(_tenant,q.definition_id,'read');
 expiry:=(q.attachment_receipt->>'expires_at')::timestamptz;
 held:=EXISTS(SELECT 1 FROM private.rs_attachment_holds WHERE run_id=_run);
 tombstoned:=q.attachment_receipt->'tombstoned'='true'::jsonb OR EXISTS(
  SELECT 1 FROM private.rs_events WHERE run_id=_run AND kind IN('attachment_tombstoned','artifact_tombstoned')
  AND (payload->>'side_id' IS NULL OR _side IS NULL OR payload->>'side_id'=_side));
 tombstoned:=coalesce(tombstoned,false);
 available:=NOT tombstoned AND expiry IS NOT NULL AND (statement_timestamp()<expiry OR held);
 RETURN jsonb_build_object('available',available,'state',CASE WHEN tombstoned THEN 'tombstoned' WHEN available THEN 'available' ELSE 'expired' END,
  'run_id',q.run_id,'side_id',_side,'expires_at',expiry,'legal_hold',held,'metadata_retained',true,
  'physical_purge_performed',false,'reason',CASE WHEN tombstoned THEN 'Original execution attachment is tombstoned; retained run and event metadata remain.'
   WHEN NOT available THEN 'Original execution attachment availability expired; retained run and event metadata remain.' ELSE NULL END);
END $artifact_state$;
REVOKE ALL ON FUNCTION private.rs_artifact_read_state(uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_artifact_read_state(uuid,uuid,text) TO authenticated;


-- FROZEN INPUT RECON-DISPATCH-PRODUCER.sql SHA256 5aba74e369ef480d9217dd1cb2dcf66b5ab4f1c58523c5dfc1a1ec47db71b90f
-- Durable intent uses the original rs_requests actor. Dispatch NEVER creates
-- another subject, stores credentials or substitutes JWT/MFA/role claims.
CREATE TABLE public.recon_execution_dispatch_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 definition_id uuid NOT NULL,actor_id uuid NOT NULL,run_id uuid NOT NULL REFERENCES public.recon_runs(id),
 kind text NOT NULL CHECK(kind='ready_for_authenticated_dispatch'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(run_id,kind));
ALTER TABLE public.recon_execution_dispatch_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recon_execution_dispatch_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.recon_execution_dispatch_events TO authenticated;
CREATE POLICY rs_dispatch_owner_read ON public.recon_execution_dispatch_events FOR SELECT TO authenticated USING(
 actor_id=auth.uid() AND private.rlnext_account_allowed(auth.uid(),NULL) AND private.rlnext_account_allowed(auth.uid(),tenant_id)
 AND private.recon_run_effective_read_allowed(definition_id,tenant_id));

CREATE FUNCTION private.rs_signal_head(_tenant uuid,_definition uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q private.rs_requests%ROWTYPE;
BEGIN
 -- Invoked only after authenticated admission/completion/failure. Target is the
 -- exact next persisted intent, never an arbitrary recipient or actor alias.
 PERFORM private.rs_actor(_tenant,_definition,'run');
 SELECT * INTO q FROM private.rs_requests WHERE tenant_id=_tenant AND definition_id=_definition AND phase='queued' ORDER BY created_at,run_id LIMIT 1;
 IF FOUND AND NOT EXISTS(SELECT 1 FROM public.recon_runs WHERE tenant_id=_tenant AND definition_id=_definition AND status='running') THEN
  INSERT INTO public.recon_execution_dispatch_events(tenant_id,definition_id,actor_id,run_id,kind)
  VALUES(q.tenant_id,q.definition_id,q.actor_id,q.run_id,'ready_for_authenticated_dispatch') ON CONFLICT(run_id,kind) DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION private.rs_next_owned(_tenant uuid,_definition uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q private.rs_requests%ROWTYPE;a uuid:=auth.uid();r public.recon_runs%ROWTYPE;
BEGIN
 IF a IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR private.rlnext_account_allowed(a,NULL) IS DISTINCT FROM true
 OR private.rlnext_account_allowed(a,_tenant) IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.current_authenticated_dispatch_actor_required' USING ERRCODE='42501';END IF;
 SELECT own.* INTO q FROM private.rs_requests own WHERE own.tenant_id=_tenant AND own.actor_id=a AND own.phase='queued'
 AND (_definition IS NULL OR own.definition_id=_definition)
 AND NOT EXISTS(SELECT 1 FROM private.rs_requests beforeq WHERE beforeq.tenant_id=own.tenant_id AND beforeq.definition_id=own.definition_id
  AND beforeq.phase IN('queued','running') AND (beforeq.created_at,beforeq.run_id)<(own.created_at,own.run_id))
 AND NOT EXISTS(SELECT 1 FROM public.recon_runs active WHERE active.tenant_id=own.tenant_id AND active.definition_id=own.definition_id AND active.status='running')
 ORDER BY own.created_at,own.run_id LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('actor_id',a,'tenant_id',_tenant,'state','no_owned_ready_head');END IF;
 PERFORM private.rs_actor(_tenant,q.definition_id,'run');PERFORM private.recon_atomic_admit(_tenant,q.run_id);
 SELECT * INTO r FROM public.recon_runs WHERE id=q.run_id AND tenant_id=_tenant AND run_by=a;
 RETURN jsonb_build_object('actor_id',a,'tenant_id',q.tenant_id,'definition_id',q.definition_id,'state','owned_ready_head','run_id',r.id,
  'run_uid',r.run_uid,'status',r.status,'phase',q.phase,'input_manifest',q.manifest);
END $$;
CREATE FUNCTION public.next_owned_recon_execution(_tenant_id uuid,_definition_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE result jsonb;
BEGIN result:=private.rs_next_owned(_tenant_id,_definition_id);
 IF result->>'run_id' IS NOT NULL THEN PERFORM 1 FROM public.recon_runs WHERE id=(result->>'run_id')::uuid AND tenant_id=_tenant_id AND run_by=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_dispatch_rlp_denied' USING ERRCODE='42501';END IF;END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.rs_signal_head(uuid,uuid),private.rs_next_owned(uuid,uuid),public.next_owned_recon_execution(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_signal_head(uuid,uuid),private.rs_next_owned(uuid,uuid),public.next_owned_recon_execution(uuid,uuid) TO authenticated;


-- FROZEN INPUT RECON-RULE-PRODUCER.sql SHA256 e1f6f2c3d7dfd10d77441f9abc6aefbf98afe885b339ca46e57da7d6cefacae6
-- Expected domains are declared by the IMMUTABLE approved matching rules,
-- never inferred from the incoming dataset, source samples or current schema.
CREATE FUNCTION private.rs_approved_rule_contracts(_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE s jsonb;r jsonb;name text;domain text;fields jsonb;old jsonb;outv jsonb:='[]';k text;nrl jsonb;ref jsonb;refs jsonb;
BEGIN
 IF jsonb_typeof(_snapshot->'sides') IS DISTINCT FROM 'array' OR jsonb_typeof(_snapshot->'rules') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'rs.actual_approved_rules_required' USING ERRCODE='22023';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(_snapshot->'sides') LOOP
  fields:='{}';
  FOR r IN SELECT value FROM jsonb_array_elements(_snapshot->'rules') LOOP
   k:=r->>'kind';name:=r->'fields'->>(s->>'side_id');
   IF k='nrl_rule' THEN
    nrl:=r->'params'->'nrl_rule';
    IF jsonb_typeof(nrl) IS DISTINCT FROM 'object' OR (nrl->>'kind' IN('match','rollup')) IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'rs.actual_approved_nrl_ast_required' USING ERRCODE='42501';END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('column',x->>'column','domain',CASE WHEN nrl->'match'->'tolerance' IS NOT NULL
      AND (x=nrl->'match'->'left' OR x=nrl->'match'->'right') THEN 'numeric' ELSE 'primitive' END)),'[]') INTO refs
     FROM jsonb_path_query(nrl,'$.** ? (@.side == $side && exists (@.column))',jsonb_build_object('side',s->>'side_id')) x;
    IF nrl->>'kind'='rollup' AND nrl->>'side'=s->>'side_id' THEN refs:=refs||jsonb_build_array(
      jsonb_build_object('column',nrl->>'groupBy','domain','primitive'),jsonb_build_object('column',nrl->'aggregate'->>'column','domain',CASE WHEN nrl->'aggregate'->>'fn'='count' THEN 'primitive' ELSE 'numeric' END));END IF;
    FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
     name:=ref->>'column';IF name IS NULL OR name='' THEN RAISE EXCEPTION 'rs.nrl_expected_field_unavailable' USING ERRCODE='42501';END IF;old:=fields->name;
     fields:=fields||jsonb_build_object(name,jsonb_build_object('name',name,'required',true,'domains',coalesce(old->'domains','[]')||jsonb_build_array(ref->>'domain'),
      'rule_ids',coalesce(old->'rule_ids','[]')||jsonb_build_array(r->>'id'),'rule_kinds',coalesce(old->'rule_kinds','[]')||jsonb_build_array(k),
      'numeric_representation','number_or_exact_decimal_string','date_representation','iso_calendar_date_or_offset_timestamp'));
    END LOOP;
    CONTINUE;
   END IF;
   IF name IS NULL OR name='' THEN CONTINUE;END IF;
   domain:=CASE WHEN k IN('numeric_equals','numeric_tolerance_abs','numeric_tolerance_pct','amount_sign_flip','sum_to_match','many_to_one_sum','one_to_many_sum','roll_up','multiply','value_range') THEN 'numeric'
    WHEN k IN('date_equals','date_tolerance_days','date_within_range','date_age_days','ignore_day_portion') THEN 'date'
    WHEN k IN('case_insensitive_match','trimmed_match','string_contains','string_starts_with','string_ends_with','regex_match','fuzzy_levenshtein','phonetic_soundex','currency_equals') THEN 'string'
    WHEN k='boolean_equals' THEN 'boolean' WHEN k IN('non_null','reference_lookup','conditional_set','multi_pass','quick_fix') THEN 'any'
    WHEN k IN('exact_match','unique','in_set','nrl_rule') THEN 'primitive' ELSE NULL END;
   IF domain IS NULL THEN RAISE EXCEPTION 'rs.approved_rule_registry_semantics_unqualified: %',k USING ERRCODE='42501';END IF;
   old:=fields->name;
   fields:=fields||jsonb_build_object(name,jsonb_build_object('name',name,'required',true,'domains',coalesce(old->'domains','[]')||jsonb_build_array(domain),
    'rule_ids',coalesce(old->'rule_ids','[]')||jsonb_build_array(r->>'id'),'rule_kinds',coalesce(old->'rule_kinds','[]')||jsonb_build_array(k),
    'numeric_representation','number_or_exact_decimal_string','date_representation','iso_calendar_date_or_offset_timestamp'));
  END LOOP;
  outv:=outv||jsonb_build_array(jsonb_build_object('side_id',s->>'side_id','data_source_id',s->>'data_source_id',
   'provenance','approved_rule_contract','contract_version','approved_rule_contract_v1',
   'rules_sha256',encode(sha256(convert_to((_snapshot->'rules')::text,'UTF8')),'hex'),
   'logical_side',s->>'logical_side','logical_side_resolution',CASE WHEN s->>'logical_side' IS NULL THEN 'unique_native_compatible_cohort' ELSE 'approved_explicit' END,
   'fields',coalesce((SELECT jsonb_agg(value ORDER BY key) FROM jsonb_each(fields)),'[]')));
 END LOOP;RETURN outv;
END $$;

CREATE FUNCTION private.rs_contract_row_allowed(_row jsonb,_contract jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE f jsonb;value jsonb;domain text;text_value text;parts text[];parsed timestamptz;day date;
BEGIN
 IF jsonb_typeof(_row) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 FOR f IN SELECT x.value FROM jsonb_array_elements(coalesce(_contract->'fields','[]')) x UNION ALL
  SELECT x.value FROM jsonb_array_elements(coalesce(_contract->'source_declared_fields','[]')) x LOOP
  value:=_row->(f->>'name');
  IF f->'required'='true'::jsonb AND (value IS NULL OR value='null'::jsonb OR value='""'::jsonb) THEN RETURN false;END IF;
  IF value IS NULL OR value='null'::jsonb THEN CONTINUE;END IF;
  IF f->>'json_type' IS NOT NULL AND jsonb_typeof(value) IS DISTINCT FROM f->>'json_type' THEN RETURN false;END IF;
  FOR domain IN SELECT jsonb_array_elements_text(coalesce(f->'domains','[]')) LOOP
   IF domain='any' THEN CONTINUE;
   ELSIF domain='primitive' THEN IF jsonb_typeof(value) NOT IN('string','number','boolean') THEN RETURN false;END IF;
   ELSIF domain='string' THEN IF jsonb_typeof(value) NOT IN('string','number','boolean') THEN RETURN false;END IF;
   ELSIF domain='boolean' THEN IF jsonb_typeof(value) NOT IN('boolean','string','number') THEN RETURN false;END IF;
   ELSIF domain='numeric' THEN
    IF jsonb_typeof(value) NOT IN('string','number') THEN RETURN false;END IF;
    IF jsonb_typeof(value)='number' AND abs((value::text)::numeric)>9007199254740991 THEN RETURN false;END IF;
    text_value:=replace(replace(value#>>'{}',',',''),' ','');
    IF length(text_value)>200 THEN RETURN false;END IF;
    parts:=regexp_match(text_value,'^[+-]?(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$');
    IF parts IS NULL OR length(coalesce(parts[2],parts[3],''))>100 OR length(coalesce(parts[4],''))>4 OR abs(coalesce(parts[4],'0')::integer)>100 THEN RETURN false;END IF;
   ELSIF domain='date' THEN
    IF jsonb_typeof(value)<>'string' THEN RETURN false;END IF;text_value:=value#>>'{}';
    IF text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2}))?$' THEN RETURN false;END IF;
    BEGIN day:=substr(text_value,1,10)::date;IF day::text<>substr(text_value,1,10) THEN RETURN false;END IF;
     IF length(text_value)>10 THEN parsed:=text_value::timestamptz;END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;END;
   ELSE RETURN false;END IF;
  END LOOP;
 END LOOP;RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.rs_approved_rule_contracts(jsonb),private.rs_contract_row_allowed(jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_approved_rule_contracts(jsonb),private.rs_contract_row_allowed(jsonb,jsonb) TO authenticated;

-- A legacy approved rule contract can select a single compatible published
-- logical cohort. Ambiguity remains an explicit configuration error; no row is
-- relabelled and the incoming rows do not define expected fields/domains.
CREATE FUNCTION private.rs_select_compatible_logical_side(_tenant uuid,_dataset uuid,_contract jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE d public.data_prep_prepared_datasets%ROWTYPE;u public.workspace_data_source_uploads%ROWTYPE;r public.data_prep_delivery_runs%ROWTYPE;
 actor uuid:=private.dpw_actor(_tenant);side text;indexes integer[];accepted text[]:=ARRAY[]::text[];
BEGIN
 SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE id=_dataset AND tenant_id=_tenant;
 IF NOT FOUND OR private.dpw_source_allows(actor,_tenant,d.data_source_id,'view') IS DISTINCT FROM true
 OR private.data_prep_pipeline_scope_allows(actor,_tenant,d.pipeline_id,'view') IS DISTINCT FROM true
 OR private.dpw_run_payload_available(d.run_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.current_dataset_scope_required' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=d.run_id AND tenant_id=_tenant;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=d.upload_id AND tenant_id=_tenant AND data_source_id=d.data_source_id;
 IF NOT FOUND OR private.dpw_hash(u.rows) IS DISTINCT FROM d.content_sha256 THEN RAISE EXCEPTION 'rs.dataset_native_hash_changed' USING ERRCODE='42501';END IF;
 FOR side IN SELECT DISTINCT value->>'business_side' FROM jsonb_array_elements(r.snapshot->'feeds') WHERE value->>'business_side' IS NOT NULL LOOP
  indexes:=private.dpw_dataset_indexes(d.id,side);
  IF cardinality(indexes)>0 AND NOT EXISTS(SELECT 1 FROM unnest(indexes) i WHERE NOT private.rs_contract_row_allowed(u.rows->i,_contract))
  THEN accepted:=array_append(accepted,side);END IF;
 END LOOP;
 IF cardinality(accepted)<>1 THEN RAISE EXCEPTION 'rs.unique_approved_rule_compatible_logical_side_required' USING ERRCODE='42501';END IF;
 RETURN accepted[1];
END $$;
REVOKE ALL ON FUNCTION private.rs_select_compatible_logical_side(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_select_compatible_logical_side(uuid,uuid,jsonb) TO authenticated;


-- FROZEN INPUT RECON-CONTRACT-PRODUCER.sql SHA256 f5f6d18587481de31db6f3c3f15d51cc5c7d11c39ebf2f2f4b9a553f99fc34a4
-- Native expected schema producer for FUTURE Save/Govern, without UI/step changes.
-- Catalog starts EMPTY. Profiles are independently qualified schema configuration;
-- do not populate them from the incoming run dataset, samples or inferred_schema.
CREATE TABLE private.rs_schema_profiles(tenant_id uuid NOT NULL,data_source_id uuid NOT NULL,profile_id uuid NOT NULL,version text NOT NULL,
 logical_side text NOT NULL,fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='array'),column_mapping jsonb NOT NULL CHECK(jsonb_typeof(column_mapping)='object'),
 qualification jsonb NOT NULL CHECK(jsonb_typeof(qualification)='object'),PRIMARY KEY(tenant_id,data_source_id,profile_id,version));
CREATE TRIGGER rs_schema_profile_immutable BEFORE UPDATE OR DELETE ON private.rs_schema_profiles FOR EACH ROW EXECUTE FUNCTION private.rs_immutable();
REVOKE ALL ON private.rs_schema_profiles FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rs_schema_profile(_tenant uuid,_source uuid,_mapping jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE p private.rs_schema_profiles%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR private.rlnext_account_allowed(auth.uid(),_tenant) IS DISTINCT FROM true
 OR private.data_source_child_allows(auth.uid(),_tenant,_source,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.schema_source_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM private.rs_schema_profiles WHERE tenant_id=_tenant AND data_source_id=_source AND column_mapping=_mapping
 AND qualification->>'state'='native_qualified' AND qualification->>'kind'='authoritative_schema_configuration'
 AND qualification->>'producer_source_sha256' ~ '^[0-9a-f]{64}$' ORDER BY version DESC;
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Ambiguous profile selections require an explicit source configuration choice.
 IF (SELECT count(*) FROM private.rs_schema_profiles WHERE tenant_id=_tenant AND data_source_id=_source AND column_mapping=_mapping
 AND qualification->>'state'='native_qualified' AND qualification->>'kind'='authoritative_schema_configuration')<>1
 THEN RAISE EXCEPTION 'rs.explicit_schema_profile_required' USING ERRCODE='PT409';END IF;
 IF p.logical_side='' OR jsonb_array_length(p.fields)=0 OR (SELECT count(DISTINCT x->>'name') FROM jsonb_array_elements(p.fields) x)<>jsonb_array_length(p.fields)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.fields) f WHERE coalesce(f->>'name','')='' OR (f->>'json_type' IN('string','number','boolean','object','array')) IS DISTINCT FROM true OR jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean')
 THEN RAISE EXCEPTION 'rs.qualified_schema_invalid' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('profile_id',p.profile_id,'profile_version',p.version,'logical_side',p.logical_side,'fields',p.fields,
 'column_mapping',p.column_mapping,'schema_sha256',encode(sha256(convert_to(jsonb_build_object('logical_side',p.logical_side,'fields',p.fields,'column_mapping',p.column_mapping)::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION public.capture_recon_creation_contracts(_tenant_id uuid,_sides jsonb,_mappings jsonb,_rules jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE s jsonb;mapping jsonb;contract jsonb;declared jsonb;rule_contracts jsonb;result jsonb:='[]';complete boolean:=true;
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant_id,'recons');
 IF jsonb_typeof(_sides) IS DISTINCT FROM 'array' OR jsonb_array_length(_sides) NOT BETWEEN 1 AND 3 OR jsonb_typeof(_mappings) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'rs.creation_schema_scope_invalid' USING ERRCODE='22023';END IF;
 rule_contracts:=private.rs_approved_rule_contracts(jsonb_build_object('sides',_sides,'rules',_rules));
 FOR s IN SELECT value FROM jsonb_array_elements(_sides) LOOP
  PERFORM 1 FROM public.workspace_data_sources WHERE id=(s->>'data_source_id')::uuid AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_creation_source_required' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_object_agg(key,value->>(s->>'side_id')) FILTER(WHERE coalesce(value->>(s->>'side_id'),'')<>''),'{}') INTO mapping FROM jsonb_each(_mappings);
  declared:=private.rs_schema_profile(_tenant_id,(s->>'data_source_id')::uuid,mapping);
  SELECT value INTO contract FROM jsonb_array_elements(rule_contracts) WHERE value->>'side_id'=s->>'side_id';
  IF declared IS NOT NULL THEN contract:=contract||jsonb_build_object('source_declared_fields',declared->'fields','source_schema_profile',declared,
   'logical_side',declared->'logical_side','logical_side_resolution','approved_explicit');END IF;
  contract:=contract||jsonb_build_object('approval_bound',false,'column_mapping',mapping);
  result:=result||jsonb_build_array((s-'input_contract')||jsonb_build_object('column_mapping',mapping,'input_contract',contract,
    'input_contract_state','declared_from_selected_rules'));
 END LOOP;RETURN jsonb_build_object('tenant_id',_tenant_id,'sides',result,'all_contracts_qualified',complete,
 'schema_source','selected_mapping_and_rule_registry_declaration','incoming_rows_used_to_define_expected_schema',false);
END $$;

CREATE FUNCTION private.rs_recon_input_contracts(_tenant uuid,_definition uuid,_revision uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE v public.recon_definition_approved_versions%ROWTYPE;s jsonb;c jsonb;p private.rs_schema_profiles%ROWTYPE;contracts jsonb:='[]';missing jsonb:='[]';expected jsonb;rules_contracts jsonb;rule_contract jsonb;
BEGIN
 PERFORM private.rs_actor(_tenant,_definition,'read');
 SELECT * INTO v FROM public.recon_definition_approved_versions WHERE id=_revision AND tenant_id=_tenant AND parent_definition_id=_definition;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.actual_approved_revision_required' USING ERRCODE='42501';END IF;
 rules_contracts:=private.rs_approved_rule_contracts(v.snapshot);
 FOR s IN SELECT value FROM jsonb_array_elements(v.snapshot->'sides') LOOP
  SELECT value INTO rule_contract FROM jsonb_array_elements(rules_contracts) WHERE value->>'side_id'=s->>'side_id';
  c:=s->'input_contract';
  IF c IS NULL OR c='null'::jsonb THEN
   SELECT x->'input_contract' INTO c FROM jsonb_array_elements(coalesce(v.snapshot->'sources','[]')) x
    WHERE x->>'side_id'=s->>'side_id' AND x->>'data_source_id'=s->>'data_source_id';
  END IF;
  IF c->>'provenance'='approved_rule_contract' THEN
   IF c->>'rules_sha256' IS DISTINCT FROM rule_contract->>'rules_sha256' THEN RAISE EXCEPTION 'rs.frozen_rule_declaration_mismatch' USING ERRCODE='PT409';END IF;
   IF c->'source_schema_profile' IS NOT NULL THEN c:=c->'source_schema_profile';ELSE c:=NULL;END IF;
  END IF;
  IF c IS NULL OR c='null'::jsonb THEN
   contracts:=contracts||jsonb_build_array(rule_contract||jsonb_build_object('approval_bound',true,'approved_revision_id',v.id,'upload_id',s->>'upload_id'));
   CONTINUE;
  END IF;
  SELECT * INTO p FROM private.rs_schema_profiles WHERE tenant_id=_tenant AND data_source_id=(s->>'data_source_id')::uuid
   AND profile_id=(c->>'profile_id')::uuid AND version=c->>'profile_version';
  IF NOT FOUND OR p.qualification->>'state' IS DISTINCT FROM 'native_qualified' OR p.qualification->>'kind' IS DISTINCT FROM 'authoritative_schema_configuration'
   OR (p.qualification->>'producer_source_sha256' ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.approved_schema_profile_unqualified' USING ERRCODE='42501';END IF;
  expected:=jsonb_build_object('profile_id',p.profile_id,'profile_version',p.version,'logical_side',p.logical_side,'fields',p.fields,'column_mapping',p.column_mapping,
   'schema_sha256',encode(sha256(convert_to(jsonb_build_object('logical_side',p.logical_side,'fields',p.fields,'column_mapping',p.column_mapping)::text,'UTF8')),'hex'));
  IF expected IS DISTINCT FROM c THEN RAISE EXCEPTION 'rs.approved_schema_changed_or_forged' USING ERRCODE='PT409';END IF;
  contracts:=contracts||jsonb_build_array(rule_contract||jsonb_build_object('approval_bound',true,'approved_revision_id',v.id,
   'logical_side',c->'logical_side','logical_side_resolution','approved_explicit','source_declared_fields',c->'fields','source_schema_profile',c,'upload_id',s->>'upload_id'));
 END LOOP;
 RETURN jsonb_build_object('input_contracts',contracts,'missing_contract_sides',missing,'contract_available',jsonb_array_length(missing)=0,
  'reconciliation_feature_enabled',true,'revision_id',v.id,'snapshot_sha256',v.snapshot_sha256);
END $$;

CREATE FUNCTION public.read_recon_contract(_tenant_id uuid,_definition_id uuid,_revision_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE d public.recon_definitions%ROWTYPE;v public.recon_definition_approved_versions%ROWTYPE;contracts jsonb;current_sha text;
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'read');
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_contract_definition_required' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=_definition_id
 AND (_revision_id IS NULL OR id=_revision_id) ORDER BY version_number DESC LIMIT 1;
 current_sha:=encode(sha256(convert_to(private.recon_definition_config_snapshot(d)::text,'UTF8')),'hex');
 IF v.id IS NULL THEN RETURN jsonb_build_object('tenant_id',_tenant_id,'definition_id',_definition_id,'approved',false,
 'contract_available',false,'snapshot_sha256',NULL,'expected_definition_sha256',NULL,'current_definition_sha256',current_sha,
 'sides',d.sides,'pins',(SELECT jsonb_agg(jsonb_build_object('side_id',x->>'side_id','upload_id',x->>'upload_id')) FROM jsonb_array_elements(d.sides) x),
 'input_contracts','[]'::jsonb,'reason','approved_revision_unavailable','native_hash_algorithm','sha256_pg_jsonb_text');END IF;
 contracts:=private.rs_recon_input_contracts(_tenant_id,_definition_id,v.id);
 RETURN contracts||jsonb_build_object('tenant_id',_tenant_id,'definition_id',_definition_id,'approved',true,'revision_id',v.id,'revision_number',v.version_number,
 'snapshot_sha256',v.snapshot_sha256,'expected_definition_sha256',v.snapshot_sha256,'current_definition_sha256',current_sha,
 'current_revision',current_sha=v.snapshot_sha256,'approved_snapshot',v.snapshot,'sides',v.snapshot->'sides',
 'pins',(SELECT jsonb_agg(jsonb_build_object('side_id',x->>'side_id','upload_id',x->>'upload_id')) FROM jsonb_array_elements(v.snapshot->'sides') x),
 'native_hash_algorithm','sha256_pg_jsonb_text','historical_approved_snapshot_rewritten',false);
END $$;
REVOKE ALL ON FUNCTION private.rs_schema_profile(uuid,uuid,jsonb),private.rs_recon_input_contracts(uuid,uuid,uuid),public.capture_recon_creation_contracts(uuid,jsonb,jsonb,jsonb),public.read_recon_contract(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_schema_profile(uuid,uuid,jsonb),private.rs_recon_input_contracts(uuid,uuid,uuid),public.capture_recon_creation_contracts(uuid,jsonb,jsonb,jsonb),public.read_recon_contract(uuid,uuid,uuid) TO authenticated;


-- FROZEN INPUT RECON-SCHEMA-BRIDGE.sql SHA256 5709c1322aad5d187d089b3a0e0a2a31ec51e8931f9f4ad408b079cec7d76480
-- Pasteur / main integrates ONLY into its owned dpw_recon_schema_contract stub.
-- This is a complete body replacement proposal, not an existing-provider claim.
CREATE OR REPLACE FUNCTION private.dpw_recon_schema_contract(_tenant uuid,_definition uuid,_revision uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE contract jsonb;
BEGIN
 contract:=private.rs_recon_input_contracts(_tenant,_definition,_revision);
 -- Existing fixed approved pins do not borrow invented expected types. DPW's
 -- preflight requires typed contracts for EACH selected prepared_dataset side.
 IF jsonb_typeof(contract->'input_contracts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'dpw.approved_typed_input_contract_unavailable' USING ERRCODE='42501';END IF;
 RETURN contract;
END $$;


-- FROZEN INPUT RECON-QUEUE-PRODUCER.sql SHA256 ac15027b0b03837745642178052c95e030ad14340ea6d686cd202c75b9724195
-- NEW owned purpose factory. Requires Pasteur/main's queued creator compatibility
-- patch below; no second run/adoption of a historical run is permitted.
CREATE FUNCTION public.create_recon_execution_from_prepared(_tenant_id uuid,_definition_id uuid,_business_date date,_bindings jsonb,_request_key uuid,
 _expected_definition_sha256 text,_policy_id uuid,_policy_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE intent jsonb;prior jsonb;created jsonb;r public.recon_runs%ROWTYPE;pins jsonb;
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'run');
 PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||_tenant_id::text||':'||_definition_id::text,0));
 SELECT jsonb_agg(jsonb_build_object('side_id',value->>'side_id','upload_id',value->>'upload_id') ORDER BY value->>'side_id') INTO pins FROM jsonb_array_elements(_bindings);
 intent:=jsonb_build_object('input_kind','prepared_bound','policy_id',_policy_id,'policy_version',_policy_version,'pins',pins,
  'bindings',_bindings,'business_date',_business_date,'expected_definition_sha256',_expected_definition_sha256);
 prior:=private.rs_prior(_tenant_id,_definition_id,_request_key,intent);IF prior IS NOT NULL THEN RETURN prior;END IF;
 created:=public.dpw_create_recon_run(_tenant_id,_definition_id,_business_date,_bindings,_request_key,_expected_definition_sha256);
 IF created->'is_new' IS DISTINCT FROM 'true'::jsonb OR created->>'actor_id' IS DISTINCT FROM auth.uid()::text OR created->>'tenant_id' IS DISTINCT FROM _tenant_id::text
 THEN RAISE EXCEPTION 'rs.new_native_prepared_request_required' USING ERRCODE='PT409';END IF;
 SELECT * INTO r FROM public.recon_runs WHERE id=(created->>'run_id')::uuid AND tenant_id=_tenant_id AND definition_id=_definition_id AND run_by=auth.uid();
 IF NOT FOUND OR r.status<>'queued' OR r.started_at<transaction_timestamp() OR r.completed_at IS NOT NULL
 OR r.approved_revision_sha256 IS DISTINCT FROM _expected_definition_sha256 THEN RAISE EXCEPTION 'rs.queued_same_transaction_prepared_creator_required' USING ERRCODE='PT409';END IF;
 -- Stores the SAME native Run ID/UID and exact native logical-side output indexes.
 RETURN private.rs_store(_tenant_id,r.id,_request_key,intent);
END $$;
REVOKE ALL ON FUNCTION public.create_recon_execution_from_prepared(uuid,uuid,date,jsonb,uuid,text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_recon_execution_from_prepared(uuid,uuid,date,jsonb,uuid,text,uuid,text) TO authenticated;


-- FROZEN INPUT RECON-BINDINGS-GETTER.sql SHA256 6a09bd77aae8592fbb701117ee04ec9294116f6095e7027cb373b34fbf81643b
-- Requires qualified Pasteur BASE + RECON-BINDING source; installs no dataset rows.
CREATE FUNCTION private.rs_resolve_prepared_bindings(_tenant uuid,_definition uuid,_business_date date,_datasets jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'run');d public.recon_definitions%ROWTYPE;v public.recon_definition_approved_versions%ROWTYPE;
 contracts jsonb;s jsonb;c jsonb;dataset public.data_prep_prepared_datasets%ROWTYPE;bindings jsonb:='[]';approved jsonb;chosen_policy private.rs_policies%ROWTYPE;policies integer;logical_side text;
BEGIN
 IF _business_date IS NULL OR jsonb_typeof(_datasets) IS DISTINCT FROM 'object' OR _datasets='{}'::jsonb
 THEN RAISE EXCEPTION 'rs.explicit_prepared_side_selection_required' USING ERRCODE='22023';END IF;
 v:=private.recon_run_bound_approved_version(_tenant,_definition,actor);
 IF v.id IS NULL THEN RAISE EXCEPTION 'rs.actual_native_approved_snapshot_required' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 contracts:=private.rs_recon_input_contracts(_tenant,_definition,v.id);
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_datasets) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.snapshot->'sides') x WHERE x->>'side_id'=k))
 THEN RAISE EXCEPTION 'rs.unconfigured_prepared_side' USING ERRCODE='22023';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(v.snapshot->'sides') LOOP
  IF _datasets ? (s->>'side_id') THEN
   SELECT value INTO c FROM jsonb_array_elements(contracts->'input_contracts') WHERE value->>'side_id'=s->>'side_id';
   IF c IS NULL OR jsonb_typeof(c->'fields') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'rs.approved_prepared_side_domains_unavailable' USING ERRCODE='42501';END IF;
   SELECT * INTO dataset FROM public.data_prep_prepared_datasets WHERE id=(_datasets->>(s->>'side_id'))::uuid AND tenant_id=_tenant;
   IF NOT FOUND OR dataset.data_source_id::text IS DISTINCT FROM s->>'data_source_id'
    OR (s ? 'upload_id' AND s->>'upload_id' IS NOT NULL AND s->>'upload_id' IS DISTINCT FROM dataset.upload_id::text)
   THEN RAISE EXCEPTION 'rs.prepared_source_or_approved_pin_conflict' USING ERRCODE='42501';END IF;
   logical_side:=coalesce(c->>'logical_side',private.rs_select_compatible_logical_side(_tenant,dataset.id,c));
   bindings:=bindings||jsonb_build_array(jsonb_build_object('kind','prepared_dataset','side_id',s->>'side_id','data_source_id',s->>'data_source_id','dataset_id',dataset.id,
    'pipeline_id',dataset.pipeline_id,'pipeline_version',dataset.pipeline_version,'upload_id',dataset.upload_id,'logical_side',logical_side));
  ELSE
   IF s->>'upload_id' IS NULL THEN RAISE EXCEPTION 'rs.required_counterpart_unpinned_no_latest_fallback' USING ERRCODE='42501';END IF;
   bindings:=bindings||jsonb_build_array(jsonb_build_object('kind','fixed_upload','side_id',s->>'side_id','data_source_id',s->>'data_source_id','upload_id',s->>'upload_id'));
  END IF;
 END LOOP;
 -- Exact authoritative intersection: current published dataset, pipeline version,
 -- independent release, source RLP, logical-side output indexes and typed row hash.
 approved:=private.dpw_recon_preflight(_tenant,_definition,_business_date,bindings,v.snapshot_sha256);
 IF approved->>'snapshot_sha256' IS DISTINCT FROM v.snapshot_sha256 OR approved->'reconciliation_feature_enabled' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'rs.actual_native_preflight_required' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO policies FROM private.rs_policies WHERE tenant_id=_tenant AND definition_id=_definition
 AND policy->>'business_date'=_business_date::text AND qualification->>'state'='native_qualified'
 AND qualification->>'approved_definition_sha256'=v.snapshot_sha256;
 IF policies>1 THEN RAISE EXCEPTION 'rs.unambiguous_approved_native_execution_policy_required' USING ERRCODE='42501';END IF;
 IF policies=1 THEN SELECT * INTO chosen_policy FROM private.rs_policies WHERE tenant_id=_tenant AND definition_id=_definition AND policy->>'business_date'=_business_date::text
 AND qualification->>'state'='native_qualified' AND qualification->>'approved_definition_sha256'=v.snapshot_sha256;
 ELSE chosen_policy.policy_id:=v.id;chosen_policy.version:=v.version_number::text;chosen_policy.policy:=jsonb_build_object('business_date',_business_date,'policy_kind','approved_native_input_binding');END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',d.id,'business_date',_business_date,'revision_id',v.id,'revision_number',v.version_number,
 'expected_definition_sha256',v.snapshot_sha256,'approved_snapshot_sha256',v.snapshot_sha256,'input_bindings',bindings,
 'execution_policy',jsonb_build_object('policy_id',chosen_policy.policy_id,'policy_version',chosen_policy.version,'business_date',chosen_policy.policy->>'business_date','policy_kind',chosen_policy.policy->>'policy_kind'),
 'compatibility','native_current_published_contract_hash_checked','approved_snapshot',approved->'snapshot');
END $$;
CREATE FUNCTION public.read_prepared_recon_bindings(_tenant_id uuid,_definition_id uuid,_business_date date,_prepared_dataset_by_side jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
BEGIN
 PERFORM 1 FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_prepared_definition_required' USING ERRCODE='42501';END IF;
 RETURN private.rs_resolve_prepared_bindings(_tenant_id,_definition_id,_business_date,_prepared_dataset_by_side);
END $$;
REVOKE ALL ON FUNCTION private.rs_resolve_prepared_bindings(uuid,uuid,date,jsonb),public.read_prepared_recon_bindings(uuid,uuid,date,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_resolve_prepared_bindings(uuid,uuid,date,jsonb),public.read_prepared_recon_bindings(uuid,uuid,date,jsonb) TO authenticated;


-- FROZEN INPUT RECON-REPLAY-GETTER.sql SHA256 c99b86da98fb6ae991a39f5c12c783251bf6305e607ce4c53b6aea9bac2f8e40
CREATE FUNCTION private.rs_prepared_replay(_tenant uuid,_definition uuid,_key uuid,_business_date date,_datasets jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'read');q private.rs_requests%ROWTYPE;r public.recon_runs%ROWTYPE;selected jsonb;m jsonb;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE tenant_id=_tenant AND definition_id=_definition AND actor_id=actor AND request_key=_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',_definition,'state','absent');END IF;
 SELECT coalesce(jsonb_object_agg(value->>'side_id',value->>'dataset_id'),'{}') INTO selected FROM jsonb_array_elements(q.intent->'bindings') WHERE value->>'kind'='prepared_dataset';
 IF q.intent->>'input_kind' IS DISTINCT FROM 'prepared_bound' OR q.intent->>'business_date' IS DISTINCT FROM _business_date::text OR selected IS DISTINCT FROM _datasets
 THEN RAISE EXCEPTION 'rs.prepared_request_key_conflict' USING ERRCODE='PT409';END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(q.manifest) LOOP
  IF private.data_source_child_allows(actor,_tenant,(m->>'data_source_id')::uuid,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'rs.current_replay_source_denied' USING ERRCODE='42501';END IF;
 END LOOP;
 SELECT * INTO r FROM public.recon_runs WHERE id=q.run_id AND tenant_id=_tenant AND run_by=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.original_native_run_unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',q.tenant_id,'definition_id',q.definition_id,'run_id',r.id,'run_uid',r.run_uid,
  'request_key',q.request_key,'status',r.status,'phase',q.phase,'input_manifest',q.manifest,'execution_kind','request_replay','state','recorded',
  'attachment_receipt',q.attachment_receipt,'input_fingerprint',q.input_fingerprint,'completion',q.completion);
END $$;
CREATE FUNCTION public.read_prepared_execution_request(_tenant_id uuid,_definition_id uuid,_request_key uuid,_business_date date,_prepared_dataset_by_side jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE receipt jsonb;
BEGIN
 receipt:=private.rs_prepared_replay(_tenant_id,_definition_id,_request_key,_business_date,_prepared_dataset_by_side);
 IF receipt->>'run_id' IS NOT NULL THEN PERFORM 1 FROM public.recon_runs WHERE id=(receipt->>'run_id')::uuid AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.original_run_current_rlp_denied' USING ERRCODE='42501';END IF;
 END IF;RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION private.rs_prepared_replay(uuid,uuid,uuid,date,jsonb),public.read_prepared_execution_request(uuid,uuid,uuid,date,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_prepared_replay(uuid,uuid,uuid,date,jsonb),public.read_prepared_execution_request(uuid,uuid,uuid,date,jsonb) TO authenticated;


-- FROZEN INPUT RECON-ORIGINAL-EVIDENCE.sql SHA256 6dd2fc7538564650ed6c7423bb1f8a7782bda3dc26651313960c088865d51629
-- Reachable manual source-proof producer. The field meaning is frozen by the
-- original independent reconciliation approval/confirmed mapping, not guessed
-- from an incoming "settled" column. This does NOT claim a bank-provider binding.
CREATE FUNCTION private.rs_attest_original(_tenant uuid,_run uuid,_side text,_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;r public.recon_runs%ROWTYPE;v public.recon_definition_approved_versions%ROWTYPE;
 actor uuid;side jsonb;mapping jsonb;fields jsonb:='{}';facet text;u public.workspace_data_source_uploads%ROWTYPE;
 att private.rs_attachments%ROWTYPE;binding uuid;profile_label text;profile jsonb;digest text;proof private.rs_source_attestations%ROWTYPE;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;
 IF NOT FOUND OR _key IS NULL THEN RAISE EXCEPTION 'rs.native_source_run_required' USING ERRCODE='42501';END IF;
 actor:=private.rs_actor(_tenant,q.definition_id,'edit');
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant;
 SELECT * INTO v FROM public.recon_definition_approved_versions WHERE id=r.approved_revision_id AND tenant_id=_tenant AND parent_definition_id=q.definition_id;
 IF NOT FOUND OR v.snapshot_sha256 IS DISTINCT FROM r.approved_revision_sha256 THEN RAISE EXCEPTION 'rs.independent_approved_source_mapping_required' USING ERRCODE='42501';END IF;
 SELECT value INTO side FROM jsonb_array_elements(v.snapshot->'sides') WHERE value->>'side_id'=_side;
 mapping:=coalesce(side->'column_mapping',side->'input_contract'->'column_mapping');
 FOR facet IN SELECT unnest(ARRAY['affirmation','settlement']) LOOP
  IF mapping->>(facet||'_state') IS NOT NULL AND mapping->>(facet||'_ack_id') IS NOT NULL AND mapping->>(facet||'_ack_at') IS NOT NULL THEN
   fields:=fields||jsonb_build_object(facet,jsonb_build_object('state_field',mapping->>(facet||'_state'),'ack_id_field',mapping->>(facet||'_ack_id'),'ack_at_field',mapping->>(facet||'_ack_at')));
  END IF;
 END LOOP;
 IF fields='{}' THEN RAISE EXCEPTION 'rs.confirmed_affirmation_settlement_field_mapping_required' USING ERRCODE='42501';END IF;
 SELECT * INTO att FROM private.rs_attachments WHERE run_id=_run AND side_id=_side;
 IF NOT FOUND OR private.data_source_child_allows(actor,_tenant,att.data_source_id,'manage') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'rs.actual_source_attestation_permission_required' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=att.upload_id AND tenant_id=_tenant AND data_source_id=att.data_source_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.original_authenticated_upload_unavailable' USING ERRCODE='42501';END IF;
 profile_label:='approved-mapping-lifecycle:'||_side;
 profile:=jsonb_build_object('id',profile_label,'version',v.snapshot_sha256,'confirmation_kind','authenticated_actor_attestation','fields',fields,
  'date_fields',jsonb_build_object('trade_date',mapping->>'trade_date','value_date',mapping->>'value_date','business_date',mapping->>'business_date'));
 digest:=encode(sha256(convert_to(u.rows::text,'UTF8')),'hex');
 SELECT * INTO proof FROM private.rs_source_attestations WHERE proof_id=_key;
 IF FOUND THEN
  IF proof.upload_id<>u.id OR proof.rows_sha256<>digest OR proof.authenticated_actor<>actor THEN RAISE EXCEPTION 'rs.source_attestation_request_conflict' USING ERRCODE='PT409';END IF;
  RETURN to_jsonb(proof)||jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'confirmation_kind','authenticated_actor_attestation','request_replay',true);
 END IF;
 SELECT binding_id INTO binding FROM private.rs_source_bindings WHERE tenant_id=_tenant AND definition_id=q.definition_id AND side_id=_side
 AND data_source_id=u.data_source_id AND profile_id=profile_label AND profile_version=v.snapshot_sha256;
 IF binding IS NULL THEN
  INSERT INTO private.rs_source_bindings(binding_id,tenant_id,definition_id,side_id,data_source_id,profile_id,profile_version,fields,qualification)
  VALUES(gen_random_uuid(),_tenant,q.definition_id,_side,u.data_source_id,profile_label,v.snapshot_sha256,fields,jsonb_build_object('state','native_qualified',
   'kind','independently_approved_mapping','approved_revision_id',v.id,'producer_source_sha256',encode(sha256(convert_to(pg_get_functiondef('private.rs_attest_original(uuid,uuid,text,uuid)'::regprocedure),'UTF8')),'hex')))
  RETURNING binding_id INTO binding;
 END IF;
 INSERT INTO private.rs_source_attestations(proof_id,binding_id,upload_id,rows_sha256,authenticated_actor,authenticated_at,provenance)
 VALUES(_key,binding,u.id,digest,actor,clock_timestamp(),jsonb_build_object('state','authenticated_native_source','kind','authenticated_actor_attestation',
  'original_uploaded_by',u.uploaded_by,'original_arrival_at',u.created_at,'approved_revision_id',v.id,'approved_snapshot_sha256',v.snapshot_sha256,
  'profile',profile,'producer_source_sha256',encode(sha256(convert_to(pg_get_functiondef('private.rs_attest_original(uuid,uuid,text,uuid)'::regprocedure),'UTF8')),'hex')))
 RETURNING * INTO proof;
 INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,actor,'original_source_attested',jsonb_build_object('proof_id',proof.proof_id,
  'source_binding_id',binding,'source_upload_id',u.id,'source_rows_sha256',digest,'profile',profile,'confirmation_kind','authenticated_actor_attestation'));
 RETURN to_jsonb(proof)||jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'confirmation_kind','authenticated_actor_attestation','request_replay',false);
END $$;
CREATE FUNCTION public.attest_recon_lifecycle_original(_tenant_id uuid,_run_id uuid,_side_id text,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_source_run_rlp_required' USING ERRCODE='42501';END IF;
 result:=private.rs_attest_original(_tenant_id,_run_id,_side_id,_request_key);
 PERFORM 1 FROM public.workspace_data_source_uploads WHERE id=(result->>'upload_id')::uuid AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_original_source_rlp_required' USING ERRCODE='42501';END IF;
 IF result->'request_replay' IS DISTINCT FROM 'true'::jsonb THEN INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(auth.uid(),_tenant_id,'workspace','recon.source.original_attestation','recon_run',_run_id::text,result-'provenance');END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.rs_attest_original(uuid,uuid,text,uuid),public.attest_recon_lifecycle_original(uuid,uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_attest_original(uuid,uuid,text,uuid),public.attest_recon_lifecycle_original(uuid,uuid,text,uuid) TO authenticated;


-- FROZEN INPUT RETENTION-LOCKED-PRODUCER.sql SHA256 f5513049bbe2cfdf9e846f477d4b742f297a68ee30c11e7609dfbc59a1c58896
-- Additive source proposal. Main executes only after exact dependency/preservation
-- qualification. No replacement of existing functions, storage DELETE, scheduler,
-- table-retention-policy edit, historical backfill or deletion of business rows.
-- Requires the peer BODY/MODE-RETENTION/RECON-BINDING and Curie policy proposals.
DO $collision$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private' AND c.relname LIKE 'dprt_%')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN('private','public') AND p.proname LIKE 'dprt_%')
 THEN RAISE EXCEPTION 'dprt.native_name_collision'; END IF;
 IF to_regclass('public.data_prep_attachment_retention') IS NULL
 OR to_regclass('public.data_prep_attachment_holds') IS NULL
 OR to_regclass('public.data_prep_attachment_tombstones') IS NULL
 OR to_regclass('public.data_prep_recon_run_inputs') IS NULL
 OR to_regclass('private.dpw_attachment_retention_defaults') IS NULL
 OR to_regclass('private.dpw_attachment_retention_overrides') IS NULL
 THEN RAISE EXCEPTION 'dprt.required_native_packet_missing'; END IF;
END $collision$;

CREATE TABLE private.dprt_jobs(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 pipeline_id uuid NOT NULL REFERENCES public.data_prep_pipelines(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),day_utc date NOT NULL,
 candidate_files uuid[] NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.dprt_claims(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES private.dprt_jobs(id),
 file_id uuid NOT NULL REFERENCES public.data_prep_attachment_retention(file_id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),descriptor jsonb NOT NULL,
 descriptor_sha256 text NOT NULL CHECK(descriptor_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 UNIQUE(job_id,file_id)
);
CREATE TABLE private.dprt_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),claim_id uuid REFERENCES private.dprt_claims(id),
 job_id uuid REFERENCES private.dprt_jobs(id),file_id uuid REFERENCES public.data_prep_attachment_retention(file_id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),event text NOT NULL,
 context jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX dprt_terminal_once ON private.dprt_events(claim_id)
 WHERE event IN('cancelled','completed');
CREATE TABLE private.dprt_receipts(
 id uuid PRIMARY KEY,claim_id uuid NOT NULL UNIQUE REFERENCES private.dprt_claims(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),descriptor_sha256 text NOT NULL,
 verified_receipt jsonb NOT NULL,evidence_sha256 text NOT NULL CHECK(evidence_sha256~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.dprt_certificates(
 job_id uuid PRIMARY KEY REFERENCES private.dprt_jobs(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 counts jsonb NOT NULL,tombstone_manifest jsonb NOT NULL,tombstone_manifest_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE private.dprt_hold_requests(
 tenant_id uuid NOT NULL,actor_id uuid NOT NULL,request_key uuid NOT NULL,
 payload jsonb NOT NULL,result jsonb NOT NULL,PRIMARY KEY(tenant_id,actor_id,request_key)
);

CREATE FUNCTION private.dprt_hash(_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $$ SELECT encode(sha256(convert_to(_value::text,'UTF8')),'hex') $$;
CREATE FUNCTION private.dprt_authorize(_tenant uuid,_pipeline uuid,_action text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant,_pipeline,_action);
BEGIN
 IF _action='manage' THEN
  PERFORM public.assert_data_prep_actor(_tenant,actor,true);
  IF public.user_has_permission(actor,_tenant,'compliance.retention.manage',NULL) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'dprt.retention_permission_required' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dprt.current_membership_required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION private.dprt_effective_policy(_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p private.dpw_attachment_retention_defaults%ROWTYPE;
 t private.dpw_attachment_retention_overrides%ROWTYPE; selected jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dpw_attachment_retention:platform',0));
 SELECT * INTO p FROM private.dpw_attachment_retention_defaults WHERE singleton=true;
 IF NOT FOUND OR p.period_days<1 THEN RAISE EXCEPTION 'dprt.platform_policy_unqualified'; END IF;
 SELECT * INTO t FROM private.dpw_attachment_retention_overrides WHERE tenant_id=_tenant;
 selected:=CASE WHEN t.period_days IS NOT NULL AND t.period_days>=p.period_days THEN
  jsonb_build_object('policy_id',t.policy_id,'version',t.version::text,'period_days',t.period_days,'source','tenant',
   'effective_at',greatest(p.effective_at,t.effective_at))
 ELSE jsonb_build_object('policy_id',p.policy_id,'version',p.version::text,'period_days',p.period_days,'source','platform','effective_at',p.effective_at) END;
 RETURN selected||jsonb_build_object('platform_version',p.version::text,'tenant_override_version',t.version::text,
  'configured_tenant_days',t.period_days,'policy_snapshot_sha256',private.dprt_hash(selected));
END $$;
CREATE FUNCTION private.dprt_lock_attachment(_file uuid) RETURNS public.data_prep_attachment_retention
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.data_prep_attachment_retention%ROWTYPE; f public.data_prep_delivery_files%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dprt.attachment_unknown'; END IF;
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file FOR UPDATE;
 IF NOT FOUND OR f.state IS DISTINCT FROM 'received' OR f.upload_id IS NULL
 OR f.tenant_id<>a.tenant_id OR f.pipeline_id<>a.pipeline_id
 OR f.original_path<>a.original_path OR f.content_sha256<>a.original_file_bytes_sha256
 OR (f.descriptor->>'size_bytes')::bigint IS DISTINCT FROM a.original_size_bytes
 THEN RAISE EXCEPTION 'dprt.exact_attachment_binding_required'; END IF;
 PERFORM 1 FROM public.data_prep_delivery_runs WHERE id=a.run_id AND tenant_id=a.tenant_id
 AND pipeline_id=a.pipeline_id AND finished_at=a.attached_at FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dprt.immutable_completion_clock_required'; END IF;
 -- Upload row locks conflict with FK consumers. Published dataset rows are also
 -- locked below. Legacy JSON-only consumers still require main's fence capture.
 PERFORM 1 FROM public.workspace_data_source_uploads WHERE id=f.upload_id FOR UPDATE;
 PERFORM 1 FROM public.data_prep_prepared_datasets WHERE run_id=a.run_id FOR UPDATE;
 RETURN a;
END $$;
CREATE FUNCTION private.dprt_reference_check(_file uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.data_prep_attachment_retention%ROWTYPE; f public.data_prep_delivery_files%ROWTYPE;
 shared_count bigint; recon_count bigint;
BEGIN
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file;
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file;
 SELECT count(*) INTO shared_count FROM public.data_prep_run_inputs
 WHERE (file_id=f.id OR upload_id=f.upload_id) AND run_id<>a.run_id;
 SELECT count(*) INTO recon_count FROM public.data_prep_recon_run_inputs i
 WHERE i.upload_id=f.upload_id OR i.preparation_run_id=a.run_id
 OR i.dataset_id IN(SELECT id FROM public.data_prep_prepared_datasets WHERE run_id=a.run_id);
 -- Conservative metadata-only check of old JSON-backed reconciliation pins.
 SELECT recon_count+count(*) INTO recon_count FROM public.recon_runs r
 WHERE r.tenant_id=a.tenant_id AND (
  jsonb_path_exists(coalesce(r.definition_snapshot,'{}'), '$.** ? (@.upload_id == $uid)', jsonb_build_object('uid',f.upload_id::text))
  OR EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets d WHERE d.run_id=a.run_id AND
    jsonb_path_exists(coalesce(r.definition_snapshot,'{}'), '$.** ? (@.upload_id == $uid)', jsonb_build_object('uid',d.upload_id::text)))
 );
 RETURN jsonb_build_object('other_preparation_references',shared_count,'reconciliation_references',recon_count,
  'shared',shared_count>0 OR recon_count>0);
END $$;
CREATE FUNCTION private.dprt_native_fences() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Existing closed dependency is deliberately preserved. Main must bind actual
 -- global WORM hold/object-lock coverage, current object ownership/version/hash,
 -- legacy JSON reference writer serialization and provider receipt verification.
 -- Nine captured relations alone do not prove absence of a global hold ledger.
 IF private.dpw_retention_attest() IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'dprt.storage_global_hold_and_reference_fences_unqualified' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION private.dprt_global_hold_attest(_tenant uuid,_pipeline uuid,_run uuid,_file uuid,_sha256 text,_original_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- The captured nine relations do not contain the WORM/global hold registry.
 -- Main must qualify current hold/lock fields and reference-writer serialization
 -- against GLOBAL-HOLD-REFERENCE-SUPPLEMENT.SELECT.sql before binding this port.
 RAISE EXCEPTION 'dprt.actual_global_hold_verifier_unqualified' USING ERRCODE='42501';
END $$;
CREATE FUNCTION private.dprt_storage_receipt_attest(_claim uuid,_proof jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Exact provider receipt signature/authority producer is not present in the
 -- metadata supplement. A caller-shaped jsonb proof, hash or boolean cannot
 -- supply verification. Never bind this to a permissive constant.
 RAISE EXCEPTION 'dprt.actual_provider_receipt_verifier_unqualified' USING ERRCODE='42501';
END $$;
CREATE FUNCTION private.dprt_assert_global_hold(_a public.data_prep_attachment_retention) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF private.dprt_global_hold_attest(_a.tenant_id,_a.pipeline_id,_a.run_id,_a.file_id,
  _a.original_file_bytes_sha256,_a.original_path) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dprt.global_hold_or_reference_denied' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.dprt_register_attachment(_tenant uuid,_pipeline uuid,_file uuid,_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dprt_authorize(_tenant,_pipeline,'manage');
 f public.data_prep_delivery_files%ROWTYPE;r public.data_prep_delivery_runs%ROWTYPE;
 policy jsonb;a public.data_prep_attachment_retention%ROWTYPE; days integer;
BEGIN
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file AND tenant_id=_tenant AND pipeline_id=_pipeline FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'dprt.file_binding_required'; END IF;
 SELECT * INTO r FROM public.data_prep_delivery_runs WHERE id=_run AND tenant_id=_tenant AND pipeline_id=_pipeline FOR UPDATE;
 IF NOT FOUND OR r.finished_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.data_prep_run_inputs WHERE run_id=_run AND file_id=_file)
 THEN RAISE EXCEPTION 'dprt.completed_run_binding_required'; END IF;
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file;
 IF FOUND THEN
  IF a.run_id<>_run THEN RAISE EXCEPTION 'dprt.shared_original_clock_cannot_be_rewritten'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'retention',to_jsonb(a),'is_new',false);
 END IF;
 policy:=private.dprt_effective_policy(_tenant);days:=(policy->>'period_days')::integer;
 IF r.finished_at<(policy->>'effective_at')::timestamptz OR f.state<>'received' THEN
  RAISE EXCEPTION 'dprt.no_historical_enrollment'; END IF;
 INSERT INTO public.data_prep_attachment_retention(file_id,tenant_id,pipeline_id,bucket_id,original_path,original_file_bytes_sha256,
  original_size_bytes,run_id,attached_at,expires_at,policy_id,policy_version,period_days,policy_source,notice_30_at,notice_10_at,notice)
 VALUES(f.id,_tenant,_pipeline,'data-prep-inputs',f.original_path,f.content_sha256,(f.descriptor->>'size_bytes')::bigint,
  r.id,r.finished_at,r.finished_at+days*interval '1 day',(policy->>'policy_id')::uuid,policy->>'version',days,policy->>'source',
  r.finished_at+(days-30)*interval '1 day',r.finished_at+(days-10)*interval '1 day','Execution attachment bytes follow the recorded policy; run/config/audit metadata remain retained')
 RETURNING * INTO a;
 PERFORM private.dpw_audit(actor,_tenant,'dprt.policy.snapshot',f.id,jsonb_build_object('run_id',r.id,'policy',policy,'expires_at',a.expires_at));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'retention',to_jsonb(a),'is_new',true);
END $$;
CREATE FUNCTION public.dprt_begin_job(_tenant uuid,_pipeline uuid,_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dprt_authorize(_tenant,_pipeline,'manage');j private.dprt_jobs%ROWTYPE; files uuid[];
 day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF _job IS NULL THEN RAISE EXCEPTION 'dprt.job_id_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dprt-job:'||_job::text,0));
 SELECT * INTO j FROM private.dprt_jobs WHERE id=_job;
 IF FOUND THEN
  IF j.tenant_id<>_tenant OR j.pipeline_id<>_pipeline OR j.actor_id<>actor THEN RAISE EXCEPTION 'dprt.job_conflict'; END IF;
  RETURN to_jsonb(j);
 END IF;
 SELECT coalesce(array_agg(file_id ORDER BY file_id),'{}'::uuid[]) INTO files
 FROM public.data_prep_attachment_retention a WHERE tenant_id=_tenant AND pipeline_id=_pipeline
 AND expires_at<=(day::timestamp AT TIME ZONE 'UTC')
 AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_tombstones t WHERE t.file_id=a.file_id);
 INSERT INTO private.dprt_jobs(id,tenant_id,pipeline_id,actor_id,day_utc,candidate_files)
 VALUES(_job,_tenant,_pipeline,actor,day,files) RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;
CREATE FUNCTION public.dprt_claim_attachment(_tenant uuid,_pipeline uuid,_file uuid,_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dprt_authorize(_tenant,_pipeline,'manage');a public.data_prep_attachment_retention%ROWTYPE;
 j private.dprt_jobs%ROWTYPE;c private.dprt_claims%ROWTYPE;o storage.objects%ROWTYPE;f public.data_prep_delivery_files%ROWTYPE;refs jsonb;descriptor jsonb;
BEGIN
 PERFORM private.dprt_native_fences();
 SELECT * INTO j FROM private.dprt_jobs WHERE id=_job FOR UPDATE;
 IF NOT FOUND OR j.tenant_id<>_tenant OR j.pipeline_id<>_pipeline OR j.actor_id<>actor
 OR NOT (_file=ANY(j.candidate_files)) OR EXISTS(SELECT 1 FROM private.dprt_certificates WHERE job_id=_job)
 THEN RAISE EXCEPTION 'dprt.job_scope_or_frozen_certificate'; END IF;
 a:=private.dprt_lock_attachment(_file);
 PERFORM private.dprt_assert_global_hold(a);
 IF a.tenant_id<>_tenant OR a.pipeline_id<>_pipeline THEN RAISE EXCEPTION 'dprt.tenant_mismatch'; END IF;
 IF a.expires_at>clock_timestamp() OR private.dpw_attachment_has_hold(_file)
 THEN RAISE EXCEPTION 'dprt.expiry_or_hold_denied'; END IF;
 refs:=private.dprt_reference_check(_file);
 IF (refs->>'shared')::boolean THEN RAISE EXCEPTION 'dprt.shared_reference_denied'; END IF;
 SELECT * INTO c FROM private.dprt_claims WHERE file_id=_file AND job_id=_job;
 IF FOUND THEN RETURN to_jsonb(c); END IF;
 IF EXISTS(SELECT 1 FROM private.dprt_claims old WHERE file_id=_file
  AND NOT EXISTS(SELECT 1 FROM private.dprt_events e WHERE e.claim_id=old.id AND e.event='cancelled'))
 THEN RAISE EXCEPTION 'dprt.previous_claim_requires_readback'; END IF;
 IF EXISTS(SELECT 1 FROM public.data_prep_attachment_tombstones WHERE file_id=_file)
 THEN RAISE EXCEPTION 'dprt.already_tombstoned'; END IF;
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file;
 SELECT * INTO o FROM storage.objects WHERE bucket_id=a.bucket_id AND name=a.original_path
 AND archived_at IS NULL AND NOT is_delete_marker FOR UPDATE;
 IF NOT FOUND OR coalesce(o.owner_id,o.owner::text) IS DISTINCT FROM f.created_by::text
 OR (o.metadata->>'size')::bigint IS DISTINCT FROM a.original_size_bytes
 OR NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id=o.bucket_id AND public IS FALSE)
 THEN RAISE EXCEPTION 'dprt.object_owner_version_size_required'; END IF;
 descriptor:=jsonb_build_object('retention',to_jsonb(a),'object_id',o.id,'bucket_id',o.bucket_id,'name',o.name,
  'version',o.version,'owner_id',coalesce(o.owner_id,o.owner::text),'references',refs);
 INSERT INTO private.dprt_claims(job_id,file_id,actor_id,descriptor,descriptor_sha256)
 VALUES(_job,_file,actor,descriptor,private.dprt_hash(descriptor)) RETURNING * INTO c;
 INSERT INTO private.dprt_events(claim_id,job_id,file_id,actor_id,event,context)
 VALUES(c.id,_job,_file,actor,'claimed',jsonb_build_object('descriptor_sha256',c.descriptor_sha256));
 PERFORM private.dpw_audit(actor,_tenant,'dprt.artifact.claim',_file,jsonb_build_object('claim_id',c.id,'job_id',_job,'descriptor_sha256',c.descriptor_sha256));
 RETURN to_jsonb(c)||jsonb_build_object('physical_delete_operation',NULL,'activation','closed_until_parent_storage_and_hold_qualification');
END $$;
CREATE FUNCTION public.dprt_set_hold(_tenant uuid,_pipeline uuid,_file uuid,_hold boolean,_hold_id uuid,_reason text,_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dprt_authorize(_tenant,_pipeline,'manage');a public.data_prep_attachment_retention%ROWTYPE;
 h public.data_prep_attachment_holds%ROWTYPE;payload jsonb;prior private.dprt_hold_requests%ROWTYPE;result jsonb;
BEGIN
 IF _hold IS NULL OR _request IS NULL OR length(coalesce(btrim(_reason),'')) NOT BETWEEN 3 AND 1000
 OR private.dpw_legal_hold_attest(actor,_tenant) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dprt.hold_authority_required'; END IF;
 a:=private.dprt_lock_attachment(_file);
 IF a.tenant_id<>_tenant OR a.pipeline_id<>_pipeline THEN RAISE EXCEPTION 'dprt.tenant_mismatch'; END IF;
 payload:=jsonb_build_object('file_id',_file,'hold',_hold,'hold_id',_hold_id,'reason',btrim(_reason));
 SELECT * INTO prior FROM private.dprt_hold_requests WHERE tenant_id=_tenant AND actor_id=actor AND request_key=_request;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'dprt.hold_request_conflict'; END IF;RETURN prior.result; END IF;
 IF EXISTS(SELECT 1 FROM public.data_prep_attachment_tombstones WHERE file_id=_file) THEN RAISE EXCEPTION 'dprt.already_tombstoned'; END IF;
 IF NOT _hold AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_holds WHERE id=_hold_id AND file_id=_file AND operation='hold'
  AND NOT EXISTS(SELECT 1 FROM public.data_prep_attachment_holds x WHERE x.hold_id=_hold_id AND x.operation='release'))
 THEN RAISE EXCEPTION 'dprt.active_hold_required'; END IF;
 INSERT INTO public.data_prep_attachment_holds(file_id,operation,hold_id,actor_id,reason)
 VALUES(_file,CASE WHEN _hold THEN 'hold' ELSE 'release' END,CASE WHEN _hold THEN NULL ELSE _hold_id END,actor,btrim(_reason)) RETURNING * INTO h;
 IF _hold THEN
  INSERT INTO private.dprt_events(claim_id,job_id,file_id,actor_id,event,context)
  SELECT c.id,c.job_id,c.file_id,actor,'cancelled',jsonb_build_object('hold_id',h.id)
  FROM private.dprt_claims c WHERE c.file_id=_file AND NOT EXISTS(
   SELECT 1 FROM private.dprt_events e WHERE e.claim_id=c.id AND e.event IN('cancelled','completed'));
 END IF;
 result:=jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'hold',to_jsonb(h));
 INSERT INTO private.dprt_hold_requests VALUES(_tenant,actor,_request,payload,result);
 PERFORM private.dpw_audit(actor,_tenant,'dprt.artifact.hold',_file,jsonb_build_object('hold',to_jsonb(h)));
 RETURN result;
END $$;
CREATE FUNCTION public.dprt_record_verified_receipt(_tenant uuid,_pipeline uuid,_claim uuid,_receipt uuid,_subject jsonb,_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_processor_actor(_tenant,_pipeline,_subject,'manage');
 c private.dprt_claims%ROWTYPE; a public.data_prep_attachment_retention%ROWTYPE;r private.dprt_receipts%ROWTYPE;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant,actor,true);
 IF public.user_has_permission(actor,_tenant,'compliance.retention.manage',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dprt.retention_permission_required'; END IF;
 PERFORM private.dprt_native_fences();
 SELECT * INTO c FROM private.dprt_claims WHERE id=_claim FOR UPDATE;
 IF NOT FOUND OR c.actor_id<>actor THEN RAISE EXCEPTION 'dprt.claim_actor_required'; END IF;
 a:=private.dprt_lock_attachment(c.file_id);
 PERFORM private.dprt_assert_global_hold(a);
 IF a.tenant_id<>_tenant OR a.pipeline_id<>_pipeline OR a.expires_at>clock_timestamp()
 OR private.dpw_attachment_has_hold(c.file_id) OR (private.dprt_reference_check(c.file_id)->>'shared')::boolean
 OR EXISTS(SELECT 1 FROM private.dprt_events WHERE claim_id=c.id AND event='cancelled')
 THEN RAISE EXCEPTION 'dprt.current_fences_denied'; END IF;
 IF _receipt IS NULL OR _proof->>'descriptor_sha256' IS DISTINCT FROM c.descriptor_sha256
 OR _proof->>'provider_receipt_id' IS NULL OR _proof->>'evidence_sha256' !~ '^[a-f0-9]{64}$'
 OR _proof->>'evidence_sha256' IS NULL OR (_proof->>'deleted_at')::timestamptz IS NULL
 OR (_proof->>'deleted_at')::timestamptz<a.expires_at OR (_proof->>'deleted_at')::timestamptz>clock_timestamp()
 THEN RAISE EXCEPTION 'dprt.exact_verified_provider_receipt_required'; END IF;
 IF private.dprt_storage_receipt_attest(c.id,_proof) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dprt.verified_provider_signature_required' USING ERRCODE='42501'; END IF;
 -- The preserved closed native attestor above is REQUIRED to verify real provider
 -- evidence; a caller boolean or catalog absence alone never qualifies bytes.
 SELECT * INTO r FROM private.dprt_receipts WHERE claim_id=_claim;
 IF FOUND THEN IF r.id<>_receipt OR r.verified_receipt IS DISTINCT FROM _proof THEN RAISE EXCEPTION 'dprt.receipt_conflict'; END IF;RETURN to_jsonb(r); END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=a.bucket_id AND name=a.original_path AND NOT is_delete_marker)
 THEN RAISE EXCEPTION 'dprt.object_still_present'; END IF;
 INSERT INTO private.dprt_receipts(id,claim_id,actor_id,descriptor_sha256,verified_receipt,evidence_sha256)
 VALUES(_receipt,c.id,actor,c.descriptor_sha256,_proof,_proof->>'evidence_sha256') RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.dprt_finalize_attachment(_tenant uuid,_pipeline uuid,_claim uuid,_receipt uuid,_subject jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_processor_actor(_tenant,_pipeline,_subject,'manage');
 c private.dprt_claims%ROWTYPE;a public.data_prep_attachment_retention%ROWTYPE;
 r private.dprt_receipts%ROWTYPE;t public.data_prep_attachment_tombstones%ROWTYPE;
BEGIN
 PERFORM public.assert_data_prep_actor(_tenant,actor,true);
 IF public.user_has_permission(actor,_tenant,'compliance.retention.manage',NULL) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dprt.retention_permission_required'; END IF;
 PERFORM private.dprt_native_fences();
 SELECT * INTO c FROM private.dprt_claims WHERE id=_claim FOR UPDATE;
 IF NOT FOUND OR c.actor_id<>actor THEN RAISE EXCEPTION 'dprt.claim_actor_required'; END IF;
 a:=private.dprt_lock_attachment(c.file_id);
 PERFORM private.dprt_assert_global_hold(a);
 IF a.tenant_id<>_tenant OR a.pipeline_id<>_pipeline OR a.expires_at>clock_timestamp()
 OR private.dpw_attachment_has_hold(c.file_id) OR (private.dprt_reference_check(c.file_id)->>'shared')::boolean
 OR EXISTS(SELECT 1 FROM private.dprt_events WHERE claim_id=c.id AND event='cancelled') THEN RAISE EXCEPTION 'dprt.current_fences_denied'; END IF;
 SELECT * INTO r FROM private.dprt_receipts WHERE id=_receipt AND claim_id=c.id;
 IF NOT FOUND OR r.descriptor_sha256<>c.descriptor_sha256 THEN RAISE EXCEPTION 'dprt.verified_receipt_required'; END IF;
 IF private.dprt_storage_receipt_attest(c.id,r.verified_receipt) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'dprt.verified_provider_signature_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.data_prep_attachment_tombstones WHERE file_id=c.file_id;
 IF FOUND THEN IF t.job_id<>c.job_id THEN RAISE EXCEPTION 'dprt.tombstone_job_conflict'; END IF; RETURN to_jsonb(t)||jsonb_build_object('retention',to_jsonb(a)); END IF;
 IF c.lease_expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=a.bucket_id AND name=a.original_path AND NOT is_delete_marker)
 THEN RAISE EXCEPTION 'dprt.fresh_claim_and_absence_required'; END IF;
 INSERT INTO public.data_prep_attachment_tombstones(file_id,job_id,transport_role,purged_at,object_absence_verified,original_file_bytes_sha256,original_size_bytes)
 VALUES(c.file_id,c.job_id,'service_role',(r.verified_receipt->>'deleted_at')::timestamptz,true,a.original_file_bytes_sha256,a.original_size_bytes) RETURNING * INTO t;
 INSERT INTO private.dprt_events(claim_id,job_id,file_id,actor_id,event,context)
 VALUES(c.id,c.job_id,c.file_id,actor,'completed',jsonb_build_object('receipt_id',r.id,'tombstone_sha256',private.dprt_hash(to_jsonb(t)||jsonb_build_object('retention',to_jsonb(a)))));
 PERFORM private.dpw_audit(actor,_tenant,'dprt.artifact.finalized',c.file_id,jsonb_build_object('claim_id',c.id,'receipt_id',r.id,'tombstone',to_jsonb(t),'retention',to_jsonb(a)));
 RETURN to_jsonb(t)||jsonb_build_object('retention',to_jsonb(a));
END $$;
CREATE FUNCTION public.dprt_get_attachment(_tenant uuid,_pipeline uuid,_file uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dprt_authorize(_tenant,_pipeline,'view');a public.data_prep_attachment_retention%ROWTYPE;f public.data_prep_delivery_files%ROWTYPE;t jsonb;
BEGIN
 SELECT * INTO a FROM public.data_prep_attachment_retention WHERE file_id=_file AND tenant_id=_tenant AND pipeline_id=_pipeline;
 IF NOT FOUND THEN RAISE EXCEPTION 'dprt.attachment_unknown'; END IF;
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file;
 IF private.dpw_source_allows(actor,_tenant,f.data_source_id,'view') IS DISTINCT FROM true THEN RAISE EXCEPTION 'dprt.source_read_denied'; END IF;
 SELECT to_jsonb(x) INTO t FROM public.data_prep_attachment_tombstones x WHERE x.file_id=_file;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'retention',to_jsonb(a),'run_id',a.run_id,'filename',f.descriptor->>'filename',
  'view_available',a.expires_at>clock_timestamp() AND t IS NULL,'legal_hold',private.dpw_attachment_has_hold(_file),'tombstone',t,
  'original_path',CASE WHEN a.expires_at>clock_timestamp() AND t IS NULL THEN a.original_path ELSE NULL END);
END $$;
CREATE FUNCTION public.dprt_finish_job(_tenant uuid,_pipeline uuid,_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dprt_authorize(_tenant,_pipeline,'manage');j private.dprt_jobs%ROWTYPE;c private.dprt_certificates%ROWTYPE;
 manifest jsonb;counts jsonb;
BEGIN
 SELECT * INTO j FROM private.dprt_jobs WHERE id=_job FOR UPDATE;
 IF NOT FOUND OR j.tenant_id<>_tenant OR j.pipeline_id<>_pipeline OR j.actor_id<>actor THEN RAISE EXCEPTION 'dprt.job_scope_required'; END IF;
 SELECT * INTO c FROM private.dprt_certificates WHERE job_id=_job;
 IF FOUND THEN RETURN to_jsonb(c); END IF;
 IF EXISTS(SELECT 1 FROM private.dprt_claims x WHERE job_id=_job AND NOT EXISTS(SELECT 1 FROM private.dprt_events e
  WHERE e.claim_id=x.id AND e.event IN('completed','cancelled'))) THEN RAISE EXCEPTION 'dprt.pending_claims'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('file_id',t.file_id,'tombstone_sha256',
  private.dprt_hash(to_jsonb(t)||jsonb_build_object('retention',to_jsonb(a)))) ORDER BY t.file_id),'[]'::jsonb)
 INTO manifest FROM public.data_prep_attachment_tombstones t JOIN public.data_prep_attachment_retention a ON a.file_id=t.file_id WHERE t.job_id=_job;
 counts:=jsonb_build_object('candidate_count',cardinality(j.candidate_files),'claim_count',(SELECT count(*) FROM private.dprt_claims WHERE job_id=_job),
  'purged_count',jsonb_array_length(manifest),'unpurged_count',cardinality(j.candidate_files)-jsonb_array_length(manifest));
 INSERT INTO private.dprt_certificates(job_id,actor_id,counts,tombstone_manifest,tombstone_manifest_sha256)
 VALUES(_job,actor,counts,manifest,private.dprt_hash(manifest)) RETURNING * INTO c;
 PERFORM private.dpw_audit(actor,_tenant,'dprt.job.certificate',_job,to_jsonb(c));
 RETURN to_jsonb(c);
END $$;

DO $acl$
DECLARE relation text;fn record;
BEGIN
 FOREACH relation IN ARRAY ARRAY['dprt_jobs','dprt_claims','dprt_events','dprt_receipts','dprt_certificates','dprt_hold_requests'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',relation);
  EXECUTE format('CREATE TRIGGER dprt_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable()',relation);
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure AS signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN('public','private') AND p.proname LIKE 'dprt_%' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',fn.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature);
  IF fn.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',fn.signature,
   CASE WHEN fn.proname IN('dprt_record_verified_receipt','dprt_finalize_attachment') THEN 'service_role' ELSE 'authenticated' END); END IF;
 END LOOP;
END $acl$;


-- FROZEN INPUT JOINED-AUTHORITY-OVERLAY.sql SHA256 9ec70fea1fa0dc8b88cd124bc99cd2acb09632a5434e57ad4bb334ad4c4746c1
-- NEW joined RS purposes only. Preserve every producer scope/lifecycle/RLP check.
-- Independent bare current actor/factor attestation; never depends on Prep enablement.
CREATE OR REPLACE FUNCTION private.rs_actor(_tenant uuid,_definition uuid,_action text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE a uuid:=auth.uid();d public.recon_definitions%ROWTYPE;
BEGIN
 IF a IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR _action NOT IN('read','run','edit')
 OR private.rlnext_account_allowed(a,NULL) IS DISTINCT FROM true OR private.rlnext_account_allowed(a,_tenant) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=a AND active)
 THEN RAISE EXCEPTION 'rs.current_actor_denied' USING ERRCODE='42501';END IF;
 PERFORM private.wfm_actor(_tenant);
 PERFORM private.wfm_assert_enabled(_tenant,'recons');
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.scope_denied' USING ERRCODE='42501';END IF;
 IF (_action='read' AND (private.recon_run_read_allowed(d.id,_tenant) IS DISTINCT FROM true
   OR private.recon_run_effective_read_allowed(d.id,_tenant) IS DISTINCT FROM true))
 OR (_action IN('run','edit') AND private.recon_root_write_allowed(d.id,_tenant,_action) IS DISTINCT FROM true) THEN
  -- Reuse current native read/write predicates including their exact legacy
  -- ancestry rules. No role reinterpretation, alias, override or new authority.
  RAISE EXCEPTION 'rs.current_resource_action_denied' USING ERRCODE='42501';END IF;
 IF _action='run' AND d.governance_state='approved_locked' AND d.environment='production'
 AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=a AND active AND role='tenant_admin'::public.tenant_role)
 THEN RAISE EXCEPTION 'rs.production_admission_denied' USING ERRCODE='42501';END IF;
 RETURN a;
END $$;
-- Owner policy: a legal hold prevents purge; it never implicitly extends the recorded read window.
CREATE OR REPLACE FUNCTION private.rs_artifact_read_state(_tenant uuid,_run uuid,_side text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $artifact_state$
DECLARE q private.rs_requests%ROWTYPE;expiry timestamptz;held boolean;tombstoned boolean;available boolean;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE run_id=_run AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.exact_artifact_run_unavailable' USING ERRCODE='42501';END IF;
 PERFORM private.rs_actor(_tenant,q.definition_id,'read');
 expiry:=(q.attachment_receipt->>'expires_at')::timestamptz;
 held:=EXISTS(SELECT 1 FROM private.rs_attachment_holds WHERE run_id=_run);
 tombstoned:=q.attachment_receipt->'tombstoned'='true'::jsonb OR EXISTS(
  SELECT 1 FROM private.rs_events WHERE run_id=_run AND kind IN('attachment_tombstoned','artifact_tombstoned')
  AND (payload->>'side_id' IS NULL OR _side IS NULL OR payload->>'side_id'=_side));
 tombstoned:=coalesce(tombstoned,false);
 available:=NOT tombstoned AND expiry IS NOT NULL AND statement_timestamp()<expiry;
 RETURN jsonb_build_object('available',available,'state',CASE WHEN tombstoned THEN 'tombstoned' WHEN available THEN 'available' ELSE 'expired' END,
  'run_id',q.run_id,'side_id',_side,'expires_at',expiry,'legal_hold',held,'metadata_retained',true,
  'physical_purge_performed',false,'reason',CASE WHEN tombstoned THEN 'Original execution attachment is tombstoned; retained run and event metadata remain.'
   WHEN NOT available THEN 'Original execution attachment availability expired; retained run and event metadata remain.' ELSE NULL END);
END $artifact_state$;


-- FROZEN INPUT COMPOSITION-FINAL-OVERLAY.sql SHA256 91a42a949ab2169032858b3cc2290d706b3c1958e7f2cb372db31e1fabbe7730
-- Narrow final overlay for NEW packet declarations only. No provider execution. Apply in reviewed composition order; do NOT also apply the full Curie bridge file.
CREATE OR REPLACE FUNCTION private.wfm_actor(_tenant uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();claims jsonb:=auth.jwt();expires timestamptz;
BEGIN
 IF _tenant IS NULL OR actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated'
 OR claims->>'exp' IS NULL OR claims->>'exp' !~ '^[0-9]{1,20}$'
 OR public.rlnext_actor_allowed() IS DISTINCT FROM true OR private.rlnext_account_allowed(actor,NULL) IS DISTINCT FROM true
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant) THEN RAISE EXCEPTION 'wfm.current_account_denied' USING ERRCODE='42501';END IF;
 BEGIN expires:=to_timestamp((claims->>'exp')::double precision);EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'wfm.current_account_denied' USING ERRCODE='42501';END;
 IF expires<=clock_timestamp() THEN RAISE EXCEPTION 'wfm.current_account_denied' USING ERRCODE='42501';END IF;
 IF public.is_platform_admin(actor) IS TRUE THEN
  IF private.wfm_platform_factor_attest() IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.platform_factor_denied' USING ERRCODE='42501';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active IS TRUE)
  OR private.dpw_native_factor_attest(actor,_tenant,claims->>'aal',expires) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'wfm.current_membership_or_factor_denied' USING ERRCODE='42501';END IF;
 END IF;
 RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION private.wfm_platform_factor_attest()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $platform_factor$
DECLARE actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); expires numeric;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
 OR claims->>'aal' IS DISTINCT FROM 'aal2'
 OR jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number'
 OR public.is_platform_admin(actor) IS DISTINCT FROM true
 OR private.rlnext_account_allowed(actor,NULL) IS DISTINCT FROM true
 OR private.rlnext_has_verified_mfa(actor) IS DISTINCT FROM true
 THEN RETURN false; END IF;
 expires:=(claims->>'exp')::numeric;
 IF expires<=extract(epoch FROM clock_timestamp()) THEN RETURN false; END IF;
 -- The native account helper intentionally tolerates unmanaged owners. Their
 -- current real user/factor is checked without creating a fictional account row.
 RETURN EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()));
END $platform_factor$;

CREATE OR REPLACE FUNCTION private.dpw_mode_attest(_actor uuid,_tenant uuid,_pipeline uuid,_mode text,_human_in_loop boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.platform_ai_settings%ROWTYPE;t public.tenant_ai_settings%ROWTYPE;cfg jsonb;
BEGIN
 -- Peer-safe translation of reviewed wfm_mode_allowed; no service auth.uid()
 -- substitution. Platform/tenant/workspace ceilings and kill switches remain.
 IF private.dpw_workspace_feature_attest(_actor,_tenant) IS DISTINCT FROM true OR _mode IS NULL THEN RETURN false; END IF;
 IF _actor IS NULL OR _tenant IS NULL OR _pipeline IS NULL OR _human_in_loop IS NULL THEN RETURN false;END IF;
 IF _mode='assisted' AND _human_in_loop IS DISTINCT FROM true THEN RETURN false;END IF;
 IF _mode='manual' THEN RETURN true; END IF;
 IF _mode NOT IN('assisted','agentic') OR _human_in_loop IS NULL THEN RETURN false; END IF;
 SELECT * INTO p FROM public.platform_ai_settings WHERE id=true;IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO t FROM public.tenant_ai_settings WHERE tenant_id=_tenant;IF NOT FOUND THEN RETURN false;END IF;
 SELECT config INTO cfg FROM public.tenant_feature_flags WHERE tenant_id=_tenant AND feature_key='data_prep';
 IF p.ai_enabled IS DISTINCT FROM true OR t.ai_enabled IS DISTINCT FROM true OR cfg->'ai_enabled' IS DISTINCT FROM 'true'::jsonb
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND ai_enabled IS TRUE)
 OR EXISTS(SELECT 1 FROM public.ai_governance_kill_switches WHERE engaged IS TRUE AND (tenant_id=_tenant OR tenant_id IS NULL)) THEN RETURN false;END IF;
 IF _mode='assisted' THEN RETURN cfg->'assisted_enabled'='true'::jsonb AND p.allow_copilot_global AND t.allow_copilot
 AND private.wfm_feature_enabled(_tenant,'copilot') AND public.user_has_permission(_actor,_tenant,'ai.copilot.use',NULL) IS TRUE;END IF;
 RETURN cfg->'agentic_enabled'='true'::jsonb AND p.allow_agent_global AND t.allow_agent AND private.wfm_feature_enabled(_tenant,'agent')
 AND p.default_autonomy_ceiling IN('assist','auto') AND t.default_autonomy IN('supervised','autonomous')
 AND public.user_has_permission(_actor,_tenant,'ai.agent.run',NULL) IS TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.dpw_set_execution_mode(_tenant_id uuid,_pipeline_id uuid,_mode text,_human_in_loop boolean,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; choice public.data_prep_mode_choices%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('wfm:'||_tenant_id::text,0));
 actor:=private.dpw_authorize(_tenant_id,_pipeline_id,'edit');
 IF _mode IS NULL OR _mode NOT IN('manual','assisted','agentic') OR _human_in_loop IS NULL OR _request_key IS NULL
 OR private.dpw_mode_attest(actor,_tenant_id,_pipeline_id,_mode,_human_in_loop) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.mode_denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||actor::text||_request_key::text,61));
 SELECT * INTO choice FROM public.data_prep_mode_choices WHERE tenant_id=_tenant_id AND chosen_by=actor AND request_key=_request_key;
 IF FOUND THEN
  IF choice.pipeline_id<>_pipeline_id OR choice.mode<>_mode OR choice.human_in_loop<>_human_in_loop THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'choice',to_jsonb(choice),'is_new',false);
 END IF;
 INSERT INTO public.data_prep_mode_choices(tenant_id,pipeline_id,chosen_by,mode,human_in_loop,request_key)
 VALUES(_tenant_id,_pipeline_id,actor,_mode,_human_in_loop,_request_key) RETURNING * INTO choice;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.mode.choose',choice.id,jsonb_build_object('mode',_mode,'human_in_loop',_human_in_loop,'final_human_approval_required',true));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'choice',to_jsonb(choice),'is_new',true);
END $$;

CREATE OR REPLACE FUNCTION public.dpw_open_file_intent(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_feed_key text,_descriptor jsonb,_request_key uuid,_correction_of uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 f public.data_prep_delivery_files%ROWTYPE; profile jsonb; fid uuid:=gen_random_uuid(); newfile boolean:=true;
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant_id,'data');
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT value INTO profile FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=_feed_key;
 IF profile IS NULL OR private.dpw_source_allows(actor,_tenant_id,(profile->>'data_source_id')::uuid,'ingest') IS DISTINCT FROM true
 OR _request_key IS NULL OR jsonb_typeof(_descriptor) IS DISTINCT FROM 'object'
 OR (_descriptor->>'content_sha256') IS NULL OR (_descriptor->>'content_sha256') !~ '^[a-f0-9]{64}$'
 OR (_descriptor->>'parsed_sha256') IS NULL OR (_descriptor->>'parsed_sha256') !~ '^[a-f0-9]{64}$'
 OR (_descriptor->>'size_bytes') IS NULL OR (_descriptor->>'size_bytes')::bigint NOT BETWEEN 1 AND 52428800
 OR (_descriptor->>'parsed_bytes') IS NULL OR (_descriptor->>'parsed_bytes')::bigint NOT BETWEEN 2 AND 52428800
 OR (_descriptor->>'row_count') IS NULL OR (_descriptor->>'row_count')::integer NOT BETWEEN 0 AND 50000
 OR jsonb_typeof(_descriptor->'columns') IS DISTINCT FROM 'array' OR jsonb_array_length(_descriptor->'columns') NOT BETWEEN 1 AND 500
 OR length(coalesce(_descriptor->>'filename','')) NOT BETWEEN 1 AND 255 OR length(coalesce(_descriptor->>'mime_type','')) NOT BETWEEN 1 AND 255
 THEN RAISE EXCEPTION 'dpw.invalid_file_intent'; END IF;
 SELECT x.* INTO f FROM public.data_prep_delivery_files x JOIN public.data_prep_file_requests a ON a.file_id=x.id
 WHERE a.batch_id=b.id AND a.feed_key=_feed_key AND a.request_key=_request_key;
 IF FOUND THEN
  IF f.descriptor IS DISTINCT FROM _descriptor OR f.correction_of IS DISTINCT FROM _correction_of THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  newfile:=false;
 ELSE
  SELECT * INTO f FROM public.data_prep_delivery_files WHERE batch_id=b.id AND feed_key=_feed_key AND content_sha256=_descriptor->>'content_sha256';
  IF FOUND THEN
   IF f.descriptor IS DISTINCT FROM _descriptor THEN RAISE EXCEPTION 'dpw.same_file_descriptor_conflict'; END IF;
   newfile:=false;
  ELSE
   IF b.state<>'collecting' THEN RAISE EXCEPTION 'dpw.late_file_requires_correction'; END IF;
   IF _correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_files
   WHERE id=_correction_of AND batch_id=b.correction_of AND feed_key=_feed_key AND tenant_id=_tenant_id)
   THEN RAISE EXCEPTION 'dpw.file_correction_mismatch'; END IF;
   INSERT INTO public.data_prep_delivery_files(id,tenant_id,pipeline_id,batch_id,pipeline_version,feed_key,data_source_id,created_by,descriptor,request_key,content_sha256,original_path,correction_of)
   VALUES(fid,_tenant_id,_pipeline_id,b.id,b.pipeline_version,_feed_key,(profile->>'data_source_id')::uuid,actor,_descriptor,_request_key,
   _descriptor->>'content_sha256',_tenant_id::text||'/'||b.id::text||'/'||fid::text||'/original',_correction_of) RETURNING * INTO f;
  END IF;
 END IF;
 INSERT INTO public.data_prep_file_requests(batch_id,feed_key,request_key,file_id,requested_descriptor,created_by)
 VALUES(b.id,_feed_key,_request_key,f.id,_descriptor,actor) ON CONFLICT(batch_id,feed_key,request_key) DO NOTHING;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',private.dpw_file_metadata(f),'intent',private.dpw_file_metadata(f),'created',newfile,
 'storage_capability',jsonb_build_object('bucket_id','data-prep-inputs','public',false,'max_original_bytes',52428800,
 'max_expanded_bytes',52428800,'max_parsed_bytes',52428800,'max_rows',50000,'max_columns',500));
END $$;

CREATE OR REPLACE FUNCTION public.dpw_commit_input_file(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_file_id uuid,_rows jsonb,_request_key uuid,_verified_subject jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_processor_actor(_tenant_id,_pipeline_id,_verified_subject,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 f public.data_prep_delivery_files%ROWTYPE; up uuid; profile jsonb;
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant_id,'data');
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE id=_file_id AND batch_id=b.id AND tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR f.created_by<>actor OR NOT EXISTS(SELECT 1 FROM public.data_prep_file_requests WHERE batch_id=b.id AND file_id=f.id AND request_key=_request_key)
 OR private.dpw_source_allows(actor,_tenant_id,f.data_source_id,'ingest') IS DISTINCT FROM true
 OR jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows)<>(f.descriptor->>'row_count')::integer
 OR octet_length(_rows::text)>52428800
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(_rows) WHERE jsonb_typeof(value)<>'object')
 THEN RAISE EXCEPTION 'dpw.complete_input_mismatch'; END IF;
 IF f.state='received' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workspace_data_source_uploads WHERE id=f.upload_id AND rows=_rows AND row_count=jsonb_array_length(_rows))
  THEN RAISE EXCEPTION 'dpw.immutable_upload_mismatch'; END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',to_jsonb(f),'is_new',false);
 END IF;
 IF f.state<>'uploading' OR b.state<>'collecting' THEN RAISE EXCEPTION 'dpw.intake_closed'; END IF;
 SELECT value INTO profile FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=f.feed_key;
 IF jsonb_array_length(_rows)=0 AND (profile->>'allow_empty')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.empty_input_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='data-prep-inputs' AND o.name=f.original_path
 AND (o.metadata->>'size')::bigint=(f.descriptor->>'size_bytes')::bigint)
 THEN RAISE EXCEPTION 'dpw.original_object_unconfirmed'; END IF;
 INSERT INTO public.workspace_data_source_uploads(data_source_id,tenant_id,filename,mime_type,size_bytes,row_count,columns,sample_rows,content_sha256,uploaded_by,rows)
 VALUES(f.data_source_id,_tenant_id,f.descriptor->>'filename',f.descriptor->>'mime_type',(f.descriptor->>'size_bytes')::bigint,
 jsonb_array_length(_rows),f.descriptor->'columns','[]'::jsonb,f.content_sha256,actor,_rows) RETURNING id INTO up;
 UPDATE public.data_prep_delivery_files SET state='received',upload_id=up,received_at=now(),structured_rows_sha256=private.dpw_hash(_rows) WHERE id=f.id RETURNING * INTO f;
 PERFORM private.dpw_audit(actor,_tenant_id,'dpw.input.received',f.id,jsonb_build_object('batch_id',b.id,'upload_id',up,'row_count',jsonb_array_length(_rows),'sha256',f.content_sha256));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',to_jsonb(f),'transport_role','service_role','is_new',true);
END $$;

CREATE OR REPLACE FUNCTION private.dpw_storage_allows(_name text,_write boolean) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE actor uuid; f public.data_prep_delivery_files%ROWTYPE; b public.data_prep_delivery_batches%ROWTYPE;
BEGIN
 SELECT * INTO f FROM public.data_prep_delivery_files WHERE original_path=_name;
 IF NOT FOUND THEN RETURN false; END IF;
 actor:=private.dpw_actor(f.tenant_id);
 IF _write THEN PERFORM private.wfm_assert_enabled(f.tenant_id,'data');END IF;
 SELECT * INTO b FROM public.data_prep_delivery_batches WHERE id=f.batch_id;
 RETURN (NOT _write OR f.created_by=actor) AND private.dpw_attachment_viewable(f.id) IS TRUE
 AND private.data_prep_pipeline_scope_allows(actor,f.tenant_id,f.pipeline_id,'run') IS TRUE
 AND private.dpw_source_allows(actor,f.tenant_id,f.data_source_id,CASE WHEN _write THEN 'ingest' ELSE 'view' END) IS TRUE
 AND (NOT _write OR (f.state='uploading' AND b.state='collecting'));
END $$;

CREATE OR REPLACE FUNCTION private.wfm_mode_choice_recorded() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_mode text;actor uuid:=private.wfm_actor(NEW.tenant_id);
BEGIN
 IF actor IS DISTINCT FROM NEW.chosen_by OR private.dpw_mode_attest(actor,NEW.tenant_id,NEW.pipeline_id,NEW.mode,NEW.human_in_loop) IS DISTINCT FROM true THEN RAISE EXCEPTION 'wfm.mode_choice_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wfm:'||NEW.tenant_id::text,0));
 SELECT mode INTO previous_mode FROM private.wfm_pipeline_modes WHERE tenant_id=NEW.tenant_id AND pipeline_id=NEW.pipeline_id;
 INSERT INTO private.wfm_pipeline_modes(tenant_id,pipeline_id,mode) VALUES(NEW.tenant_id,NEW.pipeline_id,NEW.mode) ON CONFLICT(tenant_id,pipeline_id) DO UPDATE SET mode=EXCLUDED.mode;
 PERFORM private.wfm_record(NEW.tenant_id,'pipeline-mode',NEW.pipeline_id::text,jsonb_build_object('mode',coalesce(previous_mode,'manual')),jsonb_build_object('mode',NEW.mode,'choice_id',NEW.id));
 RETURN NEW;
END $$;

CREATE TRIGGER wfm_mode_choice_recorded AFTER INSERT ON public.data_prep_mode_choices FOR EACH ROW EXECUTE FUNCTION private.wfm_mode_choice_recorded();

-- Deliberate owner-policy denial, not an unqualified stub. Claims/finalization remain inactive until separately qualified and authorized.
CREATE OR REPLACE FUNCTION private.dpw_retention_attest() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT false $$;
DO $$DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure sig,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='private' AND p.proname IN('wfm_actor','wfm_platform_factor_attest','dpw_mode_attest','dpw_storage_allows','wfm_mode_choice_recorded','dpw_retention_attest'))
 OR (n.nspname='public' AND p.proname IN('dpw_set_execution_mode','dpw_open_file_intent','dpw_commit_input_file')) LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',r.sig);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);
 IF r.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',r.sig,CASE WHEN r.proname='dpw_commit_input_file' THEN 'service_role' ELSE 'authenticated' END);
 ELSIF r.proname='dpw_storage_allows' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.sig);END IF;
 END LOOP;END$$;


-- FROZEN INPUT ORDINARY-COHORT-PRODUCER.sql SHA256 f315996ef7be4e2ea9651332c35c8aa8a32e0e8d6a635fc147344e68066c1a37
-- New-only native producer; primary registers and qualifies this exact purpose.
-- A user-selected dated snapshot cohort is independent of optional market timing.
CREATE FUNCTION public.list_recon_ordinary_inputs(_tenant_id uuid,_definition_id uuid,_side_id text,_page integer DEFAULT 0,_page_size integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant_id,_definition_id,'run');d public.recon_definitions%ROWTYPE;s jsonb;items jsonb;total bigint;
BEGIN
 IF _page NOT BETWEEN 0 AND 1000000 OR _page_size NOT BETWEEN 1 AND 100 OR _page IS NULL OR _page_size IS NULL
 THEN RAISE EXCEPTION 'rs.finite_input_page_required' USING ERRCODE='22023';END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_definition_required' USING ERRCODE='42501';END IF;
 PERFORM private.recon_run_bound_approved_version(_tenant_id,_definition_id,actor);
 SELECT x.value INTO s FROM jsonb_array_elements(d.sides) x WHERE x.value->>'side_id'=_side_id;
 IF s IS NULL OR private.data_source_child_allows(actor,_tenant_id,(s->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'rs.exact_configured_source_required' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO total FROM public.workspace_data_source_uploads u WHERE u.tenant_id=_tenant_id AND u.data_source_id=(s->>'data_source_id')::uuid
 AND (s->>'upload_id' IS NULL OR u.id::text=s->>'upload_id');
 SELECT coalesce(jsonb_agg(jsonb_build_object('upload_id',u.id,'data_source_id',u.data_source_id,'arrival_at',u.created_at,'row_count',u.row_count,
  'fixed_approved_or_configured_pin',s->>'upload_id' IS NOT NULL) ORDER BY u.created_at DESC,u.id DESC),'[]') INTO items
 FROM (SELECT u.id,u.data_source_id,u.created_at,u.row_count FROM public.workspace_data_source_uploads u WHERE u.tenant_id=_tenant_id
  AND u.data_source_id=(s->>'data_source_id')::uuid AND (s->>'upload_id' IS NULL OR u.id::text=s->>'upload_id') ORDER BY u.created_at DESC,u.id DESC
  OFFSET _page*_page_size LIMIT _page_size) u;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'definition_id',_definition_id,'side_id',_side_id,
  'input_options',items,'total',total::text,'page',_page,'page_size',_page_size,'has_next',((_page::bigint+1)*_page_size)<total,
  'automatic_latest_selection',false,'original_source_rows_returned',false);
END $$;
CREATE FUNCTION private.rs_resolve_ordinary_policy(_tenant uuid,_definition uuid,_business_date date,_pins jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'run');contract jsonb;s jsonb;pin jsonb;c jsonb;approved public.recon_definition_approved_versions%ROWTYPE;
 d public.recon_definitions%ROWTYPE;snapshot jsonb;configuration_sha text;authority text;declared jsonb;
 u public.workspace_data_source_uploads%ROWTYPE;pins jsonb:='[]';proofs jsonb:='[]';identity jsonb;v_policy jsonb;qualification jsonb;hash text;v_policy_id uuid;
BEGIN
 IF _business_date IS NULL OR _business_date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'rs.explicit_business_date_required' USING ERRCODE='22023';END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_configuration_required' USING ERRCODE='42501';END IF;
 approved:=private.recon_run_bound_approved_version(_tenant,_definition,actor);
 IF approved.id IS NOT NULL THEN
  contract:=public.read_recon_contract(_tenant,_definition,approved.id);authority:='native_approved_revision';
  IF contract->'approved' IS DISTINCT FROM 'true'::jsonb OR contract->'current_revision' IS DISTINCT FROM 'true'::jsonb
  OR contract->'contract_available' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'rs.current_approved_contract_required' USING ERRCODE='42501';END IF;
 ELSE
  -- Existing native helper permits these governed non-production configurations.
  -- Do not invent a checker, approval hash or historical revision for them.
  IF NOT ((d.environment='development' AND d.governance_state='development_draft')
   OR (d.environment IN('development','staging') AND d.governance_state='staging_copy')
   OR (d.access_mode='mapped_exact' AND d.governance_state='legacy_mapped'))
  THEN RAISE EXCEPTION 'rs.native_configuration_not_executable' USING ERRCODE='42501';END IF;
  snapshot:=private.recon_definition_config_snapshot(d);configuration_sha:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
  contract:=jsonb_build_object('sides',snapshot->'sides','input_contracts',private.rs_approved_rule_contracts(snapshot),
   'revision_id',NULL,'expected_definition_sha256',configuration_sha);authority:='native_current_configuration';
 END IF;
 IF _pins IS NOT NULL AND (jsonb_typeof(_pins) IS DISTINCT FROM 'array' OR jsonb_array_length(_pins)<>jsonb_array_length(contract->'sides')
 OR (SELECT count(DISTINCT x->>'side_id') FROM jsonb_array_elements(_pins) x)<>jsonb_array_length(_pins))
 THEN RAISE EXCEPTION 'rs.complete_distinct_pins_required' USING ERRCODE='22023';END IF;
 FOR s IN SELECT x.value FROM jsonb_array_elements(contract->'sides') x ORDER BY x.value->>'side_id' LOOP
  IF _pins IS NULL THEN pin:=jsonb_build_object('side_id',s->>'side_id','upload_id',s->>'upload_id');
  ELSE SELECT x.value INTO pin FROM jsonb_array_elements(_pins) x WHERE x.value->>'side_id'=s->>'side_id';END IF;
  IF pin->>'upload_id' IS NULL OR s->>'upload_id' IS NOT NULL AND s->>'upload_id' IS DISTINCT FROM pin->>'upload_id'
  THEN RAISE EXCEPTION 'rs.explicit_input_selection_required_no_latest_fallback' USING ERRCODE='PT409';END IF;
  IF private.data_source_child_allows(actor,_tenant,(s->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'rs.current_source_denied' USING ERRCODE='42501';END IF;
  SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(pin->>'upload_id')::uuid AND tenant_id=_tenant AND data_source_id=(s->>'data_source_id')::uuid;
  IF NOT FOUND OR jsonb_typeof(u.rows) IS DISTINCT FROM 'array' OR u.row_count<>jsonb_array_length(u.rows) OR u.row_count=0
  THEN RAISE EXCEPTION 'rs.exact_nonempty_input_required' USING ERRCODE='42501';END IF;
  IF s->>'upload_id' IS NULL AND (EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets x WHERE x.tenant_id=_tenant AND x.upload_id=u.id)
   OR EXISTS(SELECT 1 FROM public.data_prep_pipelines p WHERE p.tenant_id=_tenant AND p.output_data_source_id=u.data_source_id))
  THEN RAISE EXCEPTION 'rs.prepared_source_requires_native_per_run_binding' USING ERRCODE='42501';END IF;
  SELECT x.value INTO c FROM jsonb_array_elements(contract->'input_contracts') x WHERE x.value->>'side_id'=s->>'side_id';
  IF authority='native_current_configuration' THEN
   declared:=private.rs_schema_profile(_tenant,(s->>'data_source_id')::uuid,coalesce(s->'column_mapping','{}'));
   c:=c||jsonb_build_object('provenance','configured_rule_contract','approval_bound',false,'source_declared_fields',coalesce(declared->'fields','[]'));
  END IF;
  IF c IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(u.rows) x WHERE private.rs_contract_row_allowed(x.value,c) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION 'rs.approved_input_domain_refused' USING ERRCODE='22023';END IF;
  pins:=pins||jsonb_build_array(jsonb_build_object('side_id',s->>'side_id','upload_id',u.id));
  proofs:=proofs||jsonb_build_array(jsonb_build_object('side_id',s->>'side_id','data_source_id',u.data_source_id,'upload_id',u.id,
   'rows_sha256',encode(sha256(convert_to(u.rows::text,'UTF8')),'hex'),'arrival_at',u.created_at,'input_rows',u.row_count));
 END LOOP;
 identity:=jsonb_build_object('tenant_id',_tenant,'definition_id',_definition,'approved_revision_id',contract->>'revision_id',
  'configuration_sha256',contract->>'expected_definition_sha256','configuration_authority',authority,'business_date',_business_date,'pins',pins,'input_proofs',proofs,'cohort_mode','explicit_snapshot_selection','version','ordinary_snapshot_v1');
 hash:=encode(sha256(convert_to(identity::text,'UTF8')),'hex');v_policy_id:=substr(hash,1,32)::uuid;
 v_policy:=identity||jsonb_build_object('policy_id',v_policy_id,'version','ordinary_snapshot_v1','policy_kind','ordinary_native_snapshot',
  'date_basis','user_selected_business_date','as_of',_business_date::text||'T00:00:00Z','market_calendar_available',false,
  'feed_timing_available',false,'no_market_cutoff_inferred',true,'source_business_dates_inferred',false);
 qualification:=jsonb_build_object('state','native_qualified','kind','ordinary_native_snapshot','producer','resolve_recon_ordinary_cohort',
  'actor_id',actor,'approved_revision_id',contract->>'revision_id','configuration_authority',authority,'configuration_sha256',contract->>'expected_definition_sha256','identity_sha256',hash);
 INSERT INTO private.rs_policies(tenant_id,definition_id,policy_id,version,policy,qualification)
 VALUES(_tenant,_definition,v_policy_id,'ordinary_snapshot_v1',v_policy,qualification) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM private.rs_policies p WHERE p.tenant_id=_tenant AND p.definition_id=_definition AND p.policy_id=v_policy_id
  AND p.version='ordinary_snapshot_v1' AND p.policy=v_policy) THEN RAISE EXCEPTION 'rs.immutable_cohort_policy_conflict' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',_definition,'business_date',_business_date,'policy_id',v_policy_id,
  'policy_version','ordinary_snapshot_v1','pins',pins,'input_proofs',proofs,'expected_definition_sha256',contract->>'expected_definition_sha256',
  'approved_revision_id',contract->>'revision_id','configuration_authority',authority,'cohort_mode','explicit_snapshot_selection','market_calendar_available',false,'feed_timing_available',false);
END $$;

CREATE FUNCTION private.rs_prior_ordinary_policy(_tenant uuid,_definition uuid,_business_date date,_pins jsonb,_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'run');q private.rs_requests%ROWTYPE;p jsonb;normalized jsonb;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE tenant_id=_tenant AND definition_id=_definition AND actor_id=actor AND request_key=_key;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT policy INTO p FROM private.rs_policies WHERE tenant_id=_tenant AND definition_id=_definition AND policy_id=(q.intent->>'policy_id')::uuid AND version=q.intent->>'policy_version';
 IF _pins IS NOT NULL THEN SELECT jsonb_agg(x.value ORDER BY x.value->>'side_id') INTO normalized FROM jsonb_array_elements(_pins) x;END IF;
 IF p->>'policy_kind' IS DISTINCT FROM 'ordinary_native_snapshot' OR p->>'business_date' IS DISTINCT FROM _business_date::text
 OR _pins IS NOT NULL AND normalized IS DISTINCT FROM p->'pins' THEN RAISE EXCEPTION 'rs.request_key_conflict' USING ERRCODE='PT409';END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',_definition,'business_date',p->>'business_date',
  'policy_id',p->>'policy_id','policy_version',p->>'version','pins',p->'pins','input_proofs',p->'input_proofs',
  'expected_definition_sha256',p->>'configuration_sha256','approved_revision_id',p->>'approved_revision_id','configuration_authority',p->>'configuration_authority',
  'cohort_mode','explicit_snapshot_selection','market_calendar_available',false,'feed_timing_available',false,'replayed_policy',true);
END $$;

CREATE FUNCTION public.resolve_recon_ordinary_cohort(_tenant_id uuid,_definition_id uuid,_business_date date,_pins jsonb,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE result jsonb;p jsonb;
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'run');
 PERFORM 1 FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_definition_required' USING ERRCODE='42501';END IF;
 IF _request_key IS NULL THEN RAISE EXCEPTION 'rs.explicit_request_key_required' USING ERRCODE='22023';END IF;
 result:=private.rs_prior_ordinary_policy(_tenant_id,_definition_id,_business_date,_pins,_request_key);
 IF result IS NOT NULL THEN RETURN result;END IF;
 result:=private.rs_resolve_ordinary_policy(_tenant_id,_definition_id,_business_date,_pins);
 FOR p IN SELECT x.value FROM jsonb_array_elements(result->'input_proofs') x LOOP
  PERFORM 1 FROM public.workspace_data_sources WHERE id=(p->>'data_source_id')::uuid AND tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_source_required' USING ERRCODE='42501';END IF;
  PERFORM 1 FROM public.workspace_data_source_uploads WHERE id=(p->>'upload_id')::uuid AND tenant_id=_tenant_id AND data_source_id=(p->>'data_source_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_exact_upload_required' USING ERRCODE='42501';END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_recon_ordinary_inputs(uuid,uuid,text,integer,integer),private.rs_resolve_ordinary_policy(uuid,uuid,date,jsonb),private.rs_prior_ordinary_policy(uuid,uuid,date,jsonb,uuid),public.resolve_recon_ordinary_cohort(uuid,uuid,date,jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_recon_ordinary_inputs(uuid,uuid,text,integer,integer),private.rs_resolve_ordinary_policy(uuid,uuid,date,jsonb),private.rs_prior_ordinary_policy(uuid,uuid,date,jsonb,uuid),public.resolve_recon_ordinary_cohort(uuid,uuid,date,jsonb,uuid) TO authenticated;


-- FROZEN INPUT RECON-QUEUE-GROUP-PORTS.sql SHA256 8c277fc615c877892c2ec61ccb23a872cdf09a82178d19a5e4090e4b060604c2
-- New exact native read/manual intent ports. Suggest is retained globally.
CREATE FUNCTION private.rs_read_group_intents(_tenant uuid,_definition uuid,_run uuid,_group uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'read');g private.rs_groups%ROWTYPE;result jsonb;
BEGIN
 SELECT * INTO g FROM private.rs_groups WHERE run_id=_run AND native_id=_group;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND definition_id=_definition)
 THEN RAISE EXCEPTION 'rs.exact_group_history_required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actor_id',e.actor_id,'occurred_at',e.occurred_at,'payload',e.payload) ORDER BY e.occurred_at,e.id),'[]') INTO result
 FROM private.rs_events e WHERE e.run_id=_run AND e.kind='group_action_requested' AND e.payload->>'group_id'=_group::text;
 RETURN result;
END $$;
CREATE FUNCTION private.rs_queue_snapshot(_tenant uuid,_definition uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'read');items jsonb;active_count integer;
BEGIN
 SELECT count(*) INTO active_count FROM public.recon_runs WHERE tenant_id=_tenant AND definition_id=_definition AND status='running';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'public_id',x.run_uid,'status',x.status,'position',x.position,
  'progress',NULL,'owned_intent_available',x.intent_available,'dispatch_actor_is_current',x.run_by=actor) ORDER BY x.position),'[]') INTO items
 FROM (SELECT r.id,r.run_uid,r.status,r.run_by,q.run_id IS NOT NULL AS intent_available,
  row_number() OVER(ORDER BY CASE WHEN r.status='running' THEN 0 ELSE 1 END,coalesce(q.created_at,r.started_at),r.id) AS position
  FROM public.recon_runs r LEFT JOIN private.rs_requests q ON q.run_id=r.id
  WHERE r.tenant_id=_tenant AND r.definition_id=_definition AND r.status IN('queued','running')) x;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',_definition,'queue',items,
  'queue_complete',true,'active_count',active_count,'one_active_invariant',active_count<=1,'observed_at',statement_timestamp());
END $$;
CREATE FUNCTION public.read_recon_execution_queue(_tenant_id uuid,_definition_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE result jsonb;item jsonb;
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'read');result:=private.rs_queue_snapshot(_tenant_id,_definition_id);
 FOR item IN SELECT x.value FROM jsonb_array_elements(result->'queue') x LOOP
  PERFORM 1 FROM public.recon_runs WHERE id=(item->>'id')::uuid AND tenant_id=_tenant_id AND definition_id=_definition_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.queue_rlp_scope_changed' USING ERRCODE='42501';END IF;
 END LOOP;RETURN result;
END $$;

CREATE FUNCTION private.rs_record_group_intent(_tenant uuid,_definition uuid,_run uuid,_group uuid,_action text,_detail text,_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'edit');g private.rs_groups%ROWTYPE;e private.rs_events%ROWTYPE;intent jsonb;
BEGIN
 IF _key IS NULL OR (_action IN('comment','label','accept','rematch','carry_forward','exclude_request')) IS DISTINCT FROM true
 OR length(btrim(coalesce(_detail,''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'rs.explicit_group_intent_required' USING ERRCODE='22023';END IF;
 SELECT * INTO g FROM private.rs_groups WHERE run_id=_run AND native_id=_group;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND definition_id=_definition AND status='completed')
 THEN RAISE EXCEPTION 'rs.exact_completed_group_required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(g.source_rows) x WHERE private.data_source_child_allows(actor,_tenant,(x.value->>'data_source_id')::uuid,'view') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'rs.current_group_source_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rs-group:'||_run::text||':'||actor::text||':'||_key::text,0));
 intent:=jsonb_build_object('request_key',_key,'group_id',_group,'match_status',g.match_status,'action',_action,'detail',btrim(_detail),
  'disposition',CASE WHEN _action='comment' THEN 'recorded' ELSE 'requested' END,'business_effect_applied',false,'ai_authority','Suggest');
 SELECT * INTO e FROM private.rs_events WHERE run_id=_run AND actor_id=actor AND kind='group_action_requested' AND payload->>'request_key'=_key::text;
 IF FOUND AND e.payload IS DISTINCT FROM intent THEN RAISE EXCEPTION 'rs.group_request_key_conflict' USING ERRCODE='PT409';END IF;
 IF NOT FOUND THEN INSERT INTO private.rs_events(run_id,actor_id,kind,payload) VALUES(_run,actor,'group_action_requested',intent) RETURNING * INTO e;END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',_definition,'run_id',_run,'group_id',_group,
  'action',_action,'audit_event_id',e.id,'occurred_at',e.occurred_at,'request_key',_key,'disposition',intent->>'disposition',
  'business_effect_applied',false,'matching_outcome_changed',false,'settlement_state_changed',false);
END $$;
CREATE FUNCTION public.request_recon_group_action(_tenant_id uuid,_definition_id uuid,_run_id uuid,_group_id uuid,_action text,_detail text,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
BEGIN
 PERFORM private.rs_actor(_tenant_id,_definition_id,'edit');
 PERFORM 1 FROM public.recon_runs WHERE id=_run_id AND tenant_id=_tenant_id AND definition_id=_definition_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_group_run_required' USING ERRCODE='42501';END IF;
 RETURN private.rs_record_group_intent(_tenant_id,_definition_id,_run_id,_group_id,_action,_detail,_request_key);
END $$;
REVOKE ALL ON FUNCTION private.rs_read_group_intents(uuid,uuid,uuid,uuid),private.rs_queue_snapshot(uuid,uuid),public.read_recon_execution_queue(uuid,uuid),private.rs_record_group_intent(uuid,uuid,uuid,uuid,text,text,uuid),public.request_recon_group_action(uuid,uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_read_group_intents(uuid,uuid,uuid,uuid),private.rs_queue_snapshot(uuid,uuid),public.read_recon_execution_queue(uuid,uuid),private.rs_record_group_intent(uuid,uuid,uuid,uuid,text,text,uuid),public.request_recon_group_action(uuid,uuid,uuid,uuid,text,text,uuid) TO authenticated;


-- FROZEN INPUT JSON-IP-PURPOSE.sql SHA256 15090a1da5e9b567397513953edd2109c41d20cb64ea695d48332bddc0be3875
-- New DP-specific purpose only. Actual existing IP matcher remains service-role-only; no old routine or grant is changed.
-- Install after frozen v3 generic account producer and qualify the exact IP catalogue input snapshots in main's registered fences.
CREATE FUNCTION public.dpw_check_current_ip_access(_tenant_id uuid,_ip text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);enabled boolean;allowed boolean:=false;available boolean;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'dpw.ip_actor_denied' USING ERRCODE='42501';END IF;
 SELECT ip_allowlist_enabled INTO enabled FROM public.tenant_security_settings WHERE tenant_id=_tenant_id;
 available:=FOUND AND enabled IS NOT NULL;
 IF available AND enabled=false THEN allowed:=true;
 ELSIF available AND _ip IS NOT NULL AND btrim(_ip)<>'' THEN allowed:=public.ip_in_tenant_allowlist(_tenant_id,_ip) IS TRUE;END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'policy_available',available,'enabled',CASE WHEN available THEN enabled ELSE NULL END,'allowed',allowed);
END $$;
ALTER FUNCTION public.dpw_check_current_ip_access(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dpw_check_current_ip_access(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dpw_check_current_ip_access(uuid,text) TO authenticated;


-- FROZEN native/MIXED-PREFLIGHT-PRODUCER.sql SHA256 338a30e6c5d0e9bac09f02748c3cfdb7192bb79729f2b9709c8e2d4d3687b240
-- Exact existing DPW prepared preflight/persist mechanisms reused; raw selection extension is new-only.
CREATE FUNCTION private.rs_mixed_preflight(_tenant uuid,_definition uuid,_business_date date,_bindings jsonb,_expected_definition_sha256 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant); approved jsonb; side jsonb; input jsonb;
 d public.data_prep_prepared_datasets%ROWTYPE; u public.workspace_data_source_uploads%ROWTYPE; contract jsonb; field jsonb; indexes integer[]; row_value jsonb;resolved_logical_side text;
BEGIN
 approved:=private.dpw_recon_approved_attest(actor,_tenant,_definition);
 IF (approved->>'reconciliation_feature_enabled')::boolean IS DISTINCT FROM true
 OR _business_date IS NULL OR approved->>'snapshot_sha256' IS DISTINCT FROM _expected_definition_sha256
 OR jsonb_typeof(approved->'snapshot'->'sides') IS DISTINCT FROM 'array' OR jsonb_typeof(_bindings) IS DISTINCT FROM 'array'
 OR jsonb_array_length(_bindings)<>jsonb_array_length(approved->'snapshot'->'sides')
 OR (SELECT count(DISTINCT value->>'side_id') FROM jsonb_array_elements(_bindings))<>jsonb_array_length(_bindings)
 THEN RAISE EXCEPTION 'dpw.recon_approved_input_mismatch'; END IF;
 FOR side IN SELECT value FROM jsonb_array_elements(approved->'snapshot'->'sides') LOOP
  SELECT value INTO input FROM jsonb_array_elements(_bindings) WHERE value->>'side_id'=side->>'side_id';
  IF input IS NULL OR input->>'data_source_id' IS DISTINCT FROM side->>'data_source_id'
  OR private.dpw_source_allows(actor,_tenant,(side->>'data_source_id')::uuid,'view') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'dpw.recon_source_binding_denied'; END IF;
  IF nullif(side->>'upload_id','') IS NOT NULL OR input->>'kind'='fixed_upload' THEN
   IF input->>'kind' IS DISTINCT FROM 'fixed_upload' OR (side->>'upload_id' IS NOT NULL AND input->>'upload_id' IS DISTINCT FROM side->>'upload_id')
   OR input ? 'dataset_id' THEN RAISE EXCEPTION 'dpw.fixed_definition_pin_cannot_be_overridden'; END IF;
   SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(input->>'upload_id')::uuid
   AND tenant_id=_tenant AND data_source_id=(side->>'data_source_id')::uuid;
   IF NOT FOUND OR jsonb_typeof(u.rows)<>'array' OR u.row_count<>jsonb_array_length(u.rows) THEN RAISE EXCEPTION 'dpw.fixed_input_unavailable'; END IF;
   SELECT x.value INTO contract FROM jsonb_array_elements(approved->'input_contracts') x WHERE x.value->>'side_id'=side->>'side_id';
   IF contract IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(u.rows) x WHERE private.rs_contract_row_allowed(x.value,contract) IS DISTINCT FROM true)
   THEN RAISE EXCEPTION 'rs.mixed_raw_approved_domain_refused' USING ERRCODE='22023';END IF;
   IF side->>'upload_id' IS NULL AND (EXISTS(SELECT 1 FROM public.data_prep_prepared_datasets x WHERE x.tenant_id=_tenant AND x.upload_id=u.id)
    OR EXISTS(SELECT 1 FROM public.data_prep_pipelines p WHERE p.tenant_id=_tenant AND p.output_data_source_id=u.data_source_id))
   THEN RAISE EXCEPTION 'rs.prepared_source_requires_dataset_identity' USING ERRCODE='42501';END IF;
  ELSE
   SELECT value INTO contract FROM jsonb_array_elements(coalesce(approved->'input_contracts','[]'::jsonb)) WHERE value->>'side_id'=side->>'side_id';
   IF contract IS NULL OR (contract->>'logical_side' IS NOT NULL AND contract->>'logical_side' IS DISTINCT FROM input->>'logical_side')
   OR jsonb_typeof(contract->'fields') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'dpw.recon_authoritative_schema_missing_governed_revision_required'; END IF;
   SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE id=(input->>'dataset_id')::uuid AND tenant_id=_tenant;
   IF NOT FOUND THEN RAISE EXCEPTION 'dpw.current_ready_dataset_required';END IF;
   resolved_logical_side:=coalesce(contract->>'logical_side',private.rs_select_compatible_logical_side(_tenant,d.id,contract));
   IF resolved_logical_side IS DISTINCT FROM input->>'logical_side' THEN RAISE EXCEPTION 'dpw.unique_approved_rule_compatible_cohort_required';END IF;
   IF NOT FOUND OR input->>'kind' IS DISTINCT FROM 'prepared_dataset' OR d.business_date<>_business_date
   OR input->>'pipeline_id' IS DISTINCT FROM d.pipeline_id::text OR (input->>'pipeline_version')::integer IS DISTINCT FROM d.pipeline_version
   OR input->>'upload_id' IS DISTINCT FROM d.upload_id::text OR d.data_source_id::text IS DISTINCT FROM side->>'data_source_id'
   OR private.data_prep_pipeline_scope_allows(actor,_tenant,d.pipeline_id,'view') IS DISTINCT FROM true
   OR private.dpw_run_payload_available(d.run_id) IS DISTINCT FROM true
   OR NOT EXISTS(SELECT 1 FROM public.data_prep_pipelines p WHERE p.id=d.pipeline_id AND p.tenant_id=_tenant AND p.status='approved'
   AND p.lifecycle_state='production' AND p.version=d.pipeline_version AND p.output_data_source_id=d.data_source_id)
   OR NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_runs r,jsonb_array_elements(r.snapshot->'feeds') f
   WHERE r.id=d.run_id AND f.value->>'business_side'=resolved_logical_side)
   OR NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_batches b JOIN public.data_prep_delivery_runs r ON r.id=d.run_id AND r.batch_id=b.id
   WHERE b.id=d.batch_id AND b.mode='prepare' AND b.state='published' AND r.pipeline_version=d.pipeline_version
   AND r.finished_at IS NOT NULL AND r.state IN('success','warn') AND (r.result->>'publication_eligible')::boolean IS TRUE)
   THEN RAISE EXCEPTION 'dpw.current_ready_dataset_required'; END IF;
   SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=d.upload_id AND tenant_id=_tenant AND data_source_id=d.data_source_id;
   IF NOT FOUND OR u.content_sha256 IS DISTINCT FROM d.content_sha256 OR u.row_count<>d.rows
   OR jsonb_typeof(u.rows)<>'array' OR jsonb_array_length(u.rows)<>d.rows OR private.dpw_hash(u.rows) IS DISTINCT FROM d.content_sha256
   THEN RAISE EXCEPTION 'dpw.prepared_upload_lineage_mismatch'; END IF;
   indexes:=private.dpw_dataset_indexes(d.id,resolved_logical_side);
   FOR row_value IN SELECT u.rows->x FROM unnest(indexes) x LOOP
    IF private.rs_contract_row_allowed(row_value,contract) IS DISTINCT FROM true THEN RAISE EXCEPTION 'dpw.recon_approved_field_domain_incompatible';END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN approved;
END $$;

CREATE FUNCTION private.rs_persist_mixed_binding(_tenant uuid,_definition uuid,_run uuid,_business_date date,_bindings jsonb,_request_key uuid,_expected_definition_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_actor(_tenant); approved jsonb; r public.recon_runs%ROWTYPE; input jsonb;
 d public.data_prep_prepared_datasets%ROWTYPE; u public.workspace_data_source_uploads%ROWTYPE; indexes integer[]; selected_rows jsonb;
BEGIN
 -- No adoption of old/failed/partial runs and no status rewrite to hide errors.
 SELECT * INTO r FROM public.recon_runs WHERE id=_run AND tenant_id=_tenant AND definition_id=_definition FOR UPDATE;
 IF NOT FOUND OR r.run_by IS DISTINCT FROM actor OR r.status<>'queued' OR r.completed_at IS NOT NULL
 OR r.started_at<transaction_timestamp() OR r.matched_count<>0 OR r.exception_count<>0
 OR EXISTS(SELECT 1 FROM public.recon_matches WHERE run_id=r.id) OR EXISTS(SELECT 1 FROM public.recon_exceptions WHERE run_id=r.id)
 THEN RAISE EXCEPTION 'dpw.new_owned_recon_run_required'; END IF;
 approved:=private.rs_mixed_preflight(_tenant,_definition,_business_date,_bindings,_expected_definition_sha256);
 IF r.definition_snapshot IS DISTINCT FROM approved->'snapshot'
 OR r.approved_revision_id IS DISTINCT FROM (approved->>'revision_id')::uuid
 OR r.approved_revision_number IS DISTINCT FROM (approved->>'revision_number')::integer
 OR r.approved_revision_sha256 IS DISTINCT FROM approved->>'snapshot_sha256'
 THEN RAISE EXCEPTION 'dpw.recon_native_approval_snapshot_mismatch'; END IF;
 INSERT INTO public.data_prep_recon_run_requests(recon_run_id,tenant_id,definition_id,created_by,request_key,approved_snapshot,approved_snapshot_sha256,approved_revision_id,approved_revision_number,input_bindings,business_date)
 VALUES(r.id,_tenant,_definition,actor,_request_key,approved->'snapshot',approved->>'snapshot_sha256',(approved->>'revision_id')::uuid,
 (approved->>'revision_number')::integer,_bindings,_business_date);
 FOR input IN SELECT value FROM jsonb_array_elements(_bindings) LOOP
  SELECT * INTO u FROM public.workspace_data_source_uploads WHERE id=(input->>'upload_id')::uuid;
  IF input->>'kind'='prepared_dataset' THEN
   SELECT * INTO d FROM public.data_prep_prepared_datasets WHERE id=(input->>'dataset_id')::uuid;
   indexes:=private.dpw_dataset_indexes(d.id,input->>'logical_side');
   SELECT coalesce(jsonb_agg(u.rows->i ORDER BY i),'[]'::jsonb) INTO selected_rows FROM unnest(indexes) i;
   INSERT INTO public.data_prep_recon_run_inputs VALUES(r.id,input->>'side_id',_tenant,_definition,d.data_source_id,d.upload_id,
   d.id,d.batch_id,d.run_id,d.pipeline_id,d.pipeline_version,d.business_date,'prepared_dataset',d.content_sha256,cardinality(indexes),input->>'logical_side',indexes,private.dpw_hash(selected_rows));
  ELSE
   INSERT INTO public.data_prep_recon_run_inputs VALUES(r.id,input->>'side_id',_tenant,_definition,u.data_source_id,u.id,
   NULL,NULL,NULL,NULL,NULL,NULL,'fixed_upload',u.content_sha256,u.row_count,NULL,NULL,private.dpw_hash(u.rows));
  END IF;
 END LOOP;
 PERFORM private.dpw_audit(actor,_tenant,'dpw.recon.inputs.bind',r.id,jsonb_build_object('definition_id',_definition,'bindings',_bindings,'approved_sha256',_expected_definition_sha256));
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'run_id',r.id,'run_uid',r.run_uid,'input_bindings',_bindings,'approved_snapshot',approved->'snapshot','is_new',true);
END $$;

CREATE FUNCTION private.rs_resolve_mixed_bindings(_tenant uuid,_definition uuid,_business_date date,_datasets jsonb,_raw_uploads jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'run');d public.recon_definitions%ROWTYPE;v public.recon_definition_approved_versions%ROWTYPE;
 contracts jsonb;s jsonb;c jsonb;dataset public.data_prep_prepared_datasets%ROWTYPE;bindings jsonb:='[]';approved jsonb;chosen_policy private.rs_policies%ROWTYPE;policies integer;logical_side text;
BEGIN
 IF _business_date IS NULL OR jsonb_typeof(_datasets) IS DISTINCT FROM 'object' OR _datasets='{}'::jsonb OR jsonb_typeof(_raw_uploads) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'rs.explicit_prepared_side_selection_required' USING ERRCODE='22023';END IF;
 v:=private.recon_run_bound_approved_version(_tenant,_definition,actor);
 IF v.id IS NULL THEN RAISE EXCEPTION 'rs.actual_native_approved_snapshot_required' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition AND tenant_id=_tenant;
 contracts:=private.rs_recon_input_contracts(_tenant,_definition,v.id);
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_datasets||_raw_uploads) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.snapshot->'sides') x WHERE x->>'side_id'=k))
 THEN RAISE EXCEPTION 'rs.unconfigured_prepared_side' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_raw_uploads) k WHERE _datasets ? k)
 THEN RAISE EXCEPTION 'rs.mixed_side_selection_overlap' USING ERRCODE='22023';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(v.snapshot->'sides') LOOP
  IF _datasets ? (s->>'side_id') THEN
   SELECT value INTO c FROM jsonb_array_elements(contracts->'input_contracts') WHERE value->>'side_id'=s->>'side_id';
   IF c IS NULL OR jsonb_typeof(c->'fields') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'rs.approved_prepared_side_domains_unavailable' USING ERRCODE='42501';END IF;
   SELECT * INTO dataset FROM public.data_prep_prepared_datasets WHERE id=(_datasets->>(s->>'side_id'))::uuid AND tenant_id=_tenant;
   IF NOT FOUND OR dataset.data_source_id::text IS DISTINCT FROM s->>'data_source_id'
    OR (s ? 'upload_id' AND s->>'upload_id' IS NOT NULL AND s->>'upload_id' IS DISTINCT FROM dataset.upload_id::text)
   THEN RAISE EXCEPTION 'rs.prepared_source_or_approved_pin_conflict' USING ERRCODE='42501';END IF;
   logical_side:=coalesce(c->>'logical_side',private.rs_select_compatible_logical_side(_tenant,dataset.id,c));
   bindings:=bindings||jsonb_build_array(jsonb_build_object('kind','prepared_dataset','side_id',s->>'side_id','data_source_id',s->>'data_source_id','dataset_id',dataset.id,
    'pipeline_id',dataset.pipeline_id,'pipeline_version',dataset.pipeline_version,'upload_id',dataset.upload_id,'logical_side',logical_side));
  ELSE
   IF coalesce(s->>'upload_id',_raw_uploads->>(s->>'side_id')) IS NULL THEN RAISE EXCEPTION 'rs.required_counterpart_unpinned_no_latest_fallback' USING ERRCODE='42501';END IF;
   IF s->>'upload_id' IS NOT NULL AND _raw_uploads ? (s->>'side_id') AND _raw_uploads->>(s->>'side_id') IS DISTINCT FROM s->>'upload_id'
   THEN RAISE EXCEPTION 'rs.fixed_approved_pin_override_refused' USING ERRCODE='42501';END IF;
   bindings:=bindings||jsonb_build_array(jsonb_build_object('kind','fixed_upload','side_id',s->>'side_id','data_source_id',s->>'data_source_id','upload_id',coalesce(s->>'upload_id',_raw_uploads->>(s->>'side_id'))));
  END IF;
 END LOOP;
 -- Exact authoritative intersection: current published dataset, pipeline version,
 -- independent release, source RLP, logical-side output indexes and typed row hash.
 approved:=private.rs_mixed_preflight(_tenant,_definition,_business_date,bindings,v.snapshot_sha256);
 IF approved->>'snapshot_sha256' IS DISTINCT FROM v.snapshot_sha256 OR approved->'reconciliation_feature_enabled' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'rs.actual_native_preflight_required' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO policies FROM private.rs_policies WHERE tenant_id=_tenant AND definition_id=_definition
 AND policy->>'business_date'=_business_date::text AND qualification->>'state'='native_qualified'
 AND qualification->>'approved_definition_sha256'=v.snapshot_sha256;
 IF policies>1 THEN RAISE EXCEPTION 'rs.unambiguous_approved_native_execution_policy_required' USING ERRCODE='42501';END IF;
 IF policies=1 THEN SELECT * INTO chosen_policy FROM private.rs_policies WHERE tenant_id=_tenant AND definition_id=_definition AND policy->>'business_date'=_business_date::text
 AND qualification->>'state'='native_qualified' AND qualification->>'approved_definition_sha256'=v.snapshot_sha256;
 ELSE chosen_policy.policy_id:=v.id;chosen_policy.version:=v.version_number::text;chosen_policy.policy:=jsonb_build_object('business_date',_business_date,'policy_kind','approved_native_input_binding');END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant,'definition_id',d.id,'business_date',_business_date,'revision_id',v.id,'revision_number',v.version_number,
 'expected_definition_sha256',v.snapshot_sha256,'approved_snapshot_sha256',v.snapshot_sha256,'input_bindings',bindings,
 'execution_policy',jsonb_build_object('policy_id',chosen_policy.policy_id,'policy_version',chosen_policy.version,'business_date',chosen_policy.policy->>'business_date','policy_kind',chosen_policy.policy->>'policy_kind'),
 'compatibility','native_current_published_contract_hash_checked','approved_snapshot',approved->'snapshot');
END $$;
REVOKE ALL ON FUNCTION private.rs_mixed_preflight(uuid,uuid,date,jsonb,text),private.rs_persist_mixed_binding(uuid,uuid,uuid,date,jsonb,uuid,text),private.rs_resolve_mixed_bindings(uuid,uuid,date,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_mixed_preflight(uuid,uuid,date,jsonb,text),private.rs_persist_mixed_binding(uuid,uuid,uuid,date,jsonb,uuid,text),private.rs_resolve_mixed_bindings(uuid,uuid,date,jsonb,jsonb) TO authenticated;


-- FROZEN native/MIXED-QUEUE-API.sql SHA256 f5bc1a550d833c87cab550f7c6492afac244baf5fefce56cc20f90acf23e204e
-- NEW mixed purpose. The existing DPW per-run request/input registries are the
-- persistent authority; a prepared upload is never accepted merely as raw rows.
CREATE FUNCTION private.rs_validate_prepared_execution(_tenant uuid,_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE q private.rs_requests%ROWTYPE;actor uuid;actual jsonb;
BEGIN
 SELECT * INTO q FROM private.rs_requests WHERE tenant_id=_tenant AND run_id=_run AND actor_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.owned_execution_input_required' USING ERRCODE='42501';END IF;
 actor:=private.rs_actor(_tenant,q.definition_id,'run');
 IF q.intent->>'input_kind'='prepared_bound' THEN
  IF q.intent ? 'mixed_selection' THEN actual:=private.rs_mixed_preflight(_tenant,q.definition_id,(q.intent->>'business_date')::date,q.intent->'bindings',q.intent->>'expected_definition_sha256');
  ELSE actual:=private.dpw_recon_preflight(_tenant,q.definition_id,(q.intent->>'business_date')::date,q.intent->'bindings',q.intent->>'expected_definition_sha256');END IF;
  IF actual->>'snapshot_sha256' IS DISTINCT FROM q.intent->>'expected_definition_sha256'
  THEN RAISE EXCEPTION 'rs.current_prepared_execution_contract_changed' USING ERRCODE='42501';END IF;
 END IF;
END $$;
CREATE FUNCTION private.rs_prior_mixed(_tenant uuid,_definition uuid,_date date,_datasets jsonb,_raw jsonb,_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant,_definition,'run');q private.rs_requests%ROWTYPE;selection jsonb;
BEGIN
 selection:=jsonb_build_object('business_date',_date,'prepared_dataset_by_side',_datasets,'raw_upload_by_side',_raw);
 SELECT * INTO q FROM private.rs_requests WHERE tenant_id=_tenant AND definition_id=_definition AND actor_id=actor AND request_key=_key;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF q.intent->'mixed_selection' IS DISTINCT FROM selection THEN RAISE EXCEPTION 'rs.mixed_request_key_conflict' USING ERRCODE='PT409';END IF;
 RETURN private.rs_prior(_tenant,_definition,_key,q.intent);
END $$;
CREATE FUNCTION public.request_recon_mixed_execution(_tenant_id uuid,_definition_id uuid,_business_date date,_prepared_dataset_by_side jsonb,_raw_upload_by_side jsonb,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE actor uuid:=private.rs_actor(_tenant_id,_definition_id,'run');prior jsonb;resolved jsonb;bindings jsonb;intent jsonb;pins jsonb;r public.recon_runs%ROWTYPE;persisted jsonb;
BEGIN
 IF _request_key IS NULL OR _business_date IS NULL OR jsonb_typeof(_prepared_dataset_by_side) IS DISTINCT FROM 'object'
 OR _prepared_dataset_by_side='{}'::jsonb OR jsonb_typeof(_raw_upload_by_side) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'rs.explicit_mixed_selection_required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rs:'||_tenant_id::text||':'||_definition_id::text,0));
 PERFORM 1 FROM public.recon_definitions WHERE id=_definition_id AND tenant_id=_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'rs.visible_mixed_definition_required' USING ERRCODE='42501';END IF;
 prior:=private.rs_prior_mixed(_tenant_id,_definition_id,_business_date,_prepared_dataset_by_side,_raw_upload_by_side,_request_key);
 IF prior IS NOT NULL THEN
  PERFORM 1 FROM public.recon_runs WHERE id=(prior->>'run_id')::uuid AND tenant_id=_tenant_id AND run_by=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'rs.current_original_run_rlp_required' USING ERRCODE='42501';END IF;
  RETURN prior;
 END IF;
 resolved:=private.rs_resolve_mixed_bindings(_tenant_id,_definition_id,_business_date,_prepared_dataset_by_side,_raw_upload_by_side);
 bindings:=resolved->'input_bindings';
 -- Invoker visibility is checked before the same-transaction native INSERT.
 PERFORM 1 FROM public.workspace_data_source_uploads u JOIN jsonb_array_elements(bindings) b ON u.id=(b->>'upload_id')::uuid
 WHERE u.tenant_id=_tenant_id AND u.data_source_id=(b->>'data_source_id')::uuid;
 IF (SELECT count(*) FROM public.workspace_data_source_uploads u JOIN jsonb_array_elements(bindings) b ON u.id=(b->>'upload_id')::uuid
  WHERE u.tenant_id=_tenant_id AND u.data_source_id=(b->>'data_source_id')::uuid)<>jsonb_array_length(bindings)
 THEN RAISE EXCEPTION 'rs.current_mixed_upload_rlp_required' USING ERRCODE='42501';END IF;
 INSERT INTO public.recon_runs(tenant_id,definition_id,status,run_by) VALUES(_tenant_id,_definition_id,'queued',actor) RETURNING * INTO r;
 persisted:=private.rs_persist_mixed_binding(_tenant_id,_definition_id,r.id,_business_date,bindings,_request_key,resolved->>'expected_definition_sha256');
 IF persisted->>'run_id' IS DISTINCT FROM r.id::text OR persisted->>'actor_id' IS DISTINCT FROM actor::text
 THEN RAISE EXCEPTION 'rs.actual_mixed_binding_receipt_required' USING ERRCODE='PT409';END IF;
 SELECT jsonb_agg(jsonb_build_object('side_id',b->>'side_id','upload_id',b->>'upload_id') ORDER BY b->>'side_id') INTO pins FROM jsonb_array_elements(bindings) b;
 intent:=jsonb_build_object('input_kind','prepared_bound','bindings',bindings,'pins',pins,'business_date',_business_date,
  'policy_id',resolved->'execution_policy'->>'policy_id','policy_version',resolved->'execution_policy'->>'policy_version',
  'expected_definition_sha256',resolved->>'expected_definition_sha256','mixed_selection',jsonb_build_object('business_date',_business_date,
   'prepared_dataset_by_side',_prepared_dataset_by_side,'raw_upload_by_side',_raw_upload_by_side));
 RETURN private.rs_store(_tenant_id,r.id,_request_key,intent);
END $$;
REVOKE ALL ON FUNCTION private.rs_validate_prepared_execution(uuid,uuid),private.rs_prior_mixed(uuid,uuid,date,jsonb,jsonb,uuid),public.request_recon_mixed_execution(uuid,uuid,date,jsonb,jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.rs_validate_prepared_execution(uuid,uuid),private.rs_prior_mixed(uuid,uuid,date,jsonb,jsonb,uuid),public.request_recon_mixed_execution(uuid,uuid,date,jsonb,jsonb,uuid) TO authenticated;

-- Additive source-bootstrap proposal. Ordinary authenticated purposes only.
-- Requires qualified current DPW/WFM core. No existing routine replacement,
-- role/group creation, ownership policy relaxation, service fallback or apply.
CREATE TABLE private.ssb_create_receipts(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),actor_id uuid NOT NULL REFERENCES auth.users(id),request_key uuid NOT NULL,
 source_id uuid NOT NULL UNIQUE REFERENCES public.workspace_data_sources(id),bu_id uuid REFERENCES public.business_units(id),
 input jsonb NOT NULL,input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),
 audit_event_id bigint NOT NULL REFERENCES public.audit_log(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,actor_id,request_key)
);
CREATE TRIGGER ssb_receipt_immutable BEFORE UPDATE OR DELETE ON private.ssb_create_receipts FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
ALTER TABLE private.ssb_create_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ssb_create_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.ssb_ownership_receipts(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),actor_id uuid NOT NULL REFERENCES auth.users(id),request_key uuid NOT NULL,
 source_id uuid NOT NULL REFERENCES public.workspace_data_sources(id),input jsonb NOT NULL,input_sha256 text NOT NULL,
 actual_editor jsonb NOT NULL,audit_event_id bigint NOT NULL REFERENCES public.audit_log(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,actor_id,request_key)
);
CREATE TRIGGER ssb_ownership_receipt_immutable BEFORE UPDATE OR DELETE ON private.ssb_ownership_receipts FOR EACH ROW EXECUTE FUNCTION private.dpw_immutable();
ALTER TABLE private.ssb_ownership_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ssb_ownership_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ssb_actor(_tenant uuid,_bu uuid,_create boolean) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant);
BEGIN
 -- Bare WFM actor attests actual account/factor/expiry without a Prep circular
 -- dependency. The feature checks apply to this Data Prep bootstrap purpose.
 PERFORM private.wfm_assert_enabled(_tenant,'prep');PERFORM private.wfm_assert_enabled(_tenant,'data');
 IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active)
 OR (_bu IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_units WHERE tenant_id=_tenant AND id=_bu AND is_archived IS NOT TRUE))
 THEN RAISE EXCEPTION 'ssb.current_tenant_bu_denied' USING ERRCODE='42501';END IF;
 IF _create AND public.user_has_permission(actor,_tenant,'data.source.create',_bu) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'ssb.source_create_permission_required' USING ERRCODE='42501';END IF;
 RETURN actor;
END $$;
CREATE FUNCTION private.ssb_is_admin(_actor uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_actor AND active AND role='tenant_admin'::public.tenant_role)
$$;
CREATE FUNCTION private.ssb_is_mapped(_tenant uuid,_source uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.data_resource_registry r JOIN public.data_resource_registry_owner_bu o ON o.registry_id=r.id AND o.tenant_id=r.tenant_id
 JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id AND b.is_archived IS NOT TRUE
 WHERE r.tenant_id=_tenant AND r.resource_type='data_source' AND r.data_source_id=_source)
$$;
CREATE FUNCTION private.ssb_source_metadata(_source public.workspace_data_sources) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',_source.id,'tenant_id',_source.tenant_id,'name',_source.name,'description',_source.description,
 'source_type',_source.source_type,'status',_source.status,'bu_id',_source.bu_id,'created_by',_source.created_by,'created_at',_source.created_at,'updated_at',_source.updated_at)
$$;
CREATE FUNCTION private.ssb_status(_actor uuid,_tenant uuid,_source uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.workspace_data_sources%ROWTYPE;r private.ssb_create_receipts%ROWTYPE;mapped boolean;creator boolean;admin boolean;
BEGIN
 SELECT * INTO s FROM public.workspace_data_sources WHERE id=_source AND tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'ssb.source_unknown' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM private.ssb_create_receipts WHERE source_id=s.id AND tenant_id=_tenant;
 creator:=r.actor_id=_actor;admin:=private.ssb_is_admin(_actor,_tenant);mapped:=private.ssb_is_mapped(_tenant,s.id);
 IF NOT coalesce(creator,false) AND NOT admin AND (NOT mapped OR private.registered_typed_resource_allows(_actor,_tenant,'data_source',s.id,'view') IS DISTINCT FROM true)
 THEN RAISE EXCEPTION 'ssb.source_scope_denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('actor_id',_actor,'tenant_id',_tenant,'source',private.ssb_source_metadata(s),'registered',mapped,
 'request_key',CASE WHEN creator THEN r.request_key ELSE NULL END,'audit_event_id',CASE WHEN creator OR admin THEN r.audit_event_id::text ELSE NULL END,
 'ownership_state',CASE WHEN s.status='archived' THEN 'archived' WHEN mapped THEN 'registered' ELSE 'awaiting_tenant_admin' END,
 'can_save_ownership',admin,'ownership_policy','actual_active_tenant_admin',
 'can_bind',mapped AND s.status<>'archived' AND private.registered_typed_resource_allows(_actor,_tenant,'data_source',s.id,'view') IS TRUE,
 'can_ingest',mapped AND s.status<>'archived' AND private.registered_typed_resource_allows(_actor,_tenant,'data_source',s.id,'ingest') IS TRUE,
 'can_edit',mapped AND s.status<>'archived' AND private.registered_typed_resource_allows(_actor,_tenant,'data_source',s.id,'edit') IS TRUE,
 'ownership_editor',jsonb_build_object('rpc','get_typed_data_resource_editor','resource_type','data_source','tenant_id',_tenant,'resource_id',s.id),
 'ownership_save',jsonb_build_object('rpc','save_typed_data_resource_access','resource_type','data_source','tenant_id',_tenant,'resource_id',s.id),
 'ownership_is_approval_queue',false);
END $$;

CREATE FUNCTION public.ssb_authorize_create(_tenant_id uuid,_bu_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,_bu_id,true);
BEGIN RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'bu_id',_bu_id,'auth_role',auth.role(),
 'can_create',true,'can_save_ownership',private.ssb_is_admin(actor,_tenant_id),'ownership_policy','actual_active_tenant_admin',
 'source_create_permission','data.source.create','source_id_origin','native_generated','request_key_required',true);END $$;
CREATE FUNCTION public.ssb_create_source(_tenant_id uuid,_bu_id uuid,_name text,_description text,_source_type text,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,_bu_id,true);r private.ssb_create_receipts%ROWTYPE;s public.workspace_data_sources%ROWTYPE;
 canonical jsonb;aid bigint;
BEGIN
 IF _request_key IS NULL OR length(coalesce(btrim(_name),'')) NOT BETWEEN 2 AND 80 OR length(coalesce(_description,''))>500
 OR _source_type IS NULL OR _source_type NOT IN('csv','xlsx','json','api','database','manual') THEN RAISE EXCEPTION 'ssb.invalid_source_request' USING ERRCODE='22023';END IF;
 canonical:=jsonb_build_object('tenant_id',_tenant_id,'bu_id',_bu_id,'name',btrim(_name),'description',_description,'source_type',_source_type);
 PERFORM pg_advisory_xact_lock(hashtextextended('ssb:'||_tenant_id::text||':'||actor::text||':'||_request_key::text,0));
 SELECT * INTO r FROM private.ssb_create_receipts WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN
  IF r.input IS DISTINCT FROM canonical OR r.input_sha256 IS DISTINCT FROM private.dpw_hash(canonical) THEN RAISE EXCEPTION 'ssb.request_conflict' USING ERRCODE='PT409';END IF;
  RETURN private.ssb_status(actor,_tenant_id,r.source_id)||jsonb_build_object('is_new',false);
 END IF;
 INSERT INTO public.workspace_data_sources(tenant_id,bu_id,name,description,source_type,connection_config,inferred_schema,sample_rows,row_count,status,created_by)
 VALUES(_tenant_id,_bu_id,btrim(_name),_description,_source_type,'{}','[]','[]',0,'draft',actor) RETURNING * INTO s;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(actor,_tenant_id,'workspace','data_source.bootstrap.create','workspace_data_source',s.id::text,
 jsonb_build_object('request_key',_request_key,'bu_id',_bu_id,'name',s.name,'source_type',s.source_type,'ownership_policy','actual_active_tenant_admin')) RETURNING id INTO aid;
 INSERT INTO private.ssb_create_receipts(tenant_id,actor_id,request_key,source_id,bu_id,input,input_sha256,audit_event_id)
 VALUES(_tenant_id,actor,_request_key,s.id,_bu_id,canonical,private.dpw_hash(canonical),aid);
 RETURN private.ssb_status(actor,_tenant_id,s.id)||jsonb_build_object('is_new',true);
END $$;
CREATE FUNCTION public.ssb_get_create_request(_tenant_id uuid,_bu_id uuid,_request_key uuid,_expected_input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,_bu_id,true);r private.ssb_create_receipts%ROWTYPE;
BEGIN
 IF _request_key IS NULL OR jsonb_typeof(_expected_input) IS DISTINCT FROM 'object' OR _expected_input->>'tenant_id' IS DISTINCT FROM _tenant_id::text
 OR _expected_input->>'bu_id' IS DISTINCT FROM _bu_id::text THEN RAISE EXCEPTION 'ssb.lookup_scope_mismatch' USING ERRCODE='PT409';END IF;
 SELECT * INTO r FROM private.ssb_create_receipts WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'request_key',_request_key,'lookup_state','absent');END IF;
 IF r.input IS DISTINCT FROM _expected_input OR r.input_sha256 IS DISTINCT FROM private.dpw_hash(_expected_input) THEN RAISE EXCEPTION 'ssb.request_conflict' USING ERRCODE='PT409';END IF;
 RETURN private.ssb_status(actor,_tenant_id,r.source_id)||jsonb_build_object('lookup_state','found','is_new',false);
END $$;
CREATE FUNCTION public.ssb_read_ownership(_tenant_id uuid,_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,NULL,false);state jsonb;editor jsonb;registry uuid;
BEGIN
 state:=private.ssb_status(actor,_tenant_id,_source_id);
 IF private.ssb_is_admin(actor,_tenant_id) THEN
  editor:=public.get_typed_data_resource_editor(_tenant_id,'data_source',_source_id);
 ELSE
  -- Read actual mappings, not the administrator's full tenant/group catalog.
  SELECT id INTO registry FROM public.data_resource_registry WHERE tenant_id=_tenant_id AND resource_type='data_source' AND data_source_id=_source_id;
  editor:=jsonb_build_object('registered',private.ssb_is_mapped(_tenant_id,_source_id),
   'owner_bu_ids',coalesce((SELECT jsonb_agg(bu_id ORDER BY bu_id) FROM public.data_resource_registry_owner_bu WHERE tenant_id=_tenant_id AND registry_id=registry),'[]'),
   'group_ids',coalesce((SELECT jsonb_agg(gid ORDER BY gid) FROM(SELECT DISTINCT principal_group_id gid FROM public.data_resource_registry_grants WHERE tenant_id=_tenant_id AND registry_id=registry AND principal_type='group' AND action='view') g),'[]'),
   'business_units','[]'::jsonb,'user_groups','[]'::jsonb,'read_only',true);
 END IF;
 RETURN state||jsonb_build_object('ownership',editor);
END $$;
CREATE FUNCTION public.ssb_save_ownership(_tenant_id uuid,_source_id uuid,_owner_bu_ids uuid[],_group_ids uuid[],_reason text,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,NULL,false);before_state jsonb;saved jsonb;after_state jsonb;canonical jsonb;r private.ssb_ownership_receipts%ROWTYPE;aid bigint;
BEGIN
 IF private.ssb_is_admin(actor,_tenant_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'ssb.actual_tenant_admin_ownership_required' USING ERRCODE='42501';END IF;
 IF _request_key IS NULL OR length(coalesce(btrim(_reason),'')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'ssb.invalid_ownership_request' USING ERRCODE='22023';END IF;
 canonical:=jsonb_build_object('source_id',_source_id,'owner_bu_ids',(SELECT jsonb_agg(x ORDER BY x) FROM(SELECT DISTINCT unnest(_owner_bu_ids) x) ids),
 'group_ids',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM(SELECT DISTINCT unnest(_group_ids) x) ids),'[]'),'reason',btrim(_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended('ssb-ownership:'||_tenant_id::text||':'||actor::text||':'||_request_key::text,0));
 before_state:=private.ssb_status(actor,_tenant_id,_source_id);
 SELECT * INTO r FROM private.ssb_ownership_receipts WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF FOUND THEN
  IF r.source_id IS DISTINCT FROM _source_id OR r.input IS DISTINCT FROM canonical OR r.input_sha256 IS DISTINCT FROM private.dpw_hash(canonical)
  THEN RAISE EXCEPTION 'ssb.request_conflict' USING ERRCODE='PT409';END IF;
  RETURN before_state||jsonb_build_object('ownership',public.get_typed_data_resource_editor(_tenant_id,'data_source',_source_id),
  'recorded_ownership',r.actual_editor,'is_new',false,'request_key',_request_key);
 END IF;
 -- Exact existing ordinary administrator producer; all genuine tenant/BU/group
 -- assignment/current grants and registration/audit checks remain inside it.
 saved:=public.save_typed_data_resource_access(_tenant_id,'data_source',_source_id,_owner_bu_ids,_group_ids,_reason);
 after_state:=public.get_typed_data_resource_editor(_tenant_id,'data_source',_source_id);
 IF saved->'registered' IS DISTINCT FROM 'true'::jsonb OR after_state->'registered' IS DISTINCT FROM 'true'::jsonb
 OR (SELECT coalesce(array_agg(x ORDER BY x),'{}'::uuid[]) FROM(SELECT DISTINCT unnest(_owner_bu_ids) x) ids)
 IS DISTINCT FROM (SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid),'{}'::uuid[]) FROM jsonb_array_elements_text(after_state->'owner_bu_ids') x)
 OR (SELECT coalesce(array_agg(x ORDER BY x),'{}'::uuid[]) FROM(SELECT DISTINCT unnest(_group_ids) x) ids)
 IS DISTINCT FROM (SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid),'{}'::uuid[]) FROM jsonb_array_elements_text(after_state->'group_ids') x)
 THEN RAISE EXCEPTION 'ssb.ownership_readback_mismatch' USING ERRCODE='PT409';END IF;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(actor,_tenant_id,'workspace','data_source.bootstrap.ownership','workspace_data_source',_source_id::text,
 canonical||jsonb_build_object('request_key',_request_key,'actual_editor',after_state)) RETURNING id INTO aid;
 INSERT INTO private.ssb_ownership_receipts(tenant_id,actor_id,request_key,source_id,input,input_sha256,actual_editor,audit_event_id)
 VALUES(_tenant_id,actor,_request_key,_source_id,canonical,private.dpw_hash(canonical),after_state,aid);
 RETURN private.ssb_status(actor,_tenant_id,_source_id)||jsonb_build_object('ownership',after_state,'saved',saved,'is_new',true,'request_key',_request_key);
END $$;
CREATE FUNCTION public.ssb_read_source(_tenant_id uuid,_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,NULL,false);state jsonb;
BEGIN state:=private.ssb_status(actor,_tenant_id,_source_id);
 IF state->'can_bind' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'ssb.registered_current_source_view_required' USING ERRCODE='42501';END IF;
 RETURN state;END $$;
CREATE FUNCTION public.ssb_get_ownership_request(_tenant_id uuid,_source_id uuid,_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,NULL,false);r private.ssb_ownership_receipts%ROWTYPE;state jsonb;
BEGIN
 IF private.ssb_is_admin(actor,_tenant_id) IS DISTINCT FROM true OR _request_key IS NULL THEN RAISE EXCEPTION 'ssb.actual_tenant_admin_ownership_required' USING ERRCODE='42501';END IF;
 state:=private.ssb_status(actor,_tenant_id,_source_id);
 SELECT * INTO r FROM private.ssb_ownership_receipts WHERE tenant_id=_tenant_id AND actor_id=actor AND request_key=_request_key;
 IF NOT FOUND THEN RETURN state||jsonb_build_object('lookup_state','absent','request_key',_request_key);END IF;
 IF r.source_id IS DISTINCT FROM _source_id THEN RAISE EXCEPTION 'ssb.request_conflict' USING ERRCODE='PT409';END IF;
 RETURN state||jsonb_build_object('lookup_state','found','request_key',_request_key,'recorded_ownership',r.actual_editor,
 'ownership',public.get_typed_data_resource_editor(_tenant_id,'data_source',_source_id));
END $$;
CREATE FUNCTION public.ssb_find_sources(_tenant_id uuid,_search text,_page integer DEFAULT 1,_page_size integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.ssb_actor(_tenant_id,NULL,false);off integer:=private.dpw_page(_page,_page_size);result jsonb;
BEGIN
 IF public.user_has_permission(actor,_tenant_id,'data.source.read',NULL) IS DISTINCT FROM true OR length(coalesce(_search,''))>120 THEN RAISE EXCEPTION 'ssb.source_catalog_read_denied' USING ERRCODE='42501';END IF;
 WITH allowed AS(SELECT s.* FROM public.workspace_data_sources s WHERE s.tenant_id=_tenant_id AND s.status<>'archived'
 AND (_search IS NULL OR position(lower(_search) IN lower(s.name))>0)
 AND private.ssb_is_mapped(_tenant_id,s.id) AND private.registered_typed_resource_allows(actor,_tenant_id,'data_source',s.id,'view') IS TRUE),
 paged AS(SELECT * FROM allowed ORDER BY name,id LIMIT _page_size OFFSET off)
 SELECT jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'rows',coalesce((SELECT jsonb_agg(private.ssb_source_metadata(s) ORDER BY name,id) FROM paged s),'[]'),
 'total',(SELECT count(*) FROM allowed),'page',_page,'page_size',_page_size,'catalog_match_is_request_confirmation',false) INTO result;
 RETURN result;
END $$;

-- Newly created bootstrap resources cannot exploit the legacy unregistered
-- resource allowance. Ownership registration must actually exist before use.
CREATE FUNCTION private.ssb_guard_upload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF EXISTS(SELECT 1 FROM private.ssb_create_receipts WHERE tenant_id=NEW.tenant_id AND source_id=NEW.data_source_id)
 AND private.ssb_is_mapped(NEW.tenant_id,NEW.data_source_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'ssb.ownership_pending_source_use_denied' USING ERRCODE='42501';END IF;RETURN NEW;END $$;
CREATE TRIGGER ssb_bootstrap_upload_guard BEFORE INSERT OR UPDATE OF data_source_id,tenant_id ON public.workspace_data_source_uploads FOR EACH ROW EXECUTE FUNCTION private.ssb_guard_upload();
CREATE TRIGGER ssb_bootstrap_intent_guard BEFORE INSERT ON public.data_prep_delivery_files FOR EACH ROW EXECUTE FUNCTION private.ssb_guard_upload();

DO $acl$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('private','public') AND p.proname LIKE 'ssb_%' LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.sig);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
  IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig);END IF;
 END LOOP;
END $acl$;

-- Install inside parent joined transaction AFTER current v06 common definitions.
-- These are NEW packet purposes, not captured existing213 routines. Preserve every old routine/catalog/row fence.
-- No owner/ACL/ABI/grant change; caller _correction_of and lookup identity bind the immutable link.
DO $correction_before$ BEGIN IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='public.dpw_lookup_file_intent(uuid,uuid,uuid,text,jsonb)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '90ff500091b602e35600b4409bfc07c05d3fa43357b6d7c94a49933cd0c3e565' THEN RAISE EXCEPTION 'correction.new_purpose_before_changed dpw_lookup_file_intent';END IF;END $correction_before$;
DO $correction_before$ BEGIN IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='public.dpw_open_file_intent(uuid,uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '2fa291e4ac9f3ec265b9d41226f79da8b52f15437d88710a60f1f411af4dbd84' THEN RAISE EXCEPTION 'correction.new_purpose_before_changed dpw_open_file_intent';END IF;END $correction_before$;
CREATE OR REPLACE FUNCTION public.dpw_lookup_file_intent(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_feed_key text,_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority jsonb:=public.dpw_authorize_file_intake(_tenant_id,_pipeline_id,_batch_id,_feed_key,'intake');
 f public.data_prep_delivery_files%ROWTYPE;
BEGIN
 IF NOT (_identity ? 'correction_of') OR (jsonb_typeof(_identity->'correction_of') IS DISTINCT FROM 'null' AND (jsonb_typeof(_identity->'correction_of') IS DISTINCT FROM 'string' OR (_identity->>'correction_of') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) THEN RAISE EXCEPTION 'dpw.lookup_correction_identity_required';END IF;
 IF _identity->>'data_source_id' IS DISTINCT FROM authority->>'data_source_id'
 OR (_identity->>'pipeline_version')::integer IS DISTINCT FROM (authority->>'pipeline_version')::integer
 OR _identity->>'content_sha256' IS NULL OR _identity->>'content_sha256' !~ '^[a-f0-9]{64}$'
 OR _identity->>'request_key' IS NULL THEN RAISE EXCEPTION 'dpw.lookup_identity_mismatch'; END IF;
 SELECT x.* INTO f FROM public.data_prep_delivery_files x JOIN public.data_prep_file_requests a ON a.file_id=x.id
 WHERE a.batch_id=_batch_id AND a.feed_key=_feed_key AND a.request_key=(_identity->>'request_key')::uuid;
 IF FOUND AND (f.correction_of IS DISTINCT FROM nullif(_identity->>'correction_of','')::uuid OR f.content_sha256<>_identity->>'content_sha256' OR f.descriptor->'selected_sheet' IS DISTINCT FROM coalesce(_identity->'selected_sheet','null'::jsonb))
 THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
 IF f.id IS NULL THEN
  SELECT * INTO f FROM public.data_prep_delivery_files WHERE batch_id=_batch_id AND feed_key=_feed_key AND content_sha256=_identity->>'content_sha256';
  IF FOUND AND (f.correction_of IS DISTINCT FROM nullif(_identity->>'correction_of','')::uuid OR f.descriptor->'selected_sheet' IS DISTINCT FROM coalesce(_identity->'selected_sheet','null'::jsonb)) THEN RAISE EXCEPTION 'dpw.sheet_binding_conflict'; END IF;
 END IF;
 RETURN authority||jsonb_build_object('state',CASE WHEN f.id IS NULL THEN 'absent' ELSE 'found' END,'intent',CASE WHEN f.id IS NULL THEN NULL ELSE private.dpw_file_metadata(f) END);
END $$;
CREATE OR REPLACE FUNCTION public.dpw_open_file_intent(_tenant_id uuid,_pipeline_id uuid,_batch_id uuid,_feed_key text,_descriptor jsonb,_request_key uuid,_correction_of uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.dpw_authorize(_tenant_id,_pipeline_id,'run'); b public.data_prep_delivery_batches%ROWTYPE;
 f public.data_prep_delivery_files%ROWTYPE; profile jsonb; fid uuid:=gen_random_uuid(); newfile boolean:=true;
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant_id,'data');
 PERFORM public.assert_data_prep_actor(_tenant_id,actor,false);
 b:=private.dpw_lock_batch(_tenant_id,_pipeline_id,_batch_id,actor,false);
 SELECT value INTO profile FROM jsonb_array_elements(b.configuration_snapshot->'feeds') WHERE value->>'key'=_feed_key;
 IF profile IS NULL OR private.dpw_source_allows(actor,_tenant_id,(profile->>'data_source_id')::uuid,'ingest') IS DISTINCT FROM true
 OR _request_key IS NULL OR jsonb_typeof(_descriptor) IS DISTINCT FROM 'object'
 OR (_descriptor->>'content_sha256') IS NULL OR (_descriptor->>'content_sha256') !~ '^[a-f0-9]{64}$'
 OR (_descriptor->>'parsed_sha256') IS NULL OR (_descriptor->>'parsed_sha256') !~ '^[a-f0-9]{64}$'
 OR (_descriptor->>'size_bytes') IS NULL OR (_descriptor->>'size_bytes')::bigint NOT BETWEEN 1 AND 52428800
 OR (_descriptor->>'parsed_bytes') IS NULL OR (_descriptor->>'parsed_bytes')::bigint NOT BETWEEN 2 AND 52428800
 OR (_descriptor->>'row_count') IS NULL OR (_descriptor->>'row_count')::integer NOT BETWEEN 0 AND 50000
 OR jsonb_typeof(_descriptor->'columns') IS DISTINCT FROM 'array' OR jsonb_array_length(_descriptor->'columns') NOT BETWEEN 1 AND 500
 OR length(coalesce(_descriptor->>'filename','')) NOT BETWEEN 1 AND 255 OR length(coalesce(_descriptor->>'mime_type','')) NOT BETWEEN 1 AND 255
 THEN RAISE EXCEPTION 'dpw.invalid_file_intent'; END IF;
 SELECT x.* INTO f FROM public.data_prep_delivery_files x JOIN public.data_prep_file_requests a ON a.file_id=x.id
 WHERE a.batch_id=b.id AND a.feed_key=_feed_key AND a.request_key=_request_key;
 IF FOUND THEN
  IF f.descriptor IS DISTINCT FROM _descriptor OR f.correction_of IS DISTINCT FROM _correction_of THEN RAISE EXCEPTION 'dpw.request_conflict'; END IF;
  newfile:=false;
 ELSE
  SELECT * INTO f FROM public.data_prep_delivery_files WHERE batch_id=b.id AND feed_key=_feed_key AND content_sha256=_descriptor->>'content_sha256';
  IF FOUND THEN
   IF f.descriptor IS DISTINCT FROM _descriptor OR f.correction_of IS DISTINCT FROM _correction_of THEN RAISE EXCEPTION 'dpw.same_file_descriptor_conflict'; END IF;
   newfile:=false;
  ELSE
   IF b.state<>'collecting' THEN RAISE EXCEPTION 'dpw.late_file_requires_correction'; END IF;
   IF _correction_of IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.data_prep_delivery_files
   WHERE id=_correction_of AND batch_id=b.correction_of AND feed_key=_feed_key AND tenant_id=_tenant_id)
   THEN RAISE EXCEPTION 'dpw.file_correction_mismatch'; END IF;
   INSERT INTO public.data_prep_delivery_files(id,tenant_id,pipeline_id,batch_id,pipeline_version,feed_key,data_source_id,created_by,descriptor,request_key,content_sha256,original_path,correction_of)
   VALUES(fid,_tenant_id,_pipeline_id,b.id,b.pipeline_version,_feed_key,(profile->>'data_source_id')::uuid,actor,_descriptor,_request_key,
   _descriptor->>'content_sha256',_tenant_id::text||'/'||b.id::text||'/'||fid::text||'/original',_correction_of) RETURNING * INTO f;
  END IF;
 END IF;
 INSERT INTO public.data_prep_file_requests(batch_id,feed_key,request_key,file_id,requested_descriptor,created_by)
 VALUES(b.id,_feed_key,_request_key,f.id,_descriptor,actor) ON CONFLICT(batch_id,feed_key,request_key) DO NOTHING;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'file',private.dpw_file_metadata(f),'intent',private.dpw_file_metadata(f),'created',newfile,
 'storage_capability',jsonb_build_object('bucket_id','data-prep-inputs','public',false,'max_original_bytes',52428800,
 'max_expanded_bytes',52428800,'max_parsed_bytes',52428800,'max_rows',50000,'max_columns',500));
END $$;

-- UNAPPLIED: main registers this exact per-environment packet and full preservation ledger inside its qualified BEGIN/ROLLBACK first. No COMMIT here.
SET LOCAL search_path = pg_catalog,public;
DO $capture_context$ BEGIN IF current_user<>'postgres' OR current_setting('role',true)<>'none' OR current_setting('server_version_num')<>'170006' THEN RAISE EXCEPTION 'Current native capture context changed';END IF;END $capture_context$;
-- New helper; only authenticated RLS subjects. The old permissive/resource and lifecycle policies remain the authority ceiling.
SELECT set_config('search_path','pg_catalog, public, extensions',true);
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=38523::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns38523$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"agreement_key","type":"text","attnum":3,"default":null,"not_null":true},{"name":"own_legal_entity","type":"text","attnum":4,"default":null,"not_null":true},{"name":"counterparty","type":"text","attnum":5,"default":null,"not_null":true},{"name":"currency","type":"text","attnum":6,"default":null,"not_null":true},{"name":"created_by","type":"uuid","attnum":7,"default":null,"not_null":true},{"name":"created_at","type":"timestamp with time zone","attnum":8,"default":"now()","not_null":true}]$columns38523$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: collateral_csa_agreements';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=38550::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns38550$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"agreement_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"version_no","type":"integer","attnum":4,"default":null,"not_null":true},{"name":"status","type":"text","attnum":5,"default":"'draft'::text","not_null":true},{"name":"threshold_amount","type":"numeric(20,4)","attnum":6,"default":null,"not_null":true},{"name":"minimum_transfer","type":"numeric(20,4)","attnum":7,"default":null,"not_null":true},{"name":"rounding_increment","type":"numeric(20,4)","attnum":8,"default":"0","not_null":true},{"name":"effective_from","type":"date","attnum":9,"default":null,"not_null":true},{"name":"effective_to","type":"date","attnum":10,"default":null,"not_null":false},{"name":"terms_snapshot","type":"jsonb","attnum":11,"default":"'{}'::jsonb","not_null":true},{"name":"created_by","type":"uuid","attnum":12,"default":null,"not_null":true},{"name":"created_at","type":"timestamp with time zone","attnum":13,"default":"now()","not_null":true},{"name":"submitted_by","type":"uuid","attnum":14,"default":null,"not_null":false},{"name":"submitted_at","type":"timestamp with time zone","attnum":15,"default":null,"not_null":false},{"name":"approved_by","type":"uuid","attnum":16,"default":null,"not_null":false},{"name":"approved_at","type":"timestamp with time zone","attnum":17,"default":null,"not_null":false},{"name":"idempotency_key","type":"text","attnum":18,"default":null,"not_null":true},{"name":"request_hash","type":"text","attnum":19,"default":null,"not_null":true}]$columns38550$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: collateral_csa_versions';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=37763::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns37763$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"call_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"asset_type","type":"text","attnum":3,"default":null,"not_null":true},{"name":"description","type":"text","attnum":4,"default":null,"not_null":true},{"name":"provenance_reference","type":"text","attnum":5,"default":null,"not_null":true},{"name":"market_value","type":"numeric(20,4)","attnum":6,"default":null,"not_null":true},{"name":"haircut_bps","type":"integer","attnum":7,"default":null,"not_null":true},{"name":"adjusted_value","type":"numeric(20,4)","attnum":8,"default":"round(((market_value * ((10000 - haircut_bps))::numeric) / (10000)::numeric), 4)","not_null":false}]$columns37763$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: collateral_qa_vm_assets';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=37716::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns37716$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"schedule_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"currency","type":"text","attnum":4,"default":"'USD'::text","not_null":true},{"name":"valuation_at","type":"timestamp with time zone","attnum":5,"default":null,"not_null":true},{"name":"exposure_reference","type":"text","attnum":6,"default":null,"not_null":true},{"name":"gross_exposure","type":"numeric(20,4)","attnum":7,"default":null,"not_null":true},{"name":"eligible_collateral","type":"numeric(20,4)","attnum":8,"default":null,"not_null":true},{"name":"threshold_snapshot","type":"numeric(20,4)","attnum":9,"default":null,"not_null":true},{"name":"mta_snapshot","type":"numeric(20,4)","attnum":10,"default":null,"not_null":true},{"name":"rounding_snapshot","type":"numeric(10,2)","attnum":11,"default":null,"not_null":true},{"name":"proposed_vm","type":"numeric(20,4)","attnum":12,"default":null,"not_null":true},{"name":"status","type":"text","attnum":13,"default":"'draft'::text","not_null":true},{"name":"maker_id","type":"uuid","attnum":14,"default":null,"not_null":true},{"name":"checker_id","type":"uuid","attnum":15,"default":null,"not_null":false},{"name":"maker_reason","type":"text","attnum":16,"default":null,"not_null":true},{"name":"checker_reason","type":"text","attnum":17,"default":null,"not_null":false},{"name":"internal_settlement_reference","type":"text","attnum":18,"default":null,"not_null":false},{"name":"settlement_recorded_at","type":"timestamp with time zone","attnum":19,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":20,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":21,"default":"now()","not_null":true}]$columns37716$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: collateral_qa_vm_calls';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=20382::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns20382$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"counterparty","type":"text","attnum":3,"default":null,"not_null":true},{"name":"csa_id","type":"text","attnum":4,"default":null,"not_null":false},{"name":"schedule_type","type":"text","attnum":5,"default":"'VM'::text","not_null":true},{"name":"threshold_amount","type":"numeric(20,4)","attnum":6,"default":"0","not_null":true},{"name":"minimum_transfer","type":"numeric(20,4)","attnum":7,"default":"0","not_null":true},{"name":"rounding","type":"numeric(10,2)","attnum":8,"default":"0","not_null":true},{"name":"eligible_collateral_json","type":"jsonb","attnum":9,"default":"'[]'::jsonb","not_null":true},{"name":"haircut_json","type":"jsonb","attnum":10,"default":"'{}'::jsonb","not_null":true},{"name":"effective_from","type":"date","attnum":11,"default":null,"not_null":false},{"name":"effective_to","type":"date","attnum":12,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":13,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":14,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":15,"default":"now()","not_null":true}]$columns20382$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: collateral_schedules';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=20318::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns20318$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"source_kind","type":"text","attnum":3,"default":null,"not_null":true},{"name":"source_ref","type":"text","attnum":4,"default":null,"not_null":true},{"name":"source_label","type":"text","attnum":5,"default":null,"not_null":false},{"name":"target_kind","type":"text","attnum":6,"default":null,"not_null":true},{"name":"target_ref","type":"text","attnum":7,"default":null,"not_null":true},{"name":"target_label","type":"text","attnum":8,"default":null,"not_null":false},{"name":"transform","type":"text","attnum":9,"default":null,"not_null":false},{"name":"attributes","type":"jsonb","attnum":10,"default":"'{}'::jsonb","not_null":true},{"name":"evidence_hash","type":"text","attnum":11,"default":null,"not_null":false},{"name":"recorded_at","type":"timestamp with time zone","attnum":12,"default":"now()","not_null":true},{"name":"recorded_by","type":"uuid","attnum":13,"default":null,"not_null":false}]$columns20318$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_lineage_edges';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=19224::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns19224$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"name","type":"text","attnum":3,"default":null,"not_null":true},{"name":"description","type":"text","attnum":4,"default":null,"not_null":false},{"name":"source_data_source_id","type":"uuid","attnum":5,"default":null,"not_null":false},{"name":"output_data_source_id","type":"uuid","attnum":6,"default":null,"not_null":false},{"name":"steps","type":"jsonb","attnum":7,"default":"'[]'::jsonb","not_null":true},{"name":"dq_rules","type":"jsonb","attnum":8,"default":"'[]'::jsonb","not_null":true},{"name":"on_failure","type":"text","attnum":9,"default":"'block'::text","not_null":true},{"name":"enabled","type":"boolean","attnum":10,"default":"true","not_null":true},{"name":"last_run_at","type":"timestamp with time zone","attnum":11,"default":null,"not_null":false},{"name":"last_status","type":"text","attnum":12,"default":null,"not_null":false},{"name":"last_error","type":"text","attnum":13,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":14,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":15,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":16,"default":"now()","not_null":true},{"name":"public_uid","type":"text","attnum":17,"default":null,"not_null":false},{"name":"status","type":"text","attnum":18,"default":"'draft'::text","not_null":true},{"name":"version","type":"integer","attnum":19,"default":"1","not_null":true},{"name":"approved_at","type":"timestamp with time zone","attnum":20,"default":null,"not_null":false},{"name":"approved_by","type":"uuid","attnum":21,"default":null,"not_null":false},{"name":"bu_id","type":"uuid","attnum":22,"default":null,"not_null":false},{"name":"parent_pipeline_id","type":"uuid","attnum":23,"default":null,"not_null":false},{"name":"lifecycle_state","type":"text","attnum":24,"default":"'production'::text","not_null":true},{"name":"promotion_status","type":"text","attnum":25,"default":null,"not_null":false},{"name":"promotion_requested_by","type":"uuid","attnum":26,"default":null,"not_null":false},{"name":"promotion_requested_at","type":"timestamp with time zone","attnum":27,"default":null,"not_null":false},{"name":"promotion_note","type":"text","attnum":28,"default":null,"not_null":false},{"name":"promoted_from_id","type":"uuid","attnum":29,"default":null,"not_null":false},{"name":"promoted_at","type":"timestamp with time zone","attnum":30,"default":null,"not_null":false},{"name":"promoted_by","type":"uuid","attnum":31,"default":null,"not_null":false},{"name":"created_by_actor_id","type":"uuid","attnum":32,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":33,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":34,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":35,"default":null,"not_null":false}]$columns19224$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_prep_pipelines';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=19262::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns19262$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"pipeline_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"tenant_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"run_uid","type":"text","attnum":4,"default":null,"not_null":false},{"name":"status","type":"text","attnum":5,"default":"'running'::text","not_null":true},{"name":"rows_in","type":"integer","attnum":6,"default":"0","not_null":true},{"name":"rows_out","type":"integer","attnum":7,"default":"0","not_null":true},{"name":"dq_results","type":"jsonb","attnum":8,"default":"'[]'::jsonb","not_null":true},{"name":"error","type":"text","attnum":9,"default":null,"not_null":false},{"name":"trigger","type":"text","attnum":10,"default":"'manual'::text","not_null":true},{"name":"started_at","type":"timestamp with time zone","attnum":11,"default":"now()","not_null":true},{"name":"finished_at","type":"timestamp with time zone","attnum":12,"default":null,"not_null":false},{"name":"triggered_by","type":"uuid","attnum":13,"default":null,"not_null":false},{"name":"pipeline_lifecycle","type":"text","attnum":14,"default":"'production'::text","not_null":true},{"name":"execution_protocol","type":"text","attnum":15,"default":"'legacy'::text","not_null":true},{"name":"execution_snapshot","type":"jsonb","attnum":16,"default":null,"not_null":false},{"name":"request_key","type":"uuid","attnum":17,"default":null,"not_null":false}]$columns19262$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_prep_runs';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=18610::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns18610$[{"name":"id","type":"bigint","attnum":1,"default":"nextval('data_source_runs_id_seq'::regclass)","not_null":true},{"name":"schedule_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"tenant_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"started_at","type":"timestamp with time zone","attnum":4,"default":"now()","not_null":true},{"name":"finished_at","type":"timestamp with time zone","attnum":5,"default":null,"not_null":false},{"name":"status","type":"text","attnum":6,"default":"'running'::text","not_null":true},{"name":"rows_ingested","type":"integer","attnum":7,"default":null,"not_null":false},{"name":"error","type":"text","attnum":8,"default":null,"not_null":false},{"name":"trigger","type":"text","attnum":9,"default":"'cron'::text","not_null":true}]$columns18610$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_source_runs';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=18576::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns18576$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"data_source_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"name","type":"text","attnum":4,"default":null,"not_null":true},{"name":"connector_type","type":"text","attnum":5,"default":null,"not_null":true},{"name":"config","type":"jsonb","attnum":6,"default":"'{}'::jsonb","not_null":true},{"name":"transformation","type":"jsonb","attnum":7,"default":"'[]'::jsonb","not_null":true},{"name":"cron_expression","type":"text","attnum":8,"default":"'0 * * * *'::text","not_null":true},{"name":"enabled","type":"boolean","attnum":9,"default":"false","not_null":true},{"name":"last_run_at","type":"timestamp with time zone","attnum":10,"default":null,"not_null":false},{"name":"last_status","type":"text","attnum":11,"default":null,"not_null":false},{"name":"last_rows_ingested","type":"integer","attnum":12,"default":null,"not_null":false},{"name":"last_error","type":"text","attnum":13,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":14,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":15,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":16,"default":"now()","not_null":true},{"name":"mode","type":"text","attnum":17,"default":"'cron'::text","not_null":true},{"name":"poll_interval_seconds","type":"integer","attnum":18,"default":null,"not_null":false},{"name":"public_id","type":"text","attnum":19,"default":"('FVI-SCH-'::text || upper(substr(encode(digest((id)::text, 'sha256'::text), 'hex'::text), 1, 20)))","not_null":false},{"name":"access_mode","type":"text","attnum":20,"default":"'unmapped_pending'::text","not_null":true},{"name":"created_by_actor_id","type":"uuid","attnum":21,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":22,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":23,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":24,"default":null,"not_null":false}]$columns18576$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_source_schedules';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=33847::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns33847$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"watcher_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"previous_state","type":"text","attnum":4,"default":null,"not_null":false},{"name":"new_state","type":"text","attnum":5,"default":null,"not_null":true},{"name":"outcome_code","type":"text","attnum":6,"default":null,"not_null":true},{"name":"detail","type":"jsonb","attnum":7,"default":"'{}'::jsonb","not_null":true},{"name":"trigger","type":"text","attnum":8,"default":null,"not_null":true},{"name":"actor_user_id","type":"uuid","attnum":9,"default":null,"not_null":false},{"name":"notification_created","type":"boolean","attnum":10,"default":"false","not_null":true},{"name":"occurred_at","type":"timestamp with time zone","attnum":11,"default":"now()","not_null":true}]$columns33847$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_watcher_events';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=19296::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns19296$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"data_source_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"name","type":"text","attnum":4,"default":null,"not_null":true},{"name":"watch_type","type":"text","attnum":5,"default":null,"not_null":true},{"name":"config","type":"jsonb","attnum":6,"default":"'{}'::jsonb","not_null":true},{"name":"severity","type":"text","attnum":7,"default":"'warning'::text","not_null":true},{"name":"enabled","type":"boolean","attnum":8,"default":"true","not_null":true},{"name":"last_checked_at","type":"timestamp with time zone","attnum":9,"default":null,"not_null":false},{"name":"last_state","type":"text","attnum":10,"default":"'ok'::text","not_null":true},{"name":"last_alerted_at","type":"timestamp with time zone","attnum":11,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":12,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":13,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":14,"default":"now()","not_null":true},{"name":"public_id","type":"text","attnum":15,"default":"('FVI-FW-'::text || upper(substr(encode(digest((id)::text, 'sha256'::text), 'hex'::text), 1, 20)))","not_null":false},{"name":"access_mode","type":"text","attnum":16,"default":"'unmapped_pending'::text","not_null":true},{"name":"created_by_actor_id","type":"uuid","attnum":17,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":18,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":19,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":20,"default":null,"not_null":false}]$columns19296$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: data_watchers';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=23308::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns23308$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"recon_id","type":"uuid","attnum":3,"default":null,"not_null":false},{"name":"name","type":"text","attnum":4,"default":null,"not_null":true},{"name":"strategy","type":"text","attnum":5,"default":null,"not_null":true},{"name":"assignee_pool","type":"uuid[]","attnum":6,"default":"ARRAY[]::uuid[]","not_null":true},{"name":"tag_routes","type":"jsonb","attnum":7,"default":"'{}'::jsonb","not_null":true},{"name":"severity_routes","type":"jsonb","attnum":8,"default":"'{}'::jsonb","not_null":true},{"name":"last_assigned_index","type":"integer","attnum":9,"default":"0","not_null":true},{"name":"enabled","type":"boolean","attnum":10,"default":"true","not_null":true},{"name":"created_by","type":"uuid","attnum":11,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":12,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":13,"default":"now()","not_null":true},{"name":"queue_type","type":"text","attnum":14,"default":"'general'::text","not_null":true},{"name":"skill_tags","type":"text[]","attnum":15,"default":"'{}'::text[]","not_null":true},{"name":"counterparty_match","type":"text[]","attnum":16,"default":"'{}'::text[]","not_null":true},{"name":"product_match","type":"text[]","attnum":17,"default":"'{}'::text[]","not_null":true},{"name":"max_wip_per_assignee","type":"integer","attnum":18,"default":null,"not_null":false},{"name":"business_hours","type":"jsonb","attnum":19,"default":"'{\"tz\": \"UTC\", \"end\": \"18:00\", \"days\": [1, 2, 3, 4, 5], \"start\": \"09:00\"}'::jsonb","not_null":true}]$columns23308$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: exception_assignment_rules';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=39140::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns39140$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"parent_definition_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"version_number","type":"integer","attnum":4,"default":null,"not_null":true},{"name":"snapshot","type":"jsonb","attnum":5,"default":null,"not_null":true},{"name":"snapshot_sha256","type":"text","attnum":6,"default":null,"not_null":true},{"name":"request_id","type":"uuid","attnum":7,"default":null,"not_null":true},{"name":"approved_by","type":"uuid","attnum":8,"default":null,"not_null":true},{"name":"approved_at","type":"timestamp with time zone","attnum":9,"default":"now()","not_null":true},{"name":"approved_mapping_snapshot","type":"jsonb","attnum":10,"default":null,"not_null":false},{"name":"approved_mapping_fingerprint","type":"text","attnum":11,"default":null,"not_null":false}]$columns39140$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: recon_definition_approved_versions';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=39094::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns39094$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"parent_definition_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"staging_definition_id","type":"uuid","attnum":4,"default":null,"not_null":false},{"name":"request_kind","type":"text","attnum":5,"default":null,"not_null":true},{"name":"requested_by","type":"uuid","attnum":6,"default":null,"not_null":true},{"name":"reason","type":"text","attnum":7,"default":null,"not_null":true},{"name":"status","type":"text","attnum":8,"default":"'pending'::text","not_null":true},{"name":"source_version","type":"integer","attnum":9,"default":"0","not_null":true},{"name":"source_sha256","type":"text","attnum":10,"default":null,"not_null":false},{"name":"snapshot","type":"jsonb","attnum":11,"default":null,"not_null":false},{"name":"snapshot_sha256","type":"text","attnum":12,"default":null,"not_null":false},{"name":"decision_reason","type":"text","attnum":13,"default":null,"not_null":false},{"name":"decided_by","type":"uuid","attnum":14,"default":null,"not_null":false},{"name":"decided_at","type":"timestamp with time zone","attnum":15,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":16,"default":"now()","not_null":true},{"name":"mapped_governance_version","type":"integer","attnum":17,"default":null,"not_null":false},{"name":"parent_config_fingerprint","type":"text","attnum":18,"default":null,"not_null":false},{"name":"staging_config_fingerprint","type":"text","attnum":19,"default":null,"not_null":false},{"name":"parent_mapping_snapshot","type":"jsonb","attnum":20,"default":null,"not_null":false},{"name":"parent_mapping_fingerprint","type":"text","attnum":21,"default":null,"not_null":false},{"name":"staging_mapping_snapshot","type":"jsonb","attnum":22,"default":null,"not_null":false},{"name":"staging_mapping_fingerprint","type":"text","attnum":23,"default":null,"not_null":false}]$columns39094$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: recon_definition_governance_requests';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=20584::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns20584$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"recon_definition_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"version_number","type":"integer","attnum":4,"default":null,"not_null":true},{"name":"message","type":"text","attnum":5,"default":null,"not_null":false},{"name":"snapshot","type":"jsonb","attnum":6,"default":null,"not_null":true},{"name":"diff","type":"jsonb","attnum":7,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":8,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":9,"default":"now()","not_null":true}]$columns20584$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: recon_definition_versions';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=18287::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns18287$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"name","type":"text","attnum":3,"default":null,"not_null":true},{"name":"description","type":"text","attnum":4,"default":null,"not_null":false},{"name":"recon_type","type":"text","attnum":5,"default":null,"not_null":true},{"name":"sides","type":"jsonb","attnum":6,"default":"'[]'::jsonb","not_null":true},{"name":"rules","type":"jsonb","attnum":7,"default":"'[]'::jsonb","not_null":true},{"name":"status","type":"text","attnum":8,"default":"'draft'::text","not_null":true},{"name":"created_by","type":"uuid","attnum":9,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":10,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":11,"default":"now()","not_null":true},{"name":"visibility","type":"text","attnum":12,"default":"'tenant'::text","not_null":true},{"name":"extension","type":"jsonb","attnum":13,"default":"'{}'::jsonb","not_null":true},{"name":"bu_id","type":"uuid","attnum":14,"default":null,"not_null":false},{"name":"environment","type":"text","attnum":15,"default":"'development'::text","not_null":true},{"name":"recon_code","type":"text","attnum":16,"default":null,"not_null":true},{"name":"starter_template_id","type":"uuid","attnum":17,"default":null,"not_null":false},{"name":"starter_template_code","type":"text","attnum":18,"default":null,"not_null":false},{"name":"starter_template_snapshot","type":"jsonb","attnum":19,"default":null,"not_null":false},{"name":"tenant_template_id","type":"uuid","attnum":20,"default":null,"not_null":false},{"name":"retired_at","type":"timestamp with time zone","attnum":21,"default":null,"not_null":false},{"name":"retirement_request_id","type":"uuid","attnum":22,"default":null,"not_null":false},{"name":"multi_bu_governed","type":"boolean","attnum":23,"default":"false","not_null":true},{"name":"created_by_actor_id","type":"uuid","attnum":24,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":25,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":26,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":27,"default":null,"not_null":false},{"name":"governance_state","type":"text","attnum":28,"default":"'development_draft'::text","not_null":true},{"name":"access_mode","type":"text","attnum":29,"default":"'unmapped_pending'::text","not_null":true},{"name":"governance_parent_id","type":"uuid","attnum":30,"default":null,"not_null":false},{"name":"staging_original_name","type":"text","attnum":31,"default":null,"not_null":false},{"name":"staging_generated_name","type":"text","attnum":32,"default":null,"not_null":false}]$columns18287$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: recon_definitions';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=38437::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns38437$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"recon_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"reason","type":"text","attnum":4,"default":null,"not_null":true},{"name":"requested_by","type":"uuid","attnum":5,"default":null,"not_null":true},{"name":"requested_at","type":"timestamp with time zone","attnum":6,"default":"now()","not_null":true},{"name":"status","type":"text","attnum":7,"default":"'pending'::text","not_null":true},{"name":"decision_reason","type":"text","attnum":8,"default":null,"not_null":false},{"name":"decided_by","type":"uuid","attnum":9,"default":null,"not_null":false},{"name":"decided_at","type":"timestamp with time zone","attnum":10,"default":null,"not_null":false}]$columns38437$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: recon_retirement_requests';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=20871::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns20871$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"table_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"tenant_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"row_data","type":"jsonb","attnum":4,"default":null,"not_null":true},{"name":"created_at","type":"timestamp with time zone","attnum":5,"default":"now()","not_null":true},{"name":"key_hash","type":"text","attnum":6,"default":null,"not_null":false},{"name":"version_id","type":"uuid","attnum":7,"default":null,"not_null":false}]$columns20871$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: reference_data_rows';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=20842::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns20842$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"name","type":"text","attnum":3,"default":null,"not_null":true},{"name":"description","type":"text","attnum":4,"default":null,"not_null":false},{"name":"key_columns","type":"text[]","attnum":5,"default":"'{}'::text[]","not_null":true},{"name":"value_columns","type":"text[]","attnum":6,"default":"'{}'::text[]","not_null":true},{"name":"row_count","type":"integer","attnum":7,"default":"0","not_null":true},{"name":"is_active","type":"boolean","attnum":8,"default":"true","not_null":true},{"name":"created_by","type":"uuid","attnum":9,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":10,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":11,"default":"now()","not_null":true},{"name":"published_version_id","type":"uuid","attnum":12,"default":null,"not_null":false},{"name":"public_id","type":"text","attnum":13,"default":"('FVI-REF-'::text || upper(substr(encode(digest((id)::text, 'sha256'::text), 'hex'::text), 1, 20)))","not_null":false},{"name":"access_mode","type":"text","attnum":14,"default":"'unmapped_pending'::text","not_null":true},{"name":"created_by_actor_id","type":"uuid","attnum":15,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":16,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":17,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":18,"default":null,"not_null":false}]$columns20842$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: reference_data_tables';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=33904::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns33904$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"table_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"version_number","type":"integer","attnum":4,"default":null,"not_null":true},{"name":"status","type":"text","attnum":5,"default":"'draft'::text","not_null":true},{"name":"effective_from","type":"date","attnum":6,"default":null,"not_null":true},{"name":"effective_to","type":"date","attnum":7,"default":null,"not_null":false},{"name":"row_count","type":"integer","attnum":8,"default":"0","not_null":true},{"name":"content_sha256","type":"text","attnum":9,"default":null,"not_null":false},{"name":"change_note","type":"text","attnum":10,"default":null,"not_null":true},{"name":"created_by","type":"uuid","attnum":11,"default":null,"not_null":true},{"name":"created_at","type":"timestamp with time zone","attnum":12,"default":"now()","not_null":true},{"name":"submitted_by","type":"uuid","attnum":13,"default":null,"not_null":false},{"name":"submitted_at","type":"timestamp with time zone","attnum":14,"default":null,"not_null":false},{"name":"decided_by","type":"uuid","attnum":15,"default":null,"not_null":false},{"name":"decided_at","type":"timestamp with time zone","attnum":16,"default":null,"not_null":false},{"name":"decision_reason","type":"text","attnum":17,"default":null,"not_null":false},{"name":"published_at","type":"timestamp with time zone","attnum":18,"default":null,"not_null":false}]$columns33904$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: reference_data_versions';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=19774::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns19774$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"pack_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"recon_id","type":"uuid","attnum":4,"default":null,"not_null":false},{"name":"installed_by","type":"uuid","attnum":5,"default":null,"not_null":false},{"name":"installed_version","type":"text","attnum":6,"default":null,"not_null":false},{"name":"installed_at","type":"timestamp with time zone","attnum":7,"default":"now()","not_null":true},{"name":"status","type":"text","attnum":8,"default":"'pending'::text","not_null":true},{"name":"materialization_error","type":"text","attnum":9,"default":null,"not_null":false},{"name":"materialized_at","type":"timestamp with time zone","attnum":10,"default":null,"not_null":false},{"name":"materialized_artifacts","type":"jsonb","attnum":11,"default":"'{}'::jsonb","not_null":true},{"name":"generated_process_count","type":"integer","attnum":12,"default":"0","not_null":true},{"name":"tenant_root_process_id","type":"uuid","attnum":13,"default":null,"not_null":false},{"name":"error_message","type":"text","attnum":14,"default":null,"not_null":false},{"name":"completed_at","type":"timestamp with time zone","attnum":15,"default":null,"not_null":false}]$columns19774$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: regulatory_pack_installs';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=21208::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns21208$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"name","type":"text","attnum":3,"default":null,"not_null":true},{"name":"dialect","type":"text","attnum":4,"default":null,"not_null":true},{"name":"host","type":"text","attnum":5,"default":null,"not_null":false},{"name":"port","type":"integer","attnum":6,"default":null,"not_null":false},{"name":"database","type":"text","attnum":7,"default":null,"not_null":false},{"name":"username","type":"text","attnum":8,"default":null,"not_null":false},{"name":"secret_ref","type":"text","attnum":9,"default":null,"not_null":false},{"name":"ssl","type":"boolean","attnum":10,"default":"true","not_null":true},{"name":"default_sql","type":"text","attnum":11,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":12,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":13,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":14,"default":"now()","not_null":true},{"name":"public_id","type":"text","attnum":15,"default":"('FVI-DB-'::text || upper(substr(encode(digest((id)::text, 'sha256'::text), 'hex'::text), 1, 20)))","not_null":false},{"name":"created_by_actor_id","type":"uuid","attnum":16,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":17,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":18,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":19,"default":null,"not_null":false}]$columns21208$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: rekon_db_connections';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=21183::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns21183$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"name","type":"text","attnum":3,"default":null,"not_null":true},{"name":"method","type":"text","attnum":4,"default":"'GET'::text","not_null":true},{"name":"url","type":"text","attnum":5,"default":null,"not_null":true},{"name":"headers","type":"jsonb","attnum":6,"default":"'{}'::jsonb","not_null":true},{"name":"body","type":"text","attnum":7,"default":null,"not_null":false},{"name":"jsonpath","type":"text","attnum":8,"default":null,"not_null":false},{"name":"auth_secret_ref","type":"text","attnum":9,"default":null,"not_null":false},{"name":"created_by","type":"uuid","attnum":10,"default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","attnum":11,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":12,"default":"now()","not_null":true},{"name":"public_id","type":"text","attnum":13,"default":"('FVI-API-'::text || upper(substr(encode(digest((id)::text, 'sha256'::text), 'hex'::text), 1, 20)))","not_null":false},{"name":"created_by_actor_id","type":"uuid","attnum":14,"default":null,"not_null":false},{"name":"created_by_actor_status","type":"text","attnum":15,"default":null,"not_null":false},{"name":"updated_by_actor_id","type":"uuid","attnum":16,"default":null,"not_null":false},{"name":"updated_by_actor_status","type":"text","attnum":17,"default":null,"not_null":false}]$columns21183$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: rekon_inline_api_sources';END IF;END $column_guard$;
DO $column_guard$ DECLARE cols jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('attnum',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) INTO cols
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=21232::oid AND a.attnum>0 AND NOT a.attisdropped;
 IF cols IS DISTINCT FROM $columns21232$[{"name":"id","type":"uuid","attnum":1,"default":"gen_random_uuid()","not_null":true},{"name":"tenant_id","type":"uuid","attnum":2,"default":null,"not_null":true},{"name":"user_id","type":"uuid","attnum":3,"default":null,"not_null":true},{"name":"mode","type":"text","attnum":4,"default":"'two_sided'::text","not_null":true},{"name":"step","type":"integer","attnum":5,"default":"1","not_null":true},{"name":"draft","type":"jsonb","attnum":6,"default":"'{}'::jsonb","not_null":true},{"name":"created_at","type":"timestamp with time zone","attnum":7,"default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","attnum":8,"default":"now()","not_null":true}]$columns21232$::jsonb THEN RAISE EXCEPTION 'Current native table columns or defaults changed: rekon_wizard_drafts';END IF;END $column_guard$;
SET LOCAL search_path = pg_catalog,public;
-- New availability-only preflight. It never substitutes for any existing permission/resource/RLP/business producer guard.
CREATE FUNCTION public.wfm_assert_current_section(_tenant_id uuid,_page_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=private.wfm_actor(_tenant_id);
BEGIN
 PERFORM private.wfm_assert_enabled(_tenant_id,_page_key);
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',_tenant_id,'page_key',_page_key,'enabled',true);
END $$;
ALTER FUNCTION public.wfm_assert_current_section(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wfm_assert_current_section(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wfm_assert_current_section(uuid,text) TO authenticated;

-- New invoker purpose reads only scope already admitted by the unchanged authoritative Recon/RLP policies.
-- Main must qualify id/tenant_id UUID columns on these captured actual relations before registered declaration.
DO $scope_columns$ BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN('recon_definitions','recon_definition_governance_requests') AND a.attname IN('id','tenant_id') AND a.atttypid='uuid'::regtype AND NOT a.attisdropped)<>4 THEN
 RAISE EXCEPTION 'Reconciliation scope metadata requires current qualification';END IF;
END $scope_columns$;
CREATE FUNCTION public.wfm_assert_recon_scope(_resource_id uuid,_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE tenant uuid; actor uuid; receipt jsonb;
BEGIN
 IF _kind='definition' THEN SELECT r.tenant_id INTO tenant FROM public.recon_definitions r WHERE r.id=_resource_id;
 ELSIF _kind='governance_request' THEN SELECT r.tenant_id INTO tenant FROM public.recon_definition_governance_requests r WHERE r.id=_resource_id;
 ELSE RAISE EXCEPTION 'Invalid reconciliation scope' USING ERRCODE='22023';END IF;
 IF tenant IS NULL THEN RAISE EXCEPTION 'Current reconciliation scope is unavailable' USING ERRCODE='42501';END IF;
 receipt:=public.wfm_assert_current_section(tenant,'recons');
 RETURN receipt||jsonb_build_object('resource_id',_resource_id,'kind',_kind);
END $$;
ALTER FUNCTION public.wfm_assert_recon_scope(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wfm_assert_recon_scope(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wfm_assert_recon_scope(uuid,text) TO authenticated;

DO $core27_table_trigger_after_common$ DECLARE expected jsonb;actual jsonb;BEGIN
 expected:=current_setting('fvi.core27_old_table_triggers_before')::jsonb;
 SELECT jsonb_agg(jsonb_build_object('table_oid',t.tgrelid::text,'trigger_oid',t.oid::text,'attributes',to_jsonb(t),'definition',pg_catalog.pg_get_triggerdef(t.oid)) ORDER BY t.oid) INTO actual
 FROM pg_catalog.pg_trigger t WHERE t.oid IN(SELECT (value->>'trigger_oid')::oid FROM jsonb_array_elements(expected));
 IF coalesce(actual,'[]'::jsonb) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'core27.original_table_trigger_oid_attributes_changed_after_common';END IF;
END $core27_table_trigger_after_common$;
CREATE FUNCTION public.wfm_workspace_row_allowed(_tenant_id uuid,_page_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM private.wfm_actor(_tenant_id);
 PERFORM private.wfm_assert_enabled(_tenant_id,_page_key);
 RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
ALTER FUNCTION public.wfm_workspace_row_allowed(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.wfm_workspace_row_allowed(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wfm_workspace_row_allowed(uuid,text) TO authenticated;
-- Table-specific trigger arguments are registered literals, never caller/GUC-selected authority.
CREATE FUNCTION private.wfm_workspace_write_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  IF current_setting('role',true)='authenticated' THEN PERFORM private.wfm_actor(OLD.tenant_id);END IF;
  PERFORM private.wfm_assert_enabled(OLD.tenant_id,TG_ARGV[0]);END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  IF current_setting('role',true)='authenticated' THEN PERFORM private.wfm_actor(NEW.tenant_id);END IF;
  PERFORM private.wfm_assert_enabled(NEW.tenant_id,TG_ARGV[0]);END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
ALTER FUNCTION private.wfm_workspace_write_gate() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.wfm_workspace_write_gate() FROM PUBLIC,anon,authenticated,service_role;

DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=34364::oid AND n.nspname='public' AND p.proname='assign_exceptions_from_rule' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _rule_id uuid, _exception_ids uuid[]' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old34364$CREATE OR REPLACE FUNCTION public.assign_exceptions_from_rule(_tenant_id uuid, _rule_id uuid, _exception_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  rule_row public.exception_assignment_rules%ROWTYPE;
  exception_id uuid;
  exception_row public.recon_exceptions%ROWTYPE;
  candidate uuid;
  affected integer;
  assigned_count integer := 0;
  skipped_count integer := 0;
BEGIN
  IF actor_id IS NULL OR NOT (
    public.has_tenant_role(actor_id,_tenant_id,'tenant_admin')
    OR public.user_has_permission(actor_id,_tenant_id,'break.assign',NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.assign permission required';
  END IF;
  IF _exception_ids IS NULL OR cardinality(_exception_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'assignment batch must contain 1 to 500 exception IDs';
  END IF;
  IF (SELECT count(DISTINCT selected.id) FROM unnest(_exception_ids) AS selected(id))
     <> cardinality(_exception_ids) THEN
    RAISE EXCEPTION 'assignment batch IDs must be non-null and unique';
  END IF;
  SELECT * INTO rule_row FROM public.exception_assignment_rules
  WHERE id=_rule_id AND tenant_id=_tenant_id AND enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment rule not found'; END IF;

  FOREACH exception_id IN ARRAY _exception_ids LOOP
    SELECT * INTO exception_row FROM public.recon_exceptions
    WHERE id=exception_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND OR exception_row.status<>'open' OR exception_row.assignee IS NOT NULL
       OR exception_row.lifecycle_state IN ('resolved','written_off')
       OR (rule_row.recon_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.recon_runs run
         WHERE run.id=exception_row.run_id AND run.tenant_id=_tenant_id
           AND run.definition_id=rule_row.recon_id
       )) THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    candidate := public.pick_next_assignee(
      _rule_id,
      exception_row.severity,
      exception_row.tags
    );
    IF candidate IS NULL THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    UPDATE public.recon_exceptions
    SET assignee=candidate, assigned_by=actor_id, assigned_at=now()
    WHERE id=exception_row.id AND tenant_id=_tenant_id
      AND status='open' AND assignee IS NULL
      AND lifecycle_state NOT IN ('resolved','written_off');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>1 THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor_id,_tenant_id,'workspace','exception.auto_assigned','recon_exception',exception_row.id::text,
      jsonb_build_object('rule_id',_rule_id,'assignee_id',candidate));
    assigned_count := assigned_count + 1;
  END LOOP;
  RETURN jsonb_build_object('assigned',assigned_count,'skipped',skipped_count);
END;
$function$
$old34364$) THEN RAISE EXCEPTION 'Qualified current native routine changed: assign_exceptions_from_rule';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.assign_exceptions_from_rule(_tenant_id uuid, _rule_id uuid, _exception_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  rule_row public.exception_assignment_rules%ROWTYPE;
  exception_id uuid;
  exception_row public.recon_exceptions%ROWTYPE;
  candidate uuid;
  affected integer;
  assigned_count integer := 0;
  skipped_count integer := 0;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'assignment');

  IF actor_id IS NULL OR NOT (
    public.has_tenant_role(actor_id,_tenant_id,'tenant_admin')
    OR public.user_has_permission(actor_id,_tenant_id,'break.assign',NULL)
  ) THEN
    RAISE EXCEPTION 'forbidden: break.assign permission required';
  END IF;
  IF _exception_ids IS NULL OR cardinality(_exception_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'assignment batch must contain 1 to 500 exception IDs';
  END IF;
  IF (SELECT count(DISTINCT selected.id) FROM unnest(_exception_ids) AS selected(id))
     <> cardinality(_exception_ids) THEN
    RAISE EXCEPTION 'assignment batch IDs must be non-null and unique';
  END IF;
  SELECT * INTO rule_row FROM public.exception_assignment_rules
  WHERE id=_rule_id AND tenant_id=_tenant_id AND enabled=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment rule not found'; END IF;

  FOREACH exception_id IN ARRAY _exception_ids LOOP
    SELECT * INTO exception_row FROM public.recon_exceptions
    WHERE id=exception_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND OR exception_row.status<>'open' OR exception_row.assignee IS NOT NULL
       OR exception_row.lifecycle_state IN ('resolved','written_off')
       OR (rule_row.recon_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.recon_runs run
         WHERE run.id=exception_row.run_id AND run.tenant_id=_tenant_id
           AND run.definition_id=rule_row.recon_id
       )) THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    candidate := public.pick_next_assignee(
      _rule_id,
      exception_row.severity,
      exception_row.tags
    );
    IF candidate IS NULL THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    UPDATE public.recon_exceptions
    SET assignee=candidate, assigned_by=actor_id, assigned_at=now()
    WHERE id=exception_row.id AND tenant_id=_tenant_id
      AND status='open' AND assignee IS NULL
      AND lifecycle_state NOT IN ('resolved','written_off');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected<>1 THEN
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor_id,_tenant_id,'workspace','exception.auto_assigned','recon_exception',exception_row.id::text,
      jsonb_build_object('rule_id',_rule_id,'assignee_id',candidate));
    assigned_count := assigned_count + 1;
  END LOOP;
  RETURN jsonb_build_object('assigned',assigned_count,'skipped',skipped_count);
END;
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=34364::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _rule_id uuid, _exception_ids uuid[]') THEN RAISE EXCEPTION 'Native identity or authority changed: assign_exceptions_from_rule';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=37783::oid AND n.nspname='public' AND p.proname='collateral_qa_vm_create' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant uuid, _schedule uuid, _valuation_at timestamp with time zone, _exposure_reference text, _gross numeric, _assets jsonb, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old37783$CREATE OR REPLACE FUNCTION public.collateral_qa_vm_create(_tenant uuid, _schedule uuid, _valuation_at timestamp with time zone, _exposure_reference text, _gross numeric, _assets jsonb, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_schedule public.collateral_schedules%ROWTYPE;
  v_id uuid;
  v_collateral numeric(20,4);
  v_net numeric(20,4);
  v_proposed numeric(20,4);
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.collateral_qa_tenants scope
    JOIN public.tenant_members tm ON tm.tenant_id = scope.tenant_id
    WHERE scope.tenant_id = _tenant AND scope.enabled AND tm.user_id = v_actor
      AND tm.active AND tm.role::text IN ('tenant_admin','tenant_analyst')
  ) THEN RAISE EXCEPTION 'collateral_qa_access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_schedule FROM public.collateral_schedules
    WHERE id = _schedule AND tenant_id = _tenant AND schedule_type = 'VM';
  IF NOT FOUND OR _valuation_at IS NULL OR _gross IS NULL OR _gross < 0
     OR length(coalesce(_exposure_reference,'')) NOT BETWEEN 3 AND 120
     OR length(coalesce(_reason,'')) NOT BETWEEN 3 AND 1000
     OR jsonb_typeof(_assets) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_assets) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_synthetic_vm_inputs' USING ERRCODE='23514';
  END IF;
  IF (v_schedule.effective_from IS NOT NULL AND _valuation_at::date < v_schedule.effective_from)
     OR (v_schedule.effective_to IS NOT NULL AND _valuation_at::date > v_schedule.effective_to) THEN
    RAISE EXCEPTION 'vm_valuation_outside_agreement_period' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(_assets) AS a(
      asset_type text, description text, provenance_reference text, market_value numeric, haircut_bps integer)
    WHERE length(coalesce(a.asset_type,'')) NOT BETWEEN 2 AND 80
      OR length(coalesce(a.description,'')) NOT BETWEEN 2 AND 160
      OR length(coalesce(a.provenance_reference,'')) NOT BETWEEN 3 AND 120
      OR a.market_value IS NULL OR a.market_value < 0
      OR a.haircut_bps IS NULL OR a.haircut_bps NOT BETWEEN 0 AND 10000
  ) THEN RAISE EXCEPTION 'invalid_synthetic_vm_asset' USING ERRCODE='23514'; END IF;
  SELECT sum(round(a.market_value * (10000 - a.haircut_bps) / 10000, 4))
    INTO v_collateral
  FROM jsonb_to_recordset(_assets) AS a(
    asset_type text, description text, provenance_reference text, market_value numeric, haircut_bps integer);
  v_net := greatest(_gross - v_collateral - v_schedule.threshold_amount, 0);
  v_proposed := CASE WHEN v_net < v_schedule.minimum_transfer THEN 0
    WHEN v_schedule.rounding > 0 THEN round(v_net / v_schedule.rounding) * v_schedule.rounding
    ELSE v_net END;
  INSERT INTO public.collateral_qa_vm_calls(
    tenant_id,schedule_id,valuation_at,exposure_reference,gross_exposure,
    eligible_collateral,threshold_snapshot,mta_snapshot,rounding_snapshot,
    proposed_vm,maker_id,maker_reason
  ) VALUES (_tenant,_schedule,_valuation_at,_exposure_reference,_gross,
    v_collateral,v_schedule.threshold_amount,v_schedule.minimum_transfer,
    v_schedule.rounding,v_proposed,v_actor,_reason) RETURNING id INTO v_id;
  INSERT INTO public.collateral_qa_vm_assets(
    call_id,asset_type,description,provenance_reference,market_value,haircut_bps)
  SELECT v_id,a.asset_type,a.description,a.provenance_reference,a.market_value,a.haircut_bps
  FROM jsonb_to_recordset(_assets) AS a(
    asset_type text, description text, provenance_reference text, market_value numeric, haircut_bps integer);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(v_actor,_tenant,'tenant','collateral.qa_vm.created','collateral_qa_vm_call',v_id::text,
    jsonb_build_object('schedule_id',_schedule,'proposed_vm',v_proposed,'synthetic',true));
  RETURN v_id;
END $function$
$old37783$) THEN RAISE EXCEPTION 'Qualified current native routine changed: collateral_qa_vm_create';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.collateral_qa_vm_create(_tenant uuid, _schedule uuid, _valuation_at timestamp with time zone, _exposure_reference text, _gross numeric, _assets jsonb, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_schedule public.collateral_schedules%ROWTYPE;
  v_id uuid;
  v_collateral numeric(20,4);
  v_net numeric(20,4);
  v_proposed numeric(20,4);
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant,'collateral');

  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.collateral_qa_tenants scope
    JOIN public.tenant_members tm ON tm.tenant_id = scope.tenant_id
    WHERE scope.tenant_id = _tenant AND scope.enabled AND tm.user_id = v_actor
      AND tm.active AND tm.role::text IN ('tenant_admin','tenant_analyst')
  ) THEN RAISE EXCEPTION 'collateral_qa_access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_schedule FROM public.collateral_schedules
    WHERE id = _schedule AND tenant_id = _tenant AND schedule_type = 'VM';
  IF NOT FOUND OR _valuation_at IS NULL OR _gross IS NULL OR _gross < 0
     OR length(coalesce(_exposure_reference,'')) NOT BETWEEN 3 AND 120
     OR length(coalesce(_reason,'')) NOT BETWEEN 3 AND 1000
     OR jsonb_typeof(_assets) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_assets) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_synthetic_vm_inputs' USING ERRCODE='23514';
  END IF;
  IF (v_schedule.effective_from IS NOT NULL AND _valuation_at::date < v_schedule.effective_from)
     OR (v_schedule.effective_to IS NOT NULL AND _valuation_at::date > v_schedule.effective_to) THEN
    RAISE EXCEPTION 'vm_valuation_outside_agreement_period' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(_assets) AS a(
      asset_type text, description text, provenance_reference text, market_value numeric, haircut_bps integer)
    WHERE length(coalesce(a.asset_type,'')) NOT BETWEEN 2 AND 80
      OR length(coalesce(a.description,'')) NOT BETWEEN 2 AND 160
      OR length(coalesce(a.provenance_reference,'')) NOT BETWEEN 3 AND 120
      OR a.market_value IS NULL OR a.market_value < 0
      OR a.haircut_bps IS NULL OR a.haircut_bps NOT BETWEEN 0 AND 10000
  ) THEN RAISE EXCEPTION 'invalid_synthetic_vm_asset' USING ERRCODE='23514'; END IF;
  SELECT sum(round(a.market_value * (10000 - a.haircut_bps) / 10000, 4))
    INTO v_collateral
  FROM jsonb_to_recordset(_assets) AS a(
    asset_type text, description text, provenance_reference text, market_value numeric, haircut_bps integer);
  v_net := greatest(_gross - v_collateral - v_schedule.threshold_amount, 0);
  v_proposed := CASE WHEN v_net < v_schedule.minimum_transfer THEN 0
    WHEN v_schedule.rounding > 0 THEN round(v_net / v_schedule.rounding) * v_schedule.rounding
    ELSE v_net END;
  INSERT INTO public.collateral_qa_vm_calls(
    tenant_id,schedule_id,valuation_at,exposure_reference,gross_exposure,
    eligible_collateral,threshold_snapshot,mta_snapshot,rounding_snapshot,
    proposed_vm,maker_id,maker_reason
  ) VALUES (_tenant,_schedule,_valuation_at,_exposure_reference,_gross,
    v_collateral,v_schedule.threshold_amount,v_schedule.minimum_transfer,
    v_schedule.rounding,v_proposed,v_actor,_reason) RETURNING id INTO v_id;
  INSERT INTO public.collateral_qa_vm_assets(
    call_id,asset_type,description,provenance_reference,market_value,haircut_bps)
  SELECT v_id,a.asset_type,a.description,a.provenance_reference,a.market_value,a.haircut_bps
  FROM jsonb_to_recordset(_assets) AS a(
    asset_type text, description text, provenance_reference text, market_value numeric, haircut_bps integer);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(v_actor,_tenant,'tenant','collateral.qa_vm.created','collateral_qa_vm_call',v_id::text,
    jsonb_build_object('schedule_id',_schedule,'proposed_vm',v_proposed,'synthetic',true));
  RETURN v_id;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=37783::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant uuid, _schedule uuid, _valuation_at timestamp with time zone, _exposure_reference text, _gross numeric, _assets jsonb, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: collateral_qa_vm_create';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=37784::oid AND n.nspname='public' AND p.proname='collateral_qa_vm_transition' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant uuid, _call uuid, _action text, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old37784$CREATE OR REPLACE FUNCTION public.collateral_qa_vm_transition(_tenant uuid, _call uuid, _action text, _reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_call public.collateral_qa_vm_calls%ROWTYPE;
  v_status text;
BEGIN
  SELECT tm.role::text INTO v_role FROM public.collateral_qa_tenants scope
  JOIN public.tenant_members tm ON tm.tenant_id=scope.tenant_id
  WHERE scope.tenant_id=_tenant AND scope.enabled AND tm.user_id=v_actor AND tm.active;
  IF v_role IS NULL OR length(coalesce(_reason,'')) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'collateral_qa_access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_call FROM public.collateral_qa_vm_calls
    WHERE id=_call AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collateral_qa_call_not_found' USING ERRCODE='02000'; END IF;
  IF _action='submit' AND v_call.status='draft' AND v_call.maker_id=v_actor THEN
    v_status := 'pending_checker';
    UPDATE public.collateral_qa_vm_calls SET status=v_status,updated_at=now() WHERE id=_call;
  ELSIF _action IN ('approve','reject') AND v_call.status='pending_checker'
      AND v_role='tenant_admin' AND v_call.maker_id<>v_actor THEN
    v_status := CASE WHEN _action='approve' THEN 'approved' ELSE 'rejected' END;
    UPDATE public.collateral_qa_vm_calls SET status=v_status,checker_id=v_actor,
      checker_reason=_reason,updated_at=now() WHERE id=_call;
  ELSIF _action='record_settlement' AND v_call.status='approved'
      AND v_role IN ('tenant_admin','tenant_analyst') AND v_call.maker_id=v_actor THEN
    v_status := 'settlement_recorded';
    UPDATE public.collateral_qa_vm_calls SET status=v_status,
      internal_settlement_reference=_reason,settlement_recorded_at=now(),updated_at=now() WHERE id=_call;
  ELSE RAISE EXCEPTION 'invalid_collateral_qa_transition' USING ERRCODE='42501'; END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(v_actor,_tenant,'tenant','collateral.qa_vm.'||_action,'collateral_qa_vm_call',_call::text,
    jsonb_build_object('from',v_call.status,'to',v_status,'synthetic',true));
  RETURN v_status;
END $function$
$old37784$) THEN RAISE EXCEPTION 'Qualified current native routine changed: collateral_qa_vm_transition';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.collateral_qa_vm_transition(_tenant uuid, _call uuid, _action text, _reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_call public.collateral_qa_vm_calls%ROWTYPE;
  v_status text;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant,'collateral');

  SELECT tm.role::text INTO v_role FROM public.collateral_qa_tenants scope
  JOIN public.tenant_members tm ON tm.tenant_id=scope.tenant_id
  WHERE scope.tenant_id=_tenant AND scope.enabled AND tm.user_id=v_actor AND tm.active;
  IF v_role IS NULL OR length(coalesce(_reason,'')) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'collateral_qa_access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_call FROM public.collateral_qa_vm_calls
    WHERE id=_call AND tenant_id=_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collateral_qa_call_not_found' USING ERRCODE='02000'; END IF;
  IF _action='submit' AND v_call.status='draft' AND v_call.maker_id=v_actor THEN
    v_status := 'pending_checker';
    UPDATE public.collateral_qa_vm_calls SET status=v_status,updated_at=now() WHERE id=_call;
  ELSIF _action IN ('approve','reject') AND v_call.status='pending_checker'
      AND v_role='tenant_admin' AND v_call.maker_id<>v_actor THEN
    v_status := CASE WHEN _action='approve' THEN 'approved' ELSE 'rejected' END;
    UPDATE public.collateral_qa_vm_calls SET status=v_status,checker_id=v_actor,
      checker_reason=_reason,updated_at=now() WHERE id=_call;
  ELSIF _action='record_settlement' AND v_call.status='approved'
      AND v_role IN ('tenant_admin','tenant_analyst') AND v_call.maker_id=v_actor THEN
    v_status := 'settlement_recorded';
    UPDATE public.collateral_qa_vm_calls SET status=v_status,
      internal_settlement_reference=_reason,settlement_recorded_at=now(),updated_at=now() WHERE id=_call;
  ELSE RAISE EXCEPTION 'invalid_collateral_qa_transition' USING ERRCODE='42501'; END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(v_actor,_tenant,'tenant','collateral.qa_vm.'||_action,'collateral_qa_vm_call',_call::text,
    jsonb_build_object('from',v_call.status,'to',v_status,'synthetic',true));
  RETURN v_status;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=37784::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant uuid, _call uuid, _action text, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: collateral_qa_vm_transition';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38722::oid AND n.nspname='public' AND p.proname='create_collateral_csa_draft' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _agreement_id uuid, _agreement_key text, _own_legal_entity text, _counterparty text, _currency text, _threshold_amount numeric, _minimum_transfer numeric, _rounding_increment numeric, _effective_from date, _effective_to date, _terms_snapshot jsonb, _idempotency_key text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38722$CREATE OR REPLACE FUNCTION public.create_collateral_csa_draft(_tenant_id uuid, _agreement_id uuid, _agreement_key text, _own_legal_entity text, _counterparty text, _currency text, _threshold_amount numeric, _minimum_transfer numeric, _rounding_increment numeric, _effective_from date, _effective_to date, _terms_snapshot jsonb, _idempotency_key text)
 RETURNS TABLE(agreement_id uuid, version_id uuid, version_no integer, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor uuid := auth.uid();
  agreement_row public.collateral_csa_agreements%ROWTYPE;
  version_row public.collateral_csa_versions%ROWTYPE;
  request_digest text;
BEGIN
  IF NOT public.csa_assurance_actor(_tenant_id,actor) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF _threshold_amount < 0 OR _minimum_transfer < 0 OR _rounding_increment < 0
     OR _effective_to IS NOT NULL AND _effective_to < _effective_from
     OR _currency !~ '^[A-Z]{3}$' OR _terms_snapshot IS NULL OR jsonb_typeof(_terms_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Invalid bilateral VM agreement terms' USING ERRCODE='22023';
  END IF;
  request_digest := encode(extensions.digest(jsonb_build_object(
    'agreement_id',_agreement_id,'agreement_key',_agreement_key,'own_legal_entity',_own_legal_entity,
    'counterparty',_counterparty,'currency',_currency,'threshold_amount',_threshold_amount,
    'minimum_transfer',_minimum_transfer,'rounding_increment',_rounding_increment,
    'effective_from',_effective_from,'effective_to',_effective_to,'terms_snapshot',_terms_snapshot
  )::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||actor::text||':'||_idempotency_key,0));
  SELECT * INTO version_row FROM public.collateral_csa_versions
    WHERE tenant_id=_tenant_id AND created_by=actor AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF version_row.request_hash <> request_digest THEN RAISE EXCEPTION 'Idempotency key reused with different agreement terms' USING ERRCODE='22023'; END IF;
    RETURN QUERY SELECT version_row.agreement_id,version_row.id,version_row.version_no,true; RETURN;
  END IF;
  IF _agreement_id IS NULL THEN
    IF _agreement_key IS NULL OR _own_legal_entity IS NULL OR _counterparty IS NULL THEN
      RAISE EXCEPTION 'New agreement identity is required' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.collateral_csa_agreements(tenant_id,agreement_key,own_legal_entity,counterparty,currency,created_by)
    VALUES (_tenant_id,_agreement_key,_own_legal_entity,_counterparty,_currency,actor) RETURNING * INTO agreement_row;
  ELSE
    SELECT * INTO agreement_row FROM public.collateral_csa_agreements
      WHERE id=_agreement_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agreement is unavailable in this tenant' USING ERRCODE='42501'; END IF;
    IF agreement_row.currency IS DISTINCT FROM _currency OR agreement_row.agreement_key IS DISTINCT FROM _agreement_key
       OR agreement_row.own_legal_entity IS DISTINCT FROM _own_legal_entity OR agreement_row.counterparty IS DISTINCT FROM _counterparty THEN
      RAISE EXCEPTION 'Agreement identity is immutable' USING ERRCODE='22023';
    END IF;
  END IF;
  INSERT INTO public.collateral_csa_versions(tenant_id,agreement_id,version_no,threshold_amount,minimum_transfer,
    rounding_increment,effective_from,effective_to,terms_snapshot,created_by,idempotency_key,request_hash)
  SELECT _tenant_id,agreement_row.id,coalesce(max(v.version_no),0)+1,_threshold_amount,_minimum_transfer,
    _rounding_increment,_effective_from,_effective_to,coalesce(_terms_snapshot,'{}'::jsonb),actor,_idempotency_key,request_digest
  FROM public.collateral_csa_versions v WHERE v.tenant_id=_tenant_id AND v.agreement_id=agreement_row.id
  RETURNING * INTO version_row;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.csa.version.draft','collateral_csa_version',version_row.id::text,
    jsonb_build_object('agreement_id',agreement_row.id,'version_no',version_row.version_no,'currency',_currency));
  RETURN QUERY SELECT agreement_row.id,version_row.id,version_row.version_no,false;
END $function$
$old38722$) THEN RAISE EXCEPTION 'Qualified current native routine changed: create_collateral_csa_draft';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.create_collateral_csa_draft(_tenant_id uuid, _agreement_id uuid, _agreement_key text, _own_legal_entity text, _counterparty text, _currency text, _threshold_amount numeric, _minimum_transfer numeric, _rounding_increment numeric, _effective_from date, _effective_to date, _terms_snapshot jsonb, _idempotency_key text)
 RETURNS TABLE(agreement_id uuid, version_id uuid, version_no integer, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor uuid := auth.uid();
  agreement_row public.collateral_csa_agreements%ROWTYPE;
  version_row public.collateral_csa_versions%ROWTYPE;
  request_digest text;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'collateral');

  IF NOT public.csa_assurance_actor(_tenant_id,actor) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF _threshold_amount < 0 OR _minimum_transfer < 0 OR _rounding_increment < 0
     OR _effective_to IS NOT NULL AND _effective_to < _effective_from
     OR _currency !~ '^[A-Z]{3}$' OR _terms_snapshot IS NULL OR jsonb_typeof(_terms_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Invalid bilateral VM agreement terms' USING ERRCODE='22023';
  END IF;
  request_digest := encode(extensions.digest(jsonb_build_object(
    'agreement_id',_agreement_id,'agreement_key',_agreement_key,'own_legal_entity',_own_legal_entity,
    'counterparty',_counterparty,'currency',_currency,'threshold_amount',_threshold_amount,
    'minimum_transfer',_minimum_transfer,'rounding_increment',_rounding_increment,
    'effective_from',_effective_from,'effective_to',_effective_to,'terms_snapshot',_terms_snapshot
  )::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||actor::text||':'||_idempotency_key,0));
  SELECT * INTO version_row FROM public.collateral_csa_versions
    WHERE tenant_id=_tenant_id AND created_by=actor AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF version_row.request_hash <> request_digest THEN RAISE EXCEPTION 'Idempotency key reused with different agreement terms' USING ERRCODE='22023'; END IF;
    RETURN QUERY SELECT version_row.agreement_id,version_row.id,version_row.version_no,true; RETURN;
  END IF;
  IF _agreement_id IS NULL THEN
    IF _agreement_key IS NULL OR _own_legal_entity IS NULL OR _counterparty IS NULL THEN
      RAISE EXCEPTION 'New agreement identity is required' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.collateral_csa_agreements(tenant_id,agreement_key,own_legal_entity,counterparty,currency,created_by)
    VALUES (_tenant_id,_agreement_key,_own_legal_entity,_counterparty,_currency,actor) RETURNING * INTO agreement_row;
  ELSE
    SELECT * INTO agreement_row FROM public.collateral_csa_agreements
      WHERE id=_agreement_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agreement is unavailable in this tenant' USING ERRCODE='42501'; END IF;
    IF agreement_row.currency IS DISTINCT FROM _currency OR agreement_row.agreement_key IS DISTINCT FROM _agreement_key
       OR agreement_row.own_legal_entity IS DISTINCT FROM _own_legal_entity OR agreement_row.counterparty IS DISTINCT FROM _counterparty THEN
      RAISE EXCEPTION 'Agreement identity is immutable' USING ERRCODE='22023';
    END IF;
  END IF;
  INSERT INTO public.collateral_csa_versions(tenant_id,agreement_id,version_no,threshold_amount,minimum_transfer,
    rounding_increment,effective_from,effective_to,terms_snapshot,created_by,idempotency_key,request_hash)
  SELECT _tenant_id,agreement_row.id,coalesce(max(v.version_no),0)+1,_threshold_amount,_minimum_transfer,
    _rounding_increment,_effective_from,_effective_to,coalesce(_terms_snapshot,'{}'::jsonb),actor,_idempotency_key,request_digest
  FROM public.collateral_csa_versions v WHERE v.tenant_id=_tenant_id AND v.agreement_id=agreement_row.id
  RETURNING * INTO version_row;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.csa.version.draft','collateral_csa_version',version_row.id::text,
    jsonb_build_object('agreement_id',agreement_row.id,'version_no',version_row.version_no,'currency',_currency));
  RETURN QUERY SELECT agreement_row.id,version_row.id,version_row.version_no,false;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38722::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _agreement_id uuid, _agreement_key text, _own_legal_entity text, _counterparty text, _currency text, _threshold_amount numeric, _minimum_transfer numeric, _rounding_increment numeric, _effective_from date, _effective_to date, _terms_snapshot jsonb, _idempotency_key text') THEN RAISE EXCEPTION 'Native identity or authority changed: create_collateral_csa_draft';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39385::oid AND n.nspname='public' AND p.proname='create_recon_definition_with_owners' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _name text, _description text, _recon_type text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[]' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old39385$CREATE OR REPLACE FUNCTION public.create_recon_definition_with_owners(_tenant_id uuid, _name text, _description text, _recon_type text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[])
 RETURNS TABLE(id uuid, recon_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_bu_ids uuid[];
  v_source_ids uuid[];
  v_source_count integer;
  v_side_count integer;
  v_definition_id uuid;
  v_recon_code text;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR length(btrim(coalesce(_name,''))) NOT BETWEEN 1 AND 200
     OR _recon_type IS NULL OR _recon_type NOT IN ('one_sided','two_sided','three_sided')
     OR jsonb_typeof(coalesce(_sides,'[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_rules,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid reconciliation creation request' USING ERRCODE='22023';
  END IF;
  v_side_count := jsonb_array_length(coalesce(_sides,'[]'::jsonb));
  IF v_side_count <> (CASE _recon_type WHEN 'one_sided' THEN 1 WHEN 'two_sided' THEN 2 ELSE 3 END)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_sides,'[]'::jsonb)) side
       WHERE nullif(side->>'data_source_id','') IS NULL
          OR (nullif(side->>'upload_id','') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.workspace_data_source_uploads upload_row
              WHERE upload_row.id=(side->>'upload_id')::uuid
                AND upload_row.tenant_id=_tenant_id
                AND upload_row.data_source_id=(side->>'data_source_id')::uuid
            ))
     ) THEN
    RAISE EXCEPTION 'source bindings must be complete and belong to this workspace' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(array_agg(DISTINCT nullif(side->>'data_source_id','')::uuid
                            ORDER BY nullif(side->>'data_source_id','')::uuid),ARRAY[]::uuid[])
  INTO v_source_ids
  FROM jsonb_array_elements(coalesce(_sides,'[]'::jsonb)) side;
  SELECT count(DISTINCT source_row.id) INTO v_source_count
  FROM public.workspace_data_sources source_row
  WHERE source_row.tenant_id=_tenant_id AND source_row.id=ANY(v_source_ids);
  IF v_source_count <> cardinality(v_source_ids) THEN
    RAISE EXCEPTION 'one or more reconciliation sources are unavailable in this workspace' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id=_tenant_id AND member_row.user_id=v_actor
      AND member_row.active AND member_row.role::text='tenant_admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin AND NOT private.recon_governance_is_active_analyst(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator or analyst required' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id), ARRAY[]::uuid[])
  INTO v_bu_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_bu_ids)=0 THEN
    RAISE EXCEPTION 'at least one owning business unit is required' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    LEFT JOIN public.business_units bu
      ON bu.id=requested.bu_id AND bu.tenant_id=_tenant_id
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'owning business units must be active and belong to the reconciliation tenant' USING ERRCODE='22023';
  END IF;
  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_bu
        ON assigned_bu.id=assignment.bu_id AND assigned_bu.tenant_id=assignment.tenant_id
        AND NOT assigned_bu.is_archived
      JOIN public.business_units owner_bu
        ON owner_bu.id=requested.bu_id AND owner_bu.tenant_id=assignment.tenant_id
        AND NOT owner_bu.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=v_actor
        AND (owner_bu.id=assigned_bu.id
          OR (assignment.inherit_descendants AND owner_bu.path <@ assigned_bu.path))
    )
  ) THEN
    RAISE EXCEPTION 'analyst must be assigned to every selected owning business unit' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.recon_definitions(
    tenant_id,name,description,recon_type,sides,rules,status,created_by,
    governance_state,access_mode,multi_bu_governed
  ) VALUES (
    _tenant_id,btrim(_name),nullif(btrim(coalesce(_description,'')),''),_recon_type,
    coalesce(_sides,'[]'::jsonb),coalesce(_rules,'[]'::jsonb),'draft',v_actor,
    'development_draft','unmapped_pending',false
  ) RETURNING recon_definitions.id,recon_definitions.recon_code
    INTO v_definition_id,v_recon_code;

  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by)
  SELECT _tenant_id,v_definition_id,owner_id,v_actor FROM unnest(v_bu_ids) owner_id;

  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (
    _tenant_id,v_definition_id,'replace_owners',v_actor,
    'Atomic definition creation owner binding',
    jsonb_build_object('previous_bu_ids',ARRAY[]::uuid[],'new_bu_ids',v_bu_ids,'source','atomic_create')
  );

  -- Active tenant admins have the authoritative in-tenant override and may
  -- not have per-BU assignments. Analysts were checked above for every owner
  -- BU, so grant only their explicit draft capabilities.
  IF NOT v_is_admin THEN
    INSERT INTO public.recon_definition_bu_grants(
      tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by
    )
    SELECT _tenant_id,v_definition_id,owner_id,'user',v_actor,action_name,v_actor
    FROM unnest(v_bu_ids) owner_id
    CROSS JOIN unnest(ARRAY['view','edit','run']::text[]) action_name;
  END IF;

  UPDATE public.recon_definitions
  SET access_mode='mapped_exact',multi_bu_governed=true
  WHERE recon_definitions.id=v_definition_id AND recon_definitions.tenant_id=_tenant_id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (
    v_actor,_tenant_id,'workspace','recon.create','recon_definition',v_definition_id::text,
    jsonb_build_object('recon_code',v_recon_code,'name',btrim(_name),'type',_recon_type,
      'owner_bu_ids',v_bu_ids)
  );

  RETURN QUERY SELECT v_definition_id,v_recon_code;
END
$function$
$old39385$) THEN RAISE EXCEPTION 'Qualified current native routine changed: create_recon_definition_with_owners';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.create_recon_definition_with_owners(_tenant_id uuid, _name text, _description text, _recon_type text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[])
 RETURNS TABLE(id uuid, recon_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_bu_ids uuid[];
  v_source_ids uuid[];
  v_source_count integer;
  v_side_count integer;
  v_definition_id uuid;
  v_recon_code text;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF v_actor IS NULL OR _tenant_id IS NULL OR length(btrim(coalesce(_name,''))) NOT BETWEEN 1 AND 200
     OR _recon_type IS NULL OR _recon_type NOT IN ('one_sided','two_sided','three_sided')
     OR jsonb_typeof(coalesce(_sides,'[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_rules,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid reconciliation creation request' USING ERRCODE='22023';
  END IF;
  v_side_count := jsonb_array_length(coalesce(_sides,'[]'::jsonb));
  IF v_side_count <> (CASE _recon_type WHEN 'one_sided' THEN 1 WHEN 'two_sided' THEN 2 ELSE 3 END)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_sides,'[]'::jsonb)) side
       WHERE nullif(side->>'data_source_id','') IS NULL
          OR (nullif(side->>'upload_id','') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.workspace_data_source_uploads upload_row
              WHERE upload_row.id=(side->>'upload_id')::uuid
                AND upload_row.tenant_id=_tenant_id
                AND upload_row.data_source_id=(side->>'data_source_id')::uuid
            ))
     ) THEN
    RAISE EXCEPTION 'source bindings must be complete and belong to this workspace' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(array_agg(DISTINCT nullif(side->>'data_source_id','')::uuid
                            ORDER BY nullif(side->>'data_source_id','')::uuid),ARRAY[]::uuid[])
  INTO v_source_ids
  FROM jsonb_array_elements(coalesce(_sides,'[]'::jsonb)) side;
  SELECT count(DISTINCT source_row.id) INTO v_source_count
  FROM public.workspace_data_sources source_row
  WHERE source_row.tenant_id=_tenant_id AND source_row.id=ANY(v_source_ids);
  IF v_source_count <> cardinality(v_source_ids) THEN
    RAISE EXCEPTION 'one or more reconciliation sources are unavailable in this workspace' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id=_tenant_id AND member_row.user_id=v_actor
      AND member_row.active AND member_row.role::text='tenant_admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin AND NOT private.recon_governance_is_active_analyst(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator or analyst required' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id), ARRAY[]::uuid[])
  INTO v_bu_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_bu_ids)=0 THEN
    RAISE EXCEPTION 'at least one owning business unit is required' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    LEFT JOIN public.business_units bu
      ON bu.id=requested.bu_id AND bu.tenant_id=_tenant_id
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'owning business units must be active and belong to the reconciliation tenant' USING ERRCODE='22023';
  END IF;
  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM unnest(v_bu_ids) requested(bu_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_bu
        ON assigned_bu.id=assignment.bu_id AND assigned_bu.tenant_id=assignment.tenant_id
        AND NOT assigned_bu.is_archived
      JOIN public.business_units owner_bu
        ON owner_bu.id=requested.bu_id AND owner_bu.tenant_id=assignment.tenant_id
        AND NOT owner_bu.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=v_actor
        AND (owner_bu.id=assigned_bu.id
          OR (assignment.inherit_descendants AND owner_bu.path <@ assigned_bu.path))
    )
  ) THEN
    RAISE EXCEPTION 'analyst must be assigned to every selected owning business unit' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.recon_definitions(
    tenant_id,name,description,recon_type,sides,rules,status,created_by,
    governance_state,access_mode,multi_bu_governed
  ) VALUES (
    _tenant_id,btrim(_name),nullif(btrim(coalesce(_description,'')),''),_recon_type,
    coalesce(_sides,'[]'::jsonb),coalesce(_rules,'[]'::jsonb),'draft',v_actor,
    'development_draft','unmapped_pending',false
  ) RETURNING recon_definitions.id,recon_definitions.recon_code
    INTO v_definition_id,v_recon_code;

  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by)
  SELECT _tenant_id,v_definition_id,owner_id,v_actor FROM unnest(v_bu_ids) owner_id;

  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (
    _tenant_id,v_definition_id,'replace_owners',v_actor,
    'Atomic definition creation owner binding',
    jsonb_build_object('previous_bu_ids',ARRAY[]::uuid[],'new_bu_ids',v_bu_ids,'source','atomic_create')
  );

  -- Active tenant admins have the authoritative in-tenant override and may
  -- not have per-BU assignments. Analysts were checked above for every owner
  -- BU, so grant only their explicit draft capabilities.
  IF NOT v_is_admin THEN
    INSERT INTO public.recon_definition_bu_grants(
      tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by
    )
    SELECT _tenant_id,v_definition_id,owner_id,'user',v_actor,action_name,v_actor
    FROM unnest(v_bu_ids) owner_id
    CROSS JOIN unnest(ARRAY['view','edit','run']::text[]) action_name;
  END IF;

  UPDATE public.recon_definitions
  SET access_mode='mapped_exact',multi_bu_governed=true
  WHERE recon_definitions.id=v_definition_id AND recon_definitions.tenant_id=_tenant_id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (
    v_actor,_tenant_id,'workspace','recon.create','recon_definition',v_definition_id::text,
    jsonb_build_object('recon_code',v_recon_code,'name',btrim(_name),'type',_recon_type,
      'owner_bu_ids',v_bu_ids)
  );

  RETURN QUERY SELECT v_definition_id,v_recon_code;
END
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39385::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _name text, _description text, _recon_type text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[]') THEN RAISE EXCEPTION 'Native identity or authority changed: create_recon_definition_with_owners';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39437::oid AND n.nspname='public' AND p.proname='cutover_legacy_recon_definition_mapping' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _recon_id uuid, _owner_bu_ids uuid[], _maker_user_id uuid, _checker_user_id uuid, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old39437$CREATE OR REPLACE FUNCTION public.cutover_legacy_recon_definition_mapping(_tenant_id uuid, _recon_id uuid, _owner_bu_ids uuid[], _maker_user_id uuid, _checker_user_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_definition public.recon_definitions%ROWTYPE;
  v_owner_ids uuid[];
  v_existing_owner_ids uuid[];
  v_maker_role text;
  v_checker_role text;
  v_receipt_id uuid;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _recon_id IS NULL
     OR _maker_user_id IS NULL OR _checker_user_id IS NULL
     OR _maker_user_id=_checker_user_id OR v_actor IN (_maker_user_id,_checker_user_id)
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid legacy mapping cutover request' USING ERRCODE='22023';
  END IF;
  IF NOT private.recon_governance_is_active_admin(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active same-tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id=_recon_id AND d.tenant_id=_tenant_id
  FOR UPDATE;
  IF NOT FOUND OR v_definition.access_mode<>'legacy_passthrough'
     OR v_definition.governance_state<>'legacy_unreviewed'
     OR v_definition.multi_bu_governed THEN
    RAISE EXCEPTION 'definition is not an unmapped legacy reconciliation' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT requested.bu_id ORDER BY requested.bu_id),ARRAY[]::uuid[])
  INTO v_owner_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) requested(bu_id);
  IF cardinality(v_owner_ids)=0 OR cardinality(v_owner_ids)<>cardinality(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'one or more distinct owner business units are required' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
  INTO v_existing_owner_ids
  FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=_recon_id;
  IF v_existing_owner_ids IS DISTINCT FROM v_owner_ids OR cardinality(v_existing_owner_ids)<>cardinality(v_owner_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
       LEFT JOIN public.business_units owner_unit
         ON owner_unit.id=requested.bu_id AND owner_unit.tenant_id=_tenant_id
       WHERE owner_unit.id IS NULL OR owner_unit.is_archived
     ) THEN
    RAISE EXCEPTION 'owner links must exactly match active same-tenant business units' USING ERRCODE='42501';
  END IF;
  -- Serialize owner replacement and grant revocation/insertion across the
  -- validation-to-transition interval. The parent definition lock above also
  -- serializes set_recon_owners, which locks that row before changing links.
  PERFORM owner_row.bu_id
  FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=_recon_id
  ORDER BY owner_row.bu_id FOR UPDATE;
  PERFORM grant_row.id
  FROM public.recon_definition_bu_grants grant_row
  WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
  ORDER BY grant_row.id FOR SHARE;

  SELECT tm.role::text INTO v_maker_role FROM public.tenant_members tm
  WHERE tm.tenant_id=_tenant_id AND tm.user_id=_maker_user_id AND tm.active;
  SELECT tm.role::text INTO v_checker_role FROM public.tenant_members tm
  WHERE tm.tenant_id=_tenant_id AND tm.user_id=_checker_user_id AND tm.active;
  IF v_maker_role IS NULL OR v_checker_role IS NULL THEN
    RAISE EXCEPTION 'maker and checker must be active members of the same tenant' USING ERRCODE='42501';
  END IF;

  -- Each synthetic actor needs current assignment to every owner BU and a
  -- reviewed direct-user or assigned same-tenant group grant for every action.
  IF EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) owner(bu_id)
    CROSS JOIN unnest(ARRAY['view','run','edit']::text[]) needed(action_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_unit ON assigned_unit.id=assignment.bu_id
        AND assigned_unit.tenant_id=assignment.tenant_id AND NOT assigned_unit.is_archived
      JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
        AND owner_unit.tenant_id=assignment.tenant_id AND NOT owner_unit.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=_maker_user_id
        AND (assigned_unit.id=owner_unit.id OR
             (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recon_definition_bu_grants grant_row
      WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
        AND grant_row.bu_id=owner.bu_id AND grant_row.action=needed.action_name
        AND ((grant_row.principal_type='user' AND grant_row.principal_id=_maker_user_id)
          OR (grant_row.principal_type='group' AND EXISTS (
            SELECT 1 FROM public.tenant_groups group_row
            JOIN public.tenant_group_members group_member ON group_member.group_id=group_row.id
              AND group_member.user_id=_maker_user_id
            JOIN public.tenant_members active_member ON active_member.tenant_id=_tenant_id
              AND active_member.user_id=group_member.user_id AND active_member.active
            JOIN public.bu_group_assignments group_assignment ON group_assignment.tenant_id=_tenant_id
              AND group_assignment.group_id=group_row.id
            JOIN public.business_units assigned_unit ON assigned_unit.id=group_assignment.bu_id
              AND assigned_unit.tenant_id=group_assignment.tenant_id AND NOT assigned_unit.is_archived
            JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
              AND owner_unit.tenant_id=group_assignment.tenant_id AND NOT owner_unit.is_archived
            WHERE group_row.id=grant_row.principal_id AND group_row.tenant_id=_tenant_id
              AND (assigned_unit.id=owner_unit.id OR
                   (group_assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
          )))
    )
  ) OR EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) owner(bu_id)
    CROSS JOIN unnest(ARRAY['view','approve']::text[]) needed(action_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_unit ON assigned_unit.id=assignment.bu_id
        AND assigned_unit.tenant_id=assignment.tenant_id AND NOT assigned_unit.is_archived
      JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
        AND owner_unit.tenant_id=assignment.tenant_id AND NOT owner_unit.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=_checker_user_id
        AND (assigned_unit.id=owner_unit.id OR
             (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recon_definition_bu_grants grant_row
      WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
        AND grant_row.bu_id=owner.bu_id AND grant_row.action=needed.action_name
        AND ((grant_row.principal_type='user' AND grant_row.principal_id=_checker_user_id)
          OR (grant_row.principal_type='group' AND EXISTS (
            SELECT 1 FROM public.tenant_groups group_row
            JOIN public.tenant_group_members group_member ON group_member.group_id=group_row.id
              AND group_member.user_id=_checker_user_id
            JOIN public.tenant_members active_member ON active_member.tenant_id=_tenant_id
              AND active_member.user_id=group_member.user_id AND active_member.active
            JOIN public.bu_group_assignments group_assignment ON group_assignment.tenant_id=_tenant_id
              AND group_assignment.group_id=group_row.id
            JOIN public.business_units assigned_unit ON assigned_unit.id=group_assignment.bu_id
              AND assigned_unit.tenant_id=group_assignment.tenant_id AND NOT assigned_unit.is_archived
            JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
              AND owner_unit.tenant_id=group_assignment.tenant_id AND NOT owner_unit.is_archived
            WHERE group_row.id=grant_row.principal_id AND group_row.tenant_id=_tenant_id
              AND (assigned_unit.id=owner_unit.id OR
                   (group_assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
          )))
    )
  ) THEN
    RAISE EXCEPTION 'maker/checker assignments and reviewed grants are incomplete' USING ERRCODE='42501';
  END IF;

  INSERT INTO private.recon_legacy_mapping_cutover_receipts(
    tenant_id,recon_id,actor_id,owner_bu_ids,maker_user_id,checker_user_id,reason
  ) VALUES (_tenant_id,_recon_id,v_actor,v_owner_ids,_maker_user_id,_checker_user_id,btrim(_reason))
  RETURNING id INTO v_receipt_id;
  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (_tenant_id,_recon_id,'map_legacy',v_actor,btrim(_reason),jsonb_build_object(
    'receipt_id',v_receipt_id,'owner_bu_ids',v_owner_ids,'maker_user_id',_maker_user_id,
    'maker_actions',ARRAY['view','run','edit'],'checker_user_id',_checker_user_id,
    'checker_actions',ARRAY['view','approve'],'previous_access_mode',v_definition.access_mode,
    'previous_governance_state',v_definition.governance_state,'new_access_mode','mapped_exact',
    'new_governance_state','legacy_mapped','status_preserved',v_definition.status,
    'legacy_bu_id_preserved',v_definition.bu_id,'scope','owner_authorized_synthetic_assurance'
  ));
  UPDATE public.recon_definitions
  SET access_mode='mapped_exact', governance_state='legacy_mapped', multi_bu_governed=true
  WHERE id=_recon_id AND tenant_id=_tenant_id
    AND access_mode='legacy_passthrough' AND governance_state='legacy_unreviewed';
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy definition changed during mapping cutover'; END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,'workspace','recon.legacy_mapping.cutover','recon_definition',_recon_id::text,
    jsonb_build_object('receipt_id',v_receipt_id,'recon_code',v_definition.recon_code,
      'owner_bu_ids',v_owner_ids,'maker_user_id',_maker_user_id,'checker_user_id',_checker_user_id,
      'reason',btrim(_reason),'status_preserved',v_definition.status,
      'legacy_bu_id_preserved',v_definition.bu_id,'governance_state','legacy_mapped'));
  RETURN jsonb_build_object('recon_id',_recon_id,'recon_code',v_definition.recon_code,
    'access_mode','mapped_exact','governance_state','legacy_mapped','status',v_definition.status,
    'legacy_bu_id',v_definition.bu_id,'owner_bu_ids',v_owner_ids,'audit_receipt_id',v_receipt_id);
END
$function$
$old39437$) THEN RAISE EXCEPTION 'Qualified current native routine changed: cutover_legacy_recon_definition_mapping';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.cutover_legacy_recon_definition_mapping(_tenant_id uuid, _recon_id uuid, _owner_bu_ids uuid[], _maker_user_id uuid, _checker_user_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_definition public.recon_definitions%ROWTYPE;
  v_owner_ids uuid[];
  v_existing_owner_ids uuid[];
  v_maker_role text;
  v_checker_role text;
  v_receipt_id uuid;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF v_actor IS NULL OR _tenant_id IS NULL OR _recon_id IS NULL
     OR _maker_user_id IS NULL OR _checker_user_id IS NULL
     OR _maker_user_id=_checker_user_id OR v_actor IN (_maker_user_id,_checker_user_id)
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'invalid legacy mapping cutover request' USING ERRCODE='22023';
  END IF;
  IF NOT private.recon_governance_is_active_admin(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active same-tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_definition
  FROM public.recon_definitions d
  WHERE d.id=_recon_id AND d.tenant_id=_tenant_id
  FOR UPDATE;
  IF NOT FOUND OR v_definition.access_mode<>'legacy_passthrough'
     OR v_definition.governance_state<>'legacy_unreviewed'
     OR v_definition.multi_bu_governed THEN
    RAISE EXCEPTION 'definition is not an unmapped legacy reconciliation' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT requested.bu_id ORDER BY requested.bu_id),ARRAY[]::uuid[])
  INTO v_owner_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) requested(bu_id);
  IF cardinality(v_owner_ids)=0 OR cardinality(v_owner_ids)<>cardinality(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'one or more distinct owner business units are required' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
  INTO v_existing_owner_ids
  FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=_recon_id;
  IF v_existing_owner_ids IS DISTINCT FROM v_owner_ids OR cardinality(v_existing_owner_ids)<>cardinality(v_owner_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
       LEFT JOIN public.business_units owner_unit
         ON owner_unit.id=requested.bu_id AND owner_unit.tenant_id=_tenant_id
       WHERE owner_unit.id IS NULL OR owner_unit.is_archived
     ) THEN
    RAISE EXCEPTION 'owner links must exactly match active same-tenant business units' USING ERRCODE='42501';
  END IF;
  -- Serialize owner replacement and grant revocation/insertion across the
  -- validation-to-transition interval. The parent definition lock above also
  -- serializes set_recon_owners, which locks that row before changing links.
  PERFORM owner_row.bu_id
  FROM public.recon_definition_business_units owner_row
  WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=_recon_id
  ORDER BY owner_row.bu_id FOR UPDATE;
  PERFORM grant_row.id
  FROM public.recon_definition_bu_grants grant_row
  WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
  ORDER BY grant_row.id FOR SHARE;

  SELECT tm.role::text INTO v_maker_role FROM public.tenant_members tm
  WHERE tm.tenant_id=_tenant_id AND tm.user_id=_maker_user_id AND tm.active;
  SELECT tm.role::text INTO v_checker_role FROM public.tenant_members tm
  WHERE tm.tenant_id=_tenant_id AND tm.user_id=_checker_user_id AND tm.active;
  IF v_maker_role IS NULL OR v_checker_role IS NULL THEN
    RAISE EXCEPTION 'maker and checker must be active members of the same tenant' USING ERRCODE='42501';
  END IF;

  -- Each synthetic actor needs current assignment to every owner BU and a
  -- reviewed direct-user or assigned same-tenant group grant for every action.
  IF EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) owner(bu_id)
    CROSS JOIN unnest(ARRAY['view','run','edit']::text[]) needed(action_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_unit ON assigned_unit.id=assignment.bu_id
        AND assigned_unit.tenant_id=assignment.tenant_id AND NOT assigned_unit.is_archived
      JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
        AND owner_unit.tenant_id=assignment.tenant_id AND NOT owner_unit.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=_maker_user_id
        AND (assigned_unit.id=owner_unit.id OR
             (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recon_definition_bu_grants grant_row
      WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
        AND grant_row.bu_id=owner.bu_id AND grant_row.action=needed.action_name
        AND ((grant_row.principal_type='user' AND grant_row.principal_id=_maker_user_id)
          OR (grant_row.principal_type='group' AND EXISTS (
            SELECT 1 FROM public.tenant_groups group_row
            JOIN public.tenant_group_members group_member ON group_member.group_id=group_row.id
              AND group_member.user_id=_maker_user_id
            JOIN public.tenant_members active_member ON active_member.tenant_id=_tenant_id
              AND active_member.user_id=group_member.user_id AND active_member.active
            JOIN public.bu_group_assignments group_assignment ON group_assignment.tenant_id=_tenant_id
              AND group_assignment.group_id=group_row.id
            JOIN public.business_units assigned_unit ON assigned_unit.id=group_assignment.bu_id
              AND assigned_unit.tenant_id=group_assignment.tenant_id AND NOT assigned_unit.is_archived
            JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
              AND owner_unit.tenant_id=group_assignment.tenant_id AND NOT owner_unit.is_archived
            WHERE group_row.id=grant_row.principal_id AND group_row.tenant_id=_tenant_id
              AND (assigned_unit.id=owner_unit.id OR
                   (group_assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
          )))
    )
  ) OR EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) owner(bu_id)
    CROSS JOIN unnest(ARRAY['view','approve']::text[]) needed(action_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_unit ON assigned_unit.id=assignment.bu_id
        AND assigned_unit.tenant_id=assignment.tenant_id AND NOT assigned_unit.is_archived
      JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
        AND owner_unit.tenant_id=assignment.tenant_id AND NOT owner_unit.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=_checker_user_id
        AND (assigned_unit.id=owner_unit.id OR
             (assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
    ) OR NOT EXISTS (
      SELECT 1 FROM public.recon_definition_bu_grants grant_row
      WHERE grant_row.tenant_id=_tenant_id AND grant_row.recon_id=_recon_id
        AND grant_row.bu_id=owner.bu_id AND grant_row.action=needed.action_name
        AND ((grant_row.principal_type='user' AND grant_row.principal_id=_checker_user_id)
          OR (grant_row.principal_type='group' AND EXISTS (
            SELECT 1 FROM public.tenant_groups group_row
            JOIN public.tenant_group_members group_member ON group_member.group_id=group_row.id
              AND group_member.user_id=_checker_user_id
            JOIN public.tenant_members active_member ON active_member.tenant_id=_tenant_id
              AND active_member.user_id=group_member.user_id AND active_member.active
            JOIN public.bu_group_assignments group_assignment ON group_assignment.tenant_id=_tenant_id
              AND group_assignment.group_id=group_row.id
            JOIN public.business_units assigned_unit ON assigned_unit.id=group_assignment.bu_id
              AND assigned_unit.tenant_id=group_assignment.tenant_id AND NOT assigned_unit.is_archived
            JOIN public.business_units owner_unit ON owner_unit.id=owner.bu_id
              AND owner_unit.tenant_id=group_assignment.tenant_id AND NOT owner_unit.is_archived
            WHERE group_row.id=grant_row.principal_id AND group_row.tenant_id=_tenant_id
              AND (assigned_unit.id=owner_unit.id OR
                   (group_assignment.inherit_descendants AND owner_unit.path <@ assigned_unit.path))
          )))
    )
  ) THEN
    RAISE EXCEPTION 'maker/checker assignments and reviewed grants are incomplete' USING ERRCODE='42501';
  END IF;

  INSERT INTO private.recon_legacy_mapping_cutover_receipts(
    tenant_id,recon_id,actor_id,owner_bu_ids,maker_user_id,checker_user_id,reason
  ) VALUES (_tenant_id,_recon_id,v_actor,v_owner_ids,_maker_user_id,_checker_user_id,btrim(_reason))
  RETURNING id INTO v_receipt_id;
  INSERT INTO public.recon_definition_bu_admin_audit(
    tenant_id,recon_id,operation,actor_id,reason,details
  ) VALUES (_tenant_id,_recon_id,'map_legacy',v_actor,btrim(_reason),jsonb_build_object(
    'receipt_id',v_receipt_id,'owner_bu_ids',v_owner_ids,'maker_user_id',_maker_user_id,
    'maker_actions',ARRAY['view','run','edit'],'checker_user_id',_checker_user_id,
    'checker_actions',ARRAY['view','approve'],'previous_access_mode',v_definition.access_mode,
    'previous_governance_state',v_definition.governance_state,'new_access_mode','mapped_exact',
    'new_governance_state','legacy_mapped','status_preserved',v_definition.status,
    'legacy_bu_id_preserved',v_definition.bu_id,'scope','owner_authorized_synthetic_assurance'
  ));
  UPDATE public.recon_definitions
  SET access_mode='mapped_exact', governance_state='legacy_mapped', multi_bu_governed=true
  WHERE id=_recon_id AND tenant_id=_tenant_id
    AND access_mode='legacy_passthrough' AND governance_state='legacy_unreviewed';
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy definition changed during mapping cutover'; END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (v_actor,_tenant_id,'workspace','recon.legacy_mapping.cutover','recon_definition',_recon_id::text,
    jsonb_build_object('receipt_id',v_receipt_id,'recon_code',v_definition.recon_code,
      'owner_bu_ids',v_owner_ids,'maker_user_id',_maker_user_id,'checker_user_id',_checker_user_id,
      'reason',btrim(_reason),'status_preserved',v_definition.status,
      'legacy_bu_id_preserved',v_definition.bu_id,'governance_state','legacy_mapped'));
  RETURN jsonb_build_object('recon_id',_recon_id,'recon_code',v_definition.recon_code,
    'access_mode','mapped_exact','governance_state','legacy_mapped','status',v_definition.status,
    'legacy_bu_id',v_definition.bu_id,'owner_bu_ids',v_owner_ids,'audit_receipt_id',v_receipt_id);
END
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39437::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _recon_id uuid, _owner_bu_ids uuid[], _maker_user_id uuid, _checker_user_id uuid, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: cutover_legacy_recon_definition_mapping';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38725::oid AND n.nspname='public' AND p.proname='decide_collateral_csa_version' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid, _approve boolean, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38725$CREATE OR REPLACE FUNCTION public.decide_collateral_csa_version(_tenant_id uuid, _version_id uuid, _approve boolean, _reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid := auth.uid(); version_row public.collateral_csa_versions%ROWTYPE; other_active public.collateral_csa_versions%ROWTYPE;
BEGIN
  IF NOT public.csa_assurance_actor(_tenant_id,actor) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO version_row FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id FOR UPDATE;
  IF NOT FOUND OR version_row.status<>'pending_approval' THEN RAISE EXCEPTION 'Version is not awaiting approval' USING ERRCODE='22023'; END IF;
  IF actor=version_row.created_by OR actor=version_row.submitted_by THEN RAISE EXCEPTION 'Maker and checker must be different users' USING ERRCODE='42501'; END IF;
  IF _approve THEN
    PERFORM 1 FROM public.collateral_csa_agreements WHERE tenant_id=_tenant_id AND id=version_row.agreement_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.collateral_csa_versions v WHERE v.tenant_id=_tenant_id AND v.agreement_id=version_row.agreement_id
      AND v.status IN ('active','superseded') AND daterange(v.effective_from,v.effective_to,'[]')
        && daterange(version_row.effective_from,version_row.effective_to,'[]')) THEN
      RAISE EXCEPTION 'Effective period overlaps the current active agreement version' USING ERRCODE='22023';
    END IF;
    SELECT * INTO other_active FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND agreement_id=version_row.agreement_id AND id<>_version_id AND status='active';
    IF FOUND THEN UPDATE public.collateral_csa_versions SET status='superseded' WHERE id=other_active.id; END IF;
    UPDATE public.collateral_csa_versions SET status='active',approved_by=actor,approved_at=now() WHERE id=_version_id;
  ELSE
    UPDATE public.collateral_csa_versions SET status='rejected' WHERE id=_version_id;
  END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant',CASE WHEN _approve THEN 'collateral.csa.version.activate' ELSE 'collateral.csa.version.reject' END,
    'collateral_csa_version',_version_id::text,jsonb_build_object('version_no',version_row.version_no,'reason',left(coalesce(_reason,''),1000)));
  RETURN CASE WHEN _approve THEN 'active' ELSE 'rejected' END;
END $function$
$old38725$) THEN RAISE EXCEPTION 'Qualified current native routine changed: decide_collateral_csa_version';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.decide_collateral_csa_version(_tenant_id uuid, _version_id uuid, _approve boolean, _reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid := auth.uid(); version_row public.collateral_csa_versions%ROWTYPE; other_active public.collateral_csa_versions%ROWTYPE;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'collateral');

  IF NOT public.csa_assurance_actor(_tenant_id,actor) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO version_row FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id FOR UPDATE;
  IF NOT FOUND OR version_row.status<>'pending_approval' THEN RAISE EXCEPTION 'Version is not awaiting approval' USING ERRCODE='22023'; END IF;
  IF actor=version_row.created_by OR actor=version_row.submitted_by THEN RAISE EXCEPTION 'Maker and checker must be different users' USING ERRCODE='42501'; END IF;
  IF _approve THEN
    PERFORM 1 FROM public.collateral_csa_agreements WHERE tenant_id=_tenant_id AND id=version_row.agreement_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.collateral_csa_versions v WHERE v.tenant_id=_tenant_id AND v.agreement_id=version_row.agreement_id
      AND v.status IN ('active','superseded') AND daterange(v.effective_from,v.effective_to,'[]')
        && daterange(version_row.effective_from,version_row.effective_to,'[]')) THEN
      RAISE EXCEPTION 'Effective period overlaps the current active agreement version' USING ERRCODE='22023';
    END IF;
    SELECT * INTO other_active FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND agreement_id=version_row.agreement_id AND id<>_version_id AND status='active';
    IF FOUND THEN UPDATE public.collateral_csa_versions SET status='superseded' WHERE id=other_active.id; END IF;
    UPDATE public.collateral_csa_versions SET status='active',approved_by=actor,approved_at=now() WHERE id=_version_id;
  ELSE
    UPDATE public.collateral_csa_versions SET status='rejected' WHERE id=_version_id;
  END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant',CASE WHEN _approve THEN 'collateral.csa.version.activate' ELSE 'collateral.csa.version.reject' END,
    'collateral_csa_version',_version_id::text,jsonb_build_object('version_no',version_row.version_no,'reason',left(coalesce(_reason,''),1000)));
  RETURN CASE WHEN _approve THEN 'active' ELSE 'rejected' END;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38725::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid, _approve boolean, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: decide_collateral_csa_version';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=33999::oid AND n.nspname='public' AND p.proname='decide_reference_data_version' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid, _approve boolean, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old33999$CREATE OR REPLACE FUNCTION public.decide_reference_data_version(_tenant_id uuid, _version_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
$old33999$) THEN RAISE EXCEPTION 'Qualified current native routine changed: decide_reference_data_version';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.decide_reference_data_version(_tenant_id uuid, _version_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  actor uuid := auth.uid();
  v_version public.reference_data_versions%ROWTYPE;
  v_prior public.reference_data_versions%ROWTYPE;
  v_is_effective_now boolean;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

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
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=33999::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid, _approve boolean, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: decide_reference_data_version';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38768::oid AND n.nspname='public' AND p.proname='get_collateral_csa_access_editor' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _agreement_id uuid' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38768$CREATE OR REPLACE FUNCTION public.get_collateral_csa_access_editor(_tenant_id uuid, _agreement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE v_registry uuid; v_owners uuid[]; v_groups uuid[];
BEGIN
  IF auth.uid() IS NULL OR _tenant_id IS NULL OR _agreement_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=auth.uid() AND m.active AND m.role='tenant_admin'::public.tenant_role)
    OR NOT EXISTS(SELECT 1 FROM public.collateral_csa_agreements a
      WHERE a.id=_agreement_id AND a.tenant_id=_tenant_id)
  THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
  SELECT r.id INTO v_registry FROM public.data_resource_registry r
    WHERE r.tenant_id=_tenant_id AND r.resource_type='collateral_csa_agreement'
      AND r.collateral_csa_agreement_id=_agreement_id;
  SELECT coalesce(array_agg(o.bu_id ORDER BY o.bu_id),ARRAY[]::uuid[]) INTO v_owners
    FROM public.data_resource_registry_owner_bu o
    WHERE o.tenant_id=_tenant_id AND o.registry_id=v_registry;
  SELECT coalesce(array_agg(DISTINCT g.principal_group_id ORDER BY g.principal_group_id),ARRAY[]::uuid[])
    INTO v_groups FROM public.data_resource_registry_grants g
    WHERE g.tenant_id=_tenant_id AND g.registry_id=v_registry
      AND g.principal_type='group' AND g.action='view';
  RETURN jsonb_build_object('registered',v_registry IS NOT NULL,
    'owner_bu_ids',v_owners,'group_ids',v_groups,
    'business_units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name)
      ORDER BY b.name,b.id),'[]'::jsonb) FROM public.business_units b
      WHERE b.tenant_id=_tenant_id AND NOT b.is_archived),
    'user_groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name)
      ORDER BY g.name,g.id),'[]'::jsonb) FROM public.tenant_groups g
      WHERE g.tenant_id=_tenant_id));
END $function$
$old38768$) THEN RAISE EXCEPTION 'Qualified current native routine changed: get_collateral_csa_access_editor';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.get_collateral_csa_access_editor(_tenant_id uuid, _agreement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE v_registry uuid; v_owners uuid[]; v_groups uuid[];
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'collateral');

  IF auth.uid() IS NULL OR _tenant_id IS NULL OR _agreement_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=auth.uid() AND m.active AND m.role='tenant_admin'::public.tenant_role)
    OR NOT EXISTS(SELECT 1 FROM public.collateral_csa_agreements a
      WHERE a.id=_agreement_id AND a.tenant_id=_tenant_id)
  THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
  SELECT r.id INTO v_registry FROM public.data_resource_registry r
    WHERE r.tenant_id=_tenant_id AND r.resource_type='collateral_csa_agreement'
      AND r.collateral_csa_agreement_id=_agreement_id;
  SELECT coalesce(array_agg(o.bu_id ORDER BY o.bu_id),ARRAY[]::uuid[]) INTO v_owners
    FROM public.data_resource_registry_owner_bu o
    WHERE o.tenant_id=_tenant_id AND o.registry_id=v_registry;
  SELECT coalesce(array_agg(DISTINCT g.principal_group_id ORDER BY g.principal_group_id),ARRAY[]::uuid[])
    INTO v_groups FROM public.data_resource_registry_grants g
    WHERE g.tenant_id=_tenant_id AND g.registry_id=v_registry
      AND g.principal_type='group' AND g.action='view';
  RETURN jsonb_build_object('registered',v_registry IS NOT NULL,
    'owner_bu_ids',v_owners,'group_ids',v_groups,
    'business_units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name)
      ORDER BY b.name,b.id),'[]'::jsonb) FROM public.business_units b
      WHERE b.tenant_id=_tenant_id AND NOT b.is_archived),
    'user_groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name)
      ORDER BY g.name,g.id),'[]'::jsonb) FROM public.tenant_groups g
      WHERE g.tenant_id=_tenant_id));
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38768::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _agreement_id uuid') THEN RAISE EXCEPTION 'Native identity or authority changed: get_collateral_csa_access_editor';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=37693::oid AND n.nspname='public' AND p.proname='get_recon_list_scope_ids' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _scope text, _bu_id uuid' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old37693$CREATE OR REPLACE FUNCTION public.get_recon_list_scope_ids(_tenant_id uuid, _scope text, _bu_id uuid DEFAULT NULL::uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _scope NOT IN ('all','my')
    OR NOT EXISTS (SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id=_tenant_id AND m.user_id=v_actor AND m.active)
    OR (_bu_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.business_units b
      WHERE b.id=_bu_id AND b.tenant_id=_tenant_id AND NOT b.is_archived))
  THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT coalesce(array_agg(d.id ORDER BY d.id),ARRAY[]::uuid[]) INTO v_ids
  FROM public.recon_definitions d
  WHERE d.tenant_id=_tenant_id
    AND private.user_can_access_recon(v_actor,d.id,'read')
    AND (_bu_id IS NULL OR EXISTS (SELECT 1 FROM public.recon_definition_business_units owner_bu
      WHERE owner_bu.tenant_id=d.tenant_id AND owner_bu.recon_id=d.id AND owner_bu.bu_id=_bu_id))
    AND (_scope='all' OR d.created_by=v_actor
      OR EXISTS (SELECT 1 FROM public.recon_definition_bu_grants grant_row
        WHERE grant_row.tenant_id=d.tenant_id AND grant_row.recon_id=d.id
          AND grant_row.principal_type='user' AND grant_row.principal_id=v_actor AND grant_row.action='view')
      OR EXISTS (SELECT 1 FROM public.recon_definition_bu_grants grant_row
        JOIN public.tenant_groups group_row ON group_row.id=grant_row.principal_id
          AND group_row.tenant_id=grant_row.tenant_id
        JOIN public.tenant_group_members member_row ON member_row.group_id=group_row.id
          AND member_row.user_id=v_actor
        WHERE grant_row.tenant_id=d.tenant_id AND grant_row.recon_id=d.id
          AND grant_row.principal_type='group' AND grant_row.action='view'));
  RETURN v_ids;
END
$function$
$old37693$) THEN RAISE EXCEPTION 'Qualified current native routine changed: get_recon_list_scope_ids';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.get_recon_list_scope_ids(_tenant_id uuid, _scope text, _bu_id uuid DEFAULT NULL::uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_ids uuid[];
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF v_actor IS NULL OR _tenant_id IS NULL OR _scope NOT IN ('all','my')
    OR NOT EXISTS (SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id=_tenant_id AND m.user_id=v_actor AND m.active)
    OR (_bu_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.business_units b
      WHERE b.id=_bu_id AND b.tenant_id=_tenant_id AND NOT b.is_archived))
  THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT coalesce(array_agg(d.id ORDER BY d.id),ARRAY[]::uuid[]) INTO v_ids
  FROM public.recon_definitions d
  WHERE d.tenant_id=_tenant_id
    AND private.user_can_access_recon(v_actor,d.id,'read')
    AND (_bu_id IS NULL OR EXISTS (SELECT 1 FROM public.recon_definition_business_units owner_bu
      WHERE owner_bu.tenant_id=d.tenant_id AND owner_bu.recon_id=d.id AND owner_bu.bu_id=_bu_id))
    AND (_scope='all' OR d.created_by=v_actor
      OR EXISTS (SELECT 1 FROM public.recon_definition_bu_grants grant_row
        WHERE grant_row.tenant_id=d.tenant_id AND grant_row.recon_id=d.id
          AND grant_row.principal_type='user' AND grant_row.principal_id=v_actor AND grant_row.action='view')
      OR EXISTS (SELECT 1 FROM public.recon_definition_bu_grants grant_row
        JOIN public.tenant_groups group_row ON group_row.id=grant_row.principal_id
          AND group_row.tenant_id=grant_row.tenant_id
        JOIN public.tenant_group_members member_row ON member_row.group_id=group_row.id
          AND member_row.user_id=v_actor
        WHERE grant_row.tenant_id=d.tenant_id AND grant_row.recon_id=d.id
          AND grant_row.principal_type='group' AND grant_row.action='view'));
  RETURN v_ids;
END
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=37693::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _scope text, _bu_id uuid') THEN RAISE EXCEPTION 'Native identity or authority changed: get_recon_list_scope_ids';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=42173::oid AND n.nspname='public' AND p.proname='get_reference_table_view_summary' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_ids uuid[]' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old42173$CREATE OR REPLACE FUNCTION public.get_reference_table_view_summary(_tenant_id uuid, _table_ids uuid[])
 RETURNS TABLE(resource_type text, resource_id uuid, public_id text, access_state text, business_unit_names text[], business_unit_count integer, user_group_names text[], user_group_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_role text; v_ids uuid[]; v_id uuid;
  v_root public.reference_data_tables%ROWTYPE; v_registry uuid;
  v_owners text[]; v_groups text[]; v_has_owners boolean;
BEGIN
  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role', true) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Reference metadata requires an authenticated caller' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR _table_ids IS NULL OR cardinality(_table_ids) NOT BETWEEN 1 AND 100
    OR array_ndims(_table_ids) <> 1 OR array_position(_table_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Reference metadata requires a tenant and 1 to 100 table IDs' USING ERRCODE = '22023';
  END IF;
  SELECT tm.role::text INTO v_role FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = v_actor AND tm.active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Reference metadata is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(_table_ids) AS x;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_root FROM public.reference_data_tables r WHERE r.id = v_id AND r.tenant_id = _tenant_id;
    IF NOT FOUND OR public.reference_scope_allows(v_id, 'view') IS NOT TRUE THEN CONTINUE; END IF;
    v_registry := NULL; v_owners := ARRAY[]::text[]; v_groups := ARRAY[]::text[];
    SELECT r.id INTO v_registry FROM public.data_resource_registry r
      WHERE r.tenant_id = _tenant_id AND r.resource_type = 'reference_table' AND r.reference_table_id = v_id;
    SELECT EXISTS (SELECT 1 FROM public.data_resource_registry_owner_bu o
      WHERE o.tenant_id = _tenant_id AND o.registry_id = v_registry) INTO v_has_owners;
    IF v_role = 'tenant_admin' OR v_root.access_mode = 'legacy_passthrough' THEN
      -- Legacy root read is an existing active-member contract. Return only
      -- declared metadata for that root; it does not grant BU/group admin access.
      SELECT coalesce(array_agg(DISTINCT b.name ORDER BY b.name), ARRAY[]::text[]) INTO v_owners
        FROM public.data_resource_registry_owner_bu o JOIN public.business_units b
          ON b.id = o.bu_id AND b.tenant_id = o.tenant_id AND NOT b.is_archived
        WHERE o.tenant_id = _tenant_id AND o.registry_id = v_registry;
      SELECT coalesce(array_agg(DISTINCT g.name ORDER BY g.name), ARRAY[]::text[]) INTO v_groups
        FROM public.data_resource_registry_grants x JOIN public.tenant_groups g
          ON g.id = x.principal_group_id AND g.tenant_id = x.tenant_id
        JOIN public.data_resource_registry_owner_bu o
          ON o.tenant_id = x.tenant_id AND o.registry_id = x.registry_id AND o.bu_id = x.bu_id
        JOIN public.business_units b ON b.id = o.bu_id AND b.tenant_id = o.tenant_id AND NOT b.is_archived
        WHERE x.tenant_id = _tenant_id AND x.registry_id = v_registry AND x.principal_type = 'group'
          AND (v_role = 'tenant_admin' OR x.action = 'view');
    ELSE
      -- Mapped ordinary readers see only qualifying current view paths. Keep
      -- the captured direct/group/inherited-BU predicate, including active BUs.
      WITH qualifying AS (
        SELECT g.bu_id, g.principal_type, g.principal_group_id
        FROM public.data_resource_registry_grants g
        JOIN public.data_resource_registry_owner_bu o
          ON o.tenant_id = g.tenant_id AND o.registry_id = g.registry_id AND o.bu_id = g.bu_id
        JOIN public.business_units target ON target.id = o.bu_id AND target.tenant_id = o.tenant_id AND NOT target.is_archived
        WHERE g.tenant_id = _tenant_id AND g.registry_id = v_registry AND g.action = 'view' AND (
          (g.principal_type = 'user' AND g.principal_user_id = v_actor AND EXISTS (
            SELECT 1 FROM public.bu_user_assignments ua JOIN public.business_units assigned
              ON assigned.id = ua.bu_id AND assigned.tenant_id = ua.tenant_id AND NOT assigned.is_archived
            WHERE ua.tenant_id = _tenant_id AND ua.user_id = v_actor
              AND (assigned.id = target.id OR (ua.inherit_descendants AND target.path <@ assigned.path))))
          OR (g.principal_type = 'group' AND EXISTS (
            SELECT 1 FROM public.tenant_group_members gm JOIN public.tenant_groups tg
              ON tg.id = gm.group_id AND tg.tenant_id = _tenant_id
            WHERE gm.group_id = g.principal_group_id AND gm.user_id = v_actor)
            AND EXISTS (SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned
              ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
              WHERE ga.tenant_id = _tenant_id AND ga.group_id = g.principal_group_id
                AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path))))
        )
      ) SELECT
        coalesce((SELECT array_agg(DISTINCT b.name ORDER BY b.name) FROM qualifying q JOIN public.business_units b
          ON b.id = q.bu_id AND b.tenant_id = _tenant_id), ARRAY[]::text[]),
        coalesce((SELECT array_agg(DISTINCT g.name ORDER BY g.name) FROM qualifying q JOIN public.tenant_groups g
          ON g.id = q.principal_group_id AND g.tenant_id = _tenant_id WHERE q.principal_type = 'group'), ARRAY[]::text[])
        INTO v_owners, v_groups;
    END IF;
    resource_type := 'reference_table'; resource_id := v_id; public_id := v_root.public_id;
    access_state := CASE WHEN v_has_owners THEN 'mapped' ELSE 'unmapped' END;
    business_unit_names := v_owners; business_unit_count := cardinality(v_owners);
    user_group_names := v_groups; user_group_count := cardinality(v_groups);
    RETURN NEXT;
  END LOOP;
END $function$
$old42173$) THEN RAISE EXCEPTION 'Qualified current native routine changed: get_reference_table_view_summary';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.get_reference_table_view_summary(_tenant_id uuid, _table_ids uuid[])
 RETURNS TABLE(resource_type text, resource_id uuid, public_id text, access_state text, business_unit_names text[], business_unit_count integer, user_group_names text[], user_group_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_role text; v_ids uuid[]; v_id uuid;
  v_root public.reference_data_tables%ROWTYPE; v_registry uuid;
  v_owners text[]; v_groups text[]; v_has_owners boolean;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role', true) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Reference metadata requires an authenticated caller' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR _table_ids IS NULL OR cardinality(_table_ids) NOT BETWEEN 1 AND 100
    OR array_ndims(_table_ids) <> 1 OR array_position(_table_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Reference metadata requires a tenant and 1 to 100 table IDs' USING ERRCODE = '22023';
  END IF;
  SELECT tm.role::text INTO v_role FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = v_actor AND tm.active;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Reference metadata is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(_table_ids) AS x;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_root FROM public.reference_data_tables r WHERE r.id = v_id AND r.tenant_id = _tenant_id;
    IF NOT FOUND OR public.reference_scope_allows(v_id, 'view') IS NOT TRUE THEN CONTINUE; END IF;
    v_registry := NULL; v_owners := ARRAY[]::text[]; v_groups := ARRAY[]::text[];
    SELECT r.id INTO v_registry FROM public.data_resource_registry r
      WHERE r.tenant_id = _tenant_id AND r.resource_type = 'reference_table' AND r.reference_table_id = v_id;
    SELECT EXISTS (SELECT 1 FROM public.data_resource_registry_owner_bu o
      WHERE o.tenant_id = _tenant_id AND o.registry_id = v_registry) INTO v_has_owners;
    IF v_role = 'tenant_admin' OR v_root.access_mode = 'legacy_passthrough' THEN
      -- Legacy root read is an existing active-member contract. Return only
      -- declared metadata for that root; it does not grant BU/group admin access.
      SELECT coalesce(array_agg(DISTINCT b.name ORDER BY b.name), ARRAY[]::text[]) INTO v_owners
        FROM public.data_resource_registry_owner_bu o JOIN public.business_units b
          ON b.id = o.bu_id AND b.tenant_id = o.tenant_id AND NOT b.is_archived
        WHERE o.tenant_id = _tenant_id AND o.registry_id = v_registry;
      SELECT coalesce(array_agg(DISTINCT g.name ORDER BY g.name), ARRAY[]::text[]) INTO v_groups
        FROM public.data_resource_registry_grants x JOIN public.tenant_groups g
          ON g.id = x.principal_group_id AND g.tenant_id = x.tenant_id
        JOIN public.data_resource_registry_owner_bu o
          ON o.tenant_id = x.tenant_id AND o.registry_id = x.registry_id AND o.bu_id = x.bu_id
        JOIN public.business_units b ON b.id = o.bu_id AND b.tenant_id = o.tenant_id AND NOT b.is_archived
        WHERE x.tenant_id = _tenant_id AND x.registry_id = v_registry AND x.principal_type = 'group'
          AND (v_role = 'tenant_admin' OR x.action = 'view');
    ELSE
      -- Mapped ordinary readers see only qualifying current view paths. Keep
      -- the captured direct/group/inherited-BU predicate, including active BUs.
      WITH qualifying AS (
        SELECT g.bu_id, g.principal_type, g.principal_group_id
        FROM public.data_resource_registry_grants g
        JOIN public.data_resource_registry_owner_bu o
          ON o.tenant_id = g.tenant_id AND o.registry_id = g.registry_id AND o.bu_id = g.bu_id
        JOIN public.business_units target ON target.id = o.bu_id AND target.tenant_id = o.tenant_id AND NOT target.is_archived
        WHERE g.tenant_id = _tenant_id AND g.registry_id = v_registry AND g.action = 'view' AND (
          (g.principal_type = 'user' AND g.principal_user_id = v_actor AND EXISTS (
            SELECT 1 FROM public.bu_user_assignments ua JOIN public.business_units assigned
              ON assigned.id = ua.bu_id AND assigned.tenant_id = ua.tenant_id AND NOT assigned.is_archived
            WHERE ua.tenant_id = _tenant_id AND ua.user_id = v_actor
              AND (assigned.id = target.id OR (ua.inherit_descendants AND target.path <@ assigned.path))))
          OR (g.principal_type = 'group' AND EXISTS (
            SELECT 1 FROM public.tenant_group_members gm JOIN public.tenant_groups tg
              ON tg.id = gm.group_id AND tg.tenant_id = _tenant_id
            WHERE gm.group_id = g.principal_group_id AND gm.user_id = v_actor)
            AND EXISTS (SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned
              ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
              WHERE ga.tenant_id = _tenant_id AND ga.group_id = g.principal_group_id
                AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path))))
        )
      ) SELECT
        coalesce((SELECT array_agg(DISTINCT b.name ORDER BY b.name) FROM qualifying q JOIN public.business_units b
          ON b.id = q.bu_id AND b.tenant_id = _tenant_id), ARRAY[]::text[]),
        coalesce((SELECT array_agg(DISTINCT g.name ORDER BY g.name) FROM qualifying q JOIN public.tenant_groups g
          ON g.id = q.principal_group_id AND g.tenant_id = _tenant_id WHERE q.principal_type = 'group'), ARRAY[]::text[])
        INTO v_owners, v_groups;
    END IF;
    resource_type := 'reference_table'; resource_id := v_id; public_id := v_root.public_id;
    access_state := CASE WHEN v_has_owners THEN 'mapped' ELSE 'unmapped' END;
    business_unit_names := v_owners; business_unit_count := cardinality(v_owners);
    user_group_names := v_groups; user_group_count := cardinality(v_groups);
    RETURN NEXT;
  END LOOP;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=42173::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_ids uuid[]') THEN RAISE EXCEPTION 'Native identity or authority changed: get_reference_table_view_summary';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39412::oid AND n.nspname='public' AND p.proname='import_recon_definitions_with_owners' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _definitions jsonb, _owner_bu_ids uuid[], _mode text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old39412$CREATE OR REPLACE FUNCTION public.import_recon_definitions_with_owners(_tenant_id uuid, _definitions jsonb, _owner_bu_ids uuid[], _mode text DEFAULT 'skip'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_owner_ids uuid[];
  v_existing_owner_ids uuid[];
  v_item jsonb;
  v_name text;
  v_description text;
  v_recon_type text;
  v_sides jsonb;
  v_rules jsonb;
  v_side_count integer;
  v_source_count integer;
  v_distinct_source_count integer;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_state text;
  v_existing_access text;
  v_existing_environment text;
  v_existing_multi_bu boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_created record;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _mode IS NULL OR _mode NOT IN ('skip','overwrite')
     OR jsonb_typeof(_definitions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_definitions) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid reconciliation import request' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id=_tenant_id AND member_row.user_id=v_actor
      AND member_row.active AND member_row.role::text='tenant_admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin AND NOT private.recon_governance_is_active_analyst(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator or analyst required' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id),ARRAY[]::uuid[])
  INTO v_owner_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_owner_ids)=0 OR cardinality(v_owner_ids)<>cardinality(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'choose one or more distinct owning business units' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
    LEFT JOIN public.business_units bu ON bu.id=requested.bu_id AND bu.tenant_id=_tenant_id
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'owning business units must be active and belong to this tenant' USING ERRCODE='42501';
  END IF;
  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_bu
        ON assigned_bu.id=assignment.bu_id AND assigned_bu.tenant_id=assignment.tenant_id
        AND NOT assigned_bu.is_archived
      JOIN public.business_units owner_bu
        ON owner_bu.id=requested.bu_id AND owner_bu.tenant_id=assignment.tenant_id
        AND NOT owner_bu.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=v_actor
        AND (owner_bu.id=assigned_bu.id OR (assignment.inherit_descendants AND owner_bu.path <@ assigned_bu.path))
    )
  ) THEN
    RAISE EXCEPTION 'analyst must be assigned to every selected owning business unit' USING ERRCODE='42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_definitions) item
    GROUP BY lower(btrim(coalesce(item->>'name','')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'import file contains duplicate definition names' USING ERRCODE='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_definitions) AS items(value)
  LOOP
    v_name := btrim(coalesce(v_item->>'name',''));
    v_description := nullif(btrim(coalesce(v_item->>'description','')),'');
    v_recon_type := v_item->>'recon_type';
    v_sides := v_item->'sides';
    v_rules := v_item->'rules';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
       OR (v_item ? 'description' AND jsonb_typeof(v_item->'description') NOT IN ('string','null'))
       OR length(v_name) NOT BETWEEN 1 AND 120
       OR length(coalesce(v_description,'')) > 2000
       OR v_recon_type IS NULL OR v_recon_type NOT IN ('one_sided','two_sided','three_sided')
       OR jsonb_typeof(v_sides) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_rules) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_sides) > 3
       OR jsonb_array_length(v_rules) > 100
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_sides) side WHERE jsonb_typeof(side) IS DISTINCT FROM 'object')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) rule WHERE jsonb_typeof(rule) IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'an imported definition has invalid fields' USING ERRCODE='22023';
    END IF;
    v_side_count := jsonb_array_length(v_sides);
    IF v_side_count <> (CASE v_recon_type WHEN 'one_sided' THEN 1 WHEN 'two_sided' THEN 2 ELSE 3 END)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_sides) side
         WHERE coalesce(side->>'data_source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) THEN
      RAISE EXCEPTION 'an imported definition has incomplete source bindings' USING ERRCODE='22023';
    END IF;
    SELECT count(*) INTO v_distinct_source_count
    FROM (
      SELECT DISTINCT (side->>'data_source_id')::uuid AS id
      FROM jsonb_array_elements(v_sides) side
    ) imported_ids;
    SELECT count(DISTINCT source_row.id) INTO v_source_count
    FROM public.workspace_data_sources source_row
    JOIN (
      SELECT DISTINCT (side->>'data_source_id')::uuid AS id
      FROM jsonb_array_elements(v_sides) side
    ) imported_source ON imported_source.id=source_row.id
    WHERE source_row.tenant_id=_tenant_id;
    IF v_source_count <> v_distinct_source_count THEN
      RAISE EXCEPTION 'every imported source must belong to this tenant' USING ERRCODE='42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_sides) side
      WHERE nullif(side->>'upload_id','') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.workspace_data_source_uploads upload_row
          WHERE upload_row.id=(side->>'upload_id')::uuid AND upload_row.tenant_id=_tenant_id
            AND upload_row.data_source_id=(side->>'data_source_id')::uuid
        )
    ) THEN
      RAISE EXCEPTION 'every imported upload must belong to its same-tenant source' USING ERRCODE='42501';
    END IF;

    SELECT definition_row.id, definition_row.status, definition_row.governance_state,
           definition_row.access_mode, definition_row.environment, definition_row.multi_bu_governed
    INTO v_existing_id, v_existing_status, v_existing_state, v_existing_access,
         v_existing_environment, v_existing_multi_bu
    FROM public.recon_definitions definition_row
    WHERE definition_row.tenant_id=_tenant_id AND lower(definition_row.name)=lower(v_name)
    ORDER BY definition_row.created_at, definition_row.id
    LIMIT 1 FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      IF _mode='skip' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF v_existing_status IS DISTINCT FROM 'draft'
         OR v_existing_state IS DISTINCT FROM 'development_draft'
         OR v_existing_access IS DISTINCT FROM 'mapped_exact'
         OR v_existing_environment IS DISTINCT FROM 'development'
         OR v_existing_multi_bu IS DISTINCT FROM true
         OR NOT private.recon_authoritative_access_decision(v_existing_id,'read')
         OR NOT private.recon_authoritative_access_decision(v_existing_id,'edit') THEN
        RAISE EXCEPTION 'only an editable development draft can be overwritten; the batch was not applied' USING ERRCODE='42501';
      END IF;
      SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
      INTO v_existing_owner_ids
      FROM public.recon_definition_business_units owner_row
      WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=v_existing_id;
      IF v_existing_owner_ids IS DISTINCT FROM v_owner_ids THEN
        RAISE EXCEPTION 'overwrite owner units must match the existing definition exactly' USING ERRCODE='42501';
      END IF;
      UPDATE public.recon_definitions
      SET description=v_description, recon_type=v_recon_type, sides=v_sides, rules=v_rules
      WHERE id=v_existing_id AND tenant_id=_tenant_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'an imported definition could not be updated'; END IF;
      INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
      VALUES (v_actor,_tenant_id,'workspace','recon.bulk_import.overwrite','recon_definition',v_existing_id::text,
        jsonb_build_object('name',v_name,'owner_bu_ids',v_owner_ids,'mode',_mode));
      v_updated := v_updated + 1;
    ELSE
      SELECT * INTO v_created
      FROM public.create_recon_definition_with_owners(
        _tenant_id,v_name,v_description,v_recon_type,v_sides,v_rules,v_owner_ids
      );
      IF v_created.id IS NULL THEN RAISE EXCEPTION 'an imported definition was not created'; END IF;
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,context)
  VALUES (v_actor,_tenant_id,'workspace','recon.bulk_import','recon_definitions',
    jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skipped',v_skipped,'mode',_mode,
      'owner_bu_ids',v_owner_ids,'definition_count',jsonb_array_length(_definitions)));
  RETURN jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skipped',v_skipped);
END
$function$
$old39412$) THEN RAISE EXCEPTION 'Qualified current native routine changed: import_recon_definitions_with_owners';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.import_recon_definitions_with_owners(_tenant_id uuid, _definitions jsonb, _owner_bu_ids uuid[], _mode text DEFAULT 'skip'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_owner_ids uuid[];
  v_existing_owner_ids uuid[];
  v_item jsonb;
  v_name text;
  v_description text;
  v_recon_type text;
  v_sides jsonb;
  v_rules jsonb;
  v_side_count integer;
  v_source_count integer;
  v_distinct_source_count integer;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_state text;
  v_existing_access text;
  v_existing_environment text;
  v_existing_multi_bu boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_created record;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF v_actor IS NULL OR _tenant_id IS NULL OR _mode IS NULL OR _mode NOT IN ('skip','overwrite')
     OR jsonb_typeof(_definitions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_definitions) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid reconciliation import request' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members member_row
    WHERE member_row.tenant_id=_tenant_id AND member_row.user_id=v_actor
      AND member_row.active AND member_row.role::text='tenant_admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin AND NOT private.recon_governance_is_active_analyst(_tenant_id,v_actor) THEN
    RAISE EXCEPTION 'active tenant administrator or analyst required' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT bu_id ORDER BY bu_id),ARRAY[]::uuid[])
  INTO v_owner_ids FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) AS bu_id;
  IF cardinality(v_owner_ids)=0 OR cardinality(v_owner_ids)<>cardinality(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'choose one or more distinct owning business units' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
    LEFT JOIN public.business_units bu ON bu.id=requested.bu_id AND bu.tenant_id=_tenant_id
    WHERE bu.id IS NULL OR bu.is_archived
  ) THEN
    RAISE EXCEPTION 'owning business units must be active and belong to this tenant' USING ERRCODE='42501';
  END IF;
  IF NOT v_is_admin AND EXISTS (
    SELECT 1 FROM unnest(v_owner_ids) requested(bu_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bu_user_assignments assignment
      JOIN public.business_units assigned_bu
        ON assigned_bu.id=assignment.bu_id AND assigned_bu.tenant_id=assignment.tenant_id
        AND NOT assigned_bu.is_archived
      JOIN public.business_units owner_bu
        ON owner_bu.id=requested.bu_id AND owner_bu.tenant_id=assignment.tenant_id
        AND NOT owner_bu.is_archived
      WHERE assignment.tenant_id=_tenant_id AND assignment.user_id=v_actor
        AND (owner_bu.id=assigned_bu.id OR (assignment.inherit_descendants AND owner_bu.path <@ assigned_bu.path))
    )
  ) THEN
    RAISE EXCEPTION 'analyst must be assigned to every selected owning business unit' USING ERRCODE='42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_definitions) item
    GROUP BY lower(btrim(coalesce(item->>'name','')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'import file contains duplicate definition names' USING ERRCODE='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_definitions) AS items(value)
  LOOP
    v_name := btrim(coalesce(v_item->>'name',''));
    v_description := nullif(btrim(coalesce(v_item->>'description','')),'');
    v_recon_type := v_item->>'recon_type';
    v_sides := v_item->'sides';
    v_rules := v_item->'rules';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
       OR (v_item ? 'description' AND jsonb_typeof(v_item->'description') NOT IN ('string','null'))
       OR length(v_name) NOT BETWEEN 1 AND 120
       OR length(coalesce(v_description,'')) > 2000
       OR v_recon_type IS NULL OR v_recon_type NOT IN ('one_sided','two_sided','three_sided')
       OR jsonb_typeof(v_sides) IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_rules) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_sides) > 3
       OR jsonb_array_length(v_rules) > 100
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_sides) side WHERE jsonb_typeof(side) IS DISTINCT FROM 'object')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_rules) rule WHERE jsonb_typeof(rule) IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'an imported definition has invalid fields' USING ERRCODE='22023';
    END IF;
    v_side_count := jsonb_array_length(v_sides);
    IF v_side_count <> (CASE v_recon_type WHEN 'one_sided' THEN 1 WHEN 'two_sided' THEN 2 ELSE 3 END)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_sides) side
         WHERE coalesce(side->>'data_source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) THEN
      RAISE EXCEPTION 'an imported definition has incomplete source bindings' USING ERRCODE='22023';
    END IF;
    SELECT count(*) INTO v_distinct_source_count
    FROM (
      SELECT DISTINCT (side->>'data_source_id')::uuid AS id
      FROM jsonb_array_elements(v_sides) side
    ) imported_ids;
    SELECT count(DISTINCT source_row.id) INTO v_source_count
    FROM public.workspace_data_sources source_row
    JOIN (
      SELECT DISTINCT (side->>'data_source_id')::uuid AS id
      FROM jsonb_array_elements(v_sides) side
    ) imported_source ON imported_source.id=source_row.id
    WHERE source_row.tenant_id=_tenant_id;
    IF v_source_count <> v_distinct_source_count THEN
      RAISE EXCEPTION 'every imported source must belong to this tenant' USING ERRCODE='42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_sides) side
      WHERE nullif(side->>'upload_id','') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.workspace_data_source_uploads upload_row
          WHERE upload_row.id=(side->>'upload_id')::uuid AND upload_row.tenant_id=_tenant_id
            AND upload_row.data_source_id=(side->>'data_source_id')::uuid
        )
    ) THEN
      RAISE EXCEPTION 'every imported upload must belong to its same-tenant source' USING ERRCODE='42501';
    END IF;

    SELECT definition_row.id, definition_row.status, definition_row.governance_state,
           definition_row.access_mode, definition_row.environment, definition_row.multi_bu_governed
    INTO v_existing_id, v_existing_status, v_existing_state, v_existing_access,
         v_existing_environment, v_existing_multi_bu
    FROM public.recon_definitions definition_row
    WHERE definition_row.tenant_id=_tenant_id AND lower(definition_row.name)=lower(v_name)
    ORDER BY definition_row.created_at, definition_row.id
    LIMIT 1 FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      IF _mode='skip' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF v_existing_status IS DISTINCT FROM 'draft'
         OR v_existing_state IS DISTINCT FROM 'development_draft'
         OR v_existing_access IS DISTINCT FROM 'mapped_exact'
         OR v_existing_environment IS DISTINCT FROM 'development'
         OR v_existing_multi_bu IS DISTINCT FROM true
         OR NOT private.recon_authoritative_access_decision(v_existing_id,'read')
         OR NOT private.recon_authoritative_access_decision(v_existing_id,'edit') THEN
        RAISE EXCEPTION 'only an editable development draft can be overwritten; the batch was not applied' USING ERRCODE='42501';
      END IF;
      SELECT coalesce(array_agg(owner_row.bu_id ORDER BY owner_row.bu_id),ARRAY[]::uuid[])
      INTO v_existing_owner_ids
      FROM public.recon_definition_business_units owner_row
      WHERE owner_row.tenant_id=_tenant_id AND owner_row.recon_id=v_existing_id;
      IF v_existing_owner_ids IS DISTINCT FROM v_owner_ids THEN
        RAISE EXCEPTION 'overwrite owner units must match the existing definition exactly' USING ERRCODE='42501';
      END IF;
      UPDATE public.recon_definitions
      SET description=v_description, recon_type=v_recon_type, sides=v_sides, rules=v_rules
      WHERE id=v_existing_id AND tenant_id=_tenant_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'an imported definition could not be updated'; END IF;
      INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
      VALUES (v_actor,_tenant_id,'workspace','recon.bulk_import.overwrite','recon_definition',v_existing_id::text,
        jsonb_build_object('name',v_name,'owner_bu_ids',v_owner_ids,'mode',_mode));
      v_updated := v_updated + 1;
    ELSE
      SELECT * INTO v_created
      FROM public.create_recon_definition_with_owners(
        _tenant_id,v_name,v_description,v_recon_type,v_sides,v_rules,v_owner_ids
      );
      IF v_created.id IS NULL THEN RAISE EXCEPTION 'an imported definition was not created'; END IF;
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,context)
  VALUES (v_actor,_tenant_id,'workspace','recon.bulk_import','recon_definitions',
    jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skipped',v_skipped,'mode',_mode,
      'owner_bu_ids',v_owner_ids,'definition_count',jsonb_array_length(_definitions)));
  RETURN jsonb_build_object('inserted',v_inserted,'updated',v_updated,'skipped',v_skipped);
END
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39412::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _definitions jsonb, _owner_bu_ids uuid[], _mode text') THEN RAISE EXCEPTION 'Native identity or authority changed: import_recon_definitions_with_owners';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=34440::oid AND n.nspname='public' AND p.proname='install_recon_starter_template_atomic' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old34440$CREATE OR REPLACE FUNCTION public.install_recon_starter_template_atomic(_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb)
 RETURNS TABLE(recon_definition_id uuid, recon_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  template_row public.recon_definition_templates%ROWTYPE;
  new_definition public.recon_definitions%ROWTYPE;
  leg_count integer;
  valid_source_count integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.is_platform_admin(actor)
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_name,''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid reconciliation name' USING ERRCODE='22023';
  END IF;

  SELECT * INTO template_row
  FROM public.recon_definition_templates
  WHERE id = _template_id AND status = 'published'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published template not found' USING ERRCODE='P0002'; END IF;

  leg_count := jsonb_array_length(template_row.legs);
  IF jsonb_typeof(_sides) <> 'array' OR jsonb_array_length(_sides) <> leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'every template leg requires one source binding' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) < 1 OR jsonb_array_length(_rules) > 50 THEN
    RAISE EXCEPTION 'compiled template rules are invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_sides) side
    WHERE COALESCE(side->>'side_id','') NOT IN ('A','B','C')
      OR NULLIF(side->>'data_source_id','') IS NULL
  ) OR (
    SELECT count(DISTINCT side->>'side_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count OR (
    SELECT count(DISTINCT side->>'data_source_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count THEN
    RAISE EXCEPTION 'template side bindings are invalid or duplicated' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO valid_source_count
  FROM jsonb_array_elements(_sides) side
  JOIN public.workspace_data_sources source
    ON source.id = (side->>'data_source_id')::uuid
   AND source.tenant_id = _tenant_id;
  IF valid_source_count <> leg_count THEN
    RAISE EXCEPTION 'template source does not belong to tenant' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rules) rule
    WHERE COALESCE(rule->>'kind','') NOT IN (
      'exact_match','case_insensitive_match','trimmed_match','numeric_equals',
      'numeric_tolerance_abs','numeric_tolerance_pct','amount_sign_flip','date_equals',
      'date_tolerance_days','date_within_range','date_age_days','string_contains','string_starts_with',
      'string_ends_with','regex_match','fuzzy_levenshtein','phonetic_soundex',
      'currency_equals','boolean_equals','non_null','unique','in_set','sum_to_match',
      'many_to_one_sum','one_to_many_sum','value_range','multiply','ignore_day_portion',
      'conditional_set','roll_up','reference_lookup','multi_pass','quick_fix'
    ) OR jsonb_typeof(rule->'fields') <> 'object'
  ) THEN
    RAISE EXCEPTION 'template compiled an unsupported rule' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.recon_definitions(
    tenant_id,name,description,recon_type,sides,rules,status,created_by,
    starter_template_id,starter_template_code,starter_template_snapshot
  ) VALUES (
    _tenant_id,btrim(_name),template_row.summary,
    CASE leg_count WHEN 1 THEN 'one_sided' WHEN 2 THEN 'two_sided' ELSE 'three_sided' END,
    _sides,_rules,'draft',actor,template_row.id,template_row.code,
    jsonb_build_object(
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'legs',template_row.legs,'keys',template_row.keys,'rules',template_row.rules,
      'tolerances',template_row.tolerances,'sample_fields',template_row.sample_fields,
      'installed_at',now()
    )
  ) RETURNING * INTO new_definition;

  UPDATE public.recon_definition_templates
  SET install_count = install_count + 1
  WHERE id = template_row.id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.template.install','recon_definition',new_definition.id,
    jsonb_build_object(
      'recon_code',new_definition.recon_code,'template_id',template_row.id,
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'source_ids',(SELECT jsonb_agg(side->>'data_source_id') FROM jsonb_array_elements(_sides) side),
      'rule_count',jsonb_array_length(_rules)
    ));

  RETURN QUERY SELECT new_definition.id,new_definition.recon_code;
END;
$function$
$old34440$) THEN RAISE EXCEPTION 'Qualified current native routine changed: install_recon_starter_template_atomic';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.install_recon_starter_template_atomic(_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb)
 RETURNS TABLE(recon_definition_id uuid, recon_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  template_row public.recon_definition_templates%ROWTYPE;
  new_definition public.recon_definitions%ROWTYPE;
  leg_count integer;
  valid_source_count integer;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'templates');
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.is_platform_admin(actor)
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_name,''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid reconciliation name' USING ERRCODE='22023';
  END IF;

  SELECT * INTO template_row
  FROM public.recon_definition_templates
  WHERE id = _template_id AND status = 'published'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published template not found' USING ERRCODE='P0002'; END IF;

  leg_count := jsonb_array_length(template_row.legs);
  IF jsonb_typeof(_sides) <> 'array' OR jsonb_array_length(_sides) <> leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'every template leg requires one source binding' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) < 1 OR jsonb_array_length(_rules) > 50 THEN
    RAISE EXCEPTION 'compiled template rules are invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_sides) side
    WHERE COALESCE(side->>'side_id','') NOT IN ('A','B','C')
      OR NULLIF(side->>'data_source_id','') IS NULL
  ) OR (
    SELECT count(DISTINCT side->>'side_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count OR (
    SELECT count(DISTINCT side->>'data_source_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count THEN
    RAISE EXCEPTION 'template side bindings are invalid or duplicated' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO valid_source_count
  FROM jsonb_array_elements(_sides) side
  JOIN public.workspace_data_sources source
    ON source.id = (side->>'data_source_id')::uuid
   AND source.tenant_id = _tenant_id;
  IF valid_source_count <> leg_count THEN
    RAISE EXCEPTION 'template source does not belong to tenant' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rules) rule
    WHERE COALESCE(rule->>'kind','') NOT IN (
      'exact_match','case_insensitive_match','trimmed_match','numeric_equals',
      'numeric_tolerance_abs','numeric_tolerance_pct','amount_sign_flip','date_equals',
      'date_tolerance_days','date_within_range','date_age_days','string_contains','string_starts_with',
      'string_ends_with','regex_match','fuzzy_levenshtein','phonetic_soundex',
      'currency_equals','boolean_equals','non_null','unique','in_set','sum_to_match',
      'many_to_one_sum','one_to_many_sum','value_range','multiply','ignore_day_portion',
      'conditional_set','roll_up','reference_lookup','multi_pass','quick_fix'
    ) OR jsonb_typeof(rule->'fields') <> 'object'
  ) THEN
    RAISE EXCEPTION 'template compiled an unsupported rule' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.recon_definitions(
    tenant_id,name,description,recon_type,sides,rules,status,created_by,
    starter_template_id,starter_template_code,starter_template_snapshot
  ) VALUES (
    _tenant_id,btrim(_name),template_row.summary,
    CASE leg_count WHEN 1 THEN 'one_sided' WHEN 2 THEN 'two_sided' ELSE 'three_sided' END,
    _sides,_rules,'draft',actor,template_row.id,template_row.code,
    jsonb_build_object(
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'legs',template_row.legs,'keys',template_row.keys,'rules',template_row.rules,
      'tolerances',template_row.tolerances,'sample_fields',template_row.sample_fields,
      'installed_at',now()
    )
  ) RETURNING * INTO new_definition;

  UPDATE public.recon_definition_templates
  SET install_count = install_count + 1
  WHERE id = template_row.id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.template.install','recon_definition',new_definition.id,
    jsonb_build_object(
      'recon_code',new_definition.recon_code,'template_id',template_row.id,
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'source_ids',(SELECT jsonb_agg(side->>'data_source_id') FROM jsonb_array_elements(_sides) side),
      'rule_count',jsonb_array_length(_rules)
    ));

  RETURN QUERY SELECT new_definition.id,new_definition.recon_code;
END;
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=34440::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb') THEN RAISE EXCEPTION 'Native identity or authority changed: install_recon_starter_template_atomic';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39405::oid AND n.nspname='public' AND p.proname='install_recon_starter_template_atomic' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[]' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old39405$CREATE OR REPLACE FUNCTION public.install_recon_starter_template_atomic(_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[])
 RETURNS TABLE(recon_definition_id uuid, recon_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  actor uuid := auth.uid();
  template_row public.recon_definition_templates%ROWTYPE;
  definition_row public.recon_definitions%ROWTYPE;
  leg_count integer;
  valid_source_count integer;
  definition_type text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.is_platform_admin(actor)
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_name,''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid reconciliation name' USING ERRCODE='22023';
  END IF;
  IF coalesce(cardinality(_owner_bu_ids), 0) = 0 THEN
    RAISE EXCEPTION 'select at least one owning business unit' USING ERRCODE='22023';
  END IF;

  SELECT * INTO template_row
  FROM public.recon_definition_templates
  WHERE id = _template_id AND status = 'published'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published template not found' USING ERRCODE='P0002'; END IF;

  IF jsonb_typeof(template_row.legs) <> 'array' THEN
    RAISE EXCEPTION 'published template legs are invalid' USING ERRCODE='22023';
  END IF;
  leg_count := jsonb_array_length(template_row.legs);
  IF jsonb_typeof(_sides) <> 'array' OR jsonb_array_length(_sides) <> leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'every template leg requires one source binding' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) < 1 OR jsonb_array_length(_rules) > 50 THEN
    RAISE EXCEPTION 'compiled template rules are invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_sides) side
    WHERE COALESCE(side->>'side_id','') NOT IN ('A','B','C')
      OR NULLIF(side->>'data_source_id','') IS NULL
  ) OR (
    SELECT count(DISTINCT side->>'side_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count OR (
    SELECT count(DISTINCT side->>'data_source_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count THEN
    RAISE EXCEPTION 'template side bindings are invalid or duplicated' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO valid_source_count
  FROM jsonb_array_elements(_sides) side
  JOIN public.workspace_data_sources source
    ON source.id = (side->>'data_source_id')::uuid
   AND source.tenant_id = _tenant_id;
  IF valid_source_count <> leg_count THEN
    RAISE EXCEPTION 'template source does not belong to tenant' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rules) rule
    WHERE COALESCE(rule->>'kind','') NOT IN (
      'exact_match','case_insensitive_match','trimmed_match','numeric_equals',
      'numeric_tolerance_abs','numeric_tolerance_pct','amount_sign_flip','date_equals',
      'date_tolerance_days','date_within_range','date_age_days','string_contains','string_starts_with',
      'string_ends_with','regex_match','fuzzy_levenshtein','phonetic_soundex',
      'currency_equals','boolean_equals','non_null','unique','in_set','sum_to_match',
      'many_to_one_sum','one_to_many_sum','value_range','multiply','ignore_day_portion',
      'conditional_set','roll_up','reference_lookup','multi_pass','quick_fix'
    ) OR jsonb_typeof(rule->'fields') <> 'object'
  ) THEN
    RAISE EXCEPTION 'template compiled an unsupported rule' USING ERRCODE='22023';
  END IF;

  definition_type := CASE leg_count WHEN 1 THEN 'one_sided' WHEN 2 THEN 'two_sided' ELSE 'three_sided' END;
  SELECT created.id, created.recon_code INTO definition_row.id, definition_row.recon_code
  FROM public.create_recon_definition_with_owners(
    _tenant_id, btrim(_name), template_row.summary, definition_type, _sides, _rules, _owner_bu_ids
  ) AS created;
  IF definition_row.id IS NULL THEN RAISE EXCEPTION 'owner-bound creation returned no reconciliation'; END IF;

  UPDATE public.recon_definitions
  SET starter_template_id = template_row.id,
      starter_template_code = template_row.code,
      starter_template_snapshot = jsonb_build_object(
        'template_code',template_row.code,'asset_class',template_row.asset_class,
        'legs',template_row.legs,'keys',template_row.keys,'rules',template_row.rules,
        'tolerances',template_row.tolerances,'sample_fields',template_row.sample_fields,
        'installed_at',now()
      )
  WHERE id = definition_row.id AND tenant_id = _tenant_id
  RETURNING * INTO definition_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'created reconciliation was not readable in tenant'; END IF;

  UPDATE public.recon_definition_templates
  SET install_count = install_count + 1
  WHERE id = template_row.id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.template.install','recon_definition',definition_row.id::text,
    jsonb_build_object(
      'recon_code',definition_row.recon_code,'template_id',template_row.id,
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'owner_bu_ids',_owner_bu_ids,
      'source_ids',(SELECT jsonb_agg(side->>'data_source_id') FROM jsonb_array_elements(_sides) side),
      'rule_count',jsonb_array_length(_rules)
    ));

  RETURN QUERY SELECT definition_row.id,definition_row.recon_code;
END
$function$
$old39405$) THEN RAISE EXCEPTION 'Qualified current native routine changed: install_recon_starter_template_atomic';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.install_recon_starter_template_atomic(_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[])
 RETURNS TABLE(recon_definition_id uuid, recon_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE
  actor uuid := auth.uid();
  template_row public.recon_definition_templates%ROWTYPE;
  definition_row public.recon_definitions%ROWTYPE;
  leg_count integer;
  valid_source_count integer;
  definition_type text;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'templates');
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (
    public.is_platform_admin(actor)
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_admin')
    OR public.has_tenant_role(actor, _tenant_id, 'tenant_analyst')
  ) THEN
    RAISE EXCEPTION 'analyst or admin role required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(COALESCE(_name,''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid reconciliation name' USING ERRCODE='22023';
  END IF;
  IF coalesce(cardinality(_owner_bu_ids), 0) = 0 THEN
    RAISE EXCEPTION 'select at least one owning business unit' USING ERRCODE='22023';
  END IF;

  SELECT * INTO template_row
  FROM public.recon_definition_templates
  WHERE id = _template_id AND status = 'published'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'published template not found' USING ERRCODE='P0002'; END IF;

  IF jsonb_typeof(template_row.legs) <> 'array' THEN
    RAISE EXCEPTION 'published template legs are invalid' USING ERRCODE='22023';
  END IF;
  leg_count := jsonb_array_length(template_row.legs);
  IF jsonb_typeof(_sides) <> 'array' OR jsonb_array_length(_sides) <> leg_count OR leg_count NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'every template leg requires one source binding' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) < 1 OR jsonb_array_length(_rules) > 50 THEN
    RAISE EXCEPTION 'compiled template rules are invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_sides) side
    WHERE COALESCE(side->>'side_id','') NOT IN ('A','B','C')
      OR NULLIF(side->>'data_source_id','') IS NULL
  ) OR (
    SELECT count(DISTINCT side->>'side_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count OR (
    SELECT count(DISTINCT side->>'data_source_id') FROM jsonb_array_elements(_sides) side
  ) <> leg_count THEN
    RAISE EXCEPTION 'template side bindings are invalid or duplicated' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO valid_source_count
  FROM jsonb_array_elements(_sides) side
  JOIN public.workspace_data_sources source
    ON source.id = (side->>'data_source_id')::uuid
   AND source.tenant_id = _tenant_id;
  IF valid_source_count <> leg_count THEN
    RAISE EXCEPTION 'template source does not belong to tenant' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rules) rule
    WHERE COALESCE(rule->>'kind','') NOT IN (
      'exact_match','case_insensitive_match','trimmed_match','numeric_equals',
      'numeric_tolerance_abs','numeric_tolerance_pct','amount_sign_flip','date_equals',
      'date_tolerance_days','date_within_range','date_age_days','string_contains','string_starts_with',
      'string_ends_with','regex_match','fuzzy_levenshtein','phonetic_soundex',
      'currency_equals','boolean_equals','non_null','unique','in_set','sum_to_match',
      'many_to_one_sum','one_to_many_sum','value_range','multiply','ignore_day_portion',
      'conditional_set','roll_up','reference_lookup','multi_pass','quick_fix'
    ) OR jsonb_typeof(rule->'fields') <> 'object'
  ) THEN
    RAISE EXCEPTION 'template compiled an unsupported rule' USING ERRCODE='22023';
  END IF;

  definition_type := CASE leg_count WHEN 1 THEN 'one_sided' WHEN 2 THEN 'two_sided' ELSE 'three_sided' END;
  SELECT created.id, created.recon_code INTO definition_row.id, definition_row.recon_code
  FROM public.create_recon_definition_with_owners(
    _tenant_id, btrim(_name), template_row.summary, definition_type, _sides, _rules, _owner_bu_ids
  ) AS created;
  IF definition_row.id IS NULL THEN RAISE EXCEPTION 'owner-bound creation returned no reconciliation'; END IF;

  UPDATE public.recon_definitions
  SET starter_template_id = template_row.id,
      starter_template_code = template_row.code,
      starter_template_snapshot = jsonb_build_object(
        'template_code',template_row.code,'asset_class',template_row.asset_class,
        'legs',template_row.legs,'keys',template_row.keys,'rules',template_row.rules,
        'tolerances',template_row.tolerances,'sample_fields',template_row.sample_fields,
        'installed_at',now()
      )
  WHERE id = definition_row.id AND tenant_id = _tenant_id
  RETURNING * INTO definition_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'created reconciliation was not readable in tenant'; END IF;

  UPDATE public.recon_definition_templates
  SET install_count = install_count + 1
  WHERE id = template_row.id;

  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES (actor,_tenant_id,'workspace','recon.template.install','recon_definition',definition_row.id::text,
    jsonb_build_object(
      'recon_code',definition_row.recon_code,'template_id',template_row.id,
      'template_code',template_row.code,'asset_class',template_row.asset_class,
      'owner_bu_ids',_owner_bu_ids,
      'source_ids',(SELECT jsonb_agg(side->>'data_source_id') FROM jsonb_array_elements(_sides) side),
      'rule_count',jsonb_array_length(_rules)
    ));

  RETURN QUERY SELECT definition_row.id,definition_row.recon_code;
END
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39405::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _template_id uuid, _name text, _sides jsonb, _rules jsonb, _owner_bu_ids uuid[]') THEN RAISE EXCEPTION 'Native identity or authority changed: install_recon_starter_template_atomic';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38473::oid AND n.nspname='public' AND p.proname='request_recon_retirement' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _recon_id uuid, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38473$CREATE OR REPLACE FUNCTION public.request_recon_retirement(_tenant_id uuid, _recon_id uuid, _reason text)
 RETURNS TABLE(request_id uuid, status text, tenant_id uuid, recon_id uuid, retired_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid(); definition_row public.recon_definitions%ROWTYPE; request_row public.recon_retirement_requests%ROWTYPE;
BEGIN
  IF actor IS NULL OR _tenant_id IS NULL OR _recon_id IS NULL
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'valid authenticated actor, scope, and reason required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO definition_row FROM public.recon_definitions d
    WHERE d.id=_recon_id AND d.tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation not found in tenant' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id=_tenant_id AND m.user_id=actor AND m.active=true)
     OR NOT private.user_can_govern_recon_retirement(actor,_recon_id,'edit') THEN
    RAISE EXCEPTION 'reconciliation edit and approval access required' USING ERRCODE='42501';
  END IF;
  IF definition_row.status='draft' THEN
    RAISE EXCEPTION 'unrun draft may use permission-governed physical delete' USING ERRCODE='22023';
  END IF;
  IF definition_row.retired_at IS NOT NULL THEN RAISE EXCEPTION 'reconciliation already retired' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.recon_retirement_requests q
    WHERE q.recon_id=_recon_id AND q.status='pending') THEN
    RAISE EXCEPTION 'a retirement request is already pending' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.recon_retirement_requests(tenant_id,recon_id,reason,requested_by)
    VALUES (_tenant_id,_recon_id,btrim(_reason),actor) RETURNING * INTO request_row;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor,_tenant_id,'workspace','recon.retirement.requested','recon_retirement_request',request_row.id::text,
      jsonb_build_object('recon_id',_recon_id,'reason',btrim(_reason),'requested_at',request_row.requested_at));
  RETURN QUERY SELECT request_row.id,request_row.status,request_row.tenant_id,request_row.recon_id,NULL::timestamptz;
END $function$
$old38473$) THEN RAISE EXCEPTION 'Qualified current native routine changed: request_recon_retirement';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.request_recon_retirement(_tenant_id uuid, _recon_id uuid, _reason text)
 RETURNS TABLE(request_id uuid, status text, tenant_id uuid, recon_id uuid, retired_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid(); definition_row public.recon_definitions%ROWTYPE; request_row public.recon_retirement_requests%ROWTYPE;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

  IF actor IS NULL OR _tenant_id IS NULL OR _recon_id IS NULL
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'valid authenticated actor, scope, and reason required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO definition_row FROM public.recon_definitions d
    WHERE d.id=_recon_id AND d.tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation not found in tenant' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id=_tenant_id AND m.user_id=actor AND m.active=true)
     OR NOT private.user_can_govern_recon_retirement(actor,_recon_id,'edit') THEN
    RAISE EXCEPTION 'reconciliation edit and approval access required' USING ERRCODE='42501';
  END IF;
  IF definition_row.status='draft' THEN
    RAISE EXCEPTION 'unrun draft may use permission-governed physical delete' USING ERRCODE='22023';
  END IF;
  IF definition_row.retired_at IS NOT NULL THEN RAISE EXCEPTION 'reconciliation already retired' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.recon_retirement_requests q
    WHERE q.recon_id=_recon_id AND q.status='pending') THEN
    RAISE EXCEPTION 'a retirement request is already pending' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.recon_retirement_requests(tenant_id,recon_id,reason,requested_by)
    VALUES (_tenant_id,_recon_id,btrim(_reason),actor) RETURNING * INTO request_row;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor,_tenant_id,'workspace','recon.retirement.requested','recon_retirement_request',request_row.id::text,
      jsonb_build_object('recon_id',_recon_id,'reason',btrim(_reason),'requested_at',request_row.requested_at));
  RETURN QUERY SELECT request_row.id,request_row.status,request_row.tenant_id,request_row.recon_id,NULL::timestamptz;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38473::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _recon_id uuid, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: request_recon_retirement';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=34002::oid AND n.nspname='public' AND p.proname='request_reference_data_rollback' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_id uuid, _source_version_id uuid, _effective_from date, _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old34002$CREATE OR REPLACE FUNCTION public.request_reference_data_rollback(_tenant_id uuid, _table_id uuid, _source_version_id uuid, _effective_from date, _reason text)
 RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
$old34002$) THEN RAISE EXCEPTION 'Qualified current native routine changed: request_reference_data_rollback';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.request_reference_data_rollback(_tenant_id uuid, _table_id uuid, _source_version_id uuid, _effective_from date, _reason text)
 RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  source_version public.reference_data_versions%ROWTYPE;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

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
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=34002::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_id uuid, _source_version_id uuid, _effective_from date, _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: request_reference_data_rollback';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38302::oid AND n.nspname='public' AND p.proname='resolve_reference_data_version' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_id uuid, _as_of date' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38302$CREATE OR REPLACE FUNCTION public.resolve_reference_data_version(_tenant_id uuid, _table_id uuid, _as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(resolved_version_id uuid, resolved_version_number integer, resolved_content_sha256 text, resolved_rows jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.reference_data_tables root
      WHERE root.id=_table_id AND root.tenant_id=_tenant_id)
     OR NOT public.reference_scope_allows(_table_id,'view') THEN
    RAISE EXCEPTION 'reference_scope_denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT * FROM public.resolve_reference_data_version_pre_scope(_tenant_id,_table_id,_as_of);
END $function$
$old38302$) THEN RAISE EXCEPTION 'Qualified current native routine changed: resolve_reference_data_version';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.resolve_reference_data_version(_tenant_id uuid, _table_id uuid, _as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(resolved_version_id uuid, resolved_version_number integer, resolved_content_sha256 text, resolved_rows jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

  IF NOT EXISTS(SELECT 1 FROM public.reference_data_tables root
      WHERE root.id=_table_id AND root.tenant_id=_tenant_id)
     OR NOT public.reference_scope_allows(_table_id,'view') THEN
    RAISE EXCEPTION 'reference_scope_denied' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT * FROM public.resolve_reference_data_version_pre_scope(_tenant_id,_table_id,_as_of);
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38302::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_id uuid, _as_of date') THEN RAISE EXCEPTION 'Native identity or authority changed: resolve_reference_data_version';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38769::oid AND n.nspname='public' AND p.proname='save_collateral_csa_access' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _agreement_id uuid, _owner_bu_ids uuid[], _group_ids uuid[], _reason text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38769$CREATE OR REPLACE FUNCTION public.save_collateral_csa_access(_tenant_id uuid, _agreement_id uuid, _owner_bu_ids uuid[], _group_ids uuid[], _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_registry uuid; v_bu_ids uuid[]; v_group_ids uuid[];
  v_group uuid; v_bu uuid; v_grant record;
BEGIN
  IF v_actor IS NULL OR _tenant_id IS NULL OR _agreement_id IS NULL
    OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000
    OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=v_actor AND m.active AND m.role='tenant_admin'::public.tenant_role)
  THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
  PERFORM a.id FROM public.collateral_csa_agreements a
    WHERE a.id=_agreement_id AND a.tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSA agreement is outside this tenant' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_bu_ids
    FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) x;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_group_ids
    FROM unnest(coalesce(_group_ids,ARRAY[]::uuid[])) x;
  IF cardinality(v_bu_ids)=0 OR cardinality(v_bu_ids)>50 OR cardinality(v_group_ids)>100
    OR EXISTS(SELECT 1 FROM unnest(v_bu_ids) x LEFT JOIN public.business_units b
      ON b.id=x AND b.tenant_id=_tenant_id AND NOT b.is_archived WHERE b.id IS NULL)
    OR EXISTS(SELECT 1 FROM unnest(v_group_ids) x LEFT JOIN public.tenant_groups g
      ON g.id=x AND g.tenant_id=_tenant_id WHERE g.id IS NULL)
  THEN RAISE EXCEPTION 'invalid CSA business unit or group selection' USING ERRCODE='22023'; END IF;
  SELECT r.id INTO v_registry FROM public.data_resource_registry r
    WHERE r.tenant_id=_tenant_id AND r.resource_type='collateral_csa_agreement'
      AND r.collateral_csa_agreement_id=_agreement_id FOR UPDATE;
  IF v_registry IS NULL THEN
    INSERT INTO public.data_resource_registry(
      tenant_id,resource_type,collateral_csa_agreement_id,created_by)
    VALUES(_tenant_id,'collateral_csa_agreement',_agreement_id,v_actor)
    RETURNING id INTO v_registry;
    INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id,created_by)
      SELECT _tenant_id,v_registry,x,v_actor FROM unnest(v_bu_ids) x;
    INSERT INTO public.data_resource_registry_admin_audit(
      tenant_id,registry_id,operation,actor_id,reason,details)
    VALUES(_tenant_id,v_registry,'REGISTER',v_actor,btrim(_reason),
      jsonb_build_object('resource_type','collateral_csa_agreement',
        'resource_id',_agreement_id,'owner_bu_ids',v_bu_ids));
  ELSE
    FOR v_grant IN SELECT g.id FROM public.data_resource_registry_grants g
      WHERE g.registry_id=v_registry AND g.tenant_id=_tenant_id
        AND g.principal_type='group' AND g.action='view'
    LOOP PERFORM public.revoke_typed_data_resource_action(v_grant.id,_reason); END LOOP;
    PERFORM public.set_typed_data_resource_owners(v_registry,v_bu_ids,_reason);
  END IF;
  FOREACH v_group IN ARRAY v_group_ids LOOP
    v_bu:=NULL;
    SELECT owner.id INTO v_bu FROM public.business_units owner
      JOIN public.bu_group_assignments ga ON ga.tenant_id=_tenant_id AND ga.group_id=v_group
      JOIN public.business_units assigned ON assigned.id=ga.bu_id
        AND assigned.tenant_id=ga.tenant_id AND NOT assigned.is_archived
      WHERE owner.tenant_id=_tenant_id AND owner.id=ANY(v_bu_ids) AND NOT owner.is_archived
        AND (assigned.id=owner.id OR (ga.inherit_descendants AND owner.path <@ assigned.path))
      ORDER BY owner.id LIMIT 1;
    IF v_bu IS NULL THEN RAISE EXCEPTION 'CSA group is not assigned to an owning BU'
      USING ERRCODE='42501'; END IF;
    PERFORM public.grant_typed_data_resource_action(v_registry,v_bu,'group',v_group,'view',_reason);
  END LOOP;
  RETURN jsonb_build_object('registered',true,'owner_bu_count',cardinality(v_bu_ids),
    'group_count',cardinality(v_group_ids));
END $function$
$old38769$) THEN RAISE EXCEPTION 'Qualified current native routine changed: save_collateral_csa_access';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.save_collateral_csa_access(_tenant_id uuid, _agreement_id uuid, _owner_bu_ids uuid[], _group_ids uuid[], _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_registry uuid; v_bu_ids uuid[]; v_group_ids uuid[];
  v_group uuid; v_bu uuid; v_grant record;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'collateral');

  IF v_actor IS NULL OR _tenant_id IS NULL OR _agreement_id IS NULL
    OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 3 AND 1000
    OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant_id
      AND m.user_id=v_actor AND m.active AND m.role='tenant_admin'::public.tenant_role)
  THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
  PERFORM a.id FROM public.collateral_csa_agreements a
    WHERE a.id=_agreement_id AND a.tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSA agreement is outside this tenant' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_bu_ids
    FROM unnest(coalesce(_owner_bu_ids,ARRAY[]::uuid[])) x;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO v_group_ids
    FROM unnest(coalesce(_group_ids,ARRAY[]::uuid[])) x;
  IF cardinality(v_bu_ids)=0 OR cardinality(v_bu_ids)>50 OR cardinality(v_group_ids)>100
    OR EXISTS(SELECT 1 FROM unnest(v_bu_ids) x LEFT JOIN public.business_units b
      ON b.id=x AND b.tenant_id=_tenant_id AND NOT b.is_archived WHERE b.id IS NULL)
    OR EXISTS(SELECT 1 FROM unnest(v_group_ids) x LEFT JOIN public.tenant_groups g
      ON g.id=x AND g.tenant_id=_tenant_id WHERE g.id IS NULL)
  THEN RAISE EXCEPTION 'invalid CSA business unit or group selection' USING ERRCODE='22023'; END IF;
  SELECT r.id INTO v_registry FROM public.data_resource_registry r
    WHERE r.tenant_id=_tenant_id AND r.resource_type='collateral_csa_agreement'
      AND r.collateral_csa_agreement_id=_agreement_id FOR UPDATE;
  IF v_registry IS NULL THEN
    INSERT INTO public.data_resource_registry(
      tenant_id,resource_type,collateral_csa_agreement_id,created_by)
    VALUES(_tenant_id,'collateral_csa_agreement',_agreement_id,v_actor)
    RETURNING id INTO v_registry;
    INSERT INTO public.data_resource_registry_owner_bu(tenant_id,registry_id,bu_id,created_by)
      SELECT _tenant_id,v_registry,x,v_actor FROM unnest(v_bu_ids) x;
    INSERT INTO public.data_resource_registry_admin_audit(
      tenant_id,registry_id,operation,actor_id,reason,details)
    VALUES(_tenant_id,v_registry,'REGISTER',v_actor,btrim(_reason),
      jsonb_build_object('resource_type','collateral_csa_agreement',
        'resource_id',_agreement_id,'owner_bu_ids',v_bu_ids));
  ELSE
    FOR v_grant IN SELECT g.id FROM public.data_resource_registry_grants g
      WHERE g.registry_id=v_registry AND g.tenant_id=_tenant_id
        AND g.principal_type='group' AND g.action='view'
    LOOP PERFORM public.revoke_typed_data_resource_action(v_grant.id,_reason); END LOOP;
    PERFORM public.set_typed_data_resource_owners(v_registry,v_bu_ids,_reason);
  END IF;
  FOREACH v_group IN ARRAY v_group_ids LOOP
    v_bu:=NULL;
    SELECT owner.id INTO v_bu FROM public.business_units owner
      JOIN public.bu_group_assignments ga ON ga.tenant_id=_tenant_id AND ga.group_id=v_group
      JOIN public.business_units assigned ON assigned.id=ga.bu_id
        AND assigned.tenant_id=ga.tenant_id AND NOT assigned.is_archived
      WHERE owner.tenant_id=_tenant_id AND owner.id=ANY(v_bu_ids) AND NOT owner.is_archived
        AND (assigned.id=owner.id OR (ga.inherit_descendants AND owner.path <@ assigned.path))
      ORDER BY owner.id LIMIT 1;
    IF v_bu IS NULL THEN RAISE EXCEPTION 'CSA group is not assigned to an owning BU'
      USING ERRCODE='42501'; END IF;
    PERFORM public.grant_typed_data_resource_action(v_registry,v_bu,'group',v_group,'view',_reason);
  END LOOP;
  RETURN jsonb_build_object('registered',true,'owner_bu_count',cardinality(v_bu_ids),
    'group_count',cardinality(v_group_ids));
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38769::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _agreement_id uuid, _owner_bu_ids uuid[], _group_ids uuid[], _reason text') THEN RAISE EXCEPTION 'Native identity or authority changed: save_collateral_csa_access';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=41054::oid AND n.nspname='public' AND p.proname='save_reference_table_atomic' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _request_key uuid, _name text, _description text, _key_columns text[], _value_columns text[], _is_active boolean, _owner_bu_ids uuid[], _group_ids uuid[], _id uuid, _expected_updated_at timestamp with time zone, _expected_scope_hash text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old41054$CREATE OR REPLACE FUNCTION public.save_reference_table_atomic(_tenant_id uuid, _request_key uuid, _name text, _description text, _key_columns text[], _value_columns text[], _is_active boolean, _owner_bu_ids uuid[], _group_ids uuid[], _id uuid DEFAULT NULL::uuid, _expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _expected_scope_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth', 'extensions'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_owners uuid[]; v_groups uuid[]; v_pairs jsonb;
  v_hash text; v_saved public.reference_table_save_requests%ROWTYPE;
  v_table public.reference_data_tables%ROWTYPE; v_registry uuid; v_before_scope text;
  v_group uuid; v_pair record; v_grant record; v_reply jsonb; v_audit_id bigint;
  v_reason text := 'Reference table atomic save'; v_changed boolean;
BEGIN
  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role', true) IS DISTINCT FROM 'authenticated'
    OR _tenant_id IS NULL OR _request_key IS NULL THEN
    RAISE EXCEPTION 'Reference save requires an authenticated tenant administrator' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenant_members tm WHERE tm.tenant_id = _tenant_id
    AND tm.user_id = v_actor AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reference save is not authorized' USING ERRCODE = '42501'; END IF;
  IF _name IS NULL OR length(_name) > 80 OR length(btrim(_name)) < 2
    OR length(_description) > 500 OR _is_active IS NULL
    OR coalesce(cardinality(_key_columns), 0) NOT BETWEEN 1 AND 50
    OR coalesce(cardinality(_value_columns), 0) > 50
    OR coalesce(cardinality(_owner_bu_ids), 0) NOT BETWEEN 1 AND 20
    OR coalesce(cardinality(_group_ids), 0) > 20
    OR array_ndims(_key_columns) <> 1 OR array_ndims(_owner_bu_ids) <> 1
    OR (coalesce(cardinality(_value_columns), 0) > 0 AND array_ndims(_value_columns) <> 1)
    OR (coalesce(cardinality(_group_ids), 0) > 0 AND array_ndims(_group_ids) <> 1)
    OR EXISTS (SELECT 1 FROM unnest(_key_columns || coalesce(_value_columns, ARRAY[]::text[])) x
      WHERE x IS NULL OR length(btrim(x)) NOT BETWEEN 1 AND 80)
    OR (SELECT count(DISTINCT lower(btrim(x))) FROM unnest(_key_columns) x) <> cardinality(_key_columns)
    OR (SELECT count(DISTINCT lower(btrim(x))) FROM unnest(coalesce(_value_columns, ARRAY[]::text[])) x)
      <> coalesce(cardinality(_value_columns), 0)
    OR array_position(_owner_bu_ids, NULL) IS NOT NULL OR array_position(_group_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid Reference table save fields or scope' USING ERRCODE = '22023';
  END IF;
  IF _expected_scope_hash IS NOT NULL AND _expected_scope_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid Reference scope version' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_owners FROM unnest(_owner_bu_ids) x;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_groups FROM unnest(_group_ids) x;
  v_hash := encode(extensions.digest(jsonb_build_object('tenant_id', _tenant_id, 'id', _id,
    'name', _name, 'description', _description, 'keys', _key_columns,
    'values', coalesce(_value_columns, ARRAY[]::text[]), 'is_active', _is_active,
    'owners', v_owners, 'groups', v_groups, 'expected_updated_at', _expected_updated_at,
    'expected_scope_hash', _expected_scope_hash)::text, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('fvi-reference-save:' || _tenant_id || ':' || v_actor || ':' || _request_key, 0));
  SELECT * INTO v_saved FROM public.reference_table_save_requests
    WHERE tenant_id = _tenant_id AND actor_id = v_actor AND request_key = _request_key;
  IF FOUND THEN
    IF v_saved.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'Reference request key conflicts with another payload' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_table FROM public.reference_data_tables
      WHERE id = v_saved.reference_table_id AND tenant_id = _tenant_id;
    v_changed := NOT FOUND OR v_table.updated_at IS DISTINCT FROM (v_saved.receipt->>'updated_at')::timestamptz;
    IF NOT v_changed THEN
      v_changed := private.reference_table_save_scope_hash(_tenant_id, (v_saved.receipt->>'registry_id')::uuid)
        IS DISTINCT FROM v_saved.receipt->>'scope_hash';
    END IF;
    IF NOT v_changed THEN
      v_changed := NOT public.reference_scope_allows(v_saved.reference_table_id, 'view')
        OR EXISTS (SELECT 1 FROM unnest(v_owners) AS requested(bu_id) WHERE NOT EXISTS (
          SELECT 1 FROM public.business_units b WHERE b.id = requested.bu_id AND b.tenant_id = _tenant_id AND NOT b.is_archived))
        OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_saved.receipt->'group_bu_pairs') AS pair(group_id uuid, bu_id uuid)
          WHERE NOT EXISTS (SELECT 1 FROM public.tenant_groups g JOIN public.bu_group_assignments ga
            ON ga.group_id = g.id AND ga.tenant_id = g.tenant_id
            JOIN public.business_units assigned ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
            JOIN public.business_units target ON target.id = pair.bu_id AND target.tenant_id = _tenant_id AND NOT target.is_archived
            WHERE g.id = pair.group_id AND g.tenant_id = _tenant_id
              AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path))));
    END IF;
    RETURN v_saved.receipt || jsonb_build_object('replayed', true, 'current_state_changed', v_changed);
  END IF;

  IF _id IS NULL THEN
    IF _expected_updated_at IS NOT NULL OR _expected_scope_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Creation has no prior version' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_table FROM public.reference_data_tables WHERE id = _id AND tenant_id = _tenant_id FOR UPDATE;
    IF NOT FOUND OR NOT public.reference_scope_allows(_id, 'edit') THEN
      RAISE EXCEPTION 'Reference table edit is not authorized' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_registry FROM public.data_resource_registry WHERE tenant_id = _tenant_id
      AND resource_type = 'reference_table' AND reference_table_id = _id FOR UPDATE;
    IF v_registry IS NULL OR v_table.access_mode <> 'mapped_exact' THEN
      RAISE EXCEPTION 'A mapped Reference table is required for governed update' USING ERRCODE = '23514';
    END IF;
    v_before_scope := private.reference_table_save_scope_hash(_tenant_id, v_registry);
    IF _expected_updated_at IS NULL OR _expected_scope_hash IS NULL
      OR v_table.updated_at IS DISTINCT FROM _expected_updated_at
      OR v_before_scope IS DISTINCT FROM _expected_scope_hash THEN
      RAISE EXCEPTION 'Reference table or access scope changed; refresh before saving' USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Prevent assignment phantoms during pair validation/mutation; only a bounded
  -- save runs under this read lock. Selected group/BU rows are also locked.
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.bu_group_assignments IN SHARE MODE;
  PERFORM 1 FROM public.business_units WHERE tenant_id = _tenant_id AND id = ANY(v_owners) AND NOT is_archived ORDER BY id FOR SHARE;
  IF EXISTS (SELECT 1 FROM unnest(v_owners) AS requested(bu_id) WHERE NOT EXISTS (
    SELECT 1 FROM public.business_units b WHERE b.id = requested.bu_id AND b.tenant_id = _tenant_id AND NOT b.is_archived)) THEN
    RAISE EXCEPTION 'Owner Business Units must be active in the same tenant' USING ERRCODE = '23514';
  END IF;
  FOREACH v_group IN ARRAY v_groups LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('fvi-principal-group:' || v_group::text, 0));
    PERFORM 1 FROM public.tenant_groups WHERE id = v_group AND tenant_id = _tenant_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected group is outside the tenant' USING ERRCODE = '23514'; END IF;
  END LOOP;
  PERFORM ga.id FROM public.bu_group_assignments ga JOIN public.business_units assigned
    ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
    WHERE ga.tenant_id = _tenant_id AND ga.group_id = ANY(v_groups) AND EXISTS (
      SELECT 1 FROM public.business_units target WHERE target.tenant_id = _tenant_id
        AND target.id = ANY(v_owners) AND NOT target.is_archived
        AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path)))
    ORDER BY ga.group_id, ga.bu_id FOR SHARE OF ga, assigned;
  SELECT coalesce(jsonb_agg(jsonb_build_object('group_id', pair.group_id, 'bu_id', pair.bu_id)
    ORDER BY pair.group_id, pair.bu_id), '[]'::jsonb) INTO v_pairs
  FROM (SELECT g AS group_id, owner.id AS bu_id FROM unnest(v_groups) g
    JOIN public.business_units owner ON owner.tenant_id = _tenant_id AND owner.id = ANY(v_owners) AND NOT owner.is_archived
    WHERE EXISTS (SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned
      ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
      WHERE ga.tenant_id = _tenant_id AND ga.group_id = g
        AND (assigned.id = owner.id OR (ga.inherit_descendants AND owner.path <@ assigned.path)))) pair;
  IF EXISTS (SELECT 1 FROM unnest(v_groups) g WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_pairs) AS pair(group_id uuid, bu_id uuid) WHERE pair.group_id = g)) THEN
    RAISE EXCEPTION 'Selected group has no legitimate owning BU assignment' USING ERRCODE = '23514';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.reference_data_tables(tenant_id, name, description, key_columns, value_columns, is_active, created_by)
      VALUES (_tenant_id, _name, _description, _key_columns, coalesce(_value_columns, ARRAY[]::text[]), _is_active, v_actor)
      RETURNING * INTO v_table;
    v_registry := public.register_typed_data_resource('reference_table', v_table.id, v_owners, v_reason);
  ELSE
    UPDATE public.reference_data_tables SET name = _name, description = _description,
      key_columns = _key_columns, value_columns = coalesce(_value_columns, ARRAY[]::text[]), is_active = _is_active
      WHERE id = _id AND tenant_id = _tenant_id RETURNING * INTO v_table;
    -- Replace only group-view pairs managed by this workflow. Non-view/user
    -- grants are preserved; the existing owner helper refuses conflicting removals.
    FOR v_grant IN SELECT g.id FROM public.data_resource_registry_grants g WHERE g.registry_id = v_registry
      AND g.tenant_id = _tenant_id AND g.principal_type = 'group' AND g.action = 'view'
      AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_pairs) AS pair(group_id uuid, bu_id uuid)
        WHERE pair.group_id = g.principal_group_id AND pair.bu_id = g.bu_id)
    LOOP PERFORM public.revoke_typed_data_resource_action(v_grant.id, v_reason); END LOOP;
    PERFORM public.set_typed_data_resource_owners(v_registry, v_owners, v_reason);
  END IF;
  FOR v_pair IN SELECT * FROM jsonb_to_recordset(v_pairs) AS pair(group_id uuid, bu_id uuid)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.data_resource_registry_grants WHERE tenant_id = _tenant_id
      AND registry_id = v_registry AND bu_id = v_pair.bu_id AND principal_type = 'group'
      AND principal_group_id = v_pair.group_id AND action = 'view') THEN
      PERFORM public.grant_typed_data_resource_action(v_registry, v_pair.bu_id, 'group', v_pair.group_id, 'view', v_reason);
    END IF;
  END LOOP;
  SELECT * INTO v_table FROM public.reference_data_tables WHERE id = v_table.id AND tenant_id = _tenant_id;
  v_reply := jsonb_build_object('id', v_table.id, 'registry_id', v_registry, 'request_key', _request_key,
    'updated_at', v_table.updated_at, 'scope_hash', private.reference_table_save_scope_hash(_tenant_id, v_registry),
    'group_bu_pairs', v_pairs, 'is_new', _id IS NULL, 'replayed', false, 'current_state_changed', false);
  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (v_actor, _tenant_id, 'tenant', CASE WHEN _id IS NULL THEN 'reference_data.table.create' ELSE 'reference_data.table.update' END,
      'reference_data_tables', v_table.id::text, jsonb_build_object('name', _name, 'request_key', _request_key,
        'owner_bu_ids', v_owners, 'group_ids', v_groups, 'group_bu_pairs', v_pairs,
        'previous_scope_hash', v_before_scope, 'scope_hash', v_reply->>'scope_hash')) RETURNING id INTO v_audit_id;
  v_reply := v_reply || jsonb_build_object('audit_id', v_audit_id::text);
  INSERT INTO public.reference_table_save_requests(tenant_id, actor_id, request_key, payload_hash, reference_table_id, receipt)
    VALUES (_tenant_id, v_actor, _request_key, v_hash, v_table.id, v_reply);
  RETURN v_reply;
END $function$
$old41054$) THEN RAISE EXCEPTION 'Qualified current native routine changed: save_reference_table_atomic';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.save_reference_table_atomic(_tenant_id uuid, _request_key uuid, _name text, _description text, _key_columns text[], _value_columns text[], _is_active boolean, _owner_bu_ids uuid[], _group_ids uuid[], _id uuid DEFAULT NULL::uuid, _expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _expected_scope_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'auth', 'extensions'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_owners uuid[]; v_groups uuid[]; v_pairs jsonb;
  v_hash text; v_saved public.reference_table_save_requests%ROWTYPE;
  v_table public.reference_data_tables%ROWTYPE; v_registry uuid; v_before_scope text;
  v_group uuid; v_pair record; v_grant record; v_reply jsonb; v_audit_id bigint;
  v_reason text := 'Reference table atomic save'; v_changed boolean;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

  IF v_actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role', true) IS DISTINCT FROM 'authenticated'
    OR _tenant_id IS NULL OR _request_key IS NULL THEN
    RAISE EXCEPTION 'Reference save requires an authenticated tenant administrator' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenant_members tm WHERE tm.tenant_id = _tenant_id
    AND tm.user_id = v_actor AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reference save is not authorized' USING ERRCODE = '42501'; END IF;
  IF _name IS NULL OR length(_name) > 80 OR length(btrim(_name)) < 2
    OR length(_description) > 500 OR _is_active IS NULL
    OR coalesce(cardinality(_key_columns), 0) NOT BETWEEN 1 AND 50
    OR coalesce(cardinality(_value_columns), 0) > 50
    OR coalesce(cardinality(_owner_bu_ids), 0) NOT BETWEEN 1 AND 20
    OR coalesce(cardinality(_group_ids), 0) > 20
    OR array_ndims(_key_columns) <> 1 OR array_ndims(_owner_bu_ids) <> 1
    OR (coalesce(cardinality(_value_columns), 0) > 0 AND array_ndims(_value_columns) <> 1)
    OR (coalesce(cardinality(_group_ids), 0) > 0 AND array_ndims(_group_ids) <> 1)
    OR EXISTS (SELECT 1 FROM unnest(_key_columns || coalesce(_value_columns, ARRAY[]::text[])) x
      WHERE x IS NULL OR length(btrim(x)) NOT BETWEEN 1 AND 80)
    OR (SELECT count(DISTINCT lower(btrim(x))) FROM unnest(_key_columns) x) <> cardinality(_key_columns)
    OR (SELECT count(DISTINCT lower(btrim(x))) FROM unnest(coalesce(_value_columns, ARRAY[]::text[])) x)
      <> coalesce(cardinality(_value_columns), 0)
    OR array_position(_owner_bu_ids, NULL) IS NOT NULL OR array_position(_group_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid Reference table save fields or scope' USING ERRCODE = '22023';
  END IF;
  IF _expected_scope_hash IS NOT NULL AND _expected_scope_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid Reference scope version' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_owners FROM unnest(_owner_bu_ids) x;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_groups FROM unnest(_group_ids) x;
  v_hash := encode(extensions.digest(jsonb_build_object('tenant_id', _tenant_id, 'id', _id,
    'name', _name, 'description', _description, 'keys', _key_columns,
    'values', coalesce(_value_columns, ARRAY[]::text[]), 'is_active', _is_active,
    'owners', v_owners, 'groups', v_groups, 'expected_updated_at', _expected_updated_at,
    'expected_scope_hash', _expected_scope_hash)::text, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('fvi-reference-save:' || _tenant_id || ':' || v_actor || ':' || _request_key, 0));
  SELECT * INTO v_saved FROM public.reference_table_save_requests
    WHERE tenant_id = _tenant_id AND actor_id = v_actor AND request_key = _request_key;
  IF FOUND THEN
    IF v_saved.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'Reference request key conflicts with another payload' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_table FROM public.reference_data_tables
      WHERE id = v_saved.reference_table_id AND tenant_id = _tenant_id;
    v_changed := NOT FOUND OR v_table.updated_at IS DISTINCT FROM (v_saved.receipt->>'updated_at')::timestamptz;
    IF NOT v_changed THEN
      v_changed := private.reference_table_save_scope_hash(_tenant_id, (v_saved.receipt->>'registry_id')::uuid)
        IS DISTINCT FROM v_saved.receipt->>'scope_hash';
    END IF;
    IF NOT v_changed THEN
      v_changed := NOT public.reference_scope_allows(v_saved.reference_table_id, 'view')
        OR EXISTS (SELECT 1 FROM unnest(v_owners) AS requested(bu_id) WHERE NOT EXISTS (
          SELECT 1 FROM public.business_units b WHERE b.id = requested.bu_id AND b.tenant_id = _tenant_id AND NOT b.is_archived))
        OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_saved.receipt->'group_bu_pairs') AS pair(group_id uuid, bu_id uuid)
          WHERE NOT EXISTS (SELECT 1 FROM public.tenant_groups g JOIN public.bu_group_assignments ga
            ON ga.group_id = g.id AND ga.tenant_id = g.tenant_id
            JOIN public.business_units assigned ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
            JOIN public.business_units target ON target.id = pair.bu_id AND target.tenant_id = _tenant_id AND NOT target.is_archived
            WHERE g.id = pair.group_id AND g.tenant_id = _tenant_id
              AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path))));
    END IF;
    RETURN v_saved.receipt || jsonb_build_object('replayed', true, 'current_state_changed', v_changed);
  END IF;

  IF _id IS NULL THEN
    IF _expected_updated_at IS NOT NULL OR _expected_scope_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Creation has no prior version' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_table FROM public.reference_data_tables WHERE id = _id AND tenant_id = _tenant_id FOR UPDATE;
    IF NOT FOUND OR NOT public.reference_scope_allows(_id, 'edit') THEN
      RAISE EXCEPTION 'Reference table edit is not authorized' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_registry FROM public.data_resource_registry WHERE tenant_id = _tenant_id
      AND resource_type = 'reference_table' AND reference_table_id = _id FOR UPDATE;
    IF v_registry IS NULL OR v_table.access_mode <> 'mapped_exact' THEN
      RAISE EXCEPTION 'A mapped Reference table is required for governed update' USING ERRCODE = '23514';
    END IF;
    v_before_scope := private.reference_table_save_scope_hash(_tenant_id, v_registry);
    IF _expected_updated_at IS NULL OR _expected_scope_hash IS NULL
      OR v_table.updated_at IS DISTINCT FROM _expected_updated_at
      OR v_before_scope IS DISTINCT FROM _expected_scope_hash THEN
      RAISE EXCEPTION 'Reference table or access scope changed; refresh before saving' USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Prevent assignment phantoms during pair validation/mutation; only a bounded
  -- save runs under this read lock. Selected group/BU rows are also locked.
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.bu_group_assignments IN SHARE MODE;
  PERFORM 1 FROM public.business_units WHERE tenant_id = _tenant_id AND id = ANY(v_owners) AND NOT is_archived ORDER BY id FOR SHARE;
  IF EXISTS (SELECT 1 FROM unnest(v_owners) AS requested(bu_id) WHERE NOT EXISTS (
    SELECT 1 FROM public.business_units b WHERE b.id = requested.bu_id AND b.tenant_id = _tenant_id AND NOT b.is_archived)) THEN
    RAISE EXCEPTION 'Owner Business Units must be active in the same tenant' USING ERRCODE = '23514';
  END IF;
  FOREACH v_group IN ARRAY v_groups LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('fvi-principal-group:' || v_group::text, 0));
    PERFORM 1 FROM public.tenant_groups WHERE id = v_group AND tenant_id = _tenant_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected group is outside the tenant' USING ERRCODE = '23514'; END IF;
  END LOOP;
  PERFORM ga.id FROM public.bu_group_assignments ga JOIN public.business_units assigned
    ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
    WHERE ga.tenant_id = _tenant_id AND ga.group_id = ANY(v_groups) AND EXISTS (
      SELECT 1 FROM public.business_units target WHERE target.tenant_id = _tenant_id
        AND target.id = ANY(v_owners) AND NOT target.is_archived
        AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path)))
    ORDER BY ga.group_id, ga.bu_id FOR SHARE OF ga, assigned;
  SELECT coalesce(jsonb_agg(jsonb_build_object('group_id', pair.group_id, 'bu_id', pair.bu_id)
    ORDER BY pair.group_id, pair.bu_id), '[]'::jsonb) INTO v_pairs
  FROM (SELECT g AS group_id, owner.id AS bu_id FROM unnest(v_groups) g
    JOIN public.business_units owner ON owner.tenant_id = _tenant_id AND owner.id = ANY(v_owners) AND NOT owner.is_archived
    WHERE EXISTS (SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned
      ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
      WHERE ga.tenant_id = _tenant_id AND ga.group_id = g
        AND (assigned.id = owner.id OR (ga.inherit_descendants AND owner.path <@ assigned.path)))) pair;
  IF EXISTS (SELECT 1 FROM unnest(v_groups) g WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_pairs) AS pair(group_id uuid, bu_id uuid) WHERE pair.group_id = g)) THEN
    RAISE EXCEPTION 'Selected group has no legitimate owning BU assignment' USING ERRCODE = '23514';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.reference_data_tables(tenant_id, name, description, key_columns, value_columns, is_active, created_by)
      VALUES (_tenant_id, _name, _description, _key_columns, coalesce(_value_columns, ARRAY[]::text[]), _is_active, v_actor)
      RETURNING * INTO v_table;
    v_registry := public.register_typed_data_resource('reference_table', v_table.id, v_owners, v_reason);
  ELSE
    UPDATE public.reference_data_tables SET name = _name, description = _description,
      key_columns = _key_columns, value_columns = coalesce(_value_columns, ARRAY[]::text[]), is_active = _is_active
      WHERE id = _id AND tenant_id = _tenant_id RETURNING * INTO v_table;
    -- Replace only group-view pairs managed by this workflow. Non-view/user
    -- grants are preserved; the existing owner helper refuses conflicting removals.
    FOR v_grant IN SELECT g.id FROM public.data_resource_registry_grants g WHERE g.registry_id = v_registry
      AND g.tenant_id = _tenant_id AND g.principal_type = 'group' AND g.action = 'view'
      AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_pairs) AS pair(group_id uuid, bu_id uuid)
        WHERE pair.group_id = g.principal_group_id AND pair.bu_id = g.bu_id)
    LOOP PERFORM public.revoke_typed_data_resource_action(v_grant.id, v_reason); END LOOP;
    PERFORM public.set_typed_data_resource_owners(v_registry, v_owners, v_reason);
  END IF;
  FOR v_pair IN SELECT * FROM jsonb_to_recordset(v_pairs) AS pair(group_id uuid, bu_id uuid)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.data_resource_registry_grants WHERE tenant_id = _tenant_id
      AND registry_id = v_registry AND bu_id = v_pair.bu_id AND principal_type = 'group'
      AND principal_group_id = v_pair.group_id AND action = 'view') THEN
      PERFORM public.grant_typed_data_resource_action(v_registry, v_pair.bu_id, 'group', v_pair.group_id, 'view', v_reason);
    END IF;
  END LOOP;
  SELECT * INTO v_table FROM public.reference_data_tables WHERE id = v_table.id AND tenant_id = _tenant_id;
  v_reply := jsonb_build_object('id', v_table.id, 'registry_id', v_registry, 'request_key', _request_key,
    'updated_at', v_table.updated_at, 'scope_hash', private.reference_table_save_scope_hash(_tenant_id, v_registry),
    'group_bu_pairs', v_pairs, 'is_new', _id IS NULL, 'replayed', false, 'current_state_changed', false);
  INSERT INTO public.audit_log(actor_user_id, tenant_id, scope, action, resource_type, resource_id, context)
    VALUES (v_actor, _tenant_id, 'tenant', CASE WHEN _id IS NULL THEN 'reference_data.table.create' ELSE 'reference_data.table.update' END,
      'reference_data_tables', v_table.id::text, jsonb_build_object('name', _name, 'request_key', _request_key,
        'owner_bu_ids', v_owners, 'group_ids', v_groups, 'group_bu_pairs', v_pairs,
        'previous_scope_hash', v_before_scope, 'scope_hash', v_reply->>'scope_hash')) RETURNING id INTO v_audit_id;
  v_reply := v_reply || jsonb_build_object('audit_id', v_audit_id::text);
  INSERT INTO public.reference_table_save_requests(tenant_id, actor_id, request_key, payload_hash, reference_table_id, receipt)
    VALUES (_tenant_id, v_actor, _request_key, v_hash, v_table.id, v_reply);
  RETURN v_reply;
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=41054::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _request_key uuid, _name text, _description text, _key_columns text[], _value_columns text[], _is_active boolean, _owner_bu_ids uuid[], _group_ids uuid[], _id uuid, _expected_updated_at timestamp with time zone, _expected_scope_hash text') THEN RAISE EXCEPTION 'Native identity or authority changed: save_reference_table_atomic';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=41032::oid AND n.nspname='public' AND p.proname='search_reference_scope_groups' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _owner_bu_ids uuid[], _search text, _offset integer, _limit integer, _selected_ids uuid[]' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old41032$CREATE OR REPLACE FUNCTION public.search_reference_scope_groups(_tenant_id uuid, _owner_bu_ids uuid[], _search text DEFAULT ''::text, _offset integer DEFAULT 0, _limit integer DEFAULT 50, _selected_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE v_rows jsonb; v_items jsonb; v_metadata jsonb := '[]'::jsonb;
  v_group uuid; v_name text; v_bu_ids uuid[]; v_pattern text;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role', true) IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = auth.uid() AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Reference scope search is not authorized' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 OR _offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000
    OR length(coalesce(_search, '')) > 100 OR coalesce(cardinality(_owner_bu_ids), 0) > 20
    OR coalesce(cardinality(_selected_ids), 0) > 20
    OR array_position(_owner_bu_ids, NULL) IS NOT NULL OR array_position(_selected_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid bounded Reference group search' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_owner_bu_ids) AS requested(bu_id) WHERE NOT EXISTS (
    SELECT 1 FROM public.business_units b WHERE b.id = requested.bu_id AND b.tenant_id = _tenant_id AND NOT b.is_archived)) THEN
    RAISE EXCEPTION 'Reference search owner scope changed' USING ERRCODE = '23514';
  END IF;
  v_pattern := '%' || replace(replace(replace(coalesce(_search, ''), chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', page.id, 'name', page.name) ORDER BY page.name, page.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT g.id, g.name FROM public.tenant_groups g WHERE g.tenant_id = _tenant_id AND g.name ILIKE v_pattern
    AND EXISTS (SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned
      ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
      JOIN public.business_units target ON target.id = ANY(_owner_bu_ids) AND target.tenant_id = _tenant_id AND NOT target.is_archived
      WHERE ga.group_id = g.id AND ga.tenant_id = _tenant_id
        AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path)))
    ORDER BY g.name, g.id OFFSET _offset LIMIT _limit + 1) page;
  SELECT coalesce(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb) INTO v_items
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY item(value, ordinality) WHERE item.ordinality <= _limit;
  FOREACH v_group IN ARRAY coalesce(_selected_ids, ARRAY[]::uuid[]) LOOP
    v_name := NULL; v_bu_ids := ARRAY[]::uuid[];
    SELECT g.name, array_agg(DISTINCT target.id ORDER BY target.id) INTO v_name, v_bu_ids
    FROM public.tenant_groups g JOIN public.bu_group_assignments ga ON ga.group_id = g.id AND ga.tenant_id = g.tenant_id
      JOIN public.business_units assigned ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
      JOIN public.business_units target ON target.id = ANY(_owner_bu_ids) AND target.tenant_id = _tenant_id AND NOT target.is_archived
      AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path))
    WHERE g.id = v_group AND g.tenant_id = _tenant_id GROUP BY g.id, g.name;
    v_bu_ids := coalesce(v_bu_ids, ARRAY[]::uuid[]);
    v_metadata := v_metadata || jsonb_build_array(jsonb_build_object('id', v_group, 'name', v_name,
      'eligible', cardinality(v_bu_ids) > 0, 'business_unit_ids', v_bu_ids));
  END LOOP;
  RETURN jsonb_build_object('groups', jsonb_build_object('items', v_items, 'has_more', jsonb_array_length(v_rows) > _limit,
    'next_offset', _offset + _limit), 'selected_groups', v_metadata);
END $function$
$old41032$) THEN RAISE EXCEPTION 'Qualified current native routine changed: search_reference_scope_groups';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.search_reference_scope_groups(_tenant_id uuid, _owner_bu_ids uuid[], _search text DEFAULT ''::text, _offset integer DEFAULT 0, _limit integer DEFAULT 50, _selected_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE v_rows jsonb; v_items jsonb; v_metadata jsonb := '[]'::jsonb;
  v_group uuid; v_name text; v_bu_ids uuid[]; v_pattern text;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  IF public.wfm_workspace_row_allowed(_tenant_id,'reference') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Workspace section is disabled or current access denied' USING ERRCODE='42501';END IF;

  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR current_setting('role', true) IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = auth.uid() AND tm.active AND tm.role = 'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Reference scope search is not authorized' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 OR _offset IS NULL OR _offset NOT BETWEEN 0 AND 1000000
    OR length(coalesce(_search, '')) > 100 OR coalesce(cardinality(_owner_bu_ids), 0) > 20
    OR coalesce(cardinality(_selected_ids), 0) > 20
    OR array_position(_owner_bu_ids, NULL) IS NOT NULL OR array_position(_selected_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid bounded Reference group search' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_owner_bu_ids) AS requested(bu_id) WHERE NOT EXISTS (
    SELECT 1 FROM public.business_units b WHERE b.id = requested.bu_id AND b.tenant_id = _tenant_id AND NOT b.is_archived)) THEN
    RAISE EXCEPTION 'Reference search owner scope changed' USING ERRCODE = '23514';
  END IF;
  v_pattern := '%' || replace(replace(replace(coalesce(_search, ''), chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', page.id, 'name', page.name) ORDER BY page.name, page.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT g.id, g.name FROM public.tenant_groups g WHERE g.tenant_id = _tenant_id AND g.name ILIKE v_pattern
    AND EXISTS (SELECT 1 FROM public.bu_group_assignments ga JOIN public.business_units assigned
      ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
      JOIN public.business_units target ON target.id = ANY(_owner_bu_ids) AND target.tenant_id = _tenant_id AND NOT target.is_archived
      WHERE ga.group_id = g.id AND ga.tenant_id = _tenant_id
        AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path)))
    ORDER BY g.name, g.id OFFSET _offset LIMIT _limit + 1) page;
  SELECT coalesce(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb) INTO v_items
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY item(value, ordinality) WHERE item.ordinality <= _limit;
  FOREACH v_group IN ARRAY coalesce(_selected_ids, ARRAY[]::uuid[]) LOOP
    v_name := NULL; v_bu_ids := ARRAY[]::uuid[];
    SELECT g.name, array_agg(DISTINCT target.id ORDER BY target.id) INTO v_name, v_bu_ids
    FROM public.tenant_groups g JOIN public.bu_group_assignments ga ON ga.group_id = g.id AND ga.tenant_id = g.tenant_id
      JOIN public.business_units assigned ON assigned.id = ga.bu_id AND assigned.tenant_id = ga.tenant_id AND NOT assigned.is_archived
      JOIN public.business_units target ON target.id = ANY(_owner_bu_ids) AND target.tenant_id = _tenant_id AND NOT target.is_archived
      AND (assigned.id = target.id OR (ga.inherit_descendants AND target.path <@ assigned.path))
    WHERE g.id = v_group AND g.tenant_id = _tenant_id GROUP BY g.id, g.name;
    v_bu_ids := coalesce(v_bu_ids, ARRAY[]::uuid[]);
    v_metadata := v_metadata || jsonb_build_array(jsonb_build_object('id', v_group, 'name', v_name,
      'eligible', cardinality(v_bu_ids) > 0, 'business_unit_ids', v_bu_ids));
  END LOOP;
  RETURN jsonb_build_object('groups', jsonb_build_object('items', v_items, 'has_more', jsonb_array_length(v_rows) > _limit,
    'next_offset', _offset + _limit), 'selected_groups', v_metadata);
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=41032::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _owner_bu_ids uuid[], _search text, _offset integer, _limit integer, _selected_ids uuid[]') THEN RAISE EXCEPTION 'Native identity or authority changed: search_reference_scope_groups';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=33997::oid AND n.nspname='public' AND p.proname='stage_reference_data_version' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_id uuid, _rows jsonb, _effective_from date, _effective_to date, _change_note text' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old33997$CREATE OR REPLACE FUNCTION public.stage_reference_data_version(_tenant_id uuid, _table_id uuid, _rows jsonb, _effective_from date, _effective_to date, _change_note text)
 RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
$old33997$) THEN RAISE EXCEPTION 'Qualified current native routine changed: stage_reference_data_version';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.stage_reference_data_version(_tenant_id uuid, _table_id uuid, _rows jsonb, _effective_from date, _effective_to date, _change_note text)
 RETURNS TABLE(version_id uuid, version_number integer, row_count integer, content_sha256 text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  actor uuid := auth.uid();
  v_version_id uuid;
  v_version_number integer;
  v_row_count integer;
  v_content_sha256 text;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

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
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=33997::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _table_id uuid, _rows jsonb, _effective_from date, _effective_to date, _change_note text') THEN RAISE EXCEPTION 'Native identity or authority changed: stage_reference_data_version';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=38724::oid AND n.nspname='public' AND p.proname='submit_collateral_csa_version' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old38724$CREATE OR REPLACE FUNCTION public.submit_collateral_csa_version(_tenant_id uuid, _version_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid := auth.uid(); version_row public.collateral_csa_versions%ROWTYPE;
BEGIN
  IF NOT public.csa_assurance_actor(_tenant_id,actor) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO version_row FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id FOR UPDATE;
  IF NOT FOUND OR version_row.created_by<>actor OR version_row.status<>'draft' THEN
    RAISE EXCEPTION 'Only the draft author can submit a draft version' USING ERRCODE='42501';
  END IF;
  UPDATE public.collateral_csa_versions SET status='pending_approval',submitted_by=actor,submitted_at=now() WHERE id=_version_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.csa.version.submit','collateral_csa_version',_version_id::text,jsonb_build_object('version_no',version_row.version_no));
  RETURN 'pending_approval';
END $function$
$old38724$) THEN RAISE EXCEPTION 'Qualified current native routine changed: submit_collateral_csa_version';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.submit_collateral_csa_version(_tenant_id uuid, _version_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid := auth.uid(); version_row public.collateral_csa_versions%ROWTYPE;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'collateral');

  IF NOT public.csa_assurance_actor(_tenant_id,actor) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO version_row FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id FOR UPDATE;
  IF NOT FOUND OR version_row.created_by<>actor OR version_row.status<>'draft' THEN
    RAISE EXCEPTION 'Only the draft author can submit a draft version' USING ERRCODE='42501';
  END IF;
  UPDATE public.collateral_csa_versions SET status='pending_approval',submitted_by=actor,submitted_at=now() WHERE id=_version_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.csa.version.submit','collateral_csa_version',_version_id::text,jsonb_build_object('version_no',version_row.version_no));
  RETURN 'pending_approval';
END $function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=38724::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid') THEN RAISE EXCEPTION 'Native identity or authority changed: submit_collateral_csa_version';END IF;END $guard$;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=33998::oid AND n.nspname='public' AND p.proname='submit_reference_data_version' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$old33998$CREATE OR REPLACE FUNCTION public.submit_reference_data_version(_tenant_id uuid, _version_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
$old33998$) THEN RAISE EXCEPTION 'Qualified current native routine changed: submit_reference_data_version';END IF;END $guard$;
CREATE OR REPLACE FUNCTION public.submit_reference_data_version(_tenant_id uuid, _version_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  v_version public.reference_data_versions%ROWTYPE;
BEGIN
  -- Registered workspace availability; original authorization and entire body follow unchanged.
  PERFORM private.wfm_assert_enabled(_tenant_id,'reference');

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
$function$

;
DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=33998::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _version_id uuid') THEN RAISE EXCEPTION 'Native identity or authority changed: submit_reference_data_version';END IF;END $guard$;
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=21232::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='rekon_wizard_drafts';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'rekon_wizard_drafts' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"((user_id = auth.uid()) AND is_tenant_member(auth.uid(), tenant_id))","roles":["authenticated"],"tablename":"rekon_wizard_drafts","permissive":"PERMISSIVE","policyname":"own draft read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"((user_id = auth.uid()) AND is_tenant_member(auth.uid(), tenant_id))","roles":["authenticated"],"tablename":"rekon_wizard_drafts","permissive":"PERMISSIVE","policyname":"own draft write","schemaname":"public","with_check":"((user_id = auth.uid()) AND is_tenant_member(auth.uid(), tenant_id))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"rekon_wizard_drafts","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"trg_wizard_drafts_uat","function":"tg_set_updated_at()","definition":"CREATE TRIGGER trg_wizard_drafts_uat BEFORE UPDATE ON public.rekon_wizard_drafts FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: rekon_wizard_drafts';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_rekon_wizard_drafts ON public.rekon_wizard_drafts AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'recons'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.rekon_wizard_drafts FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=21183::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='rekon_inline_api_sources';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'rekon_inline_api_sources' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"rekon_inline_api_sources","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"},{"cmd":"ALL","qual":"has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)","roles":["authenticated"],"tablename":"rekon_inline_api_sources","permissive":"PERMISSIVE","policyname":"tenant admins manage api sources","schemaname":"public","with_check":"has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)"},{"cmd":"SELECT","qual":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"rekon_inline_api_sources","permissive":"PERMISSIVE","policyname":"tenant admins read api sources","schemaname":"public","with_check":null}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_resource_inline_api_tenant_guard","function":"prevent_registered_resource_tenant_change()","definition":"CREATE TRIGGER data_resource_inline_api_tenant_guard BEFORE UPDATE OF tenant_id ON public.rekon_inline_api_sources FOR EACH ROW EXECUTE FUNCTION prevent_registered_resource_tenant_change()"},{"name":"trg_api_sources_uat","function":"tg_set_updated_at()","definition":"CREATE TRIGGER trg_api_sources_uat BEFORE UPDATE ON public.rekon_inline_api_sources FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.rekon_inline_api_sources FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: rekon_inline_api_sources';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_rekon_inline_api_sources ON public.rekon_inline_api_sources AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'recons'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.rekon_inline_api_sources FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=21208::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='rekon_db_connections';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'rekon_db_connections' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"rekon_db_connections","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"},{"cmd":"ALL","qual":"has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)","roles":["authenticated"],"tablename":"rekon_db_connections","permissive":"PERMISSIVE","policyname":"tenant admins manage db conns","schemaname":"public","with_check":"has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)"},{"cmd":"SELECT","qual":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"rekon_db_connections","permissive":"PERMISSIVE","policyname":"tenant admins read db conns","schemaname":"public","with_check":null}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_resource_db_connection_tenant_guard","function":"prevent_registered_resource_tenant_change()","definition":"CREATE TRIGGER data_resource_db_connection_tenant_guard BEFORE UPDATE OF tenant_id ON public.rekon_db_connections FOR EACH ROW EXECUTE FUNCTION prevent_registered_resource_tenant_change()"},{"name":"trg_db_conns_uat","function":"tg_set_updated_at()","definition":"CREATE TRIGGER trg_db_conns_uat BEFORE UPDATE ON public.rekon_db_connections FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.rekon_db_connections FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: rekon_db_connections';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_rekon_db_connections ON public.rekon_db_connections AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'recons'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.rekon_db_connections FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=18287::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='recon_definitions';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'recon_definitions' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=rwdDxtm/postgres","authenticated=rwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"DELETE","qual":"((status = 'draft'::text) AND (retired_at IS NULL) AND (NOT (EXISTS ( SELECT 1\n   FROM recon_runs run_row\n  WHERE (run_row.definition_id = recon_definitions.id)))) AND (access_mode = 'legacy_passthrough'::text) AND private.user_can_access_recon(auth.uid(), id, 'edit'::text) AND (EXISTS ( SELECT 1\n   FROM tenant_members member_row\n  WHERE ((member_row.tenant_id = recon_definitions.tenant_id) AND (member_row.user_id = auth.uid()) AND (member_row.active = true)))) AND (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)))","roles":["authenticated"],"tablename":"recon_definitions","permissive":"PERMISSIVE","policyname":"recon_defs_delete","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"recon_definitions","permissive":"PERMISSIVE","policyname":"recon_defs_insert","schemaname":"public","with_check":"((created_by = auth.uid()) AND (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)))"},{"cmd":"SELECT","qual":"\nCASE\n    WHEN (access_mode = 'legacy_passthrough'::text) THEN (private.user_can_access_recon(auth.uid(), id, 'read'::text) OR ((created_by = auth.uid()) AND private.is_tenant_member(auth.uid(), tenant_id)))\n    ELSE private.recon_authoritative_access_decision(id, 'read'::text)\nEND","roles":["authenticated"],"tablename":"recon_definitions","permissive":"PERMISSIVE","policyname":"recon_defs_select","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"\nCASE\n    WHEN (access_mode = 'legacy_passthrough'::text) THEN (private.user_can_access_recon(auth.uid(), id, 'edit'::text) AND (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)))\n    ELSE private.recon_authoritative_access_decision(id, 'edit'::text)\nEND","roles":["authenticated"],"tablename":"recon_definitions","permissive":"PERMISSIVE","policyname":"recon_defs_update","schemaname":"public","with_check":"\nCASE\n    WHEN (access_mode = 'legacy_passthrough'::text) THEN (private.user_can_access_recon(auth.uid(), id, 'edit'::text) AND (private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role)))\n    ELSE private.recon_authoritative_access_decision(id, 'edit'::text)\nEND"},{"cmd":"SELECT","qual":"private.recon_run_effective_read_allowed(id, tenant_id)","roles":["authenticated"],"tablename":"recon_definitions","permissive":"RESTRICTIVE","policyname":"recon_effective_access_restrictive","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"((access_mode = 'mapped_exact'::text) AND private.recon_effective_access(id, 'read'::text))","roles":["authenticated"],"tablename":"recon_definitions","permissive":"PERMISSIVE","policyname":"recon_effective_access_select","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"recon_definitions","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"mapped_recon_governance_stage_complete","function":"private.mapped_recon_governance_stage_complete()","definition":"CREATE CONSTRAINT TRIGGER mapped_recon_governance_stage_complete AFTER INSERT ON public.recon_definitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.mapped_recon_governance_stage_complete()"},{"name":"recon_definitions_governance_guard","function":"tg_guard_recon_definition_governance()","definition":"CREATE TRIGGER recon_definitions_governance_guard BEFORE INSERT OR UPDATE ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION tg_guard_recon_definition_governance()"},{"name":"recon_definitions_require_multi_bu_owner","function":"require_recon_multi_bu_owner()","definition":"CREATE TRIGGER recon_definitions_require_multi_bu_owner BEFORE INSERT OR UPDATE OF multi_bu_governed ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION require_recon_multi_bu_owner()"},{"name":"trg_assign_reconciliation_code","function":"assign_reconciliation_code()","definition":"CREATE TRIGGER trg_assign_reconciliation_code BEFORE INSERT ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION assign_reconciliation_code()"},{"name":"trg_guard_recon_definition_retirement","function":"tg_guard_recon_definition_retirement()","definition":"CREATE TRIGGER trg_guard_recon_definition_retirement BEFORE DELETE OR UPDATE OF status, retired_at, retirement_request_id ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION tg_guard_recon_definition_retirement()"},{"name":"trg_prevent_reconciliation_identity_change","function":"prevent_reconciliation_identity_change()","definition":"CREATE TRIGGER trg_prevent_reconciliation_identity_change BEFORE UPDATE OF recon_code, tenant_id ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_identity_change()"},{"name":"trg_recon_defs_updated_at","function":"tg_set_updated_at()","definition":"CREATE TRIGGER trg_recon_defs_updated_at BEFORE UPDATE ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: recon_definitions';END IF;
 END $guard$;

CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.recon_definitions FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=20584::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='recon_definition_versions';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'recon_definition_versions' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"recon_definition_versions","permissive":"PERMISSIVE","policyname":"rdv read","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"recon_definition_versions","permissive":"PERMISSIVE","policyname":"rdv write","schemaname":"public","with_check":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"recon_definition_versions","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: recon_definition_versions';END IF;
 END $guard$;

CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.recon_definition_versions FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=39140::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='recon_definition_approved_versions';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'recon_definition_approved_versions' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","authenticated=r/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM tenant_members m\n  WHERE ((m.tenant_id = recon_definition_approved_versions.tenant_id) AND (m.user_id = auth.uid()) AND (m.active = true) AND ((m.role)::text = 'tenant_admin'::text))))","roles":["authenticated"],"tablename":"recon_definition_approved_versions","permissive":"PERMISSIVE","policyname":"recon_definition_approved_versions_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"recon_definition_approved_versions","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"recon_definition_approved_versions_immutable","function":"reject_recon_governance_history_mutation()","definition":"CREATE TRIGGER recon_definition_approved_versions_immutable BEFORE DELETE OR UPDATE ON public.recon_definition_approved_versions FOR EACH ROW EXECUTE FUNCTION reject_recon_governance_history_mutation()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: recon_definition_approved_versions';END IF;
 END $guard$;

CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.recon_definition_approved_versions FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=39094::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='recon_definition_governance_requests';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'recon_definition_governance_requests' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","authenticated=r/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"((mapped_governance_version = 1) AND (requested_by = auth.uid()) AND private.recon_authoritative_access_decision(parent_definition_id, 'read'::text))","roles":["authenticated"],"tablename":"recon_definition_governance_requests","permissive":"PERMISSIVE","policyname":"mapped_recon_governance_requester_read","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM tenant_members m\n  WHERE ((m.tenant_id = recon_definition_governance_requests.tenant_id) AND (m.user_id = auth.uid()) AND (m.active = true) AND ((m.role)::text = 'tenant_admin'::text))))","roles":["authenticated"],"tablename":"recon_definition_governance_requests","permissive":"PERMISSIVE","policyname":"recon_definition_governance_requests_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"recon_definition_governance_requests","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"mapped_recon_governance_request_immutable","function":"private.mapped_recon_governance_request_immutable()","definition":"CREATE TRIGGER mapped_recon_governance_request_immutable BEFORE DELETE OR UPDATE ON public.recon_definition_governance_requests FOR EACH ROW EXECUTE FUNCTION private.mapped_recon_governance_request_immutable()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: recon_definition_governance_requests';END IF;
 END $guard$;

CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.recon_definition_governance_requests FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=38437::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='recon_retirement_requests';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'recon_retirement_requests' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","authenticated=r/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"((requested_by = auth.uid()) OR ((EXISTS ( SELECT 1\n   FROM tenant_members m\n  WHERE ((m.tenant_id = recon_retirement_requests.tenant_id) AND (m.user_id = auth.uid()) AND (m.active = true)))) AND private.user_can_govern_recon_retirement(auth.uid(), recon_id, 'approve'::text)))","roles":["authenticated"],"tablename":"recon_retirement_requests","permissive":"PERMISSIVE","policyname":"recon_retirement_requests_read_authorized","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"recon_retirement_requests","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: recon_retirement_requests';END IF;
 END $guard$;

CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.recon_retirement_requests FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('recons');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=19224::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_prep_pipelines';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_prep_pipelines' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"RESTRICTIVE","policyname":"data_prep_pipelines_scope_create","schemaname":"public","with_check":"(EXISTS ( SELECT 1\n   FROM tenant_members member_row\n  WHERE ((member_row.tenant_id = data_prep_pipelines.tenant_id) AND (member_row.user_id = auth.uid()) AND member_row.active)))"},{"cmd":"DELETE","qual":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, id, 'manage'::text)","roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"RESTRICTIVE","policyname":"data_prep_pipelines_scope_delete","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, id, 'edit'::text)","roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"RESTRICTIVE","policyname":"data_prep_pipelines_scope_edit","schemaname":"public","with_check":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, id, 'edit'::text)"},{"cmd":"SELECT","qual":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, id, 'view'::text)","roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"RESTRICTIVE","policyname":"data_prep_pipelines_scope_read","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"PERMISSIVE","policyname":"dpp_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))","roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"PERMISSIVE","policyname":"dpp_write","schemaname":"public","with_check":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_prep_pipelines","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_prep_pipelines_set_uid","function":"tg_data_prep_pipeline_uid()","definition":"CREATE TRIGGER data_prep_pipelines_set_uid BEFORE INSERT ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION tg_data_prep_pipeline_uid()"},{"name":"data_prep_pipelines_validate_tenant","function":"tg_validate_data_prep_pipeline_tenant()","definition":"CREATE TRIGGER data_prep_pipelines_validate_tenant BEFORE INSERT OR UPDATE OF tenant_id, source_data_source_id, output_data_source_id ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION tg_validate_data_prep_pipeline_tenant()"},{"name":"data_resource_data_prep_tenant_guard","function":"prevent_registered_resource_tenant_change()","definition":"CREATE TRIGGER data_resource_data_prep_tenant_guard BEFORE UPDATE OF tenant_id ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION prevent_registered_resource_tenant_change()"},{"name":"dpp_updated_at","function":"tg_set_updated_at()","definition":"CREATE TRIGGER dpp_updated_at BEFORE UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"dpw_guard_pipeline","function":"private.dpw_guard_pipeline()","definition":"CREATE TRIGGER dpw_guard_pipeline BEFORE UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION private.dpw_guard_pipeline()"},{"name":"dpw_pipeline_lifecycle","function":"private.dpw_pipeline_lifecycle()","definition":"CREATE TRIGGER dpw_pipeline_lifecycle AFTER INSERT OR UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION private.dpw_pipeline_lifecycle()"},{"name":"guard_data_prep_lifecycle","function":"tg_guard_data_prep_lifecycle()","definition":"CREATE TRIGGER guard_data_prep_lifecycle BEFORE UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION tg_guard_data_prep_lifecycle()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_prep_pipelines';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_prep_pipelines ON public.data_prep_pipelines AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'prep'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('prep');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=19262::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_prep_runs';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_prep_runs' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"DELETE","qual":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, pipeline_id, 'manage'::text)","roles":["authenticated"],"tablename":"data_prep_runs","permissive":"RESTRICTIVE","policyname":"data_prep_runs_parent_delete","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"data_prep_runs","permissive":"RESTRICTIVE","policyname":"data_prep_runs_parent_insert","schemaname":"public","with_check":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, pipeline_id, 'run'::text)"},{"cmd":"SELECT","qual":"(private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, pipeline_id, 'view'::text) OR ((triggered_by = auth.uid()) AND private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, pipeline_id, 'run'::text)))","roles":["authenticated"],"tablename":"data_prep_runs","permissive":"RESTRICTIVE","policyname":"data_prep_runs_parent_read","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, pipeline_id, 'run'::text)","roles":["authenticated"],"tablename":"data_prep_runs","permissive":"RESTRICTIVE","policyname":"data_prep_runs_parent_update","schemaname":"public","with_check":"private.data_prep_pipeline_scope_allows(auth.uid(), tenant_id, pipeline_id, 'run'::text)"},{"cmd":"SELECT","qual":"(private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_prep_runs","permissive":"PERMISSIVE","policyname":"dpr_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))","roles":["authenticated"],"tablename":"data_prep_runs","permissive":"PERMISSIVE","policyname":"dpr_write","schemaname":"public","with_check":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_prep_runs","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_prep_runs_bind_tenant","function":"tg_bind_data_prep_run_tenant()","definition":"CREATE TRIGGER data_prep_runs_bind_tenant BEFORE INSERT OR UPDATE OF pipeline_id, tenant_id ON public.data_prep_runs FOR EACH ROW EXECUTE FUNCTION tg_bind_data_prep_run_tenant()"},{"name":"data_prep_runs_set_uid","function":"tg_data_prep_run_uid()","definition":"CREATE TRIGGER data_prep_runs_set_uid BEFORE INSERT ON public.data_prep_runs FOR EACH ROW EXECUTE FUNCTION tg_data_prep_run_uid()"},{"name":"data_prep_runs_stamp_lifecycle","function":"tg_data_prep_runs_stamp_lifecycle()","definition":"CREATE TRIGGER data_prep_runs_stamp_lifecycle BEFORE INSERT ON public.data_prep_runs FOR EACH ROW EXECUTE FUNCTION tg_data_prep_runs_stamp_lifecycle()"},{"name":"zz_guard_atomic_data_prep_run","function":"guard_atomic_data_prep_run()","definition":"CREATE TRIGGER zz_guard_atomic_data_prep_run BEFORE INSERT OR UPDATE ON public.data_prep_runs FOR EACH ROW EXECUTE FUNCTION guard_atomic_data_prep_run()"},{"name":"zzz_guard_data_prep_run_request_key","function":"guard_data_prep_run_request_key()","definition":"CREATE TRIGGER zzz_guard_data_prep_run_request_key BEFORE INSERT OR DELETE OR UPDATE ON public.data_prep_runs FOR EACH ROW EXECUTE FUNCTION guard_data_prep_run_request_key()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_prep_runs';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_prep_runs ON public.data_prep_runs AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'prep'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_prep_runs FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('prep');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=19296::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_watchers';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_watchers' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_watchers","permissive":"PERMISSIVE","policyname":"dw_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))","roles":["authenticated"],"tablename":"data_watchers","permissive":"PERMISSIVE","policyname":"dw_write","schemaname":"public","with_check":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_watchers","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"data_watchers","permissive":"RESTRICTIVE","policyname":"watcher_exact_create","schemaname":"public","with_check":"((access_mode = 'unmapped_pending'::text) AND (EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = data_watchers.tenant_id) AND (tm.user_id = auth.uid()) AND tm.active AND (tm.role = 'tenant_admin'::tenant_role)))))"},{"cmd":"DELETE","qual":"watcher_scope_allows(id, 'manage'::text)","roles":["authenticated"],"tablename":"data_watchers","permissive":"RESTRICTIVE","policyname":"watcher_exact_delete","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"watcher_scope_allows(id, 'edit'::text)","roles":["authenticated"],"tablename":"data_watchers","permissive":"RESTRICTIVE","policyname":"watcher_exact_edit","schemaname":"public","with_check":"watcher_scope_allows(id, 'edit'::text)"},{"cmd":"SELECT","qual":"watcher_scope_allows(id, 'view'::text)","roles":["authenticated"],"tablename":"data_watchers","permissive":"RESTRICTIVE","policyname":"watcher_exact_read","schemaname":"public","with_check":null}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_resource_watcher_tenant_guard","function":"prevent_registered_resource_tenant_change()","definition":"CREATE TRIGGER data_resource_watcher_tenant_guard BEFORE UPDATE OF tenant_id ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION prevent_registered_resource_tenant_change()"},{"name":"data_watchers_validate_tenant","function":"tg_validate_data_watcher_tenant()","definition":"CREATE TRIGGER data_watchers_validate_tenant BEFORE INSERT OR UPDATE OF tenant_id, data_source_id ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION tg_validate_data_watcher_tenant()"},{"name":"dw_updated_at","function":"tg_set_updated_at()","definition":"CREATE TRIGGER dw_updated_at BEFORE UPDATE ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"guard_watcher_scope_identity","function":"guard_watcher_scope_identity()","definition":"CREATE TRIGGER guard_watcher_scope_identity BEFORE UPDATE ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION guard_watcher_scope_identity()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_watchers';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_watchers ON public.data_watchers AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'watchers'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('watchers');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=33847::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_watcher_events';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_watcher_events' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_watcher_events","permissive":"PERMISSIVE","policyname":"data_watcher_events_member_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_watcher_events","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"},{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM data_watchers w\n  WHERE ((w.id = data_watcher_events.watcher_id) AND (w.tenant_id = data_watcher_events.tenant_id) AND watcher_scope_allows(w.id, 'view'::text))))","roles":["authenticated"],"tablename":"data_watcher_events","permissive":"RESTRICTIVE","policyname":"watcher_event_parent_scope","schemaname":"public","with_check":null}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_watcher_events';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_watcher_events ON public.data_watcher_events AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'watchers'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_watcher_events FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('watchers');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=18576::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_source_schedules';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_source_schedules' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=dDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_source_schedules","permissive":"PERMISSIVE","policyname":"dss_read","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"data_source_schedules","permissive":"RESTRICTIVE","policyname":"dss_scope_create","schemaname":"public","with_check":"((access_mode = 'unmapped_pending'::text) AND (EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = data_source_schedules.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND tm.active AND ((tm.role)::text = 'tenant_admin'::text)))))"},{"cmd":"UPDATE","qual":"schedule_scope_allows(id, 'edit'::text)","roles":["authenticated"],"tablename":"data_source_schedules","permissive":"RESTRICTIVE","policyname":"dss_scope_edit","schemaname":"public","with_check":"schedule_scope_allows(id, 'edit'::text)"},{"cmd":"DELETE","qual":"schedule_scope_allows(id, 'manage'::text)","roles":["authenticated"],"tablename":"data_source_schedules","permissive":"RESTRICTIVE","policyname":"dss_scope_manage","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"schedule_scope_allows(id, 'view'::text)","roles":["authenticated"],"tablename":"data_source_schedules","permissive":"RESTRICTIVE","policyname":"dss_scope_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_source_schedules","permissive":"PERMISSIVE","policyname":"dss_write","schemaname":"public","with_check":"(private.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR private.has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR private.is_platform_admin(auth.uid()))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_source_schedules","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_resource_schedule_tenant_guard","function":"prevent_registered_schedule_tenant_change()","definition":"CREATE TRIGGER data_resource_schedule_tenant_guard BEFORE UPDATE OF tenant_id ON public.data_source_schedules FOR EACH ROW EXECUTE FUNCTION prevent_registered_schedule_tenant_change()"},{"name":"guard_schedule_scope_identity","function":"guard_schedule_scope_identity()","definition":"CREATE TRIGGER guard_schedule_scope_identity BEFORE UPDATE ON public.data_source_schedules FOR EACH ROW EXECUTE FUNCTION guard_schedule_scope_identity()"},{"name":"trg_dss_updated","function":"tg_set_updated_at()","definition":"CREATE TRIGGER trg_dss_updated BEFORE UPDATE ON public.data_source_schedules FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.data_source_schedules FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_source_schedules';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_source_schedules ON public.data_source_schedules AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'connectors'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_source_schedules FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('connectors');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=18610::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_source_runs';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_source_runs' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=awdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"data_source_runs","permissive":"PERMISSIVE","policyname":"data_source_runs admin insert","schemaname":"public","with_check":"is_platform_admin(auth.uid())"},{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM data_source_schedules schedule\n  WHERE ((schedule.id = data_source_runs.schedule_id) AND (schedule.tenant_id = data_source_runs.tenant_id) AND schedule_scope_allows(schedule.id, 'view'::text))))","roles":["authenticated"],"tablename":"data_source_runs","permissive":"RESTRICTIVE","policyname":"dsr_parent_scope","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_source_runs","permissive":"PERMISSIVE","policyname":"dsr_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_source_runs","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_source_runs';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_source_runs ON public.data_source_runs AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'connectors'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_source_runs FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('connectors');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=23308::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='exception_assignment_rules';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'exception_assignment_rules' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"ALL","qual":"(is_tenant_member(auth.uid(), tenant_id) AND has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))","roles":["authenticated"],"tablename":"exception_assignment_rules","permissive":"PERMISSIVE","policyname":"admins write assignment rules","schemaname":"public","with_check":"(is_tenant_member(auth.uid(), tenant_id) AND has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role))"},{"cmd":"SELECT","qual":"is_tenant_member(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"exception_assignment_rules","permissive":"PERMISSIVE","policyname":"members read assignment rules","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"exception_assignment_rules","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"assign_rules_updated","function":"tg_set_updated_at()","definition":"CREATE TRIGGER assign_rules_updated BEFORE UPDATE ON public.exception_assignment_rules FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: exception_assignment_rules';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_exception_assignment_rules ON public.exception_assignment_rules AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'assignment'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.exception_assignment_rules FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('assignment');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=19774::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='regulatory_pack_installs';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'regulatory_pack_installs' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"regulatory_pack_installs","permissive":"PERMISSIVE","policyname":"regpack installs tenant admin write","schemaname":"public","with_check":"private.user_has_tenant_role_or_group(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)"},{"cmd":"SELECT","qual":"(private.is_tenant_member(auth.uid(), tenant_id) OR private.is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"regulatory_pack_installs","permissive":"PERMISSIVE","policyname":"regpack installs tenant scoped","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"regulatory_pack_installs","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"regulatory_install_audit_trg","function":"tg_regulatory_install_audit()","definition":"CREATE TRIGGER regulatory_install_audit_trg AFTER INSERT OR UPDATE OF status ON public.regulatory_pack_installs FOR EACH ROW EXECUTE FUNCTION tg_regulatory_install_audit()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: regulatory_pack_installs';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_regulatory_pack_installs ON public.regulatory_pack_installs AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'regulatory'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.regulatory_pack_installs FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('regulatory');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=20318::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='data_lineage_edges';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'data_lineage_edges' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_lineage_edges","permissive":"PERMISSIVE","policyname":"lineage tenant read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"data_lineage_edges","permissive":"PERMISSIVE","policyname":"lineage tenant write","schemaname":"public","with_check":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role) OR has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"data_lineage_edges","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: data_lineage_edges';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_data_lineage_edges ON public.data_lineage_edges AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'lineage'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.data_lineage_edges FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('lineage');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=20842::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='reference_data_tables';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'reference_data_tables' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"reference_data_tables","permissive":"PERMISSIVE","policyname":"rdt_read","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"reference_data_tables","permissive":"RESTRICTIVE","policyname":"rdt_scope_create","schemaname":"public","with_check":"((access_mode = 'unmapped_pending'::text) AND (EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = reference_data_tables.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND tm.active AND ((tm.role)::text = 'tenant_admin'::text)))))"},{"cmd":"UPDATE","qual":"reference_scope_allows(id, 'edit'::text)","roles":["authenticated"],"tablename":"reference_data_tables","permissive":"RESTRICTIVE","policyname":"rdt_scope_edit","schemaname":"public","with_check":"reference_scope_allows(id, 'edit'::text)"},{"cmd":"DELETE","qual":"reference_scope_allows(id, 'manage'::text)","roles":["authenticated"],"tablename":"reference_data_tables","permissive":"RESTRICTIVE","policyname":"rdt_scope_manage","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"reference_scope_allows(id, 'view'::text)","roles":["authenticated"],"tablename":"reference_data_tables","permissive":"RESTRICTIVE","policyname":"rdt_scope_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))","roles":["authenticated"],"tablename":"reference_data_tables","permissive":"PERMISSIVE","policyname":"rdt_write","schemaname":"public","with_check":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR has_tenant_role(auth.uid(), tenant_id, 'tenant_analyst'::tenant_role))"},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"reference_data_tables","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_resource_reference_table_tenant_guard","function":"prevent_registered_resource_tenant_change()","definition":"CREATE TRIGGER data_resource_reference_table_tenant_guard BEFORE UPDATE OF tenant_id ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION prevent_registered_resource_tenant_change()"},{"name":"guard_reference_scope_identity","function":"guard_reference_scope_identity()","definition":"CREATE TRIGGER guard_reference_scope_identity BEFORE UPDATE ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION guard_reference_scope_identity()"},{"name":"reference_data_table_version_guard","function":"tg_reference_data_table_version_guard()","definition":"CREATE TRIGGER reference_data_table_version_guard BEFORE UPDATE OF tenant_id, key_columns, value_columns ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION tg_reference_data_table_version_guard()"},{"name":"trg_rdt_upd","function":"tg_set_updated_at()","definition":"CREATE TRIGGER trg_rdt_upd BEFORE UPDATE ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"},{"name":"zz_resource_actor_attribution","function":"set_resource_actor_attribution()","definition":"CREATE TRIGGER zz_resource_actor_attribution BEFORE INSERT OR UPDATE ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION set_resource_actor_attribution()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: reference_data_tables';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_reference_data_tables ON public.reference_data_tables AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'reference'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('reference');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=20871::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='reference_data_rows';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'reference_data_rows' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=rDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM reference_data_tables root\n  WHERE ((root.id = reference_data_rows.table_id) AND (root.tenant_id = reference_data_rows.tenant_id) AND reference_scope_allows(root.id, 'view'::text))))","roles":["authenticated"],"tablename":"reference_data_rows","permissive":"RESTRICTIVE","policyname":"rdr_parent_scope","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"reference_data_rows","permissive":"PERMISSIVE","policyname":"rdr_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"reference_data_rows","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"reference_data_rows_integrity","function":"tg_reference_data_row_integrity()","definition":"CREATE TRIGGER reference_data_rows_integrity BEFORE INSERT OR UPDATE OF table_id, tenant_id, row_data ON public.reference_data_rows FOR EACH ROW EXECUTE FUNCTION tg_reference_data_row_integrity()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: reference_data_rows';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_reference_data_rows ON public.reference_data_rows AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'reference'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.reference_data_rows FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('reference');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=33904::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='reference_data_versions';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'reference_data_versions' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","service_role=arwdDxtm/postgres","authenticated=r/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM reference_data_tables root\n  WHERE ((root.id = reference_data_versions.table_id) AND (root.tenant_id = reference_data_versions.tenant_id) AND reference_scope_allows(root.id, 'view'::text))))","roles":["authenticated"],"tablename":"reference_data_versions","permissive":"RESTRICTIVE","policyname":"rdv_parent_scope","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"reference_data_versions","permissive":"PERMISSIVE","policyname":"reference_data_versions_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"reference_data_versions","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"guard_reference_version_scope","function":"guard_reference_version_scope()","definition":"CREATE TRIGGER guard_reference_version_scope BEFORE INSERT OR UPDATE ON public.reference_data_versions FOR EACH ROW EXECUTE FUNCTION guard_reference_version_scope()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: reference_data_versions';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_reference_data_versions ON public.reference_data_versions AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'reference'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.reference_data_versions FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('reference');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=20382::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='collateral_schedules';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'collateral_schedules' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=arwdDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(is_tenant_member(auth.uid(), tenant_id) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"PERMISSIVE","policyname":"collat read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"PERMISSIVE","policyname":"collat write","schemaname":"public","with_check":"(has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))"},{"cmd":"ALL","qual":"(is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.active = true)))))","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"RESTRICTIVE","policyname":"collat_active_member_gate","schemaname":"public","with_check":"(is_platform_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.active = true)))))"},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"collateral_schedules","permissive":"RESTRICTIVE","policyname":"collateral_schedules_active_insert","schemaname":"public","with_check":"(EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = auth.uid()) AND tm.active)))"},{"cmd":"DELETE","qual":"((EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = auth.uid()) AND tm.active))) AND private.registered_typed_resource_allows(auth.uid(), tenant_id, 'collateral_schedule'::text, id, 'manage'::text))","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"RESTRICTIVE","policyname":"collateral_schedules_typed_delete","schemaname":"public","with_check":null},{"cmd":"UPDATE","qual":"((EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = auth.uid()) AND tm.active))) AND private.registered_typed_resource_allows(auth.uid(), tenant_id, 'collateral_schedule'::text, id, 'edit'::text))","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"RESTRICTIVE","policyname":"collateral_schedules_typed_edit","schemaname":"public","with_check":"((EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = auth.uid()) AND tm.active))) AND private.registered_typed_resource_allows(auth.uid(), tenant_id, 'collateral_schedule'::text, id, 'edit'::text))"},{"cmd":"SELECT","qual":"((EXISTS ( SELECT 1\n   FROM tenant_members tm\n  WHERE ((tm.tenant_id = collateral_schedules.tenant_id) AND (tm.user_id = auth.uid()) AND tm.active))) AND private.registered_typed_resource_allows(auth.uid(), tenant_id, 'collateral_schedule'::text, id, 'view'::text))","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"RESTRICTIVE","policyname":"collateral_schedules_typed_view","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"collateral_schedules","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"data_resource_collateral_schedule_tenant_guard","function":"prevent_extended_registered_root_tenant_change()","definition":"CREATE TRIGGER data_resource_collateral_schedule_tenant_guard BEFORE UPDATE OF tenant_id ON public.collateral_schedules FOR EACH ROW EXECUTE FUNCTION prevent_extended_registered_root_tenant_change()"},{"name":"tg_collat_updated","function":"tg_set_updated_at()","definition":"CREATE TRIGGER tg_collat_updated BEFORE UPDATE ON public.collateral_schedules FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: collateral_schedules';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_collateral_schedules ON public.collateral_schedules AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'collateral'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.collateral_schedules FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('collateral');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=38523::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='collateral_csa_agreements';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'collateral_csa_agreements' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=rDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"csa_assurance_actor(tenant_id, auth.uid())","roles":["authenticated"],"tablename":"collateral_csa_agreements","permissive":"PERMISSIVE","policyname":"collateral_csa_agreement_read","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"private.collateral_csa_typed_allows(auth.uid(), tenant_id, id, 'view'::text)","roles":["authenticated"],"tablename":"collateral_csa_agreements","permissive":"RESTRICTIVE","policyname":"collateral_csa_agreement_typed_view","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"collateral_csa_agreements","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"collateral_csa_agreement_typed_write","function":"guard_collateral_csa_typed_write()","definition":"CREATE TRIGGER collateral_csa_agreement_typed_write BEFORE INSERT OR DELETE OR UPDATE ON public.collateral_csa_agreements FOR EACH ROW EXECUTE FUNCTION guard_collateral_csa_typed_write()"},{"name":"csa_synthetic_tenant_guard","function":"guard_csa_synthetic_tenant()","definition":"CREATE TRIGGER csa_synthetic_tenant_guard BEFORE INSERT OR UPDATE ON public.collateral_csa_agreements FOR EACH ROW EXECUTE FUNCTION guard_csa_synthetic_tenant()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: collateral_csa_agreements';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_collateral_csa_agreements ON public.collateral_csa_agreements AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'collateral'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.collateral_csa_agreements FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('collateral');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=38550::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='collateral_csa_versions';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'collateral_csa_versions' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","anon=arwdDxtm/postgres","authenticated=rDxtm/postgres","service_role=arwdDxtm/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(csa_assurance_actor(tenant_id, auth.uid()) AND (EXISTS ( SELECT 1\n   FROM collateral_csa_agreements root\n  WHERE ((root.id = collateral_csa_versions.agreement_id) AND (root.tenant_id = collateral_csa_versions.tenant_id)))))","roles":["authenticated"],"tablename":"collateral_csa_versions","permissive":"PERMISSIVE","policyname":"collateral_csa_version_read","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"private.collateral_csa_typed_allows(auth.uid(), tenant_id, agreement_id, 'view'::text)","roles":["authenticated"],"tablename":"collateral_csa_versions","permissive":"RESTRICTIVE","policyname":"collateral_csa_version_typed_view","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"collateral_csa_versions","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM $triggers$[{"name":"collateral_csa_version_typed_write","function":"guard_collateral_csa_typed_write()","definition":"CREATE TRIGGER collateral_csa_version_typed_write BEFORE INSERT OR DELETE OR UPDATE ON public.collateral_csa_versions FOR EACH ROW EXECUTE FUNCTION guard_collateral_csa_typed_write()"},{"name":"csa_synthetic_tenant_guard","function":"guard_csa_synthetic_tenant()","definition":"CREATE TRIGGER csa_synthetic_tenant_guard BEFORE INSERT OR UPDATE ON public.collateral_csa_versions FOR EACH ROW EXECUTE FUNCTION guard_csa_synthetic_tenant()"}]$triggers$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: collateral_csa_versions';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_collateral_csa_versions ON public.collateral_csa_versions AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'collateral'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.collateral_csa_versions FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('collateral');
DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=37716::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='collateral_qa_vm_calls';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'collateral_qa_vm_calls' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","service_role=arwdDxtm/postgres","authenticated=r/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"collateral_qa_vm_enabled(tenant_id)","roles":["authenticated"],"tablename":"collateral_qa_vm_calls","permissive":"PERMISSIVE","policyname":"collateral_qa_vm_read","schemaname":"public","with_check":null},{"cmd":"ALL","qual":"private.rlnext_account_allowed(auth.uid(), tenant_id)","roles":["authenticated"],"tablename":"collateral_qa_vm_calls","permissive":"RESTRICTIVE","policyname":"rlnext_account_lifecycle","schemaname":"public","with_check":"private.rlnext_account_allowed(auth.uid(), tenant_id)"}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: collateral_qa_vm_calls';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_collateral_qa_vm_calls ON public.collateral_qa_vm_calls AS RESTRICTIVE FOR SELECT TO authenticated USING (public.wfm_workspace_row_allowed(tenant_id,'collateral'));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.collateral_qa_vm_calls FOR EACH ROW EXECUTE FUNCTION private.wfm_workspace_write_gate('collateral');
CREATE FUNCTION private.wfm_collateral_asset_write_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $asset_gate$
 DECLARE tenant uuid;
 BEGIN
  IF TG_OP IN('UPDATE','DELETE') THEN
   SELECT c.tenant_id INTO tenant FROM public.collateral_qa_vm_calls c WHERE c.id=OLD.call_id;
   IF tenant IS NULL THEN RAISE EXCEPTION 'Current collateral asset parent scope is unavailable' USING ERRCODE='42501';END IF;
   IF current_setting('role',true)='authenticated' THEN PERFORM private.wfm_actor(tenant);END IF;
   PERFORM private.wfm_assert_enabled(tenant,'collateral');
  END IF;
  IF TG_OP IN('INSERT','UPDATE') THEN
   SELECT c.tenant_id INTO tenant FROM public.collateral_qa_vm_calls c WHERE c.id=NEW.call_id;
   IF tenant IS NULL THEN RAISE EXCEPTION 'Current collateral asset parent scope is unavailable' USING ERRCODE='42501';END IF;
   IF current_setting('role',true)='authenticated' THEN PERFORM private.wfm_actor(tenant);END IF;
   PERFORM private.wfm_assert_enabled(tenant,'collateral');
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END $asset_gate$;
 ALTER FUNCTION private.wfm_collateral_asset_write_gate() OWNER TO postgres;
 REVOKE ALL ON FUNCTION private.wfm_collateral_asset_write_gate() FROM PUBLIC,anon,authenticated,service_role;
 DO $guard$ DECLARE c pg_catalog.pg_class%ROWTYPE; old_policies jsonb;old_triggers jsonb; BEGIN
 SELECT * INTO c FROM pg_catalog.pg_class WHERE oid=37763::oid;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname COLLATE "C") INTO old_policies FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='collateral_qa_vm_assets';
 SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) ORDER BY t.tgname COLLATE "C") INTO old_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal;
 IF c.relnamespace IS DISTINCT FROM 'public'::regnamespace OR c.relname IS DISTINCT FROM 'collateral_qa_vm_assets' OR pg_catalog.pg_get_userbyid(c.relowner) IS DISTINCT FROM 'postgres' OR to_jsonb(c.relacl) IS DISTINCT FROM $acl$["postgres=arwdDxtm/postgres","service_role=arwdDxtm/postgres","authenticated=r/postgres"]$acl$::jsonb OR c.relrowsecurity IS DISTINCT FROM true OR old_policies IS DISTINCT FROM $policies$[{"cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM collateral_qa_vm_calls vm\n  WHERE ((vm.id = collateral_qa_vm_assets.call_id) AND collateral_qa_vm_enabled(vm.tenant_id))))","roles":["authenticated"],"tablename":"collateral_qa_vm_assets","permissive":"PERMISSIVE","policyname":"collateral_qa_asset_read","schemaname":"public","with_check":null}]$policies$::jsonb OR old_triggers IS DISTINCT FROM NULL::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='call_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) THEN RAISE EXCEPTION 'Qualified native table or tenant scope changed: collateral_qa_vm_assets';END IF;
 END $guard$;
CREATE POLICY wfm_workspace_feature_collateral_qa_vm_assets ON public.collateral_qa_vm_assets AS RESTRICTIVE FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.collateral_qa_vm_calls vm WHERE vm.id=collateral_qa_vm_assets.call_id AND public.wfm_workspace_row_allowed(vm.tenant_id,'collateral')));
CREATE TRIGGER wfm_workspace_feature_write BEFORE INSERT OR UPDATE OR DELETE ON public.collateral_qa_vm_assets FOR EACH ROW EXECUTE FUNCTION private.wfm_collateral_asset_write_gate();

DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39228::oid AND n.nspname='public' AND p.proname='decide_recon_definition_edit' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_request_id uuid, _approve boolean, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$before39228$CREATE OR REPLACE FUNCTION public.decide_recon_definition_edit(_request_id uuid, _approve boolean, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; q public.recon_definition_governance_requests%ROWTYPE; parent public.recon_definitions%ROWTYPE;
 stage_id uuid; stage_name text; suffix text; mapping jsonb; version_now integer; hash_now text;
BEGIN
 IF _request_id IS NULL OR _approve IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid governance decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='edit';
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('request_missing_or_replayed'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||q.tenant_id::text||':'||q.parent_definition_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.parent_definition_id);
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id FOR UPDATE;
 SELECT * INTO parent FROM public.recon_definitions WHERE id=q.parent_definition_id AND tenant_id=q.tenant_id;
 actor:=private.mapped_recon_governance_actor(q.tenant_id,parent.id,'approve',true);
 IF actor=q.requested_by THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
 IF q.status<>'pending' OR q.mapped_governance_version IS DISTINCT FROM 1 OR parent.governance_state<>'edit_request_pending'
 OR parent.environment<>'production' OR parent.status<>'active' OR parent.retired_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=q.tenant_id AND recon_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed'); END IF;
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,parent.id,q.requested_by);
 mapping:=private.mapped_recon_governance_mapping(q.tenant_id,parent.id);
 SELECT version_number,snapshot_sha256 INTO version_now,hash_now FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
 IF version_now IS DISTINCT FROM q.source_version OR hash_now IS DISTINCT FROM q.source_sha256
 OR private.mapped_recon_governance_hash(mapping) IS DISTINCT FROM q.parent_mapping_fingerprint
 OR mapping IS DISTINCT FROM q.parent_mapping_snapshot
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)) IS DISTINCT FROM q.parent_config_fingerprint THEN PERFORM private.mapped_recon_governance_conflict('frozen_parent_changed'); END IF;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(q.id,actor,'edit_decision');
 UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,decision_reason=btrim(_reason),decided_by=actor,decided_at=clock_timestamp() WHERE id=q.id;
 PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
 IF _approve THEN
  stage_id:=gen_random_uuid();suffix:=' [staging '||substr(stage_id::text,1,8)||']';stage_name:=left(parent.name,80-length(suffix))||suffix;
  INSERT INTO public.recon_definitions(id,tenant_id,name,description,recon_type,sides,rules,extension,status,environment,created_by,governance_state,access_mode,multi_bu_governed,bu_id,visibility,governance_parent_id,staging_original_name,staging_generated_name,starter_template_id,starter_template_code,starter_template_snapshot,tenant_template_id)
  VALUES(stage_id,parent.tenant_id,stage_name,parent.description,parent.recon_type,parent.sides,parent.rules,parent.extension,'draft','staging',q.requested_by,'staging_copy','mapped_exact',parent.multi_bu_governed,parent.bu_id,parent.visibility,parent.id,parent.name,stage_name,parent.starter_template_id,parent.starter_template_code,parent.starter_template_snapshot,parent.tenant_template_id);
  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by) SELECT tenant_id,stage_id,bu_id,actor FROM public.recon_definition_business_units WHERE tenant_id=q.tenant_id AND recon_id=parent.id;
  INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) SELECT tenant_id,stage_id,bu_id,principal_type,principal_id,action,actor FROM public.recon_definition_bu_grants WHERE tenant_id=q.tenant_id AND recon_id=parent.id;
  PERFORM private.mapped_recon_governance_mapping(q.tenant_id,stage_id);
  IF private.mapped_recon_governance_scope_shape(q.tenant_id,stage_id) IS DISTINCT FROM private.mapped_recon_governance_scope_shape(q.tenant_id,parent.id) THEN
   PERFORM private.mapped_recon_governance_conflict('copied_scope_mismatch');
  END IF;
  IF NOT private.recon_authoritative_access_decision_as(q.requested_by,stage_id,'edit') THEN PERFORM private.mapped_recon_governance_conflict('copied_requester_edit_scope_required'); END IF;
  UPDATE public.recon_definition_governance_requests SET staging_definition_id=stage_id WHERE id=q.id;
 END IF;
 UPDATE public.recon_definitions SET governance_state='approved_locked' WHERE id=parent.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage_id,CASE WHEN _approve THEN 'edit_approved' ELSE 'edit_rejected' END,actor,btrim(_reason),q.source_sha256);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.edit_approved' ELSE 'recon.definition.edit_rejected' END,'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',stage_id,'mapping_fingerprint',q.parent_mapping_fingerprint));
 RETURN stage_id;
END $function$
$before39228$) THEN RAISE EXCEPTION 'Current qualified dynamic native body changed: decide_recon_definition_edit';END IF;END $routine_guard$;
CREATE OR REPLACE FUNCTION public.decide_recon_definition_edit(_request_id uuid, _approve boolean, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; q public.recon_definition_governance_requests%ROWTYPE; parent public.recon_definitions%ROWTYPE;
 stage_id uuid; stage_name text; suffix text; mapping jsonb; version_now integer; hash_now text;
BEGIN
 IF _request_id IS NULL OR _approve IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid governance decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='edit';
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('request_missing_or_replayed'); END IF;
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(q.tenant_id);
 PERFORM private.wfm_assert_enabled(q.tenant_id,'recons');

 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||q.tenant_id::text||':'||q.parent_definition_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.parent_definition_id);
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id FOR UPDATE;
 SELECT * INTO parent FROM public.recon_definitions WHERE id=q.parent_definition_id AND tenant_id=q.tenant_id;
 actor:=private.mapped_recon_governance_actor(q.tenant_id,parent.id,'approve',true);
 IF actor=q.requested_by THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
 IF q.status<>'pending' OR q.mapped_governance_version IS DISTINCT FROM 1 OR parent.governance_state<>'edit_request_pending'
 OR parent.environment<>'production' OR parent.status<>'active' OR parent.retired_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=q.tenant_id AND recon_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed'); END IF;
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,parent.id,q.requested_by);
 mapping:=private.mapped_recon_governance_mapping(q.tenant_id,parent.id);
 SELECT version_number,snapshot_sha256 INTO version_now,hash_now FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
 IF version_now IS DISTINCT FROM q.source_version OR hash_now IS DISTINCT FROM q.source_sha256
 OR private.mapped_recon_governance_hash(mapping) IS DISTINCT FROM q.parent_mapping_fingerprint
 OR mapping IS DISTINCT FROM q.parent_mapping_snapshot
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)) IS DISTINCT FROM q.parent_config_fingerprint THEN PERFORM private.mapped_recon_governance_conflict('frozen_parent_changed'); END IF;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(q.id,actor,'edit_decision');
 UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,decision_reason=btrim(_reason),decided_by=actor,decided_at=clock_timestamp() WHERE id=q.id;
 PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
 IF _approve THEN
  stage_id:=gen_random_uuid();suffix:=' [staging '||substr(stage_id::text,1,8)||']';stage_name:=left(parent.name,80-length(suffix))||suffix;
  INSERT INTO public.recon_definitions(id,tenant_id,name,description,recon_type,sides,rules,extension,status,environment,created_by,governance_state,access_mode,multi_bu_governed,bu_id,visibility,governance_parent_id,staging_original_name,staging_generated_name,starter_template_id,starter_template_code,starter_template_snapshot,tenant_template_id)
  VALUES(stage_id,parent.tenant_id,stage_name,parent.description,parent.recon_type,parent.sides,parent.rules,parent.extension,'draft','staging',q.requested_by,'staging_copy','mapped_exact',parent.multi_bu_governed,parent.bu_id,parent.visibility,parent.id,parent.name,stage_name,parent.starter_template_id,parent.starter_template_code,parent.starter_template_snapshot,parent.tenant_template_id);
  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by) SELECT tenant_id,stage_id,bu_id,actor FROM public.recon_definition_business_units WHERE tenant_id=q.tenant_id AND recon_id=parent.id;
  INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) SELECT tenant_id,stage_id,bu_id,principal_type,principal_id,action,actor FROM public.recon_definition_bu_grants WHERE tenant_id=q.tenant_id AND recon_id=parent.id;
  PERFORM private.mapped_recon_governance_mapping(q.tenant_id,stage_id);
  IF private.mapped_recon_governance_scope_shape(q.tenant_id,stage_id) IS DISTINCT FROM private.mapped_recon_governance_scope_shape(q.tenant_id,parent.id) THEN
   PERFORM private.mapped_recon_governance_conflict('copied_scope_mismatch');
  END IF;
  IF NOT private.recon_authoritative_access_decision_as(q.requested_by,stage_id,'edit') THEN PERFORM private.mapped_recon_governance_conflict('copied_requester_edit_scope_required'); END IF;
  UPDATE public.recon_definition_governance_requests SET staging_definition_id=stage_id WHERE id=q.id;
 END IF;
 UPDATE public.recon_definitions SET governance_state='approved_locked' WHERE id=parent.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage_id,CASE WHEN _approve THEN 'edit_approved' ELSE 'edit_rejected' END,actor,btrim(_reason),q.source_sha256);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.edit_approved' ELSE 'recon.definition.edit_rejected' END,'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',stage_id,'mapping_fingerprint',q.parent_mapping_fingerprint));
 RETURN stage_id;
END $function$

;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39228::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_request_id uuid, _approve boolean, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$after39228$CREATE OR REPLACE FUNCTION public.decide_recon_definition_edit(_request_id uuid, _approve boolean, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; q public.recon_definition_governance_requests%ROWTYPE; parent public.recon_definitions%ROWTYPE;
 stage_id uuid; stage_name text; suffix text; mapping jsonb; version_now integer; hash_now text;
BEGIN
 IF _request_id IS NULL OR _approve IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid governance decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='edit';
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('request_missing_or_replayed'); END IF;
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(q.tenant_id);
 PERFORM private.wfm_assert_enabled(q.tenant_id,'recons');

 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||q.tenant_id::text||':'||q.parent_definition_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.parent_definition_id);
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id FOR UPDATE;
 SELECT * INTO parent FROM public.recon_definitions WHERE id=q.parent_definition_id AND tenant_id=q.tenant_id;
 actor:=private.mapped_recon_governance_actor(q.tenant_id,parent.id,'approve',true);
 IF actor=q.requested_by THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
 IF q.status<>'pending' OR q.mapped_governance_version IS DISTINCT FROM 1 OR parent.governance_state<>'edit_request_pending'
 OR parent.environment<>'production' OR parent.status<>'active' OR parent.retired_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=q.tenant_id AND recon_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed'); END IF;
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,parent.id,q.requested_by);
 mapping:=private.mapped_recon_governance_mapping(q.tenant_id,parent.id);
 SELECT version_number,snapshot_sha256 INTO version_now,hash_now FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
 IF version_now IS DISTINCT FROM q.source_version OR hash_now IS DISTINCT FROM q.source_sha256
 OR private.mapped_recon_governance_hash(mapping) IS DISTINCT FROM q.parent_mapping_fingerprint
 OR mapping IS DISTINCT FROM q.parent_mapping_snapshot
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)) IS DISTINCT FROM q.parent_config_fingerprint THEN PERFORM private.mapped_recon_governance_conflict('frozen_parent_changed'); END IF;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(q.id,actor,'edit_decision');
 UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,decision_reason=btrim(_reason),decided_by=actor,decided_at=clock_timestamp() WHERE id=q.id;
 PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
 IF _approve THEN
  stage_id:=gen_random_uuid();suffix:=' [staging '||substr(stage_id::text,1,8)||']';stage_name:=left(parent.name,80-length(suffix))||suffix;
  INSERT INTO public.recon_definitions(id,tenant_id,name,description,recon_type,sides,rules,extension,status,environment,created_by,governance_state,access_mode,multi_bu_governed,bu_id,visibility,governance_parent_id,staging_original_name,staging_generated_name,starter_template_id,starter_template_code,starter_template_snapshot,tenant_template_id)
  VALUES(stage_id,parent.tenant_id,stage_name,parent.description,parent.recon_type,parent.sides,parent.rules,parent.extension,'draft','staging',q.requested_by,'staging_copy','mapped_exact',parent.multi_bu_governed,parent.bu_id,parent.visibility,parent.id,parent.name,stage_name,parent.starter_template_id,parent.starter_template_code,parent.starter_template_snapshot,parent.tenant_template_id);
  INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id,created_by) SELECT tenant_id,stage_id,bu_id,actor FROM public.recon_definition_business_units WHERE tenant_id=q.tenant_id AND recon_id=parent.id;
  INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by) SELECT tenant_id,stage_id,bu_id,principal_type,principal_id,action,actor FROM public.recon_definition_bu_grants WHERE tenant_id=q.tenant_id AND recon_id=parent.id;
  PERFORM private.mapped_recon_governance_mapping(q.tenant_id,stage_id);
  IF private.mapped_recon_governance_scope_shape(q.tenant_id,stage_id) IS DISTINCT FROM private.mapped_recon_governance_scope_shape(q.tenant_id,parent.id) THEN
   PERFORM private.mapped_recon_governance_conflict('copied_scope_mismatch');
  END IF;
  IF NOT private.recon_authoritative_access_decision_as(q.requested_by,stage_id,'edit') THEN PERFORM private.mapped_recon_governance_conflict('copied_requester_edit_scope_required'); END IF;
  UPDATE public.recon_definition_governance_requests SET staging_definition_id=stage_id WHERE id=q.id;
 END IF;
 UPDATE public.recon_definitions SET governance_state='approved_locked' WHERE id=parent.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage_id,CASE WHEN _approve THEN 'edit_approved' ELSE 'edit_rejected' END,actor,btrim(_reason),q.source_sha256);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.edit_approved' ELSE 'recon.definition.edit_rejected' END,'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',stage_id,'mapping_fingerprint',q.parent_mapping_fingerprint));
 RETURN stage_id;
END $function$
$after39228$) THEN RAISE EXCEPTION 'Dynamic native identity or exact postimage changed: decide_recon_definition_edit';END IF;END $routine_guard$;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39230::oid AND n.nspname='public' AND p.proname='decide_recon_definition_promotion' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_request_id uuid, _approve boolean, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$before39230$CREATE OR REPLACE FUNCTION public.decide_recon_definition_promotion(_request_id uuid, _approve boolean, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; q public.recon_definition_governance_requests%ROWTYPE; parent public.recon_definitions%ROWTYPE; stage public.recon_definitions%ROWTYPE;
 next_version integer; current_version integer:=0; current_hash text; mapping jsonb; stage_map jsonb;
BEGIN
 IF _request_id IS NULL OR _approve IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid promotion decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='promotion';
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('request_missing_or_replayed'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||q.tenant_id::text||':'||q.parent_definition_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.parent_definition_id);
 IF q.staging_definition_id<>q.parent_definition_id THEN PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.staging_definition_id); END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id FOR UPDATE;
 SELECT * INTO parent FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.parent_definition_id;
 SELECT * INTO stage FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.staging_definition_id;
 actor:=private.mapped_recon_governance_actor(q.tenant_id,parent.id,'approve',true);
 IF actor=q.requested_by THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
 IF q.status<>'pending' OR q.mapped_governance_version IS DISTINCT FROM 1 OR stage.governance_state<>'promotion_request_pending' THEN PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed'); END IF;
 IF NOT private.recon_authoritative_access_decision_as(actor,stage.id,'approve') THEN PERFORM private.mapped_recon_governance_conflict('current_stage_approve_authority_required'); END IF;
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,parent.id,q.requested_by);
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,stage.id,q.requested_by);
 mapping:=private.mapped_recon_governance_mapping(q.tenant_id,parent.id);stage_map:=private.mapped_recon_governance_mapping(q.tenant_id,stage.id);
 IF private.mapped_recon_governance_effective_config(stage) IS DISTINCT FROM q.snapshot OR private.mapped_recon_governance_hash(q.snapshot) IS DISTINCT FROM q.snapshot_sha256
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)) IS DISTINCT FROM q.parent_config_fingerprint
 OR mapping IS DISTINCT FROM q.parent_mapping_snapshot OR private.mapped_recon_governance_hash(mapping) IS DISTINCT FROM q.parent_mapping_fingerprint
 OR stage_map IS DISTINCT FROM q.staging_mapping_snapshot OR private.mapped_recon_governance_hash(stage_map) IS DISTINCT FROM q.staging_mapping_fingerprint THEN PERFORM private.mapped_recon_governance_conflict('frozen_config_or_mapping_changed'); END IF;
 IF parent.id<>stage.id THEN
  SELECT version_number,snapshot_sha256 INTO current_version,current_hash FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
  IF current_version IS DISTINCT FROM q.source_version OR current_hash IS DISTINCT FROM q.source_sha256 OR parent.governance_state<>'approved_locked' OR parent.retired_at IS NOT NULL OR parent.status<>'active' OR parent.environment<>'production' THEN PERFORM private.mapped_recon_governance_conflict('parent_revision_changed'); END IF;
 ELSIF q.source_version<>0 OR q.source_sha256 IS NOT NULL OR EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id) THEN
  PERFORM private.mapped_recon_governance_conflict('initial_version_already_exists');
 END IF;
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=q.tenant_id AND recon_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('parent_retirement_pending'); END IF;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(q.id,actor,'promotion_decision');
 UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,decision_reason=btrim(_reason),decided_by=actor,decided_at=clock_timestamp() WHERE id=q.id;
 PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
 IF _approve THEN
  UPDATE public.recon_definitions SET name=q.snapshot->>'name',description=q.snapshot->>'description',recon_type=q.snapshot->>'recon_type',sides=q.snapshot->'sides',rules=q.snapshot->'rules',extension=q.snapshot->'extension',environment='production',status='active',governance_state='approved_locked' WHERE id=parent.id;
  IF parent.id<>stage.id THEN UPDATE public.recon_definitions SET governance_state='promoted' WHERE id=stage.id; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO next_version FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id;
  INSERT INTO public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by,approved_mapping_snapshot,approved_mapping_fingerprint) VALUES(q.tenant_id,parent.id,next_version,q.snapshot,q.snapshot_sha256,q.id,actor,q.parent_mapping_snapshot,q.parent_mapping_fingerprint);
 ELSE
  UPDATE public.recon_definitions SET governance_state=CASE WHEN id=parent.id THEN 'development_draft' ELSE 'staging_copy' END WHERE id=stage.id;
 END IF;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage.id,CASE WHEN _approve THEN 'promotion_approved' ELSE 'promotion_rejected' END,actor,btrim(_reason),q.snapshot_sha256);
 IF _approve THEN INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage.id,'version_approved',actor,btrim(_reason),q.snapshot_sha256); END IF;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.promotion_approved' ELSE 'recon.definition.promotion_rejected' END,'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',stage.id,'version_number',next_version,'snapshot_sha256',q.snapshot_sha256,'mapping_fingerprint',q.parent_mapping_fingerprint));
 RETURN CASE WHEN _approve THEN next_version ELSE NULL END;
END $function$
$before39230$) THEN RAISE EXCEPTION 'Current qualified dynamic native body changed: decide_recon_definition_promotion';END IF;END $routine_guard$;
CREATE OR REPLACE FUNCTION public.decide_recon_definition_promotion(_request_id uuid, _approve boolean, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; q public.recon_definition_governance_requests%ROWTYPE; parent public.recon_definitions%ROWTYPE; stage public.recon_definitions%ROWTYPE;
 next_version integer; current_version integer:=0; current_hash text; mapping jsonb; stage_map jsonb;
BEGIN
 IF _request_id IS NULL OR _approve IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid promotion decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='promotion';
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('request_missing_or_replayed'); END IF;
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(q.tenant_id);
 PERFORM private.wfm_assert_enabled(q.tenant_id,'recons');

 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||q.tenant_id::text||':'||q.parent_definition_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.parent_definition_id);
 IF q.staging_definition_id<>q.parent_definition_id THEN PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.staging_definition_id); END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id FOR UPDATE;
 SELECT * INTO parent FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.parent_definition_id;
 SELECT * INTO stage FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.staging_definition_id;
 actor:=private.mapped_recon_governance_actor(q.tenant_id,parent.id,'approve',true);
 IF actor=q.requested_by THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
 IF q.status<>'pending' OR q.mapped_governance_version IS DISTINCT FROM 1 OR stage.governance_state<>'promotion_request_pending' THEN PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed'); END IF;
 IF NOT private.recon_authoritative_access_decision_as(actor,stage.id,'approve') THEN PERFORM private.mapped_recon_governance_conflict('current_stage_approve_authority_required'); END IF;
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,parent.id,q.requested_by);
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,stage.id,q.requested_by);
 mapping:=private.mapped_recon_governance_mapping(q.tenant_id,parent.id);stage_map:=private.mapped_recon_governance_mapping(q.tenant_id,stage.id);
 IF private.mapped_recon_governance_effective_config(stage) IS DISTINCT FROM q.snapshot OR private.mapped_recon_governance_hash(q.snapshot) IS DISTINCT FROM q.snapshot_sha256
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)) IS DISTINCT FROM q.parent_config_fingerprint
 OR mapping IS DISTINCT FROM q.parent_mapping_snapshot OR private.mapped_recon_governance_hash(mapping) IS DISTINCT FROM q.parent_mapping_fingerprint
 OR stage_map IS DISTINCT FROM q.staging_mapping_snapshot OR private.mapped_recon_governance_hash(stage_map) IS DISTINCT FROM q.staging_mapping_fingerprint THEN PERFORM private.mapped_recon_governance_conflict('frozen_config_or_mapping_changed'); END IF;
 IF parent.id<>stage.id THEN
  SELECT version_number,snapshot_sha256 INTO current_version,current_hash FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
  IF current_version IS DISTINCT FROM q.source_version OR current_hash IS DISTINCT FROM q.source_sha256 OR parent.governance_state<>'approved_locked' OR parent.retired_at IS NOT NULL OR parent.status<>'active' OR parent.environment<>'production' THEN PERFORM private.mapped_recon_governance_conflict('parent_revision_changed'); END IF;
 ELSIF q.source_version<>0 OR q.source_sha256 IS NOT NULL OR EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id) THEN
  PERFORM private.mapped_recon_governance_conflict('initial_version_already_exists');
 END IF;
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=q.tenant_id AND recon_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('parent_retirement_pending'); END IF;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(q.id,actor,'promotion_decision');
 UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,decision_reason=btrim(_reason),decided_by=actor,decided_at=clock_timestamp() WHERE id=q.id;
 PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
 IF _approve THEN
  UPDATE public.recon_definitions SET name=q.snapshot->>'name',description=q.snapshot->>'description',recon_type=q.snapshot->>'recon_type',sides=q.snapshot->'sides',rules=q.snapshot->'rules',extension=q.snapshot->'extension',environment='production',status='active',governance_state='approved_locked' WHERE id=parent.id;
  IF parent.id<>stage.id THEN UPDATE public.recon_definitions SET governance_state='promoted' WHERE id=stage.id; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO next_version FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id;
  INSERT INTO public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by,approved_mapping_snapshot,approved_mapping_fingerprint) VALUES(q.tenant_id,parent.id,next_version,q.snapshot,q.snapshot_sha256,q.id,actor,q.parent_mapping_snapshot,q.parent_mapping_fingerprint);
 ELSE
  UPDATE public.recon_definitions SET governance_state=CASE WHEN id=parent.id THEN 'development_draft' ELSE 'staging_copy' END WHERE id=stage.id;
 END IF;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage.id,CASE WHEN _approve THEN 'promotion_approved' ELSE 'promotion_rejected' END,actor,btrim(_reason),q.snapshot_sha256);
 IF _approve THEN INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage.id,'version_approved',actor,btrim(_reason),q.snapshot_sha256); END IF;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.promotion_approved' ELSE 'recon.definition.promotion_rejected' END,'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',stage.id,'version_number',next_version,'snapshot_sha256',q.snapshot_sha256,'mapping_fingerprint',q.parent_mapping_fingerprint));
 RETURN CASE WHEN _approve THEN next_version ELSE NULL END;
END $function$

;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39230::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_request_id uuid, _approve boolean, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$after39230$CREATE OR REPLACE FUNCTION public.decide_recon_definition_promotion(_request_id uuid, _approve boolean, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; q public.recon_definition_governance_requests%ROWTYPE; parent public.recon_definitions%ROWTYPE; stage public.recon_definitions%ROWTYPE;
 next_version integer; current_version integer:=0; current_hash text; mapping jsonb; stage_map jsonb;
BEGIN
 IF _request_id IS NULL OR _approve IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid promotion decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='promotion';
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('request_missing_or_replayed'); END IF;
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(q.tenant_id);
 PERFORM private.wfm_assert_enabled(q.tenant_id,'recons');

 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||q.tenant_id::text||':'||q.parent_definition_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.parent_definition_id);
 IF q.staging_definition_id<>q.parent_definition_id THEN PERFORM private.mapped_recon_governance_lock_scope(q.tenant_id,q.staging_definition_id); END IF;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id FOR UPDATE;
 SELECT * INTO parent FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.parent_definition_id;
 SELECT * INTO stage FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.staging_definition_id;
 actor:=private.mapped_recon_governance_actor(q.tenant_id,parent.id,'approve',true);
 IF actor=q.requested_by THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
 IF q.status<>'pending' OR q.mapped_governance_version IS DISTINCT FROM 1 OR stage.governance_state<>'promotion_request_pending' THEN PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed'); END IF;
 IF NOT private.recon_authoritative_access_decision_as(actor,stage.id,'approve') THEN PERFORM private.mapped_recon_governance_conflict('current_stage_approve_authority_required'); END IF;
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,parent.id,q.requested_by);
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,stage.id,q.requested_by);
 mapping:=private.mapped_recon_governance_mapping(q.tenant_id,parent.id);stage_map:=private.mapped_recon_governance_mapping(q.tenant_id,stage.id);
 IF private.mapped_recon_governance_effective_config(stage) IS DISTINCT FROM q.snapshot OR private.mapped_recon_governance_hash(q.snapshot) IS DISTINCT FROM q.snapshot_sha256
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)) IS DISTINCT FROM q.parent_config_fingerprint
 OR mapping IS DISTINCT FROM q.parent_mapping_snapshot OR private.mapped_recon_governance_hash(mapping) IS DISTINCT FROM q.parent_mapping_fingerprint
 OR stage_map IS DISTINCT FROM q.staging_mapping_snapshot OR private.mapped_recon_governance_hash(stage_map) IS DISTINCT FROM q.staging_mapping_fingerprint THEN PERFORM private.mapped_recon_governance_conflict('frozen_config_or_mapping_changed'); END IF;
 IF parent.id<>stage.id THEN
  SELECT version_number,snapshot_sha256 INTO current_version,current_hash FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
  IF current_version IS DISTINCT FROM q.source_version OR current_hash IS DISTINCT FROM q.source_sha256 OR parent.governance_state<>'approved_locked' OR parent.retired_at IS NOT NULL OR parent.status<>'active' OR parent.environment<>'production' THEN PERFORM private.mapped_recon_governance_conflict('parent_revision_changed'); END IF;
 ELSIF q.source_version<>0 OR q.source_sha256 IS NOT NULL OR EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id) THEN
  PERFORM private.mapped_recon_governance_conflict('initial_version_already_exists');
 END IF;
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=q.tenant_id AND recon_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('parent_retirement_pending'); END IF;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(q.id,actor,'promotion_decision');
 UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,decision_reason=btrim(_reason),decided_by=actor,decided_at=clock_timestamp() WHERE id=q.id;
 PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
 IF _approve THEN
  UPDATE public.recon_definitions SET name=q.snapshot->>'name',description=q.snapshot->>'description',recon_type=q.snapshot->>'recon_type',sides=q.snapshot->'sides',rules=q.snapshot->'rules',extension=q.snapshot->'extension',environment='production',status='active',governance_state='approved_locked' WHERE id=parent.id;
  IF parent.id<>stage.id THEN UPDATE public.recon_definitions SET governance_state='promoted' WHERE id=stage.id; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO next_version FROM public.recon_definition_approved_versions WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id;
  INSERT INTO public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by,approved_mapping_snapshot,approved_mapping_fingerprint) VALUES(q.tenant_id,parent.id,next_version,q.snapshot,q.snapshot_sha256,q.id,actor,q.parent_mapping_snapshot,q.parent_mapping_fingerprint);
 ELSE
  UPDATE public.recon_definitions SET governance_state=CASE WHEN id=parent.id THEN 'development_draft' ELSE 'staging_copy' END WHERE id=stage.id;
 END IF;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage.id,CASE WHEN _approve THEN 'promotion_approved' ELSE 'promotion_rejected' END,actor,btrim(_reason),q.snapshot_sha256);
 IF _approve THEN INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(q.tenant_id,q.id,parent.id,stage.id,'version_approved',actor,btrim(_reason),q.snapshot_sha256); END IF;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.promotion_approved' ELSE 'recon.definition.promotion_rejected' END,'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',stage.id,'version_number',next_version,'snapshot_sha256',q.snapshot_sha256,'mapping_fingerprint',q.parent_mapping_fingerprint));
 RETURN CASE WHEN _approve THEN next_version ELSE NULL END;
END $function$
$after39230$) THEN RAISE EXCEPTION 'Dynamic native identity or exact postimage changed: decide_recon_definition_promotion';END IF;END $routine_guard$;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39227::oid AND n.nspname='public' AND p.proname='request_recon_definition_edit' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _recon_id uuid, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$before39227$CREATE OR REPLACE FUNCTION public.request_recon_definition_edit(_tenant_id uuid, _recon_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; d public.recon_definitions%ROWTYPE; v_id uuid; v_version integer; v_hash text; mapping jsonb;
BEGIN
 IF _tenant_id IS NULL OR _recon_id IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid governance request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||_tenant_id::text||':'||_recon_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,_recon_id);
 SELECT * INTO d FROM public.recon_definitions WHERE id=_recon_id AND tenant_id=_tenant_id;
 IF NOT FOUND OR d.access_mode<>'mapped_exact' OR d.governance_state<>'approved_locked' OR d.environment<>'production'
 OR d.status<>'active' OR d.retired_at IS NOT NULL THEN PERFORM private.mapped_recon_governance_conflict('edit_parent_not_eligible'); END IF;
 actor:=private.mapped_recon_governance_actor(_tenant_id,d.id,'edit',false);
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=_tenant_id AND recon_id=d.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definition_governance_requests WHERE tenant_id=_tenant_id AND parent_definition_id=d.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definitions WHERE tenant_id=_tenant_id AND governance_parent_id=d.id AND governance_state IN ('staging_copy','promotion_request_pending')) THEN PERFORM private.mapped_recon_governance_conflict('pending_workflow_exists'); END IF;
 SELECT version_number,snapshot_sha256 INTO v_version,v_hash FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=d.id ORDER BY version_number DESC LIMIT 1;
 IF v_version IS NULL OR v_hash IS DISTINCT FROM private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(d))
 OR NOT EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=d.id
  AND version_number=v_version AND snapshot=private.recon_definition_config_snapshot(d)
  AND snapshot_sha256=private.mapped_recon_governance_hash(snapshot)
  AND EXISTS(SELECT 1 FROM public.recon_definition_governance_requests evidence_request
   JOIN public.recon_definition_governance_audit evidence_audit ON evidence_audit.request_id=evidence_request.id
   WHERE evidence_request.id=recon_definition_approved_versions.request_id AND evidence_request.tenant_id=_tenant_id
    AND evidence_request.parent_definition_id=d.id AND evidence_request.request_kind='promotion' AND evidence_request.status='approved'
    AND evidence_request.decided_by=recon_definition_approved_versions.approved_by
    AND evidence_request.snapshot=recon_definition_approved_versions.snapshot AND evidence_request.snapshot_sha256=v_hash
    AND evidence_audit.tenant_id=_tenant_id AND evidence_audit.parent_definition_id=d.id
    AND evidence_audit.event_type='version_approved' AND evidence_audit.actor_id=recon_definition_approved_versions.approved_by
    AND evidence_audit.snapshot_sha256=v_hash)) THEN
  PERFORM private.mapped_recon_governance_conflict('approved_version_evidence_required');
 END IF;
 mapping:=private.mapped_recon_governance_mapping(_tenant_id,d.id);
 INSERT INTO public.recon_definition_governance_requests(tenant_id,parent_definition_id,request_kind,requested_by,reason,source_version,source_sha256,mapped_governance_version,parent_config_fingerprint,parent_mapping_snapshot,parent_mapping_fingerprint)
 VALUES(_tenant_id,d.id,'edit',actor,btrim(_reason),v_version,v_hash,1,private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(d)),mapping,private.mapped_recon_governance_hash(mapping)) RETURNING id INTO v_id;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(v_id,actor,'edit_request');
 PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
 UPDATE public.recon_definitions SET governance_state='edit_request_pending' WHERE id=d.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(_tenant_id,v_id,d.id,'edit_requested',actor,btrim(_reason),v_hash);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','recon.definition.edit_requested','recon_definition',d.id::text,jsonb_build_object('request_id',v_id,'approved_version',v_version,'snapshot_sha256',v_hash,'mapping_fingerprint',private.mapped_recon_governance_hash(mapping)));
 RETURN v_id;
END $function$
$before39227$) THEN RAISE EXCEPTION 'Current qualified dynamic native body changed: request_recon_definition_edit';END IF;END $routine_guard$;
CREATE OR REPLACE FUNCTION public.request_recon_definition_edit(_tenant_id uuid, _recon_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; d public.recon_definitions%ROWTYPE; v_id uuid; v_version integer; v_hash text; mapping jsonb;
BEGIN
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(_tenant_id);
 PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

 IF _tenant_id IS NULL OR _recon_id IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid governance request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||_tenant_id::text||':'||_recon_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,_recon_id);
 SELECT * INTO d FROM public.recon_definitions WHERE id=_recon_id AND tenant_id=_tenant_id;
 IF NOT FOUND OR d.access_mode<>'mapped_exact' OR d.governance_state<>'approved_locked' OR d.environment<>'production'
 OR d.status<>'active' OR d.retired_at IS NOT NULL THEN PERFORM private.mapped_recon_governance_conflict('edit_parent_not_eligible'); END IF;
 actor:=private.mapped_recon_governance_actor(_tenant_id,d.id,'edit',false);
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=_tenant_id AND recon_id=d.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definition_governance_requests WHERE tenant_id=_tenant_id AND parent_definition_id=d.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definitions WHERE tenant_id=_tenant_id AND governance_parent_id=d.id AND governance_state IN ('staging_copy','promotion_request_pending')) THEN PERFORM private.mapped_recon_governance_conflict('pending_workflow_exists'); END IF;
 SELECT version_number,snapshot_sha256 INTO v_version,v_hash FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=d.id ORDER BY version_number DESC LIMIT 1;
 IF v_version IS NULL OR v_hash IS DISTINCT FROM private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(d))
 OR NOT EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=d.id
  AND version_number=v_version AND snapshot=private.recon_definition_config_snapshot(d)
  AND snapshot_sha256=private.mapped_recon_governance_hash(snapshot)
  AND EXISTS(SELECT 1 FROM public.recon_definition_governance_requests evidence_request
   JOIN public.recon_definition_governance_audit evidence_audit ON evidence_audit.request_id=evidence_request.id
   WHERE evidence_request.id=recon_definition_approved_versions.request_id AND evidence_request.tenant_id=_tenant_id
    AND evidence_request.parent_definition_id=d.id AND evidence_request.request_kind='promotion' AND evidence_request.status='approved'
    AND evidence_request.decided_by=recon_definition_approved_versions.approved_by
    AND evidence_request.snapshot=recon_definition_approved_versions.snapshot AND evidence_request.snapshot_sha256=v_hash
    AND evidence_audit.tenant_id=_tenant_id AND evidence_audit.parent_definition_id=d.id
    AND evidence_audit.event_type='version_approved' AND evidence_audit.actor_id=recon_definition_approved_versions.approved_by
    AND evidence_audit.snapshot_sha256=v_hash)) THEN
  PERFORM private.mapped_recon_governance_conflict('approved_version_evidence_required');
 END IF;
 mapping:=private.mapped_recon_governance_mapping(_tenant_id,d.id);
 INSERT INTO public.recon_definition_governance_requests(tenant_id,parent_definition_id,request_kind,requested_by,reason,source_version,source_sha256,mapped_governance_version,parent_config_fingerprint,parent_mapping_snapshot,parent_mapping_fingerprint)
 VALUES(_tenant_id,d.id,'edit',actor,btrim(_reason),v_version,v_hash,1,private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(d)),mapping,private.mapped_recon_governance_hash(mapping)) RETURNING id INTO v_id;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(v_id,actor,'edit_request');
 PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
 UPDATE public.recon_definitions SET governance_state='edit_request_pending' WHERE id=d.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(_tenant_id,v_id,d.id,'edit_requested',actor,btrim(_reason),v_hash);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','recon.definition.edit_requested','recon_definition',d.id::text,jsonb_build_object('request_id',v_id,'approved_version',v_version,'snapshot_sha256',v_hash,'mapping_fingerprint',private.mapped_recon_governance_hash(mapping)));
 RETURN v_id;
END $function$

;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39227::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _recon_id uuid, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$after39227$CREATE OR REPLACE FUNCTION public.request_recon_definition_edit(_tenant_id uuid, _recon_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; d public.recon_definitions%ROWTYPE; v_id uuid; v_version integer; v_hash text; mapping jsonb;
BEGIN
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(_tenant_id);
 PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

 IF _tenant_id IS NULL OR _recon_id IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid governance request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||_tenant_id::text||':'||_recon_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,_recon_id);
 SELECT * INTO d FROM public.recon_definitions WHERE id=_recon_id AND tenant_id=_tenant_id;
 IF NOT FOUND OR d.access_mode<>'mapped_exact' OR d.governance_state<>'approved_locked' OR d.environment<>'production'
 OR d.status<>'active' OR d.retired_at IS NOT NULL THEN PERFORM private.mapped_recon_governance_conflict('edit_parent_not_eligible'); END IF;
 actor:=private.mapped_recon_governance_actor(_tenant_id,d.id,'edit',false);
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=_tenant_id AND recon_id=d.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definition_governance_requests WHERE tenant_id=_tenant_id AND parent_definition_id=d.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definitions WHERE tenant_id=_tenant_id AND governance_parent_id=d.id AND governance_state IN ('staging_copy','promotion_request_pending')) THEN PERFORM private.mapped_recon_governance_conflict('pending_workflow_exists'); END IF;
 SELECT version_number,snapshot_sha256 INTO v_version,v_hash FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=d.id ORDER BY version_number DESC LIMIT 1;
 IF v_version IS NULL OR v_hash IS DISTINCT FROM private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(d))
 OR NOT EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=d.id
  AND version_number=v_version AND snapshot=private.recon_definition_config_snapshot(d)
  AND snapshot_sha256=private.mapped_recon_governance_hash(snapshot)
  AND EXISTS(SELECT 1 FROM public.recon_definition_governance_requests evidence_request
   JOIN public.recon_definition_governance_audit evidence_audit ON evidence_audit.request_id=evidence_request.id
   WHERE evidence_request.id=recon_definition_approved_versions.request_id AND evidence_request.tenant_id=_tenant_id
    AND evidence_request.parent_definition_id=d.id AND evidence_request.request_kind='promotion' AND evidence_request.status='approved'
    AND evidence_request.decided_by=recon_definition_approved_versions.approved_by
    AND evidence_request.snapshot=recon_definition_approved_versions.snapshot AND evidence_request.snapshot_sha256=v_hash
    AND evidence_audit.tenant_id=_tenant_id AND evidence_audit.parent_definition_id=d.id
    AND evidence_audit.event_type='version_approved' AND evidence_audit.actor_id=recon_definition_approved_versions.approved_by
    AND evidence_audit.snapshot_sha256=v_hash)) THEN
  PERFORM private.mapped_recon_governance_conflict('approved_version_evidence_required');
 END IF;
 mapping:=private.mapped_recon_governance_mapping(_tenant_id,d.id);
 INSERT INTO public.recon_definition_governance_requests(tenant_id,parent_definition_id,request_kind,requested_by,reason,source_version,source_sha256,mapped_governance_version,parent_config_fingerprint,parent_mapping_snapshot,parent_mapping_fingerprint)
 VALUES(_tenant_id,d.id,'edit',actor,btrim(_reason),v_version,v_hash,1,private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(d)),mapping,private.mapped_recon_governance_hash(mapping)) RETURNING id INTO v_id;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(v_id,actor,'edit_request');
 PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
 UPDATE public.recon_definitions SET governance_state='edit_request_pending' WHERE id=d.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(_tenant_id,v_id,d.id,'edit_requested',actor,btrim(_reason),v_hash);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','recon.definition.edit_requested','recon_definition',d.id::text,jsonb_build_object('request_id',v_id,'approved_version',v_version,'snapshot_sha256',v_hash,'mapping_fingerprint',private.mapped_recon_governance_hash(mapping)));
 RETURN v_id;
END $function$
$after39227$) THEN RAISE EXCEPTION 'Dynamic native identity or exact postimage changed: request_recon_definition_edit';END IF;END $routine_guard$;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=39229::oid AND n.nspname='public' AND p.proname='submit_recon_definition_promotion' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _staging_id uuid, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$before39229$CREATE OR REPLACE FUNCTION public.submit_recon_definition_promotion(_tenant_id uuid, _staging_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; d public.recon_definitions%ROWTYPE; parent public.recon_definitions%ROWTYPE; parent_id uuid;
 snap jsonb; snap_hash text; v_id uuid; source_version integer:=0; source_hash text; parent_mapping jsonb; stage_mapping jsonb;
BEGIN
 IF _tenant_id IS NULL OR _staging_id IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid promotion request' USING ERRCODE='22023'; END IF;
 SELECT coalesce(governance_parent_id,id) INTO parent_id FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_staging_id;
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('draft_missing'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||_tenant_id::text||':'||parent_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,parent_id);
 IF parent_id<>_staging_id THEN PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,_staging_id); END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_staging_id;
 SELECT * INTO parent FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=parent_id;
 IF d.access_mode<>'mapped_exact' OR d.environment NOT IN ('development','staging') OR d.governance_state NOT IN ('development_draft','staging_copy') OR d.retired_at IS NOT NULL OR d.status='archived' THEN PERFORM private.mapped_recon_governance_conflict('editable_mapped_draft_required'); END IF;
 actor:=private.mapped_recon_governance_actor(_tenant_id,d.id,'edit',false);
 PERFORM private.mapped_recon_governance_requester_current(_tenant_id,parent.id,actor);
 IF parent.id<>d.id AND (parent.governance_state<>'approved_locked' OR parent.environment<>'production' OR parent.status<>'active' OR parent.retired_at IS NOT NULL) THEN PERFORM private.mapped_recon_governance_conflict('promotion_parent_not_eligible'); END IF;
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=_tenant_id AND recon_id=parent.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definition_governance_requests WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('pending_workflow_exists'); END IF;
 snap:=private.mapped_recon_governance_effective_config(d);snap_hash:=private.mapped_recon_governance_hash(snap);
 parent_mapping:=private.mapped_recon_governance_mapping(_tenant_id,parent.id);stage_mapping:=private.mapped_recon_governance_mapping(_tenant_id,d.id);
 IF parent.id<>d.id THEN
  SELECT version_number,snapshot_sha256 INTO source_version,source_hash FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
  IF source_version IS NULL OR source_hash IS DISTINCT FROM private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent))
  OR NOT EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id
   AND version_number=source_version AND snapshot=private.recon_definition_config_snapshot(parent)
   AND snapshot_sha256=private.mapped_recon_governance_hash(snapshot)
   AND EXISTS(SELECT 1 FROM public.recon_definition_governance_requests evidence_request
    JOIN public.recon_definition_governance_audit evidence_audit ON evidence_audit.request_id=evidence_request.id
    WHERE evidence_request.id=recon_definition_approved_versions.request_id AND evidence_request.tenant_id=_tenant_id
     AND evidence_request.parent_definition_id=parent.id AND evidence_request.request_kind='promotion' AND evidence_request.status='approved'
     AND evidence_request.decided_by=recon_definition_approved_versions.approved_by
     AND evidence_request.snapshot=recon_definition_approved_versions.snapshot AND evidence_request.snapshot_sha256=source_hash
     AND evidence_audit.tenant_id=_tenant_id AND evidence_audit.parent_definition_id=parent.id
     AND evidence_audit.event_type='version_approved' AND evidence_audit.actor_id=recon_definition_approved_versions.approved_by
     AND evidence_audit.snapshot_sha256=source_hash)) THEN
   PERFORM private.mapped_recon_governance_conflict('parent_version_evidence_required');
  END IF;
 ELSIF EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id) THEN
  PERFORM private.mapped_recon_governance_conflict('initial_version_already_exists');
 END IF;
 INSERT INTO public.recon_definition_governance_requests(tenant_id,parent_definition_id,staging_definition_id,request_kind,requested_by,reason,source_version,source_sha256,snapshot,snapshot_sha256,mapped_governance_version,parent_config_fingerprint,staging_config_fingerprint,parent_mapping_snapshot,parent_mapping_fingerprint,staging_mapping_snapshot,staging_mapping_fingerprint)
 VALUES(_tenant_id,parent.id,d.id,'promotion',actor,btrim(_reason),source_version,source_hash,snap,snap_hash,1,private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)),snap_hash,parent_mapping,private.mapped_recon_governance_hash(parent_mapping),stage_mapping,private.mapped_recon_governance_hash(stage_mapping)) RETURNING id INTO v_id;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(v_id,actor,'promotion_submit');
 PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
 UPDATE public.recon_definitions SET governance_state='promotion_request_pending' WHERE id=d.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(_tenant_id,v_id,parent.id,d.id,'promotion_submitted',actor,btrim(_reason),snap_hash);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','recon.definition.promotion_submitted','recon_definition_governance_request',v_id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',d.id,'snapshot_sha256',snap_hash,'source_version',source_version,'mapping_fingerprint',private.mapped_recon_governance_hash(stage_mapping)));
 RETURN v_id;
END $function$
$before39229$) THEN RAISE EXCEPTION 'Current qualified dynamic native body changed: submit_recon_definition_promotion';END IF;END $routine_guard$;
CREATE OR REPLACE FUNCTION public.submit_recon_definition_promotion(_tenant_id uuid, _staging_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; d public.recon_definitions%ROWTYPE; parent public.recon_definitions%ROWTYPE; parent_id uuid;
 snap jsonb; snap_hash text; v_id uuid; source_version integer:=0; source_hash text; parent_mapping jsonb; stage_mapping jsonb;
BEGIN
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(_tenant_id);
 PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

 IF _tenant_id IS NULL OR _staging_id IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid promotion request' USING ERRCODE='22023'; END IF;
 SELECT coalesce(governance_parent_id,id) INTO parent_id FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_staging_id;
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('draft_missing'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||_tenant_id::text||':'||parent_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,parent_id);
 IF parent_id<>_staging_id THEN PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,_staging_id); END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_staging_id;
 SELECT * INTO parent FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=parent_id;
 IF d.access_mode<>'mapped_exact' OR d.environment NOT IN ('development','staging') OR d.governance_state NOT IN ('development_draft','staging_copy') OR d.retired_at IS NOT NULL OR d.status='archived' THEN PERFORM private.mapped_recon_governance_conflict('editable_mapped_draft_required'); END IF;
 actor:=private.mapped_recon_governance_actor(_tenant_id,d.id,'edit',false);
 PERFORM private.mapped_recon_governance_requester_current(_tenant_id,parent.id,actor);
 IF parent.id<>d.id AND (parent.governance_state<>'approved_locked' OR parent.environment<>'production' OR parent.status<>'active' OR parent.retired_at IS NOT NULL) THEN PERFORM private.mapped_recon_governance_conflict('promotion_parent_not_eligible'); END IF;
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=_tenant_id AND recon_id=parent.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definition_governance_requests WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('pending_workflow_exists'); END IF;
 snap:=private.mapped_recon_governance_effective_config(d);snap_hash:=private.mapped_recon_governance_hash(snap);
 parent_mapping:=private.mapped_recon_governance_mapping(_tenant_id,parent.id);stage_mapping:=private.mapped_recon_governance_mapping(_tenant_id,d.id);
 IF parent.id<>d.id THEN
  SELECT version_number,snapshot_sha256 INTO source_version,source_hash FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
  IF source_version IS NULL OR source_hash IS DISTINCT FROM private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent))
  OR NOT EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id
   AND version_number=source_version AND snapshot=private.recon_definition_config_snapshot(parent)
   AND snapshot_sha256=private.mapped_recon_governance_hash(snapshot)
   AND EXISTS(SELECT 1 FROM public.recon_definition_governance_requests evidence_request
    JOIN public.recon_definition_governance_audit evidence_audit ON evidence_audit.request_id=evidence_request.id
    WHERE evidence_request.id=recon_definition_approved_versions.request_id AND evidence_request.tenant_id=_tenant_id
     AND evidence_request.parent_definition_id=parent.id AND evidence_request.request_kind='promotion' AND evidence_request.status='approved'
     AND evidence_request.decided_by=recon_definition_approved_versions.approved_by
     AND evidence_request.snapshot=recon_definition_approved_versions.snapshot AND evidence_request.snapshot_sha256=source_hash
     AND evidence_audit.tenant_id=_tenant_id AND evidence_audit.parent_definition_id=parent.id
     AND evidence_audit.event_type='version_approved' AND evidence_audit.actor_id=recon_definition_approved_versions.approved_by
     AND evidence_audit.snapshot_sha256=source_hash)) THEN
   PERFORM private.mapped_recon_governance_conflict('parent_version_evidence_required');
  END IF;
 ELSIF EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id) THEN
  PERFORM private.mapped_recon_governance_conflict('initial_version_already_exists');
 END IF;
 INSERT INTO public.recon_definition_governance_requests(tenant_id,parent_definition_id,staging_definition_id,request_kind,requested_by,reason,source_version,source_sha256,snapshot,snapshot_sha256,mapped_governance_version,parent_config_fingerprint,staging_config_fingerprint,parent_mapping_snapshot,parent_mapping_fingerprint,staging_mapping_snapshot,staging_mapping_fingerprint)
 VALUES(_tenant_id,parent.id,d.id,'promotion',actor,btrim(_reason),source_version,source_hash,snap,snap_hash,1,private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)),snap_hash,parent_mapping,private.mapped_recon_governance_hash(parent_mapping),stage_mapping,private.mapped_recon_governance_hash(stage_mapping)) RETURNING id INTO v_id;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(v_id,actor,'promotion_submit');
 PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
 UPDATE public.recon_definitions SET governance_state='promotion_request_pending' WHERE id=d.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(_tenant_id,v_id,parent.id,d.id,'promotion_submitted',actor,btrim(_reason),snap_hash);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','recon.definition.promotion_submitted','recon_definition_governance_request',v_id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',d.id,'snapshot_sha256',snap_hash,'source_version',source_version,'mapping_fingerprint',private.mapped_recon_governance_hash(stage_mapping)));
 RETURN v_id;
END $function$

;
DO $routine_guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=39229::oid AND pg_catalog.pg_get_userbyid(p.proowner)='postgres' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='_tenant_id uuid, _staging_id uuid, _reason text' AND to_jsonb(p.proacl) IS NOT DISTINCT FROM $acl$["postgres=X/postgres","authenticated=X/postgres","service_role=X/postgres"]$acl$::jsonb AND pg_catalog.pg_get_functiondef(p.oid)=$after39229$CREATE OR REPLACE FUNCTION public.submit_recon_definition_promotion(_tenant_id uuid, _staging_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE actor uuid; d public.recon_definitions%ROWTYPE; parent public.recon_definitions%ROWTYPE; parent_id uuid;
 snap jsonb; snap_hash text; v_id uuid; source_version integer:=0; source_hash text; parent_mapping jsonb; stage_mapping jsonb;
BEGIN
 -- Registered availability at the actual native tenant scope; original mapped authority/independent checker/audit program follows unchanged.
 PERFORM private.wfm_actor(_tenant_id);
 PERFORM private.wfm_assert_enabled(_tenant_id,'recons');

 IF _tenant_id IS NULL OR _staging_id IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid promotion request' USING ERRCODE='22023'; END IF;
 SELECT coalesce(governance_parent_id,id) INTO parent_id FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_staging_id;
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('draft_missing'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mapped-recon:'||_tenant_id::text||':'||parent_id::text,0));
 PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,parent_id);
 IF parent_id<>_staging_id THEN PERFORM private.mapped_recon_governance_lock_scope(_tenant_id,_staging_id); END IF;
 SELECT * INTO d FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=_staging_id;
 SELECT * INTO parent FROM public.recon_definitions WHERE tenant_id=_tenant_id AND id=parent_id;
 IF d.access_mode<>'mapped_exact' OR d.environment NOT IN ('development','staging') OR d.governance_state NOT IN ('development_draft','staging_copy') OR d.retired_at IS NOT NULL OR d.status='archived' THEN PERFORM private.mapped_recon_governance_conflict('editable_mapped_draft_required'); END IF;
 actor:=private.mapped_recon_governance_actor(_tenant_id,d.id,'edit',false);
 PERFORM private.mapped_recon_governance_requester_current(_tenant_id,parent.id,actor);
 IF parent.id<>d.id AND (parent.governance_state<>'approved_locked' OR parent.environment<>'production' OR parent.status<>'active' OR parent.retired_at IS NOT NULL) THEN PERFORM private.mapped_recon_governance_conflict('promotion_parent_not_eligible'); END IF;
 IF EXISTS(SELECT 1 FROM public.recon_retirement_requests WHERE tenant_id=_tenant_id AND recon_id=parent.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.recon_definition_governance_requests WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id AND status='pending') THEN PERFORM private.mapped_recon_governance_conflict('pending_workflow_exists'); END IF;
 snap:=private.mapped_recon_governance_effective_config(d);snap_hash:=private.mapped_recon_governance_hash(snap);
 parent_mapping:=private.mapped_recon_governance_mapping(_tenant_id,parent.id);stage_mapping:=private.mapped_recon_governance_mapping(_tenant_id,d.id);
 IF parent.id<>d.id THEN
  SELECT version_number,snapshot_sha256 INTO source_version,source_hash FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id ORDER BY version_number DESC LIMIT 1;
  IF source_version IS NULL OR source_hash IS DISTINCT FROM private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent))
  OR NOT EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id
   AND version_number=source_version AND snapshot=private.recon_definition_config_snapshot(parent)
   AND snapshot_sha256=private.mapped_recon_governance_hash(snapshot)
   AND EXISTS(SELECT 1 FROM public.recon_definition_governance_requests evidence_request
    JOIN public.recon_definition_governance_audit evidence_audit ON evidence_audit.request_id=evidence_request.id
    WHERE evidence_request.id=recon_definition_approved_versions.request_id AND evidence_request.tenant_id=_tenant_id
     AND evidence_request.parent_definition_id=parent.id AND evidence_request.request_kind='promotion' AND evidence_request.status='approved'
     AND evidence_request.decided_by=recon_definition_approved_versions.approved_by
     AND evidence_request.snapshot=recon_definition_approved_versions.snapshot AND evidence_request.snapshot_sha256=source_hash
     AND evidence_audit.tenant_id=_tenant_id AND evidence_audit.parent_definition_id=parent.id
     AND evidence_audit.event_type='version_approved' AND evidence_audit.actor_id=recon_definition_approved_versions.approved_by
     AND evidence_audit.snapshot_sha256=source_hash)) THEN
   PERFORM private.mapped_recon_governance_conflict('parent_version_evidence_required');
  END IF;
 ELSIF EXISTS(SELECT 1 FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent.id) THEN
  PERFORM private.mapped_recon_governance_conflict('initial_version_already_exists');
 END IF;
 INSERT INTO public.recon_definition_governance_requests(tenant_id,parent_definition_id,staging_definition_id,request_kind,requested_by,reason,source_version,source_sha256,snapshot,snapshot_sha256,mapped_governance_version,parent_config_fingerprint,staging_config_fingerprint,parent_mapping_snapshot,parent_mapping_fingerprint,staging_mapping_snapshot,staging_mapping_fingerprint)
 VALUES(_tenant_id,parent.id,d.id,'promotion',actor,btrim(_reason),source_version,source_hash,snap,snap_hash,1,private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(parent)),snap_hash,parent_mapping,private.mapped_recon_governance_hash(parent_mapping),stage_mapping,private.mapped_recon_governance_hash(stage_mapping)) RETURNING id INTO v_id;
 INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(v_id,actor,'promotion_submit');
 PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
 UPDATE public.recon_definitions SET governance_state='promotion_request_pending' WHERE id=d.id;
 INSERT INTO public.recon_definition_governance_audit(tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256) VALUES(_tenant_id,v_id,parent.id,d.id,'promotion_submitted',actor,btrim(_reason),snap_hash);
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) VALUES(actor,_tenant_id,'workspace','recon.definition.promotion_submitted','recon_definition_governance_request',v_id::text,jsonb_build_object('parent_definition_id',parent.id,'staging_definition_id',d.id,'snapshot_sha256',snap_hash,'source_version',source_version,'mapping_fingerprint',private.mapped_recon_governance_hash(stage_mapping)));
 RETURN v_id;
END $function$
$after39229$) THEN RAISE EXCEPTION 'Dynamic native identity or exact postimage changed: submit_recon_definition_promotion';END IF;END $routine_guard$;
