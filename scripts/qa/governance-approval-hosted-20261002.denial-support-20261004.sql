-- REVIEW SOURCE ONLY. Parent supplies guarded migration/version/rollback/apply.
-- No direct public denial-writer: these helpers are private and unexecutable by
-- anon/authenticated; existing native mutation functions call them as definer.
CREATE TABLE private.governance_denial_receipts (
  actor_id uuid NOT NULL,
  request_key uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL,
  tenant_id uuid,
  audit_id bigint NOT NULL REFERENCES public.audit_log(id) ON DELETE RESTRICT,
  error_response jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_key,payload_sha256)
);
ALTER TABLE private.governance_denial_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.governance_denial_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.governance_denial_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.governance_audit_scope_labels(_tenant uuid,_group uuid,_workspace uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $scope$
 SELECT coalesce((SELECT jsonb_strip_nulls(jsonb_build_object(
   'group_id',g.id,'group_name',g.name,'bu_id',b.id,'bu_name',b.name,
   'workspace_id',w.id,'workspace_name',w.name))
 FROM public.tenant_groups g
 LEFT JOIN public.business_units b ON b.id=g.bu_id AND b.tenant_id=g.tenant_id
 LEFT JOIN public.workspaces w ON w.id=_workspace AND w.tenant_id=g.tenant_id
 WHERE g.tenant_id=_tenant AND g.id=_group
   AND private.governance_membership_active(_tenant,auth.uid())), '{}'::jsonb);
$scope$;

CREATE FUNCTION private.governance_denial_record(
 _operation text,_tenant uuid,_key uuid,_payload jsonb,_code text,_native_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $record$
DECLARE a uuid:=auth.uid(); k uuid:=coalesce(_key,gen_random_uuid());
 h text:=encode(sha256(convert_to(coalesce(_payload,'{}'::jsonb)::text,'UTF8')),'hex');
 cached private.governance_denial_receipts%ROWTYPE;
 scoped boolean; actor_role text; ctx jsonb; response jsonb; aid bigint;
 correlation uuid:=gen_random_uuid(); status_code integer;
 action_name text; known_resource_type text; known_resource_id text;
 r public.governance_membership_requests%ROWTYPE; i public.access_review_items%ROWTYPE;
 msg text:=left(regexp_replace(coalesce(_native_message,'Governance operation refused'),'[[:cntrl:]]',' ','g'),500);
BEGIN
 IF a IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'Authenticated native actor required' USING ERRCODE='42501';
 END IF;
 IF _operation NOT IN ('membership.submit','membership.decide','membership.withdraw','review.campaign.create','review.decide')
   OR _code NOT IN ('42501','PT409','23505','22023') THEN
   RAISE EXCEPTION 'Unsupported native refusal' USING ERRCODE='22023';
 END IF;
 status_code:=CASE _code WHEN '42501' THEN 403 WHEN 'PT409' THEN 409 WHEN '23505' THEN 409 ELSE 400 END;
 PERFORM pg_advisory_xact_lock(hashtextextended('governance.denial.'||a::text||k::text,0));
 SELECT * INTO cached FROM private.governance_denial_receipts
   WHERE actor_id=a AND request_key=k AND payload_sha256=h;
 IF FOUND THEN
   PERFORM set_config('response.status',cached.error_response->>'status',true);
   RETURN cached.error_response-'status';
 END IF;
 scoped:=private.governance_membership_active(_tenant,a);
 actor_role:=CASE WHEN scoped THEN
   (SELECT role::text FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=a AND active)
   ELSE 'authenticated_unscoped' END;
 action_name:=CASE WHEN _operation LIKE 'membership.%' THEN 'governance.membership.denied' ELSE 'governance.access_review.denied' END;
 ctx:=jsonb_build_object('outcome','denied','reason',msg,'error_code',_code,
   'http_status',status_code,'attempted_operation',_operation,'actor_role',actor_role,
   'assurance',auth.jwt()->>'aal','request_key',k,'correlation_id',correlation,
   'change_committed',false);
 -- Only actual scoped rows may produce linked request/review references. Never
 -- attribute a client-supplied foreign tenant/resource to the audit event.
 IF scoped AND _operation IN ('membership.decide','membership.withdraw') THEN
   SELECT * INTO r FROM public.governance_membership_requests
   WHERE tenant_id=_tenant AND id=(_payload->>'request_id')::uuid
     AND (requested_by=a OR private.governance_membership_active(_tenant,a,true));
   IF FOUND THEN
     known_resource_type:='governance_membership_request';known_resource_id:=r.id::text;
     correlation:=r.correlation_id;
     ctx:=ctx||private.governance_audit_scope_labels(_tenant,r.group_id,r.workspace_id)
       ||jsonb_build_object('request_id',r.id,'environment',r.environment,'version',r.version,
         'expected_version',_payload->'expected_version','correlation_id',correlation,
         'scope_label','Refused tenant group membership operation; no change committed');
   END IF;
 ELSIF scoped AND _operation='review.decide' THEN
   SELECT * INTO i FROM public.access_review_items
     WHERE tenant_id=_tenant AND id=(_payload->>'id')::uuid;
   IF FOUND AND private.governance_review_can_read(i) THEN
     known_resource_type:='access_review_items';known_resource_id:=i.id::text;
     ctx:=ctx||private.governance_audit_scope_labels(_tenant,(i.subject_scope->>'group_id')::uuid,(i.subject_scope->>'workspace_id')::uuid)
       ||jsonb_build_object('review_id',i.id,'campaign_id',i.campaign_id,'version',i.governance_version,
         'expected_version',_payload->'expected_version','environment',private.governance_review_row(i)->>'environment',
         'scope_label','Refused access review decision; no change committed');
   END IF;
 END IF;
 IF known_resource_id IS NULL THEN
   ctx:=ctx||jsonb_build_object('scope_label',CASE WHEN scoped THEN 'Refused governance operation in current tenant' ELSE 'Refused unscoped governance operation' END);
 END IF;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context,occurred_at)
 VALUES(a,CASE WHEN scoped THEN _tenant ELSE NULL END,CASE WHEN scoped THEN 'tenant' ELSE 'api' END,
   action_name,known_resource_type,known_resource_id,ctx,clock_timestamp()) RETURNING id INTO aid;
 -- The real existing audit chain trigger computes prev_hash/row_hash. No hash,
 -- actor override, profile data or arbitrary payload is supplied here.
 response:=jsonb_build_object('code',_code,'message',msg,'details',NULL,'hint',NULL,
   'audit_id',aid::text,'correlation_id',correlation,'status',status_code);
 INSERT INTO private.governance_denial_receipts(actor_id,request_key,payload_sha256,operation,tenant_id,audit_id,error_response)
 VALUES(a,k,h,_operation,CASE WHEN scoped THEN _tenant ELSE NULL END,aid,response);
 PERFORM set_config('response.status',status_code::text,true);
 RETURN response-'status';
END;
$record$;

CREATE FUNCTION private.governance_denial_replay(_operation text,_tenant uuid,_key uuid,_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $replay$
DECLARE a uuid:=auth.uid(); h text:=encode(sha256(convert_to(coalesce(_payload,'{}'::jsonb)::text,'UTF8')),'hex');
 cached private.governance_denial_receipts%ROWTYPE;
BEGIN
 IF a IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR _key IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('governance.denial.'||a::text||_key::text,0));
 -- Existing successful receipts keep the native success/replay path and all its
 -- fresh authority checks. A later denied collision cannot poison that replay.
 IF EXISTS(SELECT 1 FROM private.governance_membership_operations WHERE tenant_id=_tenant AND request_key=_key AND actor_id=a)
   OR EXISTS(SELECT 1 FROM public.governance_access_review_receipts WHERE tenant_id=_tenant AND request_key=_key AND actor_id=a) THEN RETURN NULL; END IF;
 SELECT * INTO cached FROM private.governance_denial_receipts WHERE actor_id=a AND request_key=_key AND payload_sha256=h;
 IF FOUND THEN
   IF cached.operation<>_operation THEN
     RETURN private.governance_denial_record(_operation,_tenant,_key,_payload||jsonb_build_object('_denial_operation',_operation),'23505','Request key belongs to a different governance operation');
   END IF;
   PERFORM set_config('response.status',cached.error_response->>'status',true);
   RETURN cached.error_response-'status';
 END IF;
 IF EXISTS(SELECT 1 FROM private.governance_denial_receipts WHERE actor_id=a AND request_key=_key) THEN
   RETURN private.governance_denial_record(_operation,_tenant,_key,_payload,'23505','Request key collision');
 END IF;
 RETURN NULL;
END;
$replay$;

REVOKE ALL ON FUNCTION private.governance_audit_scope_labels(uuid,uuid,uuid),
 private.governance_denial_record(text,uuid,uuid,jsonb,text,text),
 private.governance_denial_replay(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
