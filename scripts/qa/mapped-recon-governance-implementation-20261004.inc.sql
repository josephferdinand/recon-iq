-- Source/native proposal only. BOTH fresh target catalogs must qualify the
-- guarded packet before parent apply; no row backfill or identity/mapping reset.

ALTER TABLE public.recon_definition_governance_requests
 ADD COLUMN mapped_governance_version integer,
 ADD COLUMN parent_config_fingerprint text,
 ADD COLUMN staging_config_fingerprint text,
 ADD COLUMN parent_mapping_snapshot jsonb,
 ADD COLUMN parent_mapping_fingerprint text,
 ADD COLUMN staging_mapping_snapshot jsonb,
 ADD COLUMN staging_mapping_fingerprint text;
ALTER TABLE public.recon_definition_approved_versions
 ADD COLUMN approved_mapping_snapshot jsonb,
 ADD COLUMN approved_mapping_fingerprint text;

CREATE FUNCTION private.mapped_recon_governance_hash(_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(_value::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_hash(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_conflict(_code text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='recon_governance.'||_code; END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_conflict(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_lock_scope(_tenant uuid,_recon uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
 -- A single per-parent workflow lock precedes request/definition locks. Parent
 -- Root FOR UPDATE fences new owner rows. Owner FOR UPDATE separately fences
 -- new grant FK references; FOR SHARE would still admit their KEY SHARE lock.
 PERFORM 1 FROM public.recon_definitions WHERE id=_recon AND tenant_id=_tenant FOR UPDATE;
 PERFORM 1 FROM public.recon_definition_business_units WHERE recon_id=_recon ORDER BY bu_id FOR UPDATE;
 PERFORM 1 FROM public.recon_definition_bu_grants WHERE recon_id=_recon ORDER BY id FOR SHARE;
 -- Protect the active owner/ancestor association used by native effective scope.
 PERFORM 1 FROM public.business_units b WHERE b.tenant_id=_tenant AND EXISTS(
  SELECT 1 FROM public.recon_definition_business_units o JOIN public.business_units owner ON owner.id=o.bu_id AND owner.tenant_id=o.tenant_id
  WHERE o.recon_id=_recon AND o.tenant_id=_tenant AND owner.path <@ b.path) ORDER BY b.id FOR UPDATE;
 PERFORM 1 FROM public.tenant_groups g WHERE g.tenant_id=_tenant AND EXISTS(
  SELECT 1 FROM public.recon_definition_bu_grants grant_row WHERE grant_row.recon_id=_recon
   AND grant_row.principal_type='group' AND grant_row.principal_id=g.id) ORDER BY g.id FOR UPDATE;
 PERFORM 1 FROM public.bu_user_assignments a WHERE a.tenant_id=_tenant AND EXISTS(
  SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND g.tenant_id=_tenant
   AND g.principal_type='user' AND g.principal_id=a.user_id) ORDER BY a.bu_id,a.user_id FOR SHARE;
 PERFORM 1 FROM public.bu_group_assignments a WHERE a.tenant_id=_tenant AND EXISTS(
  SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND g.tenant_id=_tenant
   AND g.principal_type='group' AND g.principal_id=a.group_id) ORDER BY a.bu_id,a.group_id FOR SHARE;
 PERFORM 1 FROM public.tenant_group_members m WHERE EXISTS(
  SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND g.tenant_id=_tenant
   AND g.principal_type='group' AND g.principal_id=m.group_id) ORDER BY m.group_id,m.user_id FOR SHARE;
 PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant AND EXISTS (
  SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND
   ((g.principal_type='user' AND g.principal_id=m.user_id) OR
    (g.principal_type='group' AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=g.principal_id AND gm.user_id=m.user_id))))
 ORDER BY m.user_id FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_lock_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_mapping(_tenant uuid,_recon uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE d public.recon_definitions%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO d FROM public.recon_definitions WHERE id=_recon AND tenant_id=_tenant;
 IF NOT FOUND OR d.access_mode<>'mapped_exact' THEN PERFORM private.mapped_recon_governance_conflict('mapped_scope_required'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.recon_definition_business_units WHERE tenant_id=_tenant AND recon_id=_recon)
 OR EXISTS(SELECT 1 FROM public.recon_definition_business_units o LEFT JOIN public.business_units b ON b.id=o.bu_id AND b.tenant_id=o.tenant_id
  WHERE o.recon_id=_recon AND (o.tenant_id<>_tenant OR b.id IS NULL OR b.is_archived)) THEN
  PERFORM private.mapped_recon_governance_conflict('owner_scope_inactive_or_cross_tenant');
 END IF;
 IF EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND
  (g.tenant_id<>_tenant OR NOT EXISTS(SELECT 1 FROM public.recon_definition_business_units o WHERE o.tenant_id=_tenant AND o.recon_id=_recon AND o.bu_id=g.bu_id)
   OR (g.principal_type='user' AND NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_tenant AND m.user_id=g.principal_id AND m.active))
   OR (g.principal_type='group' AND NOT EXISTS(SELECT 1 FROM public.tenant_groups t WHERE t.id=g.principal_id AND t.tenant_id=_tenant))
   OR (g.principal_type='user' AND NOT EXISTS(
     SELECT 1 FROM public.bu_user_assignments a
     JOIN public.business_units assigned ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id AND NOT assigned.is_archived
     JOIN public.business_units owner ON owner.id=g.bu_id AND owner.tenant_id=g.tenant_id AND NOT owner.is_archived
     WHERE a.tenant_id=_tenant AND a.user_id=g.principal_id
     AND (owner.id=assigned.id OR (a.inherit_descendants AND owner.path <@ assigned.path))))
   OR (g.principal_type='group' AND NOT EXISTS(
     SELECT 1 FROM public.bu_group_assignments a
     JOIN public.business_units assigned ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id AND NOT assigned.is_archived
     JOIN public.business_units owner ON owner.id=g.bu_id AND owner.tenant_id=g.tenant_id AND NOT owner.is_archived
     WHERE a.tenant_id=_tenant AND a.group_id=g.principal_id
     AND (owner.id=assigned.id OR (a.inherit_descendants AND owner.path <@ assigned.path))))
   OR g.principal_type NOT IN ('user','group'))) THEN
  PERFORM private.mapped_recon_governance_conflict('grant_scope_inactive_or_cross_tenant');
 END IF;
 result:=jsonb_build_object('contract_version',1,'tenant_id',_tenant,'recon_id',_recon,'access_mode',d.access_mode,'multi_bu_governed',d.multi_bu_governed,
  'owners',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.bu_id),'[]') FROM public.recon_definition_business_units o WHERE o.tenant_id=_tenant AND o.recon_id=_recon),
  'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.recon_definition_bu_grants g WHERE g.tenant_id=_tenant AND g.recon_id=_recon),
  'owner_ancestors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'tenant_id',b.tenant_id,'path',b.path,'is_archived',b.is_archived) ORDER BY b.id),'[]') FROM public.business_units b WHERE b.tenant_id=_tenant AND EXISTS(SELECT 1 FROM public.recon_definition_business_units o JOIN public.business_units owner ON owner.id=o.bu_id AND owner.tenant_id=o.tenant_id WHERE o.tenant_id=_tenant AND o.recon_id=_recon AND owner.path <@ b.path)),
  'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'tenant_id',g.tenant_id,'bu_id',g.bu_id) ORDER BY g.id),'[]') FROM public.tenant_groups g WHERE g.tenant_id=_tenant AND EXISTS(SELECT 1 FROM public.recon_definition_bu_grants a WHERE a.recon_id=_recon AND a.principal_type='group' AND a.principal_id=g.id)),
  'user_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.bu_id,a.user_id),'[]') FROM public.bu_user_assignments a WHERE a.tenant_id=_tenant AND EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND g.principal_type='user' AND g.principal_id=a.user_id)),
  'group_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.bu_id,a.group_id),'[]') FROM public.bu_group_assignments a WHERE a.tenant_id=_tenant AND EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND g.principal_type='group' AND g.principal_id=a.group_id)),
  'group_members',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.group_id,m.user_id),'[]') FROM public.tenant_group_members m WHERE EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.tenant_id=_tenant AND g.recon_id=_recon AND g.principal_type='group' AND g.principal_id=m.group_id)),
  'principal_memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.user_id),'[]') FROM public.tenant_members m WHERE m.tenant_id=_tenant AND EXISTS(SELECT 1 FROM public.recon_definition_bu_grants g WHERE g.recon_id=_recon AND ((g.principal_type='user' AND g.principal_id=m.user_id) OR (g.principal_type='group' AND EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=g.principal_id AND gm.user_id=m.user_id))))));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_mapping(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_actor(_tenant uuid,_recon uuid,_action text,_checker boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
DECLARE actor uuid:=auth.uid(); m public.tenant_members%ROWTYPE; policy public.tenant_security_settings%ROWTYPE;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'authenticated ordinary actor required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO m FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=actor AND active FOR SHARE;
 IF NOT FOUND THEN PERFORM private.mapped_recon_governance_conflict('current_membership_required'); END IF;
 IF _checker AND m.role::text<>'tenant_admin' THEN PERFORM private.mapped_recon_governance_conflict('current_checker_authority_required'); END IF;
 IF NOT private.recon_authoritative_access_decision_as(actor,_recon,_action) THEN
  PERFORM private.mapped_recon_governance_conflict(CASE WHEN _checker THEN 'current_approve_authority_required' ELSE 'current_edit_authority_required' END);
 END IF;
 SELECT * INTO policy FROM public.tenant_security_settings WHERE tenant_id=_tenant FOR SHARE;
 IF FOUND AND policy.mfa_required AND auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
  PERFORM private.mapped_recon_governance_conflict('mfa_assurance_required');
 END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_actor(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_requester_current(_tenant uuid,_parent uuid,_requester uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_requester AND active FOR SHARE;
 IF NOT FOUND OR NOT private.recon_authoritative_access_decision_as(_requester,_parent,'edit') THEN
  PERFORM private.mapped_recon_governance_conflict('requester_scope_revoked');
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_requester_current(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_effective_config(_d public.recon_definitions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,private AS $$
 SELECT (CASE WHEN _d.staging_generated_name IS NOT NULL AND _d.name=_d.staging_generated_name
  THEN private.recon_definition_config_snapshot(_d)-'name'||jsonb_build_object('name',_d.staging_original_name)
  ELSE private.recon_definition_config_snapshot(_d) END)
$$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_effective_config(public.recon_definitions) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.request_recon_definition_edit(_tenant_id uuid,_recon_id uuid,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.decide_recon_definition_edit(_request_id uuid,_approve boolean,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.submit_recon_definition_promotion(_tenant_id uuid,_staging_id uuid,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.decide_recon_definition_promotion(_request_id uuid,_approve boolean,_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
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
END $$;
