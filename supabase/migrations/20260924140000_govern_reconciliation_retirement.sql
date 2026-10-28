-- Govern reconciliation retirement with two-person approval and preserve all run evidence.
-- Draft definitions with no runs retain permission-governed physical deletion.

ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retirement_request_id uuid;

CREATE TABLE IF NOT EXISTS public.recon_retirement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  recon_id uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  CONSTRAINT recon_retirement_decision_shape CHECK (
    (status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) BETWEEN 1 AND 2000)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS recon_retirement_one_pending_per_definition
  ON public.recon_retirement_requests(recon_id) WHERE status='pending';
DO $$ BEGIN
  ALTER TABLE public.recon_definitions
    ADD CONSTRAINT recon_definitions_retirement_request_fk
    FOREIGN KEY (retirement_request_id) REFERENCES public.recon_retirement_requests(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS recon_retirement_tenant_queue_idx
  ON public.recon_retirement_requests(tenant_id,status,requested_at DESC);

ALTER TABLE public.recon_retirement_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recon_retirement_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.recon_retirement_requests TO authenticated;
REVOKE ALL ON public.recon_retirement_requests FROM service_role;

-- The current schema stores one recon_definitions.bu_id, while owner scope
-- specifies that a reconciliation may have multiple owning BUs. Until that
-- join is implemented, fail closed for non-admins rather than treating the
-- single BU field as complete. Active tenant_admin is the approved override.
CREATE OR REPLACE FUNCTION private.user_can_govern_recon_retirement(
  _user uuid,_recon uuid,_permission text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private AS $$
  SELECT _permission IN ('edit','approve') AND EXISTS (
    SELECT 1 FROM public.recon_definitions d
    JOIN public.tenant_members m ON m.tenant_id=d.tenant_id AND m.user_id=_user AND m.active=true
    WHERE d.id=_recon AND m.role::text='tenant_admin'
  )
$$;
REVOKE ALL ON FUNCTION private.user_can_govern_recon_retirement(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.user_can_govern_recon_retirement(uuid,uuid,text) TO authenticated;

CREATE POLICY recon_retirement_requests_read_authorized ON public.recon_retirement_requests
  FOR SELECT TO authenticated
  USING (
    requested_by=auth.uid()
    OR (
      EXISTS (SELECT 1 FROM public.tenant_members m
        WHERE m.tenant_id=recon_retirement_requests.tenant_id
          AND m.user_id=auth.uid() AND m.active=true)
      AND private.user_can_govern_recon_retirement(auth.uid(),recon_id,'approve')
    )
  );

-- Keep the existing edit-access boundary, but only permit physical deletion of
-- an unrun draft. The trigger below also protects service_role and direct SQL.
DROP POLICY IF EXISTS recon_defs_delete ON public.recon_definitions;
CREATE POLICY recon_defs_delete ON public.recon_definitions
  FOR DELETE TO authenticated
  USING (
    status='draft'
    AND retired_at IS NULL
    AND private.user_can_access_recon(auth.uid(),id,'edit')
    AND EXISTS (SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id=recon_definitions.tenant_id
        AND m.user_id=auth.uid() AND m.active=true)
    AND (
      private.has_tenant_role(auth.uid(),tenant_id,'tenant_admin'::tenant_role)
      OR private.has_tenant_role(auth.uid(),tenant_id,'tenant_analyst'::tenant_role)
    )
    AND NOT EXISTS (SELECT 1 FROM public.recon_runs r WHERE r.definition_id=recon_definitions.id)
  );

CREATE OR REPLACE FUNCTION public.tg_guard_recon_definition_retirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE authorized_request uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' OR OLD.retired_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.recon_runs r WHERE r.definition_id=OLD.id) THEN
      RAISE EXCEPTION 'reconciliation with history or non-draft status cannot be physically deleted'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.retired_at IS NOT NULL AND
     (NEW.status IS DISTINCT FROM OLD.status OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
      OR NEW.retirement_request_id IS DISTINCT FROM OLD.retirement_request_id) THEN
    RAISE EXCEPTION 'retired reconciliation state is immutable' USING ERRCODE='23514';
  END IF;

  IF NEW.retired_at IS DISTINCT FROM OLD.retired_at
     OR NEW.retirement_request_id IS DISTINCT FROM OLD.retirement_request_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    authorized_request := nullif(current_setting('fvi.recon_retirement_request_id',true),'')::uuid;
    IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status='draft' AND NEW.status='active'
       AND NEW.retired_at IS NOT DISTINCT FROM OLD.retired_at
       AND NEW.retirement_request_id IS NOT DISTINCT FROM OLD.retirement_request_id THEN
      RETURN NEW;
    END IF;
    IF current_user<>'postgres' OR authorized_request IS NULL
       OR NEW.retirement_request_id IS DISTINCT FROM authorized_request
       OR NEW.retired_at IS NULL OR NEW.status<>'archived'
       OR NOT EXISTS (
         SELECT 1 FROM public.recon_retirement_requests q
         WHERE q.id=authorized_request AND q.recon_id=OLD.id AND q.tenant_id=OLD.tenant_id
           AND q.status='approved' AND q.decided_by IS NOT NULL AND q.decided_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'reconciliation retirement requires a governed approved request'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_recon_definition_retirement ON public.recon_definitions;
CREATE TRIGGER trg_guard_recon_definition_retirement
  BEFORE UPDATE OF status,retired_at,retirement_request_id OR DELETE ON public.recon_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_recon_definition_retirement();
REVOKE ALL ON FUNCTION public.tg_guard_recon_definition_retirement() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_recon_retirement(
  _tenant_id uuid,_recon_id uuid,_reason text
)
RETURNS TABLE(request_id uuid,status text,tenant_id uuid,recon_id uuid,retired_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.decide_recon_retirement(
  _request_id uuid,_approve boolean,_reason text
)
RETURNS TABLE(request_id uuid,status text,tenant_id uuid,recon_id uuid,retired_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $$
DECLARE actor uuid:=auth.uid(); request_row public.recon_retirement_requests%ROWTYPE;
  definition_row public.recon_definitions%ROWTYPE; next_status text; retired_timestamp timestamptz;
BEGIN
  IF actor IS NULL OR _request_id IS NULL OR _approve IS NULL
     OR _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'valid authenticated actor, decision, and reason required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO request_row FROM public.recon_retirement_requests q
    WHERE q.id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'retirement request not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO definition_row FROM public.recon_definitions d
    WHERE d.id=request_row.recon_id AND d.tenant_id=request_row.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation scope mismatch' USING ERRCODE='P0002'; END IF;
  IF request_row.status<>'pending' THEN RAISE EXCEPTION 'retirement request already decided' USING ERRCODE='23505'; END IF;
  IF actor=request_row.requested_by THEN RAISE EXCEPTION 'requester cannot approve own retirement' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id=request_row.tenant_id AND m.user_id=actor AND m.active=true)
     OR NOT private.user_can_govern_recon_retirement(actor,request_row.recon_id,'approve') THEN
    RAISE EXCEPTION 'active tenant reconciliation edit and approval access required' USING ERRCODE='42501';
  END IF;
  IF definition_row.status='draft' OR definition_row.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'reconciliation is not eligible for retirement decision' USING ERRCODE='23514';
  END IF;

  next_status:=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
  UPDATE public.recon_retirement_requests q
    SET status=next_status,decision_reason=btrim(_reason),decided_by=actor,decided_at=now()
    WHERE q.id=request_row.id;
  IF _approve THEN
    retired_timestamp:=now();
    PERFORM set_config('fvi.recon_retirement_request_id',request_row.id::text,true);
    UPDATE public.recon_definitions d SET status='archived',retired_at=retired_timestamp,retirement_request_id=request_row.id
      WHERE d.id=request_row.recon_id AND d.tenant_id=request_row.tenant_id;
  END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
    VALUES (actor,request_row.tenant_id,'workspace','recon.retirement.'||next_status,
      'recon_retirement_request',request_row.id::text,
      jsonb_build_object('recon_id',request_row.recon_id,'requested_by',request_row.requested_by,
        'decided_by',actor,'request_reason',request_row.reason,'decision_reason',btrim(_reason),
        'decided_at',now(),'retired_at',CASE WHEN _approve THEN now() ELSE NULL END));
  RETURN QUERY SELECT request_row.id,next_status,request_row.tenant_id,request_row.recon_id,
    retired_timestamp;
END $$;

REVOKE ALL ON FUNCTION public.request_recon_retirement(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.decide_recon_retirement(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_recon_retirement(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_retirement(uuid,boolean,text) TO authenticated;
