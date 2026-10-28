-- Narrow native workflow guards. Assemble only after BOTH actual catalogs
-- qualify the original trigger definitions, table contracts and assurance.
CREATE TABLE private.mapped_recon_governance_transitions (
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 request_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('edit_request','edit_decision','promotion_submit','promotion_decision')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(transaction_id,request_id,purpose)
);
ALTER TABLE private.mapped_recon_governance_transitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.mapped_recon_governance_transitions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_transition(_request uuid,_purpose text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,private,auth AS $$
 SELECT auth.role()='authenticated' AND current_setting('role',true)='authenticated' AND EXISTS (
  SELECT 1 FROM private.mapped_recon_governance_transitions t
  WHERE t.transaction_id=txid_current() AND t.request_id=_request
   AND t.actor_id=auth.uid() AND t.purpose=_purpose)
$$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_transition(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_scope_shape(_tenant uuid,_recon uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object(
 'owners',(SELECT coalesce(jsonb_agg(bu_id ORDER BY bu_id),'[]') FROM public.recon_definition_business_units WHERE tenant_id=_tenant AND recon_id=_recon),
 'grants',(SELECT coalesce(jsonb_agg(jsonb_build_array(bu_id,principal_type,principal_id,action) ORDER BY bu_id,principal_type,principal_id,action),'[]') FROM public.recon_definition_bu_grants WHERE tenant_id=_tenant AND recon_id=_recon))
$$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_scope_shape(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_stage_insert(_new public.recon_definitions)
RETURNS public.recon_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
DECLARE q public.recon_definition_governance_requests%ROWTYPE; p public.recon_definitions%ROWTYPE; marker uuid;
BEGIN
 marker:=nullif(current_setting('fvi.recon_governance_request_id',true),'')::uuid;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=marker;
 IF NOT FOUND OR NOT private.mapped_recon_governance_transition(q.id,'edit_decision')
 OR q.request_kind<>'edit' OR q.status<>'approved' OR q.mapped_governance_version IS DISTINCT FROM 1
 OR q.decided_by IS DISTINCT FROM auth.uid() OR q.requested_by=auth.uid() OR q.staging_definition_id IS NOT NULL THEN
  PERFORM private.mapped_recon_governance_conflict('native_stage_authorization_required');
 END IF;
 SELECT * INTO p FROM public.recon_definitions WHERE tenant_id=q.tenant_id AND id=q.parent_definition_id;
 PERFORM private.mapped_recon_governance_actor(q.tenant_id,p.id,'approve',true);
 PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,p.id,q.requested_by);
 IF _new.id=p.id OR _new.tenant_id IS DISTINCT FROM p.tenant_id OR _new.created_by IS DISTINCT FROM q.requested_by
 OR _new.governance_parent_id IS DISTINCT FROM p.id OR _new.access_mode<>'mapped_exact'
 OR _new.governance_state<>'staging_copy' OR _new.environment<>'staging' OR _new.status<>'draft'
 OR _new.multi_bu_governed IS DISTINCT FROM p.multi_bu_governed OR NOT _new.multi_bu_governed
 OR _new.bu_id IS DISTINCT FROM p.bu_id OR _new.visibility IS DISTINCT FROM p.visibility
 OR _new.starter_template_id IS DISTINCT FROM p.starter_template_id OR _new.starter_template_code IS DISTINCT FROM p.starter_template_code
 OR _new.starter_template_snapshot IS DISTINCT FROM p.starter_template_snapshot OR _new.tenant_template_id IS DISTINCT FROM p.tenant_template_id
 OR _new.retired_at IS NOT NULL OR _new.retirement_request_id IS NOT NULL
 OR _new.staging_original_name IS DISTINCT FROM p.name OR _new.staging_generated_name IS DISTINCT FROM _new.name
 OR private.mapped_recon_governance_effective_config(_new) IS DISTINCT FROM private.recon_definition_config_snapshot(p)
 OR private.mapped_recon_governance_hash(private.recon_definition_config_snapshot(p)) IS DISTINCT FROM q.parent_config_fingerprint
 OR private.mapped_recon_governance_mapping(q.tenant_id,p.id) IS DISTINCT FROM q.parent_mapping_snapshot THEN
  PERFORM private.mapped_recon_governance_conflict('native_stage_snapshot_mismatch');
 END IF;
 RETURN _new;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_stage_insert(public.recon_definitions) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_update(_old public.recon_definitions,_new public.recon_definitions)
RETURNS public.recon_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
DECLARE q public.recon_definition_governance_requests%ROWTYPE; marker uuid; purpose text; permitted boolean:=false;
BEGIN
 IF (to_jsonb(_old)-ARRAY['name','description','recon_type','sides','rules','extension','governance_state','environment','status','updated_at'])
 IS DISTINCT FROM (to_jsonb(_new)-ARRAY['name','description','recon_type','sides','rules','extension','governance_state','environment','status','updated_at']) THEN
  PERFORM private.mapped_recon_governance_conflict('native_identity_or_scope_immutable');
 END IF;
 IF _old.governance_state=_new.governance_state AND _old.governance_state IN ('development_draft','staging_copy') THEN
  IF _new.environment IS DISTINCT FROM _old.environment OR _new.status IS DISTINCT FROM _old.status THEN
   PERFORM private.mapped_recon_governance_conflict('native_draft_lifecycle_immutable');
  END IF;
  PERFORM private.mapped_recon_governance_actor(_old.tenant_id,_old.id,'edit',false);
  IF NOT private.recon_authoritative_access_decision_as(auth.uid(),_old.id,'read') THEN
   PERFORM private.mapped_recon_governance_conflict('native_current_read_required');
  END IF;
  RETURN _new;
 END IF;
 -- Pure trigger timestamps on a locked row do not change its configuration.
 IF to_jsonb(_old)-'updated_at'=to_jsonb(_new)-'updated_at' THEN RETURN _new; END IF;
 marker:=nullif(current_setting('fvi.recon_governance_request_id',true),'')::uuid;
 SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=marker AND tenant_id=_old.tenant_id;
 IF NOT FOUND OR q.mapped_governance_version IS DISTINCT FROM 1 THEN
  PERFORM private.mapped_recon_governance_conflict('native_workflow_receipt_required');
 END IF;
 purpose:=CASE WHEN q.request_kind='edit' AND q.status='pending' THEN 'edit_request'
 WHEN q.request_kind='edit' THEN 'edit_decision' WHEN q.status='pending' THEN 'promotion_submit' ELSE 'promotion_decision' END;
 IF NOT private.mapped_recon_governance_transition(q.id,purpose) THEN
  PERFORM private.mapped_recon_governance_conflict('native_workflow_receipt_required');
 END IF;
 IF q.status='pending' THEN
  IF q.requested_by IS DISTINCT FROM auth.uid() THEN PERFORM private.mapped_recon_governance_conflict('native_requester_mismatch'); END IF;
  PERFORM private.mapped_recon_governance_actor(q.tenant_id,_old.id,'edit',false);
 ELSE
  IF q.decided_by IS DISTINCT FROM auth.uid() OR q.requested_by=auth.uid() THEN PERFORM private.mapped_recon_governance_conflict('independent_checker_required'); END IF;
  PERFORM private.mapped_recon_governance_actor(q.tenant_id,q.parent_definition_id,'approve',true);
  PERFORM private.mapped_recon_governance_requester_current(q.tenant_id,q.parent_definition_id,q.requested_by);
 END IF;
 IF q.request_kind='edit' AND q.parent_definition_id=_old.id THEN
  permitted:=(q.status='pending' AND _old.governance_state='approved_locked' AND _new.governance_state='edit_request_pending')
   OR (q.status IN ('approved','rejected') AND _old.governance_state='edit_request_pending' AND _new.governance_state='approved_locked');
 ELSIF q.request_kind='promotion' THEN
  permitted:=(q.status='pending' AND q.staging_definition_id=_old.id AND _old.governance_state IN ('development_draft','staging_copy') AND _new.governance_state='promotion_request_pending')
   OR (q.status='rejected' AND q.staging_definition_id=_old.id AND _old.governance_state='promotion_request_pending' AND _new.governance_state=CASE WHEN q.parent_definition_id=_old.id THEN 'development_draft' ELSE 'staging_copy' END)
   OR (q.status='approved' AND q.parent_definition_id=_old.id AND _old.governance_state IN ('approved_locked','promotion_request_pending') AND _new.governance_state='approved_locked')
   OR (q.status='approved' AND q.staging_definition_id=_old.id AND q.parent_definition_id<>_old.id AND _old.governance_state='promotion_request_pending' AND _new.governance_state='promoted');
 END IF;
 IF NOT coalesce(permitted,false) THEN PERFORM private.mapped_recon_governance_conflict('native_invalid_transition'); END IF;
 IF q.request_kind='promotion' AND q.status='approved' AND q.parent_definition_id=_old.id THEN
  IF _new.environment<>'production' OR _new.status<>'active'
  OR private.recon_definition_config_snapshot(_new) IS DISTINCT FROM q.snapshot
  OR private.mapped_recon_governance_hash(q.snapshot) IS DISTINCT FROM q.snapshot_sha256
  OR private.mapped_recon_governance_mapping(q.tenant_id,_old.id) IS DISTINCT FROM q.parent_mapping_snapshot THEN
   PERFORM private.mapped_recon_governance_conflict('native_approved_snapshot_mismatch');
  END IF;
 ELSIF private.recon_definition_config_snapshot(_old) IS DISTINCT FROM private.recon_definition_config_snapshot(_new)
 OR _old.environment IS DISTINCT FROM _new.environment OR _old.status IS DISTINCT FROM _new.status THEN
  PERFORM private.mapped_recon_governance_conflict('native_transition_config_immutable');
 END IF;
 RETURN _new;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_update(public.recon_definitions,public.recon_definitions) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.mapped_recon_governance_stage_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE q public.recon_definition_governance_requests%ROWTYPE;
BEGIN
 IF NEW.access_mode='mapped_exact' AND NEW.governance_state='staging_copy' THEN
  SELECT * INTO q FROM public.recon_definition_governance_requests WHERE tenant_id=NEW.tenant_id
   AND staging_definition_id=NEW.id AND request_kind='edit' AND status='approved' AND mapped_governance_version=1;
  IF NOT FOUND OR private.mapped_recon_governance_scope_shape(NEW.tenant_id,NEW.id)
   IS DISTINCT FROM private.mapped_recon_governance_scope_shape(NEW.tenant_id,q.parent_definition_id) THEN
   PERFORM private.mapped_recon_governance_conflict('native_exact_copy_required');
  END IF;
  PERFORM private.mapped_recon_governance_mapping(NEW.tenant_id,NEW.id);
  PERFORM private.mapped_recon_governance_requester_current(NEW.tenant_id,NEW.id,q.requested_by);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_stage_complete() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER mapped_recon_governance_stage_complete AFTER INSERT ON public.recon_definitions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.mapped_recon_governance_stage_complete();

CREATE FUNCTION private.mapped_recon_governance_request_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
DECLARE purpose text;
BEGIN
 IF OLD.mapped_governance_version IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN PERFORM private.mapped_recon_governance_conflict('native_request_history_immutable'); END IF;
 purpose:=CASE WHEN OLD.request_kind='edit' THEN 'edit_decision' ELSE 'promotion_decision' END;
 IF NOT private.mapped_recon_governance_transition(OLD.id,purpose)
 OR (to_jsonb(OLD)-ARRAY['status','decision_reason','decided_by','decided_at','staging_definition_id'])
 IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','decision_reason','decided_by','decided_at','staging_definition_id']) THEN
  PERFORM private.mapped_recon_governance_conflict('native_request_snapshot_immutable');
 END IF;
 IF OLD.status='pending' THEN
  IF NEW.status NOT IN ('approved','rejected') OR NEW.decided_by IS DISTINCT FROM auth.uid()
   OR NEW.decided_by=OLD.requested_by OR NEW.staging_definition_id IS DISTINCT FROM OLD.staging_definition_id THEN
   PERFORM private.mapped_recon_governance_conflict('native_decision_shape_required');
  END IF;
 ELSIF NOT (OLD.status='approved' AND OLD.request_kind='edit' AND OLD.staging_definition_id IS NULL
  AND NEW.staging_definition_id IS NOT NULL AND to_jsonb(OLD)-'staging_definition_id'=to_jsonb(NEW)-'staging_definition_id') THEN
  PERFORM private.mapped_recon_governance_conflict('request_stale_or_replayed');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_request_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mapped_recon_governance_request_immutable BEFORE UPDATE OR DELETE ON public.recon_definition_governance_requests
 FOR EACH ROW EXECUTE FUNCTION private.mapped_recon_governance_request_immutable();

CREATE POLICY mapped_recon_governance_requester_read ON public.recon_definition_governance_requests
 FOR SELECT TO authenticated USING (mapped_governance_version=1 AND requested_by=auth.uid()
 AND private.recon_authoritative_access_decision(parent_definition_id,'read'));

CREATE FUNCTION private.mapped_recon_governance_run(_new public.recon_runs)
RETURNS public.recon_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $$
DECLARE d public.recon_definitions%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.recon_definitions WHERE tenant_id=_new.tenant_id AND id=_new.definition_id FOR SHARE;
 IF NOT FOUND OR _new.run_by IS DISTINCT FROM auth.uid() THEN PERFORM private.mapped_recon_governance_conflict('native_run_actor_or_tenant_mismatch'); END IF;
 PERFORM private.mapped_recon_governance_actor(d.tenant_id,d.id,'run',false);
 IF NOT private.recon_authoritative_access_decision_as(auth.uid(),d.id,'read') THEN PERFORM private.mapped_recon_governance_conflict('native_current_read_required'); END IF;
 IF NOT ((d.environment='production' AND d.status='active' AND d.governance_state IN ('approved_locked','edit_request_pending'))
 OR (d.environment='development' AND d.governance_state='development_draft')
 OR (d.environment='staging' AND d.governance_state='staging_copy')) THEN
  PERFORM private.mapped_recon_governance_conflict('native_run_governance_not_ready');
 END IF;
 RETURN _new;
END $$;
REVOKE ALL ON FUNCTION private.mapped_recon_governance_run(public.recon_runs) FROM PUBLIC,anon,authenticated,service_role;
