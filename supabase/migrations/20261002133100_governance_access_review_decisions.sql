-- Governance V4: certify actual tenant-group memberships, retaining the existing
-- campaign/item database. Historical rows are never backfilled or relabelled.
-- Apply under Primary's catalog/preimage guard. PostgreSQL >= 16.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Fail before writes if the existing review database is no longer the captured
-- shape. Primary additionally fences exact catalog/helper preimages per target.
DO $$
DECLARE campaign_columns text[]; item_columns text[];
BEGIN
 SELECT array_agg(attname::text ORDER BY attnum) INTO campaign_columns FROM pg_attribute
 WHERE attrelid='public.access_review_campaigns'::regclass AND attnum>0 AND NOT attisdropped;
 SELECT array_agg(attname::text ORDER BY attnum) INTO item_columns FROM pg_attribute
 WHERE attrelid='public.access_review_items'::regclass AND attnum>0 AND NOT attisdropped;
 IF campaign_columns IS DISTINCT FROM ARRAY['id','tenant_id','name','description','scope','scope_ref','status','starts_at','due_at','closed_at','created_by','metadata','created_at','updated_at']::text[]
  OR item_columns IS DISTINCT FROM ARRAY['id','campaign_id','tenant_id','subject_user_id','subject_role','subject_scope','reviewer_id','decision','decision_note','decided_at','evidence','created_at','updated_at']::text[]
  OR to_regprocedure('public.effective_user_permissions(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('public.audit_log_chain()') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_log'::regclass AND tgname='audit_log_chain_trg' AND tgenabled IN ('O','A'))
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.audit_log'::regclass AND attname='id' AND atttypid='bigint'::regtype) THEN
   RAISE EXCEPTION 'Governance access-review catalog preimage changed; requalify before applying' USING ERRCODE='40001';
 END IF;
END $$;

ALTER TABLE public.access_review_items
  ADD COLUMN governance_version integer NOT NULL DEFAULT 1 CHECK (governance_version > 0),
  ADD COLUMN governance_snapshot jsonb,
  ADD COLUMN governance_snapshot_hash text CHECK (governance_snapshot_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN governance_outcome text CHECK (governance_outcome IN ('pending','retained','change_requested','revoked')),
  ADD COLUMN governance_decided_by uuid,
  ADD COLUMN governance_correlation_id uuid;
CREATE INDEX access_review_items_governance_scope_idx ON public.access_review_items(tenant_id,campaign_id,created_at,id);

-- A receipt journal only; campaigns and decisions still live in the existing tables.
CREATE TABLE public.governance_access_review_receipts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  request_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,request_key)
);
ALTER TABLE public.governance_access_review_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.governance_access_review_receipts FROM PUBLIC, anon, authenticated, service_role;

-- These tables had ALL (including TRUNCATE/MAINTAIN) grants. Make all caller writes
-- go through transactionally audited functions; legacy direct handlers now refuse.
REVOKE ALL ON public.access_review_campaigns,public.access_review_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.access_review_campaigns,public.access_review_items TO authenticated;
DROP POLICY IF EXISTS arc_admin ON public.access_review_campaigns;
DROP POLICY IF EXISTS ari_admin ON public.access_review_items;

CREATE FUNCTION private.governance_review_is_admin(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=auth.uid()
     AND active AND role::text='tenant_admin');
$$;

CREATE FUNCTION private.governance_review_assert_member(_tenant uuid, _admin boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=auth.uid() AND active)
    OR (_admin AND NOT private.governance_review_is_admin(_tenant)) THEN
   RAISE EXCEPTION 'Current active tenant membership and required authority missing' USING ERRCODE='42501';
 END IF;
END $$;

CREATE FUNCTION private.governance_review_can_read(_item public.access_review_items)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=_item.tenant_id AND m.user_id=auth.uid() AND m.active)
 AND (private.governance_review_is_admin(_item.tenant_id) OR (
   _item.governance_snapshot IS NOT NULL AND _item.reviewer_id=auth.uid()
   AND EXISTS(SELECT 1 FROM public.tenant_groups g JOIN public.tenant_group_members gm ON gm.group_id=g.id
     WHERE g.id=(_item.subject_scope->>'group_id')::uuid AND g.tenant_id=_item.tenant_id AND gm.user_id=auth.uid()
       AND (EXISTS(SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units b ON b.id=a.bu_id AND b.tenant_id=a.tenant_id
         WHERE a.group_id=g.id AND a.tenant_id=g.tenant_id AND NOT b.is_archived)
        OR EXISTS(SELECT 1 FROM public.business_units b WHERE b.id=g.bu_id AND b.tenant_id=g.tenant_id AND NOT b.is_archived)))
   AND EXISTS(SELECT 1 FROM public.effective_user_permissions(auth.uid(),_item.tenant_id,NULL))
 ));
$$;
CREATE POLICY governance_review_campaign_read ON public.access_review_campaigns FOR SELECT TO authenticated
 USING (private.governance_review_is_admin(tenant_id) OR EXISTS (
   SELECT 1 FROM public.access_review_items i WHERE i.campaign_id=access_review_campaigns.id
     AND i.tenant_id=access_review_campaigns.tenant_id AND private.governance_review_can_read(i)));
CREATE POLICY governance_review_item_read ON public.access_review_items FOR SELECT TO authenticated
 USING (private.governance_review_can_read(access_review_items));

CREATE FUNCTION private.governance_review_hash(_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(_value::text,'UTF8')),'hex');
$$;

-- Freeze writers (including phantom insert/delete rights changes) during the short
-- setup/decision transaction. Reads continue. Fixed ordering avoids lock upgrades;
-- lock_timeout makes contention a refusal, never a success. No lifetime auth locks.
CREATE FUNCTION private.governance_review_lock_sources()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 LOCK TABLE public.tenant_members, public.tenant_groups, public.tenant_group_members,
   public.tenant_group_roles, public.rbac_roles, public.rbac_role_permissions,
   public.rbac_user_grants, public.business_units, public.bu_group_assignments,
   public.bu_user_assignments, public.workspaces, public.workspace_members,
   public.teams, public.team_members, public.recon_definitions,
   public.recon_definition_business_units, public.recon_definition_bu_grants,
   public.data_resource_registry, public.data_resource_registry_owner_bu,
   public.data_resource_registry_grants, public.data_resource_bu_grants
 IN SHARE ROW EXCLUSIVE MODE;
END $$;

CREATE FUNCTION private.governance_review_snapshot(_tenant uuid,_subject uuid,_group uuid,_workspace uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE g public.tenant_groups%ROWTYPE; m public.tenant_group_members%ROWTYPE;
 s public.tenant_members%ROWTYPE; w public.workspaces%ROWTYPE; rights jsonb; grants jsonb;
BEGIN
 SELECT * INTO s FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_subject AND active;
 SELECT * INTO g FROM public.tenant_groups WHERE tenant_id=_tenant AND id=_group;
 SELECT * INTO m FROM public.tenant_group_members WHERE group_id=_group AND user_id=_subject;
 IF s.id IS NULL OR g.id IS NULL OR m.user_id IS NULL THEN
   RAISE EXCEPTION 'Current scoped membership missing' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units b ON b.id=a.bu_id AND b.tenant_id=a.tenant_id
   WHERE a.tenant_id=_tenant AND a.group_id=_group AND NOT b.is_archived)
   AND NOT EXISTS(SELECT 1 FROM public.business_units b WHERE b.id=g.bu_id AND b.tenant_id=_tenant AND NOT b.is_archived) THEN
   RAISE EXCEPTION 'Current group business-unit association missing' USING ERRCODE='40001'; END IF;
 IF _workspace IS NOT NULL THEN
   SELECT * INTO w FROM public.workspaces WHERE id=_workspace AND tenant_id=_tenant AND status='active';
   IF w.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w.id AND tenant_id=_tenant AND user_id=_subject)
     OR NOT EXISTS(SELECT 1 FROM public.business_units target WHERE target.id=w.business_unit_id AND target.tenant_id=_tenant AND NOT target.is_archived
       AND (target.id=g.bu_id OR EXISTS(SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units assigned ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id
         WHERE a.group_id=_group AND a.tenant_id=_tenant AND NOT assigned.is_archived
           AND (a.bu_id=target.id OR (a.inherit_descendants AND target.path OPERATOR(public.<@) assigned.path))))) THEN
     RAISE EXCEPTION 'Workspace context is not an actual scoped membership' USING ERRCODE='40001'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(permission_id ORDER BY permission_id),'[]') INTO rights FROM (
   SELECT DISTINCT rp.permission_id FROM public.tenant_group_roles gr
   JOIN public.rbac_role_permissions rp ON rp.role_id=gr.role_id WHERE gr.group_id=_group) p;
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]') INTO grants FROM (
   SELECT jsonb_build_object('resource_type','reconciliation','resource_id',r.recon_id,'bu_id',r.bu_id,'action',r.action,
     'environment',d.environment,'workspace_id',to_jsonb(d)->>'workspace_id') x
     FROM public.recon_definition_bu_grants r JOIN public.recon_definitions d ON d.id=r.recon_id AND d.tenant_id=r.tenant_id
     WHERE r.tenant_id=_tenant AND r.principal_type='group' AND r.principal_id=_group
   UNION ALL
   SELECT jsonb_build_object('resource_type',reg.resource_type,'resource_id',reg.id,'bu_id',r.bu_id,'action',r.action,
     'environment',NULL,'workspace_id',NULL) FROM public.data_resource_registry_grants r
     JOIN public.data_resource_registry reg ON reg.id=r.registry_id AND reg.tenant_id=r.tenant_id
     WHERE r.tenant_id=_tenant AND r.principal_type='group' AND r.principal_group_id=_group
   UNION ALL
   SELECT jsonb_build_object('resource_type',r.resource_type,'resource_id',r.resource_id,'bu_id',r.bu_id,'action',r.action,
     'environment',NULL,'workspace_id',NULL) FROM public.data_resource_bu_grants r
     WHERE r.tenant_id=_tenant AND r.principal_type='group' AND r.principal_id=_group
 ) q;
 RETURN jsonb_build_object('schema_version',1,'tenant_id',_tenant,'subject_user_id',_subject,'membership',to_jsonb(m),
  'tenant_membership',to_jsonb(s),'group',to_jsonb(g),'workspace',CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('id',w.id,'name',w.name,'business_unit_id',w.business_unit_id,'status',w.status) END,
  'workspace_membership',(SELECT to_jsonb(wm) FROM public.workspace_members wm WHERE wm.workspace_id=_workspace AND wm.tenant_id=_tenant AND wm.user_id=_subject),
  'group_roles',(SELECT coalesce(jsonb_agg(to_jsonb(gr) ORDER BY gr.role_id),'[]') FROM public.tenant_group_roles gr WHERE gr.group_id=_group),
  'role_permissions',(SELECT coalesce(jsonb_agg(to_jsonb(rp) ORDER BY rp.role_id,rp.permission_id),'[]') FROM public.rbac_role_permissions rp WHERE EXISTS(SELECT 1 FROM public.tenant_group_roles gr WHERE gr.group_id=_group AND gr.role_id=rp.role_id)),
  'business_units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'path',b.path,'is_archived',b.is_archived) ORDER BY b.id),'[]') FROM public.business_units b WHERE b.tenant_id=_tenant AND (b.id=g.bu_id OR EXISTS(SELECT 1 FROM public.bu_group_assignments a WHERE a.tenant_id=_tenant AND a.group_id=_group AND a.bu_id=b.id) OR b.id=w.business_unit_id)),
  'bu_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.bu_group_assignments a WHERE a.tenant_id=_tenant AND a.group_id=_group),
  'grant_preimages',jsonb_build_object(
    'reconciliation',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.recon_definition_bu_grants r WHERE r.tenant_id=_tenant AND r.principal_type='group' AND r.principal_id=_group),
    'data_registry',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.data_resource_registry_grants r WHERE r.tenant_id=_tenant AND r.principal_type='group' AND r.principal_group_id=_group),
    'data_legacy',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.data_resource_bu_grants r WHERE r.tenant_id=_tenant AND r.principal_type='group' AND r.principal_id=_group)),
  'resource_grants',grants,'current_rights',rights||(SELECT coalesce(jsonb_agg(label ORDER BY label),'[]') FROM (
    SELECT DISTINCT (r->>'resource_type')||':'||(r->>'resource_id')||':'||(r->>'action') label FROM jsonb_array_elements(grants) r) all_resource_rights),
  'effective_permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.permission_id,p.source,p.role_id,p.group_id,p.bu_id),'[]') FROM public.effective_user_permissions(_subject,_tenant,NULL) p));
END $$;

CREATE FUNCTION private.governance_review_row(_item public.access_review_items)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object(
  'id',_item.id,'campaign_id',c.id,'campaign_name',c.name,'subject_user_id',_item.subject_user_id,
  'member_name',NULL,'reviewer_name',NULL,
  'team_name',(SELECT string_agg(t.name,', ' ORDER BY t.name) FROM public.teams t JOIN public.team_members tm ON tm.team_id=t.id AND tm.tenant_id=t.tenant_id WHERE t.tenant_id=_item.tenant_id AND tm.user_id=_item.subject_user_id AND t.is_active),
  'bu_id',_item.governance_snapshot->'group'->>'bu_id',
  'bu_name',(SELECT string_agg(b->>'name',', ' ORDER BY b->>'name') FROM jsonb_array_elements(coalesce(_item.governance_snapshot->'business_units','[]')) b),
  'workspace_id',_item.subject_scope->>'workspace_id','workspace_name',_item.governance_snapshot->'workspace'->>'name',
  'environment',CASE WHEN (SELECT count(DISTINCT r->>'environment') FROM jsonb_array_elements(coalesce(_item.governance_snapshot->'resource_grants','[]')) r WHERE r->>'environment' IS NOT NULL)=1 THEN (SELECT min(r->>'environment') FROM jsonb_array_elements(_item.governance_snapshot->'resource_grants') r) ELSE NULL END,
  'group_id',_item.subject_scope->>'group_id','group_name',_item.governance_snapshot->'group'->>'name',
  'current_rights',coalesce(_item.governance_snapshot->'current_rights','[]'),
  'reviewer_id',_item.reviewer_id,'due_at',c.due_at,'outcome',coalesce(_item.governance_outcome,'historical_unknown'),
  'decided_at',_item.decided_at,'version',_item.governance_version,'snapshot_hash',_item.governance_snapshot_hash,
  'requested_by',c.created_by,'requested_at',_item.created_at,'approved_by',_item.governance_decided_by,
  'reason',_item.decision_note,'correlation_id',_item.governance_correlation_id,'historical',_item.governance_snapshot IS NULL,
  'effective_scope',jsonb_build_object('workspace_context_only',true,'group_membership_scope','tenant group; all existing group grants across workspaces',
    'resource_grants',coalesce(_item.governance_snapshot->'resource_grants','[]')))
 FROM public.access_review_campaigns c WHERE c.id=_item.campaign_id AND c.tenant_id=_item.tenant_id;
$$;

CREATE FUNCTION private.governance_review_list_rows(_tenant uuid)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
 PERFORM private.governance_review_assert_member(_tenant);
 RETURN QUERY SELECT private.governance_review_row(i)||jsonb_build_object('_campaign_status',c.status,'_created_at',i.created_at)
 FROM public.access_review_items i JOIN public.access_review_campaigns c ON c.id=i.campaign_id AND c.tenant_id=i.tenant_id
 WHERE i.tenant_id=_tenant AND private.governance_review_can_read(i);
END $$;

CREATE FUNCTION public.governance_access_review_list(_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,private AS $$
DECLARE t uuid:=(_input->>'tenant_id')::uuid; p int:=coalesce((_input->>'page')::int,1);
 n int:=coalesce((_input->>'page_size')::int,25); result jsonb;
BEGIN
 IF p<1 OR p>100000 OR n<1 OR n>100 OR length(coalesce(_input->>'search',''))>160
   OR (_input->>'outcome' IS NOT NULL AND _input->>'outcome' NOT IN ('pending','retained','change_requested','revoked','historical_unknown')) THEN
   RAISE EXCEPTION 'Invalid list bounds/filter' USING ERRCODE='22023'; END IF;
 WITH scoped AS MATERIALIZED (
   SELECT r->>'id' id,r->>'campaign_id' campaign_id,r->>'_campaign_status' campaign_status,
     (r->>'due_at')::timestamptz due_at,(r->>'_created_at')::timestamptz created_at,
     r->>'outcome' governance_outcome,(r->>'decided_at')::timestamptz decided_at,
     (r-'_campaign_status'-'_created_at')||jsonb_build_object('member_name',member.full_name,'reviewer_name',reviewer.full_name) row
   FROM private.governance_review_list_rows(t) AS source(r)
   LEFT JOIN public.profiles member ON member.id=(r->>'subject_user_id')::uuid
   LEFT JOIN public.profiles reviewer ON reviewer.id=(r->>'reviewer_id')::uuid
   WHERE (_input->>'campaign_id' IS NULL OR (r->>'campaign_id')::uuid=(_input->>'campaign_id')::uuid)
     AND (_input->>'reviewer_id' IS NULL OR (r->>'reviewer_id')::uuid=(_input->>'reviewer_id')::uuid)
     AND (_input->>'outcome' IS NULL OR r->>'outcome'=_input->>'outcome')
 ), filtered AS MATERIALIZED (
   SELECT * FROM scoped WHERE coalesce(_input->>'search','')='' OR position(lower(_input->>'search') IN lower(row::text))>0
 ), paged AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT n OFFSET (p-1)*n)
 SELECT jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(row ORDER BY created_at DESC,id DESC),'[]') FROM paged),
   'total',(SELECT count(*) FROM filtered),'page',p,'page_size',n,'kpis',jsonb_build_object(
    'open_campaigns',(SELECT count(DISTINCT campaign_id) FROM filtered WHERE campaign_status='active'),
    'memberships_to_review',(SELECT count(*) FROM filtered WHERE governance_outcome IN ('pending','change_requested')),
    'overdue_decisions',(SELECT count(*) FROM filtered WHERE governance_outcome IN ('pending','change_requested') AND due_at<now()),
    'completed_last_30_days',(SELECT count(*) FROM filtered WHERE governance_outcome IN ('retained','revoked') AND decided_at>=now()-interval '30 days')),
   'permissions',jsonb_build_object('can_create_campaign',private.governance_review_is_admin(t),'can_decide',private.governance_review_is_admin(t))) INTO result;
 RETURN result;
END $$;

-- Setup options are tenant-admin only and use existing tenant/BU/group/workspace
-- relationships. No profile read in this definer: the public invoker below joins
-- person labels through the caller's existing profiles RLS before search/paging.
CREATE FUNCTION private.governance_review_options_scope(_input jsonb)
RETURNS TABLE(id uuid,label text,group_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE t uuid:=(_input->>'tenant_id')::uuid; kind text:=_input->>'kind';
 b uuid:=(_input->>'bu_id')::uuid; g uuid:=(_input->>'group_id')::uuid; w uuid:=(_input->>'workspace_id')::uuid;
BEGIN
 PERFORM private.governance_review_assert_member(t,true);
 IF kind IS NULL OR kind NOT IN ('business_units','groups','workspaces','members','reviewers') THEN
   RAISE EXCEPTION 'Unsupported option kind' USING ERRCODE='22023'; END IF;
 IF b IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_units WHERE tenant_id=t AND business_units.id=b AND NOT is_archived)
   OR g IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_groups WHERE tenant_id=t AND tenant_groups.id=g)
   OR w IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspaces WHERE tenant_id=t AND workspaces.id=w AND status='active') THEN
   RAISE EXCEPTION 'Selected option is outside current scope' USING ERRCODE='42501'; END IF;
 IF kind IN ('members','reviewers') AND g IS NULL THEN RAISE EXCEPTION 'Select a group first' USING ERRCODE='22023'; END IF;
 IF kind='business_units' THEN
   RETURN QUERY SELECT x.id,x.name,NULL::uuid FROM public.business_units x WHERE x.tenant_id=t AND NOT x.is_archived;
 ELSIF kind='groups' THEN
   RETURN QUERY SELECT x.id,x.name,x.id FROM public.tenant_groups x WHERE x.tenant_id=t AND
    (b IS NULL OR x.bu_id=b OR EXISTS(SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units target ON target.id=b
      JOIN public.business_units assigned ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id AND NOT assigned.is_archived
      WHERE a.tenant_id=t AND a.group_id=x.id AND (a.bu_id=b OR (a.inherit_descendants AND target.path OPERATOR(public.<@) assigned.path))))
    AND (EXISTS(SELECT 1 FROM public.business_units unit WHERE unit.id=x.bu_id AND unit.tenant_id=t AND NOT unit.is_archived)
      OR EXISTS(SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units unit ON unit.id=a.bu_id AND unit.tenant_id=a.tenant_id WHERE a.tenant_id=t AND a.group_id=x.id AND NOT unit.is_archived));
 ELSIF kind='workspaces' THEN
   RETURN QUERY SELECT x.id,x.name,g FROM public.workspaces x WHERE x.tenant_id=t AND x.status='active' AND (b IS NULL OR x.business_unit_id=b)
    AND EXISTS(SELECT 1 FROM public.business_units unit WHERE unit.id=x.business_unit_id AND unit.tenant_id=t AND NOT unit.is_archived)
    AND (g IS NULL OR EXISTS(SELECT 1 FROM public.tenant_groups tg WHERE tg.id=g AND tg.tenant_id=t AND tg.bu_id=x.business_unit_id)
      OR EXISTS(SELECT 1 FROM public.bu_group_assignments a JOIN public.business_units assigned ON assigned.id=a.bu_id AND assigned.tenant_id=a.tenant_id
        JOIN public.business_units target ON target.id=x.business_unit_id AND target.tenant_id=t
        WHERE a.group_id=g AND a.tenant_id=t AND NOT assigned.is_archived AND (a.bu_id=target.id OR (a.inherit_descendants AND target.path OPERATOR(public.<@) assigned.path))));
 ELSIF kind='members' THEN
   RETURN QUERY SELECT m.user_id,NULL::text,g FROM public.tenant_group_members m JOIN public.tenant_members tm ON tm.user_id=m.user_id AND tm.tenant_id=t AND tm.active
    WHERE m.group_id=g AND (w IS NULL OR EXISTS(SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=w AND wm.tenant_id=t AND wm.user_id=m.user_id));
 ELSE
   RETURN QUERY SELECT tm.user_id,NULL::text,g FROM public.tenant_members tm WHERE tm.tenant_id=t AND tm.active
    AND tm.user_id<>auth.uid() AND tm.user_id IS DISTINCT FROM (_input->>'subject_user_id')::uuid
    AND tm.role::text='tenant_admin';
 END IF;
END $$;

CREATE FUNCTION private.governance_review_member_option(_input jsonb,_subject uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE t uuid:=(_input->>'tenant_id')::uuid; snap jsonb; group_id uuid:=(_input->>'group_id')::uuid;
BEGIN
 PERFORM private.governance_review_assert_member(t,true);
 snap:=private.governance_review_snapshot(t,_subject,group_id,(_input->>'workspace_id')::uuid);
 RETURN jsonb_build_object('subject_user_id',_subject,'team_name',(SELECT string_agg(t.name,', ' ORDER BY t.name)
   FROM public.teams t JOIN public.team_members tm ON tm.team_id=t.id AND tm.tenant_id=t.tenant_id WHERE t.tenant_id=(_input->>'tenant_id')::uuid AND tm.user_id=_subject AND t.is_active),
   'group_name',snap->'group'->>'name','bu_name',(SELECT string_agg(b->>'name',', ' ORDER BY b->>'name') FROM jsonb_array_elements(snap->'business_units') b),
   'workspace_id',_input->>'workspace_id','workspace_name',snap->'workspace'->>'name',
   'environment',CASE WHEN (SELECT count(DISTINCT r->>'environment') FROM jsonb_array_elements(snap->'resource_grants') r WHERE r->>'environment' IS NOT NULL)=1
     THEN (SELECT min(r->>'environment') FROM jsonb_array_elements(snap->'resource_grants') r) ELSE NULL END,
   'current_rights',snap->'current_rights','snapshot_hash',private.governance_review_hash(snap),'version',1,
   'effective_scope',jsonb_build_object('workspace_context_only',true,'group_membership_scope','tenant group; all existing group grants across workspaces','resource_grants',snap->'resource_grants'));
END $$;

CREATE FUNCTION public.governance_access_review_options(_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,private AS $$
DECLARE p int:=coalesce((_input->>'page')::int,1); n int:=coalesce((_input->>'page_size')::int,25); result jsonb;
BEGIN
 IF p<1 OR p>100000 OR n<1 OR n>100 OR length(coalesce(_input->>'search',''))>160 THEN RAISE EXCEPTION 'Invalid option bounds' USING ERRCODE='22023'; END IF;
 WITH eligible AS MATERIALIZED (
   SELECT x.id,coalesce(x.label,profile.full_name) label,x.group_id FROM private.governance_review_options_scope(_input) x
   LEFT JOIN public.profiles profile ON profile.id=x.id AND _input->>'kind' IN ('members','reviewers')
 ), filtered AS MATERIALIZED (SELECT * FROM eligible WHERE coalesce(_input->>'search','')=''
   OR position(lower(_input->>'search') IN lower(coalesce(label,'')||' '||id::text))>0),
 paged AS (SELECT * FROM filtered ORDER BY label NULLS LAST,id LIMIT n OFFSET (p-1)*n)
 SELECT jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(to_jsonb(x)||CASE WHEN _input->>'kind'='members'
     THEN private.governance_review_member_option(_input,x.id)||jsonb_build_object('member_name',x.label) ELSE '{}'::jsonb END ORDER BY x.label NULLS LAST,x.id),'[]') FROM paged x),
   'total',(SELECT count(*) FROM filtered),'page',p,'page_size',n) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.governance_access_review_get(_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
DECLARE t uuid:=(_input->>'tenant_id')::uuid; i public.access_review_items%ROWTYPE;
 c public.access_review_campaigns%ROWTYPE; fresh boolean:=false; actions jsonb:='[]';
BEGIN
 PERFORM private.governance_review_assert_member(t);
 SELECT * INTO i FROM public.access_review_items WHERE id=(_input->>'id')::uuid AND tenant_id=t;
 IF i.id IS NULL OR NOT private.governance_review_can_read(i) THEN RAISE EXCEPTION 'Review unavailable in current scope' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.access_review_campaigns WHERE id=i.campaign_id AND tenant_id=t;
 IF i.governance_snapshot IS NOT NULL AND i.governance_outcome IN ('pending','change_requested') THEN
   BEGIN
     fresh:=private.governance_review_hash(private.governance_review_snapshot(t,i.subject_user_id,(i.subject_scope->>'group_id')::uuid,(i.subject_scope->>'workspace_id')::uuid))=i.governance_snapshot_hash;
   EXCEPTION WHEN SQLSTATE '40001' THEN fresh:=false; END;
 END IF;
 IF fresh AND c.status='active' AND i.reviewer_id=auth.uid() AND c.created_by<>auth.uid() AND i.subject_user_id<>auth.uid() THEN
   actions:=CASE WHEN private.governance_review_is_admin(t) THEN '["retain","request_change","revoke"]'::jsonb ELSE '["request_change"]'::jsonb END;
 END IF;
 RETURN private.governance_review_row(i)||jsonb_build_object('history',coalesce(i.evidence->'governance_history','[]'),
   'snapshot_current',fresh,'permitted_actions',actions);
END $$;

CREATE FUNCTION public.governance_access_review_campaign_create(_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private
 SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE t uuid:=(_input->>'tenant_id')::uuid; actor uuid:=auth.uid(); k uuid:=(_input->>'request_key')::uuid;
 h text; receipt public.governance_access_review_receipts%ROWTYPE; campaign uuid; item uuid;
 entry jsonb; snap jsonb; ids jsonb:='[]'; result jsonb; correlation uuid:=gen_random_uuid();
BEGIN
 PERFORM private.governance_review_assert_member(t,true);
 IF k IS NULL OR length(btrim(coalesce(_input->>'name',''))) NOT BETWEEN 1 AND 160
   OR length(coalesce(_input->>'description',''))>1000 OR jsonb_typeof(_input->'memberships') IS DISTINCT FROM 'array'
   OR jsonb_array_length(_input->'memberships') NOT BETWEEN 1 AND 200 OR _input->>'due_at' IS NULL THEN
   RAISE EXCEPTION 'Invalid campaign' USING ERRCODE='22023'; END IF;
 h:=private.governance_review_hash(jsonb_build_object('operation','campaign.create','input',_input));
 PERFORM pg_advisory_xact_lock(hashtextextended('governance.access_review.'||t::text||k::text,0));
 SELECT * INTO receipt FROM public.governance_access_review_receipts WHERE tenant_id=t AND request_key=k;
 IF FOUND THEN
   IF receipt.actor_id<>actor OR receipt.payload_hash<>h THEN RAISE EXCEPTION 'Request key collision' USING ERRCODE='23505'; END IF;
   RETURN receipt.result;
 END IF;
 IF (_input->>'due_at')::timestamptz<=now() THEN RAISE EXCEPTION 'Due date must be in the future' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_input->'memberships') e GROUP BY e->>'subject_user_id',e->>'group_id' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Duplicate membership' USING ERRCODE='22023'; END IF;
 PERFORM private.governance_review_lock_sources();
 PERFORM private.governance_review_assert_member(t,true);
 INSERT INTO public.access_review_campaigns(tenant_id,name,description,scope,status,starts_at,due_at,created_by,metadata)
 VALUES(t,btrim(_input->>'name'),_input->>'description','tenant','active',now(),(_input->>'due_at')::timestamptz,actor,
   jsonb_build_object('governance_schema_version',1,'correlation_id',correlation)) RETURNING id INTO campaign;
 FOR entry IN SELECT value FROM jsonb_array_elements(_input->'memberships') LOOP
   IF (entry->>'reviewer_id')::uuid IS NULL OR (entry->>'reviewer_id')::uuid IN (actor,(entry->>'subject_user_id')::uuid)
     OR NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=(entry->>'reviewer_id')::uuid AND active AND role::text='tenant_admin') THEN
     RAISE EXCEPTION 'An independent active tenant-admin reviewer is required' USING ERRCODE='42501'; END IF;
   snap:=private.governance_review_snapshot(t,(entry->>'subject_user_id')::uuid,(entry->>'group_id')::uuid,(entry->>'workspace_id')::uuid);
   IF entry->>'snapshot_hash' IS NOT NULL AND entry->>'snapshot_hash' IS DISTINCT FROM private.governance_review_hash(snap) THEN
     RAISE EXCEPTION 'Selected membership rights changed; refresh the option snapshot' USING ERRCODE='40001'; END IF;
   INSERT INTO public.access_review_items(campaign_id,tenant_id,subject_user_id,subject_role,subject_scope,reviewer_id,
     decision,governance_snapshot,governance_snapshot_hash,governance_outcome,governance_correlation_id)
   VALUES(campaign,t,(entry->>'subject_user_id')::uuid,'tenant_group_member',
     jsonb_build_object('group_id',entry->>'group_id','workspace_id',entry->>'workspace_id'),(entry->>'reviewer_id')::uuid,
     'pending',snap,private.governance_review_hash(snap),'pending',correlation) RETURNING id INTO item;
   IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=(entry->>'reviewer_id')::uuid AND active AND role::text='tenant_admin')
     AND NOT EXISTS(SELECT 1 FROM public.tenant_group_members WHERE user_id=(entry->>'reviewer_id')::uuid AND group_id=(entry->>'group_id')::uuid) THEN
     RAISE EXCEPTION 'Reviewer lacks current group scope' USING ERRCODE='42501'; END IF;
   ids:=ids||jsonb_build_array(item);
 END LOOP;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(actor,t,'tenant','governance.access_review.campaign.create','access_review_campaigns',campaign::text,
   jsonb_build_object('correlation_id',correlation,'actor_role','tenant_admin','outcome','active','version',1,'item_ids',ids,'due_at',_input->>'due_at'));
 result:=jsonb_build_object('campaign_id',campaign,'item_ids',ids,'correlation_id',correlation);
 INSERT INTO public.governance_access_review_receipts VALUES(t,k,actor,h,result,now());
 RETURN result;
END $$;

CREATE FUNCTION public.governance_access_review_decide(_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private
 SET lock_timeout='5s' SET statement_timeout='30s' AS $$
DECLARE t uuid:=(_input->>'tenant_id')::uuid; actor uuid:=auth.uid(); k uuid:=(_input->>'request_key')::uuid;
 d text:=_input->>'decision'; note text:=btrim(_input->>'reason'); h text;
 receipt public.governance_access_review_receipts%ROWTYPE; i public.access_review_items%ROWTYPE;
 c public.access_review_campaigns%ROWTYPE; snap jsonb; result jsonb; affected int; audit_id bigint;
 correlation uuid:=gen_random_uuid(); event text; outcome text; history jsonb;
BEGIN
 PERFORM private.governance_review_assert_member(t);
 IF k IS NULL OR d IS NULL OR d NOT IN ('retain','request_change','revoke') OR note IS NULL OR length(note) NOT BETWEEN 1 AND 2000
   OR coalesce((_input->>'expected_version')::int,0)<1 OR coalesce(_input->>'snapshot_hash','') !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
 h:=private.governance_review_hash(jsonb_build_object('operation','decision','input',_input));
 PERFORM pg_advisory_xact_lock(hashtextextended('governance.access_review.'||t::text||k::text,0));
 PERFORM private.governance_review_lock_sources();
 PERFORM private.governance_review_assert_member(t,d<>'request_change');
 SELECT * INTO i FROM public.access_review_items WHERE id=(_input->>'id')::uuid AND tenant_id=t FOR UPDATE;
 SELECT * INTO c FROM public.access_review_campaigns WHERE id=i.campaign_id AND tenant_id=t FOR UPDATE;
 IF i.id IS NULL OR c.id IS NULL OR NOT private.governance_review_can_read(i) OR i.reviewer_id IS DISTINCT FROM actor
   OR c.created_by IS NULL OR c.created_by=actor OR i.subject_user_id=actor THEN
   RAISE EXCEPTION 'Independent current assigned reviewer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM public.governance_access_review_receipts WHERE tenant_id=t AND request_key=k;
 IF FOUND THEN
   IF receipt.actor_id<>actor OR receipt.payload_hash<>h THEN RAISE EXCEPTION 'Request key collision' USING ERRCODE='23505'; END IF;
   RETURN receipt.result;
 END IF;
 IF c.status<>'active' OR i.governance_snapshot IS NULL OR i.governance_outcome NOT IN ('pending','change_requested')
   OR i.governance_version<>(_input->>'expected_version')::int OR i.governance_snapshot_hash<>_input->>'snapshot_hash' THEN
   RAISE EXCEPTION 'Review version/snapshot is stale or not actionable' USING ERRCODE='40001'; END IF;
 snap:=private.governance_review_snapshot(t,i.subject_user_id,(i.subject_scope->>'group_id')::uuid,(i.subject_scope->>'workspace_id')::uuid);
 IF private.governance_review_hash(snap)<>i.governance_snapshot_hash THEN
   RAISE EXCEPTION 'Current access changed; create a fresh review snapshot' USING ERRCODE='40001'; END IF;
 IF d='revoke' THEN
   DELETE FROM public.tenant_group_members WHERE group_id=(i.subject_scope->>'group_id')::uuid AND user_id=i.subject_user_id;
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>1 OR EXISTS(SELECT 1 FROM public.tenant_group_members WHERE group_id=(i.subject_scope->>'group_id')::uuid AND user_id=i.subject_user_id)
     OR EXISTS(SELECT 1 FROM public.effective_user_permissions(i.subject_user_id,t,NULL) p WHERE p.group_id=(i.subject_scope->>'group_id')::uuid) THEN
     RAISE EXCEPTION 'Reviewed membership revocation did not take effect' USING ERRCODE='40001'; END IF;
 END IF;
 outcome:=CASE d WHEN 'retain' THEN 'retained' WHEN 'revoke' THEN 'revoked' ELSE 'change_requested' END;
 event:=CASE d WHEN 'retain' THEN 'governance.access_review.retain' WHEN 'revoke' THEN 'governance.access_review.revoke' ELSE 'governance.access_review.change_requested' END;
 INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
 VALUES(actor,t,'tenant',event,'access_review_items',i.id::text,jsonb_build_object(
   'review_id',i.id,'campaign_id',c.id,'correlation_id',correlation,'actor_role',CASE WHEN private.governance_review_is_admin(t) THEN 'tenant_admin' ELSE 'assigned_reviewer' END,
   'reason',note,'version',i.governance_version+1,'reviewed_version',i.governance_version,'snapshot_hash',i.governance_snapshot_hash,
   'group_id',i.subject_scope->>'group_id','subject_user_id',i.subject_user_id,'outcome',outcome,'membership_revoked',d='revoke')) RETURNING id INTO audit_id;
 history:=coalesce(i.evidence->'governance_history','[]')||jsonb_build_array(jsonb_build_object(
   'actor_user_id',actor,'action',event,'outcome',outcome,'reason',note,'occurred_at',now(),'version',i.governance_version+1,'audit_id',audit_id,'correlation_id',correlation));
 UPDATE public.access_review_items SET decision=CASE d WHEN 'retain' THEN 'approved' WHEN 'revoke' THEN 'revoked' ELSE 'pending' END,
   governance_outcome=outcome,decision_note=note,decided_at=CASE WHEN d='request_change' THEN NULL ELSE now() END,
   governance_decided_by=actor,governance_correlation_id=correlation,governance_version=governance_version+1,
   evidence=evidence||jsonb_build_object('governance_history',history) WHERE id=i.id RETURNING * INTO i;
 result:=private.governance_review_row(i)||jsonb_build_object('history',history,'snapshot_current',d='request_change',
   'permitted_actions','[]'::jsonb,'membership_revoked',d='revoke',
   'remaining_effective_permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.permission_id,p.source,p.role_id,p.group_id,p.bu_id),'[]') FROM public.effective_user_permissions(i.subject_user_id,t,NULL) p));
 INSERT INTO public.governance_access_review_receipts VALUES(t,k,actor,h,result,now());
 RETURN result;
END $$;

-- Internal actor/snapshot helpers cannot be used as arbitrary-user RPC proxies.
REVOKE ALL ON FUNCTION private.governance_review_is_admin(uuid), private.governance_review_assert_member(uuid,boolean),
 private.governance_review_can_read(public.access_review_items), private.governance_review_hash(jsonb),
 private.governance_review_options_scope(jsonb),private.governance_review_member_option(jsonb,uuid),private.governance_review_list_rows(uuid),
 private.governance_review_lock_sources(), private.governance_review_snapshot(uuid,uuid,uuid,uuid),
 private.governance_review_row(public.access_review_items) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.governance_review_is_admin(uuid),private.governance_review_can_read(public.access_review_items) TO authenticated;
GRANT EXECUTE ON FUNCTION private.governance_review_options_scope(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.governance_review_member_option(jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.governance_review_list_rows(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.governance_access_review_list(jsonb),public.governance_access_review_get(jsonb),
 public.governance_access_review_campaign_create(jsonb),public.governance_access_review_decide(jsonb),public.governance_access_review_options(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.governance_access_review_list(jsonb),public.governance_access_review_get(jsonb),
 public.governance_access_review_campaign_create(jsonb),public.governance_access_review_decide(jsonb),public.governance_access_review_options(jsonb) TO authenticated;
COMMIT;
