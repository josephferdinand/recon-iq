-- Additive reconciliation definition governance.
-- Existing definitions are legacy_unreviewed / legacy_passthrough and retain
-- their prior authorization, edit, and run behavior. New governance currently
-- uses an exact-tenant active tenant_admin interim checker only. This is not a
-- substitute for authoritative multi-BU Access enforcement and is source-only
-- until the cross-module Access cutover is reviewed and applied.

ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS governance_state text,
  ADD COLUMN IF NOT EXISTS access_mode text,
  ADD COLUMN IF NOT EXISTS governance_parent_id uuid,
  ADD COLUMN IF NOT EXISTS staging_original_name text,
  ADD COLUMN IF NOT EXISTS staging_generated_name text;

UPDATE public.recon_definitions
SET governance_state='legacy_unreviewed', access_mode='legacy_passthrough'
WHERE governance_state IS NULL OR access_mode IS NULL;

ALTER TABLE public.recon_definitions
  ALTER COLUMN governance_state SET DEFAULT 'development_draft',
  ALTER COLUMN governance_state SET NOT NULL,
  ALTER COLUMN access_mode SET DEFAULT 'unmapped_pending',
  ALTER COLUMN access_mode SET NOT NULL;

ALTER TABLE public.recon_definitions
  ADD CONSTRAINT recon_definitions_governance_state_check
    CHECK (governance_state IN ('legacy_unreviewed','development_draft','staging_copy',
      'edit_request_pending','promotion_request_pending','approved_locked','promoted')),
  ADD CONSTRAINT recon_definitions_access_mode_check
    CHECK (access_mode IN ('legacy_passthrough','unmapped_pending','mapped_exact')),
  ADD CONSTRAINT recon_definitions_governance_parent_fk
    FOREIGN KEY (tenant_id, governance_parent_id)
    REFERENCES public.recon_definitions(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT recon_definitions_legacy_mode_shape
    CHECK ((governance_state='legacy_unreviewed') = (access_mode='legacy_passthrough'));

CREATE TABLE public.recon_definition_governance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  parent_definition_id uuid NOT NULL,
  staging_definition_id uuid,
  request_kind text NOT NULL CHECK (request_kind IN ('edit','promotion')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source_version integer NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot jsonb,
  snapshot_sha256 text CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  decision_reason text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_definition_governance_request_parent_fk
    FOREIGN KEY (tenant_id,parent_definition_id)
    REFERENCES public.recon_definitions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT recon_definition_governance_request_staging_fk
    FOREIGN KEY (tenant_id,staging_definition_id)
    REFERENCES public.recon_definitions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT recon_definition_governance_request_decision_shape CHECK (
    (status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND decision_reason IS NOT NULL)
  ),
  CONSTRAINT recon_definition_governance_request_snapshot_shape CHECK (
    (request_kind='edit' AND snapshot IS NULL AND snapshot_sha256 IS NULL)
    OR (request_kind='promotion' AND snapshot IS NOT NULL AND snapshot_sha256 IS NOT NULL)
  )
);
CREATE UNIQUE INDEX recon_definition_governance_one_pending_per_parent
  ON public.recon_definition_governance_requests(tenant_id,parent_definition_id)
  WHERE status='pending';
CREATE INDEX recon_definition_governance_request_queue
  ON public.recon_definition_governance_requests(tenant_id,status,created_at DESC);

CREATE TABLE public.recon_definition_approved_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  parent_definition_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  snapshot jsonb NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  request_id uuid NOT NULL REFERENCES public.recon_definition_governance_requests(id) ON DELETE RESTRICT,
  approved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_definition_approved_version_parent_fk
    FOREIGN KEY (tenant_id,parent_definition_id)
    REFERENCES public.recon_definitions(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,parent_definition_id,version_number),
  UNIQUE (request_id)
);
CREATE INDEX recon_definition_approved_versions_latest
  ON public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number DESC);

CREATE TABLE public.recon_definition_governance_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  request_id uuid REFERENCES public.recon_definition_governance_requests(id) ON DELETE RESTRICT,
  parent_definition_id uuid NOT NULL,
  staging_definition_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'edit_requested','edit_approved','edit_rejected','promotion_submitted',
    'promotion_approved','promotion_rejected','version_approved')),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  snapshot_sha256 text CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recon_definition_governance_audit_parent_fk
    FOREIGN KEY (tenant_id,parent_definition_id)
    REFERENCES public.recon_definitions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT recon_definition_governance_audit_staging_fk
    FOREIGN KEY (tenant_id,staging_definition_id)
    REFERENCES public.recon_definitions(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX recon_definition_governance_audit_parent
  ON public.recon_definition_governance_audit(tenant_id,parent_definition_id,occurred_at DESC);
CREATE INDEX recon_definitions_governance_stage_parent
  ON public.recon_definitions(tenant_id,governance_parent_id,governance_state)
  WHERE governance_parent_id IS NOT NULL;

ALTER TABLE public.recon_definition_governance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_definition_approved_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_definition_governance_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recon_definition_governance_requests,
  public.recon_definition_approved_versions, public.recon_definition_governance_audit
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.recon_definition_governance_requests,
  public.recon_definition_approved_versions, public.recon_definition_governance_audit TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.recon_definition_governance_audit_id_seq TO service_role;
CREATE POLICY recon_definition_governance_requests_read ON public.recon_definition_governance_requests
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id=recon_definition_governance_requests.tenant_id
        AND m.user_id=auth.uid() AND m.active=true AND m.role::text='tenant_admin')
  );
CREATE POLICY recon_definition_approved_versions_read ON public.recon_definition_approved_versions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=recon_definition_approved_versions.tenant_id
      AND m.user_id=auth.uid() AND m.active=true AND m.role::text='tenant_admin')
  );
CREATE POLICY recon_definition_governance_audit_read ON public.recon_definition_governance_audit
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=recon_definition_governance_audit.tenant_id
      AND m.user_id=auth.uid() AND m.active=true AND m.role::text='tenant_admin')
  );

CREATE OR REPLACE FUNCTION private.recon_governance_is_active_admin(_tenant uuid,_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
  SELECT _tenant IS NOT NULL AND _actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id=_tenant AND m.user_id=_actor AND m.active=true AND m.role::text='tenant_admin'
  )
$$;
REVOKE ALL ON FUNCTION private.recon_governance_is_active_admin(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.recon_definition_config_snapshot(_row public.recon_definitions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object(
    'name',_row.name,'description',_row.description,'recon_type',_row.recon_type,
    'sides',_row.sides,'rules',_row.rules,'extension',_row.extension
  )
$$;
REVOKE ALL ON FUNCTION private.recon_definition_config_snapshot(public.recon_definitions) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reject_recon_governance_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation governance history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER recon_definition_approved_versions_immutable
  BEFORE UPDATE OR DELETE ON public.recon_definition_approved_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_recon_governance_history_mutation();
CREATE TRIGGER recon_definition_governance_audit_immutable
  BEFORE UPDATE OR DELETE ON public.recon_definition_governance_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_recon_governance_history_mutation();

CREATE OR REPLACE FUNCTION public.tg_guard_recon_definition_governance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE request_id uuid; request_row public.recon_definition_governance_requests%ROWTYPE;
  actor uuid:=auth.uid(); is_internal_transition boolean:=false; retirement_transition boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    request_id:=nullif(current_setting('fvi.recon_governance_request_id',true),'')::uuid;
    IF request_id IS NOT NULL THEN
      SELECT * INTO request_row FROM public.recon_definition_governance_requests q WHERE q.id=request_id;
    END IF;
    IF NEW.access_mode<>'unmapped_pending' OR NEW.environment='production'
       OR NOT private.recon_governance_is_active_admin(NEW.tenant_id,actor)
       OR NOT (NEW.governance_state='development_draft' AND NEW.governance_parent_id IS NULL
           AND NEW.staging_original_name IS NULL AND NEW.staging_generated_name IS NULL
         OR (NEW.governance_state='staging_copy' AND request_id IS NOT NULL
           AND request_row.request_kind='edit' AND request_row.status='approved'
           AND request_row.decided_by=actor AND request_row.tenant_id=NEW.tenant_id
           AND request_row.staging_definition_id IS NULL
           AND request_row.parent_definition_id=NEW.governance_parent_id
           AND NEW.staging_original_name IS NOT NULL AND NEW.staging_generated_name=NEW.name
           AND private.recon_governance_is_active_admin(NEW.tenant_id,actor))) THEN
      RAISE EXCEPTION 'new reconciliation definitions must begin as unmapped development drafts'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.governance_parent_id IS DISTINCT FROM OLD.governance_parent_id
     OR NEW.staging_original_name IS DISTINCT FROM OLD.staging_original_name
     OR NEW.staging_generated_name IS DISTINCT FROM OLD.staging_generated_name THEN
    RAISE EXCEPTION 'reconciliation staging identity is immutable' USING ERRCODE='23514';
  END IF;

  IF OLD.access_mode='legacy_passthrough' THEN
    IF NEW.access_mode IS DISTINCT FROM OLD.access_mode
       OR NEW.governance_state IS DISTINCT FROM OLD.governance_state THEN
      RAISE EXCEPTION 'legacy reconciliation governance state requires an owner-reviewed cutover'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.bu_id IS DISTINCT FROM OLD.bu_id OR NEW.visibility IS DISTINCT FROM OLD.visibility
     OR NEW.multi_bu_governed IS DISTINCT FROM OLD.multi_bu_governed THEN
    RAISE EXCEPTION 'reconciliation identity and access metadata are immutable outside the reviewed Access cutover'
      USING ERRCODE='23514';
  END IF;
  IF OLD.access_mode IS DISTINCT FROM NEW.access_mode THEN
    RAISE EXCEPTION 'reconciliation access mode requires an owner-reviewed Access cutover'
      USING ERRCODE='23514';
  END IF;

  request_id:=nullif(current_setting('fvi.recon_governance_request_id',true),'')::uuid;
  IF request_id IS NOT NULL THEN
    SELECT * INTO request_row FROM public.recon_definition_governance_requests q WHERE q.id=request_id;
    IF FOUND AND request_row.tenant_id=OLD.tenant_id
       AND request_row.decided_by=actor
       AND private.recon_governance_is_active_admin(OLD.tenant_id,actor) THEN
      is_internal_transition:=true;
    ELSIF FOUND AND request_row.tenant_id=OLD.tenant_id
       AND request_row.status='pending' AND request_row.requested_by=actor
       AND request_row.request_kind IN ('edit','promotion')
       AND private.recon_governance_is_active_admin(OLD.tenant_id,actor) THEN
      is_internal_transition:=true;
    END IF;
  END IF;

  IF NEW.governance_state IS DISTINCT FROM OLD.governance_state THEN
    IF NOT is_internal_transition THEN
      RAISE EXCEPTION 'reconciliation governance state changes require a verified workflow request'
        USING ERRCODE='23514';
    END IF;
    IF NOT COALESCE((
      (request_row.request_kind='edit' AND request_row.status='pending'
        AND request_row.requested_by=actor AND request_row.parent_definition_id=OLD.id
        AND OLD.governance_state='approved_locked' AND NEW.governance_state='edit_request_pending')
      OR (request_row.request_kind='edit' AND request_row.status='approved'
        AND request_row.decided_by=actor AND request_row.parent_definition_id=OLD.id
        AND OLD.governance_state='edit_request_pending' AND NEW.governance_state='approved_locked')
      OR (request_row.request_kind='edit' AND request_row.status='rejected'
        AND request_row.decided_by=actor AND request_row.parent_definition_id=OLD.id
        AND OLD.governance_state='edit_request_pending' AND NEW.governance_state='approved_locked')
      OR (request_row.request_kind='promotion' AND request_row.status='pending'
        AND request_row.requested_by=actor AND request_row.staging_definition_id=OLD.id
        AND OLD.governance_state IN ('development_draft','staging_copy')
        AND NEW.governance_state='promotion_request_pending')
      OR (request_row.request_kind='promotion' AND request_row.status='approved'
        AND request_row.decided_by=actor AND request_row.staging_definition_id=OLD.id
        AND OLD.governance_state='promotion_request_pending'
        AND NEW.governance_state IN ('approved_locked','promoted'))
      OR (request_row.request_kind='promotion' AND request_row.status='rejected'
        AND request_row.decided_by=actor AND request_row.staging_definition_id=OLD.id
        AND OLD.governance_state='promotion_request_pending'
        AND NEW.governance_state IN ('development_draft','staging_copy'))
    ),false) THEN
      RAISE EXCEPTION 'invalid reconciliation governance transition'
        USING ERRCODE='23514';
    END IF;
  END IF;

  IF OLD.governance_state='approved_locked' THEN
    retirement_transition:=NEW.status='archived' AND OLD.status='active'
      AND NEW.retired_at IS NOT NULL AND NEW.retirement_request_id IS NOT NULL
      AND NEW.governance_state=OLD.governance_state AND NEW.access_mode=OLD.access_mode
      AND NEW.environment=OLD.environment AND NEW.name=OLD.name AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.recon_type=OLD.recon_type AND NEW.sides=OLD.sides AND NEW.rules=OLD.rules
      AND NEW.extension=OLD.extension AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
      AND EXISTS (SELECT 1 FROM public.recon_retirement_requests rr WHERE rr.id=NEW.retirement_request_id
        AND rr.tenant_id=OLD.tenant_id AND rr.recon_id=OLD.id AND rr.status='approved'
        AND rr.decided_by=actor AND rr.requested_by<>actor AND rr.decided_at IS NOT NULL);
    IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.recon_type IS DISTINCT FROM OLD.recon_type OR NEW.sides IS DISTINCT FROM OLD.sides
        OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.extension IS DISTINCT FROM OLD.extension
        OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.status IS DISTINCT FROM OLD.status)
       AND NOT retirement_transition AND NOT (is_internal_transition AND request_row.request_kind='promotion'
         AND request_row.status='approved' AND request_row.parent_definition_id=OLD.id
         AND request_row.snapshot IS NOT NULL
         AND request_row.snapshot_sha256=encode(extensions.digest(
           convert_to(request_row.snapshot::text,'UTF8'),'sha256'),'hex')
         AND NEW.name=request_row.snapshot->>'name'
         AND NEW.description IS NOT DISTINCT FROM request_row.snapshot->>'description'
         AND NEW.recon_type=request_row.snapshot->>'recon_type'
         AND NEW.sides=request_row.snapshot->'sides' AND NEW.rules=request_row.snapshot->'rules'
         AND NEW.extension=request_row.snapshot->'extension'
         AND NEW.environment='production' AND NEW.status='active') THEN
      RAISE EXCEPTION 'approved reconciliation definitions are locked; use the maker-checker workflow'
        USING ERRCODE='23514';
    END IF;
  ELSIF OLD.governance_state IN ('edit_request_pending','promotion_request_pending','promoted') THEN
    IF NEW.name IS DISTINCT FROM OLD.name OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.recon_type IS DISTINCT FROM OLD.recon_type OR NEW.sides IS DISTINCT FROM OLD.sides
       OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.extension IS DISTINCT FROM OLD.extension
       OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.governance_state='promotion_request_pending' AND OLD.id=NEW.id
        AND request_row.request_kind='promotion' AND request_row.status='approved'
        AND request_row.staging_definition_id=OLD.id AND request_row.parent_definition_id=OLD.id
        AND request_row.snapshot_sha256=encode(extensions.digest(convert_to(request_row.snapshot::text,'UTF8'),'sha256'),'hex')
        AND NEW.name=request_row.snapshot->>'name'
        AND NEW.description IS NOT DISTINCT FROM request_row.snapshot->>'description'
        AND NEW.recon_type=request_row.snapshot->>'recon_type'
        AND NEW.sides=request_row.snapshot->'sides' AND NEW.rules=request_row.snapshot->'rules'
        AND NEW.extension=request_row.snapshot->'extension'
        AND NEW.environment='production' AND NEW.status='active') THEN
      RAISE EXCEPTION 'pending or promoted reconciliation definitions are immutable'
        USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF OLD.governance_state IN ('development_draft','staging_copy') THEN
    IF NEW.environment IS DISTINCT FROM OLD.environment OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'draft environment and business status are controlled by governance'
        USING ERRCODE='23514';
    END IF;
    IF OLD.governance_state='staging_copy' AND NOT private.recon_governance_is_active_admin(OLD.tenant_id,actor) THEN
      RAISE EXCEPTION 'staging edits currently require an active tenant administrator'
        USING ERRCODE='42501';
    END IF;
  END IF;

  IF NEW.environment='production' AND NEW.governance_state NOT IN ('approved_locked','edit_request_pending') THEN
    RAISE EXCEPTION 'production environment requires an approved locked version'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS recon_definitions_governance_guard ON public.recon_definitions;
CREATE TRIGGER recon_definitions_governance_guard
  BEFORE INSERT OR UPDATE ON public.recon_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_recon_definition_governance();
REVOKE ALL ON FUNCTION public.tg_guard_recon_definition_governance() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.request_recon_definition_edit(
  _tenant_id uuid,_recon_id uuid,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,extensions,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); d public.recon_definitions%ROWTYPE; v_id uuid; v_version integer; v_hash text;
BEGIN
  IF actor IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'authenticated actor, definition, and reason required' USING ERRCODE='22023';
  END IF;
  IF NOT private.recon_governance_is_active_admin(_tenant_id,actor) THEN
    RAISE EXCEPTION 'active tenant administrator required for interim maker-checker workflow' USING ERRCODE='42501';
  END IF;
  SELECT * INTO d FROM public.recon_definitions WHERE id=_recon_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND OR d.access_mode<>'unmapped_pending' OR d.governance_state<>'approved_locked'
     OR d.environment<>'production' OR d.status<>'active' OR d.retired_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.recon_retirement_requests rr
       WHERE rr.tenant_id=_tenant_id AND rr.recon_id=_recon_id AND rr.status='pending')
     OR EXISTS (SELECT 1 FROM public.recon_definitions stage
       WHERE stage.tenant_id=_tenant_id AND stage.governance_parent_id=_recon_id
         AND stage.governance_state IN ('staging_copy','promotion_request_pending')) THEN
    RAISE EXCEPTION 'definition is not eligible for a governed edit request' USING ERRCODE='23514';
  END IF;
  SELECT version_number,snapshot_sha256 INTO v_version,v_hash
  FROM public.recon_definition_approved_versions
  WHERE tenant_id=_tenant_id AND parent_definition_id=_recon_id
  ORDER BY version_number DESC LIMIT 1;
  IF v_version IS NULL THEN RAISE EXCEPTION 'approved version evidence is unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO public.recon_definition_governance_requests
    (tenant_id,parent_definition_id,request_kind,requested_by,reason,source_version,source_sha256)
    VALUES (_tenant_id,_recon_id,'edit',actor,btrim(_reason),v_version,v_hash) RETURNING id INTO v_id;
  PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
  UPDATE public.recon_definitions SET governance_state='edit_request_pending'
    WHERE id=_recon_id AND tenant_id=_tenant_id;
  INSERT INTO public.recon_definition_governance_audit
    (tenant_id,request_id,parent_definition_id,event_type,actor_id,reason,snapshot_sha256)
    VALUES (_tenant_id,v_id,_recon_id,'edit_requested',actor,btrim(_reason),v_hash);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES(actor,_tenant_id,'workspace','recon.definition.edit_requested','recon_definition',_recon_id::text,
      jsonb_build_object('request_id',v_id,'approved_version',v_version,'snapshot_sha256',v_hash));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.decide_recon_definition_edit(
  _request_id uuid,_approve boolean,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,extensions,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); q public.recon_definition_governance_requests%ROWTYPE;
  parent public.recon_definitions%ROWTYPE; stage_id uuid; stage_name text; stage_suffix text;
  source_snapshot jsonb; source_hash text;
BEGIN
  IF actor IS NULL OR _approve IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'authenticated actor, decision, and reason required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='edit' FOR UPDATE;
  IF NOT FOUND OR q.status<>'pending' THEN RAISE EXCEPTION 'pending edit request not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO parent FROM public.recon_definitions WHERE id=q.parent_definition_id AND tenant_id=q.tenant_id FOR UPDATE;
  IF NOT FOUND OR actor=q.requested_by OR NOT private.recon_governance_is_active_admin(q.tenant_id,actor)
     OR parent.governance_state<>'edit_request_pending' THEN
    RAISE EXCEPTION 'independent active tenant administrator required' USING ERRCODE='42501';
  END IF;
  UPDATE public.recon_definition_governance_requests SET
    status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decision_reason=btrim(_reason),decided_by=actor,decided_at=now()
    WHERE id=q.id;
  PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
  IF _approve THEN
    stage_id:=gen_random_uuid();
    stage_suffix:=' [staging '||substr(stage_id::text,1,8)||']';
    stage_name:=left(parent.name,80-length(stage_suffix))||stage_suffix;
    INSERT INTO public.recon_definitions(
      id,tenant_id,name,description,recon_type,sides,rules,extension,status,environment,
      created_by,governance_state,access_mode,governance_parent_id,staging_original_name,staging_generated_name
    ) VALUES (
      stage_id,parent.tenant_id,stage_name,parent.description,parent.recon_type,parent.sides,parent.rules,
      parent.extension,'draft','staging',q.requested_by,'staging_copy','unmapped_pending',parent.id,
      parent.name,stage_name
    );
    UPDATE public.recon_definition_governance_requests SET staging_definition_id=stage_id WHERE id=q.id;
  END IF;
  PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
  UPDATE public.recon_definitions SET governance_state='approved_locked'
    WHERE id=q.parent_definition_id AND tenant_id=q.tenant_id;
  INSERT INTO public.recon_definition_governance_audit
    (tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256)
    VALUES(q.tenant_id,q.id,q.parent_definition_id,stage_id,
      CASE WHEN _approve THEN 'edit_approved' ELSE 'edit_rejected' END,actor,btrim(_reason),q.source_sha256);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.edit_approved' ELSE 'recon.definition.edit_rejected' END,
      'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',q.parent_definition_id,'staging_definition_id',stage_id,'reason',btrim(_reason)));
  RETURN stage_id;
END $$;

CREATE OR REPLACE FUNCTION public.submit_recon_definition_promotion(
  _tenant_id uuid,_staging_id uuid,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,extensions,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); d public.recon_definitions%ROWTYPE; parent_id uuid; parent public.recon_definitions%ROWTYPE;
  snap jsonb; snap_hash text; v_id uuid; source_version integer:=0; source_hash text;
BEGIN
  IF actor IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'authenticated actor, definition, and reason required' USING ERRCODE='22023';
  END IF;
  IF NOT private.recon_governance_is_active_admin(_tenant_id,actor) THEN
    RAISE EXCEPTION 'active tenant administrator required for interim maker-checker workflow' USING ERRCODE='42501';
  END IF;
  SELECT * INTO d FROM public.recon_definitions WHERE id=_staging_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND OR d.access_mode<>'unmapped_pending' OR d.environment NOT IN ('development','staging')
     OR d.governance_state NOT IN ('development_draft','staging_copy') THEN
    RAISE EXCEPTION 'only an editable non-production draft can be submitted' USING ERRCODE='23514';
  END IF;
  parent_id:=COALESCE(d.governance_parent_id,d.id);
  SELECT * INTO parent FROM public.recon_definitions WHERE id=parent_id AND tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND OR (parent.id<>d.id AND (parent.governance_state<>'approved_locked'
      OR parent.status<>'active' OR parent.retired_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.recon_retirement_requests rr
        WHERE rr.tenant_id=_tenant_id AND rr.recon_id=parent.id AND rr.status='pending'))) THEN
    RAISE EXCEPTION 'promotion parent is not locked and eligible' USING ERRCODE='23514';
  END IF;
  IF d.staging_generated_name IS NOT NULL AND d.name=d.staging_generated_name THEN
    snap:=private.recon_definition_config_snapshot(d)-'name'
      ||jsonb_build_object('name',d.staging_original_name);
  ELSE
    snap:=private.recon_definition_config_snapshot(d);
  END IF;
  snap_hash:=encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex');
  IF parent.id<>d.id THEN
    SELECT version_number,snapshot_sha256 INTO source_version,source_hash
      FROM public.recon_definition_approved_versions WHERE tenant_id=_tenant_id AND parent_definition_id=parent_id
      ORDER BY version_number DESC LIMIT 1;
    IF source_version IS NULL THEN RAISE EXCEPTION 'parent version evidence is unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO public.recon_definition_governance_requests
    (tenant_id,parent_definition_id,staging_definition_id,request_kind,requested_by,reason,
      source_version,source_sha256,snapshot,snapshot_sha256)
    VALUES(_tenant_id,parent_id,d.id,'promotion',actor,btrim(_reason),source_version,source_hash,snap,snap_hash)
    RETURNING id INTO v_id;
  PERFORM set_config('fvi.recon_governance_request_id',v_id::text,true);
  UPDATE public.recon_definitions SET governance_state='promotion_request_pending'
    WHERE id=d.id AND tenant_id=_tenant_id;
  INSERT INTO public.recon_definition_governance_audit
    (tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256)
    VALUES(_tenant_id,v_id,parent_id,d.id,'promotion_submitted',actor,btrim(_reason),snap_hash);
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES(actor,_tenant_id,'workspace','recon.definition.promotion_submitted','recon_definition_governance_request',v_id::text,
      jsonb_build_object('parent_definition_id',parent_id,'staging_definition_id',d.id,'snapshot_sha256',snap_hash,'source_version',source_version));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.decide_recon_definition_promotion(
  _request_id uuid,_approve boolean,_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,extensions,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); q public.recon_definition_governance_requests%ROWTYPE;
  parent public.recon_definitions%ROWTYPE; stage public.recon_definitions%ROWTYPE; next_version integer;
  current_snapshot jsonb;
BEGIN
  IF actor IS NULL OR _approve IS NULL OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'authenticated actor, decision, and reason required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO q FROM public.recon_definition_governance_requests WHERE id=_request_id AND request_kind='promotion' FOR UPDATE;
  IF NOT FOUND OR q.status<>'pending' THEN RAISE EXCEPTION 'pending promotion request not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO parent FROM public.recon_definitions WHERE id=q.parent_definition_id AND tenant_id=q.tenant_id FOR UPDATE;
  SELECT * INTO stage FROM public.recon_definitions WHERE id=q.staging_definition_id AND tenant_id=q.tenant_id FOR UPDATE;
  IF parent.id IS NULL OR stage.id IS NULL OR stage.governance_state<>'promotion_request_pending'
     OR actor=q.requested_by OR NOT private.recon_governance_is_active_admin(q.tenant_id,actor) THEN
    RAISE EXCEPTION 'independent active tenant administrator required' USING ERRCODE='42501';
  END IF;
  current_snapshot:=private.recon_definition_config_snapshot(stage);
  IF stage.staging_generated_name IS NOT NULL AND stage.name=stage.staging_generated_name THEN
    current_snapshot:=current_snapshot-'name'||jsonb_build_object('name',stage.staging_original_name);
  END IF;
  IF current_snapshot IS DISTINCT FROM q.snapshot THEN
    RAISE EXCEPTION 'frozen promotion snapshot does not match staging definition' USING ERRCODE='23514';
  END IF;
  IF q.snapshot_sha256<>encode(extensions.digest(convert_to(q.snapshot::text,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION 'promotion snapshot integrity check failed' USING ERRCODE='23514';
  END IF;
  UPDATE public.recon_definition_governance_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decision_reason=btrim(_reason),decided_by=actor,decided_at=now() WHERE id=q.id;
  PERFORM set_config('fvi.recon_governance_request_id',q.id::text,true);
  IF _approve THEN
    IF parent.id=stage.id THEN
      UPDATE public.recon_definitions SET
        name=q.snapshot->>'name',description=q.snapshot->>'description',recon_type=q.snapshot->>'recon_type',
        sides=q.snapshot->'sides',rules=q.snapshot->'rules',extension=q.snapshot->'extension',
        environment='production',status='active',governance_state='approved_locked'
      WHERE id=parent.id AND tenant_id=q.tenant_id;
    ELSE
      UPDATE public.recon_definitions SET
        name=q.snapshot->>'name',description=q.snapshot->>'description',recon_type=q.snapshot->>'recon_type',
        sides=q.snapshot->'sides',rules=q.snapshot->'rules',extension=q.snapshot->'extension',
        environment='production',status='active',governance_state='approved_locked'
      WHERE id=parent.id AND tenant_id=q.tenant_id;
      UPDATE public.recon_definitions SET governance_state='promoted'
        WHERE id=stage.id AND tenant_id=q.tenant_id;
    END IF;
    SELECT COALESCE(MAX(version_number),0)+1 INTO next_version FROM public.recon_definition_approved_versions
      WHERE tenant_id=q.tenant_id AND parent_definition_id=parent.id;
    INSERT INTO public.recon_definition_approved_versions
      (tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by)
      VALUES(q.tenant_id,parent.id,next_version,q.snapshot,q.snapshot_sha256,q.id,actor);
  ELSE
    UPDATE public.recon_definitions SET governance_state=CASE WHEN id=parent.id AND id=stage.id
      THEN 'development_draft' ELSE 'staging_copy' END
      WHERE id=stage.id AND tenant_id=q.tenant_id;
  END IF;
  INSERT INTO public.recon_definition_governance_audit
    (tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256)
    VALUES(q.tenant_id,q.id,parent.id,stage.id,CASE WHEN _approve THEN 'promotion_approved' ELSE 'promotion_rejected' END,
      actor,btrim(_reason),q.snapshot_sha256);
  IF _approve THEN
    INSERT INTO public.recon_definition_governance_audit
      (tenant_id,request_id,parent_definition_id,staging_definition_id,event_type,actor_id,reason,snapshot_sha256)
      VALUES(q.tenant_id,q.id,parent.id,stage.id,'version_approved',actor,btrim(_reason),q.snapshot_sha256);
  END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES(actor,q.tenant_id,'workspace',CASE WHEN _approve THEN 'recon.definition.promotion_approved' ELSE 'recon.definition.promotion_rejected' END,
      'recon_definition_governance_request',q.id::text,jsonb_build_object('parent_definition_id',parent.id,
      'staging_definition_id',stage.id,'version_number',next_version,'snapshot_sha256',q.snapshot_sha256,'reason',btrim(_reason)));
  RETURN CASE WHEN _approve THEN next_version ELSE NULL END;
END $$;

CREATE OR REPLACE FUNCTION public.tg_guard_recon_run_governance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE d public.recon_definitions%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.recon_definitions WHERE id=NEW.definition_id AND tenant_id=NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation definition does not belong to run tenant' USING ERRCODE='23503'; END IF;
  IF d.governance_state='legacy_unreviewed' AND d.access_mode='legacy_passthrough' THEN RETURN NEW; END IF;
  IF d.governance_state='edit_request_pending' AND d.environment='production' THEN RETURN NEW; END IF;
  IF d.governance_state='development_draft' AND d.environment='development'
     OR d.governance_state='staging_copy' AND d.environment IN ('development','staging') THEN
    IF NEW.run_by IS NULL OR NOT private.recon_governance_is_active_admin(NEW.tenant_id,NEW.run_by) THEN
      RAISE EXCEPTION 'active tenant administrator required for an unmapped development definition' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF d.governance_state='approved_locked' AND d.environment='production'
     AND d.status='active' AND NEW.run_by IS NOT NULL
     AND private.recon_governance_is_active_admin(NEW.tenant_id,NEW.run_by) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'reconciliation definition is not eligible to run in this environment' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS recon_runs_governance_guard ON public.recon_runs;
CREATE TRIGGER recon_runs_governance_guard
  BEFORE INSERT ON public.recon_runs FOR EACH ROW EXECUTE FUNCTION public.tg_guard_recon_run_governance();
REVOKE ALL ON FUNCTION public.tg_guard_recon_run_governance() FROM PUBLIC,anon,authenticated;

-- Include governance evidence in the immutable per-run snapshot; legacy rows
-- receive null version/hash because no trustworthy historical approval exists.
CREATE OR REPLACE FUNCTION public.tg_snapshot_recon_run_definition()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,private,extensions,pg_temp AS $$
DECLARE definition_row public.recon_definitions%ROWTYPE; source_rows jsonb;
  approved_version integer; approved_hash text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.definition_snapshot IS DISTINCT FROM OLD.definition_snapshot THEN
      RAISE EXCEPTION 'reconciliation run definition snapshot is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.definition_id IS DISTINCT FROM OLD.definition_id THEN
      RAISE EXCEPTION 'reconciliation run scope is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO definition_row FROM public.recon_definitions WHERE id=NEW.definition_id AND tenant_id=NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation definition does not belong to run tenant' USING ERRCODE='23503'; END IF;
  SELECT jsonb_agg(jsonb_build_object('side_id',side.value->>'side_id','data_source_id',side.value->>'data_source_id',
      'name',ds.name,'source_type',ds.source_type) ORDER BY side.ordinality)
    INTO source_rows FROM jsonb_array_elements(definition_row.sides) WITH ORDINALITY AS side(value,ordinality)
    LEFT JOIN public.workspace_data_sources ds ON ds.id::text=side.value->>'data_source_id' AND ds.tenant_id=NEW.tenant_id;
  IF definition_row.governance_state IN ('approved_locked','edit_request_pending') THEN
    SELECT version_number,snapshot_sha256 INTO approved_version,approved_hash
      FROM public.recon_definition_approved_versions WHERE tenant_id=NEW.tenant_id
        AND parent_definition_id=definition_row.id
      ORDER BY version_number DESC LIMIT 1;
  END IF;
  NEW.definition_snapshot:=jsonb_build_object(
    'name',definition_row.name,'recon_type',definition_row.recon_type,'sides',definition_row.sides,
    'rules',definition_row.rules,'sources',COALESCE(source_rows,'[]'::jsonb),
    'governance_state',definition_row.governance_state,'access_mode',definition_row.access_mode,
    'approved_version',approved_version,'approved_sha256',approved_hash
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_snapshot_recon_run_definition() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.request_recon_definition_edit(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.decide_recon_definition_edit(uuid,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.submit_recon_definition_promotion(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.decide_recon_definition_promotion(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_recon_definition_edit(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_definition_edit(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_recon_definition_promotion(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_definition_promotion(uuid,boolean,text) TO authenticated;

COMMENT ON COLUMN public.recon_definitions.governance_state IS
  'Definition governance status. legacy_unreviewed is evidence-only and does not claim historical approval.';
COMMENT ON COLUMN public.recon_definitions.access_mode IS
  'Legacy rows remain legacy_passthrough; new rows are unmapped_pending until owner-approved Access cutover.';
COMMENT ON FUNCTION public.request_recon_definition_edit(uuid,uuid,text) IS
  'Source-only interim tenant-admin workflow. Non-admin checker authority is unavailable until Access enforcement is authoritative.';
