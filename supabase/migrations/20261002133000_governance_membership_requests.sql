-- Additive membership governance. Parent applies in one guarded transaction.
-- Existing identities, role mappings, membership rows and audit history are not rewritten.
DO $guard$
BEGIN
  IF to_regclass('public.governance_membership_requests') IS NOT NULL
     OR to_regclass('private.governance_membership_operations') IS NOT NULL THEN
    RAISE EXCEPTION 'Membership governance preimage is not empty; inspect migration ledger before replay';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('public.user_bu_scope(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required authoritative membership dependencies missing';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('tenant_members','active'),('tenant_groups','bu_id'),('tenant_group_roles','role_id'),
    ('workspaces','business_unit_id'),('workspace_members','tenant_id'),
    ('rbac_roles','is_assignable'),('permissions','category'),('tenant_environments','is_active'),
    ('audit_log','context'),('recon_definition_bu_grants','principal_id'),
    ('data_resource_registry_grants','principal_group_id'),('data_resource_bu_grants','principal_id'),('recon_permissions','principal_id')
  ) AS required(t,c) WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=required.t AND column_name=required.c
  )) THEN RAISE EXCEPTION 'Membership governance dependency ABI mismatch'; END IF;
END $guard$;

CREATE TABLE public.governance_membership_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  bu_id uuid NOT NULL REFERENCES public.business_units(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('prod','dev','sandbox','uat')),
  group_id uuid NOT NULL REFERENCES public.tenant_groups(id) ON DELETE RESTRICT,
  requested_rights text[] NOT NULL,
  scope_snapshot jsonb NOT NULL,
  request_reason text NOT NULL CHECK (length(btrim(request_reason)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  CHECK ((status='pending' AND approved_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status<>'pending' AND approved_by IS NOT NULL AND decided_at IS NOT NULL AND length(btrim(decision_reason)) BETWEEN 1 AND 2000)),
  CHECK (status NOT IN ('approved','rejected') OR approved_by <> requested_by)
);
CREATE INDEX governance_membership_queue_idx ON public.governance_membership_requests(tenant_id,status,requested_at DESC,id);
CREATE INDEX governance_membership_requester_idx ON public.governance_membership_requests(tenant_id,requested_by,requested_at DESC,id);
CREATE UNIQUE INDEX governance_membership_one_pending_idx ON public.governance_membership_requests(tenant_id,requested_by,group_id) WHERE status='pending';

CREATE TABLE private.governance_membership_operations (
  tenant_id uuid NOT NULL,
  request_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(tenant_id,request_key)
);
CREATE TABLE public.governance_membership_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.governance_membership_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('governance.membership.request','governance.membership.approve','governance.membership.reject','governance.membership.withdraw')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL,
  reason text NOT NULL,
  outcome text NOT NULL,
  correlation_id uuid NOT NULL,
  audit_id bigint NOT NULL
);
CREATE INDEX governance_membership_events_request_idx ON public.governance_membership_events(tenant_id,request_id,id);

CREATE FUNCTION private.governance_membership_active(_tenant uuid,_user uuid,_admin boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT _user IS NOT NULL AND EXISTS(SELECT 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND user_id=_user AND active AND (NOT _admin OR role::text='tenant_admin'))
$$;

-- Pin the complete existing group effect, rather than pretending membership is workspace-only.
-- No profile/vault/raw business rows are read here.
CREATE FUNCTION private.governance_membership_scope(_tenant uuid,_bu uuid,_workspace uuid,_group uuid,_env text,_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE result jsonb; rights text[];
BEGIN
  IF NOT private.governance_membership_active(_tenant,_user) THEN RAISE EXCEPTION 'Active tenant membership required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_units WHERE id=_bu AND tenant_id=_tenant AND NOT is_archived)
    OR NOT EXISTS(SELECT 1 FROM public.tenant_groups WHERE id=_group AND tenant_id=_tenant AND bu_id=_bu)
    OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=_workspace AND tenant_id=_tenant AND business_unit_id=_bu AND status='active')
    OR NOT EXISTS(SELECT 1 FROM public.tenant_environments WHERE tenant_id=_tenant AND env::text=_env AND is_active)
  THEN RAISE EXCEPTION 'Current tenant/BU/group/workspace/environment association required' USING ERRCODE='42501'; END IF;
  -- user_bu_scope has no platform-admin shortcut. An actual tenant admin is explicitly accepted.
  IF NOT private.governance_membership_active(_tenant,_user,true) AND (
    NOT EXISTS(SELECT 1 FROM public.user_bu_scope(_user,_tenant) s WHERE s=_bu)
    OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=_workspace AND tenant_id=_tenant AND user_id=_user)
  ) THEN RAISE EXCEPTION 'Current BU and workspace access required' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.tenant_group_roles gr JOIN public.rbac_roles r ON r.id=gr.role_id
    WHERE gr.group_id=_group AND (NOT r.is_assignable OR (r.tenant_id IS NOT NULL AND r.tenant_id<>_tenant)
      OR r.key ~* '(admin|owner|platform|system)' OR r.key NOT IN ('tenant_analyst','tenant_viewer') AND r.is_system))
    OR EXISTS(SELECT 1 FROM public.tenant_group_roles gr JOIN public.rbac_role_permissions rp ON rp.role_id=gr.role_id
      JOIN public.permissions p ON p.id=rp.permission_id WHERE gr.group_id=_group
      AND ((p.category IN ('admin','security','billing') OR p.resource ~* '(^|[.])(role|user|group|tenant|platform|vault|environment)([.]|$)') AND p.action NOT IN ('read','view')))
    OR EXISTS(SELECT 1 FROM public.bu_group_assignments WHERE group_id=_group AND (tenant_id<>_tenant OR role::text='bu_admin'))
  THEN RAISE EXCEPTION 'Administrative or cross-tenant group privileges cannot be requested' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.recon_definition_bu_grants WHERE principal_type='group' AND principal_id=_group AND tenant_id<>_tenant)
    OR EXISTS(SELECT 1 FROM public.recon_permissions g JOIN public.recon_definitions d ON d.id=g.recon_id WHERE g.principal_type='group' AND g.principal_id=_group AND d.tenant_id<>_tenant)
    OR EXISTS(SELECT 1 FROM public.data_resource_registry_grants WHERE principal_type='group' AND principal_group_id=_group AND tenant_id<>_tenant)
    OR EXISTS(SELECT 1 FROM public.data_resource_bu_grants WHERE principal_type='group' AND principal_id=_group AND tenant_id<>_tenant)
  THEN RAISE EXCEPTION 'Cross-tenant resource rights cannot be requested' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT permission_id ORDER BY permission_id),'{}'::text[]) INTO rights FROM (
    SELECT rp.permission_id FROM public.tenant_group_roles gr JOIN public.rbac_role_permissions rp ON rp.role_id=gr.role_id WHERE gr.group_id=_group
    UNION SELECT 'reconciliation:'||recon_id::text||':'||action FROM public.recon_definition_bu_grants WHERE principal_type='group' AND principal_id=_group
    UNION SELECT 'legacy_reconciliation:'||recon_id::text||':'||permission FROM public.recon_permissions WHERE principal_type='group' AND principal_id=_group
    UNION SELECT 'data_resource:'||registry_id::text||':'||action FROM public.data_resource_registry_grants WHERE principal_type='group' AND principal_group_id=_group
    UNION SELECT 'legacy_data_resource:'||resource_type||':'||resource_id::text||':'||action FROM public.data_resource_bu_grants WHERE principal_type='group' AND principal_id=_group
  ) all_rights;
  SELECT jsonb_build_object(
    'scope_label','Tenant group membership; existing group rights can apply across workspaces',
    'group', (SELECT jsonb_build_object('id',id,'tenant_id',tenant_id,'bu_id',bu_id,'is_system',is_system,'preset_key',preset_key) FROM public.tenant_groups WHERE id=_group),
    'workspace', (SELECT jsonb_build_object('id',id,'tenant_id',tenant_id,'business_unit_id',business_unit_id,'status',status) FROM public.workspaces WHERE id=_workspace),
    'environment',_env,
    'requested_rights',to_jsonb(rights),
    'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'key',r.key,'tenant_id',r.tenant_id,'is_system',r.is_system,'is_assignable',r.is_assignable) ORDER BY r.id)
      FROM public.tenant_group_roles gr JOIN public.rbac_roles r ON r.id=gr.role_id WHERE gr.group_id=_group),'[]'::jsonb),
    'bu_assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('bu_id',bu_id,'tenant_id',tenant_id,'role',role,'inherit_descendants',inherit_descendants) ORDER BY bu_id) FROM public.bu_group_assignments WHERE group_id=_group),'[]'::jsonb),
    'reconciliation_grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'tenant_id',g.tenant_id,'bu_id',g.bu_id,'recon_id',g.recon_id,'action',g.action,'environment',d.environment) ORDER BY g.id)
      FROM public.recon_definition_bu_grants g JOIN public.recon_definitions d ON d.id=g.recon_id AND d.tenant_id=g.tenant_id
      WHERE g.principal_type='group' AND g.principal_id=_group),'[]'::jsonb),
    'legacy_reconciliation_grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'recon_id',g.recon_id,'permission',g.permission,'tenant_id',d.tenant_id,'environment',d.environment) ORDER BY g.id) FROM public.recon_permissions g JOIN public.recon_definitions d ON d.id=g.recon_id WHERE g.principal_type='group' AND g.principal_id=_group),'[]'::jsonb),
    'legacy_data_resource_grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'tenant_id',tenant_id,'bu_id',bu_id,'resource_type',resource_type,'resource_id',resource_id,'action',action) ORDER BY id)
      FROM public.data_resource_bu_grants WHERE principal_type='group' AND principal_id=_group),'[]'::jsonb),
    'data_resource_grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'tenant_id',tenant_id,'bu_id',bu_id,'registry_id',registry_id,'action',action) ORDER BY id)
      FROM public.data_resource_registry_grants WHERE principal_type='group' AND principal_group_id=_group),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

-- Serialize current authorization/grant catalogs while qualifying and committing a mutation.
-- SHARE also fences phantom new rights; row locks alone would not fence an inserted role/grant.
CREATE FUNCTION private.governance_membership_lock_scope()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  LOCK TABLE public.tenant_members,public.business_units,public.tenant_groups,public.workspace_members,
    public.workspaces,public.tenant_environments,public.bu_user_assignments,public.bu_group_assignments,
    public.tenant_group_roles,public.rbac_roles,public.rbac_role_permissions,public.permissions,
    public.recon_definition_bu_grants,public.recon_definitions,public.data_resource_registry_grants,public.recon_permissions,public.data_resource_bu_grants IN SHARE MODE;
  LOCK TABLE public.tenant_group_members IN SHARE ROW EXCLUSIVE MODE;
END $$;

CREATE FUNCTION private.governance_membership_record(_r public.governance_membership_requests,_action text,_actor uuid,_reason text,_outcome text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE audit_id bigint;
BEGIN
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(_actor,_r.tenant_id,'tenant',_action,'governance_membership_request',_r.id::text,
    jsonb_build_object('request_id',_r.id,'actor_role',CASE WHEN private.governance_membership_active(_r.tenant_id,_actor,true) THEN 'tenant_admin' ELSE 'tenant_member' END,
      'bu_id',_r.bu_id,'workspace_id',_r.workspace_id,'group_id',_r.group_id,'environment',_r.environment,
      'reason',_reason,'version',_r.version,'correlation_id',_r.correlation_id,'outcome',_outcome,
      'scope_label','Tenant group membership; existing group rights can apply across workspaces')) RETURNING id INTO audit_id;
  INSERT INTO public.governance_membership_events(tenant_id,request_id,actor_user_id,action,version,reason,outcome,correlation_id,audit_id)
  VALUES(_r.tenant_id,_r.id,_actor,_action,_r.version,_reason,_outcome,_r.correlation_id,audit_id);
  RETURN audit_id;
END $$;

CREATE FUNCTION public.submit_governance_membership_request(_tenant_id uuid,_bu_id uuid,_workspace_id uuid,_group_id uuid,_environment text,_reason text,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; op private.governance_membership_operations; r public.governance_membership_requests; snapshot jsonb; result jsonb; aid bigint;
BEGIN
  IF _request_key IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Reason and request key required' USING ERRCODE='22023'; END IF;
  IF NOT private.governance_membership_active(_tenant_id,actor) THEN RAISE EXCEPTION 'Active tenant membership required' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object('operation','submit','bu_id',_bu_id,'workspace_id',_workspace_id,'group_id',_group_id,'environment',_environment,'reason',btrim(_reason));
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||_request_key::text,0));
  SELECT * INTO op FROM private.governance_membership_operations WHERE tenant_id=_tenant_id AND request_key=_request_key;
  IF FOUND THEN
    IF op.actor_id<>actor OR op.payload<>payload THEN RAISE EXCEPTION 'Request key collision' USING ERRCODE='23505'; END IF;
    PERFORM private.governance_membership_scope(_tenant_id,_bu_id,_workspace_id,_group_id,_environment,actor);
    RETURN op.result;
  END IF;
  PERFORM private.governance_membership_lock_scope();
  snapshot:=private.governance_membership_scope(_tenant_id,_bu_id,_workspace_id,_group_id,_environment,actor);
  IF EXISTS(SELECT 1 FROM public.tenant_group_members WHERE group_id=_group_id AND user_id=actor) THEN RAISE EXCEPTION 'Already a group member' USING ERRCODE='23505'; END IF;
  INSERT INTO public.governance_membership_requests(tenant_id,requested_by,bu_id,workspace_id,environment,group_id,requested_rights,scope_snapshot,request_reason)
  VALUES(_tenant_id,actor,_bu_id,_workspace_id,_environment,_group_id,ARRAY(SELECT jsonb_array_elements_text(snapshot->'requested_rights')),snapshot,btrim(_reason)) RETURNING * INTO r;
  aid:=private.governance_membership_record(r,'governance.membership.request',actor,btrim(_reason),'pending');
  result:=jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'correlation_id',r.correlation_id,'audit_id',aid::text,'outcome','pending');
  INSERT INTO private.governance_membership_operations VALUES(_tenant_id,_request_key,actor,payload,result);
  RETURN result;
END $$;

CREATE FUNCTION public.decide_governance_membership_request(_tenant_id uuid,_request_id uuid,_expected_version integer,_decision text,_reason text,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; op private.governance_membership_operations; r public.governance_membership_requests; result jsonb; aid bigint; outcome text;
BEGIN
  IF _request_key IS NULL OR _expected_version IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 OR _decision IS NULL OR _decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Decision, current version, reason and request key required' USING ERRCODE='22023'; END IF;
  PERFORM private.governance_membership_lock_scope();
  IF NOT private.governance_membership_active(_tenant_id,actor,true) THEN RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object('operation','decide','request_id',_request_id,'expected_version',_expected_version,'decision',_decision,'reason',btrim(_reason));
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||_request_key::text,0));
  SELECT * INTO op FROM private.governance_membership_operations WHERE tenant_id=_tenant_id AND request_key=_request_key;
  IF FOUND THEN
    IF op.actor_id<>actor OR op.payload<>payload THEN RAISE EXCEPTION 'Request key collision' USING ERRCODE='23505'; END IF;
    RETURN op.result;
  END IF;
  SELECT * INTO r FROM public.governance_membership_requests WHERE tenant_id=_tenant_id AND id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found in current tenant' USING ERRCODE='42501'; END IF;
  IF actor=r.requested_by THEN RAISE EXCEPTION 'Independent checker required' USING ERRCODE='42501'; END IF;
  IF r.version<>_expected_version OR r.status<>'pending' THEN RAISE EXCEPTION 'Stale request version or closed request' USING ERRCODE='40001'; END IF;
  IF _decision='approve' THEN
    IF private.governance_membership_scope(r.tenant_id,r.bu_id,r.workspace_id,r.group_id,r.environment,r.requested_by)<>r.scope_snapshot THEN RAISE EXCEPTION 'Group rights or association changed; renewed request required' USING ERRCODE='40001'; END IF;
    -- Do not re-grant after an unrelated manual grant/revocation. Require this exact insert.
    INSERT INTO public.tenant_group_members(group_id,user_id,added_by) VALUES(r.group_id,r.requested_by,actor);
    outcome:='grant_confirmed';
  ELSE outcome:='no_access_granted'; END IF;
  UPDATE public.governance_membership_requests SET status=CASE WHEN _decision='approve' THEN 'approved' ELSE 'rejected' END,
    version=version+1,approved_by=actor,decided_at=now(),decision_reason=btrim(_reason) WHERE id=r.id RETURNING * INTO r;
  aid:=private.governance_membership_record(r,'governance.membership.'||_decision,actor,btrim(_reason),outcome);
  result:=jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'correlation_id',r.correlation_id,'audit_id',aid::text,'outcome',outcome);
  INSERT INTO private.governance_membership_operations VALUES(_tenant_id,_request_key,actor,payload,result);
  RETURN result;
END $$;

CREATE FUNCTION public.withdraw_governance_membership_request(_tenant_id uuid,_request_id uuid,_expected_version integer,_reason text,_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE actor uuid:=auth.uid(); payload jsonb; op private.governance_membership_operations; r public.governance_membership_requests; result jsonb; aid bigint;
BEGIN
  IF _request_key IS NULL OR _expected_version IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Current version, reason and request key required' USING ERRCODE='22023'; END IF;
  PERFORM private.governance_membership_lock_scope();
  IF NOT private.governance_membership_active(_tenant_id,actor) THEN RAISE EXCEPTION 'Active tenant membership required' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object('operation','withdraw','request_id',_request_id,'expected_version',_expected_version,'reason',btrim(_reason));
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||_request_key::text,0));
  SELECT * INTO op FROM private.governance_membership_operations WHERE tenant_id=_tenant_id AND request_key=_request_key;
  IF FOUND THEN
    IF op.actor_id<>actor OR op.payload<>payload THEN RAISE EXCEPTION 'Request key collision' USING ERRCODE='23505'; END IF;
    RETURN op.result;
  END IF;
  SELECT * INTO r FROM public.governance_membership_requests WHERE tenant_id=_tenant_id AND id=_request_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by<>actor THEN RAISE EXCEPTION 'Current requester required' USING ERRCODE='42501'; END IF;
  IF r.version<>_expected_version OR r.status<>'pending' THEN RAISE EXCEPTION 'Stale request version or closed request' USING ERRCODE='40001'; END IF;
  UPDATE public.governance_membership_requests SET status='withdrawn',version=version+1,approved_by=actor,decided_at=now(),decision_reason=btrim(_reason) WHERE id=r.id RETURNING * INTO r;
  aid:=private.governance_membership_record(r,'governance.membership.withdraw',actor,btrim(_reason),'no_access_granted');
  result:=jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'correlation_id',r.correlation_id,'audit_id',aid::text,'outcome','no_access_granted');
  INSERT INTO private.governance_membership_operations VALUES(_tenant_id,_request_key,actor,payload,result);
  RETURN result;
END $$;

ALTER TABLE public.governance_membership_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_membership_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY governance_membership_read ON public.governance_membership_requests FOR SELECT TO authenticated USING (
  private.governance_membership_active(tenant_id,auth.uid()) AND (requested_by=auth.uid() OR private.governance_membership_active(tenant_id,auth.uid(),true))
);
ALTER TABLE public.governance_membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_membership_events FORCE ROW LEVEL SECURITY;
CREATE POLICY governance_membership_events_read ON public.governance_membership_events FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.governance_membership_requests r WHERE r.id=request_id AND r.tenant_id=governance_membership_events.tenant_id)
);
ALTER TABLE private.governance_membership_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.governance_membership_operations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.governance_membership_requests,public.governance_membership_events,private.governance_membership_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.governance_membership_requests,public.governance_membership_events TO authenticated;
REVOKE ALL ON FUNCTION private.governance_membership_active(uuid,uuid,boolean),private.governance_membership_scope(uuid,uuid,uuid,uuid,text,uuid),private.governance_membership_lock_scope(),private.governance_membership_record(public.governance_membership_requests,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.governance_membership_active(uuid,uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_governance_membership_request(uuid,uuid,uuid,uuid,text,text,uuid),public.decide_governance_membership_request(uuid,uuid,integer,text,text,uuid),public.withdraw_governance_membership_request(uuid,uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.submit_governance_membership_request(uuid,uuid,uuid,uuid,text,text,uuid),public.decide_governance_membership_request(uuid,uuid,integer,text,text,uuid),public.withdraw_governance_membership_request(uuid,uuid,integer,text,uuid) TO authenticated;

-- Invoker reads retain caller RLS on requests, profiles and related labels.
CREATE FUNCTION public.list_governance_membership_requests(_tenant_id uuid,_page integer DEFAULT 1,_page_size integer DEFAULT 25,_search text DEFAULT '',_status text DEFAULT NULL,_bu_id uuid DEFAULT NULL,_environment text DEFAULT NULL,_own_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; admin boolean;
BEGIN
  IF NOT private.governance_membership_active(_tenant_id,auth.uid()) THEN RAISE EXCEPTION 'Active tenant membership required' USING ERRCODE='42501'; END IF;
  IF _own_only IS NULL OR _page IS NULL OR _page<1 OR _page>100000 OR _page_size IS NULL OR _page_size NOT BETWEEN 1 AND 100 OR _search IS NULL OR length(_search)>200
     OR _status IS NOT NULL AND _status NOT IN ('pending','approved','rejected','withdrawn')
     OR _environment IS NOT NULL AND _environment NOT IN ('prod','dev','sandbox','uat')
  THEN RAISE EXCEPTION 'Invalid list filter or pagination' USING ERRCODE='22023'; END IF;
  admin:=private.governance_membership_active(_tenant_id,auth.uid(),true);
  WITH visible AS MATERIALIZED (
    SELECT r.*,p.full_name AS requester_name,a.full_name AS approver_name,b.name AS bu_name,
      w.name AS workspace_name,NULL::text AS team_name,g.name AS group_name,
      (admin AND r.requested_by<>auth.uid() AND r.status='pending') AS can_decide,
      (r.requested_by=auth.uid() AND r.status='pending') AS can_withdraw
    FROM public.governance_membership_requests r
      LEFT JOIN public.profiles p ON p.id=r.requested_by
      LEFT JOIN public.profiles a ON a.id=r.approved_by
      LEFT JOIN public.business_units b ON b.id=r.bu_id AND b.tenant_id=r.tenant_id
      LEFT JOIN public.workspaces w ON w.id=r.workspace_id AND w.tenant_id=r.tenant_id
      LEFT JOIN public.tenant_groups g ON g.id=r.group_id AND g.tenant_id=r.tenant_id
    WHERE r.tenant_id=_tenant_id AND (NOT _own_only OR r.requested_by=auth.uid()) AND (_status IS NULL OR r.status=_status)
      AND (_bu_id IS NULL OR r.bu_id=_bu_id) AND (_environment IS NULL OR r.environment=_environment)
      AND (_search='' OR strpos(lower(concat_ws(' ',r.id::text,p.full_name,a.full_name,b.name,w.name,w.department,g.name,r.environment,r.correlation_id::text)),lower(_search))>0)
  ), page_rows AS (
    SELECT * FROM visible ORDER BY requested_at DESC,id DESC OFFSET ((_page-1)*_page_size) LIMIT _page_size
  ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY requested_at DESC,id DESC) FROM page_rows p),'[]'::jsonb),
    'total',(SELECT count(*) FROM visible),'page',_page,'page_size',_page_size,
    'kpis',jsonb_build_object('awaiting_decision',(SELECT count(*) FROM visible WHERE status='pending'),
      'approved_last_7_days',(SELECT count(*) FROM visible WHERE status='approved' AND decided_at>=now()-interval '7 days'),
      'independent_checker_needed',(SELECT count(*) FROM visible WHERE status='pending' AND requested_by=auth.uid()),
      'rejected_or_withdrawn',(SELECT count(*) FROM visible WHERE status IN ('rejected','withdrawn'))),
    'permissions',jsonb_build_object('can_submit',true,'can_review_queue',admin)) INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.get_governance_membership_request(_tenant_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; admin boolean;
BEGIN
  IF NOT private.governance_membership_active(_tenant_id,auth.uid()) THEN RAISE EXCEPTION 'Active tenant membership required' USING ERRCODE='42501'; END IF;
  admin:=private.governance_membership_active(_tenant_id,auth.uid(),true);
  SELECT to_jsonb(r)||jsonb_build_object('requester_name',p.full_name,'approver_name',a.full_name,
    'bu_name',b.name,'workspace_name',w.name,'team_name',NULL,'group_name',g.name,
    'effective_scope',r.scope_snapshot,'scope_label',r.scope_snapshot->>'scope_label',
    'membership_active',EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=r.group_id AND gm.user_id=r.requested_by),
    'history',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.governance_membership_events e WHERE e.tenant_id=_tenant_id AND e.request_id=r.id),'[]'::jsonb),
    'permissions',jsonb_build_object('can_approve',admin AND r.requested_by<>auth.uid() AND r.status='pending',
      'can_reject',admin AND r.requested_by<>auth.uid() AND r.status='pending','can_withdraw',r.requested_by=auth.uid() AND r.status='pending'))
    INTO result FROM public.governance_membership_requests r
    LEFT JOIN public.profiles p ON p.id=r.requested_by LEFT JOIN public.profiles a ON a.id=r.approved_by
    LEFT JOIN public.business_units b ON b.id=r.bu_id AND b.tenant_id=r.tenant_id
    LEFT JOIN public.workspaces w ON w.id=r.workspace_id AND w.tenant_id=r.tenant_id
    LEFT JOIN public.tenant_groups g ON g.id=r.group_id AND g.tenant_id=r.tenant_id
    WHERE r.tenant_id=_tenant_id AND r.id=_request_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Request not found in authorized scope' USING ERRCODE='42501'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_governance_membership_requests(uuid,integer,integer,text,text,uuid,text,boolean),public.get_governance_membership_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_governance_membership_requests(uuid,integer,integer,text,text,uuid,text,boolean),public.get_governance_membership_request(uuid,uuid) TO authenticated;

-- Purpose-scoped named choices. Group rights derive from the complete validated scope.
-- This function reads no profiles, identities, secrets or arbitrary business payloads.
CREATE FUNCTION public.list_governance_membership_options(_tenant_id uuid,_kind text,_page integer DEFAULT 1,_page_size integer DEFAULT 25,_search text DEFAULT '',_bu_id uuid DEFAULT NULL,_workspace_id uuid DEFAULT NULL,_environment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE actor uuid:=auth.uid(); admin boolean; effective_env text; rows jsonb:='[]'::jsonb; page_rows jsonb; item record; snapshot jsonb;
BEGIN
  IF NOT private.governance_membership_active(_tenant_id,actor) THEN RAISE EXCEPTION 'Active tenant membership required' USING ERRCODE='42501'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('bu','workspace','group','environment') OR _page IS NULL OR _page NOT BETWEEN 1 AND 100000
    OR _page_size IS NULL OR _page_size NOT BETWEEN 1 AND 100 OR _search IS NULL OR length(_search)>200
  THEN RAISE EXCEPTION 'Invalid option scope or pagination' USING ERRCODE='22023'; END IF;
  admin:=private.governance_membership_active(_tenant_id,actor,true);
  IF _kind IN ('workspace','group') THEN
    IF _bu_id IS NULL THEN RAISE EXCEPTION 'Select a business unit first' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.business_units WHERE id=_bu_id AND tenant_id=_tenant_id AND NOT is_archived)
      OR NOT admin AND NOT EXISTS(SELECT 1 FROM public.user_bu_scope(actor,_tenant_id) s WHERE s=_bu_id)
    THEN RAISE EXCEPTION 'Current eligible business unit required' USING ERRCODE='42501'; END IF;
  END IF;
  IF _kind='environment' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',upper(env::text),'environment',env::text) ORDER BY env::text,id),'[]'::jsonb) INTO rows
      FROM public.tenant_environments WHERE tenant_id=_tenant_id AND is_active
      AND (_search='' OR strpos(lower(env::text),lower(_search))>0);
  ELSIF _kind='bu' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'label',b.name,'bu_id',b.id) ORDER BY b.name,b.id),'[]'::jsonb) INTO rows
      FROM public.business_units b WHERE tenant_id=_tenant_id AND NOT is_archived
      AND (admin OR EXISTS(SELECT 1 FROM public.user_bu_scope(actor,_tenant_id) s WHERE s=b.id))
      AND (_search='' OR strpos(lower(b.name),lower(_search))>0);
  ELSIF _kind='workspace' THEN
    IF _bu_id IS NULL THEN RAISE EXCEPTION 'Select a business unit first' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'label',w.name,'bu_id',w.business_unit_id) ORDER BY w.name,w.id),'[]'::jsonb) INTO rows
      FROM public.workspaces w JOIN public.business_units b ON b.id=w.business_unit_id AND b.tenant_id=w.tenant_id AND NOT b.is_archived
      WHERE w.tenant_id=_tenant_id AND w.business_unit_id=_bu_id AND w.status='active'
      AND (admin OR (EXISTS(SELECT 1 FROM public.user_bu_scope(actor,_tenant_id) s WHERE s=_bu_id)
        AND EXISTS(SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=w.id AND wm.tenant_id=_tenant_id AND wm.user_id=actor)))
      AND (_search='' OR strpos(lower(w.name),lower(_search))>0);
  ELSE
    IF _workspace_id IS NULL THEN RAISE EXCEPTION 'Select a workspace first' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=_workspace_id AND tenant_id=_tenant_id AND business_unit_id=_bu_id AND status='active')
      OR NOT admin AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=_workspace_id AND tenant_id=_tenant_id AND user_id=actor)
    THEN RAISE EXCEPTION 'Current eligible workspace required' USING ERRCODE='42501'; END IF;
    SELECT min(env::text) INTO effective_env FROM public.tenant_environments WHERE tenant_id=_tenant_id AND is_active AND (_environment IS NULL OR env::text=_environment);
    IF effective_env IS NULL THEN RAISE EXCEPTION 'Current registered environment required' USING ERRCODE='42501'; END IF;
    -- Full eligibility means unsafe groups do not appear as selectable requests.
    FOR item IN SELECT g.id,g.name FROM public.tenant_groups g WHERE g.tenant_id=_tenant_id AND g.bu_id=_bu_id
      AND NOT EXISTS(SELECT 1 FROM public.tenant_group_members gm WHERE gm.group_id=g.id AND gm.user_id=actor)
      AND (_search='' OR strpos(lower(g.name),lower(_search))>0) ORDER BY g.name,g.id
    LOOP
      BEGIN
        snapshot:=private.governance_membership_scope(_tenant_id,_bu_id,_workspace_id,item.id,effective_env,actor);
        rows:=rows||jsonb_build_array(jsonb_build_object('id',item.id,'label',item.name,'bu_id',_bu_id,
          'workspace_id',_workspace_id,'selectable',true,'requested_rights',snapshot->'requested_rights','scope_label',snapshot->>'scope_label','effective_scope',snapshot));
      EXCEPTION WHEN insufficient_privilege THEN CONTINUE;
      END;
    END LOOP;
  END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO page_rows FROM jsonb_array_elements(rows) WITH ORDINALITY
    WHERE ordinality>((_page-1)*_page_size) AND ordinality<=(_page*_page_size);
  RETURN jsonb_build_object('rows',page_rows,'total',jsonb_array_length(rows),'page',_page,'page_size',_page_size,'has_more',(_page*_page_size)<jsonb_array_length(rows));
END $$;
REVOKE ALL ON FUNCTION public.list_governance_membership_options(uuid,text,integer,integer,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_governance_membership_options(uuid,text,integer,integer,text,uuid,uuid,text) TO authenticated;
